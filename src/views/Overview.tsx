import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { evaluateEligibility, refreshCredentialsQuota, resyncCredential, saveInspectionOptions, startInspection } from '../store/actions'
import { buildViews, sortViews, type CredentialView } from '../lib/derive'
import { CredentialGrid, CredentialList, CredentialPools, CredentialPager, credentialPage } from '../components/Credentials'
import { Dot, Icon, NameMaskToggle, useNow } from '../components/ui'
import type { VerdictFilter } from '../store/store'
import { activeInspectionCredentialIds, setCredentialExclusions } from '../store/exclusions'
import { ExclusionIcon } from '../components/ExclusionDrawer'
import { hasOpenDialog, isCompositionEvent, isEditingTarget, isPlainShortcut, isPrimaryShortcut } from '../lib/keyboard'

const FILTER_LABEL: Record<VerdictFilter, string> = {
  all: '全部',
  normal: '正常',
  downshift: '降档',
  uncertain: '不确定',
  untested: '未检测',
  attention: '需处理',
}

const LAYOUTS = [
  { value: 'list', label: '列表' },
  { value: 'card', label: '卡片' },
  { value: 'pool', label: '三栏' },
] as const

function InspectionConcurrency({ value, disabled }: { value: number; disabled: boolean }) {
  const [draft, setDraft] = useState(String(value))
  const cancelled = useRef(false)
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return }
    if (disabled || !draft.trim()) { setDraft(String(value)); return }
    const parsed = Number(draft)
    const next = Number.isFinite(parsed) ? Math.max(1, Math.min(9, Math.trunc(parsed))) : value
    setDraft(String(next))
    void saveInspectionOptions({ concurrency: { maxObjects: next } }).then(() => setDraft(String(useStore.getState().settings.concurrency.maxObjects)))
  }
  return <label className="inspection-concurrency"><span>最大并发</span>
    <input className="input" type="number" inputMode="numeric" min={1} max={9} step={1} value={draft}
      disabled={disabled} aria-label="最大巡检并发数" onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => {
        if (isCompositionEvent(event.nativeEvent)) return
        if (isPlainShortcut(event.nativeEvent, 'Enter')) { event.preventDefault(); event.currentTarget.blur() }
        if (isPlainShortcut(event.nativeEvent, 'Escape')) {
          event.preventDefault(); event.stopPropagation(); cancelled.current = true
          setDraft(String(value)); event.currentTarget.blur()
        }
      }} />
  </label>
}

export function handleOverviewShortcut(event: KeyboardEvent, context: {
  views: CredentialView[]
  excluding: string[]
  select: (ids: string[]) => void
  focusSearch: () => void
}): boolean {
  if (hasOpenDialog() || isEditingTarget(event.target) || isCompositionEvent(event)) return false
  if (isPrimaryShortcut(event, 'a')) {
    event.preventDefault()
    const excluding = new Set(context.excluding)
    context.select(context.views.filter((view) => !view.credential.inspectionExcluded && !excluding.has(view.credential.id))
      .map((view) => view.credential.id))
    return true
  }
  if (isPlainShortcut(event, '/')) {
    event.preventDefault()
    context.focusSearch()
    return true
  }
  return false
}

export function Overview({ onOpenDetail }: { onOpenDetail: (targetId: string, roundId?: string | null) => void }) {
  const state = useStore()
  const now = useNow(30_000)
  const { settings, targets, credentials, filters, selected } = state
  const participating = useMemo(() => credentials.filter((credential) =>
    !credential.disabled && (!credential.inspectionExcluded || state.excluding.includes(credential.id))
  ), [credentials, state.excluding])
  const excludedCount = credentials.filter((credential) => credential.inspectionExcluded).length
  const participatingSelected = selected.filter((id) => participating.some((credential) => credential.id === id))

  const sort = filters.sort ?? (settings.layout === 'list' ? 'status' : 'recent')
  const views = useMemo(
    () => sortViews(buildViews(participating, targets, settings), sort),
    [participating, targets, settings, sort],
  )

  const counts = useMemo(() => {
    const c = { normal: 0, downshift: 0, uncertain: 0, untested: 0, total: views.length }
    for (const v of views) c[v.verdict] += 1
    return c
  }, [views])

  const attentionViews = useMemo(() => views.filter((v) => v.attention.length > 0), [views])

  const eligible = useMemo(
    () =>
      views.filter(
        (v) => v.target && evaluateEligibility(v.target, settings).runnable,
      ),
    [views, settings],
  )

  const runningTask = state.tasks.find((t) => t.status === 'running') ?? null
  const activeCredentialIds = useMemo(() => {
    if (!runningTask) return []
    const running = new Set(
      runningTask.items
        .filter((i) => i.state === 'queued' || i.state === 'running' || i.state === 'retrying' || i.state === 'waiting')
        .map((i) => i.targetId),
    )
    return views.filter((v) => v.target && running.has(v.target.id)).map((v) => v.credential.id)
  }, [runningTask, views])
  const exclusionBusyCredentialIds = useMemo(() => activeInspectionCredentialIds(state), [state.tasks, state.targets])

  const query = filters.search.trim().toLowerCase()

  const filteredViews = useMemo(() => {
    return views.filter((view) => {
      if (query) {
        const hay = [
          view.credential.name,
          view.credential.file,
          view.credential.plan,
          ...view.credential.models,
          view.reason ?? '',
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(query)) return false
      }
      if (filters.verdict === 'all') return true
      if (filters.verdict === 'attention') return view.attention.length > 0
      return view.verdict === filters.verdict
    })
  }, [views, filters, query])

  const pageSize = settings.layout === 'list' ? settings.pagination?.list ?? 10 : settings.pagination?.card ?? 8
  const paginationKey = JSON.stringify([settings.layout, pageSize, filters.search, filters.verdict, filters.sort, settings.inspectionModel])
  const [position, setPosition] = useState({ key: paginationKey, page: 0 })
  const currentPage = credentialPage(filteredViews, position.key === paginationKey ? position.page : 0, pageSize)
  const poolResetKey = JSON.stringify([filters.search, filters.verdict, filters.sort, settings.inspectionModel, settings.pagination?.pool])
  const [poolPage, setPoolPage] = useState<{ key: string; ids: string[] }>({ key: poolResetKey, ids: [] })
  const capturePoolPage = useCallback((ids: string[]) => setPoolPage({ key: poolResetKey, ids }), [poolResetKey])
  const visibleQuotaIds = settings.layout === 'pool' ? (poolPage.key === poolResetKey ? poolPage.ids : []) : currentPage.items.map((view) => view.credential.id)
  const optionsDisabled = state.connection !== 'connected' || state.settingsSaving || state.starting
    || Boolean(runningTask || state.settingsDraft || state.inspectionConfirmation || state.pendingSettingsConfirmation)
  useEffect(() => {
    if (position.key !== paginationKey || position.page !== currentPage.page) setPosition({ key: paginationKey, page: currentPage.page })
  }, [paginationKey, position.key, position.page, currentPage.page])

  const retestCredential = (credentialId: string) => {
    const view = views.find((v) => v.credential.id === credentialId)
    if (!view?.target) return
    startInspection('manual', [view.target.id])
  }

  const retestSelected = () => {
    const ids = participatingSelected
      .map((credentialId) => views.find((v) => v.credential.id === credentialId)?.target?.id)
      .filter((id): id is string => Boolean(id))
    if (ids.length > 0) startInspection('manual', ids)
  }

  const resync = (credentialId: string) => {
    void resyncCredential(credentialId)
  }

  const runtime = {
    canInspect: state.connection === 'connected' && !state.starting && !state.excluding.length,
    canChangeParticipation: state.connection === 'connected' && !state.starting,
    settings,
    activeCredentialIds,
    now,
    onRetest: retestCredential,
    onOpenDetail,
    onResync: resync,
    onExclude: (id: string) => { void setCredentialExclusions([id], true) },
    exclusionBusyCredentialIds,
  }

  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => handleOverviewShortcut(event, {
      views: filteredViews,
      excluding: state.excluding,
      select: state.selectTargets,
      focusSearch: () => searchRef.current?.focus(),
    })
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filteredViews, state.excluding, state.selectTargets])

  return (
    <>
      <div className="page-head overview-head">
        <h2>凭证与模型</h2>
        <div className="overview-summary">
          <span>参与凭证数：{credentials.length - excludedCount}</span>
          <span>不参与数：{excludedCount}</span>
          <span>模型：{settings.inspectionModel}</span>
          <span>当前分组模式：{settings.routing.mode === 'prefix' ? '前缀分组' : '优先级分组'}</span>
        </div>
        <div className="head-actions">
          <button type="button" className={`btn quota-refresh-button${state.quotaRefreshing.length ? ' is-refreshing' : ''}`}
            disabled={state.connection !== 'connected' || Boolean(state.quotaRefreshing.length) || !visibleQuotaIds.length}
            aria-busy={Boolean(state.quotaRefreshing.length)}
            onClick={() => void refreshCredentialsQuota(visibleQuotaIds)}>
            <Icon.Refresh />
            刷新额度
          </button>
          <button
            type="button"
            className="btn btn-primary"
            aria-label="巡检全部"
            aria-description={`符合条件的凭证 ${eligible.length} 个`}
            disabled={state.connection !== 'connected' || state.starting || state.settingsSaving || Boolean(state.settingsDraft) || state.excluding.length > 0 || eligible.length === 0}
            onClick={() => startInspection('batch')}
          >
            <Icon.Play />
            巡检全部
            <span className="count-badge" aria-hidden="true">{eligible.length}</span>
          </button>
        </div>
      </div>

      <div className="stat-caption">
        <span>按凭证汇总</span>
        <span className="stat-caption-hint">
          一个账号降档即全部模型降档，因此结论只按凭证计算
        </span>
      </div>
      <div className="stat-grid" role="group" aria-label="按凭证结论筛选">
        {(
          [
            { key: 'normal', label: '正常', value: counts.normal, tone: 'normal', foot: '检测完整通过' },
            { key: 'downshift', label: '降档', value: counts.downshift, tone: 'downshift', foot: '答案不符 / 指纹异常 / 频繁服务错误' },
            { key: 'uncertain', label: '不确定', value: counts.uncertain, tone: 'uncertain', foot: '证据不足或待确认' },
            { key: 'untested', label: '未检测', value: counts.untested, tone: 'empty', foot: '还没有可用的记录' },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            className={`stat ${item.value === 0 ? 'is-empty' : ''}`}
            aria-pressed={filters.verdict === item.key}
            onClick={() => state.setFilters({ verdict: filters.verdict === item.key ? 'all' : item.key })}
          >
            <span className="stat-top">
              <Dot tone={item.tone} />
              {item.label}
            </span>
            <div className="stat-value">{item.value}</div>
            <div className="stat-foot">{item.foot}</div>
          </button>
        ))}
      </div>

      {attentionViews.length > 0 && (
        <div className="attention" role="status">
          <span style={{ marginTop: 1 }}>
            <Icon.Alert />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{attentionViews.length} 个凭证需要处理</strong>
            <div className="att-list">
              {summariseAttention(attentionViews).map((line) => (
                <span className="att-item" key={line.kind}>
                  <span className="dot dot-warn" aria-hidden="true" />
                  {line.text}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'transparent', borderColor: 'var(--warn-border)', color: 'var(--warn)' }}
            onClick={() => state.setFilters({ verdict: 'attention' })}
          >
            只看需处理
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="segmented inspection-method-switch" role="group" aria-label="巡检方式">
          <button type="button" aria-pressed={settings.inspectionMethod === 'candy'} disabled={optionsDisabled}
            onClick={() => void saveInspectionOptions({ inspectionMethod: 'candy' })}>糖果</button>
          <button type="button" aria-pressed={settings.inspectionMethod === 'fingerprint'} disabled={optionsDisabled || !state.capabilities.fingerprintAvailable}
            onClick={() => void saveInspectionOptions({ inspectionMethod: 'fingerprint' })}>指纹</button>
        </div>
        <InspectionConcurrency value={settings.concurrency.maxObjects} disabled={optionsDisabled} />
        <div className="search">
          <Icon.Search />
          <input
            ref={searchRef}
            type="search"
            placeholder="搜索凭证、认证文件或模型"
            value={filters.search}
            onChange={(e) => state.setFilters({ search: e.target.value })}
            aria-label="搜索凭证或模型"
          />
        </div>
        {filters.verdict !== 'all' && (
          <span className="filter-chip">
            筛选：{FILTER_LABEL[filters.verdict]}
            <span className="filter-count">
              {filters.verdict === 'attention' ? attentionViews.length : counts[filters.verdict]}
            </span>
            <button type="button" onClick={() => state.setFilters({ verdict: 'all' })} aria-label="清除结论筛选">
              ✕
            </button>
          </span>
        )}
        <select
          className="select"
          value={sort}
          onChange={(e) => state.setFilters({ sort: e.target.value as 'status' | 'recent' | 'quota' | 'name' })}
          aria-label="排序方式"
        >
          <option value="status">按状态优劣</option>
          <option value="recent">按最近检测</option>
          <option value="quota">按剩余额度</option>
          <option value="name">按名称</option>
        </select>
        <NameMaskToggle />
        <div className="segmented layout-switch" role="group" aria-label="布局">
          {LAYOUTS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={settings.layout === item.value}
              onClick={() => state.updateSettings({ layout: item.value })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {filteredViews.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon.Search />
          </div>
          <h3>{!participating.length && excludedCount ? '所有凭证均不参与巡检' : '没有符合条件的凭证'}</h3>
          <p>
            {filters.search || filters.verdict !== 'all'
              ? '试试清除搜索词或切换筛选条件。'
              : !participating.length && excludedCount ? '可在右侧不参与巡检池中恢复参与，原分类和配置会保留。' : state.connection === 'connected' ? 'CPA 当前没有 Codex 凭证。请先在 CPA 管理面板添加 Codex 凭证。' : '连接 CPA 后即可读取真实凭证。'}
          </p>
          {(filters.search || filters.verdict !== 'all') && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => state.setFilters({ search: '', verdict: 'all' })}
              >
                清除筛选
              </button>
            </div>
          )}
          {!participating.length && excludedCount > 0 && <button type="button" className="btn btn-sm" onClick={() => state.setExclusionDrawerOpen(true)} style={{ marginTop: 12 }}>打开不参与巡检池</button>}
        </div>
      ) : (
        <div className="view-enter" key={settings.layout}>
          {settings.layout === 'pool' ? (
            <CredentialPools views={filteredViews} runtime={runtime} resetKey={poolResetKey} onVisibleCredentialIdsChange={capturePoolPage} />
          ) : settings.layout === 'card' ? (
            <CredentialGrid views={currentPage.items} runtime={runtime} />
          ) : (
            <CredentialList views={currentPage.items} runtime={runtime} />
          )}
          {settings.layout !== 'pool' && <CredentialPager label={settings.layout === 'list' ? '列表' : '卡片'} page={currentPage.page} pages={currentPage.pages} total={currentPage.total} pageSize={currentPage.size} onPage={(page) => setPosition({ key: paginationKey, page })} />}
        </div>
      )}

      {participatingSelected.length > 0 && (
        <div className="selection-bar" role="region" aria-label="批量操作">
          <span className="sel-text">
            已选择 <b>{participatingSelected.length}</b> 个凭证<span className="selection-cross-page">跨页选择保留，操作包含全部已选凭证</span>
          </span>
          <button type="button" className="btn btn-primary btn-sm" disabled={state.connection !== 'connected' || state.starting || state.excluding.length > 0} onClick={retestSelected}>
            <Icon.Play />
            巡检选中
          </button>
          <button type="button" className="btn btn-sm btn-exclude" disabled={state.connection !== 'connected' || state.starting || state.excluding.length > 0 || participatingSelected.some((id) => exclusionBusyCredentialIds.includes(id))} onClick={() => void setCredentialExclusions(participatingSelected, true)}>
            <ExclusionIcon />移入不参与巡检
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => state.clearSelection()}>
            清除
          </button>
        </div>
      )}

    </>
  )
}

function summariseAttention(views: CredentialView[]) {
  const byKind = new Map<string, { kind: string; count: number; sample: string }>()
  for (const view of views) {
    for (const item of view.attention) {
      const existing = byKind.get(item.kind)
      if (existing) existing.count += 1
      else byKind.set(item.kind, { kind: item.kind, count: 1, sample: view.credential.name })
    }
  }
  const names: Record<string, string> = { sync: '分组待同步', auth: '认证失效', quota: '额度不足' }
  return [...byKind.values()].map((v) => ({
    kind: v.kind,
    text: `${v.count} 个${names[v.kind] ?? v.kind}（如 ${v.sample}）`,
  }))
}

