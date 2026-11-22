import { useEffect, useMemo } from 'react'
import { useStore, type TabKey } from './store/store'
import { Overview } from './views/Overview'
import { Statistics } from './views/Statistics'
import { HistoryView } from './views/History'
import { SettingsView } from './views/Settings'
import { RunPanel } from './components/RunPanel'
import { EvidenceSheet } from './components/EvidenceSheet'
import { ConnectionPanel } from './components/ConnectionPanel'
import { ExclusionDrawer, ExclusionIcon } from './components/ExclusionDrawer'
import { Toasts } from './components/Toasts'
import { SettingsSavePrompt } from './components/SettingsSavePrompt'
import { InspectionConfirmationDialog } from './components/InspectionConfirmationDialog'
import { Icon, SelectionProvider, useSelectionSet } from './components/ui'
import { handleApplicationShortcut } from './lib/applicationShortcuts'

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
  const tasks = useStore((s) => s.tasks)
  const connection = useStore((s) => s.connection)
  const authenticated = useStore((s) => s.authenticated)
  const excludedCount = useStore((s) => s.credentials.filter((credential) => credential.inspectionExcluded).length)
  const selected = useStore((s) => s.selected)
  const toggleSelect = useStore((s) => s.toggleSelect)
  const setSelected = useStore((s) => s.selectTargets)
  const clearSelection = useStore((s) => s.clearSelection)
  const openDetail = useStore((s) => s.openDetail)
  const setRunPanel = useStore((s) => s.setRunPanel)
  const updateSettings = useStore((s) => s.updateSettings)
  useEffect(() => {
    document.documentElement.dataset.downshiftTheme = settings.theme
  }, [settings.theme])

  // Blur is a document-level flag so names stay blurred in every view and overlay.
  useEffect(() => {
    document.documentElement.dataset.maskNames = settings.maskNames ? 'true' : 'false'
  }, [settings.maskNames])

  const selectionSet = useSelectionSet(selected)
  const selectionApi = useMemo(
    () => ({
      selected,
      toggle: toggleSelect,
      set: setSelected,
      clear: clearSelection,
      has: (id: string) => selectionSet.has(id),
    }),
    [selected, toggleSelect, setSelected, clearSelection, selectionSet],
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
                ◈
              </span>
              <div className="brand-text">
                <h1>Codex 降档检测</h1>
                <p>CLIProxyAPI 凭证巡检</p>
              </div>
            </div>

            <nav className="nav" aria-label="主导航">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="nav-item"
                  aria-current={tab === item.key ? 'page' : undefined}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="topbar-actions">
              <button type="button" className={`btn btn-sm exclusion-entry exclusion-topbar-entry ${excludedCount ? 'has-excluded' : ''}`} data-exclusion-target
                onClick={() => useStore.getState().setExclusionDrawerOpen(true)} aria-label={`不参与巡检池，${excludedCount} 个凭证`}>
                <ExclusionIcon /><span className="exclusion-topbar-label">不参与巡检</span><span className="count-badge">{excludedCount}</span>
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setRunPanel(true)}
              >
                {running ? (
                  <>
                    <span
                      className="dot"
                      style={{ background: 'var(--accent)', animation: 'pulse 1.1s ease-in-out infinite' }}
                      aria-hidden="true"
                    />
                    巡检中 {finishedCount}/{running.items.length}
                  </>
                ) : (
                  <>
                    <Icon.History />
                    任务
                    {tasks.length > 0 && <span className="count-badge" style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}>{tasks.length}</span>}
                  </>
                )}
              </button>

              {connection !== 'connected' && <span className="env-badge"><i aria-hidden="true" />未连接</span>}

              <button
                type="button"
                className="icon-btn"
                onClick={() =>
                  updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
                }
                aria-label={settings.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
              >
                {settings.theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
              </button>
            </div>
          </div>
        </header>

        <main className="page">
          <ConnectionPanel />
          {tab === 'overview' && <Overview onOpenDetail={openDetail} />}
          {tab === 'statistics' && <Statistics />}
          {tab === 'history' && <HistoryView onOpenDetail={openDetail} />}
          {tab === 'settings' && <SettingsView />}
        </main>

        <RunPanel />
        <InspectionConfirmationDialog />
        <ExclusionDrawer />
        <EvidenceSheet />
        <Toasts />
        {tab === 'settings' && <SettingsSavePrompt />}
      </div>
    </SelectionProvider>
  )
}

