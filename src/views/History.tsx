import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { batchScopeLabel, buildHistoryBatches, historyEntryMatches, historyEntryOutcome, type HistoryFilter } from '../lib/historyBatches'
import { InspectionBatch } from '../components/InspectionBatch'
import { InspectionBatchItems } from '../components/InspectionBatchItems'
import { Chip, Icon, Segmented, useNow } from '../components/ui'
import { hasOpenDialog, isCompositionEvent, isEditingTarget, isPlainShortcut } from '../lib/keyboard'

const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: '全部' }, { value: 'normal', label: '正常' }, { value: 'downshift', label: '风控' },
  { value: 'uncertain', label: '不确定' }, { value: 'incomplete', label: '未完成' },
]
const BATCH_PAGE_SIZE = 10

export function handleHistoryShortcut(event: KeyboardEvent, focusSearch: () => void): boolean {
  if (hasOpenDialog() || isEditingTarget(event.target) || isCompositionEvent(event) || !isPlainShortcut(event, '/')) return false
  event.preventDefault()
  focusSearch()
  return true
}

export function HistoryView({ onOpenDetail }: { onOpenDetail: (targetId: string, roundId?: string | null) => void }) {
  const targets = useStore((s) => s.targets)
  const credentials = useStore((s) => s.credentials)
  const tasks = useStore((s) => s.tasks)
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [visibleLimit, setVisibleLimit] = useState(BATCH_PAGE_SIZE)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => handleHistoryShortcut(event, () => searchRef.current?.focus())
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const now = useNow(5_000)
  const batches = useMemo(() => buildHistoryBatches(targets, credentials, tasks), [targets, credentials, tasks])
  const batchesById = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches])
  const entries = useMemo(() => batches.flatMap((batch) => batch.entries), [batches])
  const counts = useMemo(() => {
    const values = { all: entries.length, normal: 0, downshift: 0, uncertain: 0, incomplete: 0 }
    for (const entry of entries) values[historyEntryOutcome(entry)] += 1
    return values
  }, [entries])
  const filtered = useMemo(() => batches.map((batch) => ({
    ...batch, entries: batch.entries.filter((entry) => historyEntryMatches(entry, filter, query)),
  })).filter((batch) => batch.entries.length), [batches, filter, query])
  const visible = filtered.slice(0, visibleLimit)
  const visibleCount = visible.reduce((count, batch) => count + batch.entries.length, 0)

  return <>
    <div className="page-head">
      <div>
        <h2>检测历史</h2>
        <div className="sub">每批巡检按准确开始时间归档；展开查看该批凭证的结果、进行中进度和判定依据。</div>
      </div>
    </div>
    <div className="history-toolbar">
      <div className="search">
        <Icon.Search />
        <input ref={searchRef} type="search" placeholder="搜索凭证、模型或判定原因" value={query}
          onChange={(event) => { setQuery(event.target.value); setVisibleLimit(BATCH_PAGE_SIZE) }} aria-label="搜索历史记录" />
        {query ? (
          <button type="button" className="search-clear" onClick={() => { setQuery(''); setVisibleLimit(BATCH_PAGE_SIZE) }} aria-label="清除搜索">✕</button>
        ) : (
          <kbd className="search-kbd" aria-hidden="true">/</kbd>
        )}
      </div>
      <Segmented ariaLabel="按历史结论筛选" value={filter} onChange={(value) => {
        setFilter(value)
        setVisibleLimit(BATCH_PAGE_SIZE)
      }} options={FILTERS.map((option) => ({
        value: option.value, label: option.label, count: counts[option.value],
        tone: option.value === 'normal' ? 'normal' as const : option.value === 'downshift' ? 'downshift' as const :
          option.value === 'uncertain' ? 'uncertain' as const : option.value === 'incomplete' ? 'empty' as const : undefined,
      }))} />
      <span className="inspection-batch-summary" aria-live="polite">已显示 {visible.length} / {filtered.length} 批 · {visibleCount} 个凭证结果</span>
    </div>
    {!filtered.length ? <div className="empty">
      <div className="empty-icon"><Icon.History /></div>
      <h3>{entries.length ? '没有符合条件的历史' : '还没有检测记录'}</h3>
      <p>{entries.length ? '试试切换筛选条件或清空搜索词。' : '执行一次巡检后，这里会按批次保留判定依据与任务进度。'}</p>
    </div> : visible.map((batch) => {
      const original = batchesById.get(batch.id)!
      const running = batch.task?.status === 'running'
      const open = expanded[batch.id] ?? (batch.id === filtered[0]?.id)
      const outcomes = original.entries.reduce((values, entry) => { values[historyEntryOutcome(entry)] += 1; return values },
        { normal: 0, downshift: 0, uncertain: 0, incomplete: 0 })
      const finished = batch.task?.items.filter((item) => ['done', 'skipped', 'cancelled', 'failed'].includes(item.state)).length ?? original.entries.length
      return <InspectionBatch key={batch.id} batchId={batch.id} startedAt={batch.startedAt} open={open}
        onToggle={() => setExpanded((current) => ({ ...current, [batch.id]: !open }))}
        progress={running && batch.task?.items.length ? finished / batch.task.items.length * 100 : undefined}
        metadata={<>
          <Chip tone={running ? 'accent' : batch.task?.status === 'cancelled' ? 'uncertain' : 'plain'} dot>
            {running ? '进行中' : batch.task?.status === 'cancelled' ? '已停止' : '已完成'}
          </Chip>
          <span>{batchScopeLabel(batch)}</span>
          <span>{original.entries.length} 个凭证</span>
          {running && <span>已处理 {finished}/{batch.task!.items.length}</span>}
          {!!outcomes.normal && <Chip tone="normal">正常 {outcomes.normal}</Chip>}
          {!!outcomes.downshift && <Chip tone="downshift">风控 {outcomes.downshift}</Chip>}
          {!!outcomes.uncertain && <Chip tone="uncertain">不确定 {outcomes.uncertain}</Chip>}
          {!!outcomes.incomplete && <span>未完成 {outcomes.incomplete}</span>}
          {batch.entries.length !== original.entries.length && <span>匹配 {batch.entries.length} 个</span>}
        </>}>
        <InspectionBatchItems entries={batch.entries} now={now} onOpenDetail={onOpenDetail} />
      </InspectionBatch>
    })}
    {visible.length < filtered.length && <div className="inspection-batch-more">
      <button type="button" className="btn" onClick={() => setVisibleLimit((limit) => limit + BATCH_PAGE_SIZE)}>加载更多</button>
    </div>}
  </>
}
