package classifier

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync/atomic"
	"time"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/fingerprint"
)

func newInspectionRound(task Task, q StartRequest, targetID, startedAt, effort string) Round {
	round := Round{ID: identifier("round"), TaskID: task.ID, BatchStartedAt: task.CreatedAt, TargetID: targetID, StartedAt: startedAt, Scope: q.Scope, Tests: []string{q.Method}, Outcome: "uncertain", ReasonCode: "no-model-response", Reason: "未取得有效回答", ReasoningEffort: effort, Evidence: Evidence{Tests: []string{q.Method}, Attempts: []Attempt{}, Errors: []EvidenceError{}, Usage: &Usage{}}}
	if q.Method == "fingerprint" {
		round.ReasonCode = "fingerprint-insufficient"
		round.Reason = "尚未取得三次有效数字回答，不能计算模型指纹概率"
		round.Evidence.Fingerprint = &Fingerprint{ChallengeCount: fingerprint.ChallengeCount, Consistency: "insufficient", Samples: []FingerprintSample{}, Threshold: fingerprint.ConfidenceThreshold, Candidates: []fingerprint.Candidate{}, ReferenceBank: fingerprint.ReferenceInfo(), Decision: "partial"}
	}
	return round
}

// executeRound shares one extra-retry budget across all challenges. Successful
// challenges are never replayed, and attribution runs once after three valid samples.
func (s *Service) executeRound(ctx context.Context, cancel context.CancelFunc, task Task, q StartRequest, c cpa.Credential, settings Settings, connectionFailures *atomic.Int32, round *Round) []int {
	challenges := []fingerprint.Challenge{{ID: "candy-bag-21", Question: CandyQuestion, Instructions: cpa.DefaultProbeInstructions}}
	if q.Method == "fingerprint" {
		challenges = fingerprint.Challenges()
		if len(challenges) != fingerprint.ChallengeCount {
			round.Reason = "模型指纹参考库不可用，未发起检测"
			return nil
		}
	}
	var codes []int
	var samples [][]int
	retries, requests := 0, 0
	minimumDelay := int64(0)
challengeLoop:
	for challengeIndex, challenge := range challenges {
		retrying := false
		for {
			if ctx.Err() != nil || s.inspectionExcluded(c.ID) {
				break challengeLoop
			}
			delay := 0
			if retrying {
				delay = int(float64(settings.Retry.BaseDelayMs) * math.Pow(settings.Retry.BackoffFactor, float64(retries-1)))
				if int64(delay) < minimumDelay {
					delay = int(minimumDelay)
				}
				if delay > maxRetryWaitMs {
					delay = maxRetryWaitMs
				}
				retryAt := time.Now().Add(time.Duration(delay) * time.Millisecond).UTC().Format(time.RFC3339Nano)
				s.patchItem(task.ID, round.TargetID, func(item *RunItem) {
					item.State = "retrying"
					item.Note = str(fmt.Sprintf("第 %d/%d 题，本轮第 %d/%d 次重试，等待 %.1f 秒", challengeIndex+1, len(challenges), retries, settings.Retry.MaxRetries, float64(delay)/1000))
					item.RetryAt = &retryAt
				})
				if wait(ctx, time.Duration(delay)*time.Millisecond) != nil {
					break challengeLoop
				}
			}
			if ctx.Err() != nil || s.inspectionExcluded(c.ID) {
				break challengeLoop
			}
			requests++
			s.patchItem(task.ID, round.TargetID, func(item *RunItem) {
				item.State = "running"
				item.Attempt = requests
				item.RetryAt = nil
				if q.Method == "fingerprint" {
					item.Note = str(fmt.Sprintf("模型指纹第 %d/%d 次采样", challengeIndex+1, fingerprint.ChallengeCount))
				} else {
					item.Note = nil
				}
			})
			at, requestStart := stamp(), time.Now()
			reply, err := s.adapter.Probe(ctx, c.ID, q.Model, challenge.Question, challenge.Instructions, settings.ReasoningEffort, settings.HeaderOverrides)
			finishedAt := stamp()
			if ctx.Err() != nil {
				break challengeLoop
			}
			status := any(reply.Status)
			valid := err == nil && reply.Status >= 200 && reply.Status < 300 && strings.TrimSpace(reply.Answer) != ""
			var numbers []int
			var sampleError error
			if valid && q.Method == "fingerprint" {
				numbers, sampleError = fingerprint.ParseSample(reply.Answer, challenge.ExpectedCount)
				valid = sampleError == nil
				if numbers == nil {
					numbers = []int{}
				}
				round.Evidence.Fingerprint.Samples = append(round.Evidence.Fingerprint.Samples, FingerprintSample{ChallengeID: challenge.ID, PromptSummary: fmt.Sprintf("数字挑战 %s · 预期 %d 个整数", challenge.ID, challenge.ExpectedCount), Question: challenge.Question, Instructions: challenge.Instructions, ExpectedCount: challenge.ExpectedCount, Numbers: numbers, Accepted: valid, Sample: truncateAnswer(reply.Answer)})
			}
			if err != nil {
				status = "network-error"
				connectionFailures.Add(1)
			} else {
				connectionFailures.Store(0)
			}
			duration := reply.DurationMs
			if duration == 0 {
				duration = time.Since(requestStart).Milliseconds()
			}
			round.Evidence.Attempts = append(round.Evidence.Attempts, Attempt{Index: requests, Status: status, At: at, WaitMs: delay, DurationMs: duration, Test: q.Method, ChallengeIndex: challengeIndex + 1, RetryIndex: retries, ValidResponse: valid, FinishedAt: finishedAt, LocalState: reply.LocalState})
			s.patchItem(task.ID, round.TargetID, func(item *RunItem) { item.LastStatus = status })
			round.Evidence.Usage.InputTokens += reply.InputTokens
			round.Evidence.Usage.OutputTokens += reply.OutputTokens
			if err != nil || !valid {
				message := reply.Error
				if err != nil {
					message = err.Error()
				} else if sampleError != nil {
					message = sampleError.Error()
				}
				if message == "" {
					message = "未返回有效模型回答"
				}
				if len(message) > 1000 {
					message = message[:1000]
				}
				round.Evidence.Errors = append(round.Evidence.Errors, EvidenceError{at, reply.Status, message})
			}
			if err != nil && connectionFailures.Load() >= 3 {
				round.Reason = "连续三次无法连接 CPA，自动停止巡检与定时计划"
				cancel()
				break challengeLoop
			}
			if err == nil && (reply.Status == 401 || reply.Status == 403) {
				round.Outcome, round.ReasonCode, round.Reason = "blocked", "auth-expired", "凭证认证失效，未形成能力判定"
				break challengeLoop
			}
			if err == nil && reply.LocalState && reply.Status == 429 {
				if len(codes) == 0 {
					round.Outcome, round.ReasonCode, round.Reason = "blocked", "quota-exhausted", "CPA 当前处于冷却或不可用，未发送上游请求"
				} else {
					round.Reason = "CPA 官方冷却尚未结束，保留本轮真实HTTP异常并停止重试"
				}
				break challengeLoop
			}
			if err == nil && !reply.LocalState && isTransientHTTPStatus(reply.Status) {
				codes = append(codes, reply.Status)
				if len(codes) >= settings.FailureRule.RequestThreshold {
					markFrequentServiceErrors(round, codes, settings)
					break challengeLoop
				}
			}
			if valid {
				if q.Method == "candy" {
					answer := truncateAnswer(reply.Answer)
					preview := compactAnswerPreview(answer)
					matched := MatchesCandy(answer)
					round.Evidence.Candy = &Candy{"candy-bag-21", CandyQuestion, "21", answer, matched, "接受含独立数字 21 的回答；子串和小数不计入。"}
					if matched {
						round.Outcome, round.ReasonCode, round.Reason = "normal", "all-tests-passed", fmt.Sprintf("糖果题答案正确：%s", preview)
						if retries > 0 {
							round.ReasonCode, round.Reason = "passed-after-retry", fmt.Sprintf("重试后通过，糖果题答案正确：%s", preview)
						}
					} else {
						round.Outcome, round.ReasonCode, round.Reason = "downshift", "candy-mismatch", fmt.Sprintf("糖果题答案不正确：%s", preview)
					}
					break challengeLoop
				}
				samples = append(samples, numbers)
				round.Evidence.Fingerprint.ValidSamples = len(samples)
				break
			}
			// 真实429与502/503共用有限重试；本地守卫、认证和其它4xx不重试。
			if (err == nil && (reply.LocalState || reply.Status >= 400 && reply.Status < 500 && reply.Status != 429)) || retries >= settings.Retry.MaxRetries {
				if err == nil && reply.Status >= 400 && reply.Status < 500 && reply.Status != 429 {
					round.Reason = "CPA 拒绝请求，未形成能力判定"
				}
				break challengeLoop
			}
			minimumDelay = reply.RetryAfterMs
			if minimumDelay > maxRetryWaitMs {
				round.Evidence.Errors = append(round.Evidence.Errors, EvidenceError{finishedAt, reply.Status, fmt.Sprintf("CPA 官方冷却或上游要求至少等待 %.1f 秒，超过单次120秒等待上限，停止重试以免提前再次请求", float64(minimumDelay)/1000)})
				break challengeLoop
			}
			retries++
			retrying = true
		}
	}
	if q.Method == "fingerprint" && ctx.Err() == nil && len(samples) == fingerprint.ChallengeCount {
		result, err := fingerprint.Detect(samples, q.Model)
		if err != nil {
			round.Reason = "模型指纹归因失败，未形成判定"
			round.Evidence.Errors = append(round.Evidence.Errors, EvidenceError{stamp(), 0, err.Error()})
		} else {
			applyFingerprintResult(round, result, retries > 0)
		}
	}
	return codes
}

func truncateAnswer(answer string) string {
	if len(answer) > 32768 {
		return answer[:32768]
	}
	return answer
}

func compactAnswerPreview(answer string) string {
	compact := strings.Join(strings.Fields(answer), " ")
	if compact == "" {
		return "（空回答）"
	}
	runes := []rune(compact)
	if len(runes) > 64 {
		return string(runes[:63]) + "…"
	}
	return compact
}
