import { useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { lowestQuota } from '../lib/derive'
import { failureRuleSentence, quotaSentence, retrySentence } from '../lib/rules'
import { Chip, Collapse, Icon, Segmented, Select } from '../components/ui'
import { useSettingsEditor } from '../store/settingsEditor'
import { ScheduleEditor } from '../components/ScheduleEditor'
import { QuotaOverview } from '../components/QuotaOverview'
import { GroupRoutingEditor } from '../components/GroupRoutingEditor'
import { PrefixEditor } from '../components/PrefixEditor'
import { SettingsPanel as Panel } from '../components/SettingsPanel'
import { getInspectionMethod, listInspectionMethods } from '../inspection'
import { restoreManualReminder } from '../lib/manualInspectionConsent'
import { restoreWeightZeroWarning } from '../lib/weightZeroWarning'
import { RequestHeadersEditor } from '../components/RequestHeadersEditor'
import { formatSeconds } from '../lib/format'
import { ClearHistoryPanel } from '../components/ClearHistoryPanel'
import { DEFAULT_SETTINGS, PAGINATION_FIELDS } from '../data/defaults'

type SettingsSection = 'all' | 'routing' | 'inspection' | 'model' | 'display' | 'data'

const SECTIONS: { value: SettingsSection; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'routing', label: '分组路由' },
  { value: 'inspection', label: '巡检与重试' },
  { value: 'model', label: '模型与请求头' },
  { value: 'display', label: '定时与显示' },
  { value: 'data', label: '数据维护' },
]

function RetryEditor() {
  const { settings, update } = useSettingsEditor()

  return (
    <Panel icon={<Icon.Refresh />} title="重试与频繁异常判定" desc="502/503/429 和无效回答按预算重试；同轮频繁异常可直接归为风控，糖果题答案不符直接判定。">
      <div className="field-row">
        <div className="field">
          <label className="field-label" htmlFor="retry-count">最大重试次数</label>
          <Select
            id="retry-count"
            ariaLabel="最大重试次数"
            value={String(settings.retry.maxRetries)}
            onChange={(next) =>
              update({ retry: { ...settings.retry, maxRetries: Number(next) } })
            }
            options={[0, 1, 2, 3, 4].map((n) => ({
              value: String(n),
              label: `${n} 次（本轮共用）`,
            }))}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="retry-delay">首次等待</label>
          <Select
            id="retry-delay"
            ariaLabel="首次等待"
            value={String(settings.retry.baseDelayMs)}
            onChange={(next) =>
              update({ retry: { ...settings.retry, baseDelayMs: Number(next) } })
            }
            disabled={settings.retry.maxRetries === 0}
            options={[...new Set([500, 1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, settings.retry.baseDelayMs])]
              .sort((a, b) => a - b)
              .map((ms) => ({
                value: String(ms),
                label: formatSeconds(ms),
              }))}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="retry-factor">退避倍数</label>
          <Select
            id="retry-factor"
            ariaLabel="退避倍数"
            value={String(settings.retry.backoffFactor)}
            onChange={(next) =>
              update({ retry: { ...settings.retry, backoffFactor: Number(next) } })
            }
            disabled={settings.retry.maxRetries === 0}
            options={[1, 1.5, 2, 3].map((f) => ({
              value: String(f),
              label: `×${f}`,
            }))}
          />
        </div>
      </div>

      <div className="field">
        <div className="field-label">单轮异常风控次数</div>
        <Segmented
          ariaLabel="单轮异常风控次数"
          value={String(settings.failureRule.requestThreshold ?? 3)}
          onChange={(value) => update({ failureRule: { ...settings.failureRule, requestThreshold: Number(value) } })}
          options={[2, 3, 4, 5].map((count) => ({ value: String(count), label: `${count} 次` }))}
        />
        <div className="field-hint">同一轮 502、503、429 达到次数门槛就立即归入风控，混合状态也累计。</div>
      </div>

      <div className="field">
        <div className="field-label">跨轮补充规则</div>
        <Segmented
          ariaLabel="连续巡检失败轮数"
          value={String(settings.failureRule.windowRounds)}
          onChange={(v) => update({ failureRule: { ...settings.failureRule, windowRounds: Number(v) } })}
          options={[2, 3, 4].map((n) => ({ value: String(n), label: `连续 ${n} 轮` }))}
        />
        <div className="field-hint">
          未达到单轮次数门槛时，连续多轮仍以 502/503/429 异常结束也会归为风控；完整通过会打断累计。
        </div>
      </div>

      <div className="rule-box">
        <div>
          <b>配置说明：</b>
          {retrySentence(settings.retry)}
        </div>
        <div style={{ marginTop: 4 }}>{failureRuleSentence(settings)}</div>
      </div>
    </Panel>
  )
}

export function SettingsView() {
  const { settings, update } = useSettingsEditor()
  const credentials = useStore((s) => s.credentials)
  const connection = useStore((s) => s.connection)
  const capabilities = useStore((s) => s.capabilities)
  const sourceDetail = useStore((s) => s.sourceDetail)
  const [section, setSection] = useState<SettingsSection>('all')

  const models = useMemo(
    () => [...new Set(credentials.flatMap((c) => c.models))].sort(),
    [credentials],
  )

  const quotaSummary = useMemo(() => {
    let runnable = 0
    let skipped = 0
    for (const credential of credentials) {
      const lowest = lowestQuota(credential)
      const isSkipped =
        credential.disabled ||
        credential.auth === 'expired' ||
        credential.quota.status === 'exhausted' ||
        (lowest == null ? settings.quota.unknownPolicy === 'skip' : lowest <= settings.quota.minRemainingPercent)
      if (isSkipped) skipped += 1
      else runnable += 1
    }
    return { runnable, skipped }
  }, [credentials, settings.quota.minRemainingPercent, settings.quota.unknownPolicy])

  const quotaPanel = (
    <Panel icon={<Icon.Shield />} title="额度门槛" desc="用于手动与批量巡检；定时巡检可在「定时巡检」中单独设置门槛。额度不足或未知都不等于模型风控。">
      <div className="field">
        <div className="field-label">仅检测剩余额度高于</div>
        <div className="input-group input-compact">
          <input
            type="number"
            min={0}
            max={100}
            value={settings.quota.minRemainingPercent}
            onChange={(e) => {
              const n = Math.min(100, Math.max(0, Number(e.target.value) || 0))
              update({ quota: { ...settings.quota, minRemainingPercent: n } })
            }}
            aria-label="最低剩余额度阈值"
          />
          <span className="unit">%</span>
        </div>
        <div className="field-hint">
          取该凭证所有已知额度窗口中剩余比例最低的一个来判断；等于阈值时不检测。
        </div>
      </div>

      <div className="field">
        <div className="field-label">额度未知时</div>
        <Segmented
          ariaLabel="额度未知时的处理"
          value={settings.quota.unknownPolicy}
          onChange={(v) => update({ quota: { ...settings.quota, unknownPolicy: v } })}
          options={[
            { value: 'check', label: '仍然检测' },
            { value: 'skip', label: '跳过' },
          ]}
        />
      </div>

      <div className="rule-box">{quotaSentence(settings)}</div>

      <Collapse
        title={`当前额度概览（可检测 ${quotaSummary.runnable} · 跳过 ${quotaSummary.skipped}）`}
        hint="默认折叠"
      >
        <QuotaOverview />
      </Collapse>
    </Panel>
  )

  const methodPanel = (
    <Panel icon={<Icon.Cog />} title="检测方式" desc="每轮只采用一种检测方式，默认使用糖果题。">
      <div className="field">
        <Segmented
          ariaLabel="选择检测项目"
          value={settings.inspectionMethod}
          onChange={(inspectionMethod) => update({ inspectionMethod })}
          options={listInspectionMethods().map((method) => ({
            value: method.id,
            label: method.label,
            disabled: method.id === 'fingerprint' && !capabilities.fingerprintAvailable,
          }))}
        />
        <div className="field-hint">
          {getInspectionMethod(settings.inspectionMethod).description} 所有题目共用本轮重试次数。
        </div>
        {settings.inspectionMethod === 'fingerprint' && (
          <div className="rule-box" style={{ marginTop: 8 }}>
            每个凭证完成三次有效数字挑战后，合并计算模型指纹概率。只有目标参考匹配且归因概率严格大于 90% 才算正常；等于 90% 也不通过。
            未收录模型或不足三份有效结果时保持不确定。默认检测方式仍为糖果题。
          </div>
        )}
      </div>

      <div className="field">
        <div className="field-label">同时检测的凭证数</div>
        <div className="input-group input-compact">
          <input
            type="number"
            min={1}
            max={9}
            value={settings.concurrency.maxObjects}
            onChange={(e) => {
              const n = Math.min(9, Math.max(1, Number(e.target.value) || 1))
              update({ concurrency: { maxObjects: n } })
            }}
            aria-label="同时检测的对象数"
          />
          <span className="unit">个 / 批</span>
        </div>
        <div className="field-hint">
          同时进行的对象数，同一凭证不会重复入队。
          {capabilities.availabilityKnown
            ? '会话中的凭证会等待空闲后再加入。'
            : 'CPA 当前未提供活跃会话计数，服务端按可用状态执行。'}
        </div>
      </div>
      <div className="field">
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              restoreManualReminder()
              useStore.getState().notify({
                tone: 'success',
                title: '已恢复手动巡检提醒',
                detail: '下次单个或批量手动巡检会再次显示配置修改提示。',
              })
            }}
          >
            恢复手动巡检提醒
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              restoreWeightZeroWarning()
              useStore.getState().notify({
                tone: 'success',
                title: '已恢复权重为 0 提醒',
                detail: '下次将凭证权重设为 0 时会再次弹出确认提醒。',
              })
            }}
          >
            恢复权重为 0 提醒
          </button>
        </div>
      </div>
    </Panel>
  )

  const modelPanel = (
    <Panel icon={<Icon.Cpu />} title="巡检模型" desc="所有凭证都用这一个模型做检测，检测结论按凭证分类。">
      <div className="field">
        <div className="field-label">检测使用的模型</div>
        <input
          className="input mono"
          list="model-options"
          value={settings.inspectionModel}
          onChange={(e) => update({ inspectionModel: e.target.value.trim() })}
          placeholder="gpt-6.1-sol"
          aria-label="检测使用的模型"
          spellCheck={false}
        />
        <datalist id="model-options">
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        <div className="field-hint">
          默认 <code className="inline-code">gpt-6.1-sol</code>。切换模型后，每个凭证会有一条新的检测记录；
          旧记录仍保留在历史里。分组按设置中的策略应用于凭证。
        </div>
      </div>

      <div className="field">
        <div className="field-label">思考程度</div>
        <Segmented
          ariaLabel="巡检模型思考程度"
          value={settings.reasoningEffort}
          onChange={(reasoningEffort) => update({ reasoningEffort })}
          options={[
            { value: 'low', label: '低 (low)' },
            { value: 'medium', label: '中 (medium)' },
            { value: 'high', label: '高 (high)' },
          ]}
        />
        <div className="field-hint">默认低（low），确认保存后用于每次巡检请求。</div>
      </div>

      <div className="field">
        <div className="field-label">可选模型</div>
        <div className="chips-input">
          {models.map((model) => (
            <button
              key={model}
              type="button"
              className="chip-toggle"
              aria-pressed={settings.inspectionModel === model}
              onClick={() => update({ inspectionModel: model })}
            >
              {model}
            </button>
          ))}
        </div>
        <div className="field-hint">来自当前凭证列表中的模型，也可以直接输入其它模型名。</div>
      </div>
    </Panel>
  )

  const paginationPanel = (
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

  const sourcePanel = (
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
            {methodPanel}
            {modelPanel}
            {paginationPanel}
            {sourcePanel}
          </div>
          <div className="settings-col">
            {quotaPanel}
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
            {quotaPanel}
            {methodPanel}
          </div>
          <div className="settings-col">
            <RetryEditor />
          </div>
        </div>
      )}

      {section === 'model' && (
        <div className="settings-masonry">
          <div className="settings-col">{modelPanel}</div>
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
          <div className="settings-col">{paginationPanel}</div>
        </div>
      )}

      {section === 'data' && (
        <div className="settings-masonry">
          <div className="settings-col">{sourcePanel}</div>
          <div className="settings-col">
            <ClearHistoryPanel />
          </div>
        </div>
      )}
    </>
  )
}
