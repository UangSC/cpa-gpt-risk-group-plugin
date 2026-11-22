import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_TOOLTIP_DELAY_MS, scheduleTooltipOpening, suppressSelectionReleaseClick } from '../../lib/tooltipInteraction'

/**
 * Small hover/focus card rendered in a portal so card `overflow: hidden` never clips it.
 * 鼠标悬浮和键盘焦点均按组件指定的延迟显示；主动点击固定气泡仍会立即打开。
 */
/** A pinned tip lingers this long after the pointer leaves, then fades out. */
const PIN_LINGER_MS = 1000
const FADE_MS = 620

export function HoverCard({
  content,
  children,
  placement = 'top',
  pinOnClick = false,
  hideDelay = 0,
  fadeOnHide = true,
  showDelay = DEFAULT_TOOLTIP_DELAY_MS,
  compact = false,
}: {
  content: ReactNode
  children: ReactNode
  placement?: 'top' | 'bottom'
  /** Clicking the anchor pins the tip; after leaving it lingers, then fades out. */
  pinOnClick?: boolean
  hideDelay?: number
  /** 普通气泡离开触发器时是否渐隐。 */
  fadeOnHide?: boolean
  /** 悬浮或聚焦后显示气泡的等待毫秒数。 */
  showDelay?: number
  /** 使用相同主题的两字小气泡，不携带额外操作说明。 */
  compact?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [fading, setFading] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const anchor = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const pointerInside = useRef(false)
  const selectionDrag = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const selectionCleanup = useRef<(() => void) | null>(null)
  const releaseClickCleanup = useRef<(() => void) | null>(null)
  const showCleanup = useRef<(() => void) | null>(null)
  const hideTimer = useRef<number | null>(null)
  const fadeTimer = useRef<number | null>(null)
  const pinnedRef = useRef(false)

  const hasSelectedText = useCallback(() => {
    const selection = window.getSelection()
    return !!selection && !selection.isCollapsed && !!tip.current &&
      (tip.current.contains(selection.anchorNode) || tip.current.contains(selection.focusNode))
  }, [])

  const clearTimers = useCallback(() => {
    showCleanup.current?.()
    showCleanup.current = null
    for (const ref of [hideTimer, fadeTimer]) {
      if (ref.current !== null) {
        window.clearTimeout(ref.current)
        ref.current = null
      }
    }
  }, [])

  const openNow = useCallback(() => {
    const el = anchor.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({ x: rect.left + rect.width / 2, y: placement === 'top' ? rect.top - 8 : rect.bottom + 8 })
    setFading(false)
    setVisible(true)
  }, [placement])

  /** Entering again during the linger or the fade cancels the pending close. */
  const show = useCallback(() => {
    clearTimers()
    if (visible && pinnedRef.current) {
      openNow()
      return
    }
    // 未固定的气泡在重新进入时重新计时，不沿用上一段短暂悬浮。
    if (visible) {
      setVisible(false)
      setFading(false)
    }
    showCleanup.current = scheduleTooltipOpening(() => {
      showCleanup.current = null
      openNow()
    }, showDelay)
  }, [clearTimers, openNow, showDelay, visible])

  const hideNow = useCallback(() => {
    clearTimers()
    setVisible(false)
    setFading(false)
    pinnedRef.current = false
    setPinned(false)
  }, [clearTimers])

  /**
   * Leaving schedules the close. A pinned tip waits `PIN_LINGER_MS` first, so moving back
   * inside during that window keeps it open; it then fades out over `FADE_MS`.
   */
  const scheduleHide = useCallback(() => {
    if (selectionDrag.current || (pinnedRef.current && hasSelectedText())) return
    if (!fadeOnHide && !pinnedRef.current) {
      hideNow()
      return
    }
    clearTimers()
    const wait = pinnedRef.current ? Math.max(PIN_LINGER_MS, hideDelay) : hideDelay
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null
      setFading(true)
      fadeTimer.current = window.setTimeout(() => {
        fadeTimer.current = null
        setVisible(false)
        setFading(false)
        pinnedRef.current = false
        setPinned(false)
      }, FADE_MS)
    }, wait)
  }, [clearTimers, fadeOnHide, hideDelay, hideNow, hasSelectedText])

  useEffect(
    () => () => {
      clearTimers()
      selectionCleanup.current?.()
      releaseClickCleanup.current?.()
    },
    [clearTimers],
  )

  useEffect(() => {
    if (!visible || !pinned) return
    const onSelectionChange = () => {
      if (!pinnedRef.current) return
      if (hasSelectedText()) { clearTimers(); setFading(false) }
      else if (!selectionDrag.current && !pointerInside.current && !anchor.current?.matches(':hover')) scheduleHide()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [visible, pinned, hasSelectedText, clearTimers, scheduleHide])

  const startTextSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const target = event.target as Element
    if (!pinnedRef.current || event.button !== 0 || selectionDrag.current ||
      target.closest('button,a,input,textarea,select,[role="button"],[role="link"]')) return
    clearTimers()
    setFading(false)
    setSelecting(true)
    selectionDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent) => {
      const current = selectionDrag.current
      if (current && move.pointerId === current.pointerId && Math.hypot(move.clientX - current.x, move.clientY - current.y) > 4) current.moved = true
    }
    const finish = (release: PointerEvent) => {
      const current = selectionDrag.current
      if (!current || current.pointerId !== release.pointerId) return
      release.stopPropagation()
      selectionDrag.current = null
      selectionCleanup.current?.()
      selectionCleanup.current = null
      setSelecting(false)
      if (release.type !== 'pointercancel' && (current.moved || hasSelectedText())) {
        releaseClickCleanup.current?.()
        releaseClickCleanup.current = suppressSelectionReleaseClick(document)
      }
      const node = tip.current
      if (node?.hasPointerCapture(current.pointerId)) node.releasePointerCapture(current.pointerId)
      if (node) {
        const rect = node.getBoundingClientRect()
        pointerInside.current = release.clientX >= rect.left && release.clientX <= rect.right && release.clientY >= rect.top && release.clientY <= rect.bottom
      }
      if (!pointerInside.current) scheduleHide()
    }
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', finish, true)
    document.addEventListener('pointercancel', finish, true)
    selectionCleanup.current = () => {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', finish, true)
      document.removeEventListener('pointercancel', finish, true)
    }
  }

  const togglePin = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    const next = !pinnedRef.current
    pinnedRef.current = next
    setPinned(next)
    if (next) {
      clearTimers()
      openNow()
    } else {
      scheduleHide()
    }
  }

  return (
    <>
      <span
        ref={anchor}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={(event) => { if (event.target.matches(':focus-visible')) show() }}
        onBlur={() => !pinnedRef.current && hideNow()}
        onClickCapture={pinOnClick ? undefined : hideNow}
        onClick={pinOnClick ? togglePin : undefined}
        data-pinned={pinned ? 'true' : undefined}
        style={{ display: 'inline-flex' }}
      >
        {children}
      </span>
      {visible &&
        createPortal(
          <div
            ref={tip}
            className={`tip ${compact ? 'is-compact' : ''} ${fading ? 'is-fading' : ''} ${pinned ? 'is-pinned' : ''} ${selecting ? 'is-selecting-text' : ''} ${
              pinOnClick ? 'has-hint' : ''
            }`}
            role="tooltip"
            style={{
              left: pos.x,
              top: pos.y,
              transform: placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
            onMouseEnter={() => { pointerInside.current = true; if (pinnedRef.current) show() }}
            onMouseLeave={() => { pointerInside.current = false; if (pinnedRef.current) scheduleHide() }}
            onPointerDown={startTextSelection}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseUp={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); if ((event.target as Element).closest('button,a')) hideNow() }}
          >
            {content}
            {pinOnClick && (
              <div className="tip-pin-hint">
                {pinned ? '已固定 · 移出 1 秒后自动淡出' : '点击固定气泡'}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
