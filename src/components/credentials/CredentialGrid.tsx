import { formatRelative } from '../../lib/format'
import { lowestQuota, type CredentialView } from '../../lib/derive'
import { Chip, Icon, PlanMark, SecretName, useSelection } from '../ui'
import { CredentialRouting } from '../RoutingControls'
import { StatusLights } from '../StatusLights'
import { type CredentialRuntime, StatusPill, QuotaCell, Actions } from './CredentialParts'
import { SelectableCard, cardNote } from './SelectableCard'

export function CredentialGrid({ views, runtime }: { views: CredentialView[]; runtime: CredentialRuntime }) {
  const selection = useSelection()
  return (
    <div className="cred-grid">
      {views.map((view) => {
        const selected = selection.has(view.credential.id)
        const busy = runtime.activeCredentialIds.includes(view.credential.id)
        const lowest = lowestQuota(view.credential)
        const gateNote =
          view.credential.quota.status === 'exhausted'
            ? '额度不足'
            : lowest != null && lowest <= runtime.settings.quota.minRemainingPercent
              ? `低于门槛 ${runtime.settings.quota.minRemainingPercent}%`
              : null
        return (
          <SelectableCard
            key={view.credential.id}
            credentialId={view.credential.id}
            selected={selected}
            onToggle={() => selection.toggle(view.credential.id)}
            className={`cred-tile tone-${view.verdict}`}
            testId={`cred-${view.credential.id}`}
          >
            <div className="tile-head">
              <PlanMark plan={view.credential.plan} />
              <div className="tile-ident">
                <div className="tile-name-line">
                  <SecretName name={view.credential.name} className="tile-name" />
                  {busy && (
                      <Chip tone="uncertain" dot>
                        检测中
                      </Chip>
                  )}
                </div>
                <div className="tile-sub">
                  <span className="mono secret-name">{view.credential.file}</span>
                  <span className="dot-sep" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    {view.lastCheckedAt
                      ? `${formatRelative(view.lastCheckedAt, runtime.now)}检测`
                      : '无检测记录'}
                  </span>
                </div>
              </div>
              {selected && (
                <span className="tile-check" aria-label="已选择">
                  <Icon.Check />
                </span>
              )}
            </div>

            <div className="tile-lights">
              <span className="tile-label">近期状态</span>
              <StatusLights
                target={view.target}
                onOpen={(roundId) => view.target && runtime.onOpenDetail(view.target.id, roundId)}
                limit={6}
              />
            </div>

            <div className="tile-routing">
              <CredentialRouting credential={view.credential} showLabels />
              {gateNote && <span className="tile-gate">{gateNote}</span>}
            </div>

            <div className="tile-quota">
              <QuotaCell view={view} settings={runtime.settings} refreshUnknown />
            </div>

            <div className={`tile-reason ${view.attention.length > 0 && !view.reason ? 'is-attention' : ''}`}>
              {cardNote(view)}
            </div>

            <div className="tile-foot">
              <StatusPill view={view} size="sm" />
              <Actions view={view} runtime={runtime} compact />
            </div>
          </SelectableCard>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ pools */
