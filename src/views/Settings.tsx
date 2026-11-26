import { useState } from 'react'
import { Segmented } from '../components/ui'
import { useSettingsEditor } from '../store/settingsEditor'
import { ScheduleEditor } from '../components/settings/ScheduleEditor'
import { GroupRoutingEditor } from '../components/settings/GroupRoutingEditor'
import { PrefixEditor } from '../components/settings/PrefixEditor'
import { RequestHeadersEditor } from '../components/settings/RequestHeadersEditor'
import { ClearHistoryPanel } from '../components/settings/ClearHistoryPanel'
import { RetryEditor } from '../components/settings/RetryEditor'
import { QuotaThresholdPanel } from '../components/settings/QuotaThresholdPanel'
import { InspectionMethodPanel } from '../components/settings/InspectionMethodPanel'
import { InspectionModelPanel } from '../components/settings/InspectionModelPanel'
import { DataSourcePanel, PaginationPanel } from '../components/settings/PaginationPanel'

type SettingsSection = 'all' | 'routing' | 'inspection' | 'model' | 'display' | 'data'

const SECTIONS: { value: SettingsSection; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'routing', label: '分组路由' },
  { value: 'inspection', label: '巡检与重试' },
  { value: 'model', label: '模型与请求头' },
  { value: 'display', label: '定时与显示' },
  { value: 'data', label: '数据维护' },
]

export function SettingsView() {
  const { settings } = useSettingsEditor()
  const [section, setSection] = useState<SettingsSection>('all')

  return (
    <>
      <div className="settings-top">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h2>设置</h2>
            <div className="sub">修改先保留为草稿，点击底部「确认保存」后生效。切换页面前会提醒保存。</div>
          </div>
        </div>

        <div className="settings-nav">
          <Segmented
            ariaLabel="设置分类筛选"
            value={section}
            onChange={setSection}
            options={SECTIONS}
          />
        </div>
      </div>

      {section === 'all' && (
        <div className="settings-masonry">
          <div className="settings-col">
            <PrefixEditor />
            {settings.routing.mode === 'priority' && <GroupRoutingEditor />}
            <InspectionMethodPanel />
            <InspectionModelPanel />
            <PaginationPanel />
            <DataSourcePanel />
          </div>
          <div className="settings-col">
            <QuotaThresholdPanel />
            <RetryEditor />
            <RequestHeadersEditor />
            <ScheduleEditor />
            <ClearHistoryPanel />
          </div>
        </div>
      )}

      {section === 'routing' &&
        (settings.routing.mode === 'priority' ? (
          <div className="settings-masonry">
            <div className="settings-col">
              <PrefixEditor />
            </div>
            <div className="settings-col">
              <GroupRoutingEditor />
            </div>
          </div>
        ) : (
          <div className="settings-full-stack">
            <PrefixEditor wide={settings.routing.mode === 'prefix'} />
          </div>
        ))}

      {section === 'inspection' && (
        <div className="settings-masonry">
          <div className="settings-col">
            <QuotaThresholdPanel />
            <InspectionMethodPanel />
          </div>
          <div className="settings-col">
            <RetryEditor />
          </div>
        </div>
      )}

      {section === 'model' && (
        <div className="settings-masonry">
          <div className="settings-col">
            <InspectionModelPanel />
          </div>
          <div className="settings-col">
            <RequestHeadersEditor />
          </div>
        </div>
      )}

      {section === 'display' && (
        <div className="settings-masonry">
          <div className="settings-col">
            <ScheduleEditor />
          </div>
          <div className="settings-col">
            <PaginationPanel />
          </div>
        </div>
      )}

      {section === 'data' && (
        <div className="settings-masonry">
          <div className="settings-col">
            <DataSourcePanel />
          </div>
          <div className="settings-col">
            <ClearHistoryPanel />
          </div>
        </div>
      )}
    </>
  )
}
