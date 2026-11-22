import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { cancelTask } from '../store/actions'
import { batchScopeLabel, buildHistoryBatches, type HistoryBatch } from '../lib/historyBatches'
import { InspectionBatch } from './InspectionBatch'
import { InspectionBatchItems } from './InspectionBatchItems'
import { Chip, Drawer, Icon, useNow } from './ui'

function TaskBlock({ batch, now, open, onToggle }: { batch: HistoryBatch; now: number; open: boolean; onToggle: () => void }) {
  const openDetail = useStore((s) => s.openDetail)
  const task = batch.task!
  const finished = task.items.filter((item) => ['done', 'skipped', 'cancelled', 'failed'].includes(item.state)).length
  const done = task.items.filter((item) => item.state === 'done').length
  const skipped = task.items.filter((item) => item.state === 'skipped').length
  const cancelled = task.items.filter((item) => item.state === 'cancelled').length
  const failed = task.items.filter((item) => item.state === 'failed').length
  const total = task.items.length
  return <InspectionBatch batchId={batch.id} startedAt={batch.startedAt} open={open} onToggle={onToggle}
    progress={total ? finished / total * 100 : 0} metadata={<>
      <Chip tone={task.status === 'running' ? 'accent' : task.status === 'cancelled' ? 'uncertain' : 'plain'} dot>
        {task.status === 'running' ? '进行中' : task.status === 'cancelled' ? '已停止' : '已完成'}
      </Chip>
      <span>{batchScopeLabel(batch)}</span><span>已处理 {finished}/{total}</span>
      {!!done && <span>完成 {done}</span>}{!!skipped && <span>跳过 {skipped}</span>}
      {!!cancelled && <span>取消 {cancelled}</span>}{!!failed && <span>失败 {failed}</span>}
    </>}>
    <InspectionBatchItems entries={batch.entries} now={now} onOpenDetail={openDetail} recent />
  </InspectionBatch>
}

export function RunPanel() {
  const open = useStore((s) => s.runPanelOpen)
  const setOpen = useStore((s) => s.setRunPanel)
  const tasks = useStore((s) => s.tasks)
  const targets = useStore((s) => s.targets)
  const credentials = useStore((s) => s.credentials)
  const connected = useStore((s) => s.connection === 'connected')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (open) {
      setClosing(true)
      return
    }
    if (!closing) return
    const timer = window.setTimeout(() => setClosing(false), 280)
    return () => window.clearTimeout(timer)
  }, [open, closing])
  const active = open || closing
  const now = useNow(5_000, active)
  const batches = useMemo(() => (active ? buildHistoryBatches(targets, credentials, tasks) : []), [active, targets, credentials, tasks])
  const running = tasks.find((task) => task.status === 'running')
  const runningBatch = running ? batches.find((batch) => batch.task?.id === running.id) : undefined
  const recent = tasks.filter((task) => task.id !== running?.id).slice(0, 4)
    .map((task) => batches.find((batch) => batch.task?.id === task.id)).filter((batch): batch is HistoryBatch => !!batch)
  const renderBatch = (batch: HistoryBatch) => {
    const batchOpen = expanded[batch.id] ?? (running ? batch.task?.status === 'running' : batch.id === recent[0]?.id)
    return <TaskBlock key={batch.id} batch={batch} now={now} open={batchOpen}
      onToggle={() => setExpanded((current) => ({ ...current, [batch.id]: !batchOpen }))} />
  }

  return <Drawer className="run-panel" open={open} onClose={() => { setExpanded({}); setOpen(false) }} title="巡检任务" sub={running ?
    running.items.filter((item) => ['done', 'skipped', 'cancelled', 'failed'].includes(item.state)).length + ' / ' + running.items.length + ' 个凭证已处理' :
    tasks.length ? '最近 ' + tasks.length + ' 批巡检' : '还没有执行过巡检'}
    head={running ? <button type="button" className="btn btn-sm btn-danger" disabled={!connected} onClick={() => cancelTask(running.id)}><Icon.Stop />停止</button> : undefined}>
    {runningBatch ? renderBatch(runningBatch) : <div className="empty drawer-empty">
      <div className="empty-icon"><Icon.History /></div><h4>当前没有进行中的巡检</h4>
      <p>在凭证列表中勾选对象后点击「巡检选中」，或使用「巡检全部」。</p>
    </div>}
    {!!recent.length && <><div className="history-day">最近批次</div>{recent.map(renderBatch)}</>}
  </Drawer>
}
