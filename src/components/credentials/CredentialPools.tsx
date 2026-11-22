import { memo, useEffect, useMemo, useState } from 'react'
import { formatRelative } from '../../lib/format'
import { lowestQuota, type CredentialView } from '../../lib/derive'
import type { VerdictFilter } from '../../store/store'
import { Chip, HoverCard, PlanBadge, SecretName, useSelection } from '../ui'
import { CredentialRouting } from '../RoutingControls'
import { StatusLights } from '../StatusLights'
import { ActivityRail, type CredentialRuntime, StatusPill, GroupCell, QuotaCell, Actions, resolveCardActivity, stop } from './CredentialParts'
import { CardNote, SelectableCard, cardNote } from './SelectableCard'
import { CredentialPager, credentialPage } from './CredentialPager'

type PoolKey = 'normal' | 'attention'
type RightSubFilter = 'all' | 'downshift' | 'pending'

const VERDICT_FILTER_TITLES: Record<VerdictFilter, string> = {
  all: '全部',
  normal: '正常凭证',
  downshift: '风控凭证',
  uncertain: '不确定凭证',
  untested: '未检测凭证',
  attention: '需处理凭证',
}

const PoolCard = memo(function PoolCard({ view, runtime }: { view: CredentialView; runtime: CredentialRuntime }) {
  const selection = useSelection()
  const isDisabled = view.credential.disabled
  const selected = !isDisabled && selection.has(view.credential.id)
  const activity = !isDisabled ? resolveCardActivity(view.credential.id, runtime) : null
  const quotaRefreshing = !isDisabled && runtime.quotaRefreshingIds.has(view.credential.id)
  const lowest = lowestQuota(view.credential)
  const quotaInlineWarn =
    view.credential.quota.windows.length > 0
      ? view.credential.quota.status === 'exhausted'
        ? '额度不足'
        : lowest != null && lowest <= runtime.settings.quota.minRemainingPercent
          ? '低于门槛'
          : null
      : null
  const hasSync = view.attention.some((a) => a.kind === 'sync')
  const summaryClass = isDisabled
    ? ''
    : view.verdict === 'downshift'
      ? 'is-downshift'
      : hasSync || view.attention.some((a) => a.kind === 'auth')
        ? 'is-attention'
        : view.verdict === 'normal'
          ? 'is-calm'
          : ''

  return (
    <SelectableCard
      credentialId={view.credential.id}
      selected={selected}
      disabled={isDisabled}
      onToggle={() => selection.toggle(view.credential.id)}
      className={`lane-card tone-${view.verdict}${activity ? ` is-active is-${activity.kind}` : ''}`}
      testId={`cred-${view.credential.id}`}
    >
      <ActivityRail activity={activity} />
      <div className="lane-card-row1">
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
        <PlanBadge plan={view.credential.plan} size="sm" />
        <SecretName name={view.credential.name} className="lane-card-name" />
        {isDisabled && <Chip tone="plain">已关闭</Chip>}
        {activity && (
          <Chip tone={activity.chipTone} dot>
            {activity.label}
          </Chip>
        )}
        {!isDisabled && !activity && view.credential.availability === 'busy' && (
          <HoverCard content={`当前有 ${view.credential.busySessions} 个活跃会话，巡检会等待其空闲。`}>
            <Chip tone="uncertain" dot>
              会话中
            </Chip>
          </HoverCard>
        )}
        {!isDisabled && view.credential.auth === 'expired' && <Chip tone="downshift">认证失效</Chip>}
        <StatusPill view={view} size="sm" />
      </div>

      <div className="lane-card-row2">
        <div className="lane-card-evidence">
          <div className="lane-card-lights">
            <StatusLights
              target={view.target}
              onOpen={(roundId) => view.target && runtime.onOpenDetail(view.target.id, roundId)}
              limit={7}
            />
            <span className="lane-card-time">
              {view.lastCheckedAt ? formatRelative(view.lastCheckedAt, runtime.now) : '未检测'}
            </span>
            {quotaInlineWarn && <span className="quota-warn-inline">· {quotaInlineWarn}</span>}
          </div>
          <HoverCard compact wrapperClassName="summary-tip-wrap" content={cardNote(view)}>
            <div className={`lane-card-summary ${summaryClass}`}>
              <CardNote view={view} />
            </div>
          </HoverCard>
        </div>
        <div className="lane-card-quota">
          <QuotaCell view={view} settings={runtime.settings} refreshUnknown={!isDisabled} compactWarn refreshing={quotaRefreshing} />
        </div>
      </div>

      <div className="lane-card-row3">
        <div className="lane-card-meta">
          <GroupCell view={view} settings={runtime.settings} />
          <CredentialRouting credential={view.credential} />
        </div>
        <Actions view={view} runtime={runtime} mode="pool" />
      </div>
    </SelectableCard>
  )
})

function LaneSelectButton({ items }: { items: CredentialView[] }) {
  const selection = useSelection()
  const ids = items.filter((v) => !v.credential.disabled).map((v) => v.credential.id)
  if (ids.length === 0) return null
  const allSelected = ids.every((id) => selection.has(id))
  const toggleLane = () => {
    if (allSelected) {
      const drop = new Set(ids)
      selection.set(selection.selected.filter((id) => !drop.has(id)))
    } else {
      selection.set([...new Set([...selection.selected, ...ids])])
    }
  }
  return (
    <button
      type="button"
      className="btn btn-ghost lane-select-btn"
      onClick={toggleLane}
      aria-pressed={allSelected}
    >
      {allSelected ? '取消本页' : '选本页'}
    </button>
  )
}

export function CredentialPools({
  views,
  runtime,
  resetKey = '',
  verdictFilter = 'all',
  onResetVerdictFilter,
  onVisibleCredentialIdsChange,
}: {
  views: CredentialView[]
  runtime: CredentialRuntime
  resetKey?: string
  verdictFilter?: VerdictFilter
  onResetVerdictFilter?: () => void
  onVisibleCredentialIdsChange?: (ids: string[]) => void
}) {
  const pageSize = runtime.settings.pagination?.pool ?? 4
  const [rightSub, setRightSub] = useState<RightSubFilter>('all')
  const key = `${resetKey}|${pageSize}|${verdictFilter}|${rightSub}`
  const [position, setPosition] = useState<{ key: string; pages: Record<PoolKey, number>; focused: number }>({
    key,
    pages: { normal: 0, attention: 0 },
    focused: 0,
  })

  const normal = useMemo(() => views.filter((v) => v.verdict === 'normal'), [views])
  const downshift = useMemo(() => views.filter((v) => v.verdict === 'downshift'), [views])
  const uncertain = useMemo(() => views.filter((v) => v.verdict === 'uncertain'), [views])
  const untested = useMemo(() => views.filter((v) => v.verdict === 'untested'), [views])

  const rightAll = useMemo(() => [...downshift, ...uncertain, ...untested], [downshift, uncertain, untested])
  const rightFiltered = useMemo(() => {
    if (rightSub === 'downshift') return downshift
    if (rightSub === 'pending') return [...uncertain, ...untested]
    return rightAll
  }, [rightSub, downshift, uncertain, untested, rightAll])

  const pages = position.key === key ? position.pages : { normal: 0, attention: 0 }
  const focusedPageNum = position.key === key ? position.focused : 0

  const normalPage = credentialPage(normal, pages.normal, pageSize)
  const rightPage = credentialPage(rightFiltered, pages.attention, pageSize)
  const focusedPage = credentialPage(views, focusedPageNum, pageSize * 2)

  const visibleIds = useMemo(() => {
    if (verdictFilter !== 'all') return focusedPage.items.map((v) => v.credential.id)
    return [...normalPage.items, ...rightPage.items].map((v) => v.credential.id)
  }, [verdictFilter, focusedPage.items, normalPage.items, rightPage.items])

  const visibleKey = JSON.stringify(visibleIds)
  useEffect(() => {
    onVisibleCredentialIdsChange?.(JSON.parse(visibleKey) as string[])
  }, [visibleKey, onVisibleCredentialIdsChange])

  useEffect(() => {
    if (
      position.key !== key ||
      normalPage.page !== pages.normal ||
      rightPage.page !== pages.attention ||
      focusedPage.page !== focusedPageNum
    ) {
      setPosition({
        key,
        pages: { normal: normalPage.page, attention: rightPage.page },
        focused: focusedPage.page,
      })
    }
  }, [
    key,
    position.key,
    normalPage.page,
    rightPage.page,
    focusedPage.page,
    pages.normal,
    pages.attention,
    focusedPageNum,
  ])

  const turnLanePage = (lane: PoolKey) => (next: number) =>
    setPosition({
      key,
      pages: { ...pages, [lane]: Math.max(0, next) },
      focused: focusedPageNum,
    })

  if (verdictFilter !== 'all') {
    return (
      <div className="focused-board">
        <div className="focused-board-head">
          <span className="inline">
            <strong>{VERDICT_FILTER_TITLES[verdictFilter]}</strong>
            <span className="lane-count">{views.length}</span>
          </span>
          <div className="inline">
            <LaneSelectButton items={focusedPage.items} />
            {onResetVerdictFilter && (
              <button type="button" className="btn btn-sm" onClick={onResetVerdictFilter}>
                返回双栏视图
              </button>
            )}
          </div>
        </div>
        <div className="focused-grid">
          {focusedPage.items.map((view) => (
            <PoolCard key={view.credential.id} view={view} runtime={runtime} />
          ))}
        </div>
        <CredentialPager
          label={VERDICT_FILTER_TITLES[verdictFilter]}
          page={focusedPage.page}
          pages={focusedPage.pages}
          total={views.length}
          pageSize={focusedPage.size}
          hideWhenSinglePage
          onPage={(next) => setPosition({ key, pages, focused: Math.max(0, next) })}
        />
      </div>
    )
  }

  return (
    <div className="dual-board">
      <section className="lane" aria-label="正常池">
        <header className="lane-head">
          <div className="lane-title">
            <span className="dot dot-normal" aria-hidden="true" />
            <h3>正常</h3>
            <span className="lane-count">{normal.length}</span>
          </div>
          <div className="lane-head-right">
            <LaneSelectButton items={normalPage.items} />
          </div>
        </header>
        <div className="lane-body">
          {normal.length === 0 ? (
            <div className="lane-empty">暂无判定正常的凭证</div>
          ) : (
            normalPage.items.map((view) => <PoolCard key={view.credential.id} view={view} runtime={runtime} />)
          )}
        </div>
        <CredentialPager
          label="正常栏"
          page={normalPage.page}
          pages={normalPage.pages}
          total={normal.length}
          pageSize={normalPage.size}
          hideWhenSinglePage
          onPage={turnLanePage('normal')}
        />
      </section>

      <section className="lane" aria-label="风控与待定池">
        <header className="lane-head">
          <div className="lane-title">
            <span className={`dot ${downshift.length > 0 ? 'dot-downshift' : 'dot-uncertain'}`} aria-hidden="true" />
            <h3>风控与待定</h3>
            <span className="lane-count">{rightAll.length}</span>
          </div>
          <div className="lane-head-right">
            <div className="lane-filter" role="group" aria-label="筛选风控与待定">
              <button
                type="button"
                aria-pressed={rightSub === 'all'}
                onClick={() => setRightSub('all')}
              >
                全部 {rightAll.length}
              </button>
              <button
                type="button"
                aria-pressed={rightSub === 'downshift'}
                onClick={() => setRightSub('downshift')}
              >
                <span className="dot dot-downshift" aria-hidden="true" />
                风控 {downshift.length}
              </button>
              <button
                type="button"
                aria-pressed={rightSub === 'pending'}
                onClick={() => setRightSub('pending')}
              >
                <span className="dot dot-uncertain" aria-hidden="true" />
                待定 {uncertain.length + untested.length}
              </button>
            </div>
            <LaneSelectButton items={rightPage.items} />
          </div>
        </header>
        <div className="lane-body">
          {rightFiltered.length === 0 ? (
            <div className="lane-empty">
              {rightSub === 'downshift'
                ? '没有风控凭证，状态良好'
                : rightSub === 'pending'
                  ? '没有不确定或未检测的凭证'
                  : '所有凭证均已正常通过'}
            </div>
          ) : (
            rightPage.items.map((view) => <PoolCard key={view.credential.id} view={view} runtime={runtime} />)
          )}
        </div>
        <CredentialPager
          label="风控与待定栏"
          page={rightPage.page}
          pages={rightPage.pages}
          total={rightFiltered.length}
          pageSize={rightPage.size}
          hideWhenSinglePage
          onPage={turnLanePage('attention')}
        />
      </section>
    </div>
  )
}
