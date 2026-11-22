// 前端操作编排：检查资格、确认写入权限并提交 CPA 管理请求；不在浏览器推理。
import { backend, type RoutingRequest } from '../api'
import type { Credential, InspectionTask, Settings, Target, InspectionConfirmation } from '../types'
import { isManuallyExcluded, lowestQuota } from '../lib/derive'
import { useStore } from './store'
import { refreshSnapshot } from './live'
import { activeInspectionCredentialIds } from './exclusions'
import { currentManagementKey } from '../api/auth'
import { canSkipManualReminder, manualWritePolicy, rememberManualReminder, restoreManualReminder } from '../lib/manualInspectionConsent'

let preparingInspection = false

export interface Eligibility { runnable: boolean; mustWait?: boolean; note: string }
export function evaluateEligibility(
  target: Target,
  settings: Settings,
  preloadedCredential?: Credential,
  busySets?: { togglingStatus: ReadonlySet<string>; excluding: ReadonlySet<string> },
): Eligibility {
  const state = useStore.getState()
  const credential = preloadedCredential ?? state.credentials.find((item) => item.id === target.credentialId)
  if (!credential) return { runnable: false, note: '凭证已不存在' }
  if (credential.disabled) return { runnable: false, note: '该凭证已关闭，不参与巡检' }
  if (isManuallyExcluded(credential)) return { runnable: false, note: '该凭证不参与巡检，请先从侧边抽屉恢复参与' }
  if (busySets ? busySets.togglingStatus.has(credential.id) : state.togglingStatus.includes(credential.id)) return { runnable: false, note: '该凭证开启状态正在切换' }
  if (busySets ? busySets.excluding.has(credential.id) : state.excluding.includes(credential.id)) return { runnable: false, note: '该凭证的参与状态正在更新' }
  if (credential.auth === 'expired') return { runnable: false, note: '认证失效：需要重新登录，不属于模型风控' }
  if (credential.unavailable) return { runnable: false, note: 'CPA 当前报告此凭证不可用或处于冷却，暂不检测' }
  const lowest = lowestQuota(credential)
  if (credential.quota.status === 'exhausted' || lowest === 0) return { runnable: false, note: '额度已用尽，不属于模型风控' }
  if (lowest === null && settings.quota.unknownPolicy === 'skip') return { runnable: false, note: '额度未知：按设置跳过检测' }
  if (lowest !== null && lowest <= settings.quota.minRemainingPercent) return { runnable: false, note: `剩余额度不高于阈值 ${settings.quota.minRemainingPercent}%，本轮跳过` }
  return { runnable: true, mustWait: credential.availability === 'busy', note: credential.availability === 'busy' ? '凭证会话中，等待空闲' : lowest === null ? '额度未知，仍按设置检测' : '' }
}
function notifyError(title: string, error: unknown) {
  useStore.getState().notify({ tone: 'danger', title, detail: error instanceof Error ? error.message : String(error) })
}
/** 概览快捷设置与设置页共用保存校验和已启用计划的配置确认。 */
export async function saveInspectionOptions(
  patch: Partial<Pick<Settings, 'inspectionMethod' | 'concurrency' | 'inspectionModel' | 'reasoningEffort' | 'prefixes' | 'routing'>>,
): Promise<boolean> {
  const state = useStore.getState()
  if (state.connection !== 'connected' || state.settingsSaving || state.starting || state.settingsDraft || state.inspectionConfirmation || state.pendingSettingsConfirmation || state.tasks.some((task) => task.status === 'running')) return false
  if ((patch.inspectionMethod === undefined || patch.inspectionMethod === state.settings.inspectionMethod)
    && (patch.concurrency === undefined || patch.concurrency.maxObjects === state.settings.concurrency.maxObjects)
    && (patch.inspectionModel === undefined || patch.inspectionModel.trim() === state.settings.inspectionModel)
    && (patch.reasoningEffort === undefined || patch.reasoningEffort === state.settings.reasoningEffort)
    && (patch.prefixes === undefined || (patch.prefixes.normal === state.settings.prefixes.normal && patch.prefixes.downshift === state.settings.prefixes.downshift))
    && (patch.routing === undefined || JSON.stringify(patch.routing) === JSON.stringify(state.settings.routing))) return true
  state.editSettingsDraft(patch)
  const saved = await state.saveSettingsDraft()
  if (!saved && !useStore.getState().pendingSettingsConfirmation) useStore.setState({ settingsDraft: null })
  return saved
}

/** 仅提交点击时实际显示的凭证；额度刷新不会触发巡检或分组写入。 */
export async function refreshCredentialsQuota(credentialIds: string[]): Promise<void> {
  const state = useStore.getState()
  if (state.connection !== 'connected' || state.quotaRefreshing.length) return
  const existing = new Set(state.credentials.map((credential) => credential.id))
  const ids = [...new Set(credentialIds)].filter((id) => existing.has(id))
  if (!ids.length) return
  const requestKey = currentManagementKey()
  useStore.setState({ quotaRefreshing: ids, mutationVersion: state.mutationVersion + 1 })
  try {
    const result = await backend.refreshQuota({ credentialIds: ids })
    if (currentManagementKey() !== requestKey) return
    const refreshed = await refreshSnapshot(true)
    if (currentManagementKey() !== requestKey) return
    const failed = result.failed.length
    useStore.getState().notify({ tone: failed || !refreshed ? 'warning' : 'success',
      title: failed ? `额度刷新：${result.refreshedIds.length} 个成功，${failed} 个失败` : `已刷新 ${result.refreshedIds.length} 个凭证额度`,
      detail: !refreshed ? '额度请求已完成，当前页面未能同步结果；恢复连接后会再次读取。'
        : failed ? result.failed.slice(0, 2).map((item) => item.error).join('；') : undefined })
  } catch (error) {
    if (currentManagementKey() === requestKey) notifyError('额度刷新失败', error)
  } finally {
    useStore.setState((current) => ({ quotaRefreshing: current.quotaRefreshing.filter((id) => !ids.includes(id)) }))
  }
}
export async function startInspection(scope: InspectionTask['scope'], targetIds?: string[]): Promise<string | null> {
  const state = useStore.getState()
  if (scope === 'scheduled') { notifyError('定时巡检由服务端管理', new Error('请在设置中开启计划并确认后台配置修改权限')); return null }
  if (preparingInspection || state.connection !== 'connected' || state.starting || state.settingsSaving || state.pendingSettingsConfirmation || state.inspectionConfirmation) return null
  const credentialIds = targetIds ? [...new Set(targetIds.map((id) => state.targets.find((target) => target.id === id)?.credentialId).filter((id): id is string => !!id))] : undefined
  if (credentialIds?.length === 0) return null
  const requested = credentialIds ?? state.credentials.map((credential) => credential.id)
  preparingInspection = true
  try {
    const requestKey = currentManagementKey()
    const skip = await canSkipManualReminder(state.settings, requestKey)
    const current = useStore.getState()
    if (current.connection !== 'connected' || current.starting || current.settingsSaving || current.pendingSettingsConfirmation || current.inspectionConfirmation) return null
    const eligible = eligibleIds(requested)
    if (!eligible.length) { notifyError('没有可巡检的凭证', new Error('不参与巡检或状态不满足条件的凭证不会执行')); return null }
    const pending = confirmation(scope, eligible, requested.length)
    if (skip && currentManagementKey() === requestKey && manualWritePolicy(state.settings) === manualWritePolicy(current.settings)) {
      return await submitInspection(pending, false, false)
    }
    useStore.setState({ inspectionConfirmation: pending, inspectionConfirmError: '' })
    return null
  } finally { preparingInspection = false }
}

function eligibleIds(ids: string[]): string[] {
  const state = useStore.getState()
  return ids.filter((id) => {
    const target = state.targets.find((entry) => entry.credentialId === id && entry.model === state.settings.inspectionModel)
    return !!target && evaluateEligibility(target, state.settings).runnable
  })
}

function confirmation(scope: 'manual' | 'batch', ids: string[], requestedCount: number): InspectionConfirmation {
  const state = useStore.getState()
  return { scope, credentialIds: ids, settings: structuredClone(state.settings), revision: state.configChangesRevision,
    requestedCount, excludedCount: state.credentials.filter((entry) => isManuallyExcluded(entry) || state.excluding.includes(entry.id)).length }
}

/** 唯一提交入口：只有“我已知晓”的点击处理调用，并绑定已展示的配置版本。 */
export async function acknowledgeInspection(rememberNextTime = false): Promise<string | null> {
  const pending = useStore.getState().inspectionConfirmation
  if (!pending) return null
  return submitInspection(pending, rememberNextTime)
}

async function submitInspection(pending: InspectionConfirmation, rememberNextTime: boolean, explicitConfirmation = true): Promise<string | null> {
  const state = useStore.getState()
  if (state.starting || state.connection !== 'connected') return null
  const eligible = eligibleIds(pending.credentialIds)
  if (!eligible.length) { useStore.setState({ inspectionConfirmError: '这些凭证已不符合巡检条件，请取消后重新选择。' }); return null }
  if (!pending.revision) { useStore.setState({ inspectionConfirmError: '后端未提供巡检配置版本，请刷新插件后重试。' }); return null }
  if (pending.revision !== state.configChangesRevision || eligible.length !== pending.credentialIds.length) {
    useStore.setState({ inspectionConfirmation: confirmation(pending.scope, eligible, pending.requestedCount), inspectionConfirmError: '巡检配置或参与范围已变化，请核对更新后的内容并再次点击“我已知晓”。' })
    return null
  }
  useStore.setState({ starting: true, startingCredentialIds: eligible, inspectionConfirmError: '', mutationVersion: state.mutationVersion + 1 })
  const requestKey = currentManagementKey()
  try {
    const response = await backend.startChecks({ credentialIds: eligible, scope: pending.scope,
      model: pending.settings.inspectionModel, method: pending.settings.inspectionMethod,
      acknowledgeConfigChanges: true, configChangesMode: pending.settings.routing.mode, configChangesRevision: pending.revision })
    if (rememberNextTime && !await rememberManualReminder(pending.settings, requestKey)) {
      state.notify({ tone: 'warning', title: '本次巡检已启动', detail: '浏览器未能保存提醒偏好，下次仍会正常提醒。' })
    }
    else if (!rememberNextTime && explicitConfirmation && currentManagementKey() === requestKey) restoreManualReminder()
    useStore.setState({ inspectionConfirmation: null, inspectionConfirmError: '' })
    useStore.getState().notify({
      tone: 'info',
      title: '巡检已开始',
      detail: `正在检测 ${eligible.length} 个凭证，可点击右上角「巡检中」查看批次进度。`,
    })
    await refreshSnapshot(true)
    return response.taskId
  } catch (error) {
    await refreshSnapshot(true)
    const latest = useStore.getState()
    const updated = eligibleIds(pending.credentialIds)
    useStore.setState({ inspectionConfirmation: updated.length ? confirmation(pending.scope, updated, pending.requestedCount) : pending,
      inspectionConfirmError: error instanceof Error ? error.message : String(error) })
    if (latest.connection !== 'connected') notifyError('巡检尚未开始', error)
    return null
  }
  finally { useStore.setState({ starting: false, startingCredentialIds: [] }) }
}
export async function cancelTask(id: string) {
  useStore.setState((state) => ({ mutationVersion: state.mutationVersion + 1 }))
  try { await backend.cancelTask(id); await refreshSnapshot(true) } catch (error) { notifyError('停止巡检失败', error) }
}
export async function resyncCredential(id: string) {
  if (useStore.getState().connection !== 'connected' || useStore.getState().syncing.includes(id)) return
  useStore.setState((state) => ({ syncing: [...new Set([...state.syncing, id])], mutationVersion: state.mutationVersion + 1 }))
  try {
    const response = await backend.sync({ credentialId: id })
    await refreshSnapshot(true)
    useStore.getState().notify({ tone: response.status === 'synced' ? 'success' : 'danger', title: response.status === 'synced' ? '分组已同步' : '分组同步失败', detail: response.message ?? undefined })
  } catch (error) { notifyError('分组同步失败', error) }
  finally { useStore.setState((state) => ({ syncing: state.syncing.filter((value) => value !== id) })) }
}
export async function setCredentialDisabled(credentialId: string, disabled: boolean): Promise<boolean> {
  const state = useStore.getState()
  if (state.connection !== 'connected') return false
  if (state.togglingStatus.includes(credentialId) || state.excluding.includes(credentialId) || state.syncing.includes(credentialId)) return false
  if (activeInspectionCredentialIds(state).includes(credentialId)) {
    state.notify({ tone: 'warning', title: '无法切换凭证状态', detail: '该凭证正在巡检中，请等待完成或停止任务后再切换开关' })
    return false
  }
  const requestKey = currentManagementKey()
  useStore.setState((current) => ({
    togglingStatus: [...new Set([...current.togglingStatus, credentialId])],
    mutationVersion: current.mutationVersion + 1,
  }))
  let committed = false
  try {
    await backend.setCredentialStatus({ credentialId, disabled })
    committed = true
    if (currentManagementKey() !== requestKey) return false
    useStore.setState((current) => ({
      credentials: current.credentials.map((credential) =>
        credential.id === credentialId ? { ...credential, disabled } : credential,
      ),
      selected: disabled ? current.selected.filter((id) => id !== credentialId) : current.selected,
    }))
    const refreshed = await refreshSnapshot(true)
    if (currentManagementKey() !== requestKey) return true
    useStore.getState().notify({
      tone: refreshed ? 'success' : 'warning',
      title: disabled ? '已关闭凭证' : '已开启凭证',
      detail: refreshed
        ? disabled
          ? '已同步至 CLIProxyAPI，关闭后不参与巡检且不可勾选。'
          : '已同步至 CLIProxyAPI，凭证已恢复参与。'
        : '状态已提交，当前刷新暂不可用，请重新连接后确认。',
    })
    return true
  } catch (error) {
    if (currentManagementKey() === requestKey) {
      notifyError(disabled ? '关闭凭证失败' : '开启凭证失败', error)
    }
    return false
  } finally {
    useStore.setState((current) => ({
      togglingStatus: current.togglingStatus.filter((id) => id !== credentialId),
    }))
    if (!committed && currentManagementKey() === requestKey) {
      await refreshSnapshot(true)
    }
  }
}

export async function saveCredentialRouting(request: RoutingRequest) {
  const state = useStore.getState()
  if (state.connection !== 'connected' || state.syncing.includes(request.credentialId)) return
  if (request.weight !== undefined && !state.capabilities.weightEditingEnabled) return
  useStore.setState((current) => ({ syncing: [...current.syncing, request.credentialId], mutationVersion: current.mutationVersion + 1 }))
  try { await backend.saveRouting(request); await refreshSnapshot(true) }
  catch (error) { notifyError('调度设置保存失败', error) }
  finally { useStore.setState((current) => ({ syncing: current.syncing.filter((id) => id !== request.credentialId) })) }
}
