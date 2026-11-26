import { useEffect, useState } from 'react'
import type { Credential, InspectionRound, PelicanEvidence, Target } from '../../types'
import { useStore } from '../../store/store'
import { judgePelicanVerdict } from '../../store/actions'
import { isManuallyExcluded } from '../../lib/derive'
import { Chip, Collapse, Icon } from '../ui'
import { PelicanSvgFrame, formatSvgBytes } from '../pelican/PelicanSvgStage'

export function PelicanEvidenceSection({
  pelican,
  round,
  target,
  credential,
  onOpenLightbox,
}: {
  pelican: PelicanEvidence
  round: InspectionRound
  target: Target
  credential: Credential | undefined
  onOpenLightbox: () => void
}) {
  const connection = useStore((s) => s.connection)
  const judging = useStore((s) => s.judging)
  const tasks = useStore((s) => s.tasks)
  const [svgCopied, setSvgCopied] = useState(false)

  useEffect(() => {
    setSvgCopied(false)
  }, [target.id, round.id])

  const judgedVerdict =
    pelican.judgedVerdict ??
    (round.outcome === 'normal' || round.outcome === 'downshift' ? round.outcome : null)
  const isRunningTarget = tasks.some(
    (task) => task.status === 'running' && task.items.some((item) => item.targetId === target.id),
  )
  const canJudge =
    Boolean(pelican.svg || pelican.svgBytes > 0) &&
    connection === 'connected' &&
    Boolean(credential && !credential.disabled && !isManuallyExcluded(credential)) &&
    !judging.includes(credential?.id ?? '') &&
    !isRunningTarget

  return (
    <div className="ev-section">
      <h4>
        画鹈鹕 SVG 动画
        {pelican.strictFormat ? (
          <Chip tone="normal">严格格式</Chip>
        ) : pelican.svg ? (
          <Chip tone="uncertain">宽容提取</Chip>
        ) : (
          <Chip tone="downshift">无效输出</Chip>
        )}
      </h4>
      <dl className="kv">
        <dt>格式说明</dt>
        <dd>{pelican.strictFormat ? '严格符合 ```svg 规范' : pelican.formatNote}</dd>
        <dt>人工分组结论</dt>
        <dd>
          {judgedVerdict === 'normal'
            ? '已手动判为正常'
            : judgedVerdict === 'downshift'
              ? '已手动判为风控'
              : pelican.svg || pelican.svgBytes > 0
                ? '待肉眼观察判定'
                : '无有效画作'}
        </dd>
        {pelican.svgBytes > 0 && (
          <>
            <dt>SVG 体积</dt>
            <dd className="mono">{formatSvgBytes(pelican.svgBytes)}</dd>
          </>
        )}
      </dl>

      {pelican.svg ? (
        <>
          <div
            className="ev-pelican-preview"
            role="button"
            tabIndex={0}
            aria-label="点击放大审看鹈鹕动画"
            onClick={onOpenLightbox}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpenLightbox()
              }
            }}
          >
            <PelicanSvgFrame svg={pelican.svg} title="本轮鹈鹕动画" lazy={false} />
          </div>
          <div className="ev-pelican-bar">
            <button type="button" className="btn btn-sm" onClick={onOpenLightbox}>
              <Icon.Expand />
              <span>大图审片</span>
            </button>
            {credential && (
              <div className="pelican-judge-group" role="group" aria-label="人工风控分组">
                <button
                  type="button"
                  className={`pelican-judge-btn is-normal${judgedVerdict === 'normal' ? ' is-selected' : ''}`}
                  aria-pressed={judgedVerdict === 'normal'}
                  disabled={!canJudge}
                  onClick={() => void judgePelicanVerdict(credential.id, 'normal', round.id, target.model)}
                >
                  <Icon.Check />
                  <span>判为正常</span>
                </button>
                <button
                  type="button"
                  className={`pelican-judge-btn is-downshift${judgedVerdict === 'downshift' ? ' is-selected' : ''}`}
                  aria-pressed={judgedVerdict === 'downshift'}
                  disabled={!canJudge}
                  onClick={() => void judgePelicanVerdict(credential.id, 'downshift', round.id, target.model)}
                >
                  <span className="pelican-judge-bang" aria-hidden="true">!</span>
                  <span>判为风控</span>
                </button>
              </div>
            )}
          </div>
          <Collapse
            title="SVG 源码"
            hint={formatSvgBytes(pelican.svgBytes || pelican.svg.length)}
            action={
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(pelican.svg!)
                    setSvgCopied(true)
                    window.setTimeout(() => setSvgCopied(false), 1600)
                  } catch {
                    useStore.getState().notify({
                      tone: 'warning',
                      title: '复制失败',
                      detail: '当前环境未授予剪贴板写入权限。',
                    })
                  }
                }}
              >
                {svgCopied ? <Icon.Check /> : <Icon.Copy />}
                <span>{svgCopied ? '已复制' : '复制'}</span>
              </button>
            }
          >
            <pre className="pelican-code-viewer">{pelican.svg}</pre>
          </Collapse>
        </>
      ) : pelican.svgPruned ? (
        <p className="note">为控制状态文件体积，仅保留最近 3 轮完整 SVG 源码；更早轮次的 SVG 源码已清理。</p>
      ) : pelican.rawSnippet ? (
        <pre className="answer is-mismatch">{pelican.rawSnippet}</pre>
      ) : null}

      {pelican.question && (
        <Collapse title="题目原文" hint="默认折叠">
          <pre className="question">{pelican.question}</pre>
        </Collapse>
      )}
    </div>
  )
}
