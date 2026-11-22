import type { CandyEvidence, InspectionRound } from '../types'

function candyAnswer(evidence: CandyEvidence): string | null {
  if (evidence.matched) return evidence.expected
  const explicit = /(?:"answer"|'answer'|\banswer\b)\s*[:：=]\s*["']?([+-]?\d+(?:\.\d+)?)(?![\w.]|[+-])/i.exec(evidence.answer)?.[1]
  const numbers = explicit ? [explicit] : evidence.answer.match(/(?<![\w.+-])[+-]?\d+(?:\.\d+)?(?![\w+-]|\.\d)/g) ?? []
  const values = [...new Set(numbers.map(Number))]
  return values.length === 1 && Number.isFinite(values[0]) ? String(values[0]) : null
}

type InspectionResult =
  | { kind: 'candy'; answer: string | null; matched: boolean }
  | { kind: 'fingerprint'; model: string; probability: number; consistency: 'consistent' | 'anomalous' | 'insufficient' }
  | { kind: 'request-error'; method: 'candy' | 'fingerprint'; status: number | null }

export function inspectionResult(round: InspectionRound): InspectionResult | null {
  const { candy, fingerprint, attempts, errors } = round.evidence
  if (fingerprint?.validSamples === 3 && fingerprint.closestModel && fingerprint.probability != null) {
    return { kind: 'fingerprint', model: fingerprint.closestModel, probability: fingerprint.probability,
      consistency: fingerprint.consistency }
  }
  if (candy) return { kind: 'candy', answer: candyAnswer(candy), matched: candy.matched }
  if (round.outcome === 'cancelled') return null

  const method = round.tests.includes('fingerprint') ? 'fingerprint' : round.tests.includes('candy') ? 'candy' : null
  if (!method || (!attempts.length && !errors.length)) return null
  // CPA 本地冷却没有收到上游响应，请求结果使用最后一次实际尝试。
  const status = attempts.length ? attempts.filter((attempt) => !attempt.localState).at(-1)?.status : errors.at(-1)?.code
  if (method === 'fingerprint' && fingerprint?.validSamples === 3) return null
  return { kind: 'request-error', method, status: typeof status === 'number' && status >= 300 && status < 600 ? status : null }
}

export function inspectionResultReason(round: InspectionRound): string | null {
  const result = inspectionResult(round)
  if (!result) return null
  if (result.kind === 'candy') {
    return `${result.matched ? '✅ 答对正确' : '❌ 答案错误'}：${result.answer ?? '未提取到数字答案'}`
  }
  if (result.kind === 'fingerprint') {
    if (result.consistency === 'insufficient') return null
    return `${result.consistency === 'consistent' ? '✅ 模型指纹正确匹配' : '❌ 指纹匹配错误'}：${result.model}`
  }
  return result.method === 'candy' && result.status != null ? `❌ 请求异常：${result.status}` : '❌ 请求异常'
}
