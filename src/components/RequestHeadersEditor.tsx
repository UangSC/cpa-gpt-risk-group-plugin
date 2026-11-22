import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { useSettingsEditor } from '../store/settingsEditor'
import {
  deserializeHeaderOverrideRows,
  DRAFT_JSON_ERROR_KEY,
  headerOverrideErrors,
  serializeHeaderOverrideRows,
  type HeaderOverrideRow,
} from '../lib/settingsDraft'
import { SettingsPanel } from './SettingsPanel'
import { Icon, Segmented } from './ui'

const HEADER_ORDER = ['user-agent', 'originator', 'version', 'content-type', 'accept']

function formatHeadersJson(rows: HeaderOverrideRow[]): string {
  const obj: Record<string, string> = {}
  for (const row of rows) {
    if (row.name.trim()) obj[row.name] = row.value
  }
  return Object.keys(obj).length ? JSON.stringify(obj, null, 2) : '{}'
}

function parseHeadersJson(
  text: string,
  startId: number,
): { ok: true; rows: HeaderOverrideRow[] } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, rows: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '无法解析 JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '根节点必须为 JSON 对象（例如 {"Header-Name": "Value"}）' }
  }
  const entries = Object.entries(parsed as Record<string, unknown>)
  for (const [key, value] of entries) {
    if (typeof value !== 'string') {
      return { ok: false, error: `请求头「${key}」的值必须是字符串` }
    }
  }
  return {
    ok: true,
    rows: entries.map(([name, value], idx) => ({
      id: `header-${startId + idx}`,
      name,
      value: value as string,
    })),
  }
}

export function RequestHeadersEditor() {
  const { settings, update } = useSettingsEditor()
  const profile = useStore((state) => state.requestHeaderProfile)
  const saving = useStore((state) => state.settingsSaving)
  const connected = useStore((state) => state.connection === 'connected')
  const [rows, setRows] = useState<HeaderOverrideRow[]>(() => deserializeHeaderOverrideRows(settings.headerOverrides))
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState<string>(() => formatHeadersJson(rows))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const nextId = useRef(rows.length)
  const incoming = JSON.stringify(settings.headerOverrides ?? {})
  const published = useRef(incoming)

  useEffect(() => {
    const hasSentinel = Object.prototype.hasOwnProperty.call(settings.headerOverrides ?? {}, DRAFT_JSON_ERROR_KEY)
    if (incoming !== published.current && !hasSentinel) {
      const latest = deserializeHeaderOverrideRows(settings.headerOverrides)
      setRows(latest)
      setJsonText(formatHeadersJson(latest))
      setJsonError(null)
      nextId.current = Math.max(nextId.current, latest.length)
      published.current = incoming
    }
  }, [incoming, settings.headerOverrides])

  const commit = (next: HeaderOverrideRow[]) => {
    const headers = serializeHeaderOverrideRows(next)
    setRows(next)
    published.current = JSON.stringify(headers)
    update({ headerOverrides: headers })
  }

  const handleModeSwitch = (nextMode: 'form' | 'json') => {
    if (nextMode === mode) return
    if (nextMode === 'json') {
      setJsonText(formatHeadersJson(rows))
      setJsonError(null)
      setMode('json')
    } else {
      if (jsonError) {
        setJsonError(null)
        commit(rows)
      }
      setMode('form')
    }
  }

  const handleJsonChange = (text: string) => {
    setJsonText(text)
    const parsed = parseHeadersJson(text, nextId.current + 1)
    if (parsed.ok) {
      nextId.current += parsed.rows.length + 1
      setJsonError(null)
      commit(parsed.rows)
    } else {
      setJsonError(parsed.error)
      const sentinel = { [DRAFT_JSON_ERROR_KEY]: parsed.error }
      published.current = JSON.stringify(sentinel)
      update({ headerOverrides: sentinel })
    }
  }

  const handleFormatJson = () => {
    if (jsonError) return
    setJsonText(formatHeadersJson(rows))
  }

  const handleFillExample = () => {
    const exampleObj: Record<string, string> = profile?.defaultHeaders?.['User-Agent']
      ? { 'User-Agent': profile.defaultHeaders['User-Agent'], 'X-Custom-Header': 'example-value' }
      : { 'X-Custom-Header': 'example-value' }
    handleJsonChange(JSON.stringify(exampleObj, null, 2))
  }

  const handleClear = () => {
    setJsonError(null)
    setJsonText('{}')
    commit([])
  }

  const errors = jsonError
    ? [`JSON 格式错误：${jsonError}`]
    : headerOverrideErrors(serializeHeaderOverrideRows(rows), profile?.managedHeaders)
  const disabled = saving || !connected
  const defaultHeaders = Object.entries(profile?.defaultHeaders ?? {}).sort(([a], [b]) => {
    const rank = (name: string) => { const index = HEADER_ORDER.indexOf(name.toLowerCase()); return index < 0 ? HEADER_ORDER.length : index }
    return rank(a) - rank(b) || a.localeCompare(b)
  })

  return (
    <SettingsPanel icon={<Icon.Doc />} title="请求头覆盖" desc="巡检与额度刷新共用已保存的覆盖项。CPA 管理认证与路由头，巡检遇到同名凭证规则会报告冲突。">
      <div className="request-header-profile">
        <span className="request-header-profile-icon"><Icon.Doc /></span>
        <div>
          <strong>
            {profile?.source === 'cpa-config' ? '默认沿用 CPA 内核配置的 Codex CLI 请求头' : '默认沿用 CPA 内核的 Codex CLI 请求头'}
            {profile?.codexCliVersion ? `（${profile.codexCliVersion}）` : ''}
          </strong>
          <p>未设置插件请求头覆盖时，巡检不附加插件硬编码头，直接交由 CPA 内核按其 Codex CLI 配置发送；额度查询同步沿用 CPA 内核配置。修改先保留为草稿，确认保存后生效。</p>
        </div>
      </div>

      <details className="request-header-defaults">
        <summary>默认请求头 <span>只读</span></summary>
        {defaultHeaders.length || profile
          ? (
            <dl>
              {defaultHeaders.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
              {profile && profile.source !== 'cpa-config' && (
                <div key="cpa-core-codex-cli">
                  <dt>Codex CLI 标识头</dt>
                  <dd>由 CPA 内核自动注入（与 CPA 内核 Codex CLI 配置保持一致）</dd>
                </div>
              )}
            </dl>
          )
          : <p>连接 CPA 后显示当前默认请求头。</p>}
      </details>

      <div className="request-header-editor-heading">
        <strong>覆盖项</strong>
        <div className="request-header-editor-head-right">
          <span>{rows.length} / 32</span>
          <Segmented
            ariaLabel="请求头编辑模式"
            value={mode}
            onChange={handleModeSwitch}
            options={[
              { value: 'form', label: '键值对' },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </div>
      </div>

      {mode === 'json' ? (
        <>
          <textarea
            className="input mono request-header-json"
            rows={6}
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
            aria-label="请求头覆盖 JSON"
            aria-invalid={Boolean(jsonError || errors.length)}
            placeholder={'{\n  "X-Custom-Header": "value"\n}'}
            value={jsonText}
            onChange={(event) => handleJsonChange(event.target.value)}
          />
          <div className="request-header-actions">
            <button type="button" className="btn btn-sm" disabled={disabled || Boolean(jsonError) || rows.length === 0} onClick={handleFormatJson}>
              格式化 JSON
            </button>
            {rows.length === 0 && !jsonError && (
              <button type="button" className="btn btn-sm btn-ghost" disabled={disabled} onClick={handleFillExample}>
                填入示例
              </button>
            )}
            {(rows.length > 0 || jsonError || (jsonText.trim() !== '' && jsonText.trim() !== '{}')) && (
              <button type="button" className="btn btn-sm btn-ghost" disabled={disabled} onClick={handleClear}>
                清空覆盖，恢复默认
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {rows.length > 0 ? (
            <div className="request-header-rows">
              {rows.map((row, index) => (
                <div className="request-header-row" key={row.id}>
                  <div className="request-header-name">
                    <label htmlFor={`header-name-${row.id}`}>请求头名称</label>
                    <input
                      id={`header-name-${row.id}`}
                      className="input mono"
                      value={row.name}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={disabled}
                      aria-label={`第 ${index + 1} 项请求头名称`}
                      placeholder="例如 User-Agent 或 X-Custom-Header"
                      onChange={(event) => commit(rows.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item))}
                    />
                  </div>
                  <div className="request-header-value">
                    <label htmlFor={`header-value-${row.id}`}>覆盖值</label>
                    <input
                      id={`header-value-${row.id}`}
                      className="input mono"
                      value={row.value}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={disabled}
                      aria-label={`第 ${index + 1} 项请求头覆盖值`}
                      placeholder="请输入覆盖值"
                      onChange={(event) => commit(rows.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))}
                    />
                  </div>
                  <button
                    type="button"
                    className="icon-btn request-header-remove"
                    disabled={disabled}
                    aria-label={`删除第 ${index + 1} 项请求头覆盖`}
                    onClick={() => commit(rows.filter((item) => item.id !== row.id))}
                  >
                    <Icon.Close />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="request-header-empty">未设置覆盖项，默认沿用 CPA 内核的 Codex CLI 请求头配置。</div>
          )}
          <div className="request-header-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={disabled || rows.length >= 32}
              onClick={() => commit([...rows, { id: `header-${++nextId.current}`, name: '', value: '' }])}
            >
              添加请求头覆盖
            </button>
            {rows.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" disabled={disabled} onClick={handleClear}>
                清空覆盖，恢复默认
              </button>
            )}
          </div>
        </>
      )}

      {errors.length > 0 && <div className="request-header-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
      <p className="request-header-managed-note">认证、账号标识、会话和传输请求头保持 CPA 管理；请求头名称不区分大小写，值须为字符串。删除或清空即可恢复默认。</p>
    </SettingsPanel>
  )
}
