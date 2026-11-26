package cpa

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

func (c *Client) Probe(ctx context.Context, id, model, prompt, instructions, effort string, headerOverrides map[string]string) (ProbeReply, error) {
	overrides, validationErr := ValidateHeaderOverrides(headerOverrides)
	if validationErr != nil {
		return ProbeReply{Status: 400, Error: validationErr.Error()}, nil
	}
	if effort != "low" && effort != "medium" && effort != "high" {
		return ProbeReply{}, errors.New("思考程度仅支持 low、medium、high")
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	started := time.Now()
	reply := ProbeReply{}
	if ctx.Err() != nil {
		return reply, ctx.Err()
	}
	list, err := c.accounts(ctx)
	if err != nil {
		return reply, err
	}
	var account *hostAuth
	for i := range list {
		if list[i].ID == id {
			account = &list[i]
			break
		}
	}
	if account == nil {
		return reply, errors.New("Codex 凭证不存在或已移除")
	}
	runtime, err := c.runtime(ctx, account.Index, id)
	if err != nil {
		return reply, err
	}
	if runtime.Disabled || strings.EqualFold(strings.TrimSpace(runtime.StatusMessage), "token expired") {
		return ProbeReply{Status: 403, Error: "CPA 已禁用此凭证或认证失效", LocalState: true}, nil
	}
	if runtimeUnavailable(runtime, time.Now()) {
		return ProbeReply{Status: 429, Error: "CPA 凭证当前不可用或正在冷却，未发送上游请求", LocalState: true, RetryAfterMs: runtimeCooldownMillis(runtime, time.Now())}, nil
	}
	if strings.TrimSpace(model) == "" || strings.TrimSpace(prompt) == "" {
		return reply, errors.New("模型和检测题目不能为空")
	}
	routeModel, err := c.prepareProbeModel(ctx, account, model, overrides)
	if err != nil {
		var configuration *headerConfigurationError
		if errors.As(err, &configuration) {
			return ProbeReply{Status: 409, Error: configuration.Error()}, nil
		}
		return reply, err
	}
	body, err := json.Marshal(map[string]any{"model": routeModel, "input": []any{map[string]any{"role": "user", "content": []any{map[string]any{"type": "input_text", "text": prompt}}}}, "instructions": instructions, "stream": true, "store": false, "reasoning": map[string]string{"effort": effort}})
	if err != nil {
		return reply, err
	}
	var stream struct {
		Status  int         `json:"status_code"`
		ID      string      `json:"stream_id"`
		Headers http.Header `json:"headers"`
	}
	// CPA sdk/translator.FormatOpenAIResponse is "openai-response";
	// translator.FromString does not normalize aliases such as "responses".
	err = c.host("host.model.execute_stream", map[string]any{"entry_protocol": "openai-response", "exit_protocol": "openai-response", "model": routeModel, "forced_provider": "codex", "auth_id": id, "stream": true, "headers": probeRequestHeaders(overrides), "body": body}, &stream)
	if err != nil {
		reply, probeErr := probeHostError(err, time.Since(started).Milliseconds())
		return c.withRuntimeCooldown(ctx, account.Index, id, reply), probeErr
	}
	reply.Status = stream.Status
	reply.RetryAfterMs = retryAfterMillis(stream.Headers, time.Now())
	if reply.Status == 0 {
		reply.Status = 200
	}
	reply.DurationMs = time.Since(started).Milliseconds()
	if stream.ID == "" {
		reply.Error = "CPA 没有返回检测流"
		if reply.Status == 200 {
			return reply, errors.New(reply.Error)
		}
		return c.withRuntimeCooldown(ctx, account.Index, id, reply), nil
	}
	defer c.host("host.model.stream_close", map[string]string{"stream_id": stream.ID}, nil)
	if err := ctx.Err(); err != nil {
		return reply, err
	}
	var collected responseStream
	for {
		if ctx.Err() != nil {
			return reply, ctx.Err()
		}
		type streamChunk struct {
			Payload []byte `json:"payload"`
			Error   string `json:"error"`
			Done    bool   `json:"done"`
		}
		type readResult struct {
			chunk streamChunk
			err   error
		}
		done := make(chan readResult, 1)
		go func() {
			var chunk streamChunk
			err := c.host("host.model.stream_read", map[string]string{"stream_id": stream.ID}, &chunk)
			done <- readResult{chunk, err}
		}()
		var next readResult
		select {
		case next = <-done:
		case <-ctx.Done():
			_ = c.host("host.model.stream_close", map[string]string{"stream_id": stream.ID}, nil)
			<-done
			return reply, ctx.Err()
		}
		if next.err != nil {
			reply, probeErr := probeHostError(next.err, time.Since(started).Milliseconds())
			return c.withRuntimeCooldown(ctx, account.Index, id, reply), probeErr
		}
		if err := collected.writeChunk(next.chunk.Payload); err != nil {
			return reply, errors.New("检测响应超过 8 MiB 限制")
		}
		if next.chunk.Error != "" {
			return reply, errors.New("CPA 上游检测流未能完成，连接或传输失败")
		}
		if next.chunk.Done {
			break
		}
	}
	reply.DurationMs = time.Since(started).Milliseconds()
	if reply.Status < 200 || reply.Status >= 300 {
		return c.withRuntimeCooldown(ctx, account.Index, id, reply), nil
	}
	answer, input, output, err := collected.answer()
	if err != nil {
		reply.Error = err.Error()
		return reply, nil
	}
	reply.Answer = answer
	reply.InputTokens = input
	reply.OutputTokens = output
	return reply, nil
}
