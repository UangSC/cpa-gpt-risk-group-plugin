/**
 * Group-prefix arithmetic.
 *
 * Rules that matter to the operator:
 *  - the original model name is never destroyed: a group prefix is *prepended* to the
 *    canonical name, and any previously applied group prefix is stripped first, so
 *    repeated saves can never stack into `normal/normal/gpt-6.1-sol`;
 *  - stored prefixes omit trailing slashes; model-name composition inserts the separator;
 *  - empty, identical, hierarchical or illegal values are reported before saving.
 */

import type { PrefixSettings } from '../types'

export const DEFAULT_PREFIXES: PrefixSettings = { normal: '', downshift: 'downshift' }

/** Known group segments, used to peel off a prefix that was applied earlier. */
const KNOWN_SEGMENTS = ['normal', 'downshift']

export interface PrefixFieldState {
  raw: string
  /** Normalised form, e.g. `normal`. Empty string when the input is unusable. */
  normalized: string
  /** The original trimmed value differed from the normalised one. */
  adjusted: boolean
  errors: string[]
  warnings: string[]
}

export interface PrefixAnalysis {
  normal: PrefixFieldState
  downshift: PrefixFieldState
  /** Blocks saving. */
  errors: string[]
  /** Shown but does not block saving. */
  warnings: string[]
  valid: boolean
}

const ILLEGAL = /[^\w\-./\u4e00-\u9fa5]/

function normaliseOne(raw: string, allowEmpty = false): PrefixFieldState {
  const trimmed = raw.trim()
  const errors: string[] = []
  const warnings: string[] = []

  if (!trimmed) {
    // An empty normal prefix is intentional: keep the original model name.
    return allowEmpty
      ? { raw, normalized: '', adjusted: false, errors, warnings }
      : { raw, normalized: '', adjusted: false, errors: ['前缀不能为空'], warnings }
  }
  if (ILLEGAL.test(trimmed)) {
    errors.push('只能包含字母、数字、下划线、连字符、点和斜杠')
  }
  if (trimmed.startsWith('/')) {
    errors.push('不能以斜杠开头')
  }
  if (/\s/.test(trimmed)) {
    errors.push('不能包含空格')
  }

  // Store the name without a trailing separator; composition owns the slash.
  const segments = trimmed
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)

  // `normal/normal/` is almost always an accidental stack; keep the innermost segment.
  let effective = segments
  if (segments.length > 1 && segments.every((s) => KNOWN_SEGMENTS.includes(s.toLowerCase()))) {
    effective = [segments[segments.length - 1]]
    warnings.push('检测到重复叠加的分组前缀，已合并为单层')
  }
  const collapsed = effective.join('/')
  const normalized = collapsed
  if (!normalized && !allowEmpty) errors.push('前缀不能为空')

  if (effective.length > 1) {
    warnings.push('包含多层路径，模型名会变成多级前缀')
  }
  if (trimmed.endsWith('/')) warnings.push('保存时会移除结尾的「/」，拼接模型名时自动添加')

  return { raw, normalized, adjusted: trimmed !== normalized, errors, warnings }
}

export function analyzePrefixes(prefixes: PrefixSettings): PrefixAnalysis {
  const normal = normaliseOne(prefixes.normal, true)
  const downshift = normaliseOne(prefixes.downshift)
  const errors = [...normal.errors, ...downshift.errors]
  const warnings = [...normal.warnings, ...downshift.warnings]

  if (
    normal.normalized &&
    downshift.normalized &&
    normal.normalized.toLowerCase() === downshift.normalized.toLowerCase()
  ) {
    errors.push('正常与风控前缀不能相同，否则分组无法区分')
  }

  if (
    normal.normalized &&
    downshift.normalized &&
    normal.normalized !== downshift.normalized
  ) {
    const a = normal.normalized.toLowerCase()
    const b = downshift.normalized.toLowerCase()
    if (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
      warnings.push('两个前缀存在包含关系，剥离旧前缀时可能产生歧义')
    }
  }

  return {
    normal,
    downshift,
    errors: dedupe(errors),
    warnings: dedupe(warnings),
    valid: errors.length === 0,
  }
}

/**
 * Removes one leading group segment so a prefixed name maps back to its canonical
 * model. Handles configured prefixes as well as the historical default segments.
 */
export function stripGroupPrefix(model: string, prefixes: PrefixSettings = DEFAULT_PREFIXES): string {
  let current = model.trim()
  const candidates = [...new Set([prefixes.normal, prefixes.downshift]
    .map((p) => p.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .map((p) => `${p}/`))]
  // Longest first so `team/normal/` is stripped before `normal/`.
  candidates.sort((a, b) => b.length - a.length)

  let changed = true
  while (changed) {
    changed = false
    for (const prefix of candidates) {
      if (prefix && current.toLowerCase().startsWith(prefix.toLowerCase())) {
        current = current.slice(prefix.length)
        changed = true
        break
      }
      // Also peel a bare known segment such as a hand-written `downshift/`.
      for (const segment of KNOWN_SEGMENTS) {
        const bare = `${segment}/`
        if (current.toLowerCase().startsWith(bare)) {
          current = current.slice(bare.length)
          changed = true
          break
        }
      }
      if (changed) break
    }
  }
  return current
}

/** Builds the model name that a group prefix implies. */
export function buildModelName(prefix: string, model: string): string {
  const clean = prefix.trim().replace(/\/+$/g, '')
  const base = stripGroupPrefix(model, { normal: clean, downshift: DEFAULT_PREFIXES.downshift })
  return clean ? `${clean}/${base}` : base
}

/** True when `model` currently carries one of the given prefixes. */
export function hasGroupPrefix(model: string, prefixes: PrefixSettings): boolean {
  return stripGroupPrefix(model, prefixes) !== model.trim()
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)]
}
