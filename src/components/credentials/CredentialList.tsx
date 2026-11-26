import { useEffect, useRef } from 'react'
import { type CredentialView } from '../../lib/derive'
import { Chip, HoverCard, PlanMark, SecretName, useSelection } from '../ui'
import { CredentialRouting } from '../RoutingControls'
import { StatusLights } from '../StatusLights'
import { ActivityRail, type CredentialRuntime, FreeSkipChip, StatusPill, GroupCell, QuotaCell, StateChips, Actions, resolveCardActivity, stop } from './CredentialParts'
import { CardNote, CardNoteTooltip, cardNoteTone } from './SelectableCard'

/* ------------------------------------------------------------------- list */

export function CredentialList({ views, runtime }: { views: CredentialView[]; runtime: CredentialRuntime }) {
  const selection = useSelection()
  const pageIds = views.filter((v) => !v.credential.disabled).map((v) => v.credential.id)
  const selectedOnPage = pageIds.filter((id) => selection.has(id))
  const allSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length
  const someSelected = selectedOnPage.length > 0 && !allSelected
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const togglePageSelection = () => {
    if (!pageIds.length) return
    if (allSelected) {
      const drop = new Set(pageIds)
      selection.set(selection.selected.filter((id) => !drop.has(id)))
    } else {
      selection.set([...new Set([...selection.selected, ...pageIds])])
    }
  }

  return (
    <div className="cred-table">
      <div className="cred-table-head">
        <span data-list-cell="selection">
          <input
            ref={selectAllRef}
            type="checkbox"
            className="checkbox"
            checked={allSelected}
            disabled={pageIds.length === 0}
            onChange={togglePageSelection}
            aria-label="全选当前页可选凭证"
          />
        </span>
        <span data-list-cell="identity">凭证</span>
        <span data-list-cell="verdict">结论</span>
        <span data-list-cell="lights">近期状态</span>
        <span data-list-cell="group">当前分组</span>
        <span data-list-cell="routing">优先级 / 权重</span>
        <span data-list-cell="quota">剩余额度</span>
        <span data-list-cell="actions">操作</span>
      </div>
      {views.map((view) => {
        const isDisabled = view.credential.disabled
        const selected = !isDisabled && selection.has(view.credential.id)
        const activity = !isDisabled ? resolveCardActivity(view.credential.id, runtime) : null
        const quotaRefreshing = !isDisabled && runtime.quotaRefreshingIds.has(view.credential.id)
        const noteTone = cardNoteTone(view, isDisabled)
        const noteClass = noteTone === 'error' ? 'is-error' : noteTone === 'calm' ? 'is-calm' : ''
        return (
          <div
            key={view.credential.id}
            className={`cred-row tone-${view.verdict} ${selected ? 'is-selected' : ''} ${isDisabled ? 'is-disabled-cred' : ''}${activity ? ` is-active is-${activity.kind}` : ''}`}
            data-testid={`cred-${view.credential.id}`}
            data-credential-id={view.credential.id}
            data-exclusion-source={!isDisabled ? 'true' : undefined}
            onClick={(event) => {
              if (!isDisabled) selection.toggle(view.credential.id, event.shiftKey)
            }}
          >
            <ActivityRail activity={activity} />
            <div className="cred-row-check" data-list-cell="selection" onClick={stop}>
              <input
                type="checkbox"
                className="checkbox"
                checked={selected}
                disabled={isDisabled}
                onChange={() => {}}
                onClick={(event) => {
                  stop(event)
                  if (!isDisabled) selection.toggle(view.credential.id, event.shiftKey)
                }}
                aria-label={isDisabled ? '已关闭的凭证无法勾选' : '选择凭证'}
              />
            </div>

            <div className="cred-ident" data-list-cell="identity">
              <PlanMark plan={view.credential.plan} size="sm" />
              <div className="cred-ident-main">
                <div className="cred-name-line">
                  <SecretName name={view.credential.name} className="cred-name" />
                  {isDisabled && <Chip tone="plain">已关闭</Chip>}
                  <FreeSkipChip view={view} settings={runtime.settings} />
                  {activity && (
                    <Chip tone={activity.chipTone} dot>
                      {activity.label}
                    </Chip>
                  )}
                  {!isDisabled && !activity && view.credential.availability === 'busy' && (
                    <HoverCard
                      content={`当前有 ${view.credential.busySessions} 个会话在运行；巡检会在同一任务内等它空闲后继续。`}
                    >
                      <Chip tone="uncertain" dot>
                        会话中
                      </Chip>
                    </HoverCard>
                  )}
                  {!isDisabled && <StateChips view={view} />}
                </div>
                <div className="cred-meta">
                  <HoverCard
                    compact
                    wrapperClassName="summary-tip-wrap"
                    content={<CardNoteTooltip view={view} inspectFreeAccounts={runtime.settings.inspectFreeAccounts} />}
                  >
                    <span className={`cred-meta-note ${noteClass}`}>
                      <CardNote view={view} inspectFreeAccounts={runtime.settings.inspectFreeAccounts} />
                    </span>
                  </HoverCard>
                  <span className="cred-meta-sep" aria-hidden="true">·</span>
                  <span className="mono secret-name cred-meta-file">{view.credential.file}</span>
                </div>
              </div>
            </div>

            <div className="cred-verdict-cell" data-list-cell="verdict">
              <StatusPill view={view} />
            </div>

            <div className="cred-lights-cell" data-list-cell="lights">
              <StatusLights
                target={view.target}
                onOpen={(roundId) => view.target && runtime.onOpenDetail(view.target.id, roundId)}
              />
            </div>

            <div className="cred-group-cell" data-list-cell="group">
              <GroupCell view={view} settings={runtime.settings} />
            </div>

            <div className="cred-routing-cell" data-list-cell="routing" onClick={stop}>
              <CredentialRouting credential={view.credential} compact />
            </div>

            <div className="cred-quota-cell" data-list-cell="quota">
              <QuotaCell view={view} settings={runtime.settings} refreshUnknown={!isDisabled} refreshing={quotaRefreshing} />
            </div>

            <div className="cred-row-actions" data-list-cell="actions">
              <Actions view={view} runtime={runtime} mode="list" showQuickRun />
            </div>
          </div>
        )
      })}
    </div>
  )
}
