import { backend } from '../api'
import { refreshSnapshot } from './live'
import { useStore } from './store'

type InspectionState = Pick<ReturnType<typeof useStore.getState>, 'tasks' | 'targets'>
const TERMINAL = new Set(['done', 'skipped', 'cancelled', 'failed'])

/** 排队、等待和重试也属于未完成任务，不能在其间改变参与状态。 */
export function activeInspectionCredentialIds(state: InspectionState): string[] {
  const ids = new Set<string>()
  const targetsById = new Map(state.targets.map((target) => [target.id, target]))
  for (const task of state.tasks) {
    if (task.status !== 'running') continue
    for (const item of task.items) {
      if (TERMINAL.has(item.state)) continue
      const target = targetsById.get(item.targetId)
      if (target) ids.add(target.credentialId)
    }
  }
  return [...ids]
}

export function exclusionBlockedReason(credentialId: string): string | null {
  const state = useStore.getState()
  if (state.connection !== 'connected') return 'CPA 尚未连接，暂时不能更新凭证池'
  const credential = state.credentials.find((item) => item.id === credentialId)
  if (!credential) return '凭证已不存在'
  if (state.starting) return '正在提交巡检任务，请稍后再更新凭证池'
  if (state.togglingStatus.includes(credentialId)) return '正在切换凭证开启状态，请稍后再更新凭证池'
  if (state.excluding.includes(credentialId)) return '正在更新该凭证的巡检参与状态'
  if (state.syncing.includes(credentialId)) return '正在同步该凭证配置，请等待完成'
  if (activeInspectionCredentialIds(state).includes(credentialId)) return '该凭证正在巡检任务中，请先停止任务或等待完成'
  return null
}

function visibleCard(credentialId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return [...document.querySelectorAll<HTMLElement>('[data-credential-id][data-exclusion-source]')]
    .find((element) => element.dataset.credentialId === credentialId && element.getClientRects().length > 0) ?? null
}

/** 成功写入参与状态后才播放移入动画；错误不消失、不移动卡片。 */
export async function setCredentialExclusions(credentialIds: string[], excluded: boolean): Promise<boolean> {
  const ids = [...new Set(credentialIds)]
  if (!ids.length) return false
  const state = useStore.getState()
  for (const id of ids) {
    const reason = exclusionBlockedReason(id)
    if (reason) {
      state.notify({ tone: 'warning', title: '凭证池尚未更新', detail: reason })
      return false
    }
  }
  const sources = excluded ? ids.map(visibleCard).filter((element): element is HTMLElement => !!element) : []
  useStore.setState((current) => ({ excluding: [...new Set([...current.excluding, ...ids])], mutationVersion: current.mutationVersion + 1 }))
  let committed = false
  try {
    await backend.setExclusions({ credentialIds: ids, excluded })
    committed = true
    const target = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-exclusion-target]')
    if (target && sources.length) {
      // 按需加载粒子动画模块，减少首屏包体积；动画失败不阻断状态提交。
      const { animateExclusionTransfer } = await import('../lib/exclusionParticles')
      await Promise.all(sources.map((source) => animateExclusionTransfer(source, target).catch(() => undefined)))
    }
    useStore.setState((current) => ({
      credentials: current.credentials.map((credential) => ids.includes(credential.id)
        ? { ...credential, inspectionExcluded: excluded, ...(excluded ? {} : { excludedAt: undefined }) } : credential),
      selected: current.selected.filter((id) => !ids.includes(id)),
      excluding: current.excluding.filter((id) => !ids.includes(id)),
    }))
    const refreshed = await refreshSnapshot(true)
    if (excluded) useStore.getState().setExclusionDrawerOpen(true)
    useStore.getState().notify({
      tone: refreshed ? 'success' : 'warning',
      title: excluded ? '已移入不参与巡检' : '已恢复参与巡检',
      detail: refreshed
        ? `${ids.length} 个凭证已更新；原分类、历史与 CPA 配置保持不变${excluded ? '' : '，不会自动开始巡检'}。`
        : '参与状态已保存，当前状态刷新暂不可用，请重新连接后确认。',
    })
    return true
  } catch (error) {
    useStore.getState().notify({ tone: 'danger', title: '凭证池更新失败', detail: error instanceof Error ? error.message : String(error) })
    return false
  } finally {
    useStore.setState((current) => ({ excluding: current.excluding.filter((id) => !ids.includes(id)) }))
    if (!committed) await refreshSnapshot(true)
  }
}
