package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/web"
)

type managementRequest struct {
	Method, Path string
	Headers      http.Header
	Query        url.Values
	Body         []byte
	CallbackID   string `json:"host_callback_id"`
}
type managementResponse struct {
	StatusCode int
	Headers    http.Header
	Body       []byte
}

func managementRegistration() (any, error) {
	routes := []map[string]string{}
	// CPA plugin management routes are fixed paths and reject :param / *wildcard.
	for _, item := range [][2]string{{"GET", "/snapshot"}, {"POST", "/checks"}, {"POST", "/quota/refresh"}, {"GET", "/tasks"}, {"POST", "/tasks/cancel"}, {"POST", "/sync"}, {"POST", "/verdict"}, {"PUT", "/settings"}, {"PUT", "/routing"}, {"POST", "/exclusions"}, {"PUT", "/status"}, {"POST", "/history/clear"}} {
		routes = append(routes, map[string]string{"method": item[0], "path": apiPrefix + item[1]})
	}
	resources := []map[string]string{{"path": "/ui", "menu": "Codex 风控检测与分类", "description": "Codex 凭证糖果题、模型指纹与鹈鹕 HTML/SVG 动画巡检、人工分组及路由管理"}}
	err := fs.WalkDir(web.Assets(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			resources = append(resources, map[string]string{"path": "/" + name})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"routes": routes, "resources": resources}, nil
}

func (p *plugin) management(raw []byte) (any, error) {
	var req managementRequest
	if json.Unmarshal(raw, &req) != nil {
		return jsonResponse(400, "请求格式无效"), nil
	}
	// ABI hosts may pass a resource's relative registered path rather than its full URL.
	if req.Method == "GET" && (req.Path == "/" || req.Path == "/ui" || req.Path == "/index.html" || strings.HasPrefix(req.Path, "/assets/")) {
		req.Path = resourcePrefix + req.Path
	}
	if strings.HasPrefix(req.Path, resourcePrefix+"/") {
		return resourceResponse(req.Path), nil
	}
	// Hosts historically passed either absolute or relative registered management paths.
	if strings.HasPrefix(req.Path, "/plugins/"+pluginID+"/") {
		req.Path = "/v0/management" + req.Path
	}
	if strings.HasPrefix(req.Path, "/v8/management/plugins/"+pluginID+"/") {
		req.Path = "/v0/management" + strings.TrimPrefix(req.Path, "/v8/management")
	}
	if !strings.HasPrefix(req.Path, apiPrefix+"/") {
		return jsonResponse(404, "接口不存在"), nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	service, adapter := p.service, p.adapter
	if service == nil {
		return jsonResponse(503, "插件服务尚未初始化"), nil
	}
	adapter.RememberManagementKey(req.Headers)
	u := &url.URL{Path: req.Path, RawQuery: req.Query.Encode()}
	httpReq, err := http.NewRequestWithContext(context.Background(), req.Method, u.String(), bytes.NewReader(req.Body))
	if err != nil {
		return jsonResponse(400, "请求格式无效"), nil
	}
	httpReq.Header = req.Headers.Clone()
	recorder := &responseWriter{header: make(http.Header)}
	service.Handler().ServeHTTP(recorder, httpReq)
	if recorder.code == 0 {
		recorder.code = 200
	}
	return managementResponse{StatusCode: recorder.code, Headers: recorder.header, Body: recorder.body.Bytes()}, nil
}

type responseWriter struct {
	header http.Header
	body   bytes.Buffer
	code   int
}

func (w *responseWriter) Header() http.Header { return w.header }
func (w *responseWriter) WriteHeader(code int) {
	if w.code == 0 {
		w.code = code
	}
}
func (w *responseWriter) Write(data []byte) (int, error) {
	if w.code == 0 {
		w.code = 200
	}
	return w.body.Write(data)
}
func jsonResponse(code int, message string) managementResponse {
	body, _ := json.Marshal(map[string]string{"error": message})
	return managementResponse{StatusCode: code, Headers: http.Header{"Content-Type": {"application/json; charset=utf-8"}, "Cache-Control": {"no-store"}}, Body: body}
}
func resourceResponse(requestPath string) managementResponse {
	name := strings.TrimPrefix(requestPath, resourcePrefix+"/")
	if name == "" || name == "ui" {
		name = "index.html"
	}
	if !fs.ValidPath(name) || path.Clean(name) != name {
		return jsonResponse(404, "资源不存在")
	}
	body, err := fs.ReadFile(web.Assets(), name)
	if err != nil {
		return jsonResponse(404, "资源不存在")
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return managementResponse{StatusCode: 200, Headers: http.Header{"Content-Type": {contentType}, "Cache-Control": {"no-cache"}, "X-Content-Type-Options": {"nosniff"}, "Referrer-Policy": {"same-origin"}}, Body: body}
}

var _ io.Writer = (*responseWriter)(nil)
