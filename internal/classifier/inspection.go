package classifier

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync/atomic"
	"time"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
)

func quotaReason(c cpa.Credential, v Settings, scope string) string {
	if c.Disabled || c.Auth == "expired" {
		return "凭证被禁用或认证失效"
	}
	if isFreePlan(c.Plan) && !v.InspectFreeAccounts {
		return "Free 账号默认不参与巡检，可在设置中开启强制巡检"
	}
	if c.Unavailable {
		return "CPA 当前报告此凭证不可用或处于冷却，按真实状态跳过"
	}
	known := false
	minimum := 100.0
	for _, window := range c.Quota.Windows {
		if window.RemainingPercent != nil {
			known = true
			minimum = math.Min(minimum, *window.RemainingPercent)
		}
	}
	if c.Quota.Status == "exhausted" {
		return "额度已耗尽"
	}
	minRemaining := v.Quota.MinRemainingPercent
	if scope == "scheduled" && v.Schedule.MinRemainingPercent != nil {
		minRemaining = *v.Schedule.MinRemainingPercent
	}
	if known && minimum <= minRemaining {
		if scope == "scheduled" {
			return fmt.Sprintf("定时巡检额度门槛：剩余额度 %.1f%% 未高于 %.1f%% 门槛", minimum, minRemaining)
		}
		return fmt.Sprintf("剩余额度 %.1f%% 未高于 %.1f%% 门槛", minimum, minRemaining)
	}
	if !known && v.Quota.UnknownPolicy == "skip" {
		return "额度未知，按设置跳过"
	}
	return ""
}
func supportsModel(c cpa.Credential, model string) bool {
	if len(c.Models) == 0 {
		return false
	}
	for _, m := range c.Models {
		if m == model || strings.TrimPrefix(m, strings.Trim(c.Prefix, "/")+"/") == model {
			return true
		}
	}
	return false
}
func wait(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func (s *Service) inspect(ctx context.Context, cancel context.CancelFunc, task Task, q StartRequest, c cpa.Credential, v Settings, connectionFailures *atomic.Int32) {
	tid := targetID(c.ID, q.Model)
	skip := func(message string) {
		s.patchItem(task.ID, tid, func(i *RunItem) {
			now := stamp()
			i.State = "skipped"
			i.Note = str(message)
			i.FinishedAt = &now
			i.RetryAt = nil
			i.CurrentTest = nil
		})
	}
	// 开始执行前刷新官方状态，不能仅使用入队时的额度与认证状态。
	waitingSince := time.Now()
	for {
		if s.inspectionExcluded(c.ID) {
			skip("该凭证不参与巡检，本轮已跳过")
			return
		}
		live, err := s.adapter.ListCredentials(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			if connectionFailures.Add(1) >= 3 {
				cancel()
			}
			s.patchItem(task.ID, tid, func(i *RunItem) { i.State = "failed"; i.Note = str("读取 CPA 状态失败：" + err.Error()) })
			return
		}
		exists := false
		for _, fresh := range live {
			if fresh.ID == c.ID {
				c = fresh
				exists = true
				break
			}
		}
		if !exists {
			skip("凭证已从 CPA 移除")
			return
		}
		if reason := quotaReason(c, v, q.Scope); reason != "" {
			skip(reason)
			return
		}
		if !supportsModel(c, q.Model) {
			skip("该凭证未注册所选检测模型")
			return
		}
		if q.Scope == "scheduled" {
			policy := v.Schedule.BusySessionPolicy
			if policy == "" {
				policy = "under-limit"
			}
			limit := v.Schedule.MaxBusySessions
			if limit <= 0 {
				limit = 3
			}
			busyCount := c.BusySessions
			if c.Availability == "busy" && busyCount <= 0 {
				busyCount = 1
			}
			switch policy {
			case "always":
				// 始终巡检：无论是否存在活跃会话都继续执行
			case "skip-busy":
				if c.Availability == "busy" || busyCount > 0 {
					skip("定时巡检策略：凭证当前存在活跃会话，本次跳过")
					return
				}
			default:
				if busyCount >= limit {
					skip(fmt.Sprintf("定时巡检策略：当前并发会话 %d 个（不低于阈值 %d），本次跳过", busyCount, limit))
					return
				}
			}
			break
		}
		if c.Availability != "busy" {
			break
		}
		if time.Since(waitingSince) > 5*time.Minute {
			skip("凭证持续忙碌，超过五分钟等待上限")
			return
		}
		s.patchItem(task.ID, tid, func(i *RunItem) { i.State = "waiting"; i.Note = str("等待 CPA 官方状态报告凭证空闲") })
		if wait(ctx, 2*time.Second) != nil {
			return
		}
	}
	start := stamp()
	if s.inspectionExcluded(c.ID) {
		skip("该凭证不参与巡检，本轮已跳过")
		return
	}
	s.patchItem(task.ID, tid, func(i *RunItem) { i.State = "running"; i.StartedAt = &start; i.CurrentTest = &q.Method; i.Note = nil })
	round := newInspectionRound(task, q, tid, start, v)
	codes := s.executeRound(ctx, cancel, task, q, c, v, connectionFailures, &round)
	if ctx.Err() == nil && len(codes) > 0 && resolveMethodSpec(q.Method).countsTransientServiceError {
		s.mu.Lock()
		previous := s.recordLocked(c.ID).Targets[q.Model].Rounds
		s.mu.Unlock()
		applyServiceErrorRule(&round, codes, previous, v)
	}
	round.FinishedAt = stamp()
	round.Evidence.DurationMs = time.Since(mustTime(start)).Milliseconds()
	s.commitRound(ctx, task, q, c, round, v)
}
func mustTime(v string) time.Time { t, _ := time.Parse(time.RFC3339Nano, v); return t }
func (s *Service) commitRound(ctx context.Context, task Task, q StartRequest, c cpa.Credential, round Round, settings Settings) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	round.TaskID, round.BatchStartedAt = task.ID, task.CreatedAt
	if s.inspectionExcluded(c.ID) {
		s.patchItem(task.ID, round.TargetID, func(item *RunItem) {
			item.State = "skipped"
			item.Note = str("该凭证不参与巡检，未提交判定或写入配置")
			item.FinishedAt = &round.FinishedAt
			item.CurrentTest = nil
			item.RetryAt = nil
		})
		return
	}
	if ctx.Err() != nil {
		round.Outcome = "cancelled"
		round.ReasonCode = "cancelled"
		round.Reason = "任务已停止，本轮未提交判定或分组"
	}
	if round.Outcome == "normal" || round.Outcome == "downshift" {
		if ctx.Err() == nil {
			if settings.Routing.Mode == "none" {
				round.Sync = &Sync{Mode: "none", Status: "not-needed"}
			} else {
				syncRecord, _ := s.apply(ctx, c.ID, str(round.Outcome), settings)
				round.Sync = &syncRecord
			}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.recordLocked(c.ID)
	if round.Sync != nil && round.Sync.Mode == "none" {
		round.Sync.AppliedGroup = r.Group
	}
	target := r.Targets[q.Model]
	if target.ID == "" {
		target = Target{ID: targetID(c.ID, q.Model), CredentialID: c.ID, Model: q.Model, Verdict: "untested"}
	}
	if round.Outcome == "normal" || round.Outcome == "downshift" || round.Outcome == "uncertain" {
		target.Verdict = round.Outcome
		target.Blocked = nil
	} else if round.Outcome == "blocked" {
		kind := "auth"
		if round.ReasonCode == "quota-exhausted" {
			kind = "quota"
		}
		target.Blocked = &Blocked{kind, round.Reason}
	}
	target.Rounds = append([]Round{round}, target.Rounds...)
	if len(target.Rounds) > 40 {
		target.Rounds = target.Rounds[:40]
	}
	pruneTargetPelicanSVGs(target.Rounds)
	r.Targets[q.Model] = target
	var currentItem *RunItem
	for i := range s.state.Tasks {
		t := &s.state.Tasks[i]
		if t.ID != task.ID {
			continue
		}
		for j := range t.Items {
			item := &t.Items[j]
			if item.TargetID != target.ID {
				continue
			}
			currentItem = item
			item.State = "done"
			item.Note = nil
			if round.Outcome == "cancelled" {
				item.State = "cancelled"
				item.Note = &round.Reason
			}
			if round.Sync != nil && round.Sync.Status == "failed" {
				item.Note = round.Sync.Message
			}
			item.FinishedAt = &round.FinishedAt
			item.CurrentTest = nil
			item.RetryAt = nil
			break
		}
		break
	}
	if err := s.persistLocked(); err != nil && currentItem != nil {
		currentItem.State = "failed"
		currentItem.Note = str("证据持久化失败：" + err.Error())
	}
}
