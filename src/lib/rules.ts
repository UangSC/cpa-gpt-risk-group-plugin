/**
 * 界面规则说明与派生数值。
 * 重试、连续失败和额度门槛的文字由当前设置生成；实际巡检由 Go 服务端执行。
 */

import type { ReasonCode, RequestAttempt, RetryPolicy, Settings, TestKind, Verdict } from '../types'
import { formatSeconds } from './format'
import { methodLabel } from '../inspection'

/** Delay before each retry, in order. Length equals the retry count. */
export function retryWaits(policy: RetryPolicy): number[] {
  return Array.from({ length: Math.max(0, policy.maxRetries) }, (_, i) =>
    Math.round(policy.baseDelayMs * Math.pow(policy.backoffFactor, i)),
  )
}

export function totalAttempts(policy: RetryPolicy): number {
  return Math.max(1, policy.maxRetries + 1)
}

/** 新记录区分正常题目与额外重试；旧记录仍按单请求格式解释。 */
export function countRetries(attempts: RequestAttempt[]): number {
  return attempts.some((attempt) => attempt.retryIndex != null)
    ? attempts.filter((attempt) => (attempt.retryIndex ?? 0) > 0).length
    : Math.max(0, attempts.length - 1)
}

/** 本轮所有题目共用的重试规则。 */
export function retrySentence(policy: RetryPolicy): string {
  const waits = retryWaits(policy)
  if (waits.length === 0) return '本轮不重试；请求异常或无有效回答时停止本轮检测。'
  const plays = waits.map((ms) => formatSeconds(ms)).join('、')
  return `本轮所有题目共用 ${policy.maxRetries} 次重试，按配置依次等待 ${plays}。服务端要求更长等待时会遵循该时间，成功题不重复请求。`
}

/** 频繁异常按单轮请求优先判定，跨轮规则作为补充。 */
export function failureRuleSentence(settings: Settings): string {
  const n = settings.failureRule.windowRounds
  const threshold = settings.failureRule.requestThreshold ?? 3
  return `本轮真实 502、503、429 累计达到 ${threshold} 次立即判定风控，混合状态也累计，无需等待多轮；未达次数门槛时，连续 ${n} 轮以同类异常失败也会归为风控。完整通过会打断跨轮累计；401/403、网络错误和本地预检不计入这三类异常。`
}

/** "仅当凭证最低剩余额度高于 15% 时执行检测；额度未知时仍然检测。" */
export function quotaSentence(settings: Settings): string {
  const gate = settings.quota
  const policy =
    gate.unknownPolicy === 'check'
      ? '额度未知时仍然检测，并在卡片上标注额度未知。'
      : '额度未知时跳过，不计入风控。'
  return `仅当凭证所有已知额度窗口中最低的剩余比例高于 ${gate.minRemainingPercent}% 时执行检测；${policy}`
}

export function testLabel(tests: TestKind[]): string {
  if (tests.length === 0) return '未选择测试'
  return tests.map(methodLabel).join(' + ')
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  normal: '正常',
  downshift: '风控',
  uncertain: '不确定',
  untested: '未检测',
}

export const VERDICT_DESC: Record<Verdict, string> = {
  normal: '一轮完整检测中所有所选测试均通过',
  downshift: '糖果题答案不符、指纹异常，或频繁 502/503/429 达到判定条件',
  uncertain: '证据不足、结果待确认，或正处于错误后的重试过程',
  untested: '还没有可用的检测记录',
}

export const REASON_LABEL: Record<ReasonCode, string> = {
  'all-tests-passed': '全部通过',
  'passed-after-retry': '重试后通过',
  'candy-mismatch': '糖果题答案不符',
  'fingerprint-anomaly': '指纹异常',
  'fingerprint-insufficient': '指纹证据不足',
  'pelican-awaiting-judgment': '待人工判定',
  'pelican-judged-normal': '人工判为正常',
  'pelican-judged-downshift': '人工判为风控',
  'repeated-service-errors': '频繁请求异常',
  'single-service-error': '本轮请求异常',
  'auth-expired': '认证失效',
  'quota-exhausted': '额度不足',
  cancelled: '已取消',
  'no-model-response': '无有效回答',
  'method-result': '检测结果',
}

export const REASON_DESC: Record<ReasonCode, string> = {
  'all-tests-passed': '本轮所选测试全部通过，未出现需要重试的请求错误。',
  'passed-after-retry': '请求曾出现服务错误或无效回答，但在本轮共用的重试次数内成功；所选测试全部通过。',
  'candy-mismatch': '糖果题的正确答案应为 21，模型回答中未出现独立的 21。',
  'fingerprint-anomaly': '三次有效结果中，目标参考未匹配，或目标归因概率未超过本轮阈值。',
  'fingerprint-insufficient': '不足三份有效数字序列，或请求模型尚未登记到参考库，因此本轮保持不确定。',
  'pelican-awaiting-judgment': '已输出鹈鹕骑自行车 HTML 动画，系统不自动更改分组，请观察动画细节后手动点击分组按钮。',
  'pelican-judged-normal': '管理员观察鹈鹕骑自行车动画后手动归为正常，并按当前分组策略记录或同步。',
  'pelican-judged-downshift': '管理员观察鹈鹕骑自行车动画后手动归为风控，并按当前分组策略记录或同步。',
  'repeated-service-errors':
    '502、503、429 混合计入同一类频繁异常。达到单轮请求门槛就停止本轮并归入风控；恢复需要新一轮完整通过。',
  'single-service-error':
    '本轮异常尚未达到单轮次数或跨轮补充门槛，暂不改变分组；后续巡检仍按当前规则判断。',
  'auth-expired': '凭证认证失效，无法发起检测。这属于凭证状态问题，不代表模型能力下降。',
  'quota-exhausted':
    '额度已用尽或请求正在排队，无法发起检测。这属于凭证状态问题，不等于模型风控；分组保持不变。',
  cancelled: '检测被取消，本轮没有形成完整结论，分组保持不变。',
  'no-model-response': '请求成功但模型未返回可判定的回答。',
  'method-result': '该轮结果由所选检测方式提供。',
}
