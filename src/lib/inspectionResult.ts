import type { CandyEvidence, InspectionRound } from '../types'

export function compactAnswerText(answer: string, maxLen = 56): string {
  const compact = answer.trim().replace(/\s+/g, ' ')
  if (!compact) return '（空回答）'
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact
}

function candyAnswer(evidence: CandyEvidence): string | null {
  if (evidence.matched) return evidence.expected
  const explicit = /(?:"answer"|'answer'|\banswer\b)\s*[:：=]\s*["']?([+-]?\d+(?:\.\d+)?)(?![\w.]|[+-])/i.exec(evidence.answer)?.[1]
  const numbers = explicit ? [explicit] : evidence.answer.match(/(?<![\w.+-])[+-]?\d+(?:\.\d+)?(?![\w+-]|\.\d)/g) ?? []
  const values = [...new Set(numbers.map(Number))]
  return values.length === 1 && Number.isFinite(values[0]) ? String(values[0]) : null
}

type InspectionResult =
  | { kind: 'candy'; answer: string | null; rawAnswer: string; matched: boolean }
  | {
      kind: 'fingerprint'
      model: string
      probability: number
      consistency: 'consistent' | 'anomalous' | 'insufficient'
      referenceMatched: boolean
      enrolledAs: string
    }
  | { kind: 'request-error'; method: 'candy' | 'fingerprint'; status: number | null }

export function inspectionResult(round: InspectionRound): InspectionResult | null {
  const { candy, fingerprint, attempts, errors } = round.evidence
  const required = fingerprint?.challengeCount || 3
  if (fingerprint && fingerprint.validSamples === required && fingerprint.closestModel && fingerprint.probability != null) {
    return {
      kind: 'fingerprint',
      model: fingerprint.closestModel,
      probability: fingerprint.probability,
      consistency: fingerprint.consistency,
      referenceMatched: Boolean(fingerprint.referenceMatched),
      enrolledAs: fingerprint.enrolledAs,
    }
  }
  if (candy) return { kind: 'candy', answer: candyAnswer(candy), rawAnswer: compactAnswerText(candy.answer), matched: candy.matched }
  if (round.outcome === 'cancelled') return null

  const method = round.tests.includes('fingerprint') ? 'fingerprint' : round.tests.includes('candy') ? 'candy' : null
  if (!method || (!attempts.length && !errors.length)) return null
  // CPA 本地冷却没有收到上游响应，请求结果使用最后一次实际尝试。
  const status = attempts.length ? attempts.filter((attempt) => !attempt.localState).at(-1)?.status : errors.at(-1)?.code
  if (method === 'fingerprint' && fingerprint?.validSamples === required) return null
  return { kind: 'request-error', method, status: typeof status === 'number' && status >= 300 && status < 600 ? status : null }
}

export function inspectionResultReason(round: InspectionRound): string | null {
  const fp = round.evidence.fingerprint
  if (fp && (fp.consistency === 'insufficient' || fp.validSamples < (fp.challengeCount || 3))) {
    return `模型指纹样本不足（${fp.validSamples}/${fp.challengeCount || 3}）`
  }
  const result = inspectionResult(round)
  if (!result) return null
  if (result.kind === 'candy') {
    return `${result.matched ? '糖果题答案正确' : '糖果题答案不正确'}：${result.rawAnswer}`
  }
  if (result.kind === 'fingerprint') {
    const pct = (result.probability * 100).toFixed(2)
    if (result.consistency === 'anomalous' && result.referenceMatched) {
      return `模型指纹 ${pct}% 概率匹配 ${result.model}（未超 90%）`
    }
    return `模型指纹 ${pct}% 概率匹配 ${result.model}`
  }
  return result.status != null ? `请求异常：${result.status}` : '请求异常'
}
