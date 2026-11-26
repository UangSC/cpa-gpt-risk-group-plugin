package classifier

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
)

const apiPrefix = "/v0/management/plugins/cpa-gpt-risk-group-plugin"

type Service struct {
	adapter          cpa.Adapter
	path             string
	mu               sync.Mutex
	mutation         sync.Mutex
	state            diskState
	ctx              context.Context
	cancel           context.CancelFunc
	tasks            map[string]*inspectionQueue
	wg               sync.WaitGroup
	location         *time.Location
	scheduleFailures int
}

func New(adapter cpa.Adapter, stateDir string) (*Service, error) {
	if adapter == nil || stateDir == "" {
		return nil, errors.New("插件宿主或状态目录缺失")
	}
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("Asia/Shanghai", 8*3600)
	}
	s := &Service{adapter: adapter, path: filepath.Join(stateDir, "state.json"), ctx: ctx, cancel: cancel, tasks: map[string]*inspectionQueue{}, location: loc, state: diskState{Version: stateVersion, Settings: DefaultSettings(), Records: map[string]*Record{}, Tasks: []Task{}}}
	if err := s.loadState(); err != nil {
		cancel()
		return nil, err
	}
	restoreRefreshedQuotas(s)
	// 重启后的任务不能继续使用上一进程的请求上下文。
	for i := range s.state.Tasks {
		t := &s.state.Tasks[i]
		if t.Status == "running" {
			t.Status = "cancelled"
			now := stamp()
			t.FinishedAt = &now
			for j := range t.Items {
				item := &t.Items[j]
				if !terminal(item.State) {
					item.State = "cancelled"
					item.Note = str("CPA 重启，本次未完成的巡检已停止")
					item.FinishedAt = &now
					item.RetryAt = nil
				}
			}
		}
	}
	if s.state.Settings.Schedule.Enabled && (!s.state.ScheduledConfigChangesAcknowledged || s.state.ScheduledConfigurationFingerprint != configurationFingerprint(s.state.Settings, true)) {
		s.state.Settings.Schedule.Enabled = false
		s.state.Settings.Schedule.NextRunAt = nil
		s.state.ScheduleConsentRequired = true
	}
	if s.state.Settings.Schedule.Enabled {
		s.state.Settings.Schedule.NextRunAt = nextRun(s.state.Settings.Schedule, time.Now(), loc)
	}
	if err = s.persistLocked(); err != nil {
		cancel()
		return nil, err
	}
	s.wg.Add(1)
	go s.scheduleLoop()
	return s, nil
}
func (s *Service) Close() {
	s.cancel()
	s.mu.Lock()
	for _, queue := range s.tasks {
		queue.cancel()
	}
	s.mu.Unlock()
	s.wg.Wait()
}
