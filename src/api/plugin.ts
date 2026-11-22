import type { InspectionTask, Settings } from '../types'
import { ENDPOINTS, type Backend, type Snapshot, type StartChecksRequest, type StartChecksResponse, type SyncRequest, type SyncResponse, type RoutingRequest, type ExclusionRequest, type CredentialStatusRequest, type QuotaRefreshRequest, type QuotaRefreshResponse } from './contract'
import { currentManagementKey } from './auth'

declare global {
  interface Window {
    __CPA_GPT_RISK_GROUP__?: { apiBase?: string; managementKey?: string }
    __CPA_DOWNSHIFT__?: { apiBase?: string; managementKey?: string }
  }
}
export class APIError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export function createPluginBackend(): Backend {
  async function request<T>(path: string, init?: RequestInit, timeoutMs = 15_000): Promise<T> {
    const key = currentManagementKey()
    if (!key) throw new APIError('请输入管理员密钥后登录插件。', 401)
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(path, {
        ...init, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...init?.headers },
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string; message?: string } | null
        const message = response.status === 401 || response.status === 403
          ? '管理密钥无效或已失效，请重新输入。'
          : body?.error ?? body?.message ?? `CPA 插件接口返回 ${response.status}`
        throw new APIError(message, response.status)
      }
      if (response.status === 204) return undefined as T
      return await response.json() as T
    } catch (error) {
      if (controller.signal.aborted) throw new APIError('CPA 插件接口连接超时，请检查服务状态。', 0)
      throw error
    } finally { globalThis.clearTimeout(timeout) }
  }
  return {
    kind: 'plugin', loadSnapshot: () => request<Snapshot>(ENDPOINTS.snapshot),
    startChecks: (body: StartChecksRequest) => request<StartChecksResponse>(ENDPOINTS.checks, { method: 'POST', body: JSON.stringify(body) }),
    loadTask: (id: string) => request<InspectionTask>(ENDPOINTS.task(id)),
    cancelTask: async (id: string) => { await request(ENDPOINTS.cancelTask(id), { method: 'POST' }) },
    clearHistory: async () => { await request(ENDPOINTS.clearHistory, { method: 'POST', body: JSON.stringify({ confirm: true }) }) },
    sync: (body: SyncRequest) => request<SyncResponse>(ENDPOINTS.sync, { method: 'POST', body: JSON.stringify(body) }),
    saveSettings: async (body: Settings, acknowledgeScheduledConfigChanges = false) => { await request(ENDPOINTS.settings, { method: 'PUT', body: JSON.stringify({ ...body, ...(acknowledgeScheduledConfigChanges ? { acknowledgeScheduledConfigChanges: true } : {}) }) }) },
    setExclusions: async (body: ExclusionRequest) => { await request(ENDPOINTS.exclusions, { method: 'POST', body: JSON.stringify(body) }) },
    setCredentialStatus: async (body: CredentialStatusRequest) => { await request(ENDPOINTS.status, { method: 'PUT', body: JSON.stringify(body) }) },
    refreshQuota: (body: QuotaRefreshRequest) => request<QuotaRefreshResponse>(ENDPOINTS.quotaRefresh,
      { method: 'POST', body: JSON.stringify(body) }, Math.max(30_000, Math.ceil(body.credentialIds.length / 2) * 30_000 + 10_000)),
    saveRouting: async (body: RoutingRequest) => {
      await request(ENDPOINTS.routing, { method: 'PUT', body: JSON.stringify(body) })
    },
  }
}
