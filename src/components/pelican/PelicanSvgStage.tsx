import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/store'
import type { InspectionRound, PelicanEvidence, Target } from '../../types'

export function hasPelicanArtwork(pelican: PelicanEvidence | null | undefined): boolean {
  return Boolean(pelican?.html?.trim() || pelican?.svg?.trim())
}

export function latestPelicanRound(target: Target | null | undefined): InspectionRound | null {
  if (!target) return null
  return target.rounds.find((round) => Boolean(round.evidence.pelican) || round.tests.includes('pelican')) ?? null
}

export function latestPelicanSvgRound(target: Target | null | undefined): InspectionRound | null {
  if (!target) return null
  return target.rounds.find((round) => hasPelicanArtwork(round.evidence.pelican)) ?? null
}

export function pelicanByteCount(pelican: PelicanEvidence | null | undefined): number {
  if (!pelican) return 0
  return pelican.htmlBytes || pelican.svgBytes || new TextEncoder().encode(pelican.html || pelican.svg || '').length
}

export function formatSvgBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

const PELICAN_SANDBOX_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';">`

function buildAdaptiveStageStyle(colorScheme: 'light' | 'dark', forceBackdrop: boolean): string {
  const backdropOverride = forceBackdrop ? 'background: transparent !important;' : ''
  return `<style data-cpa-pelican-fit>
  :root { color-scheme: ${colorScheme}; }
  html, body {
    color-scheme: ${colorScheme};
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    ${backdropOverride}
  }
  body > div:has(svg),
  body > main:has(svg),
  body > section:has(svg),
  body > figure:has(svg) {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    flex: 1 1 auto !important;
    ${backdropOverride}
  }
  svg:not(svg svg) {
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    flex: 1 1 auto !important;
  }
</style>`
}

export function buildPelicanSrcDoc({
  html,
  svg = '',
  colorScheme = 'light',
  invertContrast = false,
}: {
  html?: string
  svg?: string
  colorScheme?: 'light' | 'dark'
  invertContrast?: boolean
}): string {
  const fitStyle = buildAdaptiveStageStyle(colorScheme, invertContrast || !html?.trim())
  // 固定前置策略，模型在 <head> 前输出的脚本和注释也无法绕过 CSP。
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${colorScheme}">
${PELICAN_SANDBOX_CSP}
${fitStyle}
</head>
<body>${html?.trim() ? html : svg}
${fitStyle}</body>
</html>`
}

export function buildPelicanDownloadHtml(pelican: PelicanEvidence, title = '鹈鹕骑自行车 SVG 2D 动画'): string {
  if (!hasPelicanArtwork(pelican)) return ''
  const escapeHTML = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
  const source = buildPelicanSrcDoc({ html: pelican.html, svg: pelican.svg })
  const escapedTitle = escapeHTML(title)
  // 独立打开下载文件时继续使用无同源权限的沙箱，动画脚本只在画布内执行。
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <style>
    html, body, iframe {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #f8fafc;
    }
    iframe {
      display: block;
      border: 0;
    }
  </style>
</head>
<body>
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="${escapedTitle}" srcdoc="${escapeHTML(source)}"></iframe>
</body>
</html>
`
}

export function downloadPelicanHtml(
  pelican: PelicanEvidence,
  meta: {
    credentialId: string
    credentialName?: string
    finishedAt?: string
    maskNames?: boolean
  },
): boolean {
  const htmlContent = buildPelicanDownloadHtml(
    pelican,
    meta.maskNames || !meta.credentialName ? '鹈鹕骑自行车 SVG 2D 动画' : `鹈鹕骑自行车 - ${meta.credentialName}`,
  )
  if (!htmlContent.trim()) return false
  const dateObj = meta.finishedAt ? new Date(meta.finishedAt) : new Date()
  const stamp = Number.isNaN(dateObj.getTime())
    ? 'latest'
    : `${dateObj.getFullYear()}${String(dateObj.getMonth() + 1).padStart(2, '0')}${String(dateObj.getDate()).padStart(2, '0')}-${String(dateObj.getHours()).padStart(2, '0')}${String(dateObj.getMinutes()).padStart(2, '0')}`
  const rawIdentity =
    meta.maskNames || !meta.credentialName
      ? 'credential'
      : meta.credentialName.replace(/[^A-Za-z0-9._\u4e00-\u9fa5-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) ||
        'credential'
  const filename = `pelican-${rawIdentity}-${stamp}.html`
  try {
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    return true
  } catch {
    return false
  }
}

export function PelicanSvgFrame({
  html,
  svg = '',
  title,
  colorScheme,
  invertContrast = false,
  interactive = false,
  lazy = true,
}: {
  html?: string
  svg?: string
  title: string
  colorScheme?: 'light' | 'dark'
  invertContrast?: boolean
  interactive?: boolean
  lazy?: boolean
}) {
  const storeTheme = useStore((s) => s.settings.theme)
  const resolvedScheme = colorScheme ?? storeTheme
  const wrapRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(!lazy)

  useEffect(() => {
    if (!lazy) {
      setInView(true)
      return
    }
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '320px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [lazy])

  const srcDoc = useMemo(
    () => buildPelicanSrcDoc({ html, svg, colorScheme: resolvedScheme, invertContrast }),
    [html, svg, resolvedScheme, invertContrast],
  )

  return (
    <div ref={wrapRef} className={`pelican-svg-frame-wrap${interactive ? ' is-interactive' : ''}`}>
      {inView ? (
        <iframe
          key={`${resolvedScheme}:${invertContrast ? 'inv' : 'std'}`}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          title={title}
          referrerPolicy="no-referrer"
          loading={lazy ? 'lazy' : 'eager'}
          tabIndex={-1}
          style={{ colorScheme: resolvedScheme }}
          className={`pelican-svg-iframe${interactive ? ' is-interactive' : ''}`}
        />
      ) : (
        <div className="pelican-svg-placeholder" aria-hidden="true" />
      )}
    </div>
  )
}
