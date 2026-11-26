import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunItemState } from '../types'
import { useStore } from '../store/store'
import {
  evaluateEligibility,
  resyncCredential,
  setCredentialDisabled,
  startInspection,
} from '../store/actions'
import { buildViews, isManuallyExcluded, sortViews, type CredentialView } from '../lib/derive'
import {
  alignCardPageSize,
  CARD_GRID_GAP,
  CARD_MIN_WIDTH,
  DEFAULT_CARD_PAGE_SIZE,
  PELICAN_CARD_GAP,
  PELICAN_CARD_MIN_WIDTH,
  useAdaptiveCardColumns,
} from '../lib/cardLayout'
import {
  CredentialGrid,
  CredentialList,
  CredentialPools,
  PelicanAlbumGrid,
  CredentialPager,
  credentialPage,
  type CredentialRuntime,
} from '../components/Credentials'
import { Icon, useNow } from '../components/ui'
import { OverviewCommandBar } from '../components/overview/OverviewCommandBar'
import { OverviewToolbar } from '../components/overview/OverviewToolbar'
import { SelectionActionBar } from '../components/overview/SelectionActionBar'
import { activeInspectionCredentialIds, setCredentialExclusions } from '../store/exclusions'
import { hasOpenDialog, isCompositionEvent, isEditingTarget, isPlainShortcut, isPrimaryShortcut } from '../lib/keyboard'

export function handleOverviewShortcut(
  event: KeyboardEvent,
  context: {
    views: CredentialView[]
    excluding: string[]
    select: (ids: string[]) => void
    focusSearch: () => void
  },
): boolean {
  if (hasOpenDialog() || isEditingTarget(event.target) || isCompositionEvent(event)) return false
  if (isPrimaryShortcut(event, 'a')) {
    event.preventDefault()
    const excluding = new Set(context.excluding)
    context.select(
      context.views
        .filter((view) => !view.credential.disabled && !isManuallyExcluded(view.credential) && !excluding.has(view.credential.id))
        .map((view) => view.credential.id),
    )
    return true
  }
  if (isPlainShortcut(event, '/')) {
    event.preventDefault()
    context.focusSearch()
    return true
  }
  return false
}

const ACTIVE_ITEM_STATES = new Set<RunItemState>(['queued', 'waiting', 'running', 'retrying'])

function matchesSearch(view: CredentialView, query: string): boolean {
  const { credential, reason } = view
  if (credential.name.toLowerCase().includes(query)) return true
  if (credential.file.toLowerCase().includes(query)) return true
  if (credential.plan.toLowerCase().includes(query)) return true
  if (reason && reason.toLowerCase().includes(query)) return true
  return credential.models.some((model) => model.toLowerCase().includes(query))
}

export function Overview({ onOpenDetail }: { onOpenDetail: (targetId: string, roundId?: string | null) => void }) {
  const settings = useStore((s) => s.settings)
  const targets = useStore((s) => s.targets)
  const credentials = useStore((s) => s.credentials)
  const filters = useStore((s) => s.filters)
  const selected = useStore((s) => s.selected)
  const tasks = useStore((s) => s.tasks)
  const connection = useStore((s) => s.connection)
  const settingsSaving = useStore((s) => s.settingsSaving)
  const starting = useStore((s) => s.starting)
  const startingCredentialIds = useStore((s) => s.startingCredentialIds)
  const hasSettingsDraft = useStore((s) => Boolean(s.settingsDraft))
  const hasPendingModal = useStore((s) => Boolean(s.inspectionConfirmation || s.pendingSettingsConfirmation))
  const quotaRefreshing = useStore((s) => s.quotaRefreshing)
  const excluding = useStore((s) => s.excluding)
  const togglingStatus = useStore((s) => s.togglingStatus)
  const setFilters = useStore((s) => s.setFilters)
  const selectTargets = useStore((s) => s.selectTargets)
  const setExclusionDrawerOpen = useStore((s) => s.setExclusionDrawerOpen)

  const runningTask = useMemo(() => tasks.find((t) => t.status === 'running') ?? null, [tasks])
  const now = useNow(runningTask ? 1_000 : 30_000)
  const excludingIds = useMemo(() => new Set(excluding), [excluding])
  const togglingStatusIds = useMemo(() => new Set(togglingStatus), [togglingStatus])
  const quotaRefreshingIds = useMemo(() => new Set(quotaRefreshing), [quotaRefreshing])

  const participating = useMemo(
    () => credentials.filter((credential) => !isManuallyExcluded(credential) || excludingIds.has(credential.id)),
    [credentials, excludingIds],
  )
  const excludedCount = useMemo(
    () => credentials.reduce((count, credential) => count + Number(isManuallyExcluded(credential)), 0),
    [credentials],
  )
  const selectableIdSet = useMemo(() => {
    const ids = new Set<string>()
    for (const credential of participating) {
      if (!credential.disabled) ids.add(credential.id)
    }
    return ids
  }, [participating])
  const participatingSelected = useMemo(
    () => selected.filter((id) => selectableIdSet.has(id)),
    [selected, selectableIdSet],
  )

  const isPelicanMode = settings.inspectionMethod === 'pelican'
  const effectiveLayout = isPelicanMode ? 'pelican' : settings.layout
  const sort = isPelicanMode
    ? filters.sort ?? 'pelican'
    : filters.sort && filters.sort !== 'pelican'
      ? filters.sort
      : effectiveLayout === 'list'
        ? 'status'
        : 'recent'
  const views = useMemo(
    () => sortViews(buildViews(participating, targets, settings), sort, settings),
    [participating, targets, settings, sort],
  )
  const viewByCredId = useMemo(
    () => new Map(views.map((view) => [view.credential.id, view])),
    [views],
  )

  const counts = useMemo(() => {
    const c = { normal: 0, downshift: 0, uncertain: 0, untested: 0, total: views.length }
    for (const v of views) c[v.verdict] += 1
    return c
  }, [views])

  const attentionViews = useMemo(() => views.filter((v) => v.attention.length > 0), [views])
  const syncFailedIds = useMemo(
    () =>
      attentionViews
        .filter((v) => v.attention.some((item) => item.kind === 'sync'))
        .map((v) => v.credential.id),
    [attentionViews],
  )

  const busySets = useMemo(
    () => ({ togglingStatus: togglingStatusIds, excluding: excludingIds }),
    [togglingStatusIds, excludingIds],
  )
  const eligible = useMemo(
    () => views.filter((v) => v.target && evaluateEligibility(v.target, settings, v.credential, busySets).runnable),
    [views, settings, busySets],
  )

  const { inspectingStates, inspectingStartedAt } = useMemo(() => {
    const states = new Map<string, RunItemState>()
    const started = new Map<string, number>()
    if (runningTask) {
      const targetToCred = new Map<string, string>()
      for (const view of views) {
        if (view.target) targetToCred.set(view.target.id, view.credential.id)
      }
      for (const item of runningTask.items) {
        if (!ACTIVE_ITEM_STATES.has(item.state)) continue
        const credentialId = targetToCred.get(item.targetId)
        if (credentialId) {
          states.set(credentialId, item.state)
          if (item.startedAt) {
            const ms = Date.parse(item.startedAt)
            if (Number.isFinite(ms)) started.set(credentialId, ms)
          }
        }
      }
    }
    for (const id of startingCredentialIds) {
      if (!states.has(id)) states.set(id, 'queued')
    }
    return { inspectingStates: states, inspectingStartedAt: started }
  }, [runningTask, views, startingCredentialIds])

  const exclusionBusyIds = useMemo(
    () => new Set(activeInspectionCredentialIds({ tasks, targets })),
    [tasks, targets],
  )

  const query = filters.search.trim().toLowerCase()
  const filteredViews = useMemo(() => {
    return views.filter((view) => {
      if (query && !matchesSearch(view, query)) return false
      if (filters.verdict === 'all') return true
      if (filters.verdict === 'attention') return view.attention.length > 0
      return view.verdict === filters.verdict
    })
  }, [views, filters.verdict, query])

  const cardMeasureRef = useRef<HTMLDivElement>(null)
  const cardColumns = useAdaptiveCardColumns(
    cardMeasureRef,
    effectiveLayout === 'card' || isPelicanMode,
    isPelicanMode ? PELICAN_CARD_MIN_WIDTH : CARD_MIN_WIDTH,
    isPelicanMode ? PELICAN_CARD_GAP : CARD_GRID_GAP,
  )
  const rawCardPageSize = settings.pagination?.card ?? DEFAULT_CARD_PAGE_SIZE
  const pageSize =
    effectiveLayout === 'list'
      ? settings.pagination?.list ?? 10
      : alignCardPageSize(rawCardPageSize, cardColumns)

  const filterResetKey = JSON.stringify([
    effectiveLayout,
    rawCardPageSize,
    filters.search,
    filters.verdict,
    filters.sort,
    settings.inspectionModel,
  ])
  const [position, setPosition] = useState({ key: filterResetKey, size: pageSize, page: 0 })
  const resolvedPage =
    position.key !== filterResetKey
      ? 0
      : position.size !== pageSize
        ? Math.floor((position.page * position.size) / pageSize)
        : position.page
  const currentPage = credentialPage(filteredViews, resolvedPage, pageSize)

  const poolResetKey = JSON.stringify([
    filters.search,
    filters.verdict,
    filters.sort,
    settings.inspectionModel,
    settings.pagination?.pool,
  ])
  const [poolPage, setPoolPage] = useState<{ key: string; ids: string[] }>({ key: poolResetKey, ids: [] })
  const capturePoolPage = useCallback((ids: string[]) => setPoolPage({ key: poolResetKey, ids }), [poolResetKey])
  const visibleQuotaIds = useMemo(
    () =>
      effectiveLayout === 'pool'
        ? poolPage.key === poolResetKey
          ? poolPage.ids
          : []
        : currentPage.items.map((view) => view.credential.id),
    [effectiveLayout, poolPage, poolResetKey, currentPage.items],
  )
  const selectableVisibleIds = useMemo(
    () => visibleQuotaIds.filter((id) => selectableIdSet.has(id)),
    [visibleQuotaIds, selectableIdSet],
  )
  const selectableDownshiftIds = useMemo(
    () => views.filter((v) => v.verdict === 'downshift' && !v.credential.disabled).map((v) => v.credential.id),
    [views],
  )
  const optionsDisabled =
    connection !== 'connected' ||
    settingsSaving ||
    starting ||
    Boolean(runningTask || hasSettingsDraft || hasPendingModal)

  useEffect(() => {
    if (position.key !== filterResetKey || position.size !== pageSize || position.page !== currentPage.page) {
      setPosition({ key: filterResetKey, size: pageSize, page: currentPage.page })
    }
  }, [filterResetKey, pageSize, position.key, position.size, position.page, currentPage.page])

  const retestSelected = () => {
    const ids = participatingSelected
      .map((credentialId) => viewByCredId.get(credentialId)?.target?.id)
      .filter((id): id is string => Boolean(id))
    if (ids.length > 0) startInspection('manual', ids)
  }

  const retryAllSync = async () => {
    for (const id of syncFailedIds) {
      await resyncCredential(id)
    }
  }

  const toggleSelectVisible = () => {
    if (!selectableVisibleIds.length) return
    const selectedSet = new Set(selected)
    const allVisibleSelected = selectableVisibleIds.every((id) => selectedSet.has(id))
    if (allVisibleSelected) {
      const drop = new Set(selectableVisibleIds)
      selectTargets(selected.filter((id) => !drop.has(id)))
    } else {
      selectTargets([...new Set([...selected, ...selectableVisibleIds])])
    }
  }

  const selectAllDownshift = () => {
    if (selectableDownshiftIds.length > 0) selectTargets([...new Set([...selected, ...selectableDownshiftIds])])
  }

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const allVisibleSelected =
    selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selectedSet.has(id))

  const handleToggleDisabled = useCallback((id: string, disabled: boolean) => {
    void setCredentialDisabled(id, disabled)
  }, [])

  const handleExclude = useCallback((id: string) => {
    void setCredentialExclusions([id], true)
  }, [])

  const runtime = useMemo<CredentialRuntime>(
    () => ({
      canChangeParticipation: connection === 'connected' && !starting,
      connected: connection === 'connected',
      starting,
      settings,
      inspectingStates,
      inspectingStartedAt,
      quotaRefreshingIds,
      togglingStatusIds,
      excludingIds,
      exclusionBusyIds,
      now,
      onOpenDetail,
      onToggleDisabled: handleToggleDisabled,
      onExclude: handleExclude,
    }),
    [
      connection,
      starting,
      settings,
      inspectingStates,
      inspectingStartedAt,
      quotaRefreshingIds,
      togglingStatusIds,
      excludingIds,
      exclusionBusyIds,
      now,
      onOpenDetail,
      handleToggleDisabled,
      handleExclude,
    ],
  )

  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) =>
      handleOverviewShortcut(event, {
        views: filteredViews,
        excluding,
        select: selectTargets,
        focusSearch: () => window.setTimeout(() => searchRef.current?.focus(), 0),
      })
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filteredViews, excluding, selectTargets])

  return (
    <>
      <OverviewCommandBar
        counts={counts}
        attentionViews={attentionViews}
        syncFailedIds={syncFailedIds}
        eligibleCount={eligible.length}
        selectableVisibleIds={selectableVisibleIds}
        optionsDisabled={optionsDisabled}
        isPelicanMode={isPelicanMode}
        onRetryAllSync={() => void retryAllSync()}
      />

      <OverviewToolbar
        searchRef={searchRef}
        sort={sort}
        isPelicanMode={isPelicanMode}
        filteredCount={filteredViews.length}
        totalCount={views.length}
        selectableVisibleCount={selectableVisibleIds.length}
        allVisibleSelected={allVisibleSelected}
        selectableDownshiftCount={selectableDownshiftIds.length}
        onToggleSelectVisible={toggleSelectVisible}
        onSelectAllDownshift={selectAllDownshift}
      />

      <div ref={cardMeasureRef}>
        {filteredViews.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <Icon.Search />
            </div>
            <h3>{!participating.length && excludedCount ? '所有凭证均不参与巡检' : '没有符合条件的凭证'}</h3>
            <p>
              {filters.search || filters.verdict !== 'all'
                ? '试试清除搜索词或切换筛选条件。'
                : !participating.length && excludedCount
                  ? '可在右上角排除池中恢复参与，原分类和配置会保留。'
                  : connection === 'connected'
                    ? 'CPA 当前没有 Codex 凭证。请先在 CPA 管理面板添加 Codex 凭证。'
                    : '连接 CPA 后即可读取真实凭证。'}
            </p>
            {(filters.search || filters.verdict !== 'all') && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setFilters({ search: '', verdict: 'all' })}
                >
                  清除筛选
                </button>
              </div>
            )}
            {!participating.length && excludedCount > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setExclusionDrawerOpen(true)}
                style={{ marginTop: 12 }}
              >
                打开排除池
              </button>
            )}
          </div>
        ) : (
          <div className="view-enter" key={effectiveLayout}>
            {effectiveLayout === 'pelican' ? (
              <PelicanAlbumGrid views={currentPage.items} runtime={runtime} columns={cardColumns} />
            ) : effectiveLayout === 'pool' ? (
              <CredentialPools
                views={filteredViews}
                runtime={runtime}
                resetKey={poolResetKey}
                verdictFilter={filters.verdict}
                onResetVerdictFilter={() => setFilters({ verdict: 'all' })}
                onVisibleCredentialIdsChange={capturePoolPage}
              />
            ) : effectiveLayout === 'card' ? (
              <CredentialGrid views={currentPage.items} runtime={runtime} columns={cardColumns} />
            ) : (
              <CredentialList views={currentPage.items} runtime={runtime} />
            )}
            {effectiveLayout !== 'pool' && (
              <CredentialPager
                label={effectiveLayout === 'list' ? '列表' : effectiveLayout === 'pelican' ? 'SVG 相册' : '卡片'}
                page={currentPage.page}
                pages={currentPage.pages}
                total={currentPage.total}
                pageSize={currentPage.size}
                metaHint={
                  effectiveLayout === 'pelican'
                    ? `相册自适应 ${cardColumns} 列`
                    : effectiveLayout === 'card'
                      ? `自适应 ${cardColumns} 列`
                      : undefined
                }
                onPage={(page) => setPosition({ key: filterResetKey, size: pageSize, page })}
              />
            )}
          </div>
        )}
      </div>

      <SelectionActionBar
        selectedIds={participatingSelected}
        isPelicanMode={isPelicanMode}
        exclusionBusyIds={exclusionBusyIds}
        onRetestSelected={retestSelected}
      />
    </>
  )
}
