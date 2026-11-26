import { useEffect, useState } from 'react'
import { roundTone } from '../lib/derive'
import { formatClock } from '../lib/format'
import { RUN_STATE_LABEL, type HistoryBatchEntry } from '../lib/historyBatches'
import { inspectionResult, resolvedRoundReason, roundErrorInfo } from '../lib/inspectionResult'
import { REASON_LABEL, testLabel } from '../lib/rules'
import type { InspectionRound } from '../types'
import { Chip, Dot, PlanMark, SecretName, type ChipTone } from './ui'

const stateTone = (state: string): ChipTone => state === 'running' ? 'accent' : state === 'waiting' || state === 'retrying' ? 'uncertain' : state === 'failed' ? 'downshift' : 'plain'

function RoundDescription({ round, targetModel, fallback }: { round: InspectionRound; targetModel: string; fallback: string }) {
  const result = inspectionResult(round)
  if (result?.kind === 'fingerprint') {
    return <span className="inspection-fingerprint-result">
      <span>三次模型指纹归因完成，目标为 <strong>{targetModel}</strong></span>
      <span>当前概率 {(result.probability * 100).toFixed(2)}% 为：<strong>{result.model}</strong></span>
    </span>
  }
  if (result?.kind === 'candy') {
    return <>巡检成功：{result.answer == null ? '未提取到数字答案' : <code className="inspection-answer">{`{"ANSWER": ${result.answer}}`}</code>}</>
  }
  if (result?.kind === 'pelican') {
    if (result.judgedVerdict === 'normal' || round.outcome === 'normal') return <>画鹈鹕人工判定：<strong>正常</strong></>
    if (result.judgedVerdict === 'downshift' || round.outcome === 'downshift') return <>画鹈鹕人工判定：<strong className="inspection-request-error">风控</strong></>
    return <>已生成鹈鹕 SVG 动画，待肉眼判定分组</>
  }
  if (result?.kind === 'request-error') {
    return (
      <strong className="inspection-request-error">
        巡检失败：
        {result.codesSummary
          ? `请求返回 ${result.codesSummary}`
          : result.lastCodeLabel
            ? result.lastCodeLabel
            : result.status == null
              ? '请求异常'
              : `错误码 HTTP ${result.status}`}
      </strong>
    )
  }
  return fallback
}

function EntryContent({ entry, now, recent }: { entry: HistoryBatchEntry; now: number; recent: boolean }) {
  const { round, item, target, credential } = entry
  const outcome = round?.outcome
  const tone = round ? roundTone(round) : item?.state === 'running' ? 'uncertain' : 'empty'
  const label = round ? outcome === 'normal' ? '正常' : outcome === 'downshift' ? '风控' : outcome === 'uncertain' ? '不确定' : outcome === 'cancelled' ? '已取消' : '未能检测'
    : item ? RUN_STATE_LABEL[item.state] : '未完成'
  const statusTone: ChipTone = round ? outcome === 'normal' ? 'normal' : outcome === 'downshift' ? 'downshift' : outcome === 'uncertain' ? 'uncertain' : 'plain' : stateTone(item?.state ?? '')
  const model = target?.model ?? entry.targetId.split('::').at(-1) ?? '未知模型'
  const fallback = item?.state === 'done' ? '检测已完成，详细证据不在当前保留历史中' : item?.state === 'skipped' ? '本次已跳过此凭证'
    : item?.state === 'cancelled' ? '该凭证检测已取消' : item?.state === 'failed' ? '本次未取得完整检测结果' : '等待完整检测结果'
  const requesting = item?.state === 'running' && item.attempt > 0
  const note = round ? `${REASON_LABEL[round.reasonCode] ?? round.reasonCode} — ${resolvedRoundReason(round)}` : requesting ? '' : item?.note ?? fallback
  const noteIsError = Boolean(
    round
      ? round.outcome === 'blocked' || round.outcome === 'downshift' || roundErrorInfo(round).hasError
      : item?.state === 'failed',
  )
  const retryTime = item?.retryAt ? Date.parse(item.retryAt) : NaN
  const retrySeconds = item?.state === 'retrying' && Number.isFinite(retryTime) ? Math.max(0, Math.ceil((retryTime - now) / 1000)) : null
  const testNames = round ? testLabel(round.tests) : item?.currentTest ? testLabel([item.currentTest]) : null
  const modelParts = /^gpt-(\d+(?:\.\d+)*)(?:-(sol|astra|terra))?$/i.exec(model)
  const modelFamily = modelParts?.[2]
  const shortModel = modelParts ? modelParts[1] + (modelFamily ? modelFamily[0].toUpperCase() + modelFamily.slice(1).toLowerCase() : '') : model
  const effort = round?.reasoningEffort
  const effortLabel = effort ? effort[0].toUpperCase() + effort.slice(1) : '未记录'
  const badges = <>
    {recent ? <Chip>{testNames ?? '巡检'} · {shortModel} · {effortLabel}</Chip> : testNames && <Chip>{testNames}</Chip>}
    {round?.sync?.status === 'failed' && <Chip tone="downshift">同步失败</Chip>}
  </>
  return <>
    {recent ? <span className="recent-entry-status" aria-label={outcome === 'uncertain' ? '未知' : label}>
      <Chip tone={statusTone}>{Array.from(outcome === 'uncertain' ? '未知' : label).map((character, index) =>
        <span key={index} aria-hidden="true">{character}</span>)}</Chip>
    </span> : <Dot tone={tone} />}
    <span className="history-main">
      <span className="history-title">
        {credential && <PlanMark plan={credential.plan} size="sm" />}
        <span className="name">{credential ? <SecretName name={credential.name} /> : '凭证已删除'}</span>
        {!recent && <><Chip tone={statusTone}>{label}</Chip>{badges}</>}
      </span>
      <span className={recent ? 'recent-entry-result' : undefined}><span className="history-sub">{recent
        ? <>{badges}{round ? <RoundDescription round={round} targetModel={model} fallback={note} /> : note}</>
        : <><span className="mono">{model}</span>{note && <> · <span className={noteIsError ? 'inspection-request-error' : undefined}>{note}</span></>}</>}</span></span>
    </span>
    <span className="history-side">
      {round ? <time dateTime={round.finishedAt}>{formatClock(round.finishedAt).slice(0, 5)}</time>
        : requesting ? <strong className="inspection-request-progress">第 {item.attempt} 次请求中</strong>
          : retrySeconds != null ? <span>{retrySeconds > 0 ? `等待 ${retrySeconds} 秒后重试` : '即将重试'}</span>
            : !item?.attempt ? <span>尚未发起请求</span> : null}
    </span>
  </>
}

export function InspectionBatchItems({ entries, now, onOpenDetail, recent = false }: {
  entries: HistoryBatchEntry[]
  now: number
  recent?: boolean
  onOpenDetail: (targetId: string, roundId?: string | null) => void
}) {
  const hasRetrying = entries.some((entry) => !entry.round && entry.item?.state === 'retrying')
  const [retryNow, setRetryNow] = useState(now)
  useEffect(() => {
    if (!hasRetrying) return
    setRetryNow(Date.now())
    const timer = window.setInterval(() => setRetryNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasRetrying])
  const displayNow = hasRetrying ? Math.max(now, retryNow) : now
  return <div className={recent ? 'history-list recent-batch-list' : 'history-list'} role="list">
    {entries.map((entry) => <div role="listitem" key={entry.id}>
      {entry.round ? <button type="button" className="history-item inspection-batch-entry" onClick={() => onOpenDetail(entry.targetId, entry.round!.id)} aria-label="查看该凭证本轮依据">
        <EntryContent entry={entry} now={displayNow} recent={recent} />
      </button> : <div className="history-item inspection-batch-entry is-pending"><EntryContent entry={entry} now={displayNow} recent={recent} /></div>}
    </div>)}
  </div>
}
