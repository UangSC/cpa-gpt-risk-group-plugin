import { useStore } from '../../store/store'
import { refreshCredentialsQuota } from '../../store/actions'
import { setCredentialExclusions } from '../../store/exclusions'
import { ExclusionIcon } from '../ExclusionDrawer'
import { Icon } from '../ui'

export function SelectionActionBar({
  selectedIds,
  isPelicanMode,
  exclusionBusyIds,
  onRetestSelected,
}: {
  selectedIds: string[]
  isPelicanMode: boolean
  exclusionBusyIds: ReadonlySet<string>
  onRetestSelected: () => void
}) {
  const connection = useStore((s) => s.connection)
  const starting = useStore((s) => s.starting)
  const excluding = useStore((s) => s.excluding)
  const quotaRefreshing = useStore((s) => s.quotaRefreshing)
  const clearSelection = useStore((s) => s.clearSelection)

  if (selectedIds.length === 0) return null

  return (
    <div className="selection-bar" role="region" aria-label="批量操作">
      <span className="sel-text">
        已选 <b>{selectedIds.length}</b> 个
        <span className="selection-cross-page">跨页保留</span>
      </span>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={connection !== 'connected' || starting || excluding.length > 0}
        onClick={onRetestSelected}
      >
        <Icon.Play />
        {isPelicanMode ? '绘制选中' : '巡检选中'}
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={connection !== 'connected' || Boolean(quotaRefreshing.length)}
        onClick={() => void refreshCredentialsQuota(selectedIds)}
      >
        <Icon.Refresh />
        刷新额度
      </button>
      <button
        type="button"
        className="btn btn-sm btn-exclude"
        disabled={
          connection !== 'connected' ||
          starting ||
          excluding.length > 0 ||
          selectedIds.some((id) => exclusionBusyIds.has(id))
        }
        onClick={() => void setCredentialExclusions(selectedIds, true)}
      >
        <ExclusionIcon />
        移入排除池
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={clearSelection}>
        清除
      </button>
    </div>
  )
}
