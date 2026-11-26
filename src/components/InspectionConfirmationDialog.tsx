import { useEffect, useState } from 'react'
import { useStore } from '../store/store'
import { acknowledgeInspection } from '../store/actions'
import { Icon, Modal } from './ui'
import type { Settings } from '../types'

function ConfigurationPreview({ settings }: { settings: Settings }) {
  const prefix = (value: string) => value ? `${value.replace(/\/+$/, '')}/` : '不加前缀'
  const entries = settings.routing.mode === 'none'
    ? [['分组策略', '仅检测（不修改分组与优先级）']]
    : settings.routing.mode === 'prefix'
      ? [['正常组', prefix(settings.prefixes.normal)], ['风控组', prefix(settings.prefixes.downshift)]]
      : [['正常组', String(settings.routing.groups.normal.priority)], ['未分组', String(settings.routing.groups.ungrouped.priority)], ['风控组', String(settings.routing.groups.downshift.priority)]]
  return <div className="consent-config-preview">{entries.map(([name, value]) =>
    <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
}

export function InspectionConfirmationDialog() {
  const pending = useStore((state) => state.inspectionConfirmation)
  const scheduled = useStore((state) => state.pendingSettingsConfirmation)
  const starting = useStore((state) => state.starting)
  const saving = useStore((state) => state.settingsSaving)
  const connection = useStore((state) => state.connection)
  const error = useStore((state) => pending ? state.inspectionConfirmError : state.settingsConfirmError)
  const running = useStore((state) => state.tasks.some((task) => task.status === 'running'))
  const [rememberNextTime, setRememberNextTime] = useState(false)
  useEffect(() => setRememberNextTime(false), [pending?.revision, pending?.scope, !!pending])
  const settings = pending?.settings ?? scheduled
  if (!settings) return null
  const isScheduled = !pending && !!scheduled
  const busy = starting || saving
  const isPelican = settings.inspectionMethod === 'pelican'
  const isNone = settings.routing.mode === 'none'
  const doesNotAutoWrite = isNone || isPelican
  const field = settings.routing.mode === 'prefix' ? '模型前缀' : '优先级'
  const close = () => {
    const state = useStore.getState()
    if (isScheduled) state.closeSettingsConfirmation()
    else state.closeInspectionConfirmation()
  }
  const scheduledQuotaMin = settings.schedule.minRemainingPercent ?? settings.quota.minRemainingPercent
  const sessionPolicy = settings.schedule.busySessionPolicy ?? 'under-limit'
  const sessionLimit = settings.schedule.maxBusySessions ?? 3
  const sessionPolicyText = sessionPolicy === 'always'
    ? '始终巡检（无论是否有活跃会话）'
    : sessionPolicy === 'skip-busy'
      ? '存在活跃会话时跳过'
      : `并发会话 < ${sessionLimit} 时巡检，否则跳过`

  return <Modal open onClose={close} className="inspection-consent"
    title={isPelican
      ? (isScheduled ? '确认定时鹈鹕绘画计划' : '确认开始鹈鹕绘画')
      : doesNotAutoWrite
        ? (isScheduled ? '确认定时巡检计划' : '确认开始巡检')
        : (isScheduled ? '确认定时巡检配置修改' : '巡检将修改凭证配置')}
    sub={isPelican
      ? (isScheduled ? '保存计划前，请确认后续后台生成鹈鹕 SVG 动画的执行范围' : '确认后仅执行 SVG 动画绘制，不自动更改凭证分组')
      : doesNotAutoWrite
        ? (isScheduled ? '保存计划前，请确认后续后台巡检范围与执行规则' : '确认后开始执行本次巡检')
        : (isScheduled ? '保存计划前，请了解后续后台巡检的配置写入行为' : '确认后才会开始执行本次巡检')}
    footer={<><button type="button" className="btn" disabled={busy} onClick={close}>取消</button><span className="spacer" />
      <button type="button" className="btn btn-primary" disabled={busy || connection !== 'connected' || (isScheduled && running)} onClick={() => {
        if (isScheduled) void useStore.getState().saveSettingsDraft(true)
        else void acknowledgeInspection(rememberNextTime)
      }}>{busy ? '正在提交…' : '我已知晓'}</button></>}>
    <div className="consent-introduction"><span className="consent-icon"><Icon.Doc /></span>
      <p>{isPelican
        ? <>本次仅请求模型输出「鹈鹕骑自行车」内联 SVG 循环动画，<strong>不会自动修改</strong>凭证的模型前缀、分组或优先级。{!isNone && <>待绘画完成后点击卡片分组按钮时，再按已配置的<strong>【{field}】</strong>规则同步。</>}</>
        : isNone
          ? (isScheduled ? '后续巡检会按计划在后台执行，' : '本次巡检') + '仅执行检测并记录结果与依据，不会修改凭证的模型前缀、分组或优先级。'
          : <>{isScheduled ? '后续巡检会按计划在后台执行，无需逐次打开页面，并可能根据结果修改凭证的' : '本次巡检会根据检测结果修改所选凭证的'}<strong>【{field}】</strong>配置。</>}</p>
    </div>
    {pending && <div className="consent-scope"><div><span>本次参与</span><strong>{pending.credentialIds.length} 个凭证</strong></div>
      <div><span>不参与巡检池</span><strong>{pending.excludedCount} 个 · 已排除</strong></div></div>}
    <ConfigurationPreview settings={settings} />
    {Object.keys(settings.headerOverrides ?? {}).length > 0 && <p className="consent-note">已设置请求头覆盖，巡检会按这些规则准备专用请求头映射；遇到凭证已有同名规则时不强行覆盖。</p>}
    <p className="consent-note">检测模型 {settings.inspectionModel} · 思考程度 {({ low: '低 (low)', medium: '中 (medium)', high: '高 (high)' } as const)[settings.reasoningEffort ?? 'low']}</p>
    <p className="consent-note">Free 账号：{settings.inspectFreeAccounts ? '已强制纳入本轮巡检范围' : '默认不参与巡检（仅展示状态与月限额度）'}。</p>
    {settings.inspectionMethod === 'fingerprint' && <p className="consent-note">模型指纹要求目标参考匹配，且目标概率严格大于 {settings.fingerprintThresholdPercent}%。</p>}
    {isScheduled && <p className="consent-note">定时额度门槛：剩余额度高于 {scheduledQuotaMin}% · 活跃会话策略：{sessionPolicyText}。</p>}
    <p className="consent-note">权重保持继承。不参与巡检的凭证不会加入任务，原配置及历史保持不变。{!isNone && field === '优先级' && '凭证单独设置的优先级覆盖仍保留。'}</p>
    {isScheduled && <p className="consent-note">关闭定时计划后不会产生新任务；修改计划或影响检测、分组写入的设置时需重新确认。</p>}
    {!isScheduled && <div className="consent-reminder-preference"><label><input className="checkbox" type="checkbox" checked={rememberNextTime} disabled={busy} onChange={(event) => setRememberNextTime(event.target.checked)} />下次不再提醒</label>
      <p>仅用于手动巡检；分组写入规则或管理员变化后会重新提醒。</p></div>}
    {error && <p className="consent-error" role="alert">{error}</p>}
  </Modal>
}
