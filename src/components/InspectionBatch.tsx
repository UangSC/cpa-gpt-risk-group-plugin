import { useId, type ReactNode } from 'react'
import { formatBatchStartedAt } from '../lib/historyBatches'
import { Icon } from './ui'

export function InspectionBatch({ batchId, startedAt, open, onToggle, metadata, progress, children }: {
  batchId: string
  startedAt: string
  open: boolean
  onToggle: () => void
  metadata: ReactNode
  progress?: number
  children: ReactNode
}) {
  const contentId = useId()
  return (
    <section className="inspection-batch" data-inspection-batch={batchId} data-open={open}>
      <button type="button" className="inspection-batch-toggle" aria-expanded={open} aria-controls={contentId} onClick={onToggle}>
        <span className="inspection-batch-chevron" aria-hidden="true"><Icon.Chevron dir="right" /></span>
        <span className="inspection-batch-heading">
          <time className="inspection-batch-time mono" dateTime={startedAt}>{formatBatchStartedAt(startedAt)}</time>
          <span className="inspection-batch-metadata">{metadata}</span>
        </span>
        <span className="inspection-batch-hint">{open ? '收起' : '展开'}</span>
      </button>
      {progress != null && <div className="progress" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>}
      <div className="inspection-batch-content" id={contentId} hidden={!open}>{open ? children : null}</div>
    </section>
  )
}
