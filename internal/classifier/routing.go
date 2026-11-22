package classifier

import (
	"context"

	"github.com/UangSC/cpa-codex-downshift-classifier/internal/cpa"
)

func routingValues(routing RoutingSettings, id string, group *string) (RoutingValues, bool) {
	if values, ok := routing.Overrides[id]; ok {
		return values, true
	}
	key := "ungrouped"
	if group != nil {
		key = *group
	}
	return routing.Groups[key], false
}

type RoutingRequest struct {
	CredentialID string `json:"credentialId"`
	Priority     *int   `json:"priority,omitempty"`
	Weight       *int   `json:"weight,omitempty"`
	Reset        bool   `json:"reset,omitempty"`
}

func (s *Service) SaveRouting(ctx context.Context, q RoutingRequest) error {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return err
	}
	var found *cpa.Credential
	for i := range live {
		if live[i].ID == q.CredentialID {
			found = &live[i]
			break
		}
	}
	if found == nil {
		return &apiError{404, "Codex 凭证不存在"}
	}
	if q.Weight != nil {
		strategy, err := s.adapter.RoutingStrategy(ctx)
		if err != nil {
			return err
		}
		if strategy != "weighted-round-robin" {
			return &apiError{409, "加权轮询策略下才可修改权重"}
		}
		if *q.Weight < 0 || *q.Weight > 9999 || q.Reset {
			return bad("权重支持 0～9999，不能与重置同时提交")
		}
	}
	if !q.Reset && q.Priority == nil && q.Weight == nil {
		return bad("未提供路由数值")
	}
	s.mu.Lock()
	if s.credentialBusyLocked(q.CredentialID) {
		s.mu.Unlock()
		return &apiError{409, "该凭证仍在巡检任务中，请先停止任务或等待完成后再修改调度数值"}
	}
	v := clone(s.state.Settings)
	r := s.recordLocked(q.CredentialID)
	group := r.Group
	s.mu.Unlock()
	fields := cpa.Fields{Weight: q.Weight}
	if q.Reset {
		delete(v.Routing.Overrides, q.CredentialID)
		values, _ := routingValues(v.Routing, q.CredentialID, group)
		fields.Priority = &values.Priority
	} else {
		values := RoutingValues{found.Priority, found.Weight}
		if existing, ok := v.Routing.Overrides[q.CredentialID]; ok {
			values.Weight = existing.Weight
		}
		if q.Priority != nil {
			values.Priority = *q.Priority
		}
		if err = validateValues(values); err != nil {
			return err
		}
		if q.Priority != nil {
			v.Routing.Overrides[q.CredentialID] = values
		}
		fields.Priority = q.Priority
	}
	// 官方接口写入成功后，覆盖值才持久化，避免展示未生效的数字。
	// 手动数值编辑不改前缀，也不清除已有的分组同步失败。
	changed := fields.Priority != nil && *fields.Priority != found.Priority || fields.Weight != nil && *fields.Weight != found.Weight
	if changed {
		if err = s.adapter.UpdateFields(ctx, q.CredentialID, fields); err != nil {
			return err
		}
	}
	s.mu.Lock()
	old := s.state.Settings
	s.state.Settings = v
	err = s.persistLocked()
	if err != nil {
		s.state.Settings = old
	}
	s.mu.Unlock()
	return err
}
func (s *Service) apply(ctx context.Context, id string, group *string, v Settings) (Sync, error) {
	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return s.failedSync(id, group, v.Routing.Mode, err)
	}
	var current *cpa.Credential
	for i := range live {
		if live[i].ID == id {
			current = &live[i]
			break
		}
	}
	if current == nil {
		return s.failedSync(id, group, v.Routing.Mode, &apiError{404, "Codex 凭证不存在"})
	}
	if current.Disabled {
		return Sync{Mode: v.Routing.Mode, Status: "not-needed"}, &apiError{409, "该凭证已在 CPA 停用，请先在 CPA 启用"}
	}
	// 仅优先级模式保留插件接管前的模型前缀，切换策略也可以恢复。
	s.mu.Lock()
	originalPrefix := s.recordLocked(id).OriginalPrefix
	s.mu.Unlock()
	if originalPrefix == nil {
		originalPrefix = str(current.Prefix)
		s.mu.Lock()
		s.recordLocked(id).OriginalPrefix = originalPrefix
		err = s.persistLocked()
		s.mu.Unlock()
		if err != nil {
			return s.failedSync(id, group, v.Routing.Mode, err)
		}
	}
	values, override := routingValues(v.Routing, id, group)
	fields := cpa.Fields{}
	if v.Routing.Mode == "priority" || override {
		fields.Priority = &values.Priority
	}
	if v.Routing.Mode == "prefix" && group != nil {
		prefix := v.Prefixes.Normal
		if *group == "downshift" {
			prefix = v.Prefixes.Downshift
		}
		fields.Prefix = &prefix
	} else if group != nil {
		fields.Prefix = originalPrefix
	}
	changed := fields.Priority != nil && *fields.Priority != current.Priority || fields.Prefix != nil && *fields.Prefix != current.Prefix
	if err == nil && changed {
		err = s.adapter.UpdateFields(ctx, id, fields)
	}
	now := stamp()
	syncRecord := Sync{Mode: v.Routing.Mode, DesiredGroup: group, Status: "synced", At: &now}
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.recordLocked(id)
	syncRecord.AppliedGroup = r.Group
	if err != nil {
		syncRecord.Status = "failed"
		syncRecord.Message = str(err.Error())
	} else {
		r.Group = group
		syncRecord.AppliedGroup = group
	}
	r.Sync = syncRecord
	if persistErr := s.persistLocked(); persistErr != nil {
		if err == nil {
			err = persistErr
		}
		r.Sync.Status = "failed"
		r.Sync.Message = str("CPA 写入后插件状态持久化失败：" + persistErr.Error())
		syncRecord = r.Sync
	}
	return syncRecord, err
}
func (s *Service) failedSync(id string, desired *string, mode string, err error) (Sync, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.recordLocked(id)
	at := stamp()
	r.Sync = Sync{Mode: mode, DesiredGroup: desired, AppliedGroup: r.Group, Status: "failed", At: &at, Message: str(err.Error())}
	if persistErr := s.persistLocked(); persistErr != nil {
		r.Sync.Message = str(err.Error() + "；状态持久化失败：" + persistErr.Error())
	}
	return clone(r.Sync), err
}
func (s *Service) Resync(ctx context.Context, id string) (any, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return nil, err
	}
	found := false
	for _, c := range live {
		if c.ID == id {
			if c.Disabled {
				return nil, &apiError{409, "该凭证已在 CPA 停用，请先在 CPA 启用"}
			}
			found = true
			break
		}
	}
	if !found {
		return nil, &apiError{404, "Codex 凭证不存在"}
	}
	s.mu.Lock()
	r := s.recordLocked(id)
	if r.InspectionExcluded {
		s.mu.Unlock()
		return nil, &apiError{409, "该凭证不参与巡检，请先恢复参与后再同步分组"}
	}
	if s.credentialBusyLocked(id) {
		s.mu.Unlock()
		return nil, &apiError{409, "该凭证仍在巡检任务中，请先停止任务或等待完成"}
	}
	desired := r.Sync.DesiredGroup
	settings := clone(s.state.Settings)
	managedUngrouped := settings.Routing.Mode == "priority" && r.OriginalPrefix != nil
	s.mu.Unlock()
	if desired == nil && !managedUngrouped {
		return nil, bad("该凭证没有待同步的分组")
	}
	result, err := s.apply(ctx, id, desired, settings)
	if err != nil {
		return map[string]any{"status": "failed", "appliedGroup": result.AppliedGroup, "message": result.Message}, nil
	}
	return map[string]any{"status": "synced", "appliedGroup": result.AppliedGroup, "message": nil}, nil
}
