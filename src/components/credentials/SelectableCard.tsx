import { type ReactNode } from 'react'
import { lastRound, type CredentialView } from '../../lib/derive'
import { compactAnswerText } from '../../lib/inspectionResult'

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
  onToggle: () => void
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
      onClick={() => {
        if (!disabled) onToggle()
      }}
      onKeyDown={(e) => {
        if (disabled || e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
    >
      {children}
    </div>
  )
}

/** Concrete single-line inspection answer summary (plain text). */
export function cardNote(view: CredentialView): string {
  if (view.credential.disabled) {
    return view.reason ? '凭证已关闭 · 打开开关即可恢复' : '凭证已关闭，不参与巡检'
  }
  const latest = lastRound(view.target)
  const fp = latest?.evidence.fingerprint
  if (fp) {
    const required = fp.challengeCount || 3
    if (fp.validSamples === required && fp.closestModel && fp.probability != null) {
      const pct = (fp.probability * 100).toFixed(2)
      return fp.consistency === 'anomalous' && fp.referenceMatched
        ? `模型指纹 ${pct}% 概率匹配 ${fp.closestModel}（未超 90%）`
        : `模型指纹 ${pct}% 概率匹配 ${fp.closestModel}`
    }
    return `模型指纹样本不足（${fp.validSamples}/${required}）`
  }
  const candy = latest?.evidence.candy
  if (candy) {
    const raw = compactAnswerText(candy.answer, 48)
    return `${candy.matched ? '糖果题答案正确' : '糖果题答案不正确'}：${raw}`
  }
  const svc = latest?.evidence.serviceError
  if (svc?.codes?.length) {
    return `本轮异常：${svc.codes.join('/')}（累计 ${svc.codes.length} 次）`
  }
  if (view.reason) return view.reason
  const auth = view.attention.find((a) => a.kind === 'auth')
  if (auth) return '认证失效，需重新登录'
  const quota = view.attention.find((a) => a.kind === 'quota')
  if (quota) return '额度不足或排队中'
  return '尚未检测'
}

/** Formatted single-line answer summary with subtle monospace highlight for answers/models. */
export function CardNote({ view }: { view: CredentialView }) {
  if (view.credential.disabled) {
    return <>{view.reason ? '凭证已关闭 · 打开开关即可恢复' : '凭证已关闭，不参与巡检'}</>
  }
  const latest = lastRound(view.target)
  const fp = latest?.evidence.fingerprint
  if (fp) {
    const required = fp.challengeCount || 3
    if (fp.validSamples === required && fp.closestModel && fp.probability != null) {
      const pct = (fp.probability * 100).toFixed(2)
      return (
        <>
          模型指纹 <b>{pct}%</b> 概率匹配 <code className="inline-answer">{fp.closestModel}</code>
          {fp.consistency === 'anomalous' && fp.referenceMatched ? '（未超 90%）' : ''}
        </>
      )
    }
    return <>模型指纹样本不足（{fp.validSamples}/{required}）</>
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
  const svc = latest?.evidence.serviceError
  if (svc?.codes?.length) {
    return (
      <>
        本轮异常：<code className="inline-answer">{svc.codes.join('/')}</code>（累计 {svc.codes.length} 次）
      </>
    )
  }
  return <>{cardNote(view)}</>
}
