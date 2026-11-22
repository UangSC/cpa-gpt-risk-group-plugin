import type { Settings } from '../types'
import { currentManagementKey } from '../api/auth'

const STORAGE_KEY = 'cpa-gpt-risk-group:manual-consent:v1'
const LEGACY_STORAGE_KEY = 'cpa-downshift:manual-consent:v1'

/** 权重不由插件写入，检测参数不改变这里授权的前缀/优先级写入政策。 */
export function manualWritePolicy(settings: Settings): string {
  const priorities = (values: Settings['routing']['groups'] | Settings['routing']['overrides']) =>
    Object.fromEntries(Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, value]) => [id, value.priority]))
  return JSON.stringify({ mode: settings.routing.mode, normalPrefix: settings.prefixes.normal,
    downshiftPrefix: settings.prefixes.downshift, groups: priorities(settings.routing.groups), overrides: priorities(settings.routing.overrides),
    headerOverrides: Object.fromEntries(Object.entries(settings.headerOverrides ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) })
}

async function binding(settings: Settings, key: string | null): Promise<string | null> {
  if (!key || typeof window === 'undefined' || !globalThis.crypto?.subtle) return null
  try {
    const origin = window.location?.origin ?? window.location?.host
    if (!origin) return null
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ origin, key, policy: manualWritePolicy(settings) })))
    return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

export async function canSkipManualReminder(settings: Settings, key = currentManagementKey()): Promise<boolean> {
  const value = await binding(settings, key)
  if (!value) return false
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY)
    const saved = JSON.parse(raw ?? 'null')
    return saved?.version === 1 && saved.binding === value
  } catch { return false }
}

/** 只在后台接受本次已确认请求后保存，不保存密钥或完整配置。 */
export async function rememberManualReminder(settings: Settings, requestKey: string | null): Promise<boolean> {
  if (!requestKey || currentManagementKey() !== requestKey) return false
  const value = await binding(settings, requestKey)
  if (!value || currentManagementKey() !== requestKey) return false
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, binding: value })); return true } catch { return false }
}

export function restoreManualReminder(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch { /* 存储不可用时仍按正常弹窗处理。 */ }
}
