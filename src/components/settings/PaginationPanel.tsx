import { useStore } from '../../store/store'
import { useSettingsEditor } from '../../store/settingsEditor'
import { DEFAULT_SETTINGS, PAGINATION_FIELDS } from '../../data/defaults'
import { Chip, Icon } from '../ui'
import { SettingsPanel as Panel } from './SettingsPanel'

export function PaginationPanel() {
  const { settings, update } = useSettingsEditor()

  return (
    <Panel icon={<Icon.Grid />} title="分页数量" desc="分别设置列表、卡片、双栏和账号统计每页显示的凭证数量。">
      <div className="pagination-settings">
        {PAGINATION_FIELDS.map(({ key, label, max }) => (
          <div className="field" key={key}>
            <label className="field-label" htmlFor={`pagination-${key}`}>
              {label}每页
            </label>
            <div className="input-group input-compact">
              <input
                id={`pagination-${key}`}
                type="number"
                min={1}
                max={max}
                step={1}
                value={settings.pagination?.[key] ?? DEFAULT_SETTINGS.pagination[key]}
                aria-label={`${label}每页凭证数`}
                onChange={(event) => {
                  const size = Math.max(1, Math.min(max, Math.trunc(Number(event.target.value)) || 1))
                  update({ pagination: { ...DEFAULT_SETTINGS.pagination, ...settings.pagination, [key]: size } })
                }}
              />
              <span className="unit">个</span>
            </div>
          </div>
        ))}
      </div>
      <p className="pagination-setting-hint">
        默认列表 10 个、卡片 12 个、双栏每栏 4 个、账号统计 4 个。卡片模式会按当前视口自动适配每行列数，并将每页数量对齐为整行，避免末行缺口；双栏各自翻页，「巡检全部」包含所有符合条件的凭证。
      </p>
    </Panel>
  )
}

export function DataSourcePanel() {
  const connection = useStore((s) => s.connection)
  const sourceDetail = useStore((s) => s.sourceDetail)

  return (
    <Panel
      icon={<Icon.Info />}
      title="数据来源"
      desc="凭证、额度与检测记录来自 CPA 官方管理接口与插件本地状态。"
      badge={
        <Chip tone={connection === 'connected' ? 'normal' : 'uncertain'} dot>
          {connection === 'connected' ? '实时数据' : '未连接'}
        </Chip>
      }
    >
      <div className="field-hint" style={{ marginTop: 0 }}>
        {sourceDetail || '已连接 CLIProxyAPI 官方管理接口，配置确认保存后立即持久化。'}
      </div>
    </Panel>
  )
}
