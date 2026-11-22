import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_TOOLTIP_DELAY_MS, scheduleTooltipOpening, suppressSelectionReleaseClick } from '../../lib/tooltipInteraction'

/**
 * Small hover/focus card rendered in a portal so card `overflow: hidden` never clips it.
 * 鼠标悬浮和键盘焦点均按组件指定的延迟显示；主动点击固定气泡仍会立即打开。
 */
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
  disabled = false,
  wrapperClassName,
  wrapperStyle,
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
  /** 使用相同主题的紧凑小气泡，不携带额外操作说明。 */
  compact?: boolean
  disabled?: boolean
  wrapperClassName?: string
  wrapperStyle?: CSSProperties
}) {
  const [visible, setVisible] = useState(false)
  const [fading, setFading] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; placement: 'top' | 'bottom' }>({
    left: 0,
    top: 0,
    placement,
  })
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
  const blocked = disabled || content === null || content === undefined || content === false

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
    if (blocked) return
    const el = anchor.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: rect.left + rect.width / 2,
      top: placement === 'top' ? rect.top - 8 : rect.bottom + 8,
      placement,
    })
    setFading(false)
    setVisible(true)
  }, [blocked, placement])

  const hideNow = useCallback(() => {
    clearTimers()
    setVisible(false)
    setFading(false)
    pinnedRef.current = false
    setPinned(false)
  }, [clearTimers])

  useEffect(() => {
    if (blocked && visible) hideNow()
  }, [blocked, visible, hideNow])

  useLayoutEffect(() => {
    if (!visible || !tip.current || !anchor.current) return
    const rect = anchor.current.getBoundingClientRect()
    const tipRect = tip.current.getBoundingClientRect()
    const pad = 10
    const gap = 8
    let resolvedPlacement: 'top' | 'bottom' = placement
    const spaceAbove = rect.top - gap - pad
    const spaceBelow = window.innerHeight - rect.bottom - gap - pad
    if (placement === 'top' && spaceAbove < tipRect.height && spaceBelow > spaceAbove) {
      resolvedPlacement = 'bottom'
    } else if (placement === 'bottom' && spaceBelow < tipRect.height && spaceAbove > spaceBelow) {
      resolvedPlacement = 'top'
    }
    const rawTop = resolvedPlacement === 'top' ? rect.top - gap - tipRect.height : rect.bottom + gap
    const clampedTop = Math.max(pad, Math.min(rawTop, Math.max(pad, window.innerHeight - tipRect.height - pad)))
    const rawLeft = rect.left + rect.width / 2 - tipRect.width / 2
    const clampedLeft = Math.max(pad, Math.min(rawLeft, Math.max(pad, window.innerWidth - tipRect.width - pad)))
    setPos((prev) =>
      prev.left === clampedLeft && prev.top === clampedTop && prev.placement === resolvedPlacement
        ? prev
        : { left: clampedLeft, top: clampedTop, placement: resolvedPlacement },
    )
  }, [visible, placement, content, compact])

  /** Entering again during the linger or the fade cancels the pending close. */
  const show = useCallback(() => {
    if (blocked) return
    clearTimers()
    if (visible && pinnedRef.current) {
      openNow()
      return
    }
    if (visible) {
      setVisible(false)
      setFading(false)
    }
    showCleanup.current = scheduleTooltipOpening(() => {
      showCleanup.current = null
      openNow()
    }, showDelay)
  }, [blocked, clearTimers, openNow, showDelay, visible])

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
        className={wrapperClassName}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={(event) => { if (event.target.matches(':focus-visible')) show() }}
        onBlur={() => !pinnedRef.current && hideNow()}
        onClickCapture={pinOnClick ? undefined : hideNow}
        onClick={pinOnClick ? togglePin : undefined}
        data-pinned={pinned ? 'true' : undefined}
        style={wrapperStyle ?? (wrapperClassName ? undefined : { display: 'inline-flex' })}
      >
        {children}
      </span>
      {visible &&
        !blocked &&
        createPortal(
          <div
            ref={tip}
            className={`tip is-${pos.placement} ${compact ? 'is-compact' : ''} ${fading ? 'is-fading' : ''} ${pinned ? 'is-pinned' : ''} ${selecting ? 'is-selecting-text' : ''} ${
              pinOnClick ? 'has-hint' : ''
            }`}
            role="tooltip"
            style={{
              left: pos.left,
              top: pos.top,
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
