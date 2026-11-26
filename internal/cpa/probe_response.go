package cpa

import (
	"bufio"
	"bytes"
	"errors"
	"strings"
)

type completedResponse struct {
	Status string `json:"status"`
	Output []struct {
		Type    string `json:"type"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
	Usage struct {
		Input  int `json:"input_tokens"`
		Output int `json:"output_tokens"`
	} `json:"usage"`
}

func completedAnswer(raw []byte) (string, int, int, error) {
	if response, found, err := completedJSONResponse(raw); found || err != nil {
		if err != nil {
			return "", 0, 0, err
		}
		return responseAnswer(response)
	}
	// SSE 允许 LF、CRLF 和 CR；宿主字节切片中的 CRLF 在完整收集后统一处理。
	raw = normalizeSSELineEndings(raw)
	var response completedResponse
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 4096), maxResponseBytes)
	var data strings.Builder
	found := false
	consume := func() error {
		if data.Len() == 0 {
			return nil
		}
		payload := data.String()
		data.Reset()
		if strings.TrimSpace(payload) == "[DONE]" {
			return nil
		}
		completed, ok, err := completedEvent([]byte(payload), false)
		if err != nil {
			return err
		}
		if ok {
			response = completed
			found = true
		}
		return nil
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if strings.HasPrefix(line, "data:") {
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		} else if line == "" {
			if err := consume(); err != nil {
				return "", 0, 0, err
			}
		}
	}
	if scanner.Err() != nil {
		return "", 0, 0, errors.New("检测事件读取失败")
	}
	if err := consume(); err != nil {
		return "", 0, 0, err
	}
	if !found {
		return "", 0, 0, errors.New("检测流未完整完成，不能形成判定")
	}
	return responseAnswer(response)
}

func responseAnswer(response completedResponse) (string, int, int, error) {
	parts := []string{}
	for _, item := range response.Output {
		if item.Type != "message" {
			continue
		}
		for _, content := range item.Content {
			if content.Type == "output_text" {
				parts = append(parts, content.Text)
			}
		}
	}
	answer := strings.Join(parts, "\n")
	if strings.TrimSpace(answer) == "" {
		return "", 0, 0, errors.New("模型没有返回有效文本回答")
	}
	return answer, response.Usage.Input, response.Usage.Output, nil
}
