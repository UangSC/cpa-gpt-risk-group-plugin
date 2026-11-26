import type { Settings } from '../types'
import { analyzePrefixes } from './prefix'
import { normalizeRouting } from './routing'
import { scheduleErrors } from './schedule'
import { listInspectionMethods } from '../inspection'
import { PAGINATION_FIELDS } from '../data/defaults'

const GROUPS = [
  'prefixes', 'routing', 'inspectionMethod', 'inspectFreeAccounts', 'fingerprintThresholdPercent', 'retry', 'failureRule',
  'quota', 'concurrency', 'inspectionModel', 'reasoningEffort', 'headerOverrides', 'schedule', 'pagination',
] as const
const compareValue = (settings: Settings, group: typeof GROUPS[number]) => group === 'schedule'
  ? { ...settings.schedule, nextRunAt: null } : settings[group]

export interface HeaderOverrideRow { id: string; name: string; value: string }
const DRAFT_HEADER_PREFIX = '\u0000header-row:'
export const DRAFT_JSON_ERROR_KEY = '\u0000header-json-invalid'
const PROTECTED_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'host', 'content-length',
  'connection', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'expect',
  'content-type', 'accept', 'accept-encoding', 'content-encoding', 'origin', 'referer',
  'chatgpt-account-id', 'x-codex-routing-hint', 'x-api-key', 'api-key', 'x-goog-api-key',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded',
  'session-id', 'session_id', 'thread-id', 'thread_id', 'x-client-request-id', 'x-request-id', 'x-codex-window-id',
])
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** 临时键只保留尚未合法的编辑行，完整设置校验阻止其进入正式请求。 */
export function serializeHeaderOverrideRows(rows: HeaderOverrideRow[]): Record<string, string> {
  const names = new Set<string>()
  return Object.fromEntries(rows.map((row) => {
    const key = names.has(row.name) ? `${DRAFT_HEADER_PREFIX}${row.id}:${row.name}` : row.name
    names.add(row.name)
    return [key, row.value]
  }))
}

export function deserializeHeaderOverrideRows(headers?: Record<string, string>): HeaderOverrideRow[] {
  return Object.entries(headers ?? {})
    .filter(([key]) => key !== DRAFT_JSON_ERROR_KEY)
    .map(([key, value], index) => {
      const temporary = key.startsWith(DRAFT_HEADER_PREFIX) ? key.slice(DRAFT_HEADER_PREFIX.length) : null
      return { id: `header-${index}`, name: temporary === null ? key : temporary.slice(temporary.indexOf(':') + 1), value }
    })
}

export function headerOverrideErrors(headers?: Record<string, string>, additionalManaged: string[] = []): string[] {
  if (!headers) return []
  if (Object.prototype.hasOwnProperty.call(headers, DRAFT_JSON_ERROR_KEY)) {
    return [`JSON 格式错误：${headers[DRAFT_JSON_ERROR_KEY]}`]
  }
  const rows = deserializeHeaderOverrideRows(headers)
  const errors: string[] = []
  const seen = new Set<string>()
  const managed = new Set([...PROTECTED_HEADERS, ...additionalManaged.map((name) => name.toLowerCase())])
  if (rows.length > 32) errors.push('请求头覆盖最多 32 项')
  rows.forEach((row, index) => {
    const name = row.name.toLowerCase()
    const normalized = name.replace(/_/g, '-')
    const label = `第 ${index + 1} 项请求头`
    if (!row.name.trim()) errors.push(`${label}名称不能为空`)
    else if (!HEADER_NAME.test(row.name)) errors.push(`${label}名称只能使用有效的 ASCII HTTP 字符`)
    else if (
      managed.has(name)
      || normalized.startsWith('x-cpa-risk-group-')
      || normalized.startsWith('x-cpa-downshift-')
      || normalized.startsWith('sec-')
      || normalized.startsWith('x-forwarded-')
    ) errors.push(`${row.name} 由 CPA 管理，不能覆盖`)
    if (seen.has(name)) errors.push(`${label}名称重复，请求头名称不区分大小写`)
    seen.add(name)
    if (typeof row.value !== 'string' || !row.value.trim()) errors.push(`${label}值不能为空；删除该行可恢复默认`)
    else if (row.value.length > 4096) errors.push(`${label}值不能超过 4096 字符`)
    else if (!/^[\x20-\x7E\t]*$/.test(row.value)) errors.push(`${label}值只能使用 ASCII 字符，不能包含换行或控制字符`)
  })
  return [...new Set(errors)]
}

export function changedSettings(actual: Settings, draft: Settings | null): (typeof GROUPS[number])[] {
  return draft ? GROUPS.filter((group) => JSON.stringify(compareValue(actual, group)) !== JSON.stringify(compareValue(draft, group))) : []
}

export function settingsErrors(settings: Settings, managedHeaders: string[] = []): string[] {
  const errors = settings.routing.mode === 'prefix' ? analyzePrefixes(settings.prefixes).errors : []
  if (!settings.inspectionModel.trim()) errors.push('检测模型不能为空')
  if (!['low', 'medium', 'high'].includes(settings.reasoningEffort)) errors.push('思考程度只能选择低、中或高')
  if (!listInspectionMethods().some((method) => method.id === settings.inspectionMethod)) errors.push('检测方式不可用')
  const threshold = settings.fingerprintThresholdPercent
  if (threshold < 0 || threshold > 100 || threshold !== Math.round(threshold * 100) / 100) errors.push('模型指纹判定阈值应为 0～100，可保留两位小数')
  if (!Number.isInteger(settings.concurrency.maxObjects) || settings.concurrency.maxObjects < 1 || settings.concurrency.maxObjects > 9) errors.push('巡检并发数应为 1～9 的整数')
  if (!Number.isInteger(settings.failureRule.requestThreshold) || settings.failureRule.requestThreshold < 2 || settings.failureRule.requestThreshold > 5) errors.push('单轮错误请求阈值应为 2～5 的整数')
  for (const { key, label, max } of PAGINATION_FIELDS) {
    const value = settings.pagination?.[key]
    if (!Number.isInteger(value) || value < 1 || value > max) errors.push(`${label}分页数量应为 1～${max} 的整数`)
  }
  return [...errors, ...headerOverrideErrors(settings.headerOverrides, managedHeaders), ...scheduleErrors(settings.schedule)]
}

export function mergeSettingsDraft(actual: Settings, draft: Settings): Settings {
  const changed = changedSettings(actual, draft)
  const patch = Object.fromEntries(changed.map((group) => [group, structuredClone(draft[group])])) as Partial<Settings>
  const next = { ...actual, ...patch }
  const prefixes = analyzePrefixes(next.prefixes)
  next.prefixes = prefixes.valid ? { normal: prefixes.normal.normalized, downshift: prefixes.downshift.normalized } : actual.prefixes
  next.routing = normalizeRouting(next.routing)
  next.inspectionModel = next.inspectionModel.trim()
  if (changed.includes('schedule')) next.schedule = { ...next.schedule, nextRunAt: null }
  return next
}

/** 保留操作员修改的字段，同时纳入刷新得到的其它服务端更新。 */
export function rebaseSettingsDraft(previous: Settings, draft: Settings, current: Settings): Settings {
  const merge = (before: unknown, edited: unknown, latest: unknown): unknown => {
    if (JSON.stringify(before) === JSON.stringify(edited)) return structuredClone(latest)
    if (before && edited && latest && typeof before === 'object' && typeof edited === 'object' && typeof latest === 'object' && !Array.isArray(before) && !Array.isArray(edited) && !Array.isArray(latest)) {
      const oldObject = before as Record<string, unknown>, draftObject = edited as Record<string, unknown>, newObject = latest as Record<string, unknown>
      return Object.fromEntries([...new Set([...Object.keys(oldObject), ...Object.keys(draftObject), ...Object.keys(newObject)])]
        .map((key) => [key, merge(oldObject[key], draftObject[key], newObject[key])])
        .filter(([, value]) => value !== undefined))
    }
    return structuredClone(edited)
  }
  return merge(previous, draft, current) as Settings
}
