import { type CSSProperties } from 'react'
import { formatDuration, formatRelative } from '../../lib/format'
import { isFreeSkipped, isManuallyExcluded, lowestQuota, type CredentialView } from '../../lib/derive'
import { latestCredentialErrorCode, resolvedRoundReason, roundErrorInfo } from '../../lib/inspectionResult'
import { evaluateEligibility, judgePelicanVerdict, refreshCredentialsQuota, startInspection } from '../../store/actions'
import { useStore } from '../../store/store'
import { Chip, HoverCard, Icon, PlanMark, SecretName, useSelection } from '../ui'
import { CredentialRouting } from '../RoutingControls'
import {
  ActivityRail,
  Actions,
  FreeSkipChip,
  GroupCell,
  StateChips,
  resolveCardActivity,
  stop,
  type CredentialRuntime,
} from './CredentialParts'
import {
  PelicanSvgFrame,
  downloadPelicanHtml,
  formatSvgBytes,
  hasPelicanArtwork,
  latestPelicanRound,
  latestPelicanSvgRound,
  pelicanByteCount,
} from '../pelican/PelicanSvgStage'

const WINDOW_SHORT: Record<string, string> = {
  '5h': '5h',
  '7d': '周限',
  '30d': '月限',
}

function CompactQuotaStrip({
  view,
  threshold,
  refreshing,
  connected,
}: {
  view: CredentialView
  threshold: number
  refreshing: boolean
  connected: boolean
}) {
  const { credential } = view
  const lowest = lowestQuota(credential)
  const windows = credential.quota.windows.filter((w) => w.remainingPercent != null)
  if (windows.length === 0) {
    if (credential.disabled) return <span className="pelican-quota-muted">已停用</span>
    return (
      <button
        type="button"
        className="pelican-quota-refresh-inline"
        disabled={!connected || refreshing}
        onClick={(event) => {
          stop(event)
          void refreshCredentialsQuota([credential.id])
        }}
      >
        <Icon.Refresh />
        <span>{refreshing ? '刷新中…' : '刷新额度'}</span>
      </button>
    )
  }
  return (
    <div className="pelican-quota-pills" aria-label="剩余额度">
      {windows.map((w) => {
        const pct = Math.round(w.remainingPercent ?? 0)
        const warn = pct <= threshold
        return (
          <span
            key={w.key}
            className={`pelican-quota-tag${pct === 0 ? ' is-zero' : warn ? ' is-low' : ''}`}
          >
            <em>{WINDOW_SHORT[w.key] ?? w.key}</em>
            <b>{pct}%</b>
          </span>
        )
      })}
      {lowest != null && lowest <= threshold && <span className="pelican-quota-skip">低于门槛</span>}
    </div>
  )
}

export function PelicanAlbumGrid({
  views,
  runtime,
  columns,
}: {
  views: CredentialView[]
  runtime: CredentialRuntime
  columns?: number
}) {
  const selection = useSelection()
  const judging = useStore((s) => s.judging)
  const starting = useStore((s) => s.starting)
  const openPelicanLightbox = useStore((s) => s.openPelicanLightbox)

  const judgingIds = new Set(judging)

  return (
    <div
      className="pelican-album-grid"
      style={columns ? ({ '--pelican-cols': columns } as CSSProperties) : undefined}
    >
      {views.map((view) => {
        const { credential } = view
        const isDisabled = Boolean(credential.disabled)
        const selected = !isDisabled && selection.has(credential.id)
        const activity = !isDisabled ? resolveCardActivity(credential.id, runtime) : null
        const quotaRefreshing = !isDisabled && runtime.quotaRefreshingIds.has(credential.id)
        const isJudging = judgingIds.has(credential.id)

        const svgRound = latestPelicanSvgRound(view.target)
        const pelicanRound = latestPelicanRound(view.target)
        const pelicanData = svgRound?.evidence.pelican
        const hasArtwork = hasPelicanArtwork(pelicanData)
        const artworkBytes = pelicanByteCount(pelicanData)

        const latestFailedPelican =
          pelicanRound && !hasPelicanArtwork(pelicanRound.evidence.pelican) ? pelicanRound : null
        const failedErrorCode = latestFailedPelican
          ? roundErrorInfo(latestFailedPelican).lastCodeLabel ?? latestCredentialErrorCode(view)
          : null

        const judgedVerdict =
          pelicanData?.judgedVerdict ??
          (svgRound?.outcome === 'normal' || svgRound?.outcome === 'downshift' ? svgRound.outcome : null)

        const eligibility = view.target
          ? evaluateEligibility(view.target, runtime.settings, credential, {
              togglingStatus: runtime.togglingStatusIds,
              excluding: runtime.excludingIds,
            })
          : { runnable: false, note: '目标模型未就绪' }

        const canDraw =
          runtime.connected &&
          !starting &&
          !activity &&
          !isJudging &&
          Boolean(view.target) &&
          eligibility.runnable

        const canJudge =
          hasArtwork &&
          runtime.connected &&
          !isDisabled &&
          !isManuallyExcluded(credential) &&
          !activity &&
          !isJudging &&
          !runtime.exclusionBusyIds.has(credential.id)

        const routingModeHint =
          runtime.settings.routing.mode === 'none'
            ? '仅记录结论，不改写 CPA 配置'
            : runtime.settings.routing.mode === 'prefix'
              ? '自动同步正常/风控模型前缀'
              : '自动同步正常/风控调度优先级'

        const elapsedLabel = activity?.elapsedSec != null ? ` ${activity.elapsedSec}s` : ''

        const inlineStatusBadge = activity ? (
          <Chip tone={activity.chipTone} dot>
            {activity.kind === 'inspecting' ? `绘画中${elapsedLabel}` : activity.label}
          </Chip>
        ) : hasArtwork ? (
          judgedVerdict === 'normal' ? (
            <span className="verdict verdict-normal is-sm">
              <span className="dot dot-normal" aria-hidden="true" />
              正常
            </span>
          ) : judgedVerdict === 'downshift' ? (
            <span className="verdict verdict-downshift is-sm">
              <span className="dot dot-downshift" aria-hidden="true" />
              风控
            </span>
          ) : (
            <span className="verdict verdict-uncertain is-sm">
              <span className="dot dot-uncertain" aria-hidden="true" />
              待判定
            </span>
          )
        ) : latestFailedPelican ? (
          <HoverCard
            compact
            content={
              <>
                <div className="tip-v-danger">{resolvedRoundReason(latestFailedPelican)}</div>
                {failedErrorCode && (
                  <div className="tip-row tip-error-code-row">
                    <span className="tip-k">最后错误码</span>
                    <span className="tip-v tip-v-danger mono">{failedErrorCode}</span>
                  </div>
                )}
              </>
            }
          >
            <span className="verdict verdict-error is-sm">
              <span className="dot dot-error" aria-hidden="true" />
              未完成
            </span>
          </HoverCard>
        ) : null

        return (
          <article
            key={credential.id}
            data-testid={`pelican-card-${credential.id}`}
            data-credential-id={credential.id}
            data-exclusion-source={!isDisabled ? 'true' : undefined}
            className={`pelican-album-card${judgedVerdict ? ` tone-${judgedVerdict}` : hasArtwork ? ' tone-awaiting' : ''}${selected ? ' is-selected' : ''}${isDisabled ? ' is-disabled-cred' : ''}${activity ? ` is-active is-${activity.kind}` : ''}`}
          >
            <ActivityRail activity={activity} />

            {/* Zone 1: Artwork Stage */}
            <div className="pelican-stage">
              {!isDisabled && (
                <button
                  type="button"
                  className={`pelican-corner-check${selected ? ' is-selected' : ''}`}
                  aria-pressed={selected}
                  aria-label={selected ? `取消选择凭证 ${credential.name}` : `选择凭证 ${credential.name}`}
                  title={selected ? '取消选中（支持 Shift 连选）' : '选中加入批量操作（支持 Shift 连选）'}
                  onClick={(event) => {
                    stop(event)
                    selection.toggle(credential.id, event.shiftKey)
                  }}
                >
                  <Icon.Check />
                </button>
              )}

              {hasArtwork && (
                <div className="pelican-stage-top">
                  <div className="pelican-stage-badges">
                    {pelicanData && (
                      <HoverCard compact placement="top" content="下载 HTML 动画文件到本地">
                        <button
                          type="button"
                          className="pelican-stage-icon-btn is-hover-only"
                          aria-label="下载鹈鹕 HTML 动画"
                          onClick={(event) => {
                            stop(event)
                            const ok = downloadPelicanHtml(pelicanData, {
                              credentialId: credential.id,
                              credentialName: credential.name,
                              finishedAt: svgRound?.finishedAt,
                              maskNames: runtime.settings.maskNames,
                            })
                            if (!ok) {
                              useStore.getState().notify({
                                tone: 'warning',
                                title: '下载失败',
                                detail: '当前环境暂不支持触发本地 HTML 下载。',
                              })
                            }
                          }}
                        >
                          <Icon.Download />
                        </button>
                      </HoverCard>
                    )}

                    {canDraw && view.target && (
                      <HoverCard compact placement="top" content="重新绘制一轮鹈鹕动画">
                        <button
                          type="button"
                          className="pelican-stage-icon-btn is-hover-only"
                          aria-label="重新绘制鹈鹕动画"
                          onClick={(event) => {
                            stop(event)
                            void startInspection('manual', [view.target!.id])
                          }}
                        >
                          <Icon.Refresh />
                        </button>
                      </HoverCard>
                    )}
                  </div>
                </div>
              )}

              {hasArtwork ? (
                <>
                  <button
                    type="button"
                    className="pelican-stage-hit"
                    onClick={() => openPelicanLightbox(credential.id, svgRound?.id ?? null)}
                    aria-label={`点击放大审看 ${credential.name} 的鹈鹕骑自行车动画`}
                  >
                    <span className="pelican-artwork-mat">
                      <PelicanSvgFrame
                        html={pelicanData?.html}
                        svg={pelicanData?.svg ?? ''}
                        colorScheme={runtime.settings.theme}
                        title={`${credential.name} 鹈鹕骑自行车动画`}
                      />
                    </span>
                    <span className="pelican-zoom-cue" aria-hidden="true">
                      <Icon.Expand />
                      <span>大图审片</span>
                    </span>
                  </button>
                  {activity && (
                    <div className="pelican-stage-redraw-banner" role="status">
                      <span className="sonar-dot dot" aria-hidden="true" />
                      <span>正在重绘{elapsedLabel}…</span>
                    </div>
                  )}
                </>
              ) : activity ? (
                <div className="pelican-stage-empty is-drawing" role="status">
                  <div className="pelican-easel-pulse">
                    <Icon.PelicanBike />
                  </div>
                  <strong>
                    {activity.kind === 'inspecting'
                      ? `正在绘制鹈鹕骑自行车${elapsedLabel}…`
                      : activity.kind === 'retrying'
                        ? '请求异常，等待重试绘制…'
                        : activity.label}
                  </strong>
                  <span>生成 2D 动画 HTML 约需十余秒，完成后自动呈现</span>
                </div>
              ) : latestFailedPelican ? (
                <div className="pelican-stage-empty is-failed">
                  <div className="pelican-empty-emblem is-danger">
                    <Icon.Alert />
                  </div>
                  <strong className="pelican-error-title">未能生成有效鹈鹕动画</strong>
                  <span className="pelican-error-detail">{resolvedRoundReason(latestFailedPelican)}</span>
                  {canDraw && view.target && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={(event) => {
                        stop(event)
                        void startInspection('manual', [view.target!.id])
                      }}
                    >
                      <Icon.Refresh />
                      <span>重试绘制</span>
                    </button>
                  )}
                </div>
              ) : canDraw && view.target ? (
                <button
                  type="button"
                  className="pelican-stage-empty is-clickable-easel"
                  onClick={(event) => {
                    stop(event)
                    void startInspection('manual', [view.target!.id])
                  }}
                  aria-label={`开始为 ${credential.name} 绘制鹈鹕骑自行车动画`}
                >
                  <span className="pelican-empty-emblem">
                    <Icon.PelicanBike />
                  </span>
                  <strong>点击开始绘制鹈鹕动画</strong>
                  <span>生成后可在线审片、下载 HTML 并快速判别风控</span>
                </button>
              ) : (
                <div className="pelican-stage-empty">
                  <div className="pelican-empty-emblem">
                    <Icon.PelicanBike />
                  </div>
                  <strong>尚未绘制</strong>
                  <span className={credential.auth === 'expired' ? 'pelican-error-detail' : undefined}>
                    {isDisabled
                      ? '凭证已关闭，开启右下角开关后可绘制'
                      : isFreeSkipped(credential, runtime.settings)
                        ? 'Free 账号默认免检，可在设置中开启强制巡检'
                        : eligibility.note || '当前暂不可发起绘制'}
                  </span>
                </div>
              )}
            </div>

            {/* Zone 2: Selectable Identity, Priority/Weight + Status Badge */}
            <div
              className="pelican-caption"
              onClick={(event) => {
                if (!isDisabled) selection.toggle(credential.id, event.shiftKey)
              }}
            >
              <div className="pelican-caption-row">
                <div className="pelican-ident">
                  <SecretName name={credential.name} className="pelican-cred-name" />
                  {isDisabled && <Chip tone="plain">已关闭</Chip>}
                  <FreeSkipChip view={view} settings={runtime.settings} />
                  {!isDisabled && <StateChips view={view} />}
                </div>
                {view.target && (svgRound || latestFailedPelican || view.target.rounds.length > 0) ? (
                  <HoverCard
                    compact
                    placement="top"
                    content={
                      svgRound
                        ? `耗时 ${formatDuration(svgRound.evidence.durationMs)} · ${formatSvgBytes(artworkBytes)}${!pelicanData?.strictFormat ? ' · 宽容提取' : ''} · 点击查看依据`
                        : '点击查看请求记录与完整依据'
                    }
                  >
                    <button
                      type="button"
                      className="pelican-time-btn"
                      onClick={(event) => {
                        stop(event)
                        runtime.onOpenDetail(view.target!.id, svgRound?.id ?? latestFailedPelican?.id ?? null)
                      }}
                    >
                      <span>
                        {svgRound
                          ? `${formatRelative(svgRound.finishedAt, runtime.now)} · ${formatDuration(svgRound.evidence.durationMs)}`
                          : latestFailedPelican
                            ? `${formatRelative(latestFailedPelican.finishedAt, runtime.now)}失败`
                            : '历史依据'}
                      </span>
                    </button>
                  </HoverCard>
                ) : (
                  <span className="pelican-time">未绘制</span>
                )}
              </div>

              <div className="pelican-meta-row">
                <div className="pelican-routing-inline" onClick={stop}>
                  <GroupCell view={view} settings={runtime.settings} />
                  <CredentialRouting credential={credential} compact />
                  {inlineStatusBadge}
                </div>
                <CompactQuotaStrip
                  view={view}
                  threshold={runtime.settings.quota.minRemainingPercent}
                  refreshing={quotaRefreshing}
                  connected={runtime.connected}
                />
              </div>
            </div>

            {/* Zone 3: Balanced 3-Column Footer with Bottom-Centered Plan Badge */}
            <div className="pelican-action-bar" onClick={stop}>
              <div className="pelican-action-left">
                {hasArtwork ? (
                  <div className="pelican-verdict-switch" role="group" aria-label="肉眼判定风控分组">
                    <HoverCard compact placement="top" content={`判为正常 · ${routingModeHint}`}>
                      <button
                        type="button"
                        className={`pelican-verdict-opt is-normal${judgedVerdict === 'normal' ? ' is-selected' : ''}`}
                        aria-pressed={judgedVerdict === 'normal'}
                        disabled={!canJudge}
                        onClick={() => void judgePelicanVerdict(credential.id, 'normal', svgRound?.id)}
                      >
                        <Icon.Check />
                        <span>正常</span>
                      </button>
                    </HoverCard>
                    <HoverCard compact placement="top" content={`判为风控 · ${routingModeHint}`}>
                      <button
                        type="button"
                        className={`pelican-verdict-opt is-downshift${judgedVerdict === 'downshift' ? ' is-selected' : ''}`}
                        aria-pressed={judgedVerdict === 'downshift'}
                        disabled={!canJudge}
                        onClick={() => void judgePelicanVerdict(credential.id, 'downshift', svgRound?.id)}
                      >
                        <span className="pelican-judge-bang" aria-hidden="true">!</span>
                        <span>风控</span>
                      </button>
                    </HoverCard>
                  </div>
                ) : (
                  <span className="pelican-await-hint">
                    {activity
                      ? '完成后可判定'
                      : isDisabled
                        ? '已停用'
                        : isFreeSkipped(credential, runtime.settings)
                          ? '默认免检'
                          : '生成后可判定'}
                  </span>
                )}
              </div>

              <div className="pelican-plan-center">
                <PlanMark plan={credential.plan} size="sm" />
              </div>

              <div className="pelican-utility-actions">
                <Actions view={view} runtime={runtime} mode="card" compact />
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
