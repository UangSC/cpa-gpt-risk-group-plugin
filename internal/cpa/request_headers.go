package cpa

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/textproto"
	"runtime"
	"sort"
	"strings"
)

// 仅作为 `/api-call` 主动刷新额度接口在 CPA 未配置 header-defaults 时的兜底版本标识；模型探测留空交由 CPA 内核注入。
const fallbackQuotaCodexCLIVersion = "0.170.0"

type RequestHeaderProfile struct {
	Source          string            `json:"source,omitempty"`
	CodexCLIVersion string            `json:"codexCliVersion"`
	DefaultHeaders  map[string]string `json:"defaultHeaders"`
	ManagedHeaders  []string          `json:"managedHeaders"`
}

var protectedRequestHeaders = map[string]bool{
	"authorization": true, "proxy-authorization": true, "cookie": true, "set-cookie": true,
	"host": true, "content-length": true, "content-type": true, "accept": true,
	"connection": true, "proxy-connection": true, "transfer-encoding": true, "te": true,
	"trailer": true, "upgrade": true, "expect": true, "keep-alive": true,
	"chatgpt-account-id": true, "x-codex-routing-hint": true,
	"session-id": true, "thread-id": true, "x-client-request-id": true,
	"x-request-id": true, "x-codex-window-id": true, "x-codex-parent-thread-id": true,
	"x-api-key": true, "api-key": true, "x-openai-api-key": true,
	"origin": true, "referer": true, "forwarded": true, "accept-encoding": true,
}

func fallbackCodexUserAgent() string {
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x86_64"
	}
	if arch == "arm64" {
		arch = "aarch64"
	}
	osName := runtime.GOOS
	if osName == "windows" {
		osName = "Windows 10.0.19045"
	}
	if osName == "darwin" {
		osName = "Mac OS"
	}
	if osName == "linux" {
		osName = "Linux"
	}
	return fmt.Sprintf("codex_cli_rs/%s (%s; %s) unknown", fallbackQuotaCodexCLIVersion, osName, arch)
}

func DefaultRequestHeaderProfile() RequestHeaderProfile {
	managed := make([]string, 0, len(protectedRequestHeaders))
	for name := range protectedRequestHeaders {
		managed = append(managed, textproto.CanonicalMIMEHeaderKey(name))
	}
	sort.Strings(managed)
	return RequestHeaderProfile{
		Source:          "cpa-core",
		CodexCLIVersion: "",
		DefaultHeaders: map[string]string{
			"Content-Type": "application/json",
			"Accept":       "text/event-stream",
		},
		ManagedHeaders: managed,
	}
}

func validHeaderName(name string) bool {
	if name == "" || len(name) > 128 || strings.TrimSpace(name) != name {
		return false
	}
	for _, character := range name {
		if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", character)) {
			return false
		}
	}
	return true
}

func validHeaderValue(value string) bool {
	if strings.TrimSpace(value) == "" || len(value) > 4096 {
		return false
	}
	for _, character := range value {
		if character != '\t' && (character < 32 || character > 126) {
			return false
		}
	}
	return true
}

func (c *Client) cpaCodexHeaderDefaults(ctx context.Context) map[string]string {
	var cfg struct {
		CodexHeaderDefaults map[string]any `json:"codex-header-defaults"`
		HeaderDefaults      map[string]any `json:"header-defaults"`
	}
	if err := c.request(ctx, "GET", "/config", nil, &cfg); err != nil {
		return nil
	}
	raw := cfg.CodexHeaderDefaults
	if len(raw) == 0 {
		raw = cfg.HeaderDefaults
	}
	if len(raw) == 0 {
		return nil
	}
	out := make(map[string]string, len(raw))
	for name, val := range raw {
		str, ok := val.(string)
		if !ok || !validHeaderName(name) || !validHeaderValue(str) {
			continue
		}
		key := normalizedHeaderName(name)
		if protectedRequestHeaders[key] || isPluginManagedHeaderKey(key) || strings.HasPrefix(key, "sec-") || strings.HasPrefix(key, "x-forwarded-") {
			continue
		}
		out[textproto.CanonicalMIMEHeaderKey(name)] = str
	}
	return out
}

func extractCodexCLIVersion(headers map[string]string) string {
	if v := strings.TrimSpace(headers["Version"]); v != "" {
		return v
	}
	ua := headers["User-Agent"]
	const marker = "codex_cli_rs/"
	if idx := strings.Index(strings.ToLower(ua), marker); idx >= 0 {
		rest := ua[idx+len(marker):]
		if cut := strings.IndexAny(rest, " \t(;/)"); cut >= 0 {
			rest = rest[:cut]
		}
		return strings.TrimSpace(rest)
	}
	return ""
}

func (c *Client) RequestHeaderProfile(ctx context.Context) RequestHeaderProfile {
	profile := DefaultRequestHeaderProfile()
	defaults := c.cpaCodexHeaderDefaults(ctx)
	if len(defaults) == 0 {
		return profile
	}
	profile.Source = "cpa-config"
	for name, value := range defaults {
		profile.DefaultHeaders[name] = value
	}
	profile.CodexCLIVersion = extractCodexCLIVersion(defaults)
	return profile
}

func normalizedHeaderName(name string) string {
	return strings.ToLower(strings.ReplaceAll(name, "_", "-"))
}

func isPluginManagedHeaderKey(key string) bool {
	return strings.HasPrefix(key, "x-cpa-risk-group-") || strings.HasPrefix(key, "x-cpa-downshift-")
}

// ValidateHeaderOverrides 保留普通用户头，拒绝认证、路由和传输控制头及换行注入。
func ValidateHeaderOverrides(overrides map[string]string) (map[string]string, error) {
	if len(overrides) > 32 {
		return nil, errors.New("请求头覆盖最多允许 32 项")
	}
	result := make(map[string]string, len(overrides))
	seen := map[string]bool{}
	total := 0
	for name, value := range overrides {
		if name == "" || len(name) > 128 || strings.TrimSpace(name) != name {
			return nil, errors.New("请求头名称无效")
		}
		for _, character := range name {
			if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", character)) {
				return nil, errors.New("请求头名称只能使用 HTTP 头名字符")
			}
		}
		key := normalizedHeaderName(name)
		if protectedRequestHeaders[key] || isPluginManagedHeaderKey(key) || strings.HasPrefix(key, "sec-") || strings.HasPrefix(key, "x-forwarded-") {
			return nil, fmt.Errorf("请求头 %s 由 CPA 管理，不能由插件覆盖", textproto.CanonicalMIMEHeaderKey(name))
		}
		if seen[strings.ToLower(name)] {
			return nil, errors.New("请求头名称不能出现大小写重复项")
		}
		seen[strings.ToLower(name)] = true
		if strings.TrimSpace(value) == "" || len(value) > 4096 {
			return nil, errors.New("请求头值不能为空且不能超过 4096 字节")
		}
		for _, character := range value {
			if character != '\t' && (character < 32 || character > 126) {
				return nil, errors.New("请求头值必须为可打印 ASCII，不能含换行或控制字符")
			}
		}
		total += len(name) + len(value)
		if total > 32768 {
			return nil, errors.New("请求头覆盖总长度不能超过 32 KiB")
		}
		result[textproto.CanonicalMIMEHeaderKey(name)] = value
	}
	return result, nil
}

func headerSourceDigest(name string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(name)))
	return hex.EncodeToString(digest[:12])
}

func privateHeaderSource(name string) string {
	return "X-Cpa-Risk-Group-Hdr-" + headerSourceDigest(name)
}

func legacyPrivateHeaderSource(name string) string {
	return "X-Cpa-Downshift-Hdr-" + headerSourceDigest(name)
}

func isPluginHeaderMapping(name, value string) bool {
	return value == "$"+privateHeaderSource(name) || value == "$"+legacyPrivateHeaderSource(name)
}

type headerConfigurationError struct{ message string }

func (e *headerConfigurationError) Error() string { return e.message }

type credentialProbeConfig struct {
	Prefix  string                     `json:"prefix"`
	Headers map[string]json.RawMessage `json:"headers"`
}

func (c *Client) readCredentialProbeConfig(ctx context.Context, account *hostAuth) (credentialProbeConfig, error) {
	var data credentialProbeConfig
	if err := ctx.Err(); err != nil {
		return data, err
	}
	var stored struct {
		JSON json.RawMessage `json:"json"`
	}
	if err := c.host("host.auth.get", map[string]string{"auth_index": account.Index}, &stored); err != nil {
		return data, &headerConfigurationError{"无法读取 CPA 凭证请求头规则"}
	}
	if json.Unmarshal(stored.JSON, &data) != nil {
		return data, &headerConfigurationError{"CPA 凭证请求头配置格式无效"}
	}
	return data, nil
}

func (c *Client) prepareProbeModel(ctx context.Context, account *hostAuth, model string, overrides map[string]string) (string, error) {
	c.headersMu.Lock()
	defer c.headersMu.Unlock()
	config, err := c.readCredentialProbeConfig(ctx, account)
	if err != nil {
		return "", err
	}
	if err := c.prepareHeaderMappings(ctx, account, config.Headers, overrides); err != nil {
		return "", err
	}
	// CPA 始终为带前缀的凭证注册限定名。开启强制前缀时，裸模型名无法选中该凭证。
	return qualifyProbeModel(model, config.Prefix), nil
}

func qualifyProbeModel(model, prefix string) string {
	model, prefix = strings.TrimSpace(model), strings.TrimSpace(prefix)
	if prefix != "" && !strings.HasPrefix(model, prefix+"/") {
		return prefix + "/" + model
	}
	return model
}

// prepareHeaderMappings 只更改单个头的自有映射，绝不发送整个凭证或 headers:null。
// 调用方持有 headersMu，在插件内串行检查、写入和复核。
func (c *Client) prepareHeaderMappings(ctx context.Context, account *hostAuth, rules map[string]json.RawMessage, overrides map[string]string) error {
	byName := map[string]string{}
	patch := map[string]string{}
	for name, raw := range rules {
		key := strings.ToLower(name)
		if _, duplicate := byName[key]; duplicate {
			return &headerConfigurationError{"CPA 凭证存在大小写重复请求头规则，请先处理冲突"}
		}
		byName[key] = name
		var value string
		if json.Unmarshal(raw, &value) == nil && isPluginHeaderMapping(name, value) {
			if _, exists := overrides[textproto.CanonicalMIMEHeaderKey(name)]; !exists {
				patch[name] = ""
			}
		}
	}
	for name := range overrides {
		mapping := "$" + privateHeaderSource(name)
		if existing, ok := byName[strings.ToLower(name)]; ok {
			var value string
			if json.Unmarshal(rules[existing], &value) != nil || !isPluginHeaderMapping(name, value) {
				return &headerConfigurationError{fmt.Sprintf("CPA 凭证已有非插件的 %s 请求头规则，已保留原规则并停止覆盖", name)}
			}
			if value == mapping {
				continue
			}
			// 平滑迁移旧版 X-Cpa-Downshift-Hdr-* 映射至当前插件映射名。
			patch[existing] = mapping
			continue
		}
		patch[name] = mapping
	}
	if len(patch) == 0 {
		return nil
	}
	if err := c.request(ctx, "PATCH", "/auth-files/fields", map[string]any{"name": account.ID, "headers": patch}, nil); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return &headerConfigurationError{"CPA 未能保存插件请求头映射，未执行模型请求"}
	}
	updated, err := c.readCredentialProbeConfig(ctx, account)
	if err != nil {
		return err
	}
	for name, expected := range patch {
		found := false
		for current, raw := range updated.Headers {
			if !strings.EqualFold(current, name) {
				continue
			}
			found = true
			var value string
			if json.Unmarshal(raw, &value) != nil || value != expected || expected == "" {
				return &headerConfigurationError{"CPA 请求头映射在保存后发生变化，已停止模型请求"}
			}
		}
		if expected != "" && !found {
			return &headerConfigurationError{"CPA 未返回已保存的请求头映射，已停止模型请求"}
		}
	}
	return nil
}

func (c *Client) quotaRequestHeaders(ctx context.Context, accept string, overrides map[string]string) map[string]string {
	headers := map[string]string{
		"User-Agent":   fallbackCodexUserAgent(),
		"Originator":   "codex_cli_rs",
		"Content-Type": "application/json",
	}
	for name, value := range c.cpaCodexHeaderDefaults(ctx) {
		headers[name] = value
	}
	for name, value := range overrides {
		headers[name] = value
	}
	headers["Accept"] = accept
	return headers
}

// probeRequestHeaders 在未设置插件覆盖时只传递基础内容协商头，让 CPA 内核自行按其 Codex CLI 配置注入默认请求头。
func probeRequestHeaders(overrides map[string]string) http.Header {
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("Accept", "text/event-stream")
	for name, value := range overrides {
		headers.Set(name, value)
		headers.Set(privateHeaderSource(name), value)
	}
	return headers
}
