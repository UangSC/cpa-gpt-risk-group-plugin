package classifier

import (
	"context"
	"math"
	"reflect"
	"strings"
	"time"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/fingerprint"
)

func validateSettings(v Settings) error {
	if v.Routing.Mode != "none" && v.Routing.Mode != "prefix" && v.Routing.Mode != "priority" {
		return bad("分组策略无效")
	}
	if v.InspectionMethod != "candy" && v.InspectionMethod != "fingerprint" && v.InspectionMethod != "pelican" {
		return bad("检测方式仅支持糖果题、模型指纹或画鹈鹕")
	}
	if v.InspectionMethod == "fingerprint" && !fingerprint.Available() {
		return bad("模型指纹参考库暂不可用")
	}
	if percent := v.FingerprintThresholdPercent; percent != nil {
		if *percent < 0 || *percent > 100 || *percent != math.Round(*percent*100)/100 {
			return bad("模型指纹判定阈值应为 0～100，可保留两位小数")
		}
	}
	if strings.TrimSpace(v.InspectionModel) == "" || len(v.InspectionModel) > 200 {
		return bad("检测模型无效")
	}
	if v.ReasoningEffort != "low" && v.ReasoningEffort != "medium" && v.ReasoningEffort != "high" {
		return bad("思考程度仅支持低 low、中 medium、高 high")
	}
	if v.Pagination.List < 1 || v.Pagination.List > 100 || v.Pagination.Card < 1 || v.Pagination.Card > 100 || v.Pagination.Pool < 1 || v.Pagination.Pool > 24 {
		return bad("分页数量无效：列表/卡片 1～100，双栏每栏 1～24")
	}
	if v.Pagination.Statistics < 1 || v.Pagination.Statistics > maxStatisticsPageSize {
		return bad("账号统计分页数量必须为 1～4")
	}
	if _, err := cpa.ValidateHeaderOverrides(v.HeaderOverrides); err != nil {
		return bad(err.Error())
	}
	if v.Retry.MaxRetries < 0 || v.Retry.MaxRetries > 4 || v.Retry.BaseDelayMs < 500 || v.Retry.BaseDelayMs > 5000 || math.IsNaN(v.Retry.BackoffFactor) || v.Retry.BackoffFactor < 1 || v.Retry.BackoffFactor > 3 {
		return bad("重试策略超出允许范围")
	}
	if v.FailureRule.WindowRounds < 2 || v.FailureRule.WindowRounds > 4 {
		return bad("失败判定轮数必须为 2～4")
	}
	if v.FailureRule.RequestThreshold < 2 || v.FailureRule.RequestThreshold > 5 {
		return bad("单轮频繁异常门槛必须为 2～5 次")
	}
	if v.Concurrency.MaxObjects < 1 || v.Concurrency.MaxObjects > 9 {
		return bad("并发必须为 1～9")
	}
	if v.Quota.MinRemainingPercent < 0 || v.Quota.MinRemainingPercent > 100 || math.IsNaN(v.Quota.MinRemainingPercent) || (v.Quota.UnknownPolicy != "check" && v.Quota.UnknownPolicy != "skip") {
		return bad("额度策略无效")
	}
	for _, group := range []string{"normal", "downshift", "ungrouped"} {
		values, ok := v.Routing.Groups[group]
		if !ok {
			return bad("分组默认值缺失")
		}
		if err := validateValues(values); err != nil {
			return err
		}
	}
	for _, values := range v.Routing.Overrides {
		if err := validateValues(values); err != nil {
			return err
		}
	}
	if v.Routing.Mode == "prefix" {
		a := strings.TrimRight(strings.TrimSpace(v.Prefixes.Normal), "/")
		b := strings.TrimRight(strings.TrimSpace(v.Prefixes.Downshift), "/")
		if a == b {
			return bad("正常与风控前缀不能相同")
		}
		for _, prefix := range []string{a, b} {
			if len(prefix) > 100 || strings.ContainsAny(prefix, " \t\r\n?#\\") {
				return bad("前缀包含不支持的字符")
			}
		}
	}
	if v.Layout != "list" && v.Layout != "card" && v.Layout != "pool" {
		return bad("布局无效")
	}
	if v.Theme != "light" && v.Theme != "dark" {
		return bad("主题无效")
	}
	return validateSchedule(v.Schedule)
}
func validateValues(v RoutingValues) error {
	if v.Priority < -9999 || v.Priority > 9999 || v.Weight < 0 || v.Weight > 9999 {
		return bad("优先级或权重超出允许范围")
	}
	return nil
}
func weightsChanged(a, b RoutingSettings) bool {
	for group, values := range b.Groups {
		if a.Groups[group].Weight != values.Weight {
			return true
		}
	}
	for id, values := range b.Overrides {
		old, exists := a.Overrides[id]
		if exists && old.Weight != values.Weight {
			return true
		}
	}
	return false
}
func (s *Service) SaveSettings(ctx context.Context, v Settings) error {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	if v.FingerprintThresholdPercent == nil {
		// 旧客户端保存其它设置时继续使用已保存的指纹阈值。
		s.mu.Lock()
		v.FingerprintThresholdPercent = s.state.Settings.FingerprintThresholdPercent
		s.mu.Unlock()
	}
	normalizeScheduleDefaults(&v.Schedule, v.Quota.MinRemainingPercent)
	if err := validateSettings(v); err != nil {
		return err
	}
	v.HeaderOverrides, _ = cpa.ValidateHeaderOverrides(v.HeaderOverrides)
	v.Prefixes.Normal = strings.TrimRight(strings.TrimSpace(v.Prefixes.Normal), "/")
	v.Prefixes.Downshift = strings.TrimRight(strings.TrimSpace(v.Prefixes.Downshift), "/")
	acknowledged := v.AcknowledgeScheduledConfigChanges
	v.AcknowledgeScheduledConfigChanges = false
	s.mu.Lock()
	old := clone(s.state.Settings)
	oldConsent, oldFingerprint, oldConsentRequired := s.state.ScheduledConfigChangesAcknowledged, s.state.ScheduledConfigurationFingerprint, s.state.ScheduleConsentRequired
	if configurationFingerprint(old, false) != configurationFingerprint(v, false) {
		for _, task := range s.state.Tasks {
			if task.Status == "running" {
				s.mu.Unlock()
				return &apiError{409, "巡检任务运行中，请等待完成后再修改检测或凭证写入配置"}
			}
		}
	}
	s.mu.Unlock()
	fingerprint := configurationFingerprint(v, true)
	if v.Schedule.Enabled && (!oldConsent || oldFingerprint != fingerprint) && !acknowledged {
		return &apiError{409, "请先确认定时巡检计划及当前分组处理策略"}
	}
	if weightsChanged(old.Routing, v.Routing) {
		return &apiError{409, "权重继承 CPA 当前值，插件不修改权重"}
	}
	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return err
	}
	ids := map[string]bool{}
	for _, c := range live {
		ids[c.ID] = true
		if values, ok := v.Routing.Overrides[c.ID]; ok {
			if _, existed := old.Routing.Overrides[c.ID]; !existed {
				values.Weight = c.Weight
				v.Routing.Overrides[c.ID] = values
			}
		}
	}
	for id := range v.Routing.Overrides {
		if !ids[id] {
			return bad("凭证覆盖引用了不存在的 Codex 凭证")
		}
	}
	if old.Schedule.Enabled != v.Schedule.Enabled || !reflect.DeepEqual(cloneSchedule(old.Schedule), cloneSchedule(v.Schedule)) {
		v.Schedule.NextRunAt = nextRun(v.Schedule, time.Now(), s.location)
	} else {
		v.Schedule.NextRunAt = old.Schedule.NextRunAt
	}
	s.mu.Lock()
	s.state.Settings = clone(v)
	if !v.Schedule.Enabled {
		s.state.ScheduledConfigChangesAcknowledged = false
		s.state.ScheduledConfigurationFingerprint = ""
		s.state.ScheduleConsentRequired = false
	} else {
		s.state.ScheduledConfigChangesAcknowledged = true
		s.state.ScheduledConfigurationFingerprint = fingerprint
		s.state.ScheduleConsentRequired = false
	}
	err = s.persistLocked()
	if err != nil {
		s.state.Settings = old
		s.state.ScheduledConfigChangesAcknowledged, s.state.ScheduledConfigurationFingerprint, s.state.ScheduleConsentRequired = oldConsent, oldFingerprint, oldConsentRequired
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	// 仅检测模式以及不相关的界面设置不触碰 CPA 凭证；仅写入模式或路由规则变化时同步。
	if v.Routing.Mode == "none" {
		return nil
	}
	routingChanged := !reflect.DeepEqual(old.Routing, v.Routing) || old.Prefixes != v.Prefixes
	if !routingChanged {
		return nil
	}
	var failures []string
	for _, c := range live {
		s.mu.Lock()
		r := s.recordLocked(c.ID)
		if excludedFromInspection(c, r, v) {
			s.mu.Unlock()
			continue
		}
		group := r.Group
		_, override := v.Routing.Overrides[c.ID]
		s.mu.Unlock()
		ungroupedChanged := old.Routing.Groups["ungrouped"] != v.Routing.Groups["ungrouped"]
		_, oldOverride := old.Routing.Overrides[c.ID]
		applyUngrouped := v.Routing.Mode == "priority" && (old.Routing.Mode != "priority" || ungroupedChanged)
		if group == nil && !override && !applyUngrouped && !oldOverride {
			continue
		}
		if _, err = s.apply(ctx, c.ID, group, v); err != nil {
			failures = append(failures, c.Name+"："+err.Error())
		}
	}
	if len(failures) > 0 {
		return &apiError{409, "设置已保存，部分凭证待同步：" + strings.Join(failures, "；")}
	}
	return nil
}
