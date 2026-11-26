import type { Settings } from '../../types'
import { useStore, type VerdictFilter } from '../../store/store'
import { refreshCredentialsQuota, saveInspectionOptions, startInspection } from '../../store/actions'
import type { CredentialView } from '../../lib/derive'
import { Dot, HoverCard, Icon, Segmented } from '../ui'
import { QuickConfigPopover } from './QuickConfigPopover'
import { InspectionConcurrency } from './InspectionConcurrency'

function summariseAttention(views: CredentialView[]) {
  const byKind = new Map<string, { kind: string; count: number }>()
  for (const view of views) {
    for (const item of view.attention) {
      const existing = byKind.get(item.kind)
      if (existing) existing.count += 1
      else byKind.set(item.kind, { kind: item.kind, count: 1 })
    }
  }
  const names: Record<string, string> = {
    sync: '分组待同步',
    auth: '认证失效',
    quota: '额度不足',
    availability: '暂不可用',
  }
  return [...byKind.values()].map((v) => ({
    kind: v.kind,
    text: `${v.count} 个${names[v.kind] ?? v.kind}`,
  }))
}

export function OverviewCommandBar({
  counts,
  attentionViews,
  syncFailedIds,
  eligibleCount,
  selectableVisibleIds,
  optionsDisabled,
  isPelicanMode,
  onRetryAllSync,
}: {
  counts: { normal: number; downshift: number; uncertain: number; untested: number; total: number }
  attentionViews: CredentialView[]
  syncFailedIds: string[]
  eligibleCount: number
  selectableVisibleIds: string[]
  optionsDisabled: boolean
  isPelicanMode: boolean
  onRetryAllSync: () => void
}) {
  const settings = useStore((s) => s.settings)
  const filters = useStore((s) => s.filters)
  const connection = useStore((s) => s.connection)
  const capabilities = useStore((s) => s.capabilities)
  const settingsSaving = useStore((s) => s.settingsSaving)
  const starting = useStore((s) => s.starting)
  const hasSettingsDraft = useStore((s) => Boolean(s.settingsDraft))
  const syncing = useStore((s) => s.syncing)
  const quotaRefreshing = useStore((s) => s.quotaRefreshing)
  const excluding = useStore((s) => s.excluding)
  const setFilters = useStore((s) => s.setFilters)

  const verdictPills: {
    key: VerdictFilter
    label: string
    count: number
    tone?: 'normal' | 'downshift' | 'uncertain' | 'empty'
  }[] = [
    { key: 'all', label: '全部', count: counts.total },
    { key: 'normal', label: '正常', count: counts.normal, tone: 'normal' },
    { key: 'downshift', label: '风控', count: counts.downshift, tone: 'downshift' },
    { key: 'uncertain', label: '不确定', count: counts.uncertain, tone: 'uncertain' },
    { key: 'untested', label: '未检测', count: counts.untested, tone: 'empty' },
  ]

  const totalForStrip = Math.max(1, counts.total)

  return (
    <>
      <section className="overview-command-bar" aria-label="巡检总览与操作">
        <div className="verdict-strip" role="group" aria-label="按凭证结论筛选">
          {verdictPills.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`verdict-pill-btn ${item.tone ? `tone-${item.tone}` : ''} ${
                item.key !== 'all' && item.count === 0 ? 'is-zero' : ''
              }`}
              aria-pressed={filters.verdict === item.key}
              onClick={() =>
                setFilters({
                  verdict: item.key === 'all' ? 'all' : filters.verdict === item.key ? 'all' : item.key,
                })
              }
            >
              {item.tone && <Dot tone={item.tone} />}
              <span>{item.label}</span>
              <b>{item.count}</b>
            </button>
          ))}
          {attentionViews.length > 0 && (
            <button
              type="button"
              className="verdict-pill-btn tone-attention"
              aria-pressed={filters.verdict === 'attention'}
              onClick={() => setFilters({ verdict: filters.verdict === 'attention' ? 'all' : 'attention' })}
            >
              <span>需处理</span>
              <b>{attentionViews.length}</b>
            </button>
          )}
        </div>

        <div className="command-controls">
          <QuickConfigPopover disabled={optionsDisabled} />

          <Segmented<Settings['inspectionMethod']>
            ariaLabel="巡检方式"
            value={settings.inspectionMethod}
            onChange={(method) => void saveInspectionOptions({ inspectionMethod: method })}
            options={[
              { value: 'candy', label: '糖果', disabled: optionsDisabled },
              {
                value: 'fingerprint',
                label: '指纹',
                disabled: optionsDisabled || !capabilities.fingerprintAvailable,
              },
              { value: 'pelican', label: '鹈鹕', disabled: optionsDisabled },
            ]}
          />

          <InspectionConcurrency value={settings.concurrency.maxObjects} disabled={optionsDisabled} />

          <HoverCard compact placement="top" content="刷新当前页已开启凭证的剩余额度">
            <button
              type="button"
              className={`btn btn-sm quota-refresh-button${quotaRefreshing.length ? ' is-refreshing' : ''}`}
              disabled={connection !== 'connected' || Boolean(quotaRefreshing.length) || !selectableVisibleIds.length}
              aria-busy={Boolean(quotaRefreshing.length)}
              onClick={() => void refreshCredentialsQuota(selectableVisibleIds)}
            >
              <Icon.Refresh />
              <span>刷新额度</span>
            </button>
          </HoverCard>

          <button
            type="button"
            className="btn btn-sm btn-primary"
            aria-label={isPelicanMode ? '绘制全部' : '巡检全部'}
            aria-description={`符合条件的凭证 ${eligibleCount} 个`}
            disabled={
              connection !== 'connected' ||
              starting ||
              settingsSaving ||
              hasSettingsDraft ||
              excluding.length > 0 ||
              eligibleCount === 0
            }
            onClick={() => startInspection('batch')}
          >
            <Icon.Play />
            <span>{isPelicanMode ? '绘制全部' : '巡检全部'}</span>
            <span className="count-badge" aria-hidden="true">
              {eligibleCount}
            </span>
          </button>
        </div>

        <div className="health-strip" aria-hidden="true">
          {counts.total > 0 && (
            <>
              <span className="health-strip-seg is-normal" style={{ width: `${(counts.normal / totalForStrip) * 100}%` }} />
              <span className="health-strip-seg is-downshift" style={{ width: `${(counts.downshift / totalForStrip) * 100}%` }} />
              <span className="health-strip-seg is-uncertain" style={{ width: `${(counts.uncertain / totalForStrip) * 100}%` }} />
              <span className="health-strip-seg is-untested" style={{ width: `${(counts.untested / totalForStrip) * 100}%` }} />
            </>
          )}
        </div>
      </section>

      {attentionViews.length > 0 && (
        <div className="attention-strip" role="status">
          <Icon.Alert />
          <div className="attention-strip-text">
            <strong>{attentionViews.length} 个凭证需处理</strong>
            <span className="attention-strip-detail">
              {summariseAttention(attentionViews)
                .map((line) => line.text)
                .join(' · ')}
            </span>
          </div>
          <div className="attention-strip-actions">
            {syncFailedIds.length > 0 && (
              <button
                type="button"
                className="btn btn-xs btn-danger"
                disabled={connection !== 'connected' || syncFailedIds.every((id) => syncing.includes(id))}
                onClick={onRetryAllSync}
              >
                <Icon.Sync />
                重试同步 ({syncFailedIds.length})
              </button>
            )}
            <button
              type="button"
              className="btn btn-xs btn-warn"
              onClick={() => setFilters({ verdict: filters.verdict === 'attention' ? 'all' : 'attention' })}
            >
              {filters.verdict === 'attention' ? '显示全部' : '只看需处理'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
