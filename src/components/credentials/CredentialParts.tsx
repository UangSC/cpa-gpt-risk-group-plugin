import { type Settings } from '../../types'
import { lastRound, lowestQuota, statusOf, type StatusKey, type CredentialView } from '../../lib/derive'
import { STATUS_TOOLTIP_DELAY_MS } from '../../lib/tooltipInteraction'
import { Chip, HoverCard, Icon, QuotaMeter } from '../ui'
import { useStore } from '../../store/store'
import { refreshCredentialsQuota } from '../../store/actions'
import { ExclusionIcon } from '../ExclusionDrawer'

/**
 * User-facing credential status. Four states only: 正常 / 降档 / 未知 / 异常.
 * A finished verdict with a failed group write is *not* "normal + pending": it surfaces as
 * 异常, with the retry offered as an action instead of a second status label.
 */

const STATUS_TEXT: Record<StatusKey, string> = {
  normal: '正常',
  downshift: '降档',
  unknown: '未知',
  error: '异常',
}


export interface CredentialRuntime {
  settings: Settings
  /** Credential ids with a running check. */
  activeCredentialIds: string[]
  now: number
  onRetest: (credentialId: string) => void
  onOpenDetail: (targetId: string, roundId?: string | null) => void
  onResync: (credentialId: string) => void
  onExclude?: (credentialId: string) => void
  exclusionBusyCredentialIds?: string[]
  canInspect?: boolean
  canChangeParticipation?: boolean
}

export function stop(e: { stopPropagation: () => void }) {
  e.stopPropagation()
}

/* ------------------------------------------------------------ shared bits */

/** The single four-state status chip used by cards (and the list verdict column). */
export function StatusPill({ view, size }: { view: CredentialView; size?: 'sm' }) {
  const key = statusOf(view)
  const detail = view.attention.find((a) => a.kind === 'sync' || a.kind === 'auth' || a.kind === 'availability')?.detail ?? view.reason ?? '尚未取得完整检测结果，请执行测试后查看详情。'
  const interactive = key === 'unknown' || key === 'error'
  const Tag = interactive ? 'button' : 'span'
  const pill = (
    <Tag type={interactive ? 'button' : undefined}
      className={`verdict verdict-${key} status-pill ${size === 'sm' ? 'is-sm' : ''}`}
      aria-label={interactive ? `${STATUS_TEXT[key]}状态说明` : undefined}
      onClick={interactive ? stop : undefined}
    >
      <span className={`dot dot-${key === 'unknown' ? 'uncertain' : key === 'error' ? 'downshift' : key}`} aria-hidden="true" />
      {STATUS_TEXT[key]}
    </Tag>
  )
  return interactive
    ? <HoverCard showDelay={STATUS_TOOLTIP_DELAY_MS} fadeOnHide={false}
        content={<><div className="tip-title">{STATUS_TEXT[key]}状态说明</div><p>{detail}</p></>}>
        {pill}
      </HoverCard>
    : pill
}

export function GroupCell({ view, settings }: { view: CredentialView; settings: Settings }) {
  const { credential } = view
  const label = credential.group === 'normal' ? '正常' : credential.group === 'downshift' ? '降档' : '未分组'
  const prefixKnown = typeof credential.prefix === 'string'
  const prefix = prefixKnown ? credential.prefix!.trim().replace(/\/+$/g, '') : credential.group ? settings.prefixes[credential.group] : null
  return <div className="group-cell is-list"><div className="group-line">
    <span className={`group-dot is-${credential.group ?? 'none'}`} aria-hidden="true" />
    <span className={`group-prefix is-${credential.group ?? 'none'}`}>
      {prefixKnown ? prefix || '无前缀' : settings.routing.mode === 'priority' ? label : credential.group ? prefix || '无前缀' : '未分组'}
    </span>
  </div></div>
}

function UnknownQuotaButton({ credentialId }: { credentialId: string }) {
  const disabled = useStore((state) => state.connection !== 'connected' || state.quotaRefreshing.length > 0)
  const refreshing = useStore((state) => state.quotaRefreshing.includes(credentialId))
  return <button type="button" className="btn btn-sm quota-unknown-button"
    aria-description="点击刷新此凭证的额度" aria-busy={refreshing} disabled={disabled}
    onClick={(event) => { stop(event); void refreshCredentialsQuota([credentialId]) }}>
    <Icon.Refresh />
    {refreshing ? '刷新中…' : '额度未知'}
  </button>
}

export function QuotaCell({ view, settings, refreshUnknown = false }: {
  view: CredentialView; settings: Settings; refreshUnknown?: boolean
}) {
  const lowest = lowestQuota(view.credential)
  const exhausted = view.credential.quota.status === 'exhausted'
  const blocked = lowest != null && lowest <= settings.quota.minRemainingPercent
  if (refreshUnknown && !exhausted && lowest == null) {
    return <div className="quota-cell"><UnknownQuotaButton credentialId={view.credential.id} /></div>
  }
  return (
    <div className="quota-cell" data-quota-empty={view.credential.quota.windows.length === 0 ? 'true' : undefined}>
      <QuotaMeter windows={view.credential.quota.windows} threshold={settings.quota.minRemainingPercent} />
      {exhausted ? (
        <span className="quota-warn">额度不足 · 跳过</span>
      ) : blocked ? (
        <span className="quota-warn">低于门槛 · 跳过</span>
      ) : lowest == null ? (
        <span className="quota-warn">额度未知</span>
      ) : null}
    </div>
  )
}

/** Credential-state flag (auth). Quota problems are already expressed in the quota cell. */
export function StateChips({ view }: { view: CredentialView }) {
  const auth = view.attention.find((a) => a.kind === 'auth')
  if (!auth) return null
  return (
    <HoverCard content={auth.detail}>
      <Chip tone="downshift">认证失效</Chip>
    </HoverCard>
  )
}

export function Actions({
  view,
  runtime,
  compact = false,
}: {
  view: CredentialView
  runtime: CredentialRuntime
  compact?: boolean
}) {
  const busy = runtime.activeCredentialIds.includes(view.credential.id)
  const expired = view.credential.auth === 'expired'
  const excluding = useStore((state) => state.excluding.includes(view.credential.id))
  const exclusionBusy = !!runtime.exclusionBusyCredentialIds?.includes(view.credential.id)
  const actionHint = (label: string, button: React.ReactNode) => compact
    ? <HoverCard compact showDelay={2000} placement="top" content={label}>{button}</HoverCard>
    : button
  return (
    <div className={`cred-actions ${compact ? 'is-compact' : ''}`} onClick={stop}>
      {actionHint('测试',
        <button
          type="button"
          className="btn btn-sm btn-retest"
          aria-label={`测试 ${view.credential.name}`}
          aria-busy={busy}
          disabled={runtime.canInspect === false || busy || excluding || expired || view.credential.unavailable}
          onClick={() => runtime.onRetest(view.credential.id)}
        >
          <Icon.Refresh />
          <span>测试</span>
        </button>
      )}
      {view.target && actionHint('详情',
        <button
          type="button"
          className="btn btn-sm btn-detail"
          aria-label={`详情 ${view.credential.name}`}
          onClick={() => runtime.onOpenDetail(view.target!.id, lastRound(view.target)?.id ?? null)}
        >
          <Icon.Doc />
          <span>详情</span>
        </button>
      )}
      {runtime.onExclude && actionHint('排除',
        <button type="button" className="btn btn-sm btn-exclude" disabled={excluding || exclusionBusy || runtime.canChangeParticipation === false}
          aria-label={`排除 ${view.credential.name}`} aria-busy={excluding} onClick={() => runtime.onExclude?.(view.credential.id)}>
          <ExclusionIcon /><span>排除</span>
        </button>
      )}
    </div>
  )
}
