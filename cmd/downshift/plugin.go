package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/classifier"
	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
)

const pluginID = "cpa-gpt-risk-group-plugin"
const version = "0.1.5"
const apiPrefix = "/v0/management/plugins/" + pluginID
const resourcePrefix = "/v0/resource/plugins/" + pluginID

type plugin struct {
	mu       sync.RWMutex
	host     cpa.HostCall
	service  *classifier.Service
	adapter  *cpa.Client
	options  cpa.Options
	stateDir string
}

type rpcError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	HTTPStatus int    `json:"http_status,omitempty"`
}

func (e *rpcError) Error() string   { return e.Message }
func (e *rpcError) StatusCode() int { return e.HTTPStatus }

type envelope struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *rpcError       `json:"error,omitempty"`
}

func (p *plugin) call(method string, raw []byte) (any, error) {
	switch method {
	case "plugin.register", "plugin.reconfigure":
		var req struct {
			Config []byte `json:"config_yaml"`
		}
		if len(raw) > 0 && json.Unmarshal(raw, &req) != nil {
			return nil, errors.New("插件配置请求格式无效")
		}
		if err := p.configure(req.Config); err != nil {
			return nil, err
		}
		return map[string]any{"schema_version": 6, "metadata": map[string]any{"Name": "Codex 风控检测与分类", "Version": version, "Author": "UangSC", "GitHubRepository": "https://github.com/UangSC/cpa-gpt-risk-group-plugin", "Logo": "https://raw.githubusercontent.com/UangSC/cpa-gpt-risk-group-plugin/main/assets/logo.svg", "ConfigFields": []any{
			map[string]any{"Name": "api_base", "Type": "string", "Default": "http://127.0.0.1:8317", "Description": "本机 CPA 官方管理接口地址（仅允许回环 IP）"},
			map[string]any{"Name": "management_key", "Type": "string", "Default": "", "Description": "CPA 管理密钥，仅在插件服务端使用；请勿提交到共享仓库"},
			map[string]any{"Name": "state_dir", "Type": "string", "Default": "", "Description": "插件独立状态目录，留空使用 CPA 旁的 plugin-data 目录"},
		}}, "capabilities": map[string]bool{"management_api": true}}, nil
	case "management.register":
		return managementRegistration()
	case "management.handle":
		return p.management(raw)
	case "plugin.quiesce", "plugin.shutdown":
		p.close()
		return map[string]any{}, nil
	default:
		return nil, &rpcError{Code: "unsupported_method", Message: "插件不支持此操作", HTTPStatus: 400}
	}
}

func envWithFallback(primary, fallback string) string {
	if value := os.Getenv(primary); value != "" {
		return value
	}
	return os.Getenv(fallback)
}

func (p *plugin) configure(raw []byte) error {
	config, err := scalarConfig(raw)
	if err != nil {
		return err
	}
	options := cpa.Options{APIBase: config["api_base"], ManagementKey: config["management_key"]}
	if options.APIBase == "" {
		options.APIBase = "http://127.0.0.1:8317"
	}
	if options.ManagementKey == "" {
		options.ManagementKey = envWithFallback("CPA_RISK_GROUP_MANAGEMENT_KEY", "CPA_DOWNSHIFT_MANAGEMENT_KEY")
	}
	stateDir := config["state_dir"]
	if stateDir == "" {
		stateDir = envWithFallback("CPA_RISK_GROUP_STATE_DIR", "CPA_DOWNSHIFT_STATE_DIR")
	}
	if stateDir == "" {
		executable, err := os.Executable()
		if err != nil {
			return errors.New("无法确定 CPA 插件状态目录")
		}
		stateDir = filepath.Join(filepath.Dir(executable), "plugin-data", pluginID)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.service != nil && p.options == options && p.stateDir == stateDir {
		return nil
	}
	adapter, err := cpa.New(p.host, options)
	if err != nil {
		return err
	}
	if p.service != nil {
		p.service.Close()
		p.adapter.Close()
		p.service = nil
	}
	service, err := classifier.New(adapter, stateDir)
	if err != nil {
		adapter.Close()
		return err
	}
	p.service, p.adapter, p.options, p.stateDir = service, adapter, options, stateDir
	return nil
}

func (p *plugin) close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.service != nil {
		p.service.Close()
		p.adapter.Close()
		p.service = nil
		p.adapter = nil
	}
}
