package classifier

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

func (s *Service) Handler() http.Handler { return http.HandlerFunc(s.serveHTTP) }

type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string { return e.Message }
func bad(message string) error    { return &apiError{400, message} }
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return bad("请求 JSON 无效：" + err.Error())
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return bad("请求只能包含一个 JSON 对象")
	}
	return nil
}
func (s *Service) serveHTTP(w http.ResponseWriter, r *http.Request) {
	var result any = map[string]bool{"ok": true}
	var err error
	path := strings.TrimPrefix(r.URL.Path, apiPrefix)
	switch {
	case path == "/snapshot" && r.Method == "GET":
		result, err = s.Snapshot(r.Context())
	case path == "/checks" && r.Method == "POST":
		var q StartRequest
		err = decode(w, r, &q)
		if err == nil {
			var id string
			if q.Scope == "scheduled" {
				err = bad("定时巡检只由服务端计划触发")
			} else {
				id, err = s.Start(r.Context(), q)
			}
			result = map[string]string{"taskId": id}
		}
	case path == "/quota/refresh" && r.Method == "POST":
		var q QuotaRefreshRequest
		err = decode(w, r, &q)
		if err == nil {
			result, err = s.RefreshQuotas(r.Context(), q)
		}
	case path == "/settings" && r.Method == "PUT":
		var q Settings
		// 旧客户端提交全量设置时可能缺少新字段，保留已配置的统计分页数量。
		s.mu.Lock()
		q.Pagination.Statistics = s.state.Settings.Pagination.Statistics
		s.mu.Unlock()
		err = decode(w, r, &q)
		if err == nil {
			err = s.SaveSettings(r.Context(), q)
		}
	case path == "/routing" && r.Method == "PUT":
		var q RoutingRequest
		err = decode(w, r, &q)
		if err == nil {
			err = s.SaveRouting(r.Context(), q)
		}
	case path == "/exclusions" && r.Method == "POST":
		var q struct {
			CredentialIDs []string `json:"credentialIds"`
			Excluded      *bool    `json:"excluded"`
		}
		err = decode(w, r, &q)
		if err == nil {
			if q.Excluded == nil {
				err = bad("必须指定是否不参与巡检")
			} else {
				err = s.SetExclusions(r.Context(), q.CredentialIDs, *q.Excluded)
			}
		}
	case path == "/status" && r.Method == "PUT":
		var q struct {
			CredentialID string `json:"credentialId"`
			Disabled     *bool  `json:"disabled"`
		}
		err = decode(w, r, &q)
		if err == nil {
			if q.Disabled == nil {
				err = bad("必须指定凭证开启或关闭状态")
			} else {
				err = s.SetCredentialStatus(r.Context(), q.CredentialID, *q.Disabled)
			}
		}
	case path == "/sync" && r.Method == "POST":
		var q struct {
			CredentialID string `json:"credentialId"`
		}
		err = decode(w, r, &q)
		if err == nil {
			result, err = s.Resync(r.Context(), q.CredentialID)
		}
	case path == "/verdict" && r.Method == "POST":
		var q ManualVerdictRequest
		err = decode(w, r, &q)
		if err == nil {
			result, err = s.JudgePelican(r.Context(), q)
		}
	case path == "/tasks" && r.Method == "GET":
		result, err = s.getTask(r.URL.Query().Get("id"))
	case path == "/tasks/cancel" && r.Method == "POST":
		err = s.CancelTask(r.URL.Query().Get("id"))
	case path == "/history/clear" && r.Method == "POST":
		var q struct {
			Confirm bool `json:"confirm"`
		}
		err = decode(w, r, &q)
		if err == nil {
			if !q.Confirm {
				err = bad("必须确认清空历史巡检日志")
			} else {
				err = s.clearInspectionHistory()
			}
		}
	case strings.HasPrefix(path, "/tasks/"):
		id := strings.TrimPrefix(path, "/tasks/")
		if strings.HasSuffix(id, "/cancel") && r.Method == "POST" {
			id = strings.TrimSuffix(id, "/cancel")
			err = s.CancelTask(id)
		} else if r.Method == "GET" && !strings.Contains(id, "/") {
			s.mu.Lock()
			found := false
			for _, t := range s.state.Tasks {
				if t.ID == id {
					result = clone(t)
					found = true
					break
				}
			}
			s.mu.Unlock()
			if !found {
				err = &apiError{404, "任务不存在"}
			}
		} else {
			err = &apiError{405, "请求方法不受支持"}
		}
	default:
		err = &apiError{404, "插件接口不存在"}
	}
	if err != nil {
		status := 502
		var e *apiError
		if errors.As(err, &e) {
			status = e.Status
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, result)
}
func (s *Service) getTask(id string) (Task, error) {
	if id == "" {
		return Task{}, bad("任务 ID 缺失")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.state.Tasks {
		if t.ID == id {
			return clone(t), nil
		}
	}
	return Task{}, &apiError{404, "任务不存在"}
}
