package classifier

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
)

type QuotaRefreshRequest struct {
	CredentialIDs []string `json:"credentialIds"`
}

type QuotaRefreshFailure struct {
	CredentialID string `json:"credentialId"`
	Error        string `json:"error"`
}

type QuotaRefreshResult struct {
	RefreshedIDs []string              `json:"refreshedIds"`
	Failed       []QuotaRefreshFailure `json:"failed"`
}

func (s *Service) quotaRefreshAvailable() bool {
	_, ok := s.adapter.(cpa.QuotaRefresher)
	return ok
}

func restoreRefreshedQuotas(s *Service) {
	refresher, ok := s.adapter.(cpa.QuotaRefresher)
	if !ok {
		return
	}
	for id, record := range s.state.Records {
		if record != nil && record.RefreshedQuota != nil {
			refresher.RestoreQuota(id, *record.RefreshedQuota)
		}
	}
}

// RefreshQuotas 只刷新明确提交的当前页凭证，额度错误不改变分类或认证状态。
func (s *Service) RefreshQuotas(ctx context.Context, request QuotaRefreshRequest) (QuotaRefreshResult, error) {
	result := QuotaRefreshResult{RefreshedIDs: []string{}, Failed: []QuotaRefreshFailure{}}
	if len(request.CredentialIDs) == 0 || len(request.CredentialIDs) > 100 {
		return result, bad("刷新额度必须指定 1～100 个当前页凭证")
	}
	seen := map[string]bool{}
	for _, id := range request.CredentialIDs {
		if strings.TrimSpace(id) == "" || len(id) > 1024 || seen[id] {
			return result, bad("刷新额度的凭证标识缺失、重复或无效")
		}
		seen[id] = true
	}
	refresher, ok := s.adapter.(cpa.QuotaRefresher)
	if !ok {
		return result, &apiError{503, "当前 CPA 适配器不支持主动额度刷新"}
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(s.ctx, cancel)
	defer stop()
	defer cancel()
	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return result, err
	}
	allowed := map[string]bool{}
	for _, credential := range live {
		allowed[credential.ID] = true
	}
	for _, id := range request.CredentialIDs {
		if !allowed[id] {
			return result, bad("刷新额度包含已删除或非 Codex 凭证")
		}
	}
	s.mu.Lock()
	headerOverrides := clone(s.state.Settings.HeaderOverrides)
	s.mu.Unlock()
	type outcome struct {
		quota cpa.Quota
		err   error
	}
	outcomes := make([]outcome, len(request.CredentialIDs))
	jobs := make(chan int)
	var workers sync.WaitGroup
	for worker := 0; worker < cpa.QuotaRefreshConcurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				outcomes[index].quota, outcomes[index].err = refresher.RefreshQuota(ctx, request.CredentialIDs[index], headerOverrides)
			}
		}()
	}
	for index := range request.CredentialIDs {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	for index, id := range request.CredentialIDs {
		if outcomes[index].err != nil {
			message := outcomes[index].err.Error()
			if ctx.Err() != nil {
				message = "额度刷新已停止"
			}
			result.Failed = append(result.Failed, QuotaRefreshFailure{CredentialID: id, Error: message})
		} else {
			result.RefreshedIDs = append(result.RefreshedIDs, id)
		}
	}
	if len(result.RefreshedIDs) == 0 {
		return result, nil
	}
	// 先原子保存，再更新适配器的观测缓存；失败凭证继续保留此前的真实额度。
	s.mutation.Lock()
	defer s.mutation.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := map[string]*cpa.Quota{}
	for index, id := range request.CredentialIDs {
		if outcomes[index].err != nil {
			continue
		}
		record := s.recordLocked(id)
		if record.RefreshedQuota != nil {
			previousAt, _ := time.Parse(time.RFC3339Nano, record.RefreshedQuota.ObservedAt)
			nextAt, _ := time.Parse(time.RFC3339Nano, outcomes[index].quota.ObservedAt)
			if nextAt.Before(previousAt) {
				continue
			}
		}
		previous[id] = record.RefreshedQuota
		quota := clone(outcomes[index].quota)
		record.RefreshedQuota = &quota
	}
	if err := s.persistLocked(); err != nil {
		for id, quota := range previous {
			s.recordLocked(id).RefreshedQuota = quota
		}
		return result, err
	}
	for index, id := range request.CredentialIDs {
		if outcomes[index].err == nil {
			refresher.RestoreQuota(id, outcomes[index].quota)
		}
	}
	return result, nil
}
