import { useMemo } from 'react'
import { useSettingsEditor } from '../store/settingsEditor'
import { useStore } from '../store/store'
import { analyzePrefixes, buildModelName, DEFAULT_PREFIXES, stripGroupPrefix } from '../lib/prefix'
import { Chip, Icon, Segmented } from './ui'
import { SettingsPanel as Panel } from './SettingsPanel'

export function PrefixEditor({ wide = false }: { wide?: boolean }) {
  const { settings, update } = useSettingsEditor()
  const credentials = useStore((s) => s.credentials)

  const normal = settings.prefixes.normal
  const downshift = settings.prefixes.downshift
  const analysis = analyzePrefixes(settings.prefixes)

  const models = useMemo(() => {
    const all = [...new Set(credentials.flatMap((c) => c.models.map((m) => stripGroupPrefix(m))))]
    return all.sort()
  }, [credentials])

  const appliedCount = credentials.filter((c) => c.group).length
  const modelCounts = credentials.map((c) => c.models.length).filter((n) => n > 0)
  const modelCountText =
    modelCounts.length === 0
      ? '全部模型'
      : Math.min(...modelCounts) === Math.max(...modelCounts)
        ? `全部 ${modelCounts[0]} 个模型`
        : `全部模型（当前 ${Math.min(...modelCounts)}–${Math.max(...modelCounts)} 个）`

  const prefixFields = (
    <>
      <div className="field-row">
        <div className="field">
          <div className="field-label">
            <Chip tone="normal">正常组</Chip>
            <span className="field-optional">留空 = 不加前缀</span>
          </div>
          <div className={`input-group ${analysis.normal.errors.length ? 'input-err' : ''}`}>
            <input
              value={normal}
              onChange={(e) => update({ prefixes: { ...settings.prefixes, normal: e.target.value } })}
              placeholder="留空（原始模型名）"
              aria-label="正常分组前缀"
              spellCheck={false}
            />
            <span className="unit">前缀</span>
          </div>
          <div>
            {analysis.normal.errors.map((err) => (
              <div key={err} className="field-hint" style={{ color: 'var(--danger)' }}>
                {err}
              </div>
            ))}
            {analysis.normal.warnings.map((w) => (
              <div key={w} className="field-hint" style={{ color: 'var(--warn)' }}>
                {w}
              </div>
            ))}
            {!analysis.normal.errors.length && !analysis.normal.normalized && (
              <div className="field-hint">保存后正常凭证会恢复为原始模型名，不会添加任何前缀。</div>
            )}
          </div>
        </div>

        <div className="field">
          <div className="field-label">
            <Chip tone="downshift">风控组</Chip>
            <span className="field-optional">默认 downshift</span>
          </div>
          <div className={`input-group ${analysis.downshift.errors.length ? 'input-err' : ''}`}>
            <input
              value={downshift}
              onChange={(e) => update({ prefixes: { ...settings.prefixes, downshift: e.target.value } })}
              placeholder={DEFAULT_PREFIXES.downshift}
              aria-label="风控分组前缀"
              spellCheck={false}
            />
            <span className="unit">前缀</span>
          </div>
          <div>
            {analysis.downshift.errors.map((err) => (
              <div key={err} className="field-hint" style={{ color: 'var(--danger)' }}>
                {err}
              </div>
            ))}
            {analysis.downshift.warnings.map((w) => (
              <div key={w} className="field-hint" style={{ color: 'var(--warn)' }}>
                {w}
              </div>
            ))}
          </div>
        </div>
      </div>

      {analysis.warnings
        .filter((w) => !analysis.normal.warnings.includes(w) && !analysis.downshift.warnings.includes(w))
        .map((w) => (
          <div key={w} className="field-hint" style={{ color: 'var(--warn)', marginBottom: 8 }}>
            {w}
          </div>
        ))}

      <div className="settings-actions">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            update({ prefixes: { ...DEFAULT_PREFIXES } })
          }}
        >
          恢复默认前缀
        </button>
      </div>
      {!analysis.valid && (
        <div className="field-hint settings-error" role="status">{analysis.errors[0]}</div>
      )}
    </>
  )

  const prefixPreview = (
    <>
      <div className="field">
        <div className="field-label">注册后的模型名 <span className="field-optional">最多两个示例</span></div>
        <div className="prefix-preview">
          <div className="preview-row">
            <span className="from" aria-label={`检测模型 ${settings.inspectionModel}`}>
              {settings.inspectionModel}
              <span className="preview-tag">检测模型</span>
            </span>
            <Icon.Chevron dir="right" />
            <span>
              <span className="to is-normal">
                {analysis.normal.normalized
                  ? buildModelName(analysis.normal.normalized, settings.inspectionModel)
                  : settings.inspectionModel}
                {!analysis.normal.normalized && <span className="preview-note">（无前缀）</span>}
              </span>
              <br />
              <span className="to is-downshift">
                {buildModelName(analysis.downshift.normalized || DEFAULT_PREFIXES.downshift, settings.inspectionModel)}
              </span>
            </span>
          </div>
          {models
            .filter((m) => m !== settings.inspectionModel)
            .slice(0, 1)
            .map((model) => (
              <div className="preview-row" key={model}>
                <span className="from" aria-label={model}>
                  {model}
                  <span className="preview-tag">同凭证</span>
                </span>
                <Icon.Chevron dir="right" />
                <span>
                  <span className="to is-normal">
                    {analysis.normal.normalized
                      ? buildModelName(analysis.normal.normalized, model)
                      : model}
                  </span>
                  <br />
                  <span className="to is-downshift">
                    {buildModelName(analysis.downshift.normalized || DEFAULT_PREFIXES.downshift, model)}
                  </span>
                </span>
              </div>
            ))}
        </div>
        <div className="field-hint">
          前缀按凭证生效：每个凭证下的{modelCountText}会一起切换，原始模型名始终保留；重复保存不会叠加前缀。
        </div>
      </div>

      {appliedCount > 0 && analysis.valid && (
        <div className="schedule-note">
          <Icon.Info />
          <span>
            保存后有 <b>{appliedCount}</b> 个已分组凭证的模型名会按新规则生效：
            {analysis.normal.normalized
              ? `正常组加 ${analysis.normal.normalized} 前缀`
              : '正常组恢复原始模型名（不加前缀）'}
            ，风控组加 {analysis.downshift.normalized || DEFAULT_PREFIXES.downshift} 前缀。
          </span>
        </div>
      )}
    </>
  )

  return (
    <Panel
      full={wide}
      icon={<Icon.Layers />}
      title="分组策略"
      desc="选择检测结论如何作用于凭证。默认仅检测，也可按结论自动写入模型前缀或调整调度优先级。"
    >
      <div className={wide && settings.routing.mode === 'prefix' ? 'prefix-wide-grid' : undefined}>
        <div className="prefix-wide-main">
          <div className="field">
            <Segmented
              ariaLabel="分组方式"
              value={settings.routing.mode}
              onChange={(mode) => update({ routing: { ...settings.routing, mode } })}
              options={[
                { value: 'none', label: '仅检测' },
                { value: 'prefix', label: '模型前缀' },
                { value: 'priority', label: '仅优先级' },
              ]}
            />
            <p className="field-hint">
              {settings.routing.mode === 'none'
                ? '只记录检测结果与依据，不修改凭证的模型前缀、分组或优先级。'
                : settings.routing.mode === 'prefix'
                  ? '输入前缀名称即可；结尾斜杠在保存时移除，模型名拼接时自动补充分隔符。'
                  : '保持原始模型名称，按凭证所属组应用优先级，权重继承 CPA 当前配置。请在「分组优先级」设置各组的默认值。'}
            </p>
          </div>
          {settings.routing.mode === 'none' && (
            <div className="schedule-note">
              <Icon.Info />
              <span>当前为「仅检测」模式：巡检与保存设置都不会写入或覆盖 CPA 中的模型前缀与优先级。</span>
            </div>
          )}
          {settings.routing.mode === 'prefix' && prefixFields}
        </div>
        {wide && settings.routing.mode === 'prefix' && <div className="prefix-wide-side">{prefixPreview}</div>}
      </div>
      {!wide && settings.routing.mode === 'prefix' && <div style={{ marginTop: 12 }}>{prefixPreview}</div>}
    </Panel>
  )
}
