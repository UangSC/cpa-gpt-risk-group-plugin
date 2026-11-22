import { useRef, useState, type PointerEvent } from 'react'
import type { ScheduleSettings } from '../types'
import { adjustWindow, minuteLabel } from '../lib/schedule'
import { Select } from './ui'

type WindowRange = ScheduleSettings['windows'][number]

function TimeWindow({ value, index, onChange, onRemove }: { value: WindowRange; index: number; onChange: (value: WindowRange) => void; onRemove: () => void }) {
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'move' | 'start' | 'end'; x: number; width: number; original: WindowRange } | null>(null)
  const [dragging, setDragging] = useState(false)
  const startDrag = (event: PointerEvent, mode: 'move' | 'start' | 'end') => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { mode, x: event.clientX, width: track.current!.getBoundingClientRect().width, original: value }
    setDragging(true)
  }
  const stopDrag = () => { drag.current = null; setDragging(false) }
  const choices = [...new Set([...Array.from({ length: 97 }, (_, minute) => minute * 15), value.startMinute, value.endMinute])].sort((a, b) => a - b)
  return <div className={`time-window-row ${dragging ? 'is-dragging' : ''}`}>
    <div className="time-window-head">
      <strong>时间段 {index + 1}</strong>
      <Select
        size="sm"
        mono
        ariaLabel={`时间段 ${index + 1} 开始时间`}
        value={String(value.startMinute)}
        onChange={(next) => onChange({ ...value, startMinute: Number(next) })}
        options={choices.filter((minute) => minute <= value.endMinute - 15).map((minute) => ({
          value: String(minute),
          label: minuteLabel(minute),
        }))}
      />
      <span>至</span>
      <Select
        size="sm"
        mono
        ariaLabel={`时间段 ${index + 1} 结束时间`}
        value={String(value.endMinute)}
        onChange={(next) => onChange({ ...value, endMinute: Number(next) })}
        options={choices.filter((minute) => minute >= value.startMinute + 15).map((minute) => ({
          value: String(minute),
          label: minuteLabel(minute),
        }))}
      />
      <button type="button" className="btn-link" aria-label={`删除时间段 ${index + 1}`} onClick={onRemove}>移除</button>
    </div>
    <div className="time-window-track" ref={track}
      onPointerMove={(event) => { const current = drag.current; if (current) onChange(adjustWindow(current.original, current.mode, (event.clientX - current.x) / current.width * 1440)) }}
      onPointerUp={stopDrag} onPointerCancel={stopDrag}>
      <div className="time-window-slice" style={{ left: `${value.startMinute / 14.4}%`, width: `${(value.endMinute - value.startMinute) / 14.4}%` }} onPointerDown={(event) => startDrag(event, 'move')}>
        <span className="time-window-label">{minuteLabel(value.startMinute)}–{minuteLabel(value.endMinute)}</span>
        {(['start', 'end'] as const).map((side) => <button key={side} type="button" role="slider" className={`time-window-handle is-${side}`} tabIndex={0}
          aria-label={`时间段 ${index + 1} ${side === 'start' ? '起点' : '终点'}`} aria-valuemin={side === 'start' ? 0 : value.startMinute + 15}
          aria-valuemax={side === 'start' ? value.endMinute - 15 : 1440} aria-valuenow={side === 'start' ? value.startMinute : value.endMinute}
          aria-valuetext={minuteLabel(side === 'start' ? value.startMinute : value.endMinute)} onPointerDown={(event) => startDrag(event, side)}
          onKeyDown={(event) => { if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) { event.preventDefault(); onChange(adjustWindow(value, side, ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -15 : 15)) } }} />)}
      </div>
    </div>
  </div>
}

export function TimeRangeEditor({ windows, onChange }: { windows: WindowRange[]; onChange: (windows: WindowRange[]) => void }) {
  const add = () => {
    const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute)
    const edges = [0, ...sorted.flatMap((window) => [window.startMinute, window.endMinute]), 1440]
    const gaps = []
    for (let index = 0; index < edges.length - 1; index += 2) if (edges[index + 1] - edges[index] >= 60) gaps.push(edges[index])
    const startMinute = gaps.find((minute) => minute >= (sorted.at(-1)?.endMinute ?? 540)) ?? gaps[0]
    if (startMinute == null) return
    onChange([...windows, { id: `window-${Date.now().toString(36)}`, startMinute, endMinute: startMinute + 60 }])
  }
  return <div className="time-range-editor">
    <div className="time-window-axis">{[0, 6, 12, 18, 24].map((hour) => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div>
    {windows.map((window, index) => <TimeWindow key={window.id} index={index} value={window}
      onChange={(value) => onChange(windows.map((item) => item.id === value.id ? value : item))} onRemove={() => onChange(windows.filter((item) => item.id !== window.id))} />)}
    <button type="button" className="btn btn-sm" disabled={windows.length >= 8} onClick={add}>添加时间段</button>
    <p className="field-hint">拖动时间片可整体移动，拖动两端可调整起止时间，每格 15 分钟。时间段内按设定间隔巡检，结束时间不包含在内。</p>
  </div>
}
