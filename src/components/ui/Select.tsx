import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

export interface SelectProps<T extends string = string> {
  id?: string
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
  disabled?: boolean
  size?: 'md' | 'sm'
  mono?: boolean
  className?: string
  placeholder?: string
}

interface MenuCoords {
  top?: number
  bottom?: number
  left: number
  minWidth: number
  maxHeight: number
  placement: 'bottom' | 'top'
}

export function Select<T extends string = string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  size = 'md',
  mono = false,
  className,
  placeholder = '请选择',
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [coords, setCoords] = useState<MenuCoords | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const selectedIndex = options.findIndex((opt) => opt.value === value)
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const findEnabledIndex = (start: number, step: 1 | -1) => {
    if (options.length === 0) return -1
    let idx = start
    for (let i = 0; i < options.length; i += 1) {
      const normalized = ((idx % options.length) + options.length) % options.length
      if (!options[normalized].disabled) return normalized
      idx += step
    }
    return -1
  }

  const computeCoords = (menuWidth?: number): MenuCoords | null => {
    const trigger = triggerRef.current
    if (!trigger) return null
    const rect = trigger.getBoundingClientRect()
    const gap = 5
    const pad = 8
    const desiredMax = 252
    const estHeight = Math.min(desiredMax, options.length * 32 + 10)
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - pad)
    const spaceAbove = Math.max(0, rect.top - gap - pad)
    const placeTop = spaceBelow < estHeight && spaceAbove > spaceBelow
    const minWidth = Math.max(rect.width, size === 'sm' ? 90 : 136)
    const effectiveWidth = Math.max(minWidth, menuWidth ?? 0)
    const left = Math.max(pad, Math.min(rect.left, window.innerWidth - effectiveWidth - pad))
    return placeTop
      ? {
          bottom: window.innerHeight - rect.top + gap,
          left,
          minWidth,
          maxHeight: Math.max(120, Math.min(desiredMax, spaceAbove)),
          placement: 'top',
        }
      : {
          top: rect.bottom + gap,
          left,
          minWidth,
          maxHeight: Math.max(120, Math.min(desiredMax, spaceBelow)),
          placement: 'bottom',
        }
  }

  const openMenu = () => {
    if (disabled || options.length === 0) return
    const nextIdx = selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : findEnabledIndex(0, 1)
    setActiveIndex(nextIdx >= 0 ? nextIdx : 0)
    setCoords(computeCoords())
    setOpen(true)
  }

  const closeMenu = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const commitOption = (option: SelectOption<T>) => {
    if (option.disabled) return
    if (option.value !== value) onChange(option.value)
    closeMenu(true)
  }

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    const width = menuRef.current.getBoundingClientRect().width
    const updated = computeCoords(width)
    if (updated) setCoords(updated)
    const targetOption = menuRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    targetOption?.scrollIntoView({ block: 'nearest' })
    // Intentionally re-run horizontal clamping on open & option length change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options.length])

  useEffect(() => {
    if (!open || !menuRef.current) return
    const targetOption = menuRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    targetOption?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeMenu(true)
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

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openMenu()
      else {
        const next = findEnabledIndex(activeIndex + 1, 1)
        if (next >= 0) setActiveIndex(next)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else {
        const prev = findEnabledIndex(activeIndex - 1, -1)
        if (prev >= 0) setActiveIndex(prev)
      }
    } else if (event.key === 'Home' && open) {
      event.preventDefault()
      const first = findEnabledIndex(0, 1)
      if (first >= 0) setActiveIndex(first)
    } else if (event.key === 'End' && open) {
      event.preventDefault()
      const last = findEnabledIndex(options.length - 1, -1)
      if (last >= 0) setActiveIndex(last)
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault()
      const current = options[activeIndex]
      if (current) commitOption(current)
    }
  }

  return (
    <div className={`cselect ${className ?? ''}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && options[activeIndex] ? `${listboxId}-opt-${activeIndex}` : undefined}
        disabled={disabled}
        className={`cselect-trigger ${size === 'sm' ? 'is-sm' : ''} ${mono ? 'mono' : ''} ${open ? 'is-open' : ''}`}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="cselect-label">{selectedOption?.label ?? placeholder}</span>
        <span className="cselect-chevron" aria-hidden="true">
          <Icon.Chevron />
        </span>
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className={`cselect-menu is-${coords.placement} ${size === 'sm' ? 'is-sm' : ''} ${mono ? 'mono' : ''}`}
            style={{
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              minWidth: coords.minWidth,
              maxHeight: coords.maxHeight,
            }}
          >
            {options.map((option, index) => {
              const selected = option.value === value
              const active = index === activeIndex
              return (
                <button
                  key={option.value}
                  id={`${listboxId}-opt-${index}`}
                  type="button"
                  role="option"
                  data-index={index}
                  aria-selected={selected}
                  disabled={option.disabled}
                  tabIndex={-1}
                  className={`cselect-option ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''}`}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index)
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commitOption(option)}
                >
                  <span className="cselect-option-label">{option.label}</span>
                  <span className="cselect-check" aria-hidden="true">
                    {selected ? <Icon.Check /> : null}
                  </span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
