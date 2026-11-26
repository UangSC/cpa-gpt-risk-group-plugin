/**
 * Derived views.
 *
 * Classification is credential-level. One credential exposes several model IDs, but the
 * plugin registers the group prefix for all of them at once, so the operator makes one
 * decision per account. A single, explicit *inspection model* is what the tests probe;
 * its latest conclusion is the credential's conclusion.
 */

import type { Credential, InspectionRound, Settings, Target, Verdict } from '../types'
import { buildModelName, stripGroupPrefix } from './prefix'

export interface CredentialView {
  credential: Credential
  /** The evidence record for the current inspection model; `null` before the first run. */
  target: Target | null
  verdict: Verdict
  /** One-line reason from the latest round, when there is one. */
  reason: string | null
  attention: AttentionItem[]
  lastCheckedAt: string | null
}

export function lastRound(target: Target | null): InspectionRound | null {
  return target?.rounds[0] ?? null
}

/** Newest-first storage → oldest-first display for the horizontal light strip. */
export function lightSequence(target: Target | null, limit = 7): InspectionRound[] {
  if (!target) return []
  return [...target.rounds].slice(0, limit).reverse()
}

export type LightTone = 'normal' | 'uncertain' | 'downshift' | 'empty'

export function roundTone(round: InspectionRound): LightTone {
  if (round.outcome === 'normal') return 'normal'
  if (round.outcome === 'downshift') return 'downshift'
  if (round.outcome === 'uncertain') return 'uncertain'
  return 'empty'
}

/* --------------------------------------------------------------- attention */

export type AttentionKind = 'sync' | 'auth' | 'quota' | 'availability'

export interface AttentionItem {
  kind: AttentionKind
  label: string
  detail: string
}

export function isManuallyExcluded(credential: Pick<Credential, 'inspectionExcluded' | 'disabled'>): boolean {
  return Boolean(credential.inspectionExcluded && !credential.disabled)
}

export function isFreePlan(plan: string | null | undefined): boolean {
  return (plan ?? '').trim().toLowerCase() === 'free'
}

export function isFreeSkipped(
  credential: Pick<Credential, 'plan'>,
  settings: Pick<Settings, 'inspectFreeAccounts'>,
): boolean {
  return isFreePlan(credential.plan) && !settings.inspectFreeAccounts
}

export function attentionOf(credential: Credential): AttentionItem[] {
  if (credential.disabled) return []
  const items: AttentionItem[] = []
  const { sync } = credential
  if (credential.unavailable) items.push({ kind: 'availability', label: '暂不可用', detail: 'CPA 官方状态报告此凭证暂不可用或正在冷却，当前不发起检测。这不代表认证失效或模型风控。' })
  if (
    sync.mode !== 'none' &&
    (sync.status === 'failed' ||
      (sync.desiredGroup != null && sync.appliedGroup !== sync.desiredGroup))
  ) {
    const desired = sync.desiredGroup ?? 'normal'
    items.push({
      kind: 'sync',
      label: '分组待同步',
      detail:
        sync.message ??
        `检测结论要求进入${desired === 'normal' ? '正常' : '风控'}组，但当前生效的仍是${
          sync.appliedGroup ? sync.appliedGroup === 'normal' ? '正常组' : '风控组' : '未分组'
        }。`,
    })
  }
  if (credential.auth === 'expired') {
    items.push({
      kind: 'auth',
      label: '认证失效',
      detail: '凭证需要重新登录。认证问题不属于模型风控，分组保持不变。',
    })
  }
  if (credential.quota.status === 'exhausted') {
    items.push({
      kind: 'quota',
      label: '额度不足',
      detail: '额度用尽或正在排队，检测被拒绝。额度问题不属于模型风控。',
    })
  }
  return items
}

/* ----------------------------------------------------------------- helpers */

/** Lowest known remaining quota across every window; `null` when nothing is reported. */
export function lowestQuota(credential: Credential): number | null {
  const values = credential.quota.windows
    .map((w) => w.remainingPercent)
    .filter((v): v is number => v != null)
  if (values.length === 0) return null
  return Math.min(...values)
}

export function quotaBlockedReason(credential: Credential, settings: Settings): string | null {
  if (credential.disabled) return '凭证已关闭，不参与巡检'
  if (isFreeSkipped(credential, settings)) return 'Free 账号默认不参与巡检，可在设置中强制开启'
  if (credential.auth === 'expired') return '认证失效，需重新登录'
  if (credential.unavailable) return 'CPA 当前报告凭证暂不可用或正在冷却'
  if (credential.quota.status === 'exhausted') return '额度已用尽'
  const lowest = lowestQuota(credential)
  if (lowest == null) {
    return settings.quota.unknownPolicy === 'skip' ? '额度未知，按设置跳过' : null
  }
  if (lowest <= settings.quota.minRemainingPercent) {
    return `剩余 ${lowest}% 不高于阈值 ${settings.quota.minRemainingPercent}%`
  }
  return null
}

/** Registered model id for the inspected model under the credential's group prefix. */
export function routedModelName(credential: Credential, model: string, settings: Settings): string {
  if (typeof credential.prefix === 'string') {
    const prefix = credential.prefix.trim().replace(/\/+$/g, '')
    return prefix ? `${prefix}/${model.trim()}` : model.trim()
  }
  if (!credential.group || settings.routing.mode !== 'prefix') return stripGroupPrefix(model, settings.prefixes)
  const prefix =
    credential.group === 'normal' ? settings.prefixes.normal : settings.prefixes.downshift
  // An empty normal prefix means "keep the original model name".
  return buildModelName(prefix, stripGroupPrefix(model, settings.prefixes))
}

/* ------------------------------------------------------------------- views */

export function buildViews(
  credentials: Credential[],
  targets: Target[],
  settings: Settings,
): CredentialView[] {
  const byCred = new Map<string, Target>()
  for (const target of targets) {
    if (target.model === settings.inspectionModel) {
      byCred.set(target.credentialId, target)
    }
  }
  return credentials.map((credential) => {
    const target = byCred.get(credential.id) ?? null
    const latest = lastRound(target)
    return {
      credential,
      target,
      verdict: target?.verdict ?? 'untested',
      reason: latest?.reason ?? null,
      attention: attentionOf(credential),
      lastCheckedAt: latest?.finishedAt ?? null,
    }
  })
}

export type StatusKey = 'normal' | 'downshift' | 'unknown' | 'error'

export function statusOf(view: CredentialView): StatusKey {
  if (view.attention.some((a) => a.kind === 'sync' || a.kind === 'auth' || a.kind === 'availability')) return 'error'
  if (view.verdict === 'normal') return 'normal'
  if (view.verdict === 'downshift') return 'downshift'
  return 'unknown'
}

export function sortViews(
  views: CredentialView[],
  sort: 'pelican' | 'status' | 'recent' | 'quota' | 'name',
  settings?: Pick<Settings, 'inspectFreeAccounts'>,
): CredentialView[] {
  if (sort === 'pelican') {
    return sortPelicanViews(views, settings)
  }
  if (sort === 'status') {
    const rank = { normal: 0, unknown: 1, downshift: 2, error: 3 }
    return views
      .map((view) => ({ view, key: rank[statusOf(view)] }))
      .sort((a, b) => a.key - b.key || (a.view.credential.id < b.view.credential.id ? -1 : a.view.credential.id > b.view.credential.id ? 1 : 0))
      .map((entry) => entry.view)
  }
  if (sort === 'name') {
    return [...views].sort((a, b) => a.credential.name.localeCompare(b.credential.name))
  }
  if (sort === 'quota') {
    return views
      .map((view) => ({ view, key: lowestQuota(view.credential) ?? -1 }))
      .sort((a, b) => b.key - a.key)
      .map((entry) => entry.view)
  }
  return views
    .map((view) => ({ view, key: view.lastCheckedAt ? Date.parse(view.lastCheckedAt) || 0 : 0 }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.view)
}

export function sortPelicanViews(
  views: CredentialView[],
  settings: Pick<Settings, 'inspectFreeAccounts'> = { inspectFreeAccounts: false },
): CredentialView[] {
  return views
    .map((view) => {
      const rounds = view.target?.rounds ?? []
      const svgRound = rounds.find((round) => Boolean(round.evidence.pelican?.svg))
      const pelicanRound = rounds.find((round) => Boolean(round.evidence.pelican) || round.tests.includes('pelican'))
      let rank = 3
      let ts = 0
      if (svgRound) {
        const judged =
          svgRound.evidence.pelican?.judgedVerdict ??
          (svgRound.outcome === 'normal' || svgRound.outcome === 'downshift' ? svgRound.outcome : null)
        rank = judged ? 1 : 0
        ts = Date.parse(svgRound.finishedAt) || 0
      } else if (pelicanRound) {
        rank = 2
        ts = Date.parse(pelicanRound.finishedAt) || 0
      } else if (
        view.credential.disabled ||
        isFreeSkipped(view.credential, settings) ||
        view.credential.auth === 'expired'
      ) {
        rank = 4
      }
      return { view, rank, ts }
    })
    .sort((a, b) =>
      a.rank - b.rank ||
      b.ts - a.ts ||
      (a.view.credential.id < b.view.credential.id ? -1 : a.view.credential.id > b.view.credential.id ? 1 : 0),
    )
    .map((entry) => entry.view)
}
