import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/store'
import { buildPelicanSrcDoc } from '../../lib/pelican'

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
