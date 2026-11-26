package classifier

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	pelicanPolicyID                 = "pelican-html-svg-manual-v2"
	pelicanPromptID                 = "pelican-bicycle-html-svg"
	pelicanMaxHTMLBytes             = 8 << 20
	maxRetainedPelicanSVGsPerTarget = 3
	defaultPelicanMissingReason     = "未取得有效鹈鹕动画"
)

const PelicanQuestion = "不使用任何工具，也不要创建或修改文件，直接在回复中完成以下任务：\n\n创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画，你不需要任何测试，不要使用外部资产。\n\n在一个 ```html 代码块中给出完整的 HTML 文件。"

var (
	pelicanFencePattern      = regexp.MustCompile("(?s)```[ \\t]*([A-Za-z0-9_-]*)[^\\n]*\\r?\\n(.*?)\\r?\\n[ \\t]*```")
	pelicanSVGOpenPattern    = regexp.MustCompile(`(?is)<svg(?:\s|>)`)
	pelicanSVGTagPattern     = regexp.MustCompile(`(?is)<svg\b[^>]*>`)
	pelicanSVGClosePattern   = regexp.MustCompile(`(?is)</svg\s*>`)
	pelicanRootTagPattern    = regexp.MustCompile(`(?is)^<svg\b[^>]*>`)
	pelicanXMLDeclPattern    = regexp.MustCompile(`(?is)<\?xml\b.*?\?>`)
	pelicanDoctypePattern    = regexp.MustCompile(`(?is)<!(?:doctype|entity)\b[^>]*>`)
	pelicanExtScriptPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?is)<script\b[^>]*\bsrc\s*=[^>]*>.*?</script\s*>`),
		regexp.MustCompile(`(?is)<script\b[^>]*\bsrc\s*=[^>]*/?>`),
	}
	pelicanAllScriptPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script\s*>`),
		regexp.MustCompile(`(?is)<script\b[^>]*/>`),
	}
	pelicanSharedBlockDrops = []*regexp.Regexp{
		regexp.MustCompile(`(?is)<foreignObject\b[^>]*>.*?</foreignObject\s*>`),
		regexp.MustCompile(`(?is)<foreignObject\b[^>]*/>`),
		regexp.MustCompile(`(?is)<iframe\b[^>]*>.*?</iframe\s*>`),
		regexp.MustCompile(`(?is)<iframe\b[^>]*/>`),
		regexp.MustCompile(`(?is)<object\b[^>]*>.*?</object\s*>`),
		regexp.MustCompile(`(?is)<object\b[^>]*/>`),
		regexp.MustCompile(`(?is)<embed\b[^>]*/?>`),
		regexp.MustCompile(`(?is)<applet\b[^>]*>.*?</applet\s*>`),
		regexp.MustCompile(`(?is)<applet\b[^>]*/>`),
		regexp.MustCompile(`(?is)<base\b[^>]*/?>`),
		regexp.MustCompile(`(?is)<meta\b[^>]*http-equiv\s*=\s*["']?\s*(?:refresh|content-security-policy)[^>]*/?>`),
	}
	pelicanEventAttrPattern  = regexp.MustCompile(`(?is)\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)`)
	pelicanLinkAttrPattern   = regexp.MustCompile(`(?is)(\s+(?:xlink:href|href|src)\s*=\s*)(?:"([^"]*)"|'([^']*)')`)
	pelicanCSSImportPattern  = regexp.MustCompile(`(?is)@import\b[^;]+;?`)
	pelicanCSSExternalURL    = regexp.MustCompile(`(?is)url\(\s*['"]?\s*(?:https?:|//|javascript:|vbscript:|data:text/)[^)]*\)`)
	pelicanNumericWidthAttr  = regexp.MustCompile(`(?i)\bwidth\s*=\s*["']\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*["']`)
	pelicanNumericHeightAttr = regexp.MustCompile(`(?i)\bheight\s*=\s*["']\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*["']`)
	pelicanNamespaceAttr     = regexp.MustCompile(`(?i)\sxmlns\s*=`)
	pelicanViewBoxAttr       = regexp.MustCompile(`(?i)\sviewbox\s*=`)
)

// ExtractPelicanHTML 从模型回复中提取并清洗完整 HTML（含内联 <svg> 2D 动画），同时向后兼容纯 SVG 输出。
func ExtractPelicanHTML(answer string) (htmlDoc string, svg string, strictFormat bool, formatNote string, err error) {
	normalized := strings.ReplaceAll(strings.TrimPrefix(answer, "\ufeff"), "\r\n", "\n")
	if strings.TrimSpace(normalized) == "" {
		return "", "", false, "", errors.New("模型未返回任何文本内容")
	}

	var deviations []string
	blocks := pelicanFencePattern.FindAllStringSubmatch(normalized, -1)

	if len(blocks) != 1 || !strings.EqualFold(blocks[0][1], "html") {
		deviations = append(deviations, "未严格使用单一 ```html 代码块")
	} else if strings.TrimSpace(normalized) != strings.TrimSpace(blocks[0][0]) {
		deviations = append(deviations, "代码块外含有附加文字")
	}

	candidate := ""
	for _, block := range blocks {
		if strings.EqualFold(block[1], "html") && containsCompleteSVG(block[2]) {
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
		return "", "", false, "", errors.New("回复中未包含完整的 <svg>...</svg> 动画源码")
	}
	if len(candidate) > pelicanMaxHTMLBytes {
		return "", "", false, "", fmt.Errorf("HTML/SVG 源码超过 %d MiB 响应限制", pelicanMaxHTMLBytes>>20)
	}

	lowerCandidate := strings.ToLower(candidate)
	isFullHTML := strings.Contains(lowerCandidate, "<!doctype html") ||
		strings.Contains(lowerCandidate, "<html") ||
		strings.Contains(lowerCandidate, "<body")

	if isFullHTML {
		cleanHTML, cleanSVG, htmlDeviations, sanitizeErr := SanitizePelicanHTML(candidate)
		if sanitizeErr != nil {
			return "", "", false, "", sanitizeErr
		}
		htmlDoc = cleanHTML
		svg = cleanSVG
		deviations = append(deviations, htmlDeviations...)
	} else {
		deviations = append(deviations, "未输出完整 HTML 文件结构，已自动封装为独立 HTML")
		rawSVG, ok := sliceOuterSVG(candidate)
		if !ok {
			return "", "", false, "", errors.New("回复中未包含完整的 <svg>...</svg> 动画源码")
		}
		cleanSVG, svgDeviations, sanitizeErr := SanitizePelicanSVG(rawSVG)
		if sanitizeErr != nil {
			return "", "", false, "", sanitizeErr
		}
		svg = cleanSVG
		htmlDoc = wrapStandalonePelicanHTML(svg)
		deviations = append(deviations, svgDeviations...)
	}

	strictFormat = len(deviations) == 0
	if strictFormat {
		formatNote = "严格符合 ```html 完整文件与内联 SVG 动画规范。"
	} else {
		formatNote = "已提取并安全清洗 HTML/SVG（格式偏差：" + strings.Join(uniqueStrings(deviations), "；") + "）。"
	}
	return htmlDoc, svg, strictFormat, formatNote, nil
}

// ExtractPelicanSVG 保留兼容调用入口，返回提取清洗后的内联 <svg> 源码与格式说明。
func ExtractPelicanSVG(answer string) (svg string, strictFormat bool, formatNote string, err error) {
	_, svg, strictFormat, formatNote, err = ExtractPelicanHTML(answer)
	return svg, strictFormat, formatNote, err
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

func wrapStandalonePelicanHTML(svg string) string {
	return "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>鹈鹕骑自行车 SVG 2D 动画</title>\n<style>\nhtml, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #f8fafc; }\nbody > svg { display: block; width: 100%; height: 100%; max-width: 100%; max-height: 100%; }\n</style>\n</head>\n<body>\n" + svg + "\n</body>\n</html>"
}

func sanitizeCommonExternalAssets(raw string, stripAllScripts bool) (string, []string) {
	var deviations []string
	cleaned := raw
	if stripAllScripts {
		for _, pattern := range pelicanAllScriptPatterns {
			if pattern.MatchString(cleaned) {
				deviations = append(deviations, "已剥离脚本或受限内嵌标签")
				cleaned = pattern.ReplaceAllString(cleaned, "")
			}
		}
	} else {
		for _, pattern := range pelicanExtScriptPatterns {
			if pattern.MatchString(cleaned) {
				deviations = append(deviations, "已剥离外部脚本引用")
				cleaned = pattern.ReplaceAllString(cleaned, "")
			}
		}
	}
	for _, pattern := range pelicanSharedBlockDrops {
		if pattern.MatchString(cleaned) {
			deviations = append(deviations, "已剥离受限外部或内嵌标签")
			cleaned = pattern.ReplaceAllString(cleaned, "")
		}
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
	return cleaned, deviations
}

func ensureSVGRootAttrs(rootTag string) (string, []string) {
	var deviations []string
	var injected []string
	if !pelicanNamespaceAttr.MatchString(rootTag) {
		deviations = append(deviations, "SVG 根元素缺少 xmlns（已自动补齐）")
		injected = append(injected, `xmlns="http://www.w3.org/2000/svg"`)
	}
	if !pelicanViewBoxAttr.MatchString(rootTag) {
		deviations = append(deviations, "SVG 根元素缺少 viewBox（已自动补齐）")
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
	}
	return rootTag, deviations
}

// SanitizePelicanHTML 剥离 HTML 中的外部资源引用、危险内嵌标签与外部脚本，保留本地动画并补齐 SVG 属性。
func SanitizePelicanHTML(raw string) (string, string, []string, error) {
	cleaned, deviations := sanitizeCommonExternalAssets(raw, false)
	if !containsCompleteSVG(cleaned) {
		return "", "", nil, errors.New("清洗后未保留有效的 <svg> 节点")
	}
	var rootDeviations []string
	cleaned = pelicanSVGTagPattern.ReplaceAllStringFunc(cleaned, func(tag string) string {
		updated, devs := ensureSVGRootAttrs(tag)
		rootDeviations = append(rootDeviations, devs...)
		return updated
	})
	deviations = append(deviations, rootDeviations...)

	rawSVG, ok := sliceOuterSVG(cleaned)
	if !ok {
		return "", "", nil, errors.New("清洗后未保留有效的 <svg> 根节点")
	}
	cleanSVG, svgDevs, err := SanitizePelicanSVG(rawSVG)
	if err != nil {
		return "", "", nil, err
	}
	deviations = append(deviations, svgDevs...)
	return strings.TrimSpace(cleaned), cleanSVG, uniqueStrings(deviations), nil
}

// SanitizePelicanSVG 移除脚本、事件属性、外部引用与危险嵌入节点，并补齐根元素渲染所需属性。
func SanitizePelicanSVG(raw string) (string, []string, error) {
	cleaned := pelicanXMLDeclPattern.ReplaceAllString(raw, "")
	cleaned = pelicanDoctypePattern.ReplaceAllString(cleaned, "")

	var deviations []string
	cleaned, assetDevs := sanitizeCommonExternalAssets(cleaned, true)
	deviations = append(deviations, assetDevs...)

	if pelicanEventAttrPattern.MatchString(cleaned) {
		deviations = append(deviations, "已剥离内联事件属性")
		cleaned = pelicanEventAttrPattern.ReplaceAllString(cleaned, "")
	}

	cleaned, ok := sliceOuterSVG(cleaned)
	if !ok {
		return "", nil, errors.New("清洗后未保留有效的 <svg> 根节点")
	}

	rootLoc := pelicanRootTagPattern.FindStringIndex(cleaned)
	if rootLoc == nil {
		return "", nil, errors.New("缺少有效的 <svg> 起始标签")
	}
	rootTag, rootDevs := ensureSVGRootAttrs(cleaned[rootLoc[0]:rootLoc[1]])
	deviations = append(deviations, rootDevs...)
	cleaned = rootTag + cleaned[rootLoc[1]:]
	return cleaned, uniqueStrings(deviations), nil
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

func pruneTargetPelicanSVGs(rounds []Round) {
	kept := 0
	for i := range rounds {
		p := rounds[i].Evidence.Pelican
		if p == nil || (p.HTML == "" && p.SVG == "" && p.RawSnippet == "") {
			continue
		}
		if kept < maxRetainedPelicanSVGsPerTarget {
			kept++
			continue
		}
		if p.HTMLBytes == 0 && p.HTML != "" {
			p.HTMLBytes = len(p.HTML)
		}
		if p.SVGBytes == 0 && p.SVG != "" {
			p.SVGBytes = len(p.SVG)
		}
		p.HTML = ""
		p.SVG = ""
		p.RawSnippet = ""
		p.SVGPruned = true
	}
}
