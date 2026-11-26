import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GroupingMode, ReasoningEffort } from '../../types'
import { useStore } from '../../store/store'
import { saveInspectionOptions } from '../../store/actions'
import { analyzePrefixes, DEFAULT_PREFIXES } from '../../lib/prefix'
import { collectQuickModelChoices } from '../../lib/models'
import { isCompositionEvent, isPlainShortcut, isPrimaryShortcut } from '../../lib/keyboard'
import { HoverCard, Icon, Segmented } from '../ui'

const EFFORTS: { value: ReasoningEffort; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

const EFFORT_SHORT: Record<ReasoningEffort, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

const MODE_LABEL: Record<GroupingMode, string> = {
  none: '仅检测',
  prefix: '模型前缀',
  priority: '仅优先级',
}

function parsePriority(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '-') return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= -9999 && parsed <= 9999 ? parsed : null
}

export function QuickConfigPopover({ disabled }: { disabled: boolean }) {
  const settings = useStore((s) => s.settings)
  const credentials = useStore((s) => s.credentials)
  const saving = useStore((s) => s.settingsSaving)
  const setTab = useStore((s) => s.setTab)

  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; placement: 'bottom' | 'top' }>({
    top: 0,
    left: 0,
    placement: 'bottom',
  })
  const [model, setModel] = useState(settings.inspectionModel)
  const [effort, setEffort] = useState<ReasoningEffort>(settings.reasoningEffort)
  const [mode, setMode] = useState<GroupingMode>(settings.routing.mode)
  const [normalPrefix, setNormalPrefix] = useState(settings.prefixes.normal)
  const [downshiftPrefix, setDownshiftPrefix] = useState(settings.prefixes.downshift)
  const [normalPriority, setNormalPriority] = useState(String(settings.routing.groups.normal.priority))
  const [ungroupedPriority, setUngroupedPriority] = useState(String(settings.routing.groups.ungrouped.priority))
  const [downshiftPriority, setDownshiftPriority] = useState(String(settings.routing.groups.downshift.priority))

  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()

  const modelChoices = useMemo(
    () => collectQuickModelChoices(credentials, settings.inspectionModel, settings.prefixes),
    [credentials, settings.inspectionModel, settings.prefixes],
  )

  const openPopover = () => {
    if (disabled) return
    setModel(settings.inspectionModel)
    setEffort(settings.reasoningEffort)
    setMode(settings.routing.mode)
    setNormalPrefix(settings.prefixes.normal)
    setDownshiftPrefix(settings.prefixes.downshift)
    setNormalPriority(String(settings.routing.groups.normal.priority))
    setUngroupedPriority(String(settings.routing.groups.ungrouped.priority))
    setDownshiftPriority(String(settings.routing.groups.downshift.priority))
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      setCoords({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 380)),
        placement: 'bottom',
      })
    }
    setOpen(true)
  }

  const closePopover = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const popRect = popoverRef.current.getBoundingClientRect()
    const gap = 6
    const pad = 8
    const spaceBelow = window.innerHeight - rect.bottom - gap - pad
    const spaceAbove = rect.top - gap - pad
    const placeTop = spaceBelow < popRect.height && spaceAbove > spaceBelow
    const top = placeTop
      ? Math.max(pad, rect.top - gap - popRect.height)
      : Math.min(rect.bottom + gap, Math.max(pad, window.innerHeight - popRect.height - pad))
    const left = Math.max(pad, Math.min(rect.left, Math.max(pad, window.innerWidth - popRect.width - pad)))
    setCoords({ top, left, placement: placeTop ? 'top' : 'bottom' })
    popoverRef.current.querySelector<HTMLElement>('.quick-model-card[aria-pressed="true"]')?.scrollIntoView({
      block: 'nearest',
    })
  }, [open, mode, normalPrefix, downshiftPrefix, modelChoices.length])

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
      if (isCompositionEvent(event)) return
      if (isPlainShortcut(event, 'Escape')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        closePopover()
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

  const analysis = analyzePrefixes({ normal: normalPrefix, downshift: downshiftPrefix })
  const cleanModel = model.trim()
  const nextPrefixes = { normal: analysis.normal.normalized, downshift: analysis.downshift.normalized }
  const parsedNormalPriority = parsePriority(normalPriority)
  const parsedUngroupedPriority = parsePriority(ungroupedPriority)
  const parsedDownshiftPriority = parsePriority(downshiftPriority)
  const priorityError =
    mode === 'priority' &&
    (parsedNormalPriority === null || parsedUngroupedPriority === null || parsedDownshiftPriority === null)
      ? '优先级应为 -9999～9999 的整数'
      : null
  const prefixChanged =
    mode === 'prefix' &&
    (nextPrefixes.normal !== settings.prefixes.normal || nextPrefixes.downshift !== settings.prefixes.downshift)
  const priorityChanged =
    mode === 'priority' &&
    ((parsedNormalPriority ?? settings.routing.groups.normal.priority) !== settings.routing.groups.normal.priority ||
      (parsedUngroupedPriority ?? settings.routing.groups.ungrouped.priority) !== settings.routing.groups.ungrouped.priority ||
      (parsedDownshiftPriority ?? settings.routing.groups.downshift.priority) !== settings.routing.groups.downshift.priority)
  const routingChanged = mode !== settings.routing.mode || priorityChanged
  const dirty =
    cleanModel !== settings.inspectionModel ||
    effort !== settings.reasoningEffort ||
    routingChanged ||
    prefixChanged
  const invalidReason = !cleanModel
    ? '检测模型不能为空'
    : mode === 'prefix'
      ? (analysis.errors[0] ?? null)
      : priorityError
  const canSave = !disabled && !saving && dirty && !invalidReason

  const handleSave = async (modelOverride?: string) => {
    const targetModel = (modelOverride ?? model).trim()
    const isDirty =
      targetModel !== settings.inspectionModel ||
      effort !== settings.reasoningEffort ||
      routingChanged ||
      prefixChanged
    const hasError = !targetModel
      ? '检测模型不能为空'
      : mode === 'prefix'
        ? (analysis.errors[0] ?? null)
        : priorityError
    if (disabled || saving || !isDirty || hasError) return
    const nextRouting = {
      ...settings.routing,
      mode,
      groups:
        mode === 'priority' &&
        parsedNormalPriority !== null &&
        parsedUngroupedPriority !== null &&
        parsedDownshiftPriority !== null
          ? {
              normal: { ...settings.routing.groups.normal, priority: parsedNormalPriority },
              ungrouped: { ...settings.routing.groups.ungrouped, priority: parsedUngroupedPriority },
              downshift: { ...settings.routing.groups.downshift, priority: parsedDownshiftPriority },
            }
          : settings.routing.groups,
    }
    const saved = await saveInspectionOptions({
      inspectionModel: targetModel,
      reasoningEffort: effort,
      ...(routingChanged ? { routing: nextRouting } : {}),
      ...(prefixChanged ? { prefixes: nextPrefixes } : {}),
    })
    if (saved) {
      setOpen(false)
      useStore.getState().notify({
        tone: 'success',
        title: '巡检配置已更新',
        detail: `${targetModel} · 思考${EFFORT_SHORT[effort]} · ${MODE_LABEL[mode]}`,
      })
    } else if (useStore.getState().pendingSettingsConfirmation) {
      setOpen(false)
    }
  }

  return (
    <>
      <HoverCard
        compact
        placement="top"
        disabled={open}
        content="点击快捷配置检测模型、思考等级与分组策略"
      >
        <button
          ref={triggerRef}
          type="button"
          className={`model-mode-badge ${open ? 'is-open' : ''}`}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          aria-label={`当前检测模型 ${settings.inspectionModel}，思考等级 ${EFFORT_SHORT[settings.reasoningEffort]}，分组策略 ${MODE_LABEL[settings.routing.mode]}，点击配置`}
          onClick={() => (open ? closePopover() : openPopover())}
        >
          <span className="mono">{settings.inspectionModel}</span>
          <span className="model-mode-sep" aria-hidden="true">·</span>
          <span className="model-effort-tag">{EFFORT_SHORT[settings.reasoningEffort]}</span>
          <Icon.Chevron dir="down" />
        </button>
      </HoverCard>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label="巡检快捷配置"
            className={`quick-config-popover is-${coords.placement}`}
            style={{ top: coords.top, left: coords.left }}
            onKeyDown={(event) => {
              if (isPrimaryShortcut(event.nativeEvent, 'Enter')) {
                event.preventDefault()
                void handleSave()
              }
            }}
          >
            <div className="quick-config-head">
              <strong>巡检快捷配置</strong>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setOpen(false)
                  setTab('settings')
                }}
              >
                完整设置
              </button>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                aria-label="关闭快捷设置"
                onClick={closePopover}
              >
                <Icon.Close />
              </button>
            </div>

            <div className="quick-config-section">
              <div className="quick-section-head">
                <span>检测模型</span>
                <small>{modelChoices.length} 个聊天模型 · 双击直存</small>
              </div>
              {modelChoices.length > 0 ? (
                <div className="quick-model-grid" role="group" aria-label="选择检测模型">
                  {modelChoices.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      className="quick-model-card"
                      title={`${item.name}（双击直接保存）`}
                      aria-pressed={cleanModel === item.name}
                      onClick={() => setModel(item.name)}
                      onDoubleClick={() => {
                        setModel(item.name)
                        if (item.name === settings.inspectionModel && !dirty) {
                          setOpen(false)
                        } else {
                          void handleSave(item.name)
                        }
                      }}
                    >
                      <span className="quick-model-name mono">{item.name}</span>
                      <span className="quick-model-meta">
                        {item.count > 0 ? `${item.count} 凭证` : '自定义'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="quick-mode-note">当前凭证暂无可选聊天模型，请在下方直接输入模型名。</p>
              )}
              <input
                type="text"
                className="input mono quick-model-input"
                value={model}
                spellCheck={false}
                autoComplete="off"
                placeholder="也可直接输入模型名，例如 gpt-6.1-sol"
                aria-label="自定义检测模型名称"
                onChange={(event) => setModel(event.target.value)}
                onKeyDown={(event) => {
                  if (isPlainShortcut(event.nativeEvent, 'Enter')) {
                    event.preventDefault()
                    void handleSave()
                  }
                }}
              />
            </div>

            <div className="quick-effort-row">
              <span className="quick-section-label">思考等级</span>
              <Segmented
                ariaLabel="思考等级"
                className="quick-effort-group"
                value={effort}
                onChange={setEffort}
                options={EFFORTS}
              />
            </div>

            <div className="quick-config-section">
              <div className="quick-section-head">
                <span>分组策略</span>
                <small>
                  {mode === 'none'
                    ? '默认 · 不改前缀与优先级'
                    : mode === 'prefix'
                      ? '自动写入模型前缀'
                      : '按组应用优先级'}
                </small>
              </div>
              <Segmented
                ariaLabel="分组方式"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'none', label: '仅检测' },
                  { value: 'prefix', label: '模型前缀' },
                  { value: 'priority', label: '仅优先级' },
                ]}
              />
              {mode === 'none' && (
                <p className="quick-mode-note">仅记录检测结果与依据，不修改凭证的模型前缀、分组或优先级。</p>
              )}
              {mode === 'prefix' && (
                <div className="quick-prefix-grid">
                  <label className="quick-prefix-field">
                    <span>
                      <i className="dot dot-normal" aria-hidden="true" />
                      正常组
                    </span>
                    <input
                      type="text"
                      className={`input mono ${analysis.normal.errors.length ? 'input-err' : ''}`}
                      value={normalPrefix}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="留空 = 无前缀"
                      aria-label="正常组前缀"
                      onChange={(event) => setNormalPrefix(event.target.value)}
                    />
                  </label>
                  <label className="quick-prefix-field">
                    <span>
                      <i className="dot dot-downshift" aria-hidden="true" />
                      风控组
                    </span>
                    <input
                      type="text"
                      className={`input mono ${analysis.downshift.errors.length ? 'input-err' : ''}`}
                      value={downshiftPrefix}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={DEFAULT_PREFIXES.downshift}
                      aria-label="风控组前缀"
                      onChange={(event) => setDownshiftPrefix(event.target.value)}
                    />
                  </label>
                </div>
              )}
              {mode === 'priority' && (
                <div className="quick-priority-grid">
                  <label className="quick-prefix-field">
                    <span>
                      <i className="dot dot-normal" aria-hidden="true" />
                      正常组
                    </span>
                    <input
                      type="text"
                      inputMode="text"
                      className={`input mono ${parsedNormalPriority === null ? 'input-err' : ''}`}
                      value={normalPriority}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label="正常组优先级"
                      onChange={(event) => {
                        if (/^-?\d{0,4}$/.test(event.target.value)) setNormalPriority(event.target.value)
                      }}
                    />
                  </label>
                  <label className="quick-prefix-field">
                    <span>
                      <i className="dot dot-empty" aria-hidden="true" />
                      未分组
                    </span>
                    <input
                      type="text"
                      inputMode="text"
                      className={`input mono ${parsedUngroupedPriority === null ? 'input-err' : ''}`}
                      value={ungroupedPriority}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label="未分组优先级"
                      onChange={(event) => {
                        if (/^-?\d{0,4}$/.test(event.target.value)) setUngroupedPriority(event.target.value)
                      }}
                    />
                  </label>
                  <label className="quick-prefix-field">
                    <span>
                      <i className="dot dot-downshift" aria-hidden="true" />
                      风控组
                    </span>
                    <input
                      type="text"
                      inputMode="text"
                      className={`input mono ${parsedDownshiftPriority === null ? 'input-err' : ''}`}
                      value={downshiftPriority}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label="风控组优先级"
                      onChange={(event) => {
                        if (/^-?\d{0,4}$/.test(event.target.value)) setDownshiftPriority(event.target.value)
                      }}
                    />
                  </label>
                </div>
              )}
              {invalidReason ? (
                <p className="quick-config-error" role="alert">{invalidReason}</p>
              ) : mode === 'prefix' && analysis.warnings.length > 0 ? (
                <p className="quick-config-warn">{analysis.warnings[0]}</p>
              ) : null}
            </div>

            <div className="quick-config-foot">
              <button type="button" className="btn btn-sm" onClick={closePopover}>
                取消
              </button>
              <span className="spacer" />
              <button type="button" className="btn btn-sm btn-primary" disabled={!canSave} onClick={() => void handleSave()}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
