package cpa

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

const codexQuotaURL = "https://chatgpt.com/backend-api/wham/usage"

// RefreshQuota 锁定宿主凭证，再让 CPA 代换令牌并沿用该凭证的代理。
// 只允许固定的额度 GET 请求，公共请求头来自已保存的插件设置。
func (c *Client) RefreshQuota(ctx context.Context, id string, headerOverrides map[string]string) (Quota, error) {
	overrides, err := ValidateHeaderOverrides(headerOverrides)
	if err != nil {
		return Quota{}, err
	}
	for _, value := range overrides {
		// CPA 管理接口会对所有头值展开此占位符，仅在认证头中使用它。
		if strings.Contains(value, "$TOKEN$") {
			return Quota{}, errors.New("额度查询的自定义请求头值不能包含 CPA 令牌占位符 $TOKEN$")
		}
	}
	select {
	case c.quotaSlots <- struct{}{}:
		defer func() { <-c.quotaSlots }()
	case <-ctx.Done():
		return Quota{}, ctx.Err()
	}
	accounts, err := c.accounts(ctx)
	if err != nil {
		return Quota{}, err
	}
	var account *hostAuth
	for i := range accounts {
		if accounts[i].ID == id {
			account = &accounts[i]
			break
		}
	}
	if account == nil {
		return Quota{}, errors.New("该 Codex 凭证已从 CPA 移除")
	}
	runtime, err := c.runtime(ctx, account.Index, account.ID)
	if err != nil {
		return Quota{}, err
	}
	if runtime.Disabled {
		return Quota{}, errors.New("该凭证已被禁用，无法刷新额度")
	}
	// 官方列表的 id_token 为 CPA 已解析的非秘密账户声明；不读取原始令牌。
	var official struct {
		Files []struct {
			ID        string `json:"id"`
			Index     string `json:"auth_index"`
			AccountID string `json:"account_id"`
			Claims    struct {
				AccountID string `json:"chatgpt_account_id"`
			} `json:"id_token"`
		} `json:"files"`
	}
	if err := c.request(ctx, "GET", "/auth-files", nil, &official); err != nil {
		return Quota{}, err
	}
	accountID := ""
	for _, file := range official.Files {
		if file.ID == id && file.Index == account.Index {
			accountID = strings.TrimSpace(file.Claims.AccountID)
			if accountID == "" {
				accountID = strings.TrimSpace(file.AccountID)
			}
			break
		}
	}
	if accountID == "" || len(accountID) > 256 || strings.IndexFunc(accountID, func(value rune) bool { return value <= ' ' || value >= 127 }) >= 0 {
		return Quota{}, errors.New("CPA 未提供有效的账户标识，无法确认该凭证额度")
	}
	headers := c.quotaRequestHeaders(ctx, "application/json", overrides)
	headers["Authorization"] = "Bearer $TOKEN$"
	headers["Chatgpt-Account-Id"] = accountID
	var reply struct {
		Status int    `json:"status_code"`
		Body   string `json:"body"`
	}
	request := map[string]any{"auth_index": account.Index, "method": "GET", "url": codexQuotaURL, "header": headers}
	if err := c.request(ctx, "POST", "/api-call", request, &reply); err != nil {
		return Quota{}, err
	}
	if reply.Status < 200 || reply.Status >= 300 {
		// 上游原始错误可能含敏感信息，仅返回状态码。
		return Quota{}, fmt.Errorf("额度接口返回 HTTP %d", reply.Status)
	}
	return parseQuotaUsage([]byte(reply.Body), time.Now())
}

func parseQuotaUsage(raw []byte, observed time.Time) (Quota, error) {
	type window struct {
		Used       *float64 `json:"used_percent"`
		Duration   int64    `json:"limit_window_seconds"`
		ResetAt    *int64   `json:"reset_at"`
		ResetAfter *int64   `json:"reset_after_seconds"`
	}
	var body struct {
		RateLimit *struct {
			Reached   bool    `json:"limit_reached"`
			Primary   *window `json:"primary_window"`
			Secondary *window `json:"secondary_window"`
		} `json:"rate_limit"`
	}
	q := Quota{Windows: []QuotaWindow{}, Status: "unknown", ObservedAt: observed.UTC().Format(time.RFC3339Nano)}
	if json.Unmarshal(raw, &body) != nil || body.RateLimit == nil {
		return Quota{}, errors.New("额度接口返回无效或不支持的数据")
	}
	for _, w := range []*window{body.RateLimit.Primary, body.RateLimit.Secondary} {
		if w == nil || w.Used == nil || math.IsNaN(*w.Used) || math.IsInf(*w.Used, 0) || *w.Used < 0 || *w.Used > 100 {
			continue
		}
		key := ""
		switch w.Duration {
		case 18000:
			key = "5h"
		case 604800:
			key = "7d"
		default:
			continue
		}
		var reset time.Time
		if w.ResetAt != nil {
			reset = time.Unix(*w.ResetAt, 0)
		} else if w.ResetAfter != nil && *w.ResetAfter > 0 && *w.ResetAfter <= 31536000 {
			reset = observed.Add(time.Duration(*w.ResetAfter) * time.Second)
		}
		if !reset.After(observed) || reset.After(observed.Add(365*24*time.Hour)) {
			continue
		}
		remaining := 100 - *w.Used
		at := reset.UTC().Format(time.RFC3339Nano)
		q.Windows = append(q.Windows, QuotaWindow{Key: key, RemainingPercent: &remaining, ResetsAt: &at})
		q.Status = "known"
	}
	if body.RateLimit.Reached {
		q.Status = "exhausted"
	}
	for _, w := range q.Windows {
		if *w.RemainingPercent == 0 {
			q.Status = "exhausted"
		}
	}
	if q.Status == "unknown" {
		return Quota{}, errors.New("额度接口没有可确认的五小时或七日额度")
	}
	return q, nil
}

// RestoreQuota 同时用于刷新完成和重启后的持久化恢复。
func (c *Client) RestoreQuota(id string, q Quota) {
	q = usableRefreshedQuota(q, time.Now())
	if q.Status == "unknown" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.quotaCache == nil {
		c.quotaCache = map[string]Quota{}
	}
	previous := c.quotaCache[id]
	previousAt, _ := time.Parse(time.RFC3339Nano, previous.ObservedAt)
	nextAt, _ := time.Parse(time.RFC3339Nano, q.ObservedAt)
	if nextAt.Before(previousAt) {
		return
	}
	c.quotaCache[id] = q
}

func (c *Client) currentQuota(id string, passive Quota) Quota {
	c.mu.RLock()
	q := c.quotaCache[id]
	c.mu.RUnlock()
	q = usableRefreshedQuota(q, time.Now())
	if q.Status == "unknown" {
		return passive
	}
	activeAt, _ := time.Parse(time.RFC3339Nano, q.ObservedAt)
	passiveAt, _ := time.Parse(time.RFC3339Nano, passive.ObservedAt)
	if passive.Status != "unknown" && !passiveAt.Before(activeAt) {
		return passive
	}
	return q
}

func usableRefreshedQuota(q Quota, now time.Time) Quota {
	unknown := Quota{Windows: []QuotaWindow{}, Status: "unknown"}
	observed, err := time.Parse(time.RFC3339Nano, q.ObservedAt)
	if err != nil || observed.After(now.Add(time.Minute)) || (q.Status != "known" && q.Status != "exhausted") {
		return unknown
	}
	valid := Quota{Windows: []QuotaWindow{}, Status: "known", ObservedAt: q.ObservedAt}
	for _, w := range q.Windows {
		if (w.Key != "5h" && w.Key != "7d") || w.RemainingPercent == nil || w.ResetsAt == nil || math.IsNaN(*w.RemainingPercent) || math.IsInf(*w.RemainingPercent, 0) || *w.RemainingPercent < 0 || *w.RemainingPercent > 100 {
			continue
		}
		reset, err := time.Parse(time.RFC3339Nano, *w.ResetsAt)
		if err != nil || !reset.After(now) || reset.After(observed.Add(365*24*time.Hour)) {
			continue
		}
		remaining, at := *w.RemainingPercent, *w.ResetsAt
		valid.Windows = append(valid.Windows, QuotaWindow{Key: w.Key, RemainingPercent: &remaining, ResetsAt: &at})
		if remaining == 0 {
			valid.Status = "exhausted"
		}
	}
	if q.Status == "exhausted" && observed.After(now.Add(-5*time.Minute)) && len(valid.Windows) == len(q.Windows) {
		valid.Status = "exhausted"
	}
	if len(valid.Windows) == 0 && valid.Status != "exhausted" {
		return unknown
	}
	return valid
}
