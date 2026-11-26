package classifier

import (
	"context"
	"sort"
	"strings"
	"sync/atomic"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/fingerprint"
)

type StartRequest struct {
	CredentialIDs            []string `json:"credentialIds,omitempty"`
	Model                    string   `json:"model"`
	Method                   string   `json:"method"`
	Scope                    string   `json:"scope"`
	AcknowledgeConfigChanges bool     `json:"acknowledgeConfigChanges"`
	ConfigChangesMode        string   `json:"configChangesMode"`
	ConfigChangesRevision    string   `json:"configChangesRevision"`
}

func (s *Service) Start(ctx context.Context, q StartRequest) (string, error) {
	if q.Method != "candy" && q.Method != "fingerprint" && q.Method != "pelican" {
		return "", bad("检测方式仅支持糖果题、模型指纹或画鹈鹕")
	}
	if q.Method == "fingerprint" && !fingerprint.Available() {
		return "", bad("模型指纹参考库暂不可用")
	}
	q.Model = strings.TrimSpace(q.Model)
	if q.Model == "" || len(q.Model) > 200 {
		return "", bad("检测模型无效")
	}
	if q.Scope != "manual" && q.Scope != "batch" && q.Scope != "scheduled" {
		return "", bad("检测范围无效")
	}
	scheduled := q.Scope == "scheduled"
	if !scheduled && !q.AcknowledgeConfigChanges {
		return "", &apiError{409, "请先确认本次巡检配置"}
	}
	s.mutation.Lock()
	defer s.mutation.Unlock()
	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return "", err
	}
	selected := map[string]bool{}
	for _, id := range q.CredentialIDs {
		selected[id] = true
	}
	found := map[string]bool{}
	candidates := []cpa.Credential{}
	for _, c := range live {
		found[c.ID] = true
		if len(selected) == 0 || selected[c.ID] {
			candidates = append(candidates, c)
		}
	}
	for id := range selected {
		if !found[id] {
			return "", bad("检测集合包含不存在的 Codex 凭证")
		}
	}
	if len(candidates) == 0 {
		return "", bad("CPA 当前没有可检测的 Codex 凭证")
	}
	sortCredentials(candidates)
	s.mu.Lock()
	defer s.mu.Unlock()
	settings := s.state.Settings
	revision := configurationFingerprint(settings, scheduled)
	if !scheduled && (q.ConfigChangesMode != settings.Routing.Mode || q.ConfigChangesRevision != revision) {
		return "", &apiError{409, "巡检或分组配置已变化，请重新确认巡检会修改的配置"}
	}
	if q.Method != settings.InspectionMethod {
		return "", &apiError{409, "检测方式与当前已保存设置不一致，请保存后重新确认巡检"}
	}
	if q.Model != strings.TrimSpace(settings.InspectionModel) {
		return "", &apiError{409, "检测模型与当前已保存设置不一致，请保存后重新确认巡检"}
	}
	if scheduled && (!settings.Schedule.Enabled || !s.state.ScheduledConfigChangesAcknowledged || s.state.ScheduledConfigurationFingerprint != revision) {
		return "", &apiError{409, "定时巡检未获得当前配置的修改授权"}
	}
	participating := candidates[:0]
	skippedFree := false
	skippedOther := false
	for _, c := range candidates {
		record := s.state.Records[c.ID]
		if !excludedFromInspection(c, record, settings) {
			participating = append(participating, c)
			continue
		}
		if !c.Disabled && (record == nil || !record.InspectionExcluded) && isFreePlan(c.Plan) && !settings.InspectFreeAccounts {
			skippedFree = true
		} else {
			skippedOther = true
		}
	}
	candidates = participating
	if len(candidates) == 0 {
		if skippedFree && !skippedOther {
			return "", &apiError{409, "Free 账号默认不参与巡检，可在「设置 → 巡检与重试」中开启强制巡检 Free 账号"}
		}
		return "", &apiError{409, "所选凭证均不参与巡检，请检查 CPA 停用状态、Free 账号策略或恢复参与"}
	}
	if s.ctx.Err() != nil {
		return "", &apiError{409, "插件正在停止"}
	}
	task := Task{ID: identifier("task"), Scope: q.Scope, Label: "Codex 凭证巡检", Method: q.Method, CreatedAt: stamp(), Status: "running", Items: []RunItem{}, Concurrency: settings.Concurrency.MaxObjects}
	var queue *inspectionQueue
	existingIndex := -1
	seen := make(map[string]bool)
	for i, active := range s.state.Tasks {
		if active.Status != "running" {
			continue
		}
		queue = s.tasks[active.ID]
		if queue == nil || queue.ctx.Err() != nil {
			return "", &apiError{409, "当前巡检正在收尾"}
		}
		// 定时巡检使用独立的额度与会话策略，手动和批量巡检可以共用队列。
		if (active.Scope == "scheduled") != scheduled || configurationFingerprint(queue.settings, scheduled) != revision {
			return "", &apiError{409, "当前巡检使用不同的执行策略或配置，请等待任务结束后再启动"}
		}
		task = active
		task.Items = append([]RunItem(nil), active.Items...)
		existingIndex = i
		for _, item := range task.Items {
			seen[item.TargetID] = true
		}
		break
	}
	newJobs := make([]inspectionJob, 0, len(candidates))
	for _, c := range candidates {
		tid := targetID(c.ID, q.Model)
		if seen[tid] {
			continue
		}
		newJobs = append(newJobs, inspectionJob{credential: c, request: q})
		r := s.recordLocked(c.ID)
		if _, ok := r.Targets[q.Model]; !ok {
			r.Targets[q.Model] = Target{ID: tid, CredentialID: c.ID, Model: q.Model, Verdict: "untested", Rounds: []Round{}}
		}
		task.Items = append(task.Items, RunItem{TargetID: tid, State: "queued"})
	}
	if len(newJobs) == 0 {
		return task.ID, nil
	}
	previous := s.state.Tasks
	if existingIndex >= 0 {
		s.state.Tasks = append([]Task(nil), previous...)
		s.state.Tasks[existingIndex] = task
	} else {
		s.state.Tasks = append([]Task{task}, previous...)
		if len(s.state.Tasks) > 40 {
			s.state.Tasks = s.state.Tasks[:40]
		}
	}
	if err = s.persistLocked(); err != nil {
		s.state.Tasks = previous
		return "", err
	}
	if queue == nil {
		taskCtx, cancel := context.WithCancel(s.ctx)
		queue = &inspectionQueue{ctx: taskCtx, cancel: cancel, settings: clone(settings)}
		s.tasks[task.ID] = queue
	}
	queue.jobs = append(queue.jobs, newJobs...)
	for i := 0; i < len(newJobs) && queue.workers < task.Concurrency; i++ {
		queue.workers++
		s.wg.Add(1)
		go s.runWorker(task, queue)
	}
	return task.ID, nil
}
func sortCredentials(c []cpa.Credential) { // 空闲或未知先执行，明确忙碌的账号稍后等待。
	sort.SliceStable(c, func(i, j int) bool {
		return c[i].Availability != "busy" && c[j].Availability == "busy"
	})
}
func (s *Service) patchItem(taskID, targetID string, fn func(*RunItem)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Tasks {
		t := &s.state.Tasks[i]
		if t.ID == taskID {
			for j := range t.Items {
				if t.Items[j].TargetID == targetID {
					fn(&t.Items[j])
					return
				}
			}
		}
	}
}
func (s *Service) CancelTask(id string) error {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Tasks {
		t := &s.state.Tasks[i]
		if t.ID != id {
			continue
		}
		if queue := s.tasks[id]; queue != nil {
			queue.cancel()
		}
		if t.Status == "running" {
			t.Status = "cancelled"
			now := stamp()
			t.FinishedAt = &now
			for j := range t.Items {
				item := &t.Items[j]
				if !terminal(item.State) {
					item.State = "cancelled"
					item.Note = str("任务已停止；正在返回的请求不会再提交判定或修改分组")
					item.FinishedAt = &now
					item.RetryAt = nil
				}
			}
			return s.persistLocked()
		}
		return nil
	}
	return &apiError{404, "任务不存在"}
}

type inspectionJob struct {
	credential cpa.Credential
	request    StartRequest
}

type inspectionQueue struct {
	ctx                context.Context
	cancel             context.CancelFunc
	settings           Settings
	jobs               []inspectionJob
	workers            int
	connectionFailures atomic.Int32
}

func (s *Service) runWorker(task Task, queue *inspectionQueue) {
	defer s.wg.Done()
	s.mu.Lock()
	for len(queue.jobs) > 0 && queue.ctx.Err() == nil {
		job := queue.jobs[0]
		queue.jobs[0] = inspectionJob{}
		queue.jobs = queue.jobs[1:]
		s.mu.Unlock()
		s.inspect(queue.ctx, queue.cancel, task, job.request, job.credential, queue.settings, &queue.connectionFailures)
		s.mu.Lock()
	}
	defer s.mu.Unlock()
	queue.workers--
	if queue.workers > 0 {
		return
	}
	defer queue.cancel()
	delete(s.tasks, task.ID)
	for i := range s.state.Tasks {
		t := &s.state.Tasks[i]
		if t.ID != task.ID {
			continue
		}
		now := stamp()
		t.FinishedAt = &now
		if queue.ctx.Err() != nil {
			t.Status = "cancelled"
		} else {
			t.Status = "completed"
		}
		for j := range t.Items {
			item := &t.Items[j]
			if !terminal(item.State) {
				item.State = "cancelled"
				item.FinishedAt = &now
				item.CurrentTest = nil
				item.RetryAt = nil
				item.Note = str("任务已停止")
			}
		}
	}
	// 无人值守连续连接失败时，同时停止计划，避免无限新建任务。
	if queue.connectionFailures.Load() >= 3 {
		s.state.Settings.Schedule.Enabled = false
		s.state.Settings.Schedule.NextRunAt = nil
	}
	_ = s.persistLocked()
}
