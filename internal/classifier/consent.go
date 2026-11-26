package classifier

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/fingerprint"
)

// 配置指纹排除界面偏好、继承权重和运行时 nextRunAt，只绑定可能影响巡检写入的规则。
func configurationFingerprint(settings Settings, includeSchedule bool) string {
	return fingerprintWithReasoning(settings, includeSchedule, true, true)
}

// 旧版固定使用 low。只有旧授权与旧规则精确匹配时，才能继承该授权。
func legacyConfigurationFingerprint(settings Settings, includeSchedule bool) string {
	return fingerprintWithReasoning(settings, includeSchedule, false, false)
}

func fingerprintWithReasoning(settings Settings, includeSchedule, includeReasoning, includeHeaders bool) string {
	groups := map[string]int{}
	overrides := map[string]int{}
	for key, value := range settings.Routing.Groups {
		groups[key] = value.Priority
	}
	for key, value := range settings.Routing.Overrides {
		overrides[key] = value.Priority
	}
	data := map[string]any{"mode": settings.Routing.Mode, "prefixes": settings.Prefixes, "groups": groups, "overrides": overrides, "method": settings.InspectionMethod, "model": settings.InspectionModel, "retry": settings.Retry, "failure": settings.FailureRule, "quota": settings.Quota, "concurrency": settings.Concurrency}
	data["transientErrorPolicy"] = "real-http-502-503-429/attempt-threshold-and-host-cooldown-v2"
	if settings.InspectFreeAccounts {
		data["inspectFreeAccounts"] = true
	}
	if settings.InspectionMethod == "fingerprint" {
		data["fingerprintPolicy"] = fingerprint.PolicyID()
		data["fingerprintThreshold"] = settings.fingerprintThreshold()
		data["fingerprintChallenges"] = fingerprint.ChallengeCount
	}
	if settings.InspectionMethod == "pelican" {
		data["pelicanPolicy"] = pelicanPolicyID
	}
	if settings.InspectionMethod == "candy" {
		data["candyQuestion"] = CandyQuestion
		data["candyExpectedAnswer"] = candyExpectedAnswer
	}
	if includeReasoning {
		data["reasoningEffort"] = settings.ReasoningEffort
	}
	if includeHeaders {
		data["headerOverrides"] = settings.HeaderOverrides
		data["defaultHeaderPolicy"] = "cpa-core-codex-cli"
	}
	if includeSchedule {
		data["schedule"] = cloneSchedule(settings.Schedule)
	}
	raw, _ := json.Marshal(data)
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}
func (s *Service) ConfigChangesRevision() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return configurationFingerprint(s.state.Settings, false)
}
