import { useRef, type CSSProperties, type RefObject } from 'react'
import { useStore } from '../../store/store'
import { Dot, HoverCard, Icon, Select, useSlidingIndicator } from '../ui'

const LAYOUTS = [
  { value: 'pool', label: '双栏', icon: <Icon.Columns2 /> },
  { value: 'list', label: '列表', icon: <Icon.List /> },
  { value: 'card', label: '卡片', icon: <Icon.Grid /> },
] as const

export function OverviewToolbar({
  searchRef,
  sort,
  isPelicanMode,
  filteredCount,
  totalCount,
  selectableVisibleCount,
  allVisibleSelected,
  selectableDownshiftCount,
  onToggleSelectVisible,
  onSelectAllDownshift,
}: {
  searchRef: RefObject<HTMLInputElement | null>
  sort: 'status' | 'recent' | 'quota' | 'name' | 'pelican'
  isPelicanMode: boolean
  filteredCount: number
  totalCount: number
  selectableVisibleCount: number
  allVisibleSelected: boolean
  selectableDownshiftCount: number
  onToggleSelectVisible: () => void
  onSelectAllDownshift: () => void
}) {
  const settings = useStore((s) => s.settings)
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)
  const updateSettings = useStore((s) => s.updateSettings)

  const layoutSwitchRef = useRef<HTMLDivElement>(null)
  const layoutPill = useSlidingIndicator(layoutSwitchRef, isPelicanMode ? null : settings.layout)

  return (
    <div className="overview-toolbar">
      <div className="search">
        <Icon.Search />
        <input
          ref={searchRef}
          type="text"
          role="searchbox"
          placeholder="搜索凭证名称、认证文件或模型"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.stopPropagation()
              if (e.currentTarget.value) setFilters({ search: '' })
              else e.currentTarget.blur()
            }
          }}
          aria-label="搜索凭证或模型"
        />
        {filters.search ? (
          <button
            type="button"
            className="search-clear"
            onClick={() => setFilters({ search: '' })}
            aria-label="清除搜索"
          >
            ✕
          </button>
        ) : (
          <kbd className="search-kbd" aria-hidden="true">
            /
          </kbd>
        )}
      </div>

      <div className="toolbar-actions">
        <HoverCard compact placement="top" content="全选或取消当前可见页的可选凭证">
          <button
            type="button"
            className="btn btn-sm"
            disabled={selectableVisibleCount === 0}
            aria-pressed={allVisibleSelected}
            onClick={onToggleSelectVisible}
          >
            <Icon.CheckAll />
            <span>{allVisibleSelected ? '取消本页' : '全选本页'}</span>
          </button>
        </HoverCard>

        {selectableDownshiftCount > 0 && filters.verdict !== 'downshift' && (
          <HoverCard compact placement="top" content="一键选中所有当前判定为风控的可选凭证">
            <button type="button" className="btn btn-sm" onClick={onSelectAllDownshift}>
              <Dot tone="downshift" />
              <span>选中风控 ({selectableDownshiftCount})</span>
            </button>
          </HoverCard>
        )}

        {(filters.verdict !== 'all' || Boolean(filters.search.trim())) && (
          <HoverCard compact placement="top" content="清除搜索与筛选条件，恢复全部显示">
            <button
              type="button"
              className="filter-reset-pill"
              onClick={() => setFilters({ search: '', verdict: 'all' })}
              aria-label={`当前筛选 ${filteredCount} / ${totalCount} 个，点击清除筛选`}
            >
              <span>
                筛选 {filteredCount}/{totalCount}
              </span>
              <Icon.Close />
            </button>
          </HoverCard>
        )}

        <Select
          ariaLabel="排序方式"
          value={sort}
          onChange={(next) =>
            setFilters({
              sort: next === 'pelican' ? null : (next as 'status' | 'recent' | 'quota' | 'name'),
            })
          }
          options={[
            ...(isPelicanMode ? [{ value: 'pelican', label: '按画作优先' }] : []),
            { value: 'status', label: '按状态优劣' },
            { value: 'recent', label: '按最近检测' },
            { value: 'quota', label: '按剩余额度' },
            { value: 'name', label: '按名称' },
          ]}
        />

        <HoverCard
          compact
          placement="top"
          disabled={!isPelicanMode}
          content="画鹈鹕模式固定使用 SVG 相册卡片布局；切回糖果或指纹后恢复多布局切换"
        >
          <div
            ref={layoutSwitchRef}
            className={`segmented layout-switch${isPelicanMode ? ' is-pelican-locked' : ''}`}
            data-sliding={!isPelicanMode && layoutPill.ready ? 'true' : undefined}
            role="group"
            aria-label="布局切换"
          >
            {!isPelicanMode && layoutPill.ready && (
              <span
                className="sliding-pill"
                data-animate={layoutPill.animate ? 'true' : undefined}
                aria-hidden="true"
                style={
                  {
                    '--pill-x': `${layoutPill.x}px`,
                    '--pill-w': `${layoutPill.w}px`,
                  } as CSSProperties
                }
              />
            )}
            {LAYOUTS.map((item) => {
              const collapsing = isPelicanMode && item.value !== 'card'
              const lockedCard = isPelicanMode && item.value === 'card'
              return (
                <button
                  key={item.value}
                  type="button"
                  className={collapsing ? 'is-collapsing' : lockedCard ? 'is-locked-card' : undefined}
                  disabled={collapsing}
                  tabIndex={collapsing ? -1 : undefined}
                  aria-hidden={collapsing ? true : undefined}
                  aria-pressed={isPelicanMode ? item.value === 'card' : settings.layout === item.value}
                  onClick={() => {
                    if (!isPelicanMode) updateSettings({ layout: item.value })
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </HoverCard>
      </div>
    </div>
  )
}
