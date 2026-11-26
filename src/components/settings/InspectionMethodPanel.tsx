import { useStore } from '../../store/store'
import { useSettingsEditor } from '../../store/settingsEditor'
import { getInspectionMethod, listInspectionMethods } from '../../inspection'
import { restoreManualReminder } from '../../lib/manualInspectionConsent'
import { restoreWeightZeroWarning } from '../../lib/weightZeroWarning'
import { DEFAULT_FINGERPRINT_THRESHOLD_PERCENT } from '../../data/defaults'
import { Icon, Segmented, Switch } from '../ui'
import { SettingsPanel as Panel } from './SettingsPanel'

export function InspectionMethodPanel() {
  const { settings, update } = useSettingsEditor()
  const capabilities = useStore((s) => s.capabilities)

  return (
    <Panel icon={<Icon.Cog />} title="检测方式" desc="每轮只采用一种检测方式，默认使用糖果题。">
      <div className="field">
        <div className="method-selector-row">
          <Segmented
            ariaLabel="选择检测项目"
            value={settings.inspectionMethod}
            onChange={(inspectionMethod) => update({ inspectionMethod })}
            options={listInspectionMethods().map((method) => ({
              value: method.id,
              label: method.label,
              disabled: method.id === 'fingerprint' && !capabilities.fingerprintAvailable,
            }))}
          />
          {settings.inspectionMethod === 'fingerprint' && (
            <div className="method-threshold-inline">
              <label className="method-threshold-label" htmlFor="fingerprint-threshold">
                判定阈值
              </label>
              <div className="input-group method-threshold-input">
                <input
                  id="fingerprint-threshold"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={
                    Number.isFinite(settings.fingerprintThresholdPercent) ? settings.fingerprintThresholdPercent : ''
                  }
                  onChange={(event) => update({ fingerprintThresholdPercent: event.currentTarget.valueAsNumber })}
                  aria-label="模型指纹判定阈值"
                  aria-describedby="method-description-hint"
                />
                <span className="unit">%</span>
              </div>
            </div>
          )}
        </div>
        <div className="field-hint method-description-hint" id="method-description-hint">
          {settings.inspectionMethod === 'fingerprint'
            ? `无放回抽取 3 道数字序列挑战，目标参考匹配且目标概率严格高于阈值（默认 ${DEFAULT_FINGERPRINT_THRESHOLD_PERCENT}%）才判正常。所有题目共用本轮重试次数。`
            : `${getInspectionMethod(settings.inspectionMethod).description} 所有题目共用本轮重试次数。`}
        </div>
      </div>

      <div className="field">
        <Switch
          checked={settings.inspectFreeAccounts}
          onChange={(inspectFreeAccounts) => update({ inspectFreeAccounts })}
          label="强制巡检 Free 账号"
        />
        <div className="field-hint">
          默认关闭：Free 账号仅展示状态与月限额度，不参与手动、批量及定时巡检；开启后将纳入巡检范围。
        </div>
      </div>

      <div className="field">
        <div className="field-label">同时检测的凭证数</div>
        <div className="input-group input-compact">
          <input
            type="number"
            min={1}
            max={9}
            value={settings.concurrency.maxObjects}
            onChange={(e) => {
              const n = Math.min(9, Math.max(1, Number(e.target.value) || 1))
              update({ concurrency: { maxObjects: n } })
            }}
            aria-label="同时检测的对象数"
          />
          <span className="unit">个 / 批</span>
        </div>
        <div className="field-hint">
          同时进行的对象数，同一凭证不会重复入队。
          {capabilities.availabilityKnown
            ? '会话中的凭证会等待空闲后再加入。'
            : 'CPA 当前未提供活跃会话计数，服务端按可用状态执行。'}
        </div>
      </div>

      <div className="field">
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              restoreManualReminder()
              useStore.getState().notify({
                tone: 'success',
                title: '已恢复手动巡检提醒',
                detail: '下次单个或批量手动巡检会再次显示配置修改提示。',
              })
            }}
          >
            恢复手动巡检提醒
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              restoreWeightZeroWarning()
              useStore.getState().notify({
                tone: 'success',
                title: '已恢复权重为 0 提醒',
                detail: '下次将凭证权重设为 0 时会再次弹出确认提醒。',
              })
            }}
          >
            恢复权重为 0 提醒
          </button>
        </div>
      </div>
    </Panel>
  )
}
