import { useMemo } from 'react'
import { useStore } from '../../store/store'
import { useSettingsEditor } from '../../store/settingsEditor'
import { isFreeSkipped, lowestQuota } from '../../lib/derive'
import { quotaSentence } from '../../lib/rules'
import { Collapse, Icon, Segmented } from '../ui'
import { SettingsPanel as Panel } from './SettingsPanel'
import { QuotaOverview } from './QuotaOverview'

export function QuotaThresholdPanel() {
  const { settings, update } = useSettingsEditor()
  const credentials = useStore((s) => s.credentials)

  const quotaSummary = useMemo(() => {
    let runnable = 0
    let skipped = 0
    for (const credential of credentials) {
      const lowest = lowestQuota(credential)
      const isSkipped =
        credential.disabled ||
        isFreeSkipped(credential, settings) ||
        credential.auth === 'expired' ||
        credential.quota.status === 'exhausted' ||
        (lowest == null ? settings.quota.unknownPolicy === 'skip' : lowest <= settings.quota.minRemainingPercent)
      if (isSkipped) skipped += 1
      else runnable += 1
    }
    return { runnable, skipped }
  }, [credentials, settings])

  return (
    <Panel
      icon={<Icon.Shield />}
      title="额度门槛"
      desc="用于手动与批量巡检；定时巡检可在「定时巡检」中单独设置门槛。额度不足或未知都不等于模型风控。"
    >
      <div className="field">
        <div className="field-label">仅检测剩余额度高于</div>
        <div className="input-group input-compact">
          <input
            type="number"
            min={0}
            max={100}
            value={settings.quota.minRemainingPercent}
            onChange={(e) => {
              const n = Math.min(100, Math.max(0, Number(e.target.value) || 0))
              update({ quota: { ...settings.quota, minRemainingPercent: n } })
            }}
            aria-label="最低剩余额度阈值"
          />
          <span className="unit">%</span>
        </div>
        <div className="field-hint">
          取该凭证所有已知额度窗口中剩余比例最低的一个来判断；等于阈值时不检测。
        </div>
      </div>

      <div className="field">
        <div className="field-label">额度未知时</div>
        <Segmented
          ariaLabel="额度未知时的处理"
          value={settings.quota.unknownPolicy}
          onChange={(v) => update({ quota: { ...settings.quota, unknownPolicy: v } })}
          options={[
            { value: 'check', label: '仍然检测' },
            { value: 'skip', label: '跳过' },
          ]}
        />
      </div>

      <div className="rule-box">{quotaSentence(settings)}</div>

      <Collapse
        title={`当前额度概览（可检测 ${quotaSummary.runnable} · 跳过 ${quotaSummary.skipped}）`}
        hint="默认折叠"
      >
        <QuotaOverview />
      </Collapse>
    </Panel>
  )
}
