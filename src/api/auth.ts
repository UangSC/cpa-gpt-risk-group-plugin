const AUTH_KEY = 'cpa-gpt-risk-group:auth:v1'
const LEGACY_AUTH_KEY = 'cpa-downshift:auth:v1'
const SESSION_KEY = 'cpa-gpt-risk-group:management-key'
const LEGACY_SESSION_KEY = 'cpa-downshift:management-key'
let activeKey: string | null = null

/** 与 CPA Management Center 已有的来源绑定存储格式兼容。 */
export function decodeManagementStorage(value: string, host: string, userAgent: string): {
  state?: { rememberPassword?: boolean; managementKey?: string; apiBase?: string }
} {
  let decoded = value
  if (value.startsWith('enc::v1::') || value.startsWith('enc::v2::')) {
    const version = value.startsWith('enc::v1::') ? 1 : 2
    const bytes = Uint8Array.from(atob(value.slice(9)), (char) => char.charCodeAt(0))
    const key = new TextEncoder().encode(`cli-proxy-api-webui::secure-storage|${host}${version === 1 ? `|${userAgent}` : ''}`)
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes.map((byte, index) => byte ^ key[index % key.length]))
  }
  const parsed = JSON.parse(decoded)
  if (!parsed || typeof parsed !== 'object') throw new Error('管理密钥存储格式无效')
  return parsed
}

function storedKey(storageKey: string): string | null {
  try {
    const value = window.localStorage?.getItem(storageKey)
    if (!value) return null
    const state = decodeManagementStorage(value, window.location.host, navigator.userAgent).state
    return state?.rememberPassword && typeof state.managementKey === 'string' && state.managementKey.trim()
      ? state.managementKey.trim() : null
  } catch { return null }
}

export function hasRememberedManagementKey(): boolean { return !!(storedKey(AUTH_KEY) ?? storedKey(LEGACY_AUTH_KEY)) }

export function readStoredManagementKey(): string | null {
  try {
    const session = window.sessionStorage?.getItem(SESSION_KEY) ?? window.sessionStorage?.getItem(LEGACY_SESSION_KEY)
    if (session?.trim()) return session.trim()
  } catch { /* 浏览器禁用会话存储时仍可读取已有管理面板密钥。 */ }
  const remembered = storedKey(AUTH_KEY) ?? storedKey(LEGACY_AUTH_KEY) ?? storedKey('cli-proxy-auth')
  if (remembered) return remembered
  try {
    for (const name of ['management-key', 'cpa-management-key', 'cliproxyapi-management-key', 'mgmt-key']) {
      const value = window.localStorage?.getItem(name)
      if (value?.trim()) return value.trim()
    }
  } catch { /* 来源存储可能被浏览器限制。 */ }
  return null
}

export function currentManagementKey(): string | null {
  if (activeKey) return activeKey
  if (typeof window === 'undefined') return null
  return window.__CPA_GPT_RISK_GROUP__?.managementKey?.trim()
    ?? window.__CPA_DOWNSHIFT__?.managementKey?.trim()
    ?? readStoredManagementKey()
}
export function setPendingManagementKey(key: string): void { activeKey = key.trim() || null }
export function clearPendingManagementKey(): void { activeKey = null }
export function forgetRememberedManagementKey(): void {
  try {
    window.localStorage?.removeItem(AUTH_KEY)
    window.localStorage?.removeItem(LEGACY_AUTH_KEY)
  } catch { /* 浏览器限制存储时不影响当前登录。 */ }
}

/** 仅在 CPA 验证成功后保存，避免记住输入错误的密钥。 */
export function persistVerifiedManagementKey(key: string, remember: boolean): boolean {
  activeKey = key.trim()
  try { window.sessionStorage?.setItem(SESSION_KEY, activeKey) } catch { /* 本次登录仍可在内存中使用。 */ }
  try {
    if (!remember) {
      window.localStorage?.removeItem(AUTH_KEY)
      window.localStorage?.removeItem(LEGACY_AUTH_KEY)
      return false
    }
    const data = new TextEncoder().encode(JSON.stringify({ state: { rememberPassword: true, managementKey: activeKey }, version: 1 }))
    const mask = new TextEncoder().encode(`cli-proxy-api-webui::secure-storage|${window.location.host}`)
    const encoded = btoa(String.fromCharCode(...data.map((byte, index) => byte ^ mask[index % mask.length])))
    if (!window.localStorage) return false
    window.localStorage.setItem(AUTH_KEY, `enc::v2::${encoded}`)
    return true
  } catch { return false }
}

export function discardInvalidSessionKey(): void {
  const failedKey = currentManagementKey()
  if (failedKey && (storedKey(AUTH_KEY) === failedKey || storedKey(LEGACY_AUTH_KEY) === failedKey)) {
    forgetRememberedManagementKey()
  }
  activeKey = null
  try {
    window.sessionStorage?.removeItem(SESSION_KEY)
    window.sessionStorage?.removeItem(LEGACY_SESSION_KEY)
  } catch { /* 存储不可用。 */ }
}
