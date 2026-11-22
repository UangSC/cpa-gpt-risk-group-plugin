package classifier

import (
	"context"
	"sort"

	"github.com/UangSC/cpa-codex-downshift-classifier/internal/cpa"
	"github.com/UangSC/cpa-codex-downshift-classifier/internal/fingerprint"
)

func (s *Service) Snapshot(ctx context.Context) (Snapshot, error) {
	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	strategy, err := s.adapter.RoutingStrategy(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Snapshot{Credentials: []Credential{}, Targets: []Target{}, Settings: clone(s.state.Settings), Tasks: clone(s.state.Tasks), Source: "live", SourceDetail: "来自 CPA 官方凭证与运行状态接口；未提供的额度或会话状态显示未知。模型指纹以三次数字挑战与固定参考库计算归因，目标参考概率严格高于 90% 才判正常。定时巡检时区：Asia/Shanghai。", Capabilities: Capabilities{RoutingStrategy: strategy, WeightEditingEnabled: strategy == "weighted-round-robin", FingerprintAvailable: fingerprint.Available(), QuotaRefreshAvailable: s.quotaRefreshAvailable()}}
	out.ConfigChangesRevision = configurationFingerprint(s.state.Settings, false)
	out.RequestHeaderProfile = cpa.DefaultRequestHeaderProfile()
	if s.state.ScheduleConsentRequired {
		out.SourceDetail += " 未获配置修改授权的旧定时计划已关闭，请重新确认后启用。"
	}
	liveIDs := map[string]bool{}
	for _, c := range live {
		liveIDs[c.ID] = true
		r := s.recordLocked(c.ID)
		if r.Group == nil && r.Sync.DesiredGroup == nil && out.Settings.Routing.Mode == "prefix" {
			if c.Prefix != "" && c.Prefix == out.Settings.Prefixes.Downshift {
				r.Group = str("downshift")
			}
			if c.Prefix != "" && c.Prefix == out.Settings.Prefixes.Normal {
				r.Group = str("normal")
			}
			if r.Group != nil {
				r.Sync = Sync{Mode: "prefix", AppliedGroup: r.Group, Status: "not-needed"}
			}
		}
		auth := c.Auth
		if auth == "" {
			auth = "valid"
		}
		availability := c.Availability
		if availability == "" {
			availability = "unknown"
		}
		if availability != "unknown" {
			out.Capabilities.AvailabilityKnown = true
		}
		models := c.Models
		if models == nil {
			models = []string{}
		}
		quota := c.Quota
		if quota.Windows == nil {
			quota.Windows = []cpa.QuotaWindow{}
		}
		if quota.Status == "" {
			quota.Status = "unknown"
		}
		group, syncRecord := reconcile(c, r, out.Settings, strategy)
		out.Credentials = append(out.Credentials, Credential{
			ID: c.ID, Name: c.Name, File: c.File, Plan: c.Plan, Auth: auth,
			Availability: availability, BusySessions: c.BusySessions, Quota: quota,
			Models: models, Group: group, Sync: syncRecord,
			Routing: RoutingValues{c.Priority, c.Weight}, Disabled: c.Disabled,
			Unavailable: c.Unavailable, Prefix: c.Prefix,
			InspectionExcluded: excludedFromInspection(c, r), ExcludedAt: r.ExcludedAt,
		})
		model := out.Settings.InspectionModel
		tid := targetID(c.ID, model)
		target, ok := r.Targets[model]
		if !ok {
			target = Target{ID: tid, CredentialID: c.ID, Model: model, Verdict: "untested", Rounds: []Round{}}
		}
		out.Targets = append(out.Targets, clone(target))
		// 切换检测模型后，旧依据仍保留在历史页。
		for oldModel, target := range r.Targets {
			if oldModel != model {
				out.Targets = append(out.Targets, clone(target))
			}
		}
	}
	// 凭证已删除时仍返回持久化目标与证据，但不会补造可用凭证。
	for id, record := range s.state.Records {
		if liveIDs[id] || record == nil {
			continue
		}
		for _, target := range record.Targets {
			out.Targets = append(out.Targets, clone(target))
		}
	}
	sort.Slice(out.Credentials, func(i, j int) bool { return out.Credentials[i].ID < out.Credentials[j].ID })
	sort.Slice(out.Targets, func(i, j int) bool { return out.Targets[i].ID < out.Targets[j].ID })
	return out, nil
}
func reconcile(c cpa.Credential, record *Record, settings Settings, _ string) (*string, Sync) {
	group := record.Group
	if settings.Routing.Mode == "prefix" {
		switch {
		case c.Prefix == settings.Prefixes.Downshift && c.Prefix != "":
			group = str("downshift")
		case c.Prefix == settings.Prefixes.Normal && (c.Prefix != "" || record.Group != nil):
			group = str("normal")
		default:
			group = nil
		}
	}
	result := clone(record.Sync)
	result.AppliedGroup = group
	if record.OriginalPrefix == nil || (record.Sync.DesiredGroup == nil && settings.Routing.Mode != "priority") {
		return group, result
	}
	desired := record.Sync.DesiredGroup
	values, override := routingValues(settings.Routing, c.ID, desired)
	expectedPrefix := *record.OriginalPrefix
	if settings.Routing.Mode == "prefix" && desired != nil {
		expectedPrefix = settings.Prefixes.Normal
		if *desired == "downshift" {
			expectedPrefix = settings.Prefixes.Downshift
		}
	}
	managesNumbers := settings.Routing.Mode == "priority" || override
	if (desired != nil && c.Prefix != expectedPrefix) || (managesNumbers && c.Priority != values.Priority) {
		result.Status = "failed"
		if result.Message == nil {
			result.Message = str("CPA 当前生效字段与插件预期不一致，请重试同步；页面展示实际生效值")
		}
	}
	return group, result
}
