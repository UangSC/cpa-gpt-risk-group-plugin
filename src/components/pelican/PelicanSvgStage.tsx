import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/store'
import type { InspectionRound, Target } from '../../types'

export function latestPelicanRound(target: Target | null | undefined): InspectionRound | null {
  if (!target) return null
  return target.rounds.find((round) => Boolean(round.evidence.pelican) || round.tests.includes('pelican')) ?? null
}

export function latestPelicanSvgRound(target: Target | null | undefined): InspectionRound | null {
  if (!target) return null
  return target.rounds.find((round) => Boolean(round.evidence.pelican?.svg)) ?? null
}

export function formatSvgBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function buildPelicanSrcDoc(svg: string, colorScheme: 'light' | 'dark' = 'light'): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${colorScheme}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
<style>
  :root {
    color-scheme: ${colorScheme};
  }
  html, body {
    color-scheme: ${colorScheme};
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: transparent !important;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  body > svg {
    display: block;
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    overflow: hidden;
  }
</style>
</head>
<body>${svg}</body>
</html>`
}

export function PelicanSvgFrame({
  svg,
  title,
  colorScheme,
  interactive = false,
  lazy = true,
}: {
  svg: string
  title: string
  colorScheme?: 'light' | 'dark'
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

  const srcDoc = useMemo(() => buildPelicanSrcDoc(svg, resolvedScheme), [svg, resolvedScheme])

  return (
    <div ref={wrapRef} className={`pelican-svg-frame-wrap${interactive ? ' is-interactive' : ''}`}>
      {inView ? (
        <iframe
          key={resolvedScheme}
          sandbox=""
          srcDoc={srcDoc}
          title={title}
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
