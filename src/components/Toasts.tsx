import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'
import type { Toast } from '../types'
import { Icon } from './ui'

const MARK: Record<Toast['tone'], string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  danger: '!',
}

const TOAST_DURATION_MS = 4800
const TOAST_EXIT_MS = 180

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [leaving, setLeaving] = useState(false)
  const [paused, setPaused] = useState(false)
  const remainingRef = useRef(TOAST_DURATION_MS)
  const startedAtRef = useRef(Date.now())
  const timerRef = useRef<number | null>(null)
  const exitTimerRef = useRef<number | null>(null)

  const triggerExit = useCallback(() => {
    setLeaving((already) => {
      if (already) return true
      const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) {
        onDismiss(toast.id)
      } else {
        exitTimerRef.current = window.setTimeout(() => onDismiss(toast.id), TOAST_EXIT_MS)
      }
      return true
    })
  }, [onDismiss, toast.id])

  useEffect(() => {
    if (leaving) return
    if (paused) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      remainingRef.current = Math.max(400, remainingRef.current - (Date.now() - startedAtRef.current))
      return
    }
    startedAtRef.current = Date.now()
    timerRef.current = window.setTimeout(triggerExit, remainingRef.current)
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [paused, leaving, triggerExit])

  useEffect(
    () => () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)
    },
    [],
  )

  return (
    <div
      className={`toast toast-${toast.tone}${leaving ? ' is-leaving' : ''}${paused ? ' is-paused' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-mark" aria-hidden="true">
        {MARK[toast.tone]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="toast-title">{toast.title}</div>
        {toast.detail && <div className="toast-detail">{toast.detail}</div>}
      </div>
      <button
        type="button"
        className="icon-btn toast-close"
        onClick={triggerExit}
        aria-label="关闭提示"
      >
        <Icon.Close />
      </button>
      <span className="toast-progress" aria-hidden="true" />
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  )
}
