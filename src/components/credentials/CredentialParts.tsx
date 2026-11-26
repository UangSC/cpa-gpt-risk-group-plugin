import { type RunItemState, type Settings } from '../../types'
import { isFreeSkipped, lastRound, lowestQuota, statusOf, type StatusKey, type CredentialView } from '../../lib/derive'
import { latestCredentialErrorCode, resolvedRoundReason } from '../../lib/inspectionResult'
import { STATUS_TOOLTIP_DELAY_MS } from '../../lib/tooltipInteraction'
import { Chip, HoverCard, Icon, QuotaMeter } from '../ui'
import type { ChipTone } from '../ui/primitives'
import { useStore } from '../../store/store'
import { evaluateEligibility, refreshCredentialsQuota, startInspection } from '../../store/actions'
import { ExclusionIcon } from '../ExclusionDrawer'

/**
 * User-facing credential status. Four states only: 正常 / 风控 / 未知 / 异常.
 * A finished verdict with a failed group write is *not* "normal + pending": it surfaces as
 * 异常, with the retry offered as an action instead of a second status label.
 */

const STATUS_TEXT: Record<StatusKey, string> = {
  normal: '正常',
  downshift: '风控',
  unknown: '未知',
  error: '异常',
}

export type CardActivityKind = 'inspecting' | 'retrying' | 'waiting' | 'queued' | 'quota'

export interface CardActivity {
  kind: CardActivityKind
  label: string
  chipTone: ChipTone
  elapsedSec?: number
}

export interface CredentialRuntime {
  settings: Settings
  connected: boolean
  starting?: boolean
  inspectingStates: ReadonlyMap<string, RunItemState>
  inspectingStartedAt?: ReadonlyMap<string, number>
  quotaRefreshingIds: ReadonlySet<string>
  togglingStatusIds: ReadonlySet<string>
  excludingIds: ReadonlySet<string>
  exclusionBusyIds: ReadonlySet<string>
  now: number
  onOpenDetail: (targetId: string, roundId?: string | null) => void
  onToggleDisabled: (credentialId: string, disabled: boolean) => void
  onExclude?: (credentialId: string) => void
  canChangeParticipation?: boolean
}

export function resolveCardActivity(credentialId: string, runtime: CredentialRuntime): CardActivity | null {
  const runState = runtime.inspectingStates.get(credentialId)
  if (runState === 'running') {
    const startedMs = runtime.inspectingStartedAt?.get(credentialId)
    const elapsedSec =
      startedMs != null && Number.isFinite(startedMs)
        ? Math.max(0, Math.floor((runtime.now - startedMs) / 1000))
        : undefined
    return {
      kind: 'inspecting',
      label: elapsedSec != null && elapsedSec > 0 ? `巡检中 ${elapsedSec}s` : '巡检中',
      chipTone: 'accent',
      elapsedSec,
    }
  }
  if (runState === 'retrying') return { kind: 'retrying', label: '重试中', chipTone: 'uncertain' }
  if (runState === 'waiting') return { kind: 'waiting', label: '等待空闲', chipTone: 'plain' }
  if (runState === 'queued') return { kind: 'queued', label: '排队中', chipTone: 'plain' }
  if (runtime.quotaRefreshingIds.has(credentialId)) return { kind: 'quota', label: '刷新中', chipTone: 'normal' }
  return null
}

/** 仅在卡片或行进入进行态时渲染一条细微顶部流动光轨，离开可视范围或结束即卸载。 */
export function ActivityRail({ activity }: { activity: CardActivity | null }) {
  if (!activity) return null
  return (
    <span className={`activity-rail is-${activity.kind}`} aria-hidden="true">
      <span className="activity-rail-bar" />
    </span>
  )
}

export function stop(e: { stopPropagation: () => void }) {
  e.stopPropagation()
}

/* ------------------------------------------------------------ shared bits */

/** The single four-state status chip used by cards (and the list verdict column). */
export function StatusPill({ view, size }: { view: CredentialView; size?: 'sm' }) {
  const key = statusOf(view)
  const latest = lastRound(view.target)
  const roundDetail = latest ? resolvedRoundReason(latest) : view.reason
  const detail =
    view.attention.find((a) => a.kind === 'sync' || a.kind === 'auth' || a.kind === 'availability')?.detail ??
    roundDetail ??
    '尚未取得完整检测结果，执行巡检后可点击近况灯查看详情。'
  const lastErrorCode = key !== 'normal' ? latestCredentialErrorCode(view) : null
  const interactive = key === 'unknown' || key === 'error'
  const Tag = interactive ? 'button' : 'span'
  const pill = (
    <Tag
      type={interactive ? 'button' : undefined}
      className={`verdict verdict-${key} status-pill ${size === 'sm' ? 'is-sm' : ''}`}
      aria-label={interactive ? `${STATUS_TEXT[key]}状态说明` : undefined}
      onClick={interactive ? stop : undefined}
    >
      <span className={`dot dot-${key === 'unknown' ? 'uncertain' : key === 'error' ? 'downshift' : key}`} aria-hidden="true" />
      {STATUS_TEXT[key]}
    </Tag>
  )
  return interactive ? (
    <HoverCard
      showDelay={STATUS_TOOLTIP_DELAY_MS}
      fadeOnHide={false}
      content={
        <>
          <div className="tip-title">{STATUS_TEXT[key]}状态说明</div>
          <p className={key === 'error' ? 'tip-v-danger' : undefined}>{detail}</p>
          {lastErrorCode && (
            <div className="tip-row tip-error-code-row">
              <span className="tip-k">最后错误码</span>
              <span className="tip-v tip-v-danger mono">{lastErrorCode}</span>
            </div>
          )}
        </>
      }
    >
      {pill}
    </HoverCard>
  ) : (
    pill
  )
}

export function GroupCell({ view, settings }: { view: CredentialView; settings: Settings }) {
  const { credential } = view
  const label = credential.group === 'normal' ? '正常' : credential.group === 'downshift' ? '风控' : '未分组'
  const prefixKnown = typeof credential.prefix === 'string'
  const prefix = prefixKnown
    ? credential.prefix!.trim().replace(/\/+$/g, '')
    : credential.group
      ? settings.prefixes[credential.group]
      : null
  const displayText = prefixKnown
    ? prefix || '无前缀'
    : settings.routing.mode !== 'prefix'
      ? label
      : credential.group
        ? prefix || '无前缀'
        : '未分组'
  const isCodePrefix = Boolean(
    prefix && (prefixKnown || (settings.routing.mode === 'prefix' && Boolean(credential.group))),
  )
  return (
    <div className="group-cell is-list">
      <div className="group-line">
        <span className={`group-dot is-${credential.group ?? 'none'}`} aria-hidden="true" />
        <span className={`group-prefix is-${credential.group ?? 'none'}${isCodePrefix ? '' : ' is-label'}`}>
          {displayText}
        </span>
      </div>
    </div>
  )
}

function UnknownQuotaButton({ credentialId }: { credentialId: string }) {
  const disabled = useStore((state) => state.connection !== 'connected' || state.quotaRefreshing.length > 0)
  const refreshing = useStore((state) => state.quotaRefreshing.includes(credentialId))
  return (
    <button
      type="button"
      className="btn btn-sm quota-unknown-button"
      aria-description="点击刷新此凭证的额度"
      aria-busy={refreshing}
      disabled={disabled}
      onClick={(event) => {
        stop(event)
        void refreshCredentialsQuota([credentialId])
      }}
    >
      <Icon.Refresh />
      {refreshing ? '刷新中…' : '刷新额度'}
    </button>
  )
}

export function QuotaCell({
  view,
  settings,
  refreshUnknown = false,
  compactWarn = false,
  refreshing = false,
}: {
  view: CredentialView
  settings: Settings
  refreshUnknown?: boolean
  compactWarn?: boolean
  refreshing?: boolean
}) {
  const lowest = lowestQuota(view.credential)
  const exhausted = view.credential.quota.status === 'exhausted'
  const blocked = lowest != null && lowest <= settings.quota.minRemainingPercent
  if (refreshUnknown && !exhausted && lowest == null) {
    return (
      <div className="quota-cell">
        <UnknownQuotaButton credentialId={view.credential.id} />
      </div>
    )
  }
  const hasWindows = view.credential.quota.windows.length > 0
  return (
    <div className="quota-cell" data-quota-empty={!hasWindows ? 'true' : undefined}>
      <QuotaMeter windows={view.credential.quota.windows} threshold={settings.quota.minRemainingPercent} refreshing={refreshing} />
      {exhausted ? (
        !compactWarn || !hasWindows ? <span className="quota-warn">额度不足 · 跳过</span> : null
      ) : blocked ? (
        !compactWarn || !hasWindows ? <span className="quota-warn">低于门槛 · 跳过</span> : null
      ) : lowest == null ? (
        <span className="quota-warn">额度未知</span>
      ) : null}
    </div>
  )
}

export function FreeSkipChip({ view, settings }: { view: CredentialView; settings: Pick<Settings, 'inspectFreeAccounts'> }) {
  if (view.credential.disabled || !isFreeSkipped(view.credential, settings)) return null
  return (
    <HoverCard compact content="Free 账号默认不参与巡检，可在「设置 → 巡检与重试」中开启强制巡检">
      <Chip tone="plain">默认免检</Chip>
    </HoverCard>
  )
}

/** Credential-state flag (auth). Quota problems are already expressed in the quota cell. */
export function StateChips({ view }: { view: CredentialView }) {
  const auth = view.attention.find((a) => a.kind === 'auth')
  if (!auth) return null
  const lastErrorCode = latestCredentialErrorCode(view)
  return (
    <HoverCard
      content={
        <>
          <div className="tip-v-danger">{auth.detail}</div>
          {lastErrorCode && (
            <div className="tip-row tip-error-code-row">
              <span className="tip-k">最后错误码</span>
              <span className="tip-v tip-v-danger mono">{lastErrorCode}</span>
            </div>
          )}
        </>
      }
    >
      <Chip tone="downshift">认证失效</Chip>
    </HoverCard>
  )
}

export function Actions({
  view,
  runtime,
  mode = 'list',
  compact = false,
  showQuickRun = false,
}: {
  view: CredentialView
  runtime: CredentialRuntime
  mode?: 'list' | 'pool' | 'card'
  compact?: boolean
  showQuickRun?: boolean
}) {
  const isDisabled = view.credential.disabled
  const busy = runtime.inspectingStates.has(view.credential.id)
  const excluding = runtime.excludingIds.has(view.credential.id)
  const toggling = runtime.togglingStatusIds.has(view.credential.id)
  const exclusionBusy = runtime.exclusionBusyIds.has(view.credential.id)
  const toggleDisabled =
    !runtime.connected || toggling || excluding || busy || exclusionBusy || runtime.canChangeParticipation === false
  const excludeDisabled =
    isDisabled || !runtime.connected || excluding || exclusionBusy || toggling || busy || runtime.canChangeParticipation === false

  const eligibility =
    showQuickRun && view.target
      ? evaluateEligibility(view.target, runtime.settings, view.credential, {
          togglingStatus: runtime.togglingStatusIds,
          excluding: runtime.excludingIds,
        })
      : null
  const canQuickRun =
    showQuickRun &&
    Boolean(view.target) &&
    runtime.connected &&
    !runtime.starting &&
    !busy &&
    !exclusionBusy &&
    Boolean(eligibility?.runnable)
  const hasRounds = Boolean(view.target && view.target.rounds.length > 0)

  const wrapTooltip = (label: string, node: React.ReactNode) => (
    <HoverCard compact placement="top" content={label}>
      {node}
    </HoverCard>
  )

  return (
    <div className={`cred-actions is-${mode}${compact ? ' is-compact' : ''}`} onClick={stop}>
      {showQuickRun &&
        view.target &&
        !isDisabled &&
        wrapTooltip(
          canQuickRun
            ? hasRounds
              ? '单独重测此凭证'
              : '立即检测此凭证'
            : eligibility?.note || (busy ? '该凭证正在巡检中' : '当前不可发起检测'),
          <button
            type="button"
            className="icon-btn cred-quick-run"
            disabled={!canQuickRun}
            aria-label={hasRounds ? `单独重测 ${view.credential.name}` : `立即检测 ${view.credential.name}`}
            onClick={() => void startInspection('manual', [view.target!.id])}
          >
            {hasRounds ? <Icon.Refresh /> : <Icon.Play />}
          </button>,
        )}
      {wrapTooltip(
        isDisabled ? '开启凭证（同步至 CLIProxyAPI）' : '关闭凭证（同步至 CLIProxyAPI，关闭后不参与巡检）',
        <button
          type="button"
          role="switch"
          aria-checked={!isDisabled}
          aria-busy={toggling}
          aria-label={isDisabled ? '开启凭证' : '关闭凭证'}
          disabled={toggleDisabled}
          className={`cred-toggle ${!isDisabled ? 'is-on' : 'is-off'}${toggling ? ' is-busy' : ''}`}
          onClick={() => runtime.onToggleDisabled(view.credential.id, !isDisabled)}
        >
          <span className="cred-toggle-knob" aria-hidden="true" />
        </button>,
      )}
      {runtime.onExclude &&
        wrapTooltip(
          isDisabled ? '凭证已关闭，不参与巡检' : '移入不参与巡检池',
          <button
            type="button"
            className="btn btn-sm btn-exclude"
            disabled={excludeDisabled}
            aria-label="免检（移入不参与巡检池）"
            aria-busy={excluding}
            onClick={() => runtime.onExclude?.(view.credential.id)}
          >
            <ExclusionIcon />
            <span className="btn-exclude-label">免检</span>
          </button>,
        )}
    </div>
  )
}
