import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunItemState } from '../types'
import { useStore } from '../store/store'
import {
  evaluateEligibility,
  refreshCredentialsQuota,
  resyncCredential,
  saveInspectionOptions,
  setCredentialDisabled,
  startInspection,
} from '../store/actions'
import { buildViews, isManuallyExcluded, sortViews, type CredentialView } from '../lib/derive'
import { alignCardPageSize, DEFAULT_CARD_PAGE_SIZE, useAdaptiveCardColumns } from '../lib/cardLayout'
import { CredentialGrid, CredentialList, CredentialPools, CredentialPager, credentialPage, type CredentialRuntime } from '../components/Credentials'
import { Dot, HoverCard, Icon, Select, useNow } from '../components/ui'
import { QuickConfigPopover } from '../components/QuickConfigPopover'
import type { VerdictFilter } from '../store/store'
import { activeInspectionCredentialIds, setCredentialExclusions } from '../store/exclusions'
import { ExclusionIcon } from '../components/ExclusionDrawer'
import { hasOpenDialog, isCompositionEvent, isEditingTarget, isPlainShortcut, isPrimaryShortcut } from '../lib/keyboard'

const LAYOUTS = [
  { value: 'pool', label: '双栏', icon: <Icon.Columns2 /> },
  { value: 'list', label: '列表', icon: <Icon.List /> },
  { value: 'card', label: '卡片', icon: <Icon.Grid /> },
] as const

function InspectionConcurrency({ value, disabled }: { value: number; disabled: boolean }) {
  const [draft, setDraft] = useState(String(value))
  const cancelled = useRef(false)
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (disabled || !draft.trim()) {
      setDraft(String(value))
      return
    }
    const parsed = Number(draft)
    const next = Number.isFinite(parsed) ? Math.max(1, Math.min(9, Math.trunc(parsed))) : value
    setDraft(String(next))
    void saveInspectionOptions({ concurrency: { maxObjects: next } }).then(() =>
      setDraft(String(useStore.getState().settings.concurrency.maxObjects)),
    )
  }
  return (
    <HoverCard compact placement="top" content="每批同时巡检的凭证数（1–9）">
      <label className="inspection-concurrency">
        <span>并发</span>
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min={1}
          max={9}
          step={1}
          value={draft}
          disabled={disabled}
          aria-label="最大巡检并发数"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (isCompositionEvent(event.nativeEvent)) return
            if (isPlainShortcut(event.nativeEvent, 'Enter')) {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (isPlainShortcut(event.nativeEvent, 'Escape')) {
              event.preventDefault()
              event.stopPropagation()
              cancelled.current = true
              setDraft(String(value))
              event.currentTarget.blur()
            }
          }}
        />
      </label>
    </HoverCard>
  )
}

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
  const capabilities = useStore((s) => s.capabilities)
  const settingsSaving = useStore((s) => s.settingsSaving)
  const starting = useStore((s) => s.starting)
  const startingCredentialIds = useStore((s) => s.startingCredentialIds)
  const hasSettingsDraft = useStore((s) => Boolean(s.settingsDraft))
  const hasPendingModal = useStore((s) => Boolean(s.inspectionConfirmation || s.pendingSettingsConfirmation))
  const syncing = useStore((s) => s.syncing)
  const quotaRefreshing = useStore((s) => s.quotaRefreshing)
  const excluding = useStore((s) => s.excluding)
  const togglingStatus = useStore((s) => s.togglingStatus)
  const setFilters = useStore((s) => s.setFilters)
  const selectTargets = useStore((s) => s.selectTargets)
  const clearSelection = useStore((s) => s.clearSelection)
  const updateSettings = useStore((s) => s.updateSettings)
  const setExclusionDrawerOpen = useStore((s) => s.setExclusionDrawerOpen)

  const now = useNow(30_000)
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

  const sort = filters.sort ?? (settings.layout === 'list' ? 'status' : 'recent')
  const views = useMemo(
    () => sortViews(buildViews(participating, targets, settings), sort),
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

  const runningTask = useMemo(() => tasks.find((t) => t.status === 'running') ?? null, [tasks])
  const inspectingStates = useMemo(() => {
    const map = new Map<string, RunItemState>()
    if (runningTask) {
      const targetToCred = new Map<string, string>()
      for (const view of views) {
        if (view.target) targetToCred.set(view.target.id, view.credential.id)
      }
      for (const item of runningTask.items) {
        if (!ACTIVE_ITEM_STATES.has(item.state)) continue
        const credentialId = targetToCred.get(item.targetId)
        if (credentialId) map.set(credentialId, item.state)
      }
    }
    for (const id of startingCredentialIds) {
      if (!map.has(id)) map.set(id, 'queued')
    }
    return map
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
  const cardColumns = useAdaptiveCardColumns(cardMeasureRef, settings.layout === 'card')
  const rawCardPageSize = settings.pagination?.card ?? DEFAULT_CARD_PAGE_SIZE
  const pageSize =
    settings.layout === 'list'
      ? settings.pagination?.list ?? 10
      : alignCardPageSize(rawCardPageSize, cardColumns)

  const filterResetKey = JSON.stringify([
    settings.layout,
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
      settings.layout === 'pool'
        ? poolPage.key === poolResetKey
          ? poolPage.ids
          : []
        : currentPage.items.map((view) => view.credential.id),
    [settings.layout, poolPage, poolResetKey, currentPage.items],
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
      settings,
      inspectingStates,
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
        focusSearch: () => searchRef.current?.focus(),
      })
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filteredViews, excluding, selectTargets])

  const verdictPills: { key: VerdictFilter; label: string; count: number; tone?: 'normal' | 'downshift' | 'uncertain' | 'empty' }[] = [
    { key: 'all', label: '全部', count: counts.total },
    { key: 'normal', label: '正常', count: counts.normal, tone: 'normal' },
    { key: 'downshift', label: '风控', count: counts.downshift, tone: 'downshift' },
    { key: 'uncertain', label: '不确定', count: counts.uncertain, tone: 'uncertain' },
    { key: 'untested', label: '未检测', count: counts.untested, tone: 'empty' },
  ]

  const totalForStrip = Math.max(1, counts.total)

  return (
    <>
      <section className="overview-command-bar" aria-label="巡检总览与操作">
        <div className="verdict-strip" role="group" aria-label="按凭证结论筛选">
          {verdictPills.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`verdict-pill-btn ${item.tone ? `tone-${item.tone}` : ''} ${item.key !== 'all' && item.count === 0 ? 'is-zero' : ''}`}
              aria-pressed={filters.verdict === item.key}
              onClick={() =>
                setFilters({
                  verdict: item.key === 'all' ? 'all' : filters.verdict === item.key ? 'all' : item.key,
                })
              }
            >
              {item.tone && <Dot tone={item.tone} />}
              <span>{item.label}</span>
              <b>{item.count}</b>
            </button>
          ))}
          {attentionViews.length > 0 && (
            <button
              type="button"
              className="verdict-pill-btn tone-attention"
              aria-pressed={filters.verdict === 'attention'}
              onClick={() =>
                setFilters({ verdict: filters.verdict === 'attention' ? 'all' : 'attention' })
              }
            >
              <span>需处理</span>
              <b>{attentionViews.length}</b>
            </button>
          )}
        </div>

        <div className="command-controls">
          <QuickConfigPopover disabled={optionsDisabled} />

          <div className="segmented" role="group" aria-label="巡检方式">
            <button
              type="button"
              aria-pressed={settings.inspectionMethod === 'candy'}
              disabled={optionsDisabled}
              onClick={() => void saveInspectionOptions({ inspectionMethod: 'candy' })}
            >
              糖果
            </button>
            <button
              type="button"
              aria-pressed={settings.inspectionMethod === 'fingerprint'}
              disabled={optionsDisabled || !capabilities.fingerprintAvailable}
              onClick={() => void saveInspectionOptions({ inspectionMethod: 'fingerprint' })}
            >
              指纹
            </button>
          </div>

          <InspectionConcurrency value={settings.concurrency.maxObjects} disabled={optionsDisabled} />

          <HoverCard compact placement="top" content="刷新当前页已开启凭证的剩余额度">
            <button
              type="button"
              className={`btn btn-sm quota-refresh-button${quotaRefreshing.length ? ' is-refreshing' : ''}`}
              disabled={connection !== 'connected' || Boolean(quotaRefreshing.length) || !selectableVisibleIds.length}
              aria-busy={Boolean(quotaRefreshing.length)}
              onClick={() => void refreshCredentialsQuota(selectableVisibleIds)}
            >
              <Icon.Refresh />
              <span>刷新额度</span>
            </button>
          </HoverCard>

          <button
            type="button"
            className="btn btn-sm btn-primary"
            aria-label="巡检全部"
            aria-description={`符合条件的凭证 ${eligible.length} 个`}
            disabled={
              connection !== 'connected' ||
              starting ||
              settingsSaving ||
              hasSettingsDraft ||
              excluding.length > 0 ||
              eligible.length === 0
            }
            onClick={() => startInspection('batch')}
          >
            <Icon.Play />
            <span>巡检全部</span>
            <span className="count-badge" aria-hidden="true">
              {eligible.length}
            </span>
          </button>
        </div>

        <div className="health-strip" aria-hidden="true">
          {counts.total > 0 && (
            <>
              <span className="health-strip-seg is-normal" style={{ width: `${(counts.normal / totalForStrip) * 100}%` }} />
              <span className="health-strip-seg is-downshift" style={{ width: `${(counts.downshift / totalForStrip) * 100}%` }} />
              <span className="health-strip-seg is-uncertain" style={{ width: `${(counts.uncertain / totalForStrip) * 100}%` }} />
              <span className="health-strip-seg is-untested" style={{ width: `${(counts.untested / totalForStrip) * 100}%` }} />
            </>
          )}
        </div>
      </section>

      {attentionViews.length > 0 && (
        <div className="attention-strip" role="status">
          <Icon.Alert />
          <div className="attention-strip-text">
            <strong>{attentionViews.length} 个凭证需处理</strong>
            <span className="attention-strip-detail">
              {summariseAttention(attentionViews)
                .map((line) => line.text)
                .join(' · ')}
            </span>
          </div>
          <div className="attention-strip-actions">
            {syncFailedIds.length > 0 && (
              <button
                type="button"
                className="btn btn-xs btn-danger"
                disabled={connection !== 'connected' || syncFailedIds.every((id) => syncing.includes(id))}
                onClick={() => void retryAllSync()}
              >
                <Icon.Sync />
                重试同步 ({syncFailedIds.length})
              </button>
            )}
            <button
              type="button"
              className="btn btn-xs btn-warn"
              onClick={() =>
                setFilters({ verdict: filters.verdict === 'attention' ? 'all' : 'attention' })
              }
            >
              {filters.verdict === 'attention' ? '显示全部' : '只看需处理'}
            </button>
          </div>
        </div>
      )}

      <div className="overview-toolbar">
        <div className="search">
          <Icon.Search />
          <input
            ref={searchRef}
            type="search"
            placeholder="搜索凭证名称、认证文件或模型"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            aria-label="搜索凭证或模型"
          />
          {filters.search ? (
            <button
              type="button"
              className="search-clear"
              onClick={() => setFilters({ search: '' })}
              aria-label="清除搜索"
            >
              ✕
            </button>
          ) : (
            <kbd className="search-kbd" aria-hidden="true">
              /
            </kbd>
          )}
        </div>

        <div className="toolbar-actions">
          <HoverCard compact placement="top" content="全选或取消当前可见页的可选凭证">
            <button
              type="button"
              className="btn btn-sm"
              disabled={selectableVisibleIds.length === 0}
              aria-pressed={allVisibleSelected}
              onClick={toggleSelectVisible}
            >
              <Icon.CheckAll />
              <span>{allVisibleSelected ? '取消本页' : '全选本页'}</span>
            </button>
          </HoverCard>

          {selectableDownshiftIds.length > 0 && filters.verdict !== 'downshift' && (
            <HoverCard compact placement="top" content="一键选中所有当前判定为风控的可选凭证">
              <button
                type="button"
                className="btn btn-sm"
                onClick={selectAllDownshift}
              >
                <Dot tone="downshift" />
                <span>选中风控 ({selectableDownshiftIds.length})</span>
              </button>
            </HoverCard>
          )}

          <Select
            ariaLabel="排序方式"
            value={sort}
            onChange={(next) => setFilters({ sort: next as 'status' | 'recent' | 'quota' | 'name' })}
            options={[
              { value: 'status', label: '按状态优劣' },
              { value: 'recent', label: '按最近检测' },
              { value: 'quota', label: '按剩余额度' },
              { value: 'name', label: '按名称' },
            ]}
          />

          <div className="segmented layout-switch" role="group" aria-label="布局切换">
            {LAYOUTS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={settings.layout === item.value}
                onClick={() => updateSettings({ layout: item.value })}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

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
          <div className="view-enter" key={settings.layout}>
            {settings.layout === 'pool' ? (
              <CredentialPools
                views={filteredViews}
                runtime={runtime}
                resetKey={poolResetKey}
                verdictFilter={filters.verdict}
                onResetVerdictFilter={() => setFilters({ verdict: 'all' })}
                onVisibleCredentialIdsChange={capturePoolPage}
              />
            ) : settings.layout === 'card' ? (
              <CredentialGrid views={currentPage.items} runtime={runtime} columns={cardColumns} />
            ) : (
              <CredentialList views={currentPage.items} runtime={runtime} />
            )}
            {settings.layout !== 'pool' && (
              <CredentialPager
                label={settings.layout === 'list' ? '列表' : '卡片'}
                page={currentPage.page}
                pages={currentPage.pages}
                total={currentPage.total}
                pageSize={currentPage.size}
                metaHint={settings.layout === 'card' ? `自适应 ${cardColumns} 列` : undefined}
                onPage={(page) => setPosition({ key: filterResetKey, size: pageSize, page })}
              />
            )}
          </div>
        )}
      </div>

      {participatingSelected.length > 0 && (
        <div className="selection-bar" role="region" aria-label="批量操作">
          <span className="sel-text">
            已选 <b>{participatingSelected.length}</b> 个
            <span className="selection-cross-page">跨页保留</span>
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={connection !== 'connected' || starting || excluding.length > 0}
            onClick={retestSelected}
          >
            <Icon.Play />
            巡检选中
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={connection !== 'connected' || Boolean(quotaRefreshing.length)}
            onClick={() => void refreshCredentialsQuota(participatingSelected)}
          >
            <Icon.Refresh />
            刷新额度
          </button>
          <button
            type="button"
            className="btn btn-sm btn-exclude"
            disabled={
              connection !== 'connected' ||
              starting ||
              excluding.length > 0 ||
              participatingSelected.some((id) => exclusionBusyIds.has(id))
            }
            onClick={() => void setCredentialExclusions(participatingSelected, true)}
          >
            <ExclusionIcon />
            移入排除池
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={clearSelection}>
            清除
          </button>
        </div>
      )}
    </>
  )
}

function summariseAttention(views: CredentialView[]) {
  const byKind = new Map<string, { kind: string; count: number }>()
  for (const view of views) {
    for (const item of view.attention) {
      const existing = byKind.get(item.kind)
      if (existing) existing.count += 1
      else byKind.set(item.kind, { kind: item.kind, count: 1 })
    }
  }
  const names: Record<string, string> = {
    sync: '分组待同步',
    auth: '认证失效',
    quota: '额度不足',
    availability: '暂不可用',
  }
  return [...byKind.values()].map((v) => ({
    kind: v.kind,
    text: `${v.count} 个${names[v.kind] ?? v.kind}`,
  }))
}
