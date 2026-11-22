import { backend } from '../api'
import { APIError } from '../api/plugin'
import { useStore } from './store'
import { clearPendingManagementKey, currentManagementKey, discardInvalidSessionKey, persistVerifiedManagementKey, setPendingManagementKey } from '../api/auth'

let timer: ReturnType<typeof setTimeout> | null = null
let visibilityListener: (() => void) | null = null
let failures = 0
let pending: Promise<boolean> | null = null
let stopped = true
let generation = 0

function clearPollTimer() {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

function detachVisibilityListener() {
  if (visibilityListener && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityListener)
  }
  visibilityListener = null
}

export function stopPolling() {
  stopped = true
  generation++
  clearPollTimer()
  detachVisibilityListener()
}
export function refreshSnapshot(force = false): Promise<boolean> {
  if (pending) return force ? pending.then(() => refreshSnapshot(true)) : pending
  pending = (async () => {
    const currentGeneration = generation
    const version = useStore.getState().mutationVersion
    try {
      const snapshot = await backend.loadSnapshot()
      if (currentGeneration !== generation) return false
      if (!useStore.getState().settingsSaving && version === useStore.getState().mutationVersion) useStore.getState().hydrate(snapshot)
      failures = 0
      return true
    } catch (error) {
      if (currentGeneration !== generation) return false
      failures++
      const permanent = error instanceof APIError && error.status >= 400 && error.status < 500 && error.status !== 429
      const halt = permanent || failures >= 3
      const authorizationFailed = error instanceof APIError && (error.status === 401 || error.status === 403)
      if (authorizationFailed) discardInvalidSessionKey()
      useStore.setState({
        connection: halt ? 'stopped' : 'error',
        connectionError: `${error instanceof Error ? error.message : String(error)}${halt && !permanent ? ' 连续三次连接失败，已停止自动刷新。' : ''}`,
        ...(authorizationFailed ? { authenticated: false, detail: null, runPanelOpen: false, exclusionDrawerOpen: false, inspectionConfirmation: null, pendingSettingsConfirmation: null } : {}),
      })
      if (halt) stopPolling()
      return false
    } finally { pending = null }
  })()
  return pending
}
function pollDelayMs(): number {
  const hasRunning = useStore.getState().tasks.some((task) => task.status === 'running')
  if (typeof document !== 'undefined' && document.hidden) {
    return hasRunning ? 4000 : 15000
  }
  return hasRunning ? 1000 : failures ? 2000 : 5000
}

function attachVisibilityListener() {
  if (visibilityListener || typeof document === 'undefined') return
  visibilityListener = () => {
    if (document.hidden || stopped) return
    clearPollTimer()
    void poll(generation)
  }
  document.addEventListener('visibilitychange', visibilityListener)
}

async function poll(currentGeneration: number) {
  if (stopped || currentGeneration !== generation) return
  if (typeof document !== 'undefined' && document.hidden && !useStore.getState().tasks.some((task) => task.status === 'running')) {
    clearPollTimer()
    timer = setTimeout(() => void poll(currentGeneration), pollDelayMs())
    return
  }
  if (!useStore.getState().settingsSaving) await refreshSnapshot()
  if (!stopped && currentGeneration === generation) {
    clearPollTimer()
    timer = setTimeout(() => void poll(currentGeneration), pollDelayMs())
  }
}
export function reconnect() {
  stopPolling()
  failures = 0
  if (!currentManagementKey()) {
    useStore.setState({ connection: 'stopped', connectionError: '', authenticated: false })
    return
  }
  stopped = false
  attachVisibilityListener()
  useStore.setState({ connection: 'connecting', connectionError: '' })
  const currentGeneration = generation
  // 旧请求结束后再启动新连接，避免旧地址的状态覆盖手动重连后的来源。
  void (async () => { if (pending) await pending; await poll(currentGeneration) })()
}

/** 登录只验证当前 CPA 的同源接口，成功后才记住密钥。 */
export async function loginWithKey(key: string, remember: boolean): Promise<boolean> {
  const value = key.trim()
  if (!value) {
    useStore.setState({ connection: 'stopped', connectionError: '请输入管理员密钥。', authenticated: false })
    return false
  }
  stopPolling()
  if (pending) await pending
  failures = 0
  setPendingManagementKey(value)
  useStore.setState({ connection: 'connecting', connectionError: '', authenticated: false })
  const result = await refreshSnapshot(true)
  if (!result) { clearPendingManagementKey(); return false }
  const remembered = persistVerifiedManagementKey(value, remember)
  if (remember && !remembered) useStore.getState().notify({ tone: 'warning', title: '已登录', detail: '浏览器未允许记住密钥，本次登录仍可正常使用。' })
  failures = 0
  stopped = false
  attachVisibilityListener()
  const currentGeneration = generation
  clearPollTimer()
  timer = setTimeout(() => void poll(currentGeneration), pollDelayMs())
  return true
}
