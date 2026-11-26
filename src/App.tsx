import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import pluginLogo from '../assets/logo.svg'
import { useStore, type TabKey } from './store/store'
import { Overview } from './views/Overview'
import { RunPanel } from './components/RunPanel'
import { ConnectionPanel } from './components/ConnectionPanel'
import { ExclusionDrawer, ExclusionIcon } from './components/ExclusionDrawer'
import { Toasts } from './components/Toasts'
import { SettingsSavePrompt } from './components/settings/SettingsSavePrompt'
import { InspectionConfirmationDialog } from './components/InspectionConfirmationDialog'
import { WeightZeroWarningDialog } from './components/WeightZeroWarningDialog'
import { HoverCard, Icon, NameMaskToggle, SelectionProvider, useSelectionSet, useSlidingIndicator } from './components/ui'
import { handleApplicationShortcut } from './lib/applicationShortcuts'
import { changedSettings } from './lib/settingsDraft'
import { isManuallyExcluded } from './lib/derive'

const loadStatistics = () => import('./views/Statistics')
const loadHistory = () => import('./views/History')
const loadSettings = () => import('./views/Settings')
const loadEvidenceSheet = () => import('./components/evidence/EvidenceSheet')
const loadPelicanLightbox = () => import('./components/pelican/PelicanLightbox')

const Statistics = lazy(() => loadStatistics().then((m) => ({ default: m.Statistics })))
const HistoryView = lazy(() => loadHistory().then((m) => ({ default: m.HistoryView })))
const SettingsView = lazy(() => loadSettings().then((m) => ({ default: m.SettingsView })))
const EvidenceSheet = lazy(() => loadEvidenceSheet().then((m) => ({ default: m.EvidenceSheet })))
const PelicanLightbox = lazy(() => loadPelicanLightbox().then((m) => ({ default: m.PelicanLightbox })))

const TAB_PRELOADERS: Partial<Record<TabKey, () => Promise<unknown>>> = {
  statistics: loadStatistics,
  history: loadHistory,
  settings: loadSettings,
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'statistics', label: '统计' },
  { key: 'history', label: '历史' },
  { key: 'settings', label: '设置' },
]

export default function App() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => handleApplicationShortcut(event, useStore.getState())
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const settings = useStore((s) => s.settings)
  const settingsDraft = useStore((s) => s.settingsDraft)
  const tasks = useStore((s) => s.tasks)
  const connection = useStore((s) => s.connection)
  const authenticated = useStore((s) => s.authenticated)
  const excludedCount = useStore((s) =>
    s.credentials.reduce((count, credential) => count + Number(isManuallyExcluded(credential)), 0),
  )
  const hasDetail = useStore((s) => Boolean(s.detail))
  const hasPelicanLightbox = useStore((s) => Boolean(s.pelicanLightbox))
  const [detailMounted, setDetailMounted] = useState(false)
  const [lightboxMounted, setLightboxMounted] = useState(false)
  useEffect(() => {
    if (hasDetail) setDetailMounted(true)
  }, [hasDetail])
  useEffect(() => {
    if (hasPelicanLightbox) setLightboxMounted(true)
  }, [hasPelicanLightbox])

  const settingsDirty = useMemo(() => changedSettings(settings, settingsDraft).length > 0, [settings, settingsDraft])
  const selected = useStore((s) => s.selected)
  const toggleSelect = useStore((s) => s.toggleSelect)
  const setSelected = useStore((s) => s.selectTargets)
  const clearSelection = useStore((s) => s.clearSelection)
  const openDetail = useStore((s) => s.openDetail)
  const setRunPanel = useStore((s) => s.setRunPanel)
  const updateSettings = useStore((s) => s.updateSettings)
  const navRef = useRef<HTMLElement>(null)
  const navPill = useSlidingIndicator(navRef, tab)
  const lastClickedIdRef = useRef<string | null>(null)

  useEffect(() => {
    document.documentElement.dataset.pluginTheme = settings.theme
  }, [settings.theme])

  // Blur is a document-level flag so names stay blurred in every view and overlay.
  useEffect(() => {
    document.documentElement.dataset.maskNames = settings.maskNames ? 'true' : 'false'
  }, [settings.maskNames])

  const handleToggleSelect = useCallback(
    (id: string, shiftKey?: boolean) => {
      if (shiftKey && lastClickedIdRef.current && lastClickedIdRef.current !== id) {
        const ordered = Array.from(
          document.querySelectorAll<HTMLElement>('[data-credential-id][data-exclusion-source="true"]'),
        )
          .map((el) => el.dataset.credentialId)
          .filter((cid): cid is string => Boolean(cid))
        const anchorIdx = ordered.indexOf(lastClickedIdRef.current)
        const targetIdx = ordered.indexOf(id)
        if (anchorIdx >= 0 && targetIdx >= 0) {
          const [from, to] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
          const rangeIds = ordered.slice(from, to + 1)
          const cur = useStore.getState().selected
          const shouldSelect = !cur.includes(id)
          if (shouldSelect) {
            setSelected([...new Set([...cur, ...rangeIds])])
          } else {
            const drop = new Set(rangeIds)
            setSelected(cur.filter((item) => !drop.has(item)))
          }
          lastClickedIdRef.current = id
          return
        }
      }
      lastClickedIdRef.current = id
      toggleSelect(id)
    },
    [toggleSelect, setSelected],
  )

  const selectionSet = useSelectionSet(selected)
  const selectionApi = useMemo(
    () => ({
      selected,
      toggle: handleToggleSelect,
      set: setSelected,
      clear: clearSelection,
      has: (id: string) => selectionSet.has(id),
    }),
    [selected, handleToggleSelect, setSelected, clearSelection, selectionSet],
  )

  // Every credential needs an evidence record for whichever model is being inspected.
  const ensureTargetsForModel = useStore((s) => s.ensureTargetsForModel)
  useEffect(() => {
    ensureTargetsForModel(settings.inspectionModel)
  }, [settings.inspectionModel, ensureTargetsForModel])

  const running = tasks.find((t) => t.status === 'running')
  const finishedCount = running
    ? running.items.filter(
        (i) =>
          i.state === 'done' || i.state === 'skipped' || i.state === 'cancelled' || i.state === 'failed',
      ).length
    : 0

  if (!authenticated) return <><ConnectionPanel /><Toasts /></>

  return (
    <SelectionProvider value={selectionApi}>
      <div className="app">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                <img src={pluginLogo} alt="" className="brand-mark-img" />
              </span>
              <h1 className="brand-title">Codex 风控检测</h1>
            </div>

            <nav
              ref={navRef}
              className="nav"
              data-sliding={navPill.ready ? 'true' : undefined}
              aria-label="主导航"
            >
              {navPill.ready && (
                <span
                  className="sliding-pill"
                  data-animate={navPill.animate ? 'true' : undefined}
                  aria-hidden="true"
                  style={
                    {
                      '--pill-x': `${navPill.x}px`,
                      '--pill-w': `${navPill.w}px`,
                    } as CSSProperties
                  }
                />
              )}
              {TABS.map((item) => (
                <HoverCard
                  key={item.key}
                  compact
                  placement="bottom"
                  disabled={item.key !== 'settings' || !settingsDirty}
                  content="有未保存的设置草稿"
                >
                  <button
                    type="button"
                    className="nav-item"
                    aria-current={tab === item.key ? 'page' : undefined}
                    onPointerEnter={() => void TAB_PRELOADERS[item.key]?.()}
                    onFocus={() => void TAB_PRELOADERS[item.key]?.()}
                    onClick={() => setTab(item.key)}
                  >
                    {item.label}
                    {item.key === 'settings' && settingsDirty && (
                      <span className="nav-dirty-dot" aria-label="有未保存的设置" />
                    )}
                  </button>
                </HoverCard>
              ))}
            </nav>

            <div className="topbar-actions">
              {connection !== 'connected' && (
                <span className="env-badge" role="status">
                  <i aria-hidden="true" />
                  未连接
                </span>
              )}

              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setRunPanel(true)}
                aria-label={running ? `巡检中 ${finishedCount}/${running.items.length}` : '打开任务抽屉'}
              >
                {running ? (
                  <>
                    <span
                      className="dot sonar-dot"
                      aria-hidden="true"
                    />
                    <span>
                      巡检中 {finishedCount}/{running.items.length}
                    </span>
                  </>
                ) : (
                  <>
                    <Icon.History />
                    <span className="topbar-btn-label">任务</span>
                    {tasks.length > 0 && <span className="count-badge">{tasks.length}</span>}
                  </>
                )}
              </button>

              <button
                type="button"
                className={`btn btn-sm exclusion-entry exclusion-topbar-entry ${excludedCount ? 'has-excluded' : ''}`}
                data-exclusion-target
                onClick={() => useStore.getState().setExclusionDrawerOpen(true)}
                aria-label={`不参与巡检池，${excludedCount} 个凭证`}
              >
                <ExclusionIcon />
                <span className="exclusion-topbar-label">排除池</span>
                <span className="count-badge">{excludedCount}</span>
              </button>

              <NameMaskToggle />

              <HoverCard
                compact
                placement="bottom"
                content={settings.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
              >
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
                  aria-label={settings.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
                >
                  {settings.theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
                </button>
              </HoverCard>
            </div>
          </div>
        </header>

        <main className="page">
          <ConnectionPanel />
          <div className="tab-stage" key={tab}>
            {tab === 'overview' && <Overview onOpenDetail={openDetail} />}
            {tab !== 'overview' && (
              <Suspense fallback={<div className="empty" style={{ padding: '48px 16px' }}>正在加载视图…</div>}>
                {tab === 'statistics' && <Statistics />}
                {tab === 'history' && <HistoryView onOpenDetail={openDetail} />}
                {tab === 'settings' && <SettingsView />}
              </Suspense>
            )}
          </div>
        </main>

        <RunPanel />
        <InspectionConfirmationDialog />
        <WeightZeroWarningDialog />
        <ExclusionDrawer />
        {(hasDetail || detailMounted) && (
          <Suspense fallback={null}>
            <EvidenceSheet />
          </Suspense>
        )}
        {(hasPelicanLightbox || lightboxMounted) && (
          <Suspense fallback={null}>
            <PelicanLightbox />
          </Suspense>
        )}
        <Toasts />
        {tab === 'settings' && <SettingsSavePrompt />}
      </div>
    </SelectionProvider>
  )
}

