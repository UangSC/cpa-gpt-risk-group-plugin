import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Credential, RoutingValues } from '../types'
import { normalizeRoutingValue, routingFor } from '../lib/routing'
import { useStore } from '../store/store'
import { saveCredentialRouting } from '../store/actions'
import { hasOpenDialog, isCompositionEvent, isPlainShortcut, isPrimaryShortcut } from '../lib/keyboard'
import { isWeightZeroWarningSuppressed } from '../lib/weightZeroWarning'
import { HoverCard, Icon } from './ui'

function RoutingStepper({ value, label, onChange, disabled, field = 'priority' }: {
  field?: keyof RoutingValues
  value: number
  label: string
  onChange: (value: number) => void
  disabled: boolean
}) {
  const [draft, setDraft] = useState(String(value))
  const cancelled = useRef(false)
  useEffect(() => setDraft(String(value)), [value, disabled])
  const commit = () => {
    if (disabled) return
    if (cancelled.current) { cancelled.current = false; return }
    if (draft === '' || draft === '-') { setDraft(String(value)); return }
    const next = normalizeRoutingValue(Number(draft), field)
    setDraft(String(next))
    onChange(next)
  }
  return (
    <div className="routing-stepper">
      <button type="button" aria-label={`减少${label}`} disabled={disabled || value <= (field === 'weight' ? 0 : -9999)} onClick={() => onChange(value - 1)}>−</button>
      <input type="text" inputMode="text" value={draft} aria-label={label}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value
          if (/^-?\d{0,4}$/.test(next)) setDraft(next)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (isCompositionEvent(event.nativeEvent)) return
          // 设置页保存前先提交当前输入；概览中的优先级编辑不能借此自动写入 CPA。
          if (isPrimaryShortcut(event.nativeEvent, 's') && useStore.getState().tab === 'settings' && !hasOpenDialog()) {
            event.currentTarget.blur()
          }
          if (isPlainShortcut(event.nativeEvent, 'Enter')) {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.blur()
          }
          if (isPlainShortcut(event.nativeEvent, 'Escape')) {
            event.preventDefault()
            event.stopPropagation()
            cancelled.current = true
            setDraft(String(value))
            event.currentTarget.blur()
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const base = Number(draft)
            const next = normalizeRoutingValue((Number.isFinite(base) ? base : value) + (event.key === 'ArrowUp' ? 1 : -1), field)
            setDraft(String(next))
            onChange(next)
          }
        }} />
      <button type="button" aria-label={`增加${label}`} disabled={disabled || value >= 9999} onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

export function RoutingControls({ values, onChange, label, showLabels = false, showWeight = true, showPriority = true, inheritedWeight, disabled = false }: {
  values: RoutingValues
  onChange: (values: RoutingValues) => void
  label: string
  showLabels?: boolean
  showPriority?: boolean
  showWeight?: boolean
  inheritedWeight?: number | null
  disabled?: boolean
}) {
  const saving = useStore((state) => state.settingsSaving)
  const weightEditable = useStore((state) => state.capabilities.weightEditingEnabled)
  const currentWeight = inheritedWeight === undefined ? values.weight : inheritedWeight
  return (
    <div className={`routing-controls ${showLabels ? 'with-labels' : ''}`} onClick={(event) => event.stopPropagation()}>
      {showPriority && <div className="routing-field">
        {showLabels && <span>优先级</span>}
        <RoutingStepper value={values.priority} label={`${label}优先级`} disabled={disabled || saving}
          onChange={(value) => onChange({ ...values, priority: normalizeRoutingValue(value, 'priority') })} />
      </div>}
      {showWeight && <div className="routing-field">
        {showLabels && <span>权重</span>}
        {weightEditable && currentWeight != null ? <RoutingStepper field="weight" value={currentWeight} label={`${label}权重`} disabled={disabled || saving}
          onChange={(weight) => onChange({ ...values, weight })} /> : <output className="routing-inherited" aria-label={`${label}权重`}>
          <strong>{currentWeight ?? '未知'}</strong>
        </output>}
      </div>}
    </div>
  )
}

export function CredentialRouting({
  credential,
  field,
  compact = false,
}: {
  credential: Credential
  showLabels?: boolean
  field?: keyof RoutingValues
  compact?: boolean
}) {
  const routing = useStore((state) => state.settings.routing)
  const saving = useStore((state) => state.settingsSaving)
  const connected = useStore((state) => state.connection === 'connected')
  const syncing = useStore((state) => state.syncing.includes(credential.id))
  const weightEditable = useStore((state) => state.capabilities.weightEditingEnabled)
  const disabled = !connected || syncing || credential.disabled
  const values = routingFor(credential, routing)
  const currentWeight = credential.routing?.weight ?? values.weight
  const isCustom = Boolean(routing.overrides[credential.id])

  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; placement: 'bottom' | 'top' } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()

  const computeCoords = (popoverWidth = 252) => {
    const trigger = triggerRef.current
    if (!trigger) return null
    const rect = trigger.getBoundingClientRect()
    const gap = 6
    const pad = 8
    const estH = 128
    const spaceBelow = window.innerHeight - rect.bottom - gap - pad
    const spaceAbove = rect.top - gap - pad
    const placeTop = spaceBelow < estH && spaceAbove > spaceBelow
    const left = Math.max(pad, Math.min(rect.left, window.innerWidth - popoverWidth - pad))
    return placeTop
      ? { bottom: window.innerHeight - rect.top + gap, left, placement: 'top' as const }
      : { top: rect.bottom + gap, left, placement: 'bottom' as const }
  }

  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return
    const width = popoverRef.current.getBoundingClientRect().width
    setCoords(computeCoords(width))
  }, [open, isCustom])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.activeElement instanceof HTMLInputElement && popoverRef.current?.contains(document.activeElement)) {
          return
        }
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const togglePopover = () => {
    if (disabled) return
    if (open) {
      setOpen(false)
    } else {
      setCoords(computeCoords())
      setOpen(true)
    }
  }

  return (
    <div className="routing-pill-wrap" onClick={(event) => event.stopPropagation()}>
      <HoverCard
        compact
        placement="top"
        disabled={disabled || open}
        content="点击调整优先级或权重"
      >
        <button
          ref={triggerRef}
          type="button"
          className={`routing-pill ${compact ? 'is-compact' : ''} ${open ? 'is-open' : ''} ${isCustom ? 'is-custom' : ''}`}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          aria-label={disabled ? '调度参数（已关闭）' : `调整调度参数：优先级 ${values.priority}，权重 ${currentWeight ?? '未知'}`}
          onClick={togglePopover}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
          }}
        >
          {compact ? (
            <>
              <b>{values.priority}</b>
              <span className="routing-pill-sep" aria-hidden="true">/</span>
              <b>{currentWeight ?? '—'}</b>
              {isCustom && <i className="routing-custom-dot" aria-hidden="true" />}
              <Icon.Sliders />
            </>
          ) : (
            <>
              <Icon.Sliders />
              <span>优先级 <b>{values.priority}</b></span>
              <span className="routing-pill-sep" aria-hidden="true">·</span>
              <span>权重 <b>{currentWeight ?? '—'}</b></span>
              {isCustom && <i className="routing-custom-dot" aria-hidden="true" />}
            </>
          )}
        </button>
      </HoverCard>

      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label="调度参数设置"
            className={`routing-popover is-${coords.placement}`}
            style={{ top: coords.top, bottom: coords.bottom, left: coords.left }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
            }}
          >
            <div className="routing-popover-head">
              <span>调度设置</span>
              {isCustom && (
                <button
                  type="button"
                  className="btn-link"
                  disabled={disabled || saving}
                  onClick={() => void saveCredentialRouting({ credentialId: credential.id, reset: true })}
                >
                  恢复默认
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                aria-label="关闭调度设置"
                onClick={() => {
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                <Icon.Close />
              </button>
            </div>

            <RoutingControls
              showPriority={field !== 'weight'}
              showWeight={field !== 'priority'}
              values={{ priority: values.priority, weight: currentWeight }}
              inheritedWeight={credential.routing?.weight ?? null}
              label="凭证"
              showLabels
              disabled={disabled}
              onChange={(next) => {
                if (next.weight !== currentWeight) {
                  if (next.weight === 0 && currentWeight !== 0 && !isWeightZeroWarningSuppressed()) {
                    setOpen(false)
                    useStore.getState().requestWeightZeroWarning({
                      credentialId: credential.id,
                      credentialName: credential.name,
                    })
                    return
                  }
                  void saveCredentialRouting({ credentialId: credential.id, weight: next.weight })
                } else if (next.priority !== values.priority) {
                  void saveCredentialRouting({ credentialId: credential.id, priority: next.priority })
                }
              }}
            />

            <p className="routing-popover-hint">
              {weightEditable ? '修改后立即同步至 CPA 凭证配置。' : '优先级立即同步；权重由 CPA 当前策略继承。'}
            </p>
          </div>,
          document.body,
        )}
    </div>
  )
}
