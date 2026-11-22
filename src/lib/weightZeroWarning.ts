const STORAGE_KEY = 'cpa-gpt-risk-group:suppress-weight-zero-warning:v1'
const LEGACY_STORAGE_KEY = 'cpa-downshift:suppress-weight-zero-warning:v1'

export function isWeightZeroWarningSuppressed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY)) === '1'
  } catch {
    return false
  }
}

export function suppressWeightZeroWarning(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* 存储不可用时仅本次生效 */
  }
}

export function restoreWeightZeroWarning(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* 忽略存储异常 */
  }
}
