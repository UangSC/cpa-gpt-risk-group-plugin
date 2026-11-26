import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/store'
import { saveInspectionOptions } from '../../store/actions'
import { isCompositionEvent, isPlainShortcut } from '../../lib/keyboard'
import { HoverCard } from '../ui'

export function InspectionConcurrency({ value, disabled }: { value: number; disabled: boolean }) {
  const [draft, setDraft] = useState(String(value))
  const cancelled = useRef(false)
  const debounceRef = useRef<number | null>(null)
  useEffect(() => setDraft(String(value)), [value])
  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    },
    [],
  )

  const persistNext = (next: number, immediate = false) => {
    const clamped = Math.max(1, Math.min(9, Math.trunc(next)))
    setDraft(String(clamped))
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const run = () => {
      void saveInspectionOptions({ concurrency: { maxObjects: clamped } }).then(() =>
        setDraft(String(useStore.getState().settings.concurrency.maxObjects)),
      )
    }
    if (immediate) run()
    else debounceRef.current = window.setTimeout(run, 180)
  }

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (disabled || !draft.trim()) {
      setDraft(String(value))
      return
    }
    const parsed = Number(draft)
    const next = Number.isFinite(parsed) ? Math.max(1, Math.min(9, Math.trunc(parsed))) : value
    persistNext(next, true)
  }

  const currentNum = Number.isFinite(Number(draft)) && draft.trim() ? Math.max(1, Math.min(9, Math.trunc(Number(draft)))) : value

  return (
    <HoverCard compact placement="top" content="每批同时巡检的凭证数（1–9）">
      <div className={`inspection-concurrency${disabled ? ' is-disabled' : ''}`}>
        <span>并发</span>
        <div className="concurrency-stepper">
          <button
            type="button"
            className="concurrency-step-btn"
            aria-label="减少最大并发数"
            disabled={disabled || currentNum <= 1}
            onClick={() => persistNext(currentNum - 1)}
          >
            −
          </button>
          <input
            className="concurrency-input"
            type="text"
            inputMode="numeric"
            value={draft}
            disabled={disabled}
            aria-label="最大巡检并发数"
            onChange={(event) => {
              if (/^\d{0,1}$/.test(event.target.value)) setDraft(event.target.value)
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (isCompositionEvent(event.nativeEvent)) return
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                persistNext(currentNum + (event.key === 'ArrowUp' ? 1 : -1))
                return
              }
              if (isPlainShortcut(event.nativeEvent, 'Enter')) {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (isPlainShortcut(event.nativeEvent, 'Escape')) {
                event.preventDefault()
                event.stopPropagation()
                cancelled.current = true
                setDraft(String(value))
                event.currentTarget.blur()
              }
            }}
          />
          <button
            type="button"
            className="concurrency-step-btn"
            aria-label="增加最大并发数"
            disabled={disabled || currentNum >= 9}
            onClick={() => persistNext(currentNum + 1)}
          >
            +
          </button>
        </div>
      </div>
    </HoverCard>
  )
}
