package cpa

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const QuotaRefreshConcurrency = 4

const maxResponseBytes = 8 << 20

// Options contains server-only configuration. ManagementKey is never projected to UI.
type Options struct{ APIBase, ManagementKey string }

type Client struct {
	host                   HostCall
	mu                     sync.RWMutex
	headersMu              sync.Mutex
	apiBase, managementKey string
	http                   *http.Client
	quotaCache             map[string]Quota
	quotaSlots             chan struct{}
}

func New(host HostCall, opts Options) (*Client, error) {
	if host == nil {
		return nil, errors.New("CPA 宿主回调不可用")
	}
	if opts.APIBase == "" {
		opts.APIBase = "http://127.0.0.1:8317"
	}
	u, err := url.Parse(opts.APIBase)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("CPA API 地址必须是本机回环 HTTP 地址")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return nil, errors.New("CPA API 地址必须使用回环 IP，不能使用外部地址或域名")
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, MaxIdleConns: 8, IdleConnTimeout: 60 * time.Second}
	return &Client{host: host, apiBase: strings.TrimRight(opts.APIBase, "/"), managementKey: opts.ManagementKey, quotaCache: map[string]Quota{}, quotaSlots: make(chan struct{}, QuotaRefreshConcurrency), http: &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("CPA 管理接口不允许重定向") }}}, nil
}

func (c *Client) Close() { c.http.CloseIdleConnections() }

// RememberManagementKey is used only after CPA has authenticated a management request.
func (c *Client) RememberManagementKey(headers http.Header) {
	key := headers.Get("Authorization")
	if scheme, value, ok := strings.Cut(key, " "); ok && strings.EqualFold(scheme, "Bearer") {
		key = value
	}
	if key == "" {
		key = headers.Get("X-Management-Key")
	}
	if strings.TrimSpace(key) == "" || len(key) > 8192 || strings.ContainsAny(key, "\r\n") {
		return
	}
	c.mu.Lock()
	c.managementKey = key
	c.mu.Unlock()
}

func (c *Client) request(ctx context.Context, method, endpoint string, body any, out any) error {
	c.mu.RLock()
	base, key := c.apiBase, c.managementKey
	c.mu.RUnlock()
	if key == "" {
		return errors.New("插件未配置 CPA 管理密钥，无法读取官方管理接口")
	}
	var raw []byte
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, base+"/v0/management"+endpoint, bytes.NewReader(raw))
	if err != nil {
		return errors.New("CPA 管理请求创建失败")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("无法连接 CPA 官方管理接口")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		// A stale key can cause CPA to temporarily block further loopback requests.
		c.mu.Lock()
		if c.managementKey == key {
			c.managementKey = ""
		}
		c.mu.Unlock()
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return errors.New("CPA 管理响应读取失败或超过限制")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("CPA 官方管理接口返回 HTTP %d", resp.StatusCode)
	}
	if out != nil && json.Unmarshal(data, out) != nil {
		return errors.New("CPA 官方管理接口返回无效 JSON")
	}
	return nil
}
