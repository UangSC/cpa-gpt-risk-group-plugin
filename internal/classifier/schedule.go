package classifier

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"time"
)

func cloneSchedule(s Schedule) Schedule { s.NextRunAt = nil; return s }
func normalizeScheduleDefaults(s *Schedule, fallbackMinRemaining float64) {
	if s.BusySessionPolicy == "" {
		s.BusySessionPolicy = "under-limit"
	}
	if s.MaxBusySessions == 0 {
		s.MaxBusySessions = 3
	}
	if s.MinRemainingPercent == nil {
		value := fallbackMinRemaining
		s.MinRemainingPercent = &value
	}
}
func validateSchedule(s Schedule) error {
	if s.Mode != "interval" && s.Mode != "daily" && s.Mode != "windows" {
		return bad("定时模式无效")
	}
	if s.IntervalMinutes < 5 || s.IntervalMinutes > 10080 {
		return bad("巡检间隔必须为 5 分钟～7 天")
	}
	if _, err := time.Parse("15:04", s.DailyTime); err != nil {
		return bad("每日时间无效")
	}
	if s.MinRemainingPercent != nil && (math.IsNaN(*s.MinRemainingPercent) || math.IsInf(*s.MinRemainingPercent, 0) || *s.MinRemainingPercent < 0 || *s.MinRemainingPercent > 100) {
		return bad("定时巡检额度门槛必须为 0～100")
	}
	if s.BusySessionPolicy != "" && s.BusySessionPolicy != "always" && s.BusySessionPolicy != "under-limit" && s.BusySessionPolicy != "skip-busy" {
		return bad("定时巡检活跃会话处理策略无效")
	}
	policy := s.BusySessionPolicy
	if policy == "" {
		policy = "under-limit"
	}
	if policy == "under-limit" && s.MaxBusySessions != 0 && (s.MaxBusySessions < 1 || s.MaxBusySessions > 99) {
		return bad("并发会话上限必须为 1～99 的整数")
	}
	if !s.Enabled {
		return nil
	}
	if policy == "under-limit" && (s.MaxBusySessions < 1 || s.MaxBusySessions > 99) {
		return bad("并发会话上限必须为 1～99 的整数")
	}
	if s.Mode != "windows" {
		return nil
	}
	windows := append([]TimeWindow{}, s.Windows...)
	sort.Slice(windows, func(i, j int) bool { return windows[i].StartMinute < windows[j].StartMinute })
	if len(windows) == 0 {
		return bad("至少需要一个巡检时间段")
	}
	seen := map[string]bool{}
	for i, w := range windows {
		if w.ID == "" || seen[w.ID] {
			return bad("时间段 ID 缺失或重复")
		}
		seen[w.ID] = true
		if w.StartMinute < 0 || w.EndMinute > 1440 || w.EndMinute-w.StartMinute < 15 {
			return bad("时间段至少 15 分钟，范围 00:00～24:00")
		}
		if i > 0 && w.StartMinute < windows[i-1].EndMinute {
			return bad("时间段不能重叠")
		}
	}
	return nil
}
func nextRun(s Schedule, from time.Time, loc *time.Location) *string {
	if !s.Enabled || validateSchedule(s) != nil {
		return nil
	}
	from = from.In(loc)
	if s.Mode == "interval" {
		return str(from.Add(time.Duration(s.IntervalMinutes) * time.Minute).UTC().Format(time.RFC3339Nano))
	}
	if s.Mode == "daily" {
		var hour, minute int
		_, _ = fmt.Sscanf(s.DailyTime, "%d:%d", &hour, &minute)
		next := time.Date(from.Year(), from.Month(), from.Day(), hour, minute, 0, 0, loc)
		if !next.After(from) {
			next = next.AddDate(0, 0, 1)
		}
		return str(next.UTC().Format(time.RFC3339Nano))
	}
	var best time.Time
	for day := 0; day < 3; day++ {
		base := time.Date(from.Year(), from.Month(), from.Day()+day, 0, 0, 0, 0, loc)
		for _, w := range s.Windows {
			start := base.Add(time.Duration(w.StartMinute) * time.Minute)
			end := base.Add(time.Duration(w.EndMinute) * time.Minute)
			at := start
			interval := time.Duration(s.IntervalMinutes) * time.Minute
			if !at.After(from) {
				at = at.Add((from.Sub(at)/interval + 1) * interval)
			}
			if at.Before(end) && (best.IsZero() || at.Before(best)) {
				best = at
			}
		}
	}
	if best.IsZero() {
		return nil
	}
	return str(best.UTC().Format(time.RFC3339Nano))
}
func (s *Service) scheduleLoop() {
	defer s.wg.Done()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.scheduleTick()
		}
	}
}
func (s *Service) scheduleTick() {
	s.mu.Lock()
	schedule := s.state.Settings.Schedule
	if !schedule.Enabled {
		s.mu.Unlock()
		return
	}
	if !s.state.ScheduledConfigChangesAcknowledged || s.state.ScheduledConfigurationFingerprint != configurationFingerprint(s.state.Settings, true) {
		s.state.Settings.Schedule.Enabled = false
		s.state.Settings.Schedule.NextRunAt = nil
		s.state.ScheduleConsentRequired = true
		_ = s.persistLocked()
		s.mu.Unlock()
		return
	}
	now := time.Now()
	if schedule.NextRunAt == nil {
		s.state.Settings.Schedule.NextRunAt = nextRun(schedule, now, s.location)
		_ = s.persistLocked()
		s.mu.Unlock()
		return
	}
	if mustTime(*schedule.NextRunAt).After(now) {
		s.mu.Unlock()
		return
	}
	running := false
	for _, t := range s.state.Tasks {
		if t.Status == "running" {
			running = true
		}
	}
	settings := clone(s.state.Settings)
	s.state.Settings.Schedule.NextRunAt = nextRun(schedule, now, s.location)
	persistErr := s.persistLocked()
	s.mu.Unlock()
	if running || persistErr != nil {
		return
	}
	_, err := s.Start(s.ctx, StartRequest{Model: settings.InspectionModel, Method: settings.InspectionMethod, Scope: "scheduled"})
	if err != nil { // 到点无可用凭证或接口故障留下可见的任务记录。
		s.mu.Lock()
		defer s.mu.Unlock()
		at := stamp()
		var requestError *apiError
		if !errors.As(err, &requestError) {
			s.scheduleFailures++
			if s.scheduleFailures >= 3 {
				s.state.Settings.Schedule.Enabled = false
				s.state.Settings.Schedule.NextRunAt = nil
			}
		} else {
			s.scheduleFailures = 0
		}
		task := Task{ID: identifier("task"), Scope: "scheduled", Label: "定时巡检未启动", CreatedAt: at, FinishedAt: &at, Status: "completed", Concurrency: settings.Concurrency.MaxObjects, Items: []RunItem{{TargetID: "scheduler", State: "failed", Note: str(err.Error()), FinishedAt: &at}}}
		s.state.Tasks = append([]Task{task}, s.state.Tasks...)
		if len(s.state.Tasks) > 40 {
			s.state.Tasks = s.state.Tasks[:40]
		}
		_ = s.persistLocked()
	} else {
		s.mu.Lock()
		s.scheduleFailures = 0
		s.mu.Unlock()
	}
}
