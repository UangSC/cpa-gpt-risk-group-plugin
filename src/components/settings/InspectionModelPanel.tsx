import { useMemo } from 'react'
import { useStore } from '../../store/store'
import { useSettingsEditor } from '../../store/settingsEditor'
import { collectSettingsModelChoices } from '../../lib/models'
import { Icon, Segmented } from '../ui'
import { SettingsPanel as Panel } from './SettingsPanel'

export function InspectionModelPanel() {
  const { settings, update } = useSettingsEditor()
  const credentials = useStore((s) => s.credentials)

  const models = useMemo(
    () => collectSettingsModelChoices(credentials, settings.prefixes),
    [credentials, settings.prefixes],
  )

  return (
    <Panel icon={<Icon.Cpu />} title="巡检模型" desc="所有凭证都用这一个模型做检测，检测结论按凭证分类。">
      <div className="field">
        <div className="field-label">检测使用的模型</div>
        <input
          className="input mono"
          list="model-options"
          value={settings.inspectionModel}
          onChange={(e) => update({ inspectionModel: e.target.value.trim() })}
          placeholder="gpt-6.1-sol"
          aria-label="检测使用的模型"
          spellCheck={false}
        />
        <datalist id="model-options">
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        <div className="field-hint">
          默认 <code className="inline-code">gpt-6.1-sol</code>。切换模型后，每个凭证会有一条新的检测记录；
          旧记录仍保留在历史里。分组按设置中的策略应用于凭证。
        </div>
      </div>

      <div className="field">
        <div className="field-label">思考程度</div>
        <Segmented
          ariaLabel="巡检模型思考程度"
          value={settings.reasoningEffort}
          onChange={(reasoningEffort) => update({ reasoningEffort })}
          options={[
            { value: 'low', label: '低 (low)' },
            { value: 'medium', label: '中 (medium)' },
            { value: 'high', label: '高 (high)' },
          ]}
        />
        <div className="field-hint">默认低（low），确认保存后用于每次巡检请求。</div>
      </div>

      <div className="field">
        <div className="field-label">可选模型</div>
        <div className="chips-input">
          {models.map((model) => (
            <button
              key={model}
              type="button"
              className="chip-toggle"
              aria-pressed={settings.inspectionModel === model}
              onClick={() => update({ inspectionModel: model })}
            >
              {model}
            </button>
          ))}
        </div>
        <div className="field-hint">
          来自当前凭证列表中的聊天模型（已过滤生图、决策等非聊天模型），也可以直接输入其它模型名。
        </div>
      </div>
    </Panel>
  )
}
