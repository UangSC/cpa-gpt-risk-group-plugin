import { type CredentialView } from '../../lib/derive'

/* ------------------------------------------------------------------- card */

export function SelectableCard({
  selected,
  onToggle,
  className,
  children,
  testId,
  credentialId,
}: {
  selected: boolean
  onToggle: () => void
  className: string
  children: React.ReactNode
  testId?: string
  credentialId?: string
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-testid={testId}
      data-credential-id={credentialId}
      data-exclusion-source={credentialId ? 'true' : undefined}
      className={`${className} ${selected ? 'is-selected' : ''}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        // Ignore keys aimed at the inner buttons (测试 / 详情 / 待同步), otherwise Enter
        // would also toggle the card selection while activating them.
        if (e.target !== e.currentTarget) return
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

/** One-line explanation used when the latest round has no reason of its own. */
export function cardNote(view: CredentialView): string {
  if (view.reason) return view.reason
  const auth = view.attention.find((a) => a.kind === 'auth')
  if (auth) return '认证失效，需要重新登录后再检测'
  const quota = view.attention.find((a) => a.kind === 'quota')
  if (quota) return '额度不足或正在排队，暂不检测'
  return '尚未检测，点击「测试」开始'
}
