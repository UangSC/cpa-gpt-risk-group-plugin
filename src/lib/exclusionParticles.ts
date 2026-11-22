/** 本机卡片颗粒动画。只读取已渲染 DOM，不发送或持久化凭证内容。 */
export interface TransferPoint { x: number; y: number }
export interface TransferRect { left: number; top: number; width: number; height: number }
export interface ExclusionParticle {
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  size: number
  start: TransferPoint
  control1: TransferPoint
  control2: TransferPoint
  end: TransferPoint
  delay: number
  rotation: number
}
export interface ExclusionTransferOptions {
  signal?: AbortSignal
  durationMs?: number
  maxParticles?: number
}

const MAX_TRANSFERS = 3
const MAX_TOTAL_PARTICLES = 640
const MAX_CARD_PARTICLES = 256
type SnapshotWindow = Window & typeof globalThis
const SNAPSHOT_STYLES = [
  'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'top', 'right', 'bottom', 'left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'background-color', 'background-image', 'background-size', 'background-position', 'box-shadow',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration', 'text-overflow', 'white-space', 'word-break', 'overflow', 'opacity', 'filter',
  'flex', 'flex-direction', 'flex-wrap', 'align-items', 'align-self', 'justify-content', 'gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'transform', 'vertical-align',
  'appearance', 'object-fit', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
] as const
const targets = new Map<HTMLElement, number>()
const sources = new WeakSet<HTMLElement>()
const cleanups = new WeakMap<HTMLElement, { token: symbol; run: () => void }>()
let activeTransfers = 0
let activeParticles = 0

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const nameIsMasked = (element: Element) => (
  element.ownerDocument.documentElement.dataset.maskNames === 'true' && !!element.closest('.secret-name, [data-secret-name], [data-credential-name]')
) || !!element.closest('[data-mask="true"], [data-sensitive="true"]')
const fraction = (index: number, seed: number) => {
  const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453
  return value - Math.floor(value)
}

/** 路径计算独立于 DOM，末端始终落到入口上，而非在附近随机散开。 */
export function exclusionParticlePoint(particle: Pick<ExclusionParticle, 'start' | 'control1' | 'control2' | 'end'>, progress: number): TransferPoint {
  const t = clamp(Number.isFinite(progress) ? progress : 0, 0, 1)
  const u = 1 - t
  return {
    x: u ** 3 * particle.start.x + 3 * u ** 2 * t * particle.control1.x + 3 * u * t ** 2 * particle.control2.x + t ** 3 * particle.end.x,
    y: u ** 3 * particle.start.y + 3 * u ** 2 * t * particle.control1.y + 3 * u * t ** 2 * particle.control2.y + t ** 3 * particle.end.y,
  }
}

/** 分层采样覆盖整张卡片；每个颗粒绘制原卡片相应位置的像素。 */
export function buildExclusionParticles(rect: TransferRect, target: TransferPoint, requested = MAX_CARD_PARTICLES): ExclusionParticle[] {
  if (![rect.left, rect.top, rect.width, rect.height, target.x, target.y].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return []
  const budget = clamp(Math.floor(Number.isFinite(requested) ? requested : MAX_CARD_PARTICLES), 0, MAX_CARD_PARTICLES)
  if (!budget) return []
  const count = Math.min(budget, Math.max(1, Math.ceil(rect.width * rect.height / 200)))
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * rect.width / rect.height)))
  const rows = Math.max(1, Math.ceil(count / columns))
  const cellWidth = rect.width / columns, cellHeight = rect.height / rows
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns, row = Math.floor(index / columns)
    const width = Math.min(10, cellWidth), height = Math.min(10, cellHeight)
    const sourceX = clamp((column + 0.2 + fraction(index, 1) * 0.6) * cellWidth - width / 2, 0, Math.max(0, rect.width - width))
    const sourceY = clamp((row + 0.2 + fraction(index, 2) * 0.6) * cellHeight - height / 2, 0, Math.max(0, rect.height - height))
    const start = { x: rect.left + sourceX + width / 2, y: rect.top + sourceY + height / 2 }
    const end = { x: target.x, y: target.y }
    const dx = target.x - start.x, dy = target.y - start.y
    const arc = Math.min(190, Math.max(45, Math.abs(dx) * 0.18))
    return {
      sourceX, sourceY, sourceWidth: width, sourceHeight: height,
      size: clamp(4 + fraction(index, 3) * 5, 4, 9), start, end,
      control1: { x: start.x + Math.max(45, dx * 0.3), y: start.y - arc * (0.5 + fraction(index, 4)) },
      control2: { x: target.x - Math.max(20, dx * 0.14), y: target.y - Math.min(100, Math.abs(dy) * 0.2 + arc * 0.3) },
      delay: sourceX / rect.width * 0.34,
      rotation: (fraction(index, 5) - 0.5) * 1.5,
    }
  })
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

function backgroundColor(source: HTMLElement, view: SnapshotWindow): string {
  for (let element: HTMLElement | null = source; element; element = element.parentElement) {
    const color = view.getComputedStyle(element).backgroundColor
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)' && !color.endsWith(', 0)')) return color
  }
  return view.getComputedStyle(source.ownerDocument.documentElement).getPropertyValue('--surface').trim() || '#ffffff'
}

/** SVG foreignObject 的限制或 CSP 阻止快照时仍有完整的本机绘制降级。 */
function fallbackSnapshot(source: HTMLElement, rect: TransferRect, ratio: number, view: SnapshotWindow): HTMLCanvasElement | null {
  const canvas = source.ownerDocument.createElement('canvas')
  canvas.width = Math.ceil(rect.width * ratio)
  canvas.height = Math.ceil(rect.height * ratio)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.scale(ratio, ratio)
  const style = view.getComputedStyle(source)
  context.fillStyle = backgroundColor(source.parentElement ?? source, view)
  roundedRect(context, 0, 0, rect.width, rect.height, parseFloat(style.borderRadius) || 12)
  context.fill()
  const elements = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))]
  for (const element of elements.slice(0, 180)) {
    const box = element.getBoundingClientRect(), computed = view.getComputedStyle(element)
    if (!box.width || !box.height || computed.display === 'none' || computed.visibility === 'hidden') continue
    const x = box.left - rect.left, y = box.top - rect.top
    if (x >= rect.width || y >= rect.height || x + box.width < 0 || y + box.height < 0) continue
    const color = computed.backgroundColor
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
      context.fillStyle = color
      roundedRect(context, x, y, box.width, box.height, parseFloat(computed.borderRadius) || 0)
      context.fill()
    }
    if (element instanceof view.HTMLImageElement && element.complete && element.naturalWidth) {
      try { context.drawImage(element, x, y, box.width, box.height) } catch { /* 已载入图片不可画时跳过。 */ }
    }
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== 3 || !node.textContent?.trim()) continue
      const range = source.ownerDocument.createRange()
      range.selectNodeContents(node)
      const textBox = range.getBoundingClientRect()
      const textX = textBox.left - rect.left, textY = textBox.top - rect.top
      if (textX >= rect.width || textY >= rect.height) continue
      context.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`
      context.fillStyle = computed.color
      context.textBaseline = 'top'
      // 画布不会继承 CSS blur，必须在读取到绘制之间去掉真实身份文本。
      context.fillText(nameIsMasked(element) ? '••••••' : node.textContent.trim(), textX, textY, Math.max(1, Math.min(textBox.width + 1, rect.width - textX)))
    }
  }
  return canvas
}

function imageData(image: HTMLImageElement, document: Document): string | null {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null
  const canvas = document.createElement('canvas')
  // 只转换已经加载的图片，不请求图片或样式资源。
  canvas.width = Math.min(512, image.naturalWidth)
  canvas.height = Math.max(1, Math.round(image.naturalHeight * canvas.width / image.naturalWidth))
  const context = canvas.getContext('2d')
  if (!context) return null
  try { context.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas.toDataURL() } catch { return null }
}

async function captureSnapshot(source: HTMLElement, rect: TransferRect, view: SnapshotWindow, signal?: AbortSignal): Promise<{ canvas: HTMLCanvasElement; ratio: number } | null> {
  const ratio = Math.min(1.5, view.devicePixelRatio || 1, Math.sqrt(1_000_000 / (rect.width * rect.height)))
  const fallback = () => { const canvas = fallbackSnapshot(source, rect, ratio, view); return canvas ? { canvas, ratio } : null }
  if (!view.XMLSerializer || !view.Image) return fallback()
  const clone = source.cloneNode(true) as HTMLElement
  const originals = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))]
  const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]
  if (originals.length > 180) return fallback()
  for (let index = 0; index < originals.length; index++) {
    const original = originals[index], copy = copies[index], style = view.getComputedStyle(original)
    copy.removeAttribute('style')
    for (const property of SNAPSHOT_STYLES) {
      const value = style.getPropertyValue(property)
      if (/url\s*\(/i.test(value)) { copy.style.removeProperty(property); continue }
      copy.style.setProperty(property, value)
    }
    copy.style.setProperty('animation', 'none')
    copy.style.setProperty('transition', 'none')
    copy.style.setProperty('backdrop-filter', 'none')
    if (nameIsMasked(original)) {
      for (const node of Array.from(copy.childNodes)) if (node.nodeType === 3 && node.textContent?.trim()) node.textContent = '••••••'
      copy.removeAttribute('aria-label')
      copy.removeAttribute('title')
    }
    if (original instanceof view.HTMLImageElement && copy instanceof view.HTMLImageElement) {
      const data = imageData(original, source.ownerDocument)
      copy.removeAttribute('srcset')
      if (data) copy.src = data
      else { copy.removeAttribute('src'); copy.alt = nameIsMasked(original) ? '••••••' : original.alt }
    }
    if (original instanceof view.HTMLInputElement && copy instanceof view.HTMLInputElement) {
      copy.setAttribute('value', original.value)
      if (original.checked) copy.setAttribute('checked', '')
    }
    if (copy.localName === 'image') { copy.removeAttribute('href'); copy.removeAttribute('xlink:href') }
    if (copy.localName === 'use') {
      for (const attribute of ['href', 'xlink:href']) if (!copy.getAttribute(attribute)?.startsWith('#')) copy.removeAttribute(attribute)
    }
    copy.removeAttribute('background')
  }
  clone.querySelectorAll('script, iframe, object, embed, link, video, audio, source').forEach((element) => element.remove())
  Object.assign(clone.style, { width: `${rect.width}px`, height: `${rect.height}px`, minWidth: '0', margin: '0', position: 'relative', inset: 'auto', left: '0', top: '0', transform: 'none', opacity: '1', boxSizing: 'border-box' })
  const serialized = new view.XMLSerializer().serializeToString(clone)
  if (serialized.length > 650_000) return fallback()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`
  const image = new view.Image()
  const loaded = await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (result: boolean) => { if (settled) return; settled = true; view.clearTimeout(timeout); signal?.removeEventListener('abort', aborted); image.onload = null; image.onerror = null; resolve(result) }
    const aborted = () => finish(false)
    const timeout = view.setTimeout(() => finish(false), 180)
    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) finish(false)
    else image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
  try {
    if (signal?.aborted || !source.isConnected) return null
    if (!loaded) return fallback()
    const canvas = source.ownerDocument.createElement('canvas')
    canvas.width = Math.ceil(rect.width * ratio); canvas.height = Math.ceil(rect.height * ratio)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = backgroundColor(source.parentElement ?? source, view)
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return { canvas, ratio }
  } catch { return fallback() }
  finally { image.removeAttribute('src') }
}

async function fadeOnly(source: HTMLElement, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || !source.isConnected) return
  const view = source.ownerDocument.defaultView
  if (!view) return
  const opacity = source.style.opacity
  if (typeof source.animate === 'function') {
    const animation = source.animate([{ opacity: view.getComputedStyle(source).opacity }, { opacity: 0 }], { duration: 120, easing: 'ease-out' })
    const cancel = () => animation.cancel()
    signal?.addEventListener('abort', cancel, { once: true })
    view.addEventListener('resize', cancel, { once: true })
    try { await animation.finished } catch { /* 减少动态效果或取消均正常结束。 */ }
    finally { signal?.removeEventListener('abort', cancel); view.removeEventListener('resize', cancel); animation.cancel() }
    return
  }
  source.style.opacity = '0'
  await new Promise<void>((resolve) => {
    const finish = () => { view.clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve() }
    const timer = view.setTimeout(finish, 100)
    signal?.addEventListener('abort', finish, { once: true })
  })
  source.style.opacity = opacity
}

/** 后端成功后调用。完成/取消均会释放节点与预算，不因动画失败阻断状态刷新。 */
async function performExclusionTransfer(source: HTMLElement, target: HTMLElement, options: ExclusionTransferOptions, token: symbol): Promise<void> {
  const document = source.ownerDocument, view = document.defaultView, signal = options.signal
  if (!view || signal?.aborted || !source.isConnected || !target?.isConnected || sources.has(source)) return
  if (view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || activeTransfers >= MAX_TRANSFERS || activeParticles >= MAX_TOTAL_PARTICLES) {
    await fadeOnly(source, signal)
    return
  }
  const rect = source.getBoundingClientRect(), destination = target.getBoundingClientRect()
  if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= view.innerHeight || rect.right <= 0 || rect.left >= view.innerWidth) return
  const destinationVisible = destination.width > 0 && destination.height > 0 && destination.bottom > 0 && destination.top < view.innerHeight
  const end = {
    x: destinationVisible ? clamp(destination.left + destination.width * 0.78, 16, view.innerWidth - 16) : view.innerWidth - 24,
    y: clamp(destination.top + destination.height * 0.5, 24, view.innerHeight - 24),
  }
  const requestedParticles = Number.isFinite(options.maxParticles) ? options.maxParticles! : MAX_CARD_PARTICLES
  const particles = buildExclusionParticles(rect, end, Math.min(requestedParticles, MAX_TOTAL_PARTICLES - activeParticles))
  if (!particles.length) { await fadeOnly(source, signal); return }
  sources.add(source); activeTransfers++; activeParticles += particles.length
  let reserved = true
  const release = () => {
    if (!reserved) return
    reserved = false
    sources.delete(source); activeTransfers--; activeParticles -= particles.length
    if (cleanups.get(source)?.token === token) cleanups.delete(source)
  }
  cleanups.set(source, { token, run: release })
  let snapshot: Awaited<ReturnType<typeof captureSnapshot>> = null
  try { snapshot = await captureSnapshot(source, rect, view, signal) } catch { /* 最后降级为淡出。 */ }
  if (!snapshot || signal?.aborted || !source.isConnected || !target.isConnected) {
    release()
    if (!signal?.aborted && source.isConnected) await fadeOnly(source, signal)
    return
  }
  const canvas = document.createElement('canvas')
  canvas.className = 'exclusion-particle-layer'
  canvas.setAttribute('aria-hidden', 'true')
  const left = Math.max(0, Math.min(rect.left, end.x) - 80), top = Math.max(0, Math.min(rect.top, end.y) - 200)
  const right = Math.min(view.innerWidth, Math.max(rect.right, end.x) + 80), bottom = Math.min(view.innerHeight, Math.max(rect.bottom, end.y) + 80)
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top)
  const ratio = Math.min(1.5, view.devicePixelRatio || 1, Math.sqrt(2_000_000 / (width * height)))
  canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio)
  Object.assign(canvas.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
  const context = canvas.getContext('2d')
  if (!context) { release(); await fadeOnly(source, signal); return }
  const previous = { opacity: source.style.opacity, pointerEvents: source.style.pointerEvents, willChange: source.style.willChange }
  const duration = clamp(Number.isFinite(options.durationMs) ? options.durationMs! : 980, 650, 1280)
  const glow = view.getComputedStyle(target).getPropertyValue('--accent').trim() || view.getComputedStyle(target).color
  const isDark = document.documentElement.dataset.pluginTheme === 'dark'
  const palette = isDark
    ? ['#60a5fa', '#38bdf8', '#a78bfa', '#fbbf24', '#34d399']
    : ['#2563eb', '#0ea5e9', '#7c3aed', '#f59e0b', '#10b981']
  const sparkCount = clamp(Math.floor(particles.length * 0.34), 24, 68)
  const sparks = Array.from({ length: sparkCount }, (_, index) => {
    const sample = particles[Math.floor((index * particles.length) / sparkCount) % particles.length]
    return {
      start: {
        x: sample.start.x + (fraction(index, 11) - 0.5) * 14,
        y: sample.start.y + (fraction(index, 12) - 0.5) * 14,
      },
      control1: {
        x: sample.control1.x + (fraction(index, 13) - 0.5) * 56,
        y: sample.control1.y - 24 - fraction(index, 14) * 64,
      },
      control2: {
        x: sample.control2.x + (fraction(index, 15) - 0.5) * 36,
        y: sample.control2.y - 12 - fraction(index, 16) * 44,
      },
      end: sample.end,
      delay: clamp(sample.delay + fraction(index, 17) * 0.08, 0, 0.38),
      phase: fraction(index, 18) * Math.PI * 2,
      swirl: 8 + fraction(index, 19) * 16,
      radius: 1.8 + fraction(index, 20) * 2.2,
      color: palette[index % palette.length],
    }
  })
  const burstSparks = Array.from({ length: 14 }, (_, index) => ({
    angle: (index / 14) * Math.PI * 2 + (fraction(index, 21) - 0.5) * 0.25,
    speed: 22 + fraction(index, 22) * 24,
    color: palette[index % palette.length],
  }))
  const wavePoint = (p: Pick<ExclusionParticle, 'start' | 'control1' | 'control2' | 'end'>, t: number, phase: number, swirl: number) => {
    const pt = exclusionParticlePoint(p, t)
    const offset = Math.sin(t * Math.PI * 2 + phase) * Math.sin(t * Math.PI) * swirl
    return { x: pt.x - left, y: pt.y - top + offset }
  }
  await new Promise<void>((resolve) => {
    let frame = 0, finished = false, pulsing = false
    let started: number | null = null
    const finish = () => {
      if (finished) return
      finished = true
      view.cancelAnimationFrame(frame); view.clearTimeout(deadline)
      signal?.removeEventListener('abort', finish)
      view.removeEventListener('resize', finish); view.removeEventListener('scroll', finish, true)
      document.removeEventListener('visibilitychange', visibility)
      canvas.remove()
      source.style.opacity = previous.opacity; source.style.pointerEvents = previous.pointerEvents; source.style.willChange = previous.willChange
      source.classList.remove('exclusion-transfer-source')
      if (pulsing) {
        const count = (targets.get(target) ?? 1) - 1
        if (count > 0) targets.set(target, count)
        else { targets.delete(target); target.classList.remove('exclusion-target-arrival') }
      }
      release()
      snapshot!.canvas.width = 0; snapshot!.canvas.height = 0
      resolve()
    }
    const visibility = () => { if (document.hidden) finish() }
    const deadline = view.setTimeout(finish, duration + 380)
    cleanups.set(source, { token, run: finish })
    signal?.addEventListener('abort', finish, { once: true })
    view.addEventListener('resize', finish, { once: true }); view.addEventListener('scroll', finish, { capture: true, once: true })
    document.addEventListener('visibilitychange', visibility)
    source.classList.add('exclusion-transfer-source')
    source.style.opacity = '0'; source.style.pointerEvents = 'none'; source.style.willChange = 'opacity'
    document.body.append(canvas)
    const paint = (time: number) => {
      try {
      if (finished) return
      if (!source.isConnected || !target.isConnected || signal?.aborted) { finish(); return }
      if (started === null) started = time
      const progress = clamp((time - started) / duration, 0, 1)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      const wipeProgress = clamp(progress / 0.36, 0, 1)
      const wipe = wipeProgress * rect.width
      if (wipe < rect.width) {
        context.globalAlpha = 1
        context.drawImage(snapshot!.canvas, wipe * snapshot!.ratio, 0, (rect.width - wipe) * snapshot!.ratio, rect.height * snapshot!.ratio, rect.left + wipe - left, rect.top - top, rect.width - wipe, rect.height)
        if (wipeProgress > 0.02) {
          const beamX = rect.left + wipe - left
          const beamTop = rect.top - top
          const beamGrad = context.createLinearGradient(0, beamTop, 0, beamTop + rect.height)
          beamGrad.addColorStop(0, 'rgba(56, 189, 248, 0)')
          beamGrad.addColorStop(0.18, '#38bdf8')
          beamGrad.addColorStop(0.5, '#ffffff')
          beamGrad.addColorStop(0.82, '#818cf8')
          beamGrad.addColorStop(1, 'rgba(129, 140, 248, 0)')
          context.save()
          context.globalAlpha = 0.28 * (1 - wipeProgress * 0.35)
          const haloGrad = context.createLinearGradient(beamX - 24, 0, beamX + 6, 0)
          haloGrad.addColorStop(0, 'rgba(59, 130, 246, 0)')
          haloGrad.addColorStop(1, glow)
          context.fillStyle = haloGrad
          context.fillRect(beamX - 24, beamTop, 30, rect.height)
          context.globalAlpha = 0.92
          context.fillStyle = beamGrad
          context.fillRect(beamX - 1.2, beamTop, 2.4, rect.height)
          context.restore()
        }
      }
      for (let index = 0; index < particles.length; index++) {
        const particle = particles[index]
        const t = clamp((progress - particle.delay) / 0.66, 0, 1)
        if (progress < particle.delay || t >= 1) continue
        const eased = 1 - (1 - t) ** 2.1
        const phase = particle.rotation * 3.1
        const point = wavePoint(particle, eased, phase, 7)
        const alpha = Math.min(1, t * 10 + 0.12) * (1 - t ** 2.6)
        if (index % 3 === 0 && t > 0.1) {
          const prev = wavePoint(particle, Math.max(0, eased - 0.075), phase, 7)
          context.globalAlpha = alpha * 0.34
          context.strokeStyle = palette[index % palette.length]
          context.lineWidth = 1.5
          context.beginPath()
          context.moveTo(prev.x, prev.y)
          context.lineTo(point.x, point.y)
          context.stroke()
        }
        const size = particle.size * (1 - t * 0.58)
        context.save()
        context.translate(point.x, point.y)
        context.rotate(particle.rotation * t * 1.4)
        context.globalAlpha = alpha
        context.drawImage(snapshot!.canvas, particle.sourceX * snapshot!.ratio, particle.sourceY * snapshot!.ratio, particle.sourceWidth * snapshot!.ratio, particle.sourceHeight * snapshot!.ratio, -size / 2, -size / 2, size, size)
        context.restore()
      }
      context.save()
      if (isDark) context.globalCompositeOperation = 'lighter'
      for (let index = 0; index < sparks.length; index++) {
        const spark = sparks[index]
        const t = clamp((progress - spark.delay) / 0.62, 0, 1)
        if (progress < spark.delay || t >= 1) continue
        const eased = 1 - (1 - t) ** 2.2
        const head = wavePoint(spark, eased, spark.phase, spark.swirl)
        const tailSteps = 4
        for (let step = tailSteps; step >= 1; step--) {
          const t0 = Math.max(0, eased - step * 0.032)
          const t1 = Math.max(0, eased - (step - 1) * 0.032)
          const p0 = wavePoint(spark, t0, spark.phase, spark.swirl)
          const p1 = wavePoint(spark, t1, spark.phase, spark.swirl)
          const fade = (1 - step / (tailSteps + 1)) * (1 - t ** 2.4)
          context.globalAlpha = fade * (isDark ? 0.65 : 0.45)
          context.strokeStyle = spark.color
          context.lineWidth = Math.max(0.8, spark.radius * (1.15 - step * 0.2))
          context.lineCap = 'round'
          context.beginPath()
          context.moveTo(p0.x, p0.y)
          context.lineTo(p1.x, p1.y)
          context.stroke()
        }
        const coreAlpha = Math.sin(t * Math.PI)
        context.globalAlpha = coreAlpha * 0.28
        context.fillStyle = spark.color
        context.beginPath()
        context.arc(head.x, head.y, spark.radius * 2.4, 0, Math.PI * 2)
        context.fill()
        context.globalAlpha = coreAlpha * 0.95
        context.fillStyle = '#ffffff'
        context.beginPath()
        context.arc(head.x, head.y, spark.radius * 0.85, 0, Math.PI * 2)
        context.fill()
      }
      if (progress > 0.56) {
        const burst = clamp((progress - 0.56) / 0.44, 0, 1)
        const cx = end.x - left
        const cy = end.y - top
        const ringAlpha = (1 - burst) * 0.72
        for (let ring = 0; ring < 2; ring++) {
          const rt = clamp(burst - ring * 0.16, 0, 1)
          if (rt <= 0) continue
          context.globalAlpha = ringAlpha * (1 - rt)
          context.strokeStyle = ring === 0 ? glow : '#38bdf8'
          context.lineWidth = 2.2 - rt * 1.4
          context.beginPath()
          context.arc(cx, cy, 8 + rt * 38, 0, Math.PI * 2)
          context.stroke()
        }
        const sparkBurst = 1 - (1 - burst) ** 2
        for (let index = 0; index < burstSparks.length; index++) {
          const item = burstSparks[index]
          const r0 = 5 + sparkBurst * (item.speed * 0.62)
          const r1 = 8 + sparkBurst * item.speed
          context.globalAlpha = (1 - burst) * 0.85
          context.strokeStyle = item.color
          context.lineWidth = 1.6 * (1 - burst * 0.6)
          context.lineCap = 'round'
          context.beginPath()
          context.moveTo(cx + Math.cos(item.angle) * r0, cy + Math.sin(item.angle) * r0)
          context.lineTo(cx + Math.cos(item.angle) * r1, cy + Math.sin(item.angle) * r1)
          context.stroke()
        }
      }
      context.restore()
      context.globalAlpha = 1
      if (!pulsing && progress > 0.58) { pulsing = true; targets.set(target, (targets.get(target) ?? 0) + 1); target.classList.add('exclusion-target-arrival') }
      if (progress >= 1) finish()
      else frame = view.requestAnimationFrame(paint)
      } catch { finish() }
    }
    if (signal?.aborted) finish()
    else frame = view.requestAnimationFrame(paint)
  })
}

export async function animateExclusionTransfer(source: HTMLElement, target: HTMLElement, options: ExclusionTransferOptions = {}): Promise<void> {
  // 后端操作已经成功；动画失败只能静默结束，不能伪装成保存失败。
  const token = Symbol('exclusion-transfer')
  try { await performExclusionTransfer(source, target, options, token) } catch { /* 浏览器不支持绘制时保留正常状态更新。 */ }
  finally { const cleanup = cleanups.get(source); if (cleanup?.token === token) cleanup.run() }
}
