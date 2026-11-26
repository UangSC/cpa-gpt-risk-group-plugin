package classifier

import (
	"fmt"
	"strconv"
	"strings"
)

const maxRetryWaitMs = 120000

func isTransientHTTPStatus(status int) bool {
	return status == 502 || status == 503 || status == 429
}

func attemptHTTPStatus(status any) (int, bool) {
	switch code := status.(type) {
	case int:
		return code, true
	case float64:
		if code == float64(int(code)) {
			return int(code), true
		}
	}
	return 0, false
}

func formatHTTPStatusSequence(codes []int) string {
	if len(codes) == 0 {
		return ""
	}
	if len(codes) == 1 {
		return fmt.Sprintf("HTTP %d", codes[0])
	}
	allSame := true
	for _, code := range codes[1:] {
		if code != codes[0] {
			allSame = false
			break
		}
	}
	if allSame {
		return fmt.Sprintf("HTTP %d ×%d", codes[0], len(codes))
	}
	parts := make([]string, len(codes))
	for i, code := range codes {
		parts[i] = strconv.Itoa(code)
	}
	return "HTTP " + strings.Join(parts, "/")
}

type attemptErrorSummary struct {
	httpCodes     []int
	networkErrors int
	has200Invalid bool
}

func summarizeAttemptErrors(attempts []Attempt) attemptErrorSummary {
	var summary attemptErrorSummary
	var targets []Attempt
	for _, attempt := range attempts {
		if !attempt.LocalState {
			targets = append(targets, attempt)
		}
	}
	if len(targets) == 0 {
		targets = attempts
	}
	for _, attempt := range targets {
		if code, ok := attemptHTTPStatus(attempt.Status); ok {
			if code >= 200 && code < 300 {
				if !attempt.ValidResponse {
					summary.has200Invalid = true
				}
			} else if code > 0 {
				summary.httpCodes = append(summary.httpCodes, code)
			}
			continue
		}
		if attempt.Status == "network-error" {
			summary.networkErrors++
		}
	}
	return summary
}

func newServiceErrorEvidence(codes []int, settings Settings) *ServiceErrors {
	return &ServiceErrors{Codes: append([]int(nil), codes...), WindowSize: settings.FailureRule.WindowRounds, ErrorAttempts: len(codes), RequestThreshold: settings.FailureRule.RequestThreshold}
}

// 达到单轮真实HTTP异常门槛即结束，不继续请求第四次来覆盖频繁失败。
func markFrequentServiceErrors(round *Round, codes []int, settings Settings) {
	round.Evidence.ServiceError = newServiceErrorEvidence(codes, settings)
	round.Evidence.ServiceError.ErrorRoundsInWindow = 1
	round.Evidence.ServiceError.Trigger = "attempts"
	round.Outcome, round.ReasonCode = "downshift", "repeated-service-errors"
	round.Reason = fmt.Sprintf("本轮累计 %d 次服务异常（%s），达到 %d 次频繁异常门槛", len(codes), formatHTTPStatusSequence(codes), settings.FailureRule.RequestThreshold)
}

func applyServiceErrorRule(round *Round, codes []int, previous []Round, settings Settings) {
	if len(codes) == 0 {
		return
	}
	if len(codes) >= settings.FailureRule.RequestThreshold && round.Outcome != "blocked" && round.Outcome != "cancelled" {
		markFrequentServiceErrors(round, codes, settings)
		return
	}
	round.Evidence.ServiceError = newServiceErrorEvidence(codes, settings)
	// 完整回答的行为结论、认证、本地额度守卫和取消不参与跨轮异常累计。
	if round.Outcome != "uncertain" {
		return
	}
	count := 1
	for _, old := range previous {
		if !failedServiceErrorRound(old) {
			break
		}
		count++
		if count >= settings.FailureRule.WindowRounds {
			break
		}
	}
	round.Evidence.ServiceError.ErrorRoundsInWindow = count
	summary := summarizeAttemptErrors(round.Evidence.Attempts)
	reasonCodes := formatHTTPStatusSequence(codes)
	if len(summary.httpCodes) > len(codes) {
		reasonCodes = formatHTTPStatusSequence(summary.httpCodes)
	}
	round.ReasonCode = "single-service-error"
	round.Reason = fmt.Sprintf("本轮出现 %d 次服务异常（%s），未达到单轮或连续失败轮次门槛，保持当前分组", len(codes), reasonCodes)
	if count >= settings.FailureRule.WindowRounds {
		round.Evidence.ServiceError.Trigger = "rounds"
		round.Outcome, round.ReasonCode = "downshift", "repeated-service-errors"
		round.Reason = fmt.Sprintf("连续 %d 轮未完成检测并出现服务异常（%s），达到重复失败门槛", count, reasonCodes)
	}
}

func failedServiceErrorRound(round Round) bool {
	if round.Outcome != "uncertain" && round.Outcome != "downshift" {
		return false
	}
	if round.ReasonCode != "single-service-error" && round.ReasonCode != "repeated-service-errors" {
		return false
	}
	for _, attempt := range round.Evidence.Attempts {
		if attempt.LocalState {
			continue
		}
		if code, ok := attemptHTTPStatus(attempt.Status); ok && isTransientHTTPStatus(code) {
			return true
		}
	}
	return false
}
