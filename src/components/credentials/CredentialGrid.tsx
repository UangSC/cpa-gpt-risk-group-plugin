import type { CSSProperties } from 'react'
import { formatRelative } from '../../lib/format'
import { type CredentialView } from '../../lib/derive'
import { Chip, HoverCard, PlanMark, SecretName, useSelection } from '../ui'
import { CredentialRouting } from '../RoutingControls'
import { StatusLights } from '../StatusLights'
import { ActivityRail, type CredentialRuntime, StatusPill, GroupCell, QuotaCell, Actions, resolveCardActivity, stop } from './CredentialParts'
import { CardNote, SelectableCard, cardNote } from './SelectableCard'

export function CredentialGrid({
  views,
  runtime,
  columns,
}: {
  views: CredentialView[]
  runtime: CredentialRuntime
  columns?: number
}) {
  const selection = useSelection()
  return (
    <div className="cred-grid" style={columns ? ({ '--card-cols': columns } as CSSProperties) : undefined}>
      {views.map((view) => {
        const isDisabled = view.credential.disabled
        const selected = !isDisabled && selection.has(view.credential.id)
        const activity = !isDisabled ? resolveCardActivity(view.credential.id, runtime) : null
        const quotaRefreshing = !isDisabled && runtime.quotaRefreshingIds.has(view.credential.id)
        const noteText = cardNote(view)
        const reasonClass = !isDisabled && view.verdict === 'downshift'
          ? 'is-downshift'
          : !isDisabled && view.attention.length > 0 && !view.reason
            ? 'is-attention'
            : !isDisabled && view.verdict === 'normal' && view.attention.length === 0
              ? 'is-calm'
              : ''
        return (
          <SelectableCard
            key={view.credential.id}
            credentialId={view.credential.id}
            selected={selected}
            disabled={isDisabled}
            onToggle={() => selection.toggle(view.credential.id)}
            className={`cred-tile tone-${view.verdict}${activity ? ` is-active is-${activity.kind}` : ''}`}
            testId={`cred-${view.credential.id}`}
          >
            <ActivityRail activity={activity} />
            <div className="tile-head">
              <input
                type="checkbox"
                className="checkbox"
                checked={selected}
                disabled={isDisabled}
                onChange={() => {
                  if (!isDisabled) selection.toggle(view.credential.id)
                }}
                onClick={stop}
                aria-label={isDisabled ? '已关闭的凭证无法勾选' : '选择凭证'}
              />
              <PlanMark plan={view.credential.plan} size="sm" />
              <div className="tile-ident">
                <div className="tile-name-line">
                  <SecretName name={view.credential.name} className="tile-name" />
                  {isDisabled && <Chip tone="plain">已关闭</Chip>}
                  {activity && (
                    <Chip tone={activity.chipTone} dot>
                      {activity.label}
                    </Chip>
                  )}
                  {!isDisabled && view.credential.auth === 'expired' && <Chip tone="downshift">认证失效</Chip>}
                </div>
                <div className="tile-sub">
                  <span className="mono secret-name">{view.credential.file}</span>
                  <span aria-hidden="true">·</span>
                  <span>{view.lastCheckedAt ? `${formatRelative(view.lastCheckedAt, runtime.now)}检测` : '未检测'}</span>
                </div>
              </div>
            </div>

            <div className="tile-lights">
              <span className="tile-label">近期</span>
              <StatusLights
                target={view.target}
                onOpen={(roundId) => view.target && runtime.onOpenDetail(view.target.id, roundId)}
                limit={7}
              />
            </div>

            <div className="tile-routing">
              <GroupCell view={view} settings={runtime.settings} />
              <CredentialRouting credential={view.credential} />
            </div>

            <QuotaCell view={view} settings={runtime.settings} refreshUnknown={!isDisabled} refreshing={quotaRefreshing} />

            <HoverCard compact wrapperClassName="summary-tip-wrap" content={noteText}>
              <div className={`tile-reason ${reasonClass}`}>
                <CardNote view={view} />
              </div>
            </HoverCard>

            <div className="tile-foot">
              <StatusPill view={view} size="sm" />
              <Actions view={view} runtime={runtime} mode="card" />
            </div>
          </SelectableCard>
        )
      })}
    </div>
  )
}
