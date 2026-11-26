import { type ReactNode } from 'react'
import { isFreePlan, lastRound, statusOf, type CredentialView } from '../../lib/derive'
import {
  compactAnswerText,
  fingerprintThresholdLabel,
  formatHttpStatusCodes,
  latestCredentialErrorCode,
  roundErrorInfo,
} from '../../lib/inspectionResult'

/* ------------------------------------------------------------------- card */

export function SelectableCard({
  selected,
  disabled = false,
  onToggle,
  className,
  children,
  testId,
  credentialId,
}: {
  selected: boolean
  disabled?: boolean
  onToggle: (shiftKey?: boolean) => void
  className: string
  children: ReactNode
  testId?: string
  credentialId?: string
}) {
  return (
    <div
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? -1 : 0}
      aria-pressed={disabled ? undefined : selected}
      aria-disabled={disabled ? 'true' : undefined}
      data-testid={testId}
      data-credential-id={credentialId}
      data-exclusion-source={credentialId && !disabled ? 'true' : undefined}
      className={`selectable-card ${className} ${selected && !disabled ? 'is-selected' : ''} ${disabled ? 'is-disabled-cred' : ''}`}
      onClick={(e) => {
        if (!disabled) onToggle(e.shiftKey)
      }}
      onKeyDown={(e) => {
        if (disabled || e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(e.shiftKey)
        }
      }}
    >
      {children}
    </div>
  )
}

function authFailureNote(view: CredentialView): string | null {
  const latest = lastRound(view.target)
  const code = latest?.reasonCode === 'auth-expired' ? roundErrorInfo(latest).lastCodeLabel : null
  if (latest?.reasonCode === 'auth-expired') {
    if (code && !latest.reason.includes(code.replace('HTTP ', ''))) {
      return `${latest.reason}（${code}）`
    }
    return latest.reason
  }
  return view.credential.auth === 'expired' ? '认证失效，需重新登录' : null
}

export type CardNoteTone = 'error' | 'calm' | 'muted'

export function cardNoteTone(view: CredentialView, isDisabled = false): CardNoteTone {
  if (isDisabled) return 'muted'
  const latest = lastRound(view.target)
  if (view.verdict === 'downshift' || statusOf(view) === 'error' || view.attention.length > 0) {
    return 'error'
  }
  if (latest && (latest.outcome === 'blocked' || latest.outcome === 'downshift' || roundErrorInfo(latest).hasError)) {
    return 'error'
  }
  if (view.verdict === 'normal') return 'calm'
  return 'muted'
}

/** Concrete single-line inspection answer summary (plain text). */
export function cardNote(view: CredentialView, inspectFreeAccounts = true): string {
  if (view.credential.disabled) {
    return view.reason ? '凭证已关闭 · 打开开关即可恢复' : '凭证已关闭，不参与巡检'
  }
  const authNote = authFailureNote(view)
  if (authNote) return authNote

  const latest = lastRound(view.target)
  const fp = latest?.evidence.fingerprint
  const required = fp?.challengeCount || 3
  if (fp && fp.validSamples === required && fp.closestModel && fp.probability != null) {
    const pct = (fp.probability * 100).toFixed(2)
    return fp.consistency === 'anomalous' && fp.referenceMatched
      ? `模型指纹 ${pct}% 概率匹配 ${fp.closestModel}（未超 ${fingerprintThresholdLabel(fp.threshold)}）`
      : `模型指纹 ${pct}% 概率匹配 ${fp.closestModel}`
  }
  const candy = latest?.evidence.candy
  if (candy) {
    const raw = compactAnswerText(candy.answer, 48)
    return `${candy.matched ? '糖果题答案正确' : '糖果题答案不正确'}：${raw}`
  }
  const pelican = latest?.evidence.pelican
  if (pelican && (pelican.svg || pelican.svgBytes > 0)) {
    if (pelican.judgedVerdict === 'normal' || latest?.outcome === 'normal') return '画鹈鹕人工判定：正常'
    if (pelican.judgedVerdict === 'downshift' || latest?.outcome === 'downshift') return '画鹈鹕人工判定：风控'
    return '已生成鹈鹕骑自行车 SVG 动画 · 待肉眼判定'
  }
  const svc = latest?.evidence.serviceError
  if (svc?.codes?.length) {
    const summary = formatHttpStatusCodes(svc.codes) ?? svc.codes.join('/')
    return `本轮异常：${summary}（累计 ${svc.codes.length} 次）`
  }
  const errInfo = roundErrorInfo(latest)
  if (errInfo.codesSummary) {
    if (errInfo.pureHttpError) {
      return fp
        ? `请求返回错误码 ${errInfo.codesSummary}（样本 ${fp.validSamples}/${required}）`
        : `请求返回错误码 ${errInfo.codesSummary}，未取得有效回答`
    }
    return fp
      ? `请求异常 ${errInfo.codesSummary}（样本 ${fp.validSamples}/${required}）`
      : `请求异常 ${errInfo.codesSummary}，未取得有效回答`
  }
  if (errInfo.networkErrors > 0) {
    return fp
      ? `网络连接异常（样本 ${fp.validSamples}/${required}）`
      : `网络连接异常（×${errInfo.networkErrors}），未取得有效回答`
  }
  if (fp) {
    return `模型指纹样本不足（${fp.validSamples}/${required}）`
  }
  if (view.reason) return view.reason
  if (isFreePlan(view.credential.plan) && !inspectFreeAccounts) {
    return 'Free 账号默认不参与巡检，可在设置中强制开启'
  }
  const quota = view.attention.find((a) => a.kind === 'quota')
  if (quota) return '额度不足或排队中'
  return '尚未检测'
}

/** Formatted single-line answer summary with subtle monospace highlight for answers/models/error codes. */
export function CardNote({ view, inspectFreeAccounts = true }: { view: CredentialView; inspectFreeAccounts?: boolean }) {
  if (view.credential.disabled) {
    return <>{view.reason ? '凭证已关闭 · 打开开关即可恢复' : '凭证已关闭，不参与巡检'}</>
  }
  const authNote = authFailureNote(view)
  if (authNote) return <span className="credential-auth-note">{authNote}</span>

  const latest = lastRound(view.target)
  const fp = latest?.evidence.fingerprint
  const required = fp?.challengeCount || 3
  if (fp && fp.validSamples === required && fp.closestModel && fp.probability != null) {
    const pct = (fp.probability * 100).toFixed(2)
    return (
      <>
        模型指纹 <b>{pct}%</b> 概率匹配 <code className="inline-answer">{fp.closestModel}</code>
        {fp.consistency === 'anomalous' && fp.referenceMatched ? `（未超 ${fingerprintThresholdLabel(fp.threshold)}）` : ''}
      </>
    )
  }
  const candy = latest?.evidence.candy
  if (candy) {
    const raw = compactAnswerText(candy.answer, 48)
    return (
      <>
        {candy.matched ? '糖果题答案正确：' : '糖果题答案不正确：'}
        <code className="inline-answer">{raw}</code>
      </>
    )
  }
  const pelican = latest?.evidence.pelican
  if (pelican && (pelican.svg || pelican.svgBytes > 0)) {
    if (pelican.judgedVerdict === 'normal' || latest?.outcome === 'normal') {
      return <>画鹈鹕人工判定：<b>正常</b></>
    }
    if (pelican.judgedVerdict === 'downshift' || latest?.outcome === 'downshift') {
      return <>画鹈鹕人工判定：<b>风控</b></>
    }
    return <>已生成鹈鹕骑自行车 SVG 动画 · 待肉眼判定</>
  }
  const svc = latest?.evidence.serviceError
  if (svc?.codes?.length) {
    const summary = formatHttpStatusCodes(svc.codes) ?? svc.codes.join('/')
    return (
      <>
        本轮异常：<code className="inline-answer inline-error-code">{summary}</code>（累计 {svc.codes.length} 次）
      </>
    )
  }
  const errInfo = roundErrorInfo(latest)
  if (errInfo.codesSummary) {
    return errInfo.pureHttpError ? (
      <>
        请求返回错误码 <code className="inline-answer inline-error-code">{errInfo.codesSummary}</code>
        {fp ? `（样本 ${fp.validSamples}/${required}）` : '，未取得有效回答'}
      </>
    ) : (
      <>
        请求异常 <code className="inline-answer inline-error-code">{errInfo.codesSummary}</code>
        {fp ? `（样本 ${fp.validSamples}/${required}）` : '，未取得有效回答'}
      </>
    )
  }
  if (errInfo.networkErrors > 0) {
    return (
      <>
        网络连接异常
        {fp ? (
          `（样本 ${fp.validSamples}/${required}）`
        ) : (
          <>
            （<code className="inline-answer inline-error-code">×{errInfo.networkErrors}</code>），未取得有效回答
          </>
        )}
      </>
    )
  }
  if (fp) {
    return <>模型指纹样本不足（{fp.validSamples}/{required}）</>
  }
  return <>{cardNote(view, inspectFreeAccounts)}</>
}

/** Summary hover tooltip without any credential JSON filename; includes last error code on errors. */
export function CardNoteTooltip({ view, inspectFreeAccounts = true }: { view: CredentialView; inspectFreeAccounts?: boolean }) {
  const text = cardNote(view, inspectFreeAccounts)
  const tone = cardNoteTone(view, view.credential.disabled)
  const lastCode = tone === 'error' ? latestCredentialErrorCode(view) : null
  if (!lastCode) {
    return <span className={tone === 'error' ? 'tip-v-danger' : undefined}>{text}</span>
  }
  return (
    <>
      <div className="tip-v-danger">{text}</div>
      <div className="tip-row tip-error-code-row">
        <span className="tip-k">最后错误码</span>
        <span className="tip-v tip-v-danger mono">{lastCode}</span>
      </div>
    </>
  )
}
