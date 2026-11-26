package classifier

import (
	"context"
	"strings"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
)

func isFreePlan(plan string) bool {
	return strings.EqualFold(strings.TrimSpace(plan), "free")
}

func excludedFromInspection(credential cpa.Credential, record *Record, settings Settings) bool {
	return credential.Disabled || (record != nil && record.InspectionExcluded) || (isFreePlan(credential.Plan) && !settings.InspectFreeAccounts)
}

// SetExclusions 只改变插件的巡检范围，不触碰 CPA 凭证字段或历史依据。
func (s *Service) SetExclusions(ctx context.Context, ids []string, excluded bool) error {
	if len(ids) == 0 || len(ids) > 1024 {
		return bad("请选择 1～1024 个凭证")
	}
	selected := map[string]bool{}
	for _, id := range ids {
		if id == "" {
			return bad("凭证 ID 不能为空")
		}
		selected[id] = true
	}
	s.mutation.Lock()
	defer s.mutation.Unlock()
	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return err
	}
	known := map[string]cpa.Credential{}
	for _, c := range live {
		known[c.ID] = c
	}
	for id := range selected {
		c, ok := known[id]
		if !ok {
			return &apiError{404, "Codex 凭证不存在或已移除"}
		}
		if excluded && c.Disabled {
			return &apiError{409, "该凭证已关闭，本身不参与巡检，无需移入排除池"}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// 批量检查全部通过后才修改，避免部分凭证已入池而另一部分失败。
	for id := range selected {
		if s.credentialBusyLocked(id) {
			return &apiError{409, "所选凭证仍在巡检任务中，请先停止任务或等待完成"}
		}
	}
	previous := map[string]*Record{}
	for id := range selected {
		if old := s.state.Records[id]; old != nil {
			copy := clone(*old)
			previous[id] = &copy
		} else {
			previous[id] = nil
		}
		r := s.recordLocked(id)
		if r.InspectionExcluded != excluded {
			r.InspectionExcluded = excluded
			if excluded {
				r.ExcludedAt = str(stamp())
			} else {
				r.ExcludedAt = nil
			}
		}
	}
	if err = s.persistLocked(); err != nil {
		for id, old := range previous {
			if old == nil {
				delete(s.state.Records, id)
			} else {
				s.state.Records[id] = old
			}
		}
		return err
	}
	return nil
}

// SetCredentialStatus 同步更新 CPA 凭证的启用/停用状态。
func (s *Service) SetCredentialStatus(ctx context.Context, id string, disabled bool) error {
	if id == "" {
		return bad("凭证 ID 不能为空")
	}
	updater, ok := s.adapter.(cpa.StatusUpdater)
	if !ok {
		return &apiError{501, "当前 CPA 适配器不支持切换凭证状态"}
	}
	s.mutation.Lock()
	defer s.mutation.Unlock()
	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return err
	}
	found := false
	for _, c := range live {
		if c.ID == id {
			found = true
			break
		}
	}
	if !found {
		return &apiError{404, "Codex 凭证不存在或已移除"}
	}
	s.mu.Lock()
	busy := s.credentialBusyLocked(id)
	s.mu.Unlock()
	if busy {
		return &apiError{409, "该凭证正在巡检任务中，请先停止任务或等待完成"}
	}
	return updater.SetDisabled(ctx, id, disabled)
}

func (s *Service) credentialBusyLocked(id string) bool {
	for _, task := range s.state.Tasks {
		if task.Status != "running" {
			continue
		}
		for _, item := range task.Items {
			if !terminal(item.State) && strings.HasPrefix(item.TargetID, id+"::") {
				return true
			}
		}
	}
	return false
}
func (s *Service) inspectionExcluded(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.state.Records[id]
	return r != nil && r.InspectionExcluded
}
