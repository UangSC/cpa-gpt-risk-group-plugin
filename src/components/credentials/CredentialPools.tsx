import { useEffect, useState } from 'react'
import { formatRelative } from '../../lib/format'
import { lowestQuota, type CredentialView } from '../../lib/derive'
import { Chip, Icon, PlanBadge, SecretName, useSelection } from '../ui'
import { CredentialRouting } from '../RoutingControls'
import { StatusLights } from '../StatusLights'
import { type CredentialRuntime, StatusPill, QuotaCell, Actions } from './CredentialParts'
import { SelectableCard } from './SelectableCard'
import { CredentialPager, credentialPage } from './CredentialPager'

type PoolKey = 'normal' | 'uncertain' | 'downshift'

function PoolCard({ view, runtime }: { view: CredentialView; runtime: CredentialRuntime }) {
  const selection = useSelection()
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
      credentialId={view.credential.id}
      selected={selected}
      onToggle={() => selection.toggle(view.credential.id)}
      className={`pool-card tone-${view.verdict}`}
      testId={`cred-${view.credential.id}`}
    >
      <div className="pool-card-top">
        <SecretName name={view.credential.name} className="pool-name" />
        {busy && (
          <Chip tone="uncertain" dot>
            检测中
          </Chip>
        )}
        {selected && (
          <span className="tile-check" aria-label="已选择">
            <Icon.Check />
          </span>
        )}
        {/* The pool header carries the tier badge itself (top-right), so no extra avatar. */}
        <PlanBadge plan={view.credential.plan} />
      </div>

      <div className="pool-card-lights">
        <span className="tile-label">近期</span>
        <StatusLights
          target={view.target}
          onOpen={(roundId) => view.target && runtime.onOpenDetail(view.target.id, roundId)}
          limit={6}
        />
        <span className="tile-time">
          {view.lastCheckedAt ? formatRelative(view.lastCheckedAt, runtime.now) : '未检测'}
        </span>
      </div>

      <div className="pool-card-routing">
        <CredentialRouting credential={view.credential} showLabels />
        {gateNote && <span className="tile-gate">{gateNote}</span>}
      </div>

      <div className="pool-card-quota">
        <QuotaCell view={view} settings={runtime.settings} refreshUnknown />
      </div>

      <div className="pool-card-foot">
        <StatusPill view={view} size="sm" />
        <Actions view={view} runtime={runtime} compact />
      </div>
    </SelectableCard>
  )
}

function PoolColumn({
  tone,
  title,
  note,
  count,
  views,
  runtime,
  emptyText,
  page,
  onPage,
}: {
  tone: PoolKey
  title: string
  note?: string
  count: number
  views: CredentialView[]
  runtime: CredentialRuntime
  emptyText: string
  page: number
  onPage: (next: number) => void
}) {
  const pageSize = runtime.settings.pagination?.pool ?? 4
  const current = credentialPage(views, page, pageSize)

  return (
    <section className="pool" aria-label={title}>
      <header className="pool-head">
        <span className={`dot dot-${tone}`} aria-hidden="true" />
        <h3>{title}</h3>
        {note && <span className="pool-note">{note}</span>}
        <span className="pool-count">{count}</span>
      </header>
      <div className="pool-body" style={{ '--pool-page-size': current.size } as React.CSSProperties}>
        {views.length === 0 ? (
          <div className="pool-empty">{emptyText}</div>
        ) : (
          current.items.map((view) => <PoolCard key={view.credential.id} view={view} runtime={runtime} />)
        )}
      </div>
      {views.length > 0 && <CredentialPager label={`${title}栏`} page={current.page} pages={current.pages} total={views.length} pageSize={current.size} onPage={onPage} />}
    </section>
  )
}

export function CredentialPools({ views, runtime, resetKey = '', onVisibleCredentialIdsChange }: {
  views: CredentialView[]; runtime: CredentialRuntime; resetKey?: string
  onVisibleCredentialIdsChange?: (ids: string[]) => void
}) {
  const pageSize = runtime.settings.pagination?.pool ?? 4
  const key = `${resetKey}|${pageSize}`
  const [position, setPosition] = useState<{ key: string; pages: Record<PoolKey, number> }>({ key, pages: { normal: 0, uncertain: 0, downshift: 0 } })

  const normal = views.filter((v) => v.verdict === 'normal')
  const uncertainOnly = views.filter((v) => v.verdict === 'uncertain')
  const untested = views.filter((v) => v.verdict === 'untested')
  const downshift = views.filter((v) => v.verdict === 'downshift')
  const uncertain = [...uncertainOnly, ...untested]

  const pages = position.key === key ? position.pages : { normal: 0, uncertain: 0, downshift: 0 }
  const visibleKey = JSON.stringify([
    ...credentialPage(normal, pages.normal, pageSize).items,
    ...credentialPage(uncertain, pages.uncertain, pageSize).items,
    ...credentialPage(downshift, pages.downshift, pageSize).items,
  ].map((view) => view.credential.id))
  useEffect(() => {
    onVisibleCredentialIdsChange?.(JSON.parse(visibleKey) as string[])
  }, [visibleKey, onVisibleCredentialIdsChange])
  useEffect(() => {
    const next = { normal: credentialPage(normal, pages.normal, pageSize).page, uncertain: credentialPage(uncertain, pages.uncertain, pageSize).page, downshift: credentialPage(downshift, pages.downshift, pageSize).page }
    if (position.key !== key || next.normal !== pages.normal || next.uncertain !== pages.uncertain || next.downshift !== pages.downshift) setPosition({ key, pages: next })
  }, [key, pageSize, normal.length, uncertain.length, downshift.length, position.key, pages.normal, pages.uncertain, pages.downshift])

  const turnPage = (key: PoolKey) => (next: number) =>
    setPosition({ key: `${resetKey}|${pageSize}`, pages: { ...pages, [key]: Math.max(0, next) } })

  return (
    <div className="pools">
      <PoolColumn
        tone="normal"
        title="正常"
        note="检测完整通过"
        count={normal.length}
        views={normal}
        runtime={runtime}
        emptyText="没有判定正常的凭证"
        page={pages.normal}
        onPage={turnPage('normal')}
      />
      <PoolColumn
        tone="uncertain"
        title="不确定"
        note={`不确定 ${uncertainOnly.length} · 未检测 ${untested.length}`}
        count={uncertain.length}
        views={uncertain}
        runtime={runtime}
        emptyText="没有待确认或未检测的凭证"
        page={pages.uncertain}
        onPage={turnPage('uncertain')}
      />
      <PoolColumn
        tone="downshift"
        title="降档"
        note="当前判定为降档"
        count={downshift.length}
        views={downshift}
        runtime={runtime}
        emptyText="没有降档凭证，状态良好"
        page={pages.downshift}
        onPage={turnPage('downshift')}
      />
    </div>
  )
}
