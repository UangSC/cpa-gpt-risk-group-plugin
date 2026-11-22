import type { Settings } from '../types'
import { DEFAULT_ROUTING } from '../lib/routing'
import { DEFAULT_WINDOWS } from '../lib/schedule'

export const PAGINATION_FIELDS = [
  { key: 'list', label: '列表', max: 100 },
  { key: 'card', label: '卡片', max: 100 },
  { key: 'pool', label: '双栏每栏', max: 24 },
  { key: 'statistics', label: '账号统计', max: 4 },
] as const

export const DEFAULT_SETTINGS: Settings = {
  prefixes: { normal: '', downshift: 'downshift' },
  routing: DEFAULT_ROUTING,
  inspectionMethod: 'candy',
  retry: { maxRetries: 2, baseDelayMs: 5000, backoffFactor: 2 },
  failureRule: { windowRounds: 2, requestThreshold: 3 },
  quota: { minRemainingPercent: 15, unknownPolicy: 'check' },
  concurrency: { maxObjects: 4 },
  inspectionModel: 'gpt-6.1-sol',
  reasoningEffort: 'low',
  headerOverrides: {},
  layout: 'pool', maskNames: false, theme: 'light',
  pagination: { list: 10, card: 12, pool: 4, statistics: 4 },
  schedule: {
    enabled: false,
    mode: 'interval',
    intervalMinutes: 60,
    dailyTime: '09:00',
    windows: DEFAULT_WINDOWS,
    busySessionPolicy: 'under-limit',
    maxBusySessions: 3,
    minRemainingPercent: 15,
    nextRunAt: null,
  },
}
