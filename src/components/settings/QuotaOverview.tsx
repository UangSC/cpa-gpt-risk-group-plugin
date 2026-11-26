import { isFreeSkipped, lowestQuota } from '../../lib/derive'
import { useSettingsEditor } from '../../store/settingsEditor'
import { useStore } from '../../store/store'
import { PlanMark, QuotaMeter, SecretName } from '../ui'

export function QuotaOverview() {
  const credentials = useStore((state) => state.credentials)
  const { settings } = useSettingsEditor()
  return (
    <div className="quota-overview" role="list" aria-label="当前额度概览">
      {credentials.map((credential) => {
        const lowest = lowestQuota(credential)
        const freeSkipped = isFreeSkipped(credential, settings)
        const skipped = credential.disabled || freeSkipped || credential.auth === 'expired' || credential.quota.status === 'exhausted' ||
          (lowest == null ? settings.quota.unknownPolicy === 'skip' : lowest <= settings.quota.minRemainingPercent)
        return (
          <div className="quota-overview-row" role="listitem" key={credential.id}>
            <div className="quota-overview-ident">
              <PlanMark plan={credential.plan} size="sm" />
              <SecretName name={credential.name} />
            </div>
            <span className={`quota-overview-state ${skipped ? 'is-skipped' : ''}`}>
              {credential.disabled ? 'CPA 已停用' : freeSkipped ? 'Free 默认跳过' : credential.auth === 'expired' ? '认证失效' : skipped ? '跳过' : lowest == null ? '未知 · 检测' : '可检测'}
            </span>
            <QuotaMeter windows={credential.quota.windows} threshold={settings.quota.minRemainingPercent} />
            <span className="quota-overview-min">{lowest == null ? '额度未知' : `最低 ${lowest}%`}</span>
          </div>
        )
      })}
      {credentials.length === 0 && <p className="field-hint">暂无凭证</p>}
    </div>
  )
}
