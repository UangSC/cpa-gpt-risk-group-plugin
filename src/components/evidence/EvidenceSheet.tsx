import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '../../store/store'
import { resyncCredential, startInspection } from '../../store/actions'
import { attentionOf } from '../../lib/derive'
import { formatDateTime, formatDuration } from '../../lib/format'
import { countRetries, REASON_DESC, REASON_LABEL, VERDICT_LABEL, testLabel } from '../../lib/rules'
import { resolvedRoundReason, roundErrorInfo } from '../../lib/inspectionResult'
import { isCompositionEvent, isEditingTarget, isPlainShortcut } from '../../lib/keyboard'
import { Chip, Icon, Modal, SecretName } from '../ui'
import { CandyEvidenceSection } from './CandyEvidenceSection'
import { FingerprintEvidencePanel } from './FingerprintEvidencePanel'
import { PelicanEvidenceSection } from './PelicanEvidenceSection'
import { RequestAndSyncSections } from './RequestAttemptsSection'

export { RequestAttempts } from './RequestAttemptsSection'

export function EvidenceSheet() {
  const detail = useStore((s) => s.detail)
  const targets = useStore((s) => s.targets)
  const credentials = useStore((s) => s.credentials)
  const settings = useStore((s) => s.settings)
  const connection = useStore((s) => s.connection)
  const starting = useStore((s) => s.starting)
  const tasks = useStore((s) => s.tasks)
  const syncing = useStore((s) => s.syncing)
  const openDetail = useStore((s) => s.openDetail)
  const closeDetail = useStore((s) => s.closeDetail)
  const openPelicanLightbox = useStore((s) => s.openPelicanLightbox)

  // Retain last active detail so Modal exit animation never flashes blank.
  const retainedDetailRef = useRef(detail)
  if (detail) retainedDetailRef.current = detail
  const effectiveDetail = detail ?? retainedDetailRef.current

  const target = effectiveDetail ? targets.find((t) => t.id === effectiveDetail.targetId) : undefined
  const credential = target ? credentials.find((c) => c.id === target.credentialId) : undefined

  const rounds = target?.rounds ?? []
  const index = useMemo(() => {
    if (!effectiveDetail?.roundId) return 0
    const found = rounds.findIndex((r) => r.id === effectiveDetail.roundId)
    return found < 0 ? 0 : found
  }, [effectiveDetail, rounds])

  const round = rounds[index]
  const attempts = round?.evidence.attempts ?? []
  const retries = countRetries(attempts)
  const prev = rounds[index + 1]
  const next = index > 0 ? rounds[index - 1] : undefined

  useEffect(() => {
    if (!detail || !target) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCompositionEvent(event) || isEditingTarget(event.target)) return
      if (isPlainShortcut(event, 'ArrowLeft') && prev) {
        event.preventDefault()
        openDetail(target.id, prev.id)
      } else if (isPlainShortcut(event, 'ArrowRight') && next) {
        event.preventDefault()
        openDetail(target.id, next.id)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [detail, target, prev, next, openDetail])

  if (!effectiveDetail || !target) return null

  const syncIssue = credential ? attentionOf(credential).find((a) => a.kind === 'sync') : undefined

  return (
    <Modal
      open={Boolean(detail)}
      wide
      onClose={closeDetail}
      title={
        <span className="inline" style={{ gap: 8 }}>
          <span className="mono" style={{ fontSize: 14 }}>
            {target.model}
          </span>
          <span className={`verdict verdict-${target.verdict}`}>
            <span className={`dot dot-${target.verdict === 'untested' ? 'empty' : target.verdict}`} />
            {VERDICT_LABEL[target.verdict]}
          </span>
        </span>
      }
      sub={
        <span>
          {credential ? <SecretName name={credential.name} /> : '凭证已删除'}
          {round
            ? ` · 第 ${rounds.length - index} 轮 / 共 ${rounds.length} 轮 · ${formatDateTime(round.finishedAt)}`
            : ' · 暂无检测记录'}
        </span>
      }
      footer={
        <>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!prev}
            onClick={() => prev && openDetail(target.id, prev.id)}
          >
            <kbd className="btn-kbd" aria-hidden="true">←</kbd>
            更早一轮
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!next}
            onClick={() => next && openDetail(target.id, next.id)}
          >
            更新一轮
            <kbd className="btn-kbd" aria-hidden="true">→</kbd>
          </button>
          <span className="spacer" />
          {syncIssue && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={connection !== 'connected' || (Boolean(credential) && syncing.includes(credential!.id))}
              onClick={() => credential && void resyncCredential(credential.id)}
            >
              重试同步
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={closeDetail}>
            关闭
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={
              !credential ||
              connection !== 'connected' ||
              starting ||
              tasks.some((task) => task.status === 'running' && task.items.some((item) => item.targetId === target.id)) ||
              credential.auth === 'expired'
            }
            onClick={() => {
              closeDetail()
              startInspection('manual', [target.id])
            }}
          >
            <Icon.Refresh />
            再测一轮
          </button>
        </>
      }
    >
      {!round ? (
        <div className="empty" style={{ padding: '32px 16px' }}>
          <h3>还没有检测记录</h3>
          <p>这个模型尚未执行过检测，因此没有结论、证据或分组变更。</p>
        </div>
      ) : (
        <>
          <div className="ev-grid">
            <div className="ev-cell">
              <div className="k">本轮结论</div>
              <div className="v">
                {round.outcome === 'cancelled'
                  ? '已取消（未形成结论）'
                  : round.outcome === 'blocked'
                    ? '未能检测（状态问题）'
                    : VERDICT_LABEL[round.outcome as 'normal' | 'downshift' | 'uncertain']}
              </div>
            </div>
            <div className="ev-cell">
              <div className="k">判定依据</div>
              <div className="v">{REASON_LABEL[round.reasonCode]}</div>
            </div>
            <div className="ev-cell">
              <div className="k">测试方式</div>
              <div className="v">{testLabel(round.tests)}</div>
            </div>
            <div className="ev-cell">
              <div className="k">耗时 / 尝试</div>
              <div className="v">
                {formatDuration(round.evidence.durationMs)} · {attempts.length} 次
                {retries > 0 ? `（重试 ${retries} 次）` : ''}
              </div>
            </div>
          </div>

          <div className="ev-section">
            <h4>
              说明
              {round.outcome === 'downshift' && <Chip tone="downshift">风控</Chip>}
              {round.outcome === 'uncertain' && <Chip tone="uncertain">不确定</Chip>}
              {round.outcome === 'normal' && <Chip tone="normal">正常</Chip>}
            </h4>
            <p
              style={{
                fontSize: 12.5,
                color:
                  round.outcome === 'blocked' || round.outcome === 'downshift' || roundErrorInfo(round).hasError
                    ? 'var(--danger)'
                    : 'var(--text-2)',
                lineHeight: 1.7,
              }}
            >
              {resolvedRoundReason(round)}。{REASON_DESC[round.reasonCode]}
            </p>
          </div>

          {round.evidence.candy && <CandyEvidenceSection candy={round.evidence.candy} />}

          {round.evidence.fingerprint && <FingerprintEvidencePanel evidence={round.evidence.fingerprint} />}

          {round.evidence.pelican && (
            <PelicanEvidenceSection
              pelican={round.evidence.pelican}
              round={round}
              target={target}
              credential={credential}
              onOpenLightbox={() => {
                closeDetail()
                openPelicanLightbox(target.credentialId, round.id)
              }}
            />
          )}

          {round.evidence.method && (
            <div className="ev-section">
              <h4>{round.evidence.method.label}</h4>
              <dl className="kv">
                {round.evidence.method.details.map((entry, entryIndex) => (
                  <div className="ev-method-entry" key={entryIndex}>
                    <dt>{entry.label}</dt>
                    <dd>{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <RequestAndSyncSections round={round} target={target} credential={credential} settings={settings} />

          <div className="disclaimer">
            行为测试只能说明“本轮回答与参考分布的接近程度”，不能确认底层实际模型身份。结论用于分流与排查，
            不构成对服务方模型路由的最终判定。认证失效和本地额度预检不计入频繁异常；实际巡检中的重复 502/503/429 按异常规则分组。
          </div>
        </>
      )}
    </Modal>
  )
}
