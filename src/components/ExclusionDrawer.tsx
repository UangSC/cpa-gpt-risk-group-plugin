import { useEffect, useMemo, useState } from 'react'
import type { Credential } from '../types'
import { buildViews, type CredentialView } from '../lib/derive'
import { formatRelative } from '../lib/format'
import { VERDICT_LABEL } from '../lib/rules'
import { activeInspectionCredentialIds, setCredentialExclusions } from '../store/exclusions'
import { useStore } from '../store/store'
import { Chip, Drawer, Icon, PlanBadge, QuotaMeter, SecretName, useNow } from './ui'
import { StatusLights } from './StatusLights'
import { isEditingTarget } from '../lib/keyboard'

export function ExclusionIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 5.3h11v7.4a.8.8 0 0 1-.8.8H3.3a.8.8 0 0 1-.8-.8V5.3Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M2 2.6h12v2.7H2V2.6Zm4 5.2h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function ExcludedCredential({ view, selected, onSelect, disabled, now }: {
  view: CredentialView
  selected: boolean
  onSelect: () => void
  disabled: boolean
  now: number
}) {
  const credential = view.credential
  const threshold = useStore((state) => state.settings.quota.minRemainingPercent)
  const openDetail = useStore((state) => state.openDetail)
  const updating = useStore((state) => state.excluding.includes(credential.id))
  return <article className={`excluded-credential tone-${view.verdict} ${selected ? 'is-selected' : ''}`} data-credential-id={credential.id} data-inspection-excluded="true">
    <div className="excluded-card-head">
      <label className="excluded-card-selection"><input className="checkbox" type="checkbox" checked={selected} disabled={disabled} onChange={onSelect} aria-label={`选择 ${credential.name} 恢复参与巡检`} /></label>
      <SecretName name={credential.name} className="excluded-card-name" />
      <PlanBadge plan={credential.plan} size="sm" />
    </div>
    <div className="excluded-card-labels">
      <span className="excluded-state"><ExclusionIcon />不参与巡检</span>
      <Chip tone={view.verdict === 'untested' ? 'plain' : view.verdict}>原结论：{VERDICT_LABEL[view.verdict]}</Chip>
      {credential.disabled && <Chip tone="uncertain">CPA 已停用</Chip>}
      {credential.auth === 'expired' && <Chip tone="downshift">认证失效</Chip>}
      {!credential.disabled && credential.unavailable && <Chip tone="uncertain">暂不可用</Chip>}
      {credential.sync.status === 'failed' && <Chip tone="uncertain">配置待同步</Chip>}
    </div>
    <div className="excluded-card-history">
      <span>近期</span>
      <StatusLights target={view.target} limit={7} onOpen={(roundId) => view.target && openDetail(view.target.id, roundId)} />
      <span className="excluded-history-time">{view.lastCheckedAt ? formatRelative(view.lastCheckedAt, now) : '未检测'}</span>
    </div>
    <div className="excluded-card-quota">
      <QuotaMeter windows={credential.quota.windows} threshold={threshold} />
      {!credential.quota.windows.length && <span className="excluded-secondary">额度未知</span>}
    </div>
    <div className="excluded-card-config">
      <span>原分组 <strong>{credential.group === 'normal' ? '正常' : credential.group === 'downshift' ? '降档' : '未分组'}</strong></span>
      <span>优先级 <strong>{credential.routing?.priority ?? '未知'}</strong></span>
      <span>权重 <strong>{credential.routing?.weight ?? '未知'}</strong></span>
    </div>
    <div className="excluded-card-prefix"><span>当前前缀</span><code>{typeof credential.prefix === 'string' ? credential.prefix || '无前缀' : '未知'}</code></div>
    <div className="excluded-card-foot">
      <span className="excluded-secondary">{credential.disabled ? '请先在 CPA 启用' : credential.excludedAt ? `${formatRelative(credential.excludedAt, now)}移入` : '已从巡检范围排除'}</span>
      {view.target && <button type="button" className="btn btn-sm btn-ghost" onClick={() => openDetail(view.target!.id, view.target!.rounds[0]?.id ?? null)}>查看依据</button>}
      <button type="button" className="btn btn-sm excluded-restore" disabled={disabled} onClick={() => void setCredentialExclusions([credential.id], false)} aria-label={`恢复 ${credential.name} 参与巡检`}>
        <Icon.Refresh />{updating ? '恢复中' : '恢复参与'}
      </button>
    </div>
  </article>
}

/** 与卡片移入过程分开：抽屉只承担排除池管理和只读依据查看。 */
export function ExclusionDrawer() {
  const open = useStore((state) => state.exclusionDrawerOpen)
  const close = useStore((state) => state.setExclusionDrawerOpen)
  const credentials = useStore((state) => state.credentials)
  const targets = useStore((state) => state.targets)
  const settings = useStore((state) => state.settings)
  const tasks = useStore((state) => state.tasks)
  const excluding = useStore((state) => state.excluding)
  const syncing = useStore((state) => state.syncing)
  const connection = useStore((state) => state.connection)
  const starting = useStore((state) => state.starting)
  const now = useNow(30_000)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const excluded = useMemo(() => credentials.filter((credential) => credential.inspectionExcluded), [credentials])
  const views = useMemo(() => buildViews(excluded, targets, settings), [excluded, targets, settings])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return views.filter(({ credential }) => !query || [credential.name, credential.file, ...credential.models].join(' ').toLowerCase().includes(query))
  }, [views, search])
  const busyIds = useMemo(() => activeInspectionCredentialIds({ tasks, targets }), [tasks, targets])
  const disabledFor = (credential: Credential) => credential.disabled || connection !== 'connected' || starting || excluding.includes(credential.id) || syncing.includes(credential.id) || busyIds.includes(credential.id)
  const restorable = filtered.filter((view) => !disabledFor(view.credential))
  const manualPool = excluded.filter((credential) => !credential.disabled)
  const chosen = selected.filter((id) => manualPool.some((credential) => credential.id === id))
  const restoreChosen = chosen.filter((id) => excluded.some((credential) => credential.id === id && !disabledFor(credential)))
  const allChecked = !!restorable.length && restorable.every((view) => chosen.includes(view.credential.id))
  const canRestoreAll = !!manualPool.length && manualPool.every((credential) => !disabledFor(credential))
  useEffect(() => { setSelected((current) => current.filter((id) => excluded.some((credential) => credential.id === id && !credential.disabled))) }, [excluded])
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  return <Drawer open={open} onClose={() => close(false)} title="不参与巡检"
    onEscape={(event) => {
      if (isEditingTarget(event.target) || chosen.length === 0) return false
      setSelected([])
      return true
    }}
    sub="这里显示在 CPA 停用或手动排除的凭证，均不参加手动、批量或定时巡检。"
    className="exclusion-drawer"
    head={<span className="exclusion-drawer-count">{excluded.length}</span>}>
    <div className="exclusion-drawer-content">
      <div className="exclusion-drawer-policy"><ExclusionIcon /><span>原分类、历史、模型前缀、优先级与权重保持不变。</span></div>
      <div className="exclusion-drawer-search"><Icon.Search /><input className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索不参与巡检的凭证" aria-label="搜索不参与巡检的凭证" /></div>
      <div className="exclusion-drawer-toolbar">
        <label><input className="checkbox" type="checkbox" checked={allChecked} disabled={!restorable.length} onChange={() => setSelected((current) => allChecked ? current.filter((id) => !restorable.some((view) => view.credential.id === id)) : [...new Set([...current, ...restorable.map((view) => view.credential.id)])])} />全选当前结果</label>
        <span>{search ? `${filtered.length} / ${excluded.length}` : excluded.length} 个凭证</span>
      </div>
      <div className="exclusion-drawer-cards">
        {filtered.length ? filtered.map((view) => <ExcludedCredential key={view.credential.id} view={view} selected={chosen.includes(view.credential.id)} onSelect={() => toggle(view.credential.id)} disabled={disabledFor(view.credential)} now={now} />)
          : <div className="empty drawer-empty"><div className="empty-icon"><ExclusionIcon /></div><h4>{search ? '没有匹配的凭证' : '暂无不参与巡检的凭证'}</h4><p>{search ? '更换搜索词，或清空搜索查看全部凭证。' : '在凭证卡片或批量操作中点击“排除”，即可移入这里。'}</p></div>}
      </div>
      <div className="exclusion-drawer-footer">
        <div><strong>{chosen.length ? `已选择 ${chosen.length} 个` : '恢复后回到原分类'}</strong><span>恢复参与不会自动开始巡检。</span></div>
        <div className="exclusion-footer-actions">
          {chosen.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected([])}>清除选择</button>}
          <button type="button" className="btn btn-sm" disabled={!canRestoreAll} onClick={() => void setCredentialExclusions(manualPool.map((credential) => credential.id), false)}>全部恢复</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!restoreChosen.length} onClick={() => void setCredentialExclusions(restoreChosen, false)}>恢复已选 <span>{restoreChosen.length}</span></button>
        </div>
      </div>
    </div>
  </Drawer>
}
