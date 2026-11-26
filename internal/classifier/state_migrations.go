package classifier

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
)

const stateVersion = 9

// loadState 在调度器启动前读取历史状态，迁移失败时保留磁盘上的原文件。
func (s *Service) loadState() error {
	raw, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var persisted diskState
	persisted.Settings.Pagination.Statistics = maxStatisticsPageSize
	if err := json.Unmarshal(raw, &persisted); err != nil {
		return fmt.Errorf("状态文件无法解析，已保留原文件：%w", err)
	}
	if (persisted.Version < 1 || persisted.Version > stateVersion) || persisted.Records == nil {
		return errors.New("状态文件版本或记录结构不受支持")
	}
	upgradingHeaderProfile := persisted.Version < 6
	upgradingErrorPolicy := persisted.Version < 8
	if upgradingErrorPolicy {
		if persisted.Settings.FailureRule.RequestThreshold == 0 {
			persisted.Settings.FailureRule.RequestThreshold = DefaultSettings().FailureRule.RequestThreshold
		}
		if persisted.Settings.Retry.BaseDelayMs == 2000 && persisted.Settings.Retry.MaxRetries == 2 && persisted.Settings.Retry.BackoffFactor == 2 {
			persisted.Settings.Retry.BaseDelayMs = DefaultSettings().Retry.BaseDelayMs
		}
		if persisted.Settings.Concurrency.MaxObjects == 3 {
			persisted.Settings.Concurrency.MaxObjects = DefaultSettings().Concurrency.MaxObjects
		}
	}
	if persisted.Version < 5 && persisted.Settings.ReasoningEffort == "" {
		persisted.Settings.ReasoningEffort = "low"
	}
	if persisted.Version < 6 {
		defaults := DefaultSettings()
		if persisted.Settings.HeaderOverrides == nil {
			persisted.Settings.HeaderOverrides = map[string]string{}
		}
		if persisted.Settings.Pagination.List == 0 {
			persisted.Settings.Pagination.List = defaults.Pagination.List
		}
		if persisted.Settings.Pagination.Card == 0 {
			persisted.Settings.Pagination.Card = defaults.Pagination.Card
		}
		if persisted.Settings.Pagination.Pool == 0 {
			persisted.Settings.Pagination.Pool = defaults.Pagination.Pool
		}
	}
	if persisted.Settings.Routing.Mode == "" {
		persisted.Settings.Routing.Mode = "none"
	}
	if persisted.Settings.FingerprintThresholdPercent == nil {
		percent := defaultFingerprintThresholdPercent
		persisted.Settings.FingerprintThresholdPercent = &percent
	}
	normalizeScheduleDefaults(&persisted.Settings.Schedule, persisted.Settings.Quota.MinRemainingPercent)
	if err := validateSettings(persisted.Settings); err != nil {
		return fmt.Errorf("持久化设置无效：%w", err)
	}
	persisted.Settings.HeaderOverrides, _ = cpa.ValidateHeaderOverrides(persisted.Settings.HeaderOverrides)
	if persisted.Version < 3 {
		// 只升级旧版未自定义的优先级，历史权重元数据完全保留且不写入 CPA。
		if legacyDefaultPriorities(persisted.Settings.Routing) {
			for group, defaults := range DefaultSettings().Routing.Groups {
				values := persisted.Settings.Routing.Groups[group]
				values.Priority = defaults.Priority
				persisted.Settings.Routing.Groups[group] = values
			}
		}
		persisted.Version = 3
	}
	if persisted.Version < 4 {
		if persisted.Settings.Schedule.Enabled {
			persisted.Settings.Schedule.Enabled = false
			persisted.Settings.Schedule.NextRunAt = nil
			persisted.ScheduleConsentRequired = true
		}
		persisted.ScheduledConfigChangesAcknowledged = false
		persisted.ScheduledConfigurationFingerprint = ""
		persisted.Version = 4
	}
	if persisted.Version < 5 {
		if persisted.Settings.ReasoningEffort == "low" && persisted.ScheduledConfigChangesAcknowledged &&
			persisted.ScheduledConfigurationFingerprint == legacyConfigurationFingerprint(persisted.Settings, true) {
			persisted.ScheduledConfigurationFingerprint = configurationFingerprint(persisted.Settings, true)
		}
		persisted.Version = 5
	}
	if persisted.Version < 6 {
		// 新的 CLI 默认头影响请求身份，未针对当前配置授权的旧计划由下方检查关闭。
		persisted.Version = 6
	}
	if upgradingHeaderProfile && persisted.Settings.Schedule.Enabled {
		persisted.Settings.Schedule.Enabled = false
		persisted.Settings.Schedule.NextRunAt = nil
		persisted.ScheduledConfigChangesAcknowledged = false
		persisted.ScheduledConfigurationFingerprint = ""
		persisted.ScheduleConsentRequired = true
	}
	if persisted.Version < 7 {
		// 旧版只开放糖果任务；添加批次关联不改变题目、判定或既有计划授权。
		for i := range persisted.Tasks {
			if persisted.Tasks[i].Method == "" {
				persisted.Tasks[i].Method = "candy"
			}
		}
		linkHistoricalRounds(&persisted)
		persisted.Version = 7
	}
	if upgradingErrorPolicy {
		// 频繁429现在参与风控；旧计划未授权新的请求重试与写入规则。
		if persisted.Settings.Schedule.Enabled {
			persisted.Settings.Schedule.Enabled = false
			persisted.Settings.Schedule.NextRunAt = nil
			persisted.ScheduleConsentRequired = true
		}
		persisted.ScheduledConfigChangesAcknowledged = false
		persisted.ScheduledConfigurationFingerprint = ""
		persisted.Version = 8
	}
	if persisted.Version < 9 {
		restoreLegacyFingerprintThresholds(persisted.Records)
		persisted.Version = 9
	}
	persisted.Settings.AcknowledgeScheduledConfigChanges = false
	s.state = persisted
	return nil
}

// 旧版指纹巡检使用固定阈值。只为缺少阈值的轮次补全旧规则。
func restoreLegacyFingerprintThresholds(records map[string]*Record) {
	for _, record := range records {
		if record == nil {
			continue
		}
		for _, target := range record.Targets {
			for _, round := range target.Rounds {
				if evidence := round.Evidence.Fingerprint; evidence != nil && evidence.Threshold == 0 {
					evidence.Threshold = defaultFingerprintThresholdPercent / 100
				}
			}
		}
	}
}

func legacyDefaultPriorities(routing RoutingSettings) bool {
	if len(routing.Groups) != 3 {
		return false
	}
	for _, group := range []string{"normal", "downshift", "ungrouped"} {
		if values, ok := routing.Groups[group]; !ok || values.Priority != 0 {
			return false
		}
	}
	for _, values := range routing.Overrides {
		if values.Priority != 0 {
			return false
		}
	}
	return true
}
