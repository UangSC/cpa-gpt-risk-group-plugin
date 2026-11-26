import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { LightTone } from '../../lib/derive'

/**
 * Lightweight GPU-accelerated sliding pill indicator for Segmented and Nav controls.
 * Snaps without animation on initial mount (zero FOUC/jump), then glides smoothly on key changes.
 */
export function useSlidingIndicator<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  activeKey: string | number | null | undefined,
  selector = "[aria-pressed='true'], [aria-current='page']",
) {
  const [metric, setMetric] = useState<{ x: number; w: number; ready: boolean; animate: boolean }>({
    x: 0,
    w: 0,
    ready: false,
    animate: false,
  })
  const prevKeyRef = useRef(activeKey)

  useLayoutEffect(() => {
    const root = containerRef.current
    if (!root) return

    const measure = (allowAnimate: boolean) => {
      const target = root.querySelector<HTMLElement>(selector)
      if (!target || target.offsetWidth === 0) {
        setMetric((prev) => (prev.ready ? { ...prev, ready: false, animate: false } : prev))
        return
      }
      let x = 0
      let cur: HTMLElement | null = target
      while (cur && cur !== root) {
        x += cur.offsetLeft
        cur = cur.offsetParent as HTMLElement | null
      }
      const w = target.offsetWidth
      setMetric((prev) => {
        if (prev.ready && prev.x === x && prev.w === w && prev.animate === allowAnimate) return prev
        return { x, w, ready: true, animate: prev.ready && allowAnimate }
      })
    }

    const keyChanged = prevKeyRef.current !== activeKey
    prevKeyRef.current = activeKey
    measure(keyChanged)

    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure(false))
    ro.observe(root)
    for (const btn of root.querySelectorAll<HTMLElement>('button')) {
      ro.observe(btn)
    }
    return () => ro.disconnect()
  }, [containerRef, activeKey, selector])

  return metric
}

export function Dot({ tone }: { tone: LightTone }) {
  return <span className={`dot dot-${tone}`} aria-hidden="true" />
}

export type ChipTone = 'plain' | LightTone | 'accent'

export function Chip({
  tone = 'plain',
  dot = false,
  children,
}: {
  tone?: ChipTone
  dot?: boolean
  children: ReactNode
}) {
  const cls =
    tone === 'normal'
      ? 'chip-normal'
      : tone === 'uncertain'
        ? 'chip-warn'
        : tone === 'downshift'
          ? 'chip-danger'
          : tone === 'accent'
            ? 'chip-accent'
            : ''
  return (
    <span className={`chip ${cls} ${dot ? 'chip-dot' : ''}`}>
      {children}
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label className="switch" style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="track" aria-hidden="true" />
      <span className="switch-label">{label}</span>
    </label>
  )
}

/* ------------------------------------------------------------ segmented */

export interface SegmentedOption<T extends string> {
  disabled?: boolean
  value: T
  label: ReactNode
  count?: number
  tone?: LightTone
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (next: T) => void
  ariaLabel: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pill = useSlidingIndicator(ref, value)

  return (
    <div
      ref={ref}
      className={`segmented${className ? ` ${className}` : ''}`}
      data-sliding={pill.ready ? 'true' : undefined}
      role="group"
      aria-label={ariaLabel}
    >
      {pill.ready && (
        <span
          className="sliding-pill"
          data-animate={pill.animate ? 'true' : undefined}
          aria-hidden="true"
          style={
            {
              '--pill-x': `${pill.x}px`,
              '--pill-w': `${pill.w}px`,
            } as CSSProperties
          }
        />
      )}
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          disabled={opt.disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.tone && <Dot tone={opt.tone} />}
          {opt.label}
          {opt.count != null && <span className="seg-count">{opt.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Ticking clock so relative times and countdowns stay honest without wasting idle cycles when hidden/disabled. */
export function useNow(intervalMs = 30_000, enabled = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      if (typeof document === 'undefined' || !document.hidden) setNow(Date.now())
    }
    tick()
    const timer = window.setInterval(tick, intervalMs)
    const onVisibility = () => {
      if (!document.hidden) setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, enabled])
  return now
}

const QUOTA_WINDOW_LABELS: Record<string, string> = {
  '5h': '5h',
  '7d': '周限',
  '30d': '月限',
}

export function QuotaMeter({
  windows,
  threshold,
  refreshing = false,
}: {
  windows: { key: string; remainingPercent: number | null }[]
  threshold: number
  refreshing?: boolean
}) {
  return (
    <div className={`quota${refreshing ? ' is-quota-refreshing' : ''}`}>
      {windows.map((w) => {
        const value = w.remainingPercent
        const low = value != null && value <= threshold
        const mid = value != null && !low && value < 45
        return (
          <div className="quota-item" key={w.key}>
            {/* Label sits before the track, so the bar itself takes the whole row width. */}
            <span className="quota-key">{QUOTA_WINDOW_LABELS[w.key] ?? w.key}</span>
            <div className="quota-bar">
              <span
                className={value == null ? 'is-unknown' : low ? 'is-low' : mid ? 'is-mid' : ''}
                style={{ width: value == null ? '100%' : `${Math.max(2, value)}%` }}
              />
            </div>
            <b className={`quota-value ${low ? 'is-low' : ''}`}>
              {value == null ? '未知' : `${value}%`}
            </b>
          </div>
        )
      })}
    </div>
  )
}
