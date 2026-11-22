export const DEFAULT_TOOLTIP_DELAY_MS = 450
export const CHART_TOOLTIP_DELAY_MS = 450
export const STATUS_TOOLTIP_DELAY_MS = 140

/** 每次新的悬浮都从完整等待开始；移出、关闭和卸载可取消尚未显示的气泡。 */
export function scheduleTooltipOpening(open: () => void, requestedDelay = DEFAULT_TOOLTIP_DELAY_MS): () => void {
  const delay = Number.isFinite(requestedDelay) && requestedDelay > 0 ? requestedDelay : DEFAULT_TOOLTIP_DELAY_MS
  const timer = setTimeout(open, delay)
  return () => clearTimeout(timer)
}

/** 只拦截拖选松手紧接着合成的鼠标点击，下一轮操作与键盘点击不受影响。 */
export function suppressSelectionReleaseClick(target: EventTarget): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const cleanup = () => {
    target.removeEventListener('click', block, { capture: true })
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const block = (event: Event) => {
    if ((event as MouseEvent).detail === 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    cleanup()
  }
  target.addEventListener('click', block, { capture: true })
  timer = setTimeout(cleanup, 0)
  return cleanup
}
