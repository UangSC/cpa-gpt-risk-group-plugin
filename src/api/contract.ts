import type { Credential, InspectionTask, Settings, Target, TestKind } from '../types'

export const PLUGIN_ID = 'cpa-gpt-risk-group-plugin'
const ROOT = `/v0/management/plugins/${PLUGIN_ID}`
export const ENDPOINTS = {
  snapshot: `${ROOT}/snapshot`, checks: `${ROOT}/checks`,
  task: (id: string) => `${ROOT}/tasks?id=${encodeURIComponent(id)}`,
  cancelTask: (id: string) => `${ROOT}/tasks/cancel?id=${encodeURIComponent(id)}`,
  clearHistory: `${ROOT}/history/clear`,
  sync: `${ROOT}/sync`, verdict: `${ROOT}/verdict`, settings: `${ROOT}/settings`, routing: `${ROOT}/routing`,
  exclusions: `${ROOT}/exclusions`,
  status: `${ROOT}/status`,
  quotaRefresh: `${ROOT}/quota/refresh`,
} as const

export interface Capabilities {
  routingStrategy: string
  weightEditingEnabled: boolean
  fingerprintAvailable: boolean
  availabilityKnown?: boolean
  quotaRefreshAvailable?: boolean
}
export const EMPTY_CAPABILITIES: Capabilities = {
  routingStrategy: 'unknown', weightEditingEnabled: false, fingerprintAvailable: false, availabilityKnown: false,
}
export interface Snapshot {
  credentials: Credential[]
  targets: Target[]
  settings: Settings
  tasks?: InspectionTask[]
  capabilities?: Capabilities
  source: 'live'
  sourceDetail?: string
  configChangesRevision?: string
  requestHeaderProfile?: RequestHeaderProfile
}
export interface RequestHeaderProfile {
  source?: 'cpa-core' | 'cpa-config'
  codexCliVersion?: string
  defaultHeaders: Record<string, string>
  managedHeaders?: string[]
}
export interface StartChecksRequest {
  credentialIds?: string[]
  model: string
  method: TestKind
  scope: 'manual' | 'batch' | 'scheduled'
  acknowledgeConfigChanges: boolean
  configChangesMode: Settings['routing']['mode']
  configChangesRevision: string
}
export interface StartChecksResponse { taskId: string }
/** weight 在 CPA 使用加权轮询策略时可单独编辑。 */
export interface RoutingRequest { credentialId: string; priority?: number; weight?: number; reset?: boolean }
export interface SyncRequest { credentialId: string }
export interface ManualVerdictRequest {
  credentialId: string
  model: string
  roundId?: string
  verdict: 'normal' | 'downshift'
}
export interface ManualVerdictResponse {
  verdict: 'normal' | 'downshift'
  status: 'synced' | 'not-needed' | 'failed'
  appliedGroup: 'normal' | 'downshift' | null
  message: string | null
}
export interface ExclusionRequest { credentialIds: string[]; excluded: boolean }
export interface CredentialStatusRequest { credentialId: string; disabled: boolean }
export interface QuotaRefreshRequest { credentialIds: string[] }
export interface QuotaRefreshResponse { refreshedIds: string[]; failed: { credentialId: string; error: string }[] }
export interface SyncResponse { status: 'synced' | 'failed'; appliedGroup: 'normal' | 'downshift' | null; message: string | null }
export interface Backend {
  readonly kind: 'plugin'
  loadSnapshot(): Promise<Snapshot>
  startChecks(request: StartChecksRequest): Promise<StartChecksResponse>
  loadTask(id: string): Promise<InspectionTask>
  cancelTask(id: string): Promise<void>
  clearHistory(): Promise<void>
  sync(request: SyncRequest): Promise<SyncResponse>
  judgeVerdict(request: ManualVerdictRequest): Promise<ManualVerdictResponse>
  saveSettings(settings: Settings, acknowledgeScheduledConfigChanges?: boolean): Promise<void>
  saveRouting(request: RoutingRequest): Promise<void>
  setExclusions(request: ExclusionRequest): Promise<void>
  setCredentialStatus(request: CredentialStatusRequest): Promise<void>
  refreshQuota(request: QuotaRefreshRequest): Promise<QuotaRefreshResponse>
}

export { decodeManagementStorage, readStoredManagementKey } from './auth'
