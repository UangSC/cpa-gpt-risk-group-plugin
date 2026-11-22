import { create } from 'zustand'
import type { Credential, InspectionTask, Settings, Target, Toast, InspectionConfirmation } from '../types'
import { backend, EMPTY_CAPABILITIES, type Capabilities, type Snapshot, type RequestHeaderProfile } from '../api'
import { DEFAULT_SETTINGS } from '../data/defaults'
import { isManuallyExcluded } from '../lib/derive'
import { normalizeRouting } from '../lib/routing'
import { changedSettings, mergeSettingsDraft, rebaseSettingsDraft, settingsErrors } from '../lib/settingsDraft'
import { APIError } from '../api/plugin'
import { needsScheduledConsent, sameInspectionRisk } from '../lib/inspectionConsent'

export type VerdictFilter = 'all' | 'normal' | 'downshift' | 'uncertain' | 'untested' | 'attention'
export type SortKey = 'status' | 'recent' | 'quota' | 'name'
export type TabKey = 'overview' | 'statistics' | 'history' | 'settings'
export interface Filters { search: string; verdict: VerdictFilter; sort: SortKey | null }
type ConnectionState = 'connecting' | 'connected' | 'error' | 'stopped'

interface AppState {
  credentials: Credential[]
  targets: Target[]
  settings: Settings
  settingsDraft: Settings | null
  settingsSaving: boolean
  pendingTab: TabKey | null
  tasks: InspectionTask[]
  capabilities: Capabilities
  connection: ConnectionState
  connectionError: string
  authenticated: boolean
  lastUpdatedAt: string | null
  selected: string[]
  filters: Filters
  toasts: Toast[]
  tab: TabKey
  sourceDetail: string
  detail: { targetId: string; roundId: string | null } | null
  runPanelOpen: boolean
  syncing: string[]
  quotaRefreshing: string[]
  starting: boolean
  startingCredentialIds: string[]
  mutationVersion: number
  configChangesRevision: string
  exclusionDrawerOpen: boolean
  excluding: string[]
  togglingStatus: string[]
  inspectionConfirmation: InspectionConfirmation | null
  inspectionConfirmError: string
  pendingSettingsConfirmation: Settings | null
  settingsConfirmError: string
  pendingWeightZero: { credentialId: string; credentialName: string } | null
  requestHeaderProfile?: RequestHeaderProfile
  setTab: (tab: TabKey) => void
  hydrate: (snapshot: Snapshot) => void
  setFilters: (patch: Partial<Filters>) => void
  toggleSelect: (id: string) => void
  selectTargets: (ids: string[]) => void
  clearSelection: () => void
  updateSettings: (patch: Partial<Settings>) => void
  editSettingsDraft: (patch: Partial<Settings>) => void
  saveSettingsDraft: (acknowledgeScheduledConfigChanges?: boolean) => Promise<boolean>
  discardSettingsDraft: () => void
  cancelSettingsNavigation: () => void
  ensureTargetsForModel: (model: string) => void
  openDetail: (targetId: string, roundId?: string | null) => void
  closeDetail: () => void
  setRunPanel: (open: boolean) => void
  dismissToast: (id: string) => void
  notify: (toast: Omit<Toast, 'id'>) => void
  setExclusionDrawerOpen: (open: boolean) => void
  closeInspectionConfirmation: () => void
  closeSettingsConfirmation: () => void
  requestWeightZeroWarning: (target: { credentialId: string; credentialName: string }) => void
  closeWeightZeroWarning: () => void
}

const PREFERENCES_KEY = 'cpa-gpt-risk-group:preferences:v1'
type Preferences = Pick<Settings, 'theme' | 'layout' | 'maskNames'>
function preferences(): Partial<Preferences> {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY)
      ?? localStorage.getItem('cpa-downshift:preferences:v1')
      ?? localStorage.getItem('cpa-downshift:settings:v2')
      ?? '{}'
    const saved = JSON.parse(raw) as Partial<Preferences>
    return {
      ...(saved.theme === 'dark' || saved.theme === 'light' ? { theme: saved.theme } : {}),
      ...(['pool', 'list', 'card'].includes(saved.layout ?? '') ? { layout: saved.layout } : {}),
      ...(typeof saved.maskNames === 'boolean' ? { maskNames: saved.maskNames } : {}),
    }
  } catch { return {} }
}
let toastSeq = 0
export const useStore = create<AppState>((set, get) => ({
  credentials: [], targets: [], settings: { ...structuredClone(DEFAULT_SETTINGS), ...preferences() },
  settingsDraft: null, settingsSaving: false, pendingTab: null, tasks: [],
  capabilities: { ...EMPTY_CAPABILITIES }, connection: 'connecting', connectionError: '', authenticated: false, lastUpdatedAt: null,
  selected: [], filters: { search: '', verdict: 'all', sort: null }, toasts: [], tab: 'overview',
  sourceDetail: '', detail: null, runPanelOpen: false, syncing: [], quotaRefreshing: [], starting: false, startingCredentialIds: [], mutationVersion: 0,
  configChangesRevision: '', exclusionDrawerOpen: false, excluding: [], togglingStatus: [],
  inspectionConfirmation: null, inspectionConfirmError: '', pendingSettingsConfirmation: null, settingsConfirmError: '',
  pendingWeightZero: null,

  setTab: (tab) => {
    const state = get()
    if (state.settingsSaving) return
    if (tab !== 'settings' && state.tab === 'settings' && changedSettings(state.settings, state.settingsDraft).length) { set({ pendingTab: tab }); return }
    set({ tab, pendingTab: null, settingsDraft: tab === 'settings' ? state.settingsDraft : null })
  },
  hydrate: (snapshot) => {
    if (snapshot.source !== 'live' || !Array.isArray(snapshot.credentials) || !Array.isArray(snapshot.targets) || !snapshot.settings) throw new Error('CPA 插件返回的状态格式无效')
    const settings = {
      ...snapshot.settings, reasoningEffort: snapshot.settings.reasoningEffort ?? DEFAULT_SETTINGS.reasoningEffort,
      failureRule: { ...DEFAULT_SETTINGS.failureRule, ...snapshot.settings.failureRule },
      headerOverrides: snapshot.settings.headerOverrides ?? {},
      pagination: { ...DEFAULT_SETTINGS.pagination, ...snapshot.settings.pagination },
      routing: normalizeRouting(snapshot.settings.routing),
      schedule: {
        ...DEFAULT_SETTINGS.schedule,
        ...snapshot.settings.schedule,
        busySessionPolicy: snapshot.settings.schedule?.busySessionPolicy ?? DEFAULT_SETTINGS.schedule.busySessionPolicy,
        maxBusySessions: snapshot.settings.schedule?.maxBusySessions ?? DEFAULT_SETTINGS.schedule.maxBusySessions,
        minRemainingPercent: snapshot.settings.schedule?.minRemainingPercent ?? snapshot.settings.quota?.minRemainingPercent ?? DEFAULT_SETTINGS.schedule.minRemainingPercent,
        windows: snapshot.settings.schedule?.windows ?? [],
      },
      ...preferences(),
    }
    const current = get()
    const pinned = new Set(current.excluding)
    const credentials = pinned.size ? snapshot.credentials.map((credential) => pinned.has(credential.id)
      ? current.credentials.find((previous) => previous.id === credential.id) ?? credential : credential) : snapshot.credentials
    const credById = new Map(credentials.map((credential) => [credential.id, credential]))
    set({
      credentials, targets: snapshot.targets, tasks: snapshot.tasks ?? [],
      configChangesRevision: snapshot.configChangesRevision ?? '',
      requestHeaderProfile: snapshot.requestHeaderProfile,
      settings,
      settingsDraft: get().settingsDraft ? rebaseSettingsDraft(get().settings, get().settingsDraft!, settings) : null,
      capabilities: { ...EMPTY_CAPABILITIES, ...snapshot.capabilities,
        weightEditingEnabled: snapshot.capabilities?.weightEditingEnabled === true,
        fingerprintAvailable: snapshot.capabilities?.fingerprintAvailable === true,
        availabilityKnown: snapshot.capabilities?.availabilityKnown === true },
      connection: 'connected', connectionError: '', authenticated: true, sourceDetail: snapshot.sourceDetail ?? '',
      lastUpdatedAt: new Date().toISOString(),
      selected: get().selected.filter((id) => {
        const cred = credById.get(id)
        return Boolean(cred && !cred.disabled && !isManuallyExcluded(cred))
      }),
    })
    get().ensureTargetsForModel(settings.inspectionModel)
  },
  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
  toggleSelect: (id) =>
    set((state) => {
      const cred = state.credentials.find((credential) => credential.id === id)
      if (!cred || cred.disabled || isManuallyExcluded(cred)) return state
      return { selected: state.selected.includes(id) ? state.selected.filter((value) => value !== id) : [...state.selected, id] }
    }),
  selectTargets: (ids) =>
    set((state) => {
      const blocked = new Set(
        state.credentials
          .filter((credential) => credential.disabled || isManuallyExcluded(credential))
          .map((credential) => credential.id),
      )
      return { selected: ids.filter((id) => !blocked.has(id)) }
    }),
  clearSelection: () => set({ selected: [] }),
  updateSettings: (patch) => {
    const state = get()
    const next = { ...state.settings,
      ...(patch.theme ? { theme: patch.theme } : {}),
      ...(patch.layout ? { layout: patch.layout } : {}),
      ...(typeof patch.maskNames === 'boolean' ? { maskNames: patch.maskNames } : {}),
    }
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ theme: next.theme, layout: next.layout, maskNames: next.maskNames })) } catch { /* 界面偏好可在内存中使用。 */ }
    set({ settings: next })
  },
  editSettingsDraft: (patch) => {
    if (get().settingsSaving) return
    set((state) => ({ settingsDraft: { ...(state.settingsDraft ?? structuredClone(state.settings)), ...patch } }))
  },
  saveSettingsDraft: async (acknowledgeScheduledConfigChanges = false) => {
    const state = get()
    if (state.settingsSaving) return false
    if (!state.settingsDraft) return true
    const errors = settingsErrors(state.settingsDraft, state.requestHeaderProfile?.managedHeaders)
    if (state.connection !== 'connected') errors.push('CPA 尚未连接，不能保存配置')
    if (['normal', 'downshift', 'ungrouped'].some((group) =>
      state.settingsDraft!.routing.groups[group as keyof Settings['routing']['groups']].weight !== state.settings.routing.groups[group as keyof Settings['routing']['groups']].weight)) errors.push('权重继承 CPA 当前配置，不能由插件修改')
    if (state.settingsDraft.inspectionMethod === 'fingerprint' && !state.capabilities.fingerprintAvailable) errors.push('后端尚未提供模型指纹参考库')
    if (errors.length) { state.notify({ tone: 'danger', title: '设置未保存', detail: errors.join('；') }); return false }
    const next = mergeSettingsDraft(state.settings, state.settingsDraft)
    if (needsScheduledConsent(state.settings, next)) {
      if (!acknowledgeScheduledConfigChanges) {
        set({ pendingSettingsConfirmation: structuredClone(next), settingsConfirmError: '' })
        return false
      }
      if (!state.pendingSettingsConfirmation || !sameInspectionRisk(state.pendingSettingsConfirmation, next)) {
        set({ pendingSettingsConfirmation: structuredClone(next), settingsConfirmError: '巡检配置已变化，请核对更新后的内容并再次确认。' })
        return false
      }
    }
    set({ settingsSaving: true, mutationVersion: state.mutationVersion + 1 })
    try {
      await backend.saveSettings(next, acknowledgeScheduledConfigChanges)
      const snapshot = await backend.loadSnapshot()
      get().hydrate(snapshot)
      set({ settingsDraft: null, pendingTab: null, pendingSettingsConfirmation: null, settingsConfirmError: '', tab: state.pendingTab ?? state.tab })
      if (state.tab === 'settings') get().notify({ tone: 'success', title: '设置已保存', detail: '服务端已保存配置，后续巡检将使用新设置。' })
      return true
    } catch (error) {
      try { get().hydrate(await backend.loadSnapshot()) } catch { /* 读取失败时保留当前状态与草稿，下一次自动刷新会继续检查连接。 */ }
      const partial = error instanceof APIError && error.status === 409 && error.message.startsWith('设置已保存')
      if (state.pendingSettingsConfirmation) set({ settingsConfirmError: error instanceof Error ? error.message : String(error) })
      get().notify({ tone: partial ? 'warning' : 'danger', title: partial ? '设置已保存，部分凭证待同步' : '设置保存失败', detail: error instanceof Error ? error.message : String(error) })
      return false
    } finally { set({ settingsSaving: false }) }
  },
  discardSettingsDraft: () => { if (!get().settingsSaving) set((state) => ({ settingsDraft: null, pendingTab: null, tab: state.pendingTab ?? state.tab })) },
  cancelSettingsNavigation: () => set({ pendingTab: null }),
  ensureTargetsForModel: (model) => {
    const { credentials, targets } = get()
    const existing = new Set<string>()
    for (const target of targets) {
      if (target.model === model) existing.add(target.credentialId)
    }
    const missing = credentials.filter((credential) => !existing.has(credential.id))
    if (missing.length) set({ targets: [...targets, ...missing.map((credential) => ({
      id: `${credential.id}::${model}`, credentialId: credential.id, model, verdict: 'untested' as const, rounds: [], blocked: null,
    }))] })
  },
  openDetail: (targetId, roundId = null) => set({ detail: { targetId, roundId } }), closeDetail: () => set({ detail: null }),
  setRunPanel: (open) => set({ runPanelOpen: open }),
  setExclusionDrawerOpen: (open) => set({ exclusionDrawerOpen: open }),
  closeInspectionConfirmation: () => { if (!get().starting) set({ inspectionConfirmation: null, inspectionConfirmError: '' }) },
  closeSettingsConfirmation: () => {
    if (!get().settingsSaving) set({ pendingSettingsConfirmation: null, settingsConfirmError: '',
      ...(get().tab === 'overview' ? { settingsDraft: null } : {}) })
  },
  requestWeightZeroWarning: (pendingWeightZero) => set({ pendingWeightZero }),
  closeWeightZeroWarning: () => set({ pendingWeightZero: null }),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  notify: (toast) => {
    const id = `toast-${++toastSeq}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-4) }))
    globalThis.setTimeout(() => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })), 5200)
  },
}))

export const selectCredential = (state: AppState, id: string) => state.credentials.find((credential) => credential.id === id)
export const selectTarget = (state: AppState, id: string) => state.targets.find((target) => target.id === id)
