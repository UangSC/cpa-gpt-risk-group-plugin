import { useEffect, useMemo, useRef, useState } from 'react'
import type { Credential } from '../types'
import { useStore } from '../store/store'
import { isManuallyExcluded } from '../lib/derive'
import { CHART_TOOLTIP_DELAY_MS } from '../lib/tooltipInteraction'
import { hasOpenDialog, isCompositionEvent, isEditingTarget, isPlainShortcut } from '../lib/keyboard'
import { Chip, HoverCard, Icon, PlanMark, SecretName, Select, useNow } from '../components/ui'
import { CredentialPager, credentialPage } from '../components/credentials/CredentialPager'
import { formatDateTimePrecise, formatDuration, formatNumber } from '../lib/format'
import { DEFAULT_SETTINGS } from '../data/defaults'
import {
  summarizeInspections,
  type AccountInspectionStatistics,
  type DailyInspectionStatistics,
  type InspectionMetrics,
  type StatisticsRange,
} from '../lib/inspectionStatistics'

const OUTCOMES = [
  ['normal', '正常', 'var(--normal-dot)'],
  ['downshift', '风控', 'var(--danger-dot)'],
  ['uncertain', '不确定', 'var(--warn-dot)'],
  ['incomplete', '未完成', 'var(--neutral-dot)'],
] as const

const nameOrder = new Intl.Collator('zh-CN', { numeric: true })
const percent = (count: number, total: number) => total ? Math.round(count / total * 100) + '%' : '—'
const dateLabel = (date: string) => date.slice(5).replace('-', '/')

function TrendChart({ days, account }: { days: DailyInspectionStatistics[]; account?: AccountInspectionStatistics }) {
  const counts = days.map((day) => account ? account.days.get(day.date) : day)
  const peak = Math.max(...counts.map((value) => value?.total ?? 0))
  const summarizeDay = (index: number) => {
    const day = counts[index]
    return days[index].date + (day?.total ? ' · ' + OUTCOMES.map(([key, label]) => label + ' ' + day[key]).join(' · ') : ' · 无巡检')
  }

  return <figure className="stats-trend">
    <div className="stats-trend-plot" role="img" aria-label={counts.some((day) => day?.total)
      ? days.map((_, index) => summarizeDay(index)).join('；') : '所选日期内无巡检'}>
      {days.map((day, index) => {
        const value = counts[index]
        const tipContent = (
          <>
            <div className="tip-title">
              {day.date} · {value?.total ? `${value.total} 轮巡检` : '暂无巡检'}
            </div>
            {value?.total ? (
              OUTCOMES.map(([key, label, color]) =>
                value[key] > 0 ? (
                  <div className="tip-row" key={key}>
                    <span className="tip-k" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <i style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color, display: 'inline-block' }} />
                      {label}
                    </span>
                    <span className="tip-v">{value[key]} 轮</span>
                  </div>
                ) : null,
              )
            ) : (
              <div className="tip-row">
                <span className="tip-v">当日无巡检记录</span>
              </div>
            )}
          </>
        )
        return (
          <HoverCard
            key={day.date}
            showDelay={CHART_TOOLTIP_DELAY_MS}
            fadeOnHide={false}
            placement="top"
            wrapperClassName="stats-trend-day-wrap"
            content={tipContent}
          >
            <div className="stats-trend-day" aria-label={summarizeDay(index)}>
              {value?.total ? OUTCOMES.map(([key]) => value[key] > 0 &&
                <span key={key} style={{ height: `${value[key] / peak * 100}%`, backgroundColor: OUTCOMES.find(([k]) => k === key)![2] }} />)
                : <span className="stats-trend-empty" />}
            </div>
          </HoverCard>
        )
      })}
    </div>
    <figcaption>
      <time dateTime={days[0].date}>{dateLabel(days[0].date)}</time>
      <span>单日最多 {peak} 轮</span>
      <time dateTime={days.at(-1)!.date}>{dateLabel(days.at(-1)!.date)}</time>
    </figcaption>
  </figure>
}

function QualityMetric({ label, count, total }: { label: string; count: number; total: number }) {
  return <div className="stats-quality-metric">
    <div><span>{label}</span><strong>{percent(count, total)}</strong></div>
    <div className="stats-track" aria-hidden="true"><span style={{ width: total ? percent(count, total) : '0%' }} /></div>
    <small>{total ? `${formatNumber(count)} / ${formatNumber(total)}` : '暂无样本'}</small>
  </div>
}

function Latency({ metrics }: { metrics?: InspectionMetrics }) {
  return (
    <HoverCard
      compact
      showDelay={CHART_TOOLTIP_DELAY_MS}
      wrapperClassName="stats-latency-wrap"
      content={`基于 ${metrics?.durationCount ?? 0} 轮记录的执行耗时，含重试等待`}
    >
      <div className="stats-latency">
        <div><span>耗时中位数</span><strong>{formatDuration(metrics?.p50Ms)}</strong></div>
        <div><span>P95 耗时</span><strong>{formatDuration(metrics?.p95Ms)}</strong></div>
      </div>
    </HoverCard>
  )
}

function AccountCard({ credential, stats, days }: {
  credential: Credential
  stats?: AccountInspectionStatistics
  days: DailyInspectionStatistics[]
}) {
  const latest = stats?.latestAt
  return <article className="stats-panel stats-account">
    <header className="stats-account-header">
      <div className="stats-account-identity">
        <PlanMark plan={credential.plan} size="sm" />
        <SecretName name={credential.name} />
      </div>
      {credential.disabled ? <Chip>已关闭</Chip> : isManuallyExcluded(credential) ? <Chip>免检</Chip> : null}
    </header>
    <div className="stats-account-volume">
      <strong>{formatNumber(stats?.total ?? 0)}</strong><span>轮巡检</span>
      <span className="stats-account-outcomes">
        {OUTCOMES.map(([key, label, color]) => (
          <HoverCard key={key} compact showDelay={CHART_TOOLTIP_DELAY_MS} content={`${label} ${stats?.[key] ?? 0} 轮`}>
            <span className="stats-outcome-item" aria-label={`${label} ${stats?.[key] ?? 0} 轮`}>
              <i style={{ backgroundColor: color }} aria-hidden="true" />
              {stats?.[key] ?? 0}
            </span>
          </HoverCard>
        ))}
      </span>
    </div>
    {stats ? <TrendChart days={days} account={stats} /> : <div className="stats-account-empty">所选范围内无巡检记录</div>}
    <div className="stats-quality-pair">
      <QualityMetric label="糖果题答对率" count={stats?.matched ?? 0} total={stats?.candy ?? 0} />
      <QualityMetric label="指纹样本有效率" count={stats?.accepted ?? 0} total={stats?.samples ?? 0} />
    </div>
    <Latency metrics={stats} />
    <footer className="stats-account-footer">最近巡检 {latest ? <time dateTime={latest}>{formatDateTimePrecise(latest).slice(0, 16)}</time> : '—'}</footer>
  </article>
}

export function Statistics() {
  const targets = useStore((s) => s.targets)
  const credentials = useStore((s) => s.credentials)
  const pageSize = useStore((s) => s.settings.pagination?.statistics ?? DEFAULT_SETTINGS.pagination.statistics)
  const [model, setModel] = useState('')
  const [range, setRange] = useState<StatisticsRange>(7)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('downshift')
  const [page, setPage] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (hasOpenDialog() || isEditingTarget(event.target) || isCompositionEvent(event) || !isPlainShortcut(event, '/')) return
      event.preventDefault()
      window.setTimeout(() => searchRef.current?.focus(), 0)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const now = useNow()
  const models = useMemo(() => [...new Set(targets.map((target) => target.model))].sort(), [targets])
  const activeModel = models.includes(model) ? model : ''
  const { days, accounts, totals } = useMemo(() => summarizeInspections(targets, activeModel, now, range), [targets, activeModel, now, range])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return credentials.filter((credential) => credential.name.toLowerCase().includes(term)).sort((left, right) => {
      const a = accounts.get(left.id)
      const b = accounts.get(right.id)
      const byName = () => nameOrder.compare(left.name, right.name)
      if (sort === 'name') return byName()
      const latestFirst = (b?.latestAt ? Date.parse(b.latestAt) : 0) - (a?.latestAt ? Date.parse(a.latestAt) : 0)
      if (sort === 'latest') return latestFirst || byName()
      return (b?.downshift ?? 0) - (a?.downshift ?? 0) || latestFirst || byName()
    })
  }, [accounts, credentials, query, sort])
  const pagination = credentialPage(filtered, page, pageSize)
  const covered = credentials.reduce((count, credential) => count + Number(accounts.has(credential.id)), 0)

  return <>
    <div className="page-head stats-head">
      <div>
        <h2>巡检统计</h2>
        <div className="sub">按北京时间的巡检结束日汇总 · 每个账号与模型组合最多保留最近 40 轮
          {accounts.size > covered && ' · 总览含已移除账号的留存记录'}
        </div>
      </div>
      <div className="stats-controls">
        <Select
          ariaLabel="统计模型"
          value={activeModel}
          onChange={(next) => { setModel(next); setPage(0) }}
          options={[
            { value: '', label: '全部模型' },
            ...models.map((name) => ({ value: name, label: name })),
          ]}
        />
        <Select
          ariaLabel="统计日期范围"
          value={String(range)}
          onChange={(next) => { setRange(Number(next) as StatisticsRange); setPage(0) }}
          options={[
            { value: '7', label: '近 7 天' },
            { value: '14', label: '近 14 天' },
            { value: '30', label: '近 30 天' },
          ]}
        />
      </div>
    </div>
    <dl className="stats-kpis">
      <div><dt>巡检轮次</dt><dd>{formatNumber(totals.total)}</dd></div>
      <div><dt>账号覆盖</dt><dd>{formatNumber(covered)} <small>/ {formatNumber(credentials.length)}</small></dd></div>
      <div><dt>已判定结果中风控占比</dt><dd>{percent(totals.downshift, totals.normal + totals.downshift)}</dd></div>
      <div>
        <HoverCard compact showDelay={CHART_TOOLTIP_DELAY_MS} content="耗时的第 95 百分位，含重试等待">
          <dt>P95 耗时</dt>
        </HoverCard>
        <dd>{formatDuration(totals.p95Ms)}</dd>
      </div>
    </dl>
    <div className="stats-grid">
      <section className="stats-panel stats-overview-trend">
        <h3>每日巡检结论</h3>
        <div className="stats-legend">{OUTCOMES.map(([key, label, color]) => <span key={key}>
          <i style={{ backgroundColor: color }} />{label}<b>{formatNumber(totals[key])}</b>
        </span>)}</div>
        <TrendChart days={days} />
      </section>
      <section className="stats-panel stats-overview-quality">
        <h3>回答质量与耗时</h3>
        <QualityMetric label="糖果题答对率" count={totals.matched} total={totals.candy} />
        <QualityMetric label="指纹样本有效率" count={totals.accepted} total={totals.samples} />
        <Latency metrics={totals} />
      </section>
    </div>

    <section className="stats-accounts" aria-label="账号统计">
      <header className="stats-accounts-heading">
        <div className="stats-accounts-title">
          <h3>账号统计</h3>
          <p>{formatNumber(filtered.length)} 个账号</p>
        </div>
        <div className="stats-controls stats-account-filters">
          <div className="search">
            <Icon.Search />
            <input
              ref={searchRef}
              type="text"
              role="searchbox"
              aria-label="搜索统计账号"
              placeholder="搜索账号"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.stopPropagation()
                  if (event.currentTarget.value) { setQuery(''); setPage(0) }
                  else event.currentTarget.blur()
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className="search-clear"
                onClick={() => { setQuery(''); setPage(0) }}
                aria-label="清除搜索"
              >
                <Icon.Close />
              </button>
            ) : (
              <kbd className="search-kbd" aria-hidden="true">/</kbd>
            )}
          </div>
          <Select
            ariaLabel="账号统计排序"
            value={sort}
            onChange={(next) => { setSort(next); setPage(0) }}
            options={[
              { value: 'downshift', label: '风控次数优先' },
              { value: 'latest', label: '最近巡检优先' },
              { value: 'name', label: '按账号名称' },
            ]}
          />
        </div>
      </header>
      {pagination.total ? <div className="stats-accounts-grid">{pagination.items.map((credential) =>
        <AccountCard key={credential.id} credential={credential} stats={accounts.get(credential.id)} days={days} />)}</div>
        : <div className="stats-panel stats-accounts-empty">{credentials.length ? '没有符合搜索条件的账号' : '当前没有账号'}</div>}
      {pagination.pages > 1 && <CredentialPager page={pagination.page} pages={pagination.pages} total={pagination.total}
        pageSize={pagination.size} onPage={setPage} label="账号统计" />}
    </section>
  </>
}
