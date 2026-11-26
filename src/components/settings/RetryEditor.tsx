import { useSettingsEditor } from '../../store/settingsEditor'
import { formatSeconds } from '../../lib/format'
import { failureRuleSentence, retrySentence } from '../../lib/rules'
import { Icon, Segmented, Select } from '../ui'
import { SettingsPanel as Panel } from './SettingsPanel'

export function RetryEditor() {
  const { settings, update } = useSettingsEditor()

  return (
    <Panel
      icon={<Icon.Refresh />}
      title="重试与频繁异常判定"
      desc="502/503/429 和无效回答按预算重试；同轮频繁异常可直接归为风控，糖果题答案不符直接判定。"
    >
      <div className="field-row">
        <div className="field">
          <label className="field-label" htmlFor="retry-count">
            最大重试次数
          </label>
          <Select
            id="retry-count"
            ariaLabel="最大重试次数"
            value={String(settings.retry.maxRetries)}
            onChange={(next) => update({ retry: { ...settings.retry, maxRetries: Number(next) } })}
            options={[0, 1, 2, 3, 4].map((n) => ({
              value: String(n),
              label: `${n} 次（本轮共用）`,
            }))}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="retry-delay">
            首次等待
          </label>
          <Select
            id="retry-delay"
            ariaLabel="首次等待"
            value={String(settings.retry.baseDelayMs)}
            onChange={(next) => update({ retry: { ...settings.retry, baseDelayMs: Number(next) } })}
            disabled={settings.retry.maxRetries === 0}
            options={[
              ...new Set([500, 1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, settings.retry.baseDelayMs]),
            ]
              .sort((a, b) => a - b)
              .map((ms) => ({
                value: String(ms),
                label: formatSeconds(ms),
              }))}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="retry-factor">
            退避倍数
          </label>
          <Select
            id="retry-factor"
            ariaLabel="退避倍数"
            value={String(settings.retry.backoffFactor)}
            onChange={(next) => update({ retry: { ...settings.retry, backoffFactor: Number(next) } })}
            disabled={settings.retry.maxRetries === 0}
            options={[1, 1.5, 2, 3].map((f) => ({
              value: String(f),
              label: `×${f}`,
            }))}
          />
        </div>
      </div>

      <div className="field">
        <div className="field-label">单轮异常风控次数</div>
        <Segmented
          ariaLabel="单轮异常风控次数"
          value={String(settings.failureRule.requestThreshold ?? 3)}
          onChange={(value) => update({ failureRule: { ...settings.failureRule, requestThreshold: Number(value) } })}
          options={[2, 3, 4, 5].map((count) => ({ value: String(count), label: `${count} 次` }))}
        />
        <div className="field-hint">同一轮 502、503、429 达到次数门槛就立即归入风控，混合状态也累计。</div>
      </div>

      <div className="field">
        <div className="field-label">跨轮补充规则</div>
        <Segmented
          ariaLabel="连续巡检失败轮数"
          value={String(settings.failureRule.windowRounds)}
          onChange={(v) => update({ failureRule: { ...settings.failureRule, windowRounds: Number(v) } })}
          options={[2, 3, 4].map((n) => ({ value: String(n), label: `连续 ${n} 轮` }))}
        />
        <div className="field-hint">
          未达到单轮次数门槛时，连续多轮仍以 502/503/429 异常结束也会归为风控；完整通过会打断累计。
        </div>
      </div>

      <div className="rule-box">
        <div>
          <b>配置说明：</b>
          {retrySentence(settings.retry)}
        </div>
        <div style={{ marginTop: 4 }}>{failureRuleSentence(settings)}</div>
      </div>
    </Panel>
  )
}
