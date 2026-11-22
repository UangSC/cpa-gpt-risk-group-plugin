package cpa

import (
	"context"
	"errors"
	"strings"
)

func (c *Client) RoutingStrategy(ctx context.Context) (string, error) {
	var out struct {
		Strategy string `json:"strategy"`
	}
	if err := c.request(ctx, "GET", "/routing/strategy", nil, &out); err != nil {
		return "", err
	}
	if strings.TrimSpace(out.Strategy) == "" {
		return "", errors.New("CPA 路由策略响应缺失")
	}
	return out.Strategy, nil
}

func (c *Client) UpdateFields(ctx context.Context, id string, fields Fields) error {
	if id == "" {
		return errors.New("凭证标识不能为空")
	}
	if fields.Priority != nil && (*fields.Priority < -9999 || *fields.Priority > 9999) {
		return errors.New("优先级超出允许范围")
	}
	if fields.Weight != nil && (*fields.Weight < 0 || *fields.Weight > 9999) {
		return errors.New("权重超出允许范围")
	}
	if fields.Weight != nil {
		strategy, err := c.RoutingStrategy(ctx)
		if err != nil {
			return err
		}
		if strategy != "weighted-round-robin" {
			return errors.New("只有 CPA 启用加权轮询时才能修改权重")
		}
	}
	list, err := c.accounts(ctx)
	if err != nil {
		return err
	}
	found := false
	for _, a := range list {
		if a.ID == id {
			found = true
			break
		}
	}
	if !found {
		return errors.New("Codex 凭证不存在或已移除")
	}
	body := map[string]any{"name": id}
	if fields.Prefix != nil {
		body["prefix"] = *fields.Prefix
	}
	if fields.Priority != nil {
		body["priority"] = *fields.Priority
	}
	if fields.Weight != nil {
		body["weight"] = *fields.Weight
	}
	if len(body) == 1 {
		return nil
	}
	return c.request(ctx, "PATCH", "/auth-files/fields", body, nil)
}

func (c *Client) SetDisabled(ctx context.Context, id string, disabled bool) error {
	if id == "" {
		return errors.New("凭证标识不能为空")
	}
	list, err := c.accounts(ctx)
	if err != nil {
		return err
	}
	found := false
	for _, a := range list {
		if a.ID == id {
			found = true
			break
		}
	}
	if !found {
		return errors.New("Codex 凭证不存在或已移除")
	}
	return c.request(ctx, "PATCH", "/auth-files/status", map[string]any{"name": id, "disabled": disabled}, nil)
}

// parseQuotaSignals uses only explicit window sizes and unexpired reset timestamps.
