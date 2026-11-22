// Package cpa adapts the public CPA plugin callbacks and management API.
package cpa

import "context"

// DefaultProbeInstructions 保留糖果题原有的系统指令；指纹挑战使用参考环境的原文。
const DefaultProbeInstructions = "Answer the user's question precisely."

type QuotaWindow struct {
	Key              string   `json:"key"`
	RemainingPercent *float64 `json:"remainingPercent"`
	ResetsAt         *string  `json:"resetsAt"`
}

type Quota struct {
	Windows    []QuotaWindow `json:"windows"`
	Status     string        `json:"status"`
	ObservedAt string        `json:"observedAt,omitempty"`
}

// QuotaRefresher 使用宿主官方管理接口主动读取额度；不要求所有适配器实现。
type QuotaRefresher interface {
	RefreshQuota(context.Context, string, map[string]string) (Quota, error)
	RestoreQuota(string, Quota)
}

// StatusUpdater 通过 CPA 官方管理接口同步凭证的启用/停用状态。
type StatusUpdater interface {
	SetDisabled(context.Context, string, bool) error
}

// HeaderProfileProvider 读取 CPA 内核当前生效的 Codex CLI 请求头默认配置。
type HeaderProfileProvider interface {
	RequestHeaderProfile(context.Context) RequestHeaderProfile
}

// Credential is a sanitized host record; it never carries authentication secrets.
type Credential struct {
	ID, Name, File, Plan, AuthIndex, Prefix string
	Priority, Weight                        int
	Disabled                                bool
	Unavailable                             bool
	Auth, Availability                      string
	BusySessions                            int
	Models                                  []string
	Quota                                   Quota
}

type ProbeReply struct {
	Status                    int
	Answer                    string
	InputTokens, OutputTokens int
	Error                     string
	DurationMs                int64
	// LocalState 表示请求在宿主本地守卫处结束，未收到上游 HTTP 状态。
	LocalState   bool
	RetryAfterMs int64
}

type Fields struct {
	Prefix   *string
	Priority *int
	Weight   *int
}

type Adapter interface {
	ListCredentials(context.Context) ([]Credential, error)
	RoutingStrategy(context.Context) (string, error)
	UpdateFields(context.Context, string, Fields) error
	Probe(context.Context, string, string, string, string, string, map[string]string) (ProbeReply, error)
}

type HostCall func(string, any, any) error
