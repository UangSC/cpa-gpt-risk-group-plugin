import { useEffect, useState } from 'react'
import type { Credential, InspectionRound, PelicanEvidence, Target } from '../../types'
import { useStore } from '../../store/store'
import { judgePelicanVerdict } from '../../store/actions'
import { activeInspectionCredentialIds } from '../../store/exclusions'
import { isManuallyExcluded } from '../../lib/derive'
import { Chip, Collapse, Icon } from '../ui'
import {
  downloadPelicanHtml,
  formatPelicanBytes,
  hasPelicanArtwork,
  pelicanByteCount,
} from '../../lib/pelican'
import { PelicanSvgFrame } from '../pelican/PelicanSvgStage'

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
  const targets = useStore((s) => s.targets)
  const maskNames = useStore((s) => s.settings.maskNames)
  const [sourceCopied, setSourceCopied] = useState(false)

  useEffect(() => {
    setSourceCopied(false)
  }, [target.id, round.id])

  const hasArtwork = hasPelicanArtwork(pelican)
  const totalBytes = pelicanByteCount(pelican)
  const sourceCode = pelican.html?.trim() || pelican.svg?.trim() || ''
  const sourceLabel = pelican.html?.trim() ? 'HTML 源码' : 'SVG 源码'

  const judgedVerdict =
    pelican.judgedVerdict ??
    (round.outcome === 'normal' || round.outcome === 'downshift' ? round.outcome : null)
  const isRunningTarget = activeInspectionCredentialIds({ tasks, targets }).includes(target.credentialId)
  const canJudge =
    (hasArtwork || totalBytes > 0) &&
    connection === 'connected' &&
    Boolean(credential && !credential.disabled && !isManuallyExcluded(credential)) &&
    !judging.includes(credential?.id ?? '') &&
    !isRunningTarget

  const handleDownload = () => {
    const ok = downloadPelicanHtml(pelican, {
      credentialId: target.credentialId,
      credentialName: credential?.name,
      finishedAt: round.finishedAt,
      maskNames,
    })
    if (!ok) {
      useStore.getState().notify({
        tone: 'warning',
        title: '下载失败',
        detail: '当前环境暂不支持触发本地 HTML 下载。',
      })
    }
  }

  return (
    <div className="ev-section">
      <h4>
        画鹈鹕 HTML 动画
        {pelican.strictFormat ? (
          <Chip tone="normal">严格格式</Chip>
        ) : hasArtwork ? (
          <Chip tone="uncertain">宽容提取</Chip>
        ) : (
          <Chip tone="downshift">无效输出</Chip>
        )}
      </h4>
      <dl className="kv">
        <dt>格式说明</dt>
        <dd>{pelican.strictFormat ? '严格符合 ```html 规范' : pelican.formatNote}</dd>
        <dt>人工分组结论</dt>
        <dd>
          {judgedVerdict === 'normal'
            ? '已手动判为正常'
            : judgedVerdict === 'downshift'
              ? '已手动判为风控'
              : hasArtwork || totalBytes > 0
                ? '待肉眼观察判定'
                : '无有效画作'}
        </dd>
        {totalBytes > 0 && (
          <>
            <dt>文件体积</dt>
            <dd className="mono">{formatPelicanBytes(totalBytes)}</dd>
          </>
        )}
      </dl>

      {hasArtwork ? (
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
            <PelicanSvgFrame html={pelican.html} svg={pelican.svg ?? ''} title="本轮鹈鹕动画" lazy={false} />
          </div>
          <div className="ev-pelican-bar">
            <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm" onClick={onOpenLightbox}>
                <Icon.Expand />
                <span>大图审片</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={handleDownload}>
                <Icon.Download />
                <span>下载 HTML</span>
              </button>
            </div>
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
            title={sourceLabel}
            hint={formatPelicanBytes(totalBytes)}
            action={
              <span className="inline" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={handleDownload}
                >
                  <Icon.Download />
                  <span>下载</span>
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(sourceCode)
                      setSourceCopied(true)
                      window.setTimeout(() => setSourceCopied(false), 1600)
                    } catch {
                      useStore.getState().notify({
                        tone: 'warning',
                        title: '复制失败',
                        detail: '当前环境未授予剪贴板写入权限。',
                      })
                    }
                  }}
                >
                  {sourceCopied ? <Icon.Check /> : <Icon.Copy />}
                  <span>{sourceCopied ? '已复制' : '复制'}</span>
                </button>
              </span>
            }
          >
            <pre className="pelican-code-viewer">{sourceCode}</pre>
          </Collapse>
        </>
      ) : pelican.svgPruned ? (
        <p className="note">为控制状态文件体积，仅保留最近 3 轮完整动画源码；更早轮次的源码已清理。</p>
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
