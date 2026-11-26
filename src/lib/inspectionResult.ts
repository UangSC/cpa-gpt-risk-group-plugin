import type { CandyEvidence, InspectionRound } from '../types'
import { DEFAULT_FINGERPRINT_THRESHOLD_PERCENT } from '../data/defaults'
import { lastRound, type CredentialView } from './derive'

export function fingerprintThresholdLabel(threshold?: number | null): string {
  const percent = threshold == null ? DEFAULT_FINGERPRINT_THRESHOLD_PERCENT : Math.round(threshold * 10000) / 100
  return `${percent}%`
}

export function compactAnswerText(answer: string, maxLen = 56): string {
  const compact = answer.trim().replace(/\s+/g, ' ')
  if (!compact) return '（空回答）'
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact
}

export function formatHttpStatusCodes(codes: number[]): string | null {
  if (!codes.length) return null
  if (codes.length === 1) return `HTTP ${codes[0]}`
  if (codes.every((code) => code === codes[0])) return `HTTP ${codes[0]} ×${codes.length}`
  return `HTTP ${codes.join('/')}`
}

export interface RoundErrorInfo {
  httpCodes: number[]
  networkErrors: number
  has200Invalid: boolean
  lastCode: number | 'network-error' | null
  lastCodeLabel: string | null
  codesSummary: string | null
  pureHttpError: boolean
  hasError: boolean
}

export function roundErrorInfo(round: InspectionRound | null | undefined): RoundErrorInfo {
  const empty: RoundErrorInfo = {
    httpCodes: [],
    networkErrors: 0,
    has200Invalid: false,
    lastCode: null,
    lastCodeLabel: null,
    codesSummary: null,
    pureHttpError: false,
    hasError: false,
  }
  if (!round) return empty

  const attempts = round.evidence.attempts ?? []
  const errors = round.evidence.errors ?? []
  const serviceCodes = (round.evidence.serviceError?.codes ?? []).filter((code) => Number.isFinite(code) && code > 0)
  const nonLocalAttempts = attempts.filter((attempt) => !attempt.localState)
  const inspectedAttempts = nonLocalAttempts.length ? nonLocalAttempts : attempts
  const onlyLocalAttempts = attempts.length > 0 && nonLocalAttempts.length === 0

  const httpCodes: number[] = []
  let networkErrors = 0
  let has200Invalid = false
  let lastCode: number | 'network-error' | null = null

  for (const attempt of inspectedAttempts) {
    if (typeof attempt.status === 'number') {
      if (attempt.status >= 200 && attempt.status < 300) {
        if (!attempt.validResponse) has200Invalid = true
      } else if (attempt.status > 0) {
        httpCodes.push(attempt.status)
        lastCode = attempt.status
      }
    } else if (attempt.status === 'network-error') {
      networkErrors += 1
      lastCode = 'network-error'
    }
  }

  if (httpCodes.length === 0 && serviceCodes.length > 0) {
    httpCodes.push(...serviceCodes)
    lastCode ??= serviceCodes.at(-1) ?? null
  } else if (httpCodes.length === 0 && errors.length > 0) {
    const errorCodes = errors
      .map((entry) => entry.code)
      .filter((code) => Number.isFinite(code) && code > 0 && (code < 200 || code >= 300))
    if (errorCodes.length > 0) {
      httpCodes.push(...errorCodes)
      lastCode ??= errorCodes.at(-1) ?? null
    } else if (networkErrors === 0 && errors.some((entry) => entry.code === 0)) {
      networkErrors = errors.filter((entry) => entry.code === 0).length
      lastCode ??= 'network-error'
    }
  }

  const lastCodeLabel =
    typeof lastCode === 'number'
      ? onlyLocalAttempts
        ? `HTTP ${lastCode}（本地冷却）`
        : `HTTP ${lastCode}`
      : lastCode === 'network-error'
        ? '网络连接异常'
        : null
  const codesSummary = onlyLocalAttempts ? null : formatHttpStatusCodes(httpCodes)
  const pureHttpError = !onlyLocalAttempts && httpCodes.length > 0 && !has200Invalid && networkErrors === 0
  const hasError = httpCodes.length > 0 || networkErrors > 0 || Boolean(serviceCodes.length)
  return {
    httpCodes,
    networkErrors,
    has200Invalid,
    lastCode,
    lastCodeLabel,
    codesSummary,
    pureHttpError,
    hasError,
  }
}

export function latestCredentialErrorCode(view: Pick<CredentialView, 'target' | 'credential'>): string | null {
  const latest = lastRound(view.target)
  if (latest && latest.outcome !== 'normal') {
    const label = roundErrorInfo(latest).lastCodeLabel
    if (label) return label
  }
  if (view.credential.sync.status === 'failed' && view.credential.sync.message) {
    const match = /\bHTTP\s*(\d{3})\b/i.exec(view.credential.sync.message)
    if (match) return `HTTP ${match[1]}`
  }
  return null
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
  | {
      kind: 'pelican'
      hasSvg: boolean
      svgBytes: number
      strictFormat: boolean
      judgedVerdict?: 'normal' | 'downshift'
    }
  | {
      kind: 'request-error'
      method: 'candy' | 'fingerprint' | 'pelican'
      status: number | null
      codesSummary: string | null
      lastCodeLabel: string | null
    }

export function inspectionResult(round: InspectionRound): InspectionResult | null {
  const { candy, fingerprint, pelican, attempts, errors } = round.evidence
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
  if (pelican && (pelican.svg || pelican.svgBytes > 0)) {
    return {
      kind: 'pelican',
      hasSvg: Boolean(pelican.svg),
      svgBytes: pelican.svgBytes,
      strictFormat: pelican.strictFormat,
      judgedVerdict: pelican.judgedVerdict,
    }
  }
  if (round.outcome === 'cancelled') return null

  const method = round.tests.includes('fingerprint')
    ? 'fingerprint'
    : round.tests.includes('pelican')
      ? 'pelican'
      : round.tests.includes('candy')
        ? 'candy'
        : null
  if (!method || (!attempts.length && !errors.length && !round.evidence.serviceError?.codes?.length)) return null
  const errInfo = roundErrorInfo(round)
  if (method === 'fingerprint' && fingerprint?.validSamples === required) return null
  if (method === 'pelican' && pelican?.rawSnippet && !errInfo.hasError) return null
  return {
    kind: 'request-error',
    method,
    status: typeof errInfo.lastCode === 'number' ? errInfo.lastCode : null,
    codesSummary: errInfo.codesSummary,
    lastCodeLabel: errInfo.lastCodeLabel,
  }
}

export function inspectionResultReason(round: InspectionRound): string | null {
  const fp = round.evidence.fingerprint
  const isPelican = round.tests.includes('pelican') || Boolean(round.evidence.pelican)
  const required = fp?.challengeCount || 3
  const result = inspectionResult(round)
  if (result?.kind === 'fingerprint') {
    const pct = (result.probability * 100).toFixed(2)
    if (result.consistency === 'anomalous' && result.referenceMatched) {
      return `模型指纹 ${pct}% 概率匹配 ${result.model}（未超 ${fingerprintThresholdLabel(fp?.threshold)}）`
    }
    return `模型指纹 ${pct}% 概率匹配 ${result.model}`
  }
  if (result?.kind === 'candy') {
    return `${result.matched ? '糖果题答案正确' : '糖果题答案不正确'}：${result.rawAnswer}`
  }
  if (result?.kind === 'pelican') {
    if (result.judgedVerdict === 'normal' || round.outcome === 'normal') return '人工肉眼判定：正常（鹈鹕 SVG 动画）'
    if (result.judgedVerdict === 'downshift' || round.outcome === 'downshift') return '人工肉眼判定：风控（鹈鹕 SVG 动画）'
    return '已生成鹈鹕骑自行车 SVG 动画，待肉眼判定分组'
  }

  const errInfo = roundErrorInfo(round)
  if (round.reasonCode === 'auth-expired') {
    return errInfo.lastCodeLabel ? `凭证认证失效（${errInfo.lastCodeLabel}），未取得有效回答` : round.reason
  }
  if (round.evidence.serviceError?.codes?.length) {
    const summary = formatHttpStatusCodes(round.evidence.serviceError.codes) ?? round.evidence.serviceError.codes.join('/')
    return round.outcome === 'downshift'
      ? `累计 ${round.evidence.serviceError.codes.length} 次服务异常（${summary}），触发风控规则`
      : `本轮出现 ${round.evidence.serviceError.codes.length} 次服务异常（${summary}），未达风控门槛`
  }
  if (errInfo.codesSummary) {
    if (errInfo.pureHttpError) {
      return fp
        ? `请求返回错误码 ${errInfo.codesSummary}，未取得有效样本（${fp.validSamples}/${required}）`
        : isPelican
          ? `请求返回错误码 ${errInfo.codesSummary}，未取得有效 SVG 绘画`
          : `请求返回错误码 ${errInfo.codesSummary}，未取得有效回答`
    }
    return fp
      ? `请求异常（含错误码 ${errInfo.codesSummary}），模型指纹样本不足（${fp.validSamples}/${required}）`
      : isPelican
        ? `请求异常（含错误码 ${errInfo.codesSummary}），未取得有效 SVG 绘画`
        : `请求异常（含错误码 ${errInfo.codesSummary}），未取得有效回答`
  }
  if (errInfo.networkErrors > 0) {
    return fp
      ? `网络连接异常，模型指纹样本不足（${fp.validSamples}/${required}）`
      : isPelican
        ? `网络连接异常（×${errInfo.networkErrors}），未取得有效 SVG 绘画`
        : `网络连接异常（×${errInfo.networkErrors}），未取得有效回答`
  }
  if (isPelican && round.evidence.pelican?.rawSnippet) {
    return '模型未返回有效的 <svg> 源码，待重新绘制'
  }
  if (fp && (fp.consistency === 'insufficient' || fp.validSamples < required)) {
    return `模型指纹样本不足（${fp.validSamples}/${required}）`
  }
  if (result?.kind === 'request-error') {
    return result.lastCodeLabel ? `请求异常（${result.lastCodeLabel}）` : result.status != null ? `请求异常：HTTP ${result.status}` : '请求异常'
  }
  return null
}

/** Resolves the most informative round reason, upgrading legacy generic strings when error codes exist in evidence. */
export function resolvedRoundReason(round: InspectionRound): string {
  const errInfo = roundErrorInfo(round)
  if (
    round.outcome !== 'normal' &&
    errInfo.hasError &&
    !round.reason.includes('HTTP') &&
    !round.reason.includes('网络连接异常')
  ) {
    return inspectionResultReason(round) ?? round.reason
  }
  return round.reason
}
