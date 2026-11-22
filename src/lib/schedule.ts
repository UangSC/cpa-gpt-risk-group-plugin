import type { ScheduleSettings, Settings } from '../types'

export const DEFAULT_WINDOWS = [{ id: 'daytime', startMinute: 540, endMinute: 1080 }]

export function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function scheduleErrors(schedule: ScheduleSettings): string[] {
  const policy = schedule.busySessionPolicy ?? 'under-limit'
  if (!['always', 'under-limit', 'skip-busy'].includes(policy)) return ['定时巡检会话策略无效']
  if (policy === 'under-limit') {
    const limit = schedule.maxBusySessions ?? 3
    if (!Number.isInteger(limit) || limit < 1 || limit > 99) return ['并发会话上限应为 1～99 的整数']
  }
  if (schedule.minRemainingPercent !== undefined && (!Number.isFinite(schedule.minRemainingPercent) || schedule.minRemainingPercent < 0 || schedule.minRemainingPercent > 100)) {
    return ['定时巡检额度门槛应为 0～100 的数值']
  }
  if (!schedule.enabled) return []
  if (schedule.mode !== 'daily' && (!Number.isFinite(schedule.intervalMinutes) || schedule.intervalMinutes < 5)) return ['巡检间隔不能小于 5 分钟']
  if (schedule.mode === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.dailyTime)) return ['请填写有效的每日时间']
  if (schedule.mode !== 'windows') return []
  const windows = [...(schedule.windows ?? [])].sort((a, b) => a.startMinute - b.startMinute)
  if (!windows.length) return ['自定义巡检至少需要一个时间段']
  if (windows.some((window) => !Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute) || window.startMinute < 0 || window.endMinute > 1440 || window.endMinute - window.startMinute < 15)) return ['每个时间段至少 15 分钟，范围为 00:00～24:00']
  if (windows.some((window, index) => index > 0 && window.startMinute < windows[index - 1].endMinute)) return ['时间段不能重叠，请拖动调整后保存']
  return []
}

export function computeNextRun(settings: Settings, from = Date.now()): string | null {
  const schedule = settings.schedule
  if (!schedule.enabled || scheduleErrors(schedule).length) return null
  if (schedule.mode === 'interval') return new Date(from + schedule.intervalMinutes * 60_000).toISOString()
  // 与 Go 调度器使用相同的北京时间，浏览器所在时区只影响时间的显示。
  const offsetMs = 8 * 60 * 60_000
  const local = new Date(from + offsetMs)
  if (schedule.mode === 'daily') {
    const [hours, minutes] = schedule.dailyTime.split(':').map(Number)
    const next = new Date(local)
    next.setUTCHours(hours, minutes, 0, 0)
    if (next.getTime() - offsetMs <= from) next.setUTCDate(next.getUTCDate() + 1)
    return new Date(next.getTime() - offsetMs).toISOString()
  }
  const candidates: number[] = []
  for (let offset = 0; offset < 3; offset++) {
    for (const window of schedule.windows) {
      const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset, 0, window.startMinute) - offsetMs)
      const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset, 0, window.endMinute) - offsetMs)
      const interval = schedule.intervalMinutes * 60_000
      const at = start.getTime() > from ? start.getTime() : start.getTime() + (Math.floor((from - start.getTime()) / interval) + 1) * interval
      if (at < end.getTime()) candidates.push(at)
    }
  }
  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : null
}

export function adjustWindow(window: ScheduleSettings['windows'][number], mode: 'move' | 'start' | 'end', delta: number) {
  delta = Math.round(delta / 15) * 15
  if (mode === 'move') {
    const startMinute = Math.max(0, Math.min(1440 - (window.endMinute - window.startMinute), window.startMinute + delta))
    return { ...window, startMinute, endMinute: startMinute + window.endMinute - window.startMinute }
  }
  return mode === 'start'
    ? { ...window, startMinute: Math.max(0, Math.min(window.endMinute - 15, window.startMinute + delta)) }
    : { ...window, endMinute: Math.max(window.startMinute + 15, Math.min(1440, window.endMinute + delta)) }
}
