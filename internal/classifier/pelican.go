package classifier

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	pelicanPolicyID                  = "pelican-svg-manual-v1"
	pelicanMaxSVGBytes               = 256 << 10
	maxRetainedPelicanSVGsPerTarget  = 3
	defaultPelicanMissingReason      = "未取得有效 SVG 绘画"
	pelicanRawSnippetMaxBytes        = 4096
)

const PelicanQuestion = `[题目]
请直接在回复中输出一段可嵌入 HTML 页面的内联 SVG 源码，绘制“鹈鹕骑自行车”的 2D 循环动画。

[实现限制]
仅依据本题描述作答。不调用工具，不联网，不引用历史对话或已保存的记忆，不创建或修改文件，不运行测试。所有图形和动画均写在同一个 <svg> 元素内。动画自动播放、无限循环，不依赖 JavaScript 或外部资源。

[输出格式]
整条回复只能包含一个 Markdown 代码块，严格遵守以下格式：
1. 回复首行固定为 ` + "```svg" + `，末行固定为 ` + "```" + `，两行均顶格书写。
2. 代码块内只放完整的 SVG 源码，以 <svg 开头，以 </svg> 结束。根元素必须包含 xmlns="http://www.w3.org/2000/svg" 和 viewBox 属性。
3. 不输出 XML 声明、DOCTYPE、<html> 或 <body> 标签，不使用省略号或占位符。
4. 代码块前后不添加空行、标题、文件名、说明或其他文字。`

var (
	pelicanFencePattern       = regexp.MustCompile("(?s)```[ \\t]*([A-Za-z0-9_-]*)[^\\n]*\\r?\\n(.*?)\\r?\\n[ \\t]*```")
	pelicanSVGOpenPattern     = regexp.MustCompile(`(?is)<svg(?:\s|>)`)
	pelicanSVGClosePattern    = regexp.MustCompile(`(?is)</svg\s*>`)
	pelicanRootTagPattern     = regexp.MustCompile(`(?is)^<svg\b[^>]*>`)
	pelicanXMLDeclPattern     = regexp.MustCompile(`(?is)<\?xml\b.*?\?>`)
	pelicanDoctypePattern     = regexp.MustCompile(`(?is)<!(?:doctype|entity)\b[^>]*>`)
	pelicanBlockDropPatterns  = []*regexp.Regexp{
		regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script\s*>`),
		regexp.MustCompile(`(?is)<script\b[^>]*/>`),
		regexp.MustCompile(`(?is)<foreignObject\b[^>]*>.*?</foreignObject\s*>`),
		regexp.MustCompile(`(?is)<foreignObject\b[^>]*/>`),
		regexp.MustCompile(`(?is)<iframe\b[^>]*>.*?</iframe\s*>`),
		regexp.MustCompile(`(?is)<iframe\b[^>]*/>`),
		regexp.MustCompile(`(?is)<object\b[^>]*>.*?</object\s*>`),
		regexp.MustCompile(`(?is)<object\b[^>]*/>`),
		regexp.MustCompile(`(?is)<embed\b[^>]*/?>`),
	}
	pelicanEventAttrPattern   = regexp.MustCompile(`(?is)\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)`)
	pelicanLinkAttrPattern    = regexp.MustCompile(`(?is)(\s+(?:xlink:href|href|src)\s*=\s*)(?:"([^"]*)"|'([^']*)')`)
	pelicanCSSImportPattern   = regexp.MustCompile(`(?is)@import\b[^;]+;?`)
	pelicanCSSExternalURL     = regexp.MustCompile(`(?is)url\(\s*['"]?\s*(?:https?:|//|javascript:|vbscript:|data:text/)[^)]*\)`)
	pelicanNumericWidthAttr   = regexp.MustCompile(`(?i)\bwidth\s*=\s*["']\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*["']`)
	pelicanNumericHeightAttr  = regexp.MustCompile(`(?i)\bheight\s*=\s*["']\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*["']`)
)

// ExtractPelicanSVG 从模型回复中提取并清洗内联 <svg> 源码，同时记录是否严格满足输出格式要求。
func ExtractPelicanSVG(answer string) (svg string, strictFormat bool, formatNote string, err error) {
	normalized := strings.ReplaceAll(strings.TrimPrefix(answer, "\ufeff"), "\r\n", "\n")
	if strings.TrimSpace(normalized) == "" {
		return "", false, "", errors.New("模型未返回任何文本内容")
	}

	var deviations []string
	blocks := pelicanFencePattern.FindAllStringSubmatch(normalized, -1)

	strictFence := strings.HasPrefix(normalized, "```svg\n") &&
		strings.HasSuffix(normalized, "\n```") &&
		len(blocks) == 1 &&
		blocks[0][0] == normalized
	if !strictFence {
		deviations = append(deviations, "未严格使用顶格单一 ```svg 代码块")
	}

	candidate := ""
	for _, block := range blocks {
		if strings.EqualFold(block[1], "svg") && containsCompleteSVG(block[2]) {
			candidate = strings.TrimSpace(block[2])
			break
		}
	}
	if candidate == "" {
		for _, block := range blocks {
			if containsCompleteSVG(block[2]) {
				candidate = strings.TrimSpace(block[2])
				break
			}
		}
	}
	if candidate == "" && containsCompleteSVG(normalized) {
		candidate = strings.TrimSpace(normalized)
	}
	if candidate == "" {
		return "", false, "", errors.New("回复中未包含完整的 <svg>...</svg> 源码")
	}

	lowerCandidate := strings.ToLower(candidate)
	if strings.Contains(lowerCandidate, "<?xml") ||
		strings.Contains(lowerCandidate, "<!doctype") ||
		strings.Contains(lowerCandidate, "<html") ||
		strings.Contains(lowerCandidate, "<body") {
		deviations = append(deviations, "包含 XML/DOCTYPE/HTML 外层标签")
	}

	rawSVG, ok := sliceOuterSVG(candidate)
	if !ok {
		return "", false, "", errors.New("回复中未包含完整的 <svg>...</svg> 源码")
	}
	if strings.TrimSpace(candidate) != rawSVG {
		deviations = append(deviations, "代码块内含有 <svg> 之外的内容")
	}
	if len(rawSVG) > pelicanMaxSVGBytes {
		return "", false, "", fmt.Errorf("SVG 源码超过 %d KB 限制", pelicanMaxSVGBytes>>10)
	}

	sanitized, rootDeviations, sanitizeErr := SanitizePelicanSVG(rawSVG)
	if sanitizeErr != nil {
		return "", false, "", sanitizeErr
	}
	deviations = append(deviations, rootDeviations...)

	strictFormat = len(deviations) == 0
	if strictFormat {
		formatNote = "严格符合 ```svg 代码块、xmlns 与 viewBox 内联动画规范。"
	} else {
		formatNote = "已提取并安全清洗 SVG（格式偏差：" + strings.Join(uniqueStrings(deviations), "；") + "）。"
	}
	return sanitized, strictFormat, formatNote, nil
}

func containsCompleteSVG(text string) bool {
	openLoc := pelicanSVGOpenPattern.FindStringIndex(text)
	if openLoc == nil {
		return false
	}
	closes := pelicanSVGClosePattern.FindAllStringIndex(text[openLoc[0]:], -1)
	return len(closes) > 0
}

func sliceOuterSVG(text string) (string, bool) {
	openLoc := pelicanSVGOpenPattern.FindStringIndex(text)
	if openLoc == nil {
		return "", false
	}
	sub := text[openLoc[0]:]
	closes := pelicanSVGClosePattern.FindAllStringIndex(sub, -1)
	if len(closes) == 0 {
		return "", false
	}
	lastClose := closes[len(closes)-1]
	return strings.TrimSpace(sub[:lastClose[1]]), true
}

// SanitizePelicanSVG 移除脚本、事件属性、外部引用与危险嵌入节点，并补齐根元素渲染所需属性。
func SanitizePelicanSVG(raw string) (string, []string, error) {
	var deviations []string
	cleaned := pelicanXMLDeclPattern.ReplaceAllString(raw, "")
	cleaned = pelicanDoctypePattern.ReplaceAllString(cleaned, "")

	for _, pattern := range pelicanBlockDropPatterns {
		if pattern.MatchString(cleaned) {
			deviations = append(deviations, "已剥离脚本或受限内嵌标签")
			cleaned = pattern.ReplaceAllString(cleaned, "")
		}
	}
	if pelicanEventAttrPattern.MatchString(cleaned) {
		deviations = append(deviations, "已剥离内联事件属性")
		cleaned = pelicanEventAttrPattern.ReplaceAllString(cleaned, "")
	}
	cleaned = pelicanLinkAttrPattern.ReplaceAllStringFunc(cleaned, func(match string) string {
		parts := pelicanLinkAttrPattern.FindStringSubmatch(match)
		if len(parts) < 4 {
			return ""
		}
		prefix := parts[1]
		val := parts[2]
		quote := `"`
		if val == "" && strings.Contains(match, "'") {
			val = parts[3]
			quote = `'`
		}
		trimmed := strings.TrimSpace(val)
		lower := strings.ToLower(trimmed)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(lower, "data:image/") {
			return prefix + quote + trimmed + quote
		}
		deviations = append(deviations, "已拦截外部或脚本链接引用")
		return ""
	})
	if pelicanCSSImportPattern.MatchString(cleaned) {
		deviations = append(deviations, "已剥离 CSS @import")
		cleaned = pelicanCSSImportPattern.ReplaceAllString(cleaned, "")
	}
	if pelicanCSSExternalURL.MatchString(cleaned) {
		deviations = append(deviations, "已拦截外部 CSS url()")
		cleaned = pelicanCSSExternalURL.ReplaceAllString(cleaned, "none")
	}

	cleaned, ok := sliceOuterSVG(cleaned)
	if !ok {
		return "", nil, errors.New("清洗后未保留有效的 <svg> 根节点")
	}

	rootLoc := pelicanRootTagPattern.FindStringIndex(cleaned)
	if rootLoc == nil {
		return "", nil, errors.New("缺少有效的 <svg> 起始标签")
	}
	rootTag := cleaned[rootLoc[0]:rootLoc[1]]
	lowerRoot := strings.ToLower(rootTag)
	var injected []string
	if !strings.Contains(lowerRoot, `xmlns=`) {
		deviations = append(deviations, "根元素缺少 xmlns（已自动补齐）")
		injected = append(injected, `xmlns="http://www.w3.org/2000/svg"`)
	}
	if !strings.Contains(lowerRoot, "viewbox=") {
		deviations = append(deviations, "根元素缺少 viewBox（已自动补齐）")
		w := "800"
		h := "600"
		if wm := pelicanNumericWidthAttr.FindStringSubmatch(rootTag); len(wm) == 2 && wm[1] != "0" {
			w = wm[1]
		}
		if hm := pelicanNumericHeightAttr.FindStringSubmatch(rootTag); len(hm) == 2 && hm[1] != "0" {
			h = hm[1]
		}
		injected = append(injected, fmt.Sprintf(`viewBox="0 0 %s %s"`, w, h))
	}
	if len(injected) > 0 && strings.HasSuffix(rootTag, ">") {
		insertPos := len(rootTag) - 1
		if strings.HasSuffix(rootTag, "/>") {
			insertPos = len(rootTag) - 2
		}
		rootTag = rootTag[:insertPos] + " " + strings.Join(injected, " ") + rootTag[insertPos:]
		cleaned = rootTag + cleaned[rootLoc[1]:]
	}
	return cleaned, deviations, nil
}

func uniqueStrings(items []string) []string {
	seen := make(map[string]bool, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		if !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	return out
}

func truncatePelicanSnippet(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) > pelicanRawSnippetMaxBytes {
		return trimmed[:pelicanRawSnippetMaxBytes] + "…"
	}
	return trimmed
}

func pruneTargetPelicanSVGs(rounds []Round) {
	kept := 0
	for i := range rounds {
		p := rounds[i].Evidence.Pelican
		if p == nil || p.SVG == "" {
			continue
		}
		if kept < maxRetainedPelicanSVGsPerTarget {
			kept++
			continue
		}
		if p.SVGBytes == 0 {
			p.SVGBytes = len(p.SVG)
		}
		p.SVG = ""
		p.SVGPruned = true
	}
}

type ManualVerdictRequest struct {
	CredentialID string `json:"credentialId"`
	Model        string `json:"model"`
	RoundID      string `json:"roundId,omitempty"`
	Verdict      string `json:"verdict"`
}

type ManualVerdictResponse struct {
	Verdict      string  `json:"verdict"`
	Status       string  `json:"status"`
	AppliedGroup *string `json:"appliedGroup"`
	Message      *string `json:"message"`
}

func (s *Service) JudgePelican(ctx context.Context, q ManualVerdictRequest) (ManualVerdictResponse, error) {
	q.CredentialID = strings.TrimSpace(q.CredentialID)
	q.Model = strings.TrimSpace(q.Model)
	q.RoundID = strings.TrimSpace(q.RoundID)
	if q.CredentialID == "" {
		return ManualVerdictResponse{}, bad("必须指定 Codex 凭证 ID")
	}
	if q.Model == "" || len(q.Model) > 200 {
		return ManualVerdictResponse{}, bad("必须指定有效的检测模型")
	}
	if q.Verdict != "normal" && q.Verdict != "downshift" {
		return ManualVerdictResponse{}, bad("手动分组结论仅支持 normal 或 downshift")
	}

	s.mutation.Lock()
	defer s.mutation.Unlock()

	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return ManualVerdictResponse{}, err
	}
	var currentCred *struct {
		Disabled bool
	}
	for i := range live {
		if live[i].ID == q.CredentialID {
			currentCred = &struct{ Disabled bool }{Disabled: live[i].Disabled}
			break
		}
	}
	if currentCred == nil {
		return ManualVerdictResponse{}, &apiError{404, "Codex 凭证不存在"}
	}

	s.mu.Lock()
	if s.credentialBusyLocked(q.CredentialID) {
		s.mu.Unlock()
		return ManualVerdictResponse{}, &apiError{409, "该凭证仍在巡检任务中，请等待完成或停止后再判定分组"}
	}
	rec := s.recordLocked(q.CredentialID)
	if rec.InspectionExcluded {
		s.mu.Unlock()
		return ManualVerdictResponse{}, &apiError{409, "该凭证当前处于免检排除池，请先恢复参与后再判定分组"}
	}
	target, hasTarget := rec.Targets[q.Model]
	roundIdx := -1
	if hasTarget {
		for i, round := range target.Rounds {
			if q.RoundID != "" {
				if round.ID == q.RoundID {
					roundIdx = i
					break
				}
				continue
			}
			if round.Evidence.Pelican != nil && (round.Evidence.Pelican.SVG != "" || round.Evidence.Pelican.SVGBytes > 0) {
				roundIdx = i
				break
			}
		}
	}
	if roundIdx < 0 || target.Rounds[roundIdx].Evidence.Pelican == nil || (target.Rounds[roundIdx].Evidence.Pelican.SVG == "" && target.Rounds[roundIdx].Evidence.Pelican.SVGBytes == 0) {
		s.mu.Unlock()
		return ManualVerdictResponse{}, &apiError{409, "该凭证尚未生成鹈鹕 SVG 动画，请先执行绘画后再进行风控分组"}
	}
	settings := clone(s.state.Settings)
	s.mu.Unlock()

	if settings.Routing.Mode != "none" && currentCred.Disabled {
		return ManualVerdictResponse{}, &apiError{409, "该凭证已在 CPA 停用，请先开启凭证后再写入分组"}
	}

	desired := str(q.Verdict)
	now := stamp()
	var syncRecord Sync
	if settings.Routing.Mode == "none" {
		syncRecord = Sync{
			Mode:         "none",
			DesiredGroup: desired,
			AppliedGroup: desired,
			Status:       "not-needed",
			At:           &now,
		}
	} else {
		syncRecord, _ = s.apply(ctx, q.CredentialID, desired, settings)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	rec = s.recordLocked(q.CredentialID)
	target = rec.Targets[q.Model]
	if roundIdx >= len(target.Rounds) {
		return ManualVerdictResponse{}, &apiError{409, "目标检测轮次已变更，请刷新后重试"}
	}
	round := target.Rounds[roundIdx]
	round.Outcome = q.Verdict
	if q.Verdict == "normal" {
		round.ReasonCode = "pelican-judged-normal"
		round.Reason = "人工肉眼判定：正常（鹈鹕 SVG 动画）"
	} else {
		round.ReasonCode = "pelican-judged-downshift"
		round.Reason = "人工肉眼判定：风控（鹈鹕 SVG 动画）"
	}
	if round.Evidence.Pelican != nil {
		round.Evidence.Pelican.JudgedVerdict = q.Verdict
		round.Evidence.Pelican.JudgedAt = now
	}
	round.Sync = &syncRecord
	target.Rounds[roundIdx] = round
	target.Verdict = q.Verdict
	target.Blocked = nil
	rec.Targets[q.Model] = target
	if settings.Routing.Mode == "none" {
		rec.Group = desired
		rec.Sync = syncRecord
	}
	if err := s.persistLocked(); err != nil {
		return ManualVerdictResponse{}, err
	}

	return ManualVerdictResponse{
		Verdict:      q.Verdict,
		Status:       syncRecord.Status,
		AppliedGroup: syncRecord.AppliedGroup,
		Message:      syncRecord.Message,
	}, nil
}
