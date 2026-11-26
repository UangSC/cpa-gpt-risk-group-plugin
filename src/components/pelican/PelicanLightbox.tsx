import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/store'
import { evaluateEligibility, judgePelicanVerdict, startInspection } from '../../store/actions'
import { isManuallyExcluded } from '../../lib/derive'
import { formatDateTime, formatDuration } from '../../lib/format'
import { isCompositionEvent, isEditingTarget, isPlainShortcut } from '../../lib/keyboard'
import { Chip, HoverCard, Icon, Modal, PlanMark, SecretName } from '../ui'
import { PelicanSvgFrame, formatSvgBytes, latestPelicanSvgRound } from './PelicanSvgStage'

export function PelicanLightbox() {
  const lightbox = useStore((s) => s.pelicanLightbox)
  const credentials = useStore((s) => s.credentials)
  const targets = useStore((s) => s.targets)
  const settings = useStore((s) => s.settings)
  const connection = useStore((s) => s.connection)
  const starting = useStore((s) => s.starting)
  const judging = useStore((s) => s.judging)
  const tasks = useStore((s) => s.tasks)
  const openPelicanLightbox = useStore((s) => s.openPelicanLightbox)
  const closePelicanLightbox = useStore((s) => s.closePelicanLightbox)
  const openDetail = useStore((s) => s.openDetail)

  // Retain last active lightbox state briefly so Modal exit animation never flashes empty.
  const retainedLightboxRef = useRef(lightbox)
  if (lightbox) retainedLightboxRef.current = lightbox
  const effectiveLightbox = lightbox ?? retainedLightboxRef.current

  const [invertBackdrop, setInvertBackdrop] = useState(false)
  const autoAdvanceTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (autoAdvanceTimerRef.current !== null) window.clearTimeout(autoAdvanceTimerRef.current)
    },
    [],
  )

  const galleryEntries = useMemo(() => {
    const targetByCred = new Map<string, (typeof targets)[number]>()
    for (const target of targets) {
      if (target.model === settings.inspectionModel) {
        targetByCred.set(target.credentialId, target)
      }
    }
    const items: { credentialId: string; roundId: string; unjudged: boolean }[] = []
    for (const cred of credentials) {
      if (isManuallyExcluded(cred)) continue
      const t = targetByCred.get(cred.id)
      const svgRound = latestPelicanSvgRound(t)
      if (svgRound) {
        const judged =
          svgRound.evidence.pelican?.judgedVerdict ??
          (svgRound.outcome === 'normal' || svgRound.outcome === 'downshift' ? svgRound.outcome : null)
        items.push({ credentialId: cred.id, roundId: svgRound.id, unjudged: !judged })
      }
    }
    return items
  }, [credentials, targets, settings.inspectionModel])

  const activeTarget = useMemo(() => {
    if (!effectiveLightbox) return null
    if (effectiveLightbox.roundId) {
      const byRound = targets.find(
        (t) => t.credentialId === effectiveLightbox.credentialId && t.rounds.some((r) => r.id === effectiveLightbox.roundId),
      )
      if (byRound) return byRound
    }
    return (
      targets.find((t) => t.credentialId === effectiveLightbox.credentialId && t.model === settings.inspectionModel) ??
      targets.find((t) => t.credentialId === effectiveLightbox.credentialId && Boolean(latestPelicanSvgRound(t))) ??
      null
    )
  }, [effectiveLightbox, targets, settings.inspectionModel])

  const activeRound = useMemo(() => {
    if (!effectiveLightbox || !activeTarget) return null
    if (effectiveLightbox.roundId) {
      const found = activeTarget.rounds.find((r) => r.id === effectiveLightbox.roundId && Boolean(r.evidence.pelican?.svg))
      if (found) return found
    }
    return latestPelicanSvgRound(activeTarget)
  }, [effectiveLightbox, activeTarget])

  const credential = effectiveLightbox ? credentials.find((c) => c.id === effectiveLightbox.credentialId) : undefined

  const galleryIndex = useMemo(() => {
    if (!effectiveLightbox) return -1
    return galleryEntries.findIndex((entry) => entry.credentialId === effectiveLightbox.credentialId)
  }, [effectiveLightbox, galleryEntries])

  const prevEntry = galleryIndex > 0 ? galleryEntries[galleryIndex - 1] : null
  const nextEntry =
    galleryIndex >= 0 && galleryIndex + 1 < galleryEntries.length ? galleryEntries[galleryIndex + 1] : null
  const unjudgedCount = useMemo(
    () => galleryEntries.reduce((sum, item) => sum + Number(item.unjudged), 0),
    [galleryEntries],
  )

  const pelican = activeRound?.evidence.pelican
  const svg = pelican?.svg ?? ''
  const judgedVerdict =
    pelican?.judgedVerdict ??
    (activeRound?.outcome === 'normal' || activeRound?.outcome === 'downshift' ? activeRound.outcome : null)
  const isJudging = Boolean(credential && judging.includes(credential.id))
  const isRunningTarget = Boolean(
    activeTarget &&
      tasks.some(
        (task) => task.status === 'running' && task.items.some((item) => item.targetId === activeTarget.id),
      ),
  )
  const canJudge =
    connection === 'connected' &&
    Boolean(credential && !credential.disabled && !isManuallyExcluded(credential)) &&
    !isJudging &&
    !isRunningTarget
  const canRedraw =
    connection === 'connected' &&
    !starting &&
    !isRunningTarget &&
    Boolean(activeTarget && credential && evaluateEligibility(activeTarget, settings, credential).runnable)

  const handleJudge = useCallback(
    (verdict: 'normal' | 'downshift') => {
      if (!canJudge || !credential || !activeRound || !activeTarget) return
      const wasUnjudged = judgedVerdict === null
      // Auto-advance to the next unjudged artwork in cyclic order for rapid triage flow.
      let nextUnjudged: { credentialId: string; roundId: string } | null = null
      if (wasUnjudged && galleryEntries.length > 1 && galleryIndex >= 0) {
        for (let offset = 1; offset < galleryEntries.length; offset += 1) {
          const candidate = galleryEntries[(galleryIndex + offset) % galleryEntries.length]
          if (candidate.credentialId !== credential.id && candidate.unjudged) {
            nextUnjudged = candidate
            break
          }
        }
      }
      void judgePelicanVerdict(credential.id, verdict, activeRound.id, activeTarget.model)
      if (nextUnjudged) {
        if (autoAdvanceTimerRef.current !== null) window.clearTimeout(autoAdvanceTimerRef.current)
        autoAdvanceTimerRef.current = window.setTimeout(() => {
          autoAdvanceTimerRef.current = null
          if (useStore.getState().pelicanLightbox) {
            openPelicanLightbox(nextUnjudged.credentialId, nextUnjudged.roundId)
          }
        }, 210)
      }
    },
    [canJudge, credential, activeRound, activeTarget, judgedVerdict, galleryEntries, galleryIndex, openPelicanLightbox],
  )

  useEffect(() => {
    if (!lightbox) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCompositionEvent(event) || isEditingTarget(event.target)) return
      if (isPlainShortcut(event, 'ArrowLeft') && prevEntry) {
        event.preventDefault()
        openPelicanLightbox(prevEntry.credentialId, prevEntry.roundId)
      } else if (isPlainShortcut(event, 'ArrowRight') && nextEntry) {
        event.preventDefault()
        openPelicanLightbox(nextEntry.credentialId, nextEntry.roundId)
      } else if (isPlainShortcut(event, '1') && canJudge) {
        event.preventDefault()
        handleJudge('normal')
      } else if (isPlainShortcut(event, '2') && canJudge) {
        event.preventDefault()
        handleJudge('downshift')
      } else if (isPlainShortcut(event, 'r') && canRedraw && activeTarget) {
        event.preventDefault()
        const tid = activeTarget.id
        closePelicanLightbox()
        void startInspection('manual', [tid])
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [lightbox, prevEntry, nextEntry, canJudge, canRedraw, activeTarget, openPelicanLightbox, closePelicanLightbox, handleJudge])

  if (!activeTarget || !activeRound || !pelican?.svg) return null

  const effectiveScheme: 'light' | 'dark' = invertBackdrop
    ? settings.theme === 'dark'
      ? 'light'
      : 'dark'
    : settings.theme

  return (
    <Modal
      open={Boolean(lightbox)}
      wide
      onClose={closePelicanLightbox}
      className="pelican-lightbox-modal"
      title={
        <span className="pelican-lightbox-title">
          {credential && <PlanMark plan={credential.plan} size="sm" />}
          <span>{credential ? <SecretName name={credential.name} /> : '已移除凭证'}</span>
          <code className="inline-code">{activeTarget.model}</code>
          {judgedVerdict === 'normal' ? (
            <Chip tone="normal" dot>正常</Chip>
          ) : judgedVerdict === 'downshift' ? (
            <Chip tone="downshift" dot>风控</Chip>
          ) : (
            <Chip tone="uncertain" dot>待判定</Chip>
          )}
          {galleryIndex >= 0 && (
            <span className="pelican-lightbox-counter">
              {galleryIndex + 1} / {galleryEntries.length}
              {unjudgedCount > 0 ? ` · 待判 ${unjudgedCount}` : ''}
            </span>
          )}
        </span>
      }
      sub={
        <span className="pelican-lightbox-sub">
          <span>{formatDateTime(activeRound.finishedAt)}</span>
          <span>· 耗时 {formatDuration(activeRound.evidence.durationMs)}</span>
          {activeRound.evidence.usage && (
            <span>· {activeRound.evidence.usage.outputTokens.toLocaleString('zh-CN')} tok</span>
          )}
          <span>· {formatSvgBytes(pelican.svgBytes || svg.length)}</span>
          {!pelican.strictFormat && <span className="pelican-sub-warn">· 宽容提取</span>}
        </span>
      }
      footer={
        <>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              const tid = activeTarget.id
              const rid = activeRound.id
              closePelicanLightbox()
              openDetail(tid, rid)
            }}
          >
            <Icon.Doc />
            <span>查看依据与源码</span>
          </button>

          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={!canRedraw}
            onClick={() => {
              const tid = activeTarget.id
              closePelicanLightbox()
              void startInspection('manual', [tid])
            }}
          >
            <Icon.Refresh />
            <span>重新绘制</span>
            <kbd className="btn-kbd" aria-hidden="true">R</kbd>
          </button>

          <span className="spacer" />

          {credential && (
            <div className="pelican-lightbox-verdict-btns" role="group" aria-label="快速判定风控分组">
              <button
                type="button"
                className={`pelican-judge-btn is-normal${judgedVerdict === 'normal' ? ' is-selected' : ''}`}
                aria-pressed={judgedVerdict === 'normal'}
                disabled={!canJudge}
                onClick={() => handleJudge('normal')}
              >
                <Icon.Check />
                <span>判为正常</span>
                <kbd className="btn-kbd" aria-hidden="true">1</kbd>
              </button>
              <button
                type="button"
                className={`pelican-judge-btn is-downshift${judgedVerdict === 'downshift' ? ' is-selected' : ''}`}
                aria-pressed={judgedVerdict === 'downshift'}
                disabled={!canJudge}
                onClick={() => handleJudge('downshift')}
              >
                <span className="pelican-judge-bang" aria-hidden="true">!</span>
                <span>判为风控</span>
                <kbd className="btn-kbd" aria-hidden="true">2</kbd>
              </button>
            </div>
          )}
        </>
      }
    >
      <div className={`pelican-lightbox-viewport is-scheme-${effectiveScheme}`}>
        <HoverCard
          compact
          placement="bottom"
          wrapperClassName="pelican-lightbox-contrast-anchor"
          content={invertBackdrop ? '恢复跟随主题衬底' : '切换明/暗对比衬底（适用于透明线条画作）'}
        >
          <button
            type="button"
            className={`pelican-lightbox-contrast-btn${invertBackdrop ? ' is-toggled' : ''}`}
            aria-label="切换画布明暗对比衬底"
            onClick={() => setInvertBackdrop((v) => !v)}
          >
            {effectiveScheme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
          </button>
        </HoverCard>

        {galleryEntries.length > 1 && (
          <button
            type="button"
            className="pelican-lightbox-nav is-prev"
            disabled={!prevEntry}
            aria-label="上一幅画作（方向键 ←）"
            onClick={() => prevEntry && openPelicanLightbox(prevEntry.credentialId, prevEntry.roundId)}
          >
            <Icon.Chevron dir="right" />
          </button>
        )}

        <div className="pelican-lightbox-canvas" key={activeRound.id}>
          <PelicanSvgFrame
            svg={svg}
            colorScheme={effectiveScheme}
            title={`${credential?.name ?? activeTarget.credentialId} 鹈鹕骑自行车动画大图`}
            interactive
            lazy={false}
          />
        </div>

        {galleryEntries.length > 1 && (
          <button
            type="button"
            className="pelican-lightbox-nav is-next"
            disabled={!nextEntry}
            aria-label="下一幅画作（方向键 →）"
            onClick={() => nextEntry && openPelicanLightbox(nextEntry.credentialId, nextEntry.roundId)}
          >
            <Icon.Chevron dir="right" />
          </button>
        )}
      </div>
    </Modal>
  )
}
