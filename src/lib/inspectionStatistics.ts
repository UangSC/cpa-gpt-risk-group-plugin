import type { Target } from '../types'

const DAY_MS = 86_400_000
const BEIJING_OFFSET_MS = 8 * 3_600_000

export type StatisticsRange = 7 | 14 | 30

export interface OutcomeCounts {
  normal: number
  downshift: number
  uncertain: number
  incomplete: number
  total: number
}

export interface DailyInspectionStatistics extends OutcomeCounts {
  date: string
}

interface QualityCounts {
  candy: number
  matched: number
  samples: number
  accepted: number
}

export interface InspectionMetrics extends OutcomeCounts, QualityCounts {
  durationCount: number
  p50Ms: number | null
  p95Ms: number | null
  latestAt: string | null
}

export interface AccountInspectionStatistics extends InspectionMetrics {
  days: Map<string, OutcomeCounts>
}

interface MetricsAccumulator extends OutcomeCounts, QualityCounts {
  durations: number[]
  latestTimestamp: number
  latestAt: string | null
}

function dayNumber(timestamp: number) {
  return Math.floor((timestamp + BEIJING_OFFSET_MS) / DAY_MS)
}

function emptyCounts(): OutcomeCounts {
  return { normal: 0, downshift: 0, uncertain: 0, incomplete: 0, total: 0 }
}

function emptyMetrics(): MetricsAccumulator {
  return { ...emptyCounts(), candy: 0, matched: 0, samples: 0, accepted: 0, durations: [], latestTimestamp: -Infinity, latestAt: null }
}

function percentile(sorted: number[], fraction: number): number | null {
  if (!sorted.length) return null
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower)
}

function finishMetrics({ durations, latestTimestamp: _, ...counts }: MetricsAccumulator): InspectionMetrics {
  durations.sort((a, b) => a - b)
  return { ...counts, durationCount: durations.length, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95) }
}

function countOutcome(counts: OutcomeCounts, outcome: Exclude<keyof OutcomeCounts, 'total'>) {
  counts[outcome]++
  counts.total++
}

export function summarizeInspections(targets: readonly Target[], model: string, now: number, range: StatisticsRange = 7) {
  const firstDay = dayNumber(now) - range + 1
  const days: DailyInspectionStatistics[] = Array.from({ length: range }, (_, index) => ({
    date: new Date((firstDay + index) * DAY_MS).toISOString().slice(0, 10),
    ...emptyCounts(),
  }))
  const totals = emptyMetrics()
  const byAccount = new Map<string, { metrics: MetricsAccumulator; days: Map<string, OutcomeCounts> }>()

  for (const target of targets) {
    if (model && target.model !== model) continue
    for (const round of target.rounds) {
      const timestamp = Date.parse(round.finishedAt)
      const day = days[dayNumber(timestamp) - firstDay]
      if (!day || timestamp > now) continue

      let account = byAccount.get(target.credentialId)
      if (!account) {
        account = { metrics: emptyMetrics(), days: new Map() }
        byAccount.set(target.credentialId, account)
      }
      let accountDay = account.days.get(day.date)
      if (!accountDay) {
        accountDay = emptyCounts()
        account.days.set(day.date, accountDay)
      }

      const recordedOutcome = round.outcome
      const outcome = recordedOutcome === 'normal' || recordedOutcome === 'downshift' || recordedOutcome === 'uncertain' ? recordedOutcome : 'incomplete'
      countOutcome(day, outcome)
      countOutcome(accountDay, outcome)
      const evidence = round.evidence
      const candy = evidence?.candy
      const answered = Boolean(candy?.answer?.trim())
      const samples = evidence?.fingerprint?.samples ?? []
      const accepted = samples.reduce((count, sample) => count + Number(sample.accepted === true), 0)
      const duration = evidence?.durationMs
      for (const metrics of [totals, account.metrics]) {
        countOutcome(metrics, outcome)
        if (answered) {
          metrics.candy++
          if (candy?.matched) metrics.matched++
        }
        metrics.samples += samples.length
        metrics.accepted += accepted
        if (Number.isFinite(duration) && duration >= 0) metrics.durations.push(duration)
        if (timestamp > metrics.latestTimestamp) {
          metrics.latestTimestamp = timestamp
          metrics.latestAt = round.finishedAt
        }
      }
    }
  }

  const accounts = new Map<string, AccountInspectionStatistics>()
  for (const [id, account] of byAccount) accounts.set(id, { ...finishMetrics(account.metrics), days: account.days })
  return { days, accounts, totals: finishMetrics(totals) }
}
