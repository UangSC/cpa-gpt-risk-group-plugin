import { useLayoutEffect, useState, type RefObject } from 'react'

export const CARD_MIN_WIDTH = 308
export const CARD_GRID_GAP = 12
export const DEFAULT_CARD_PAGE_SIZE = 12

/** 根据容器可用宽度计算卡片视图最合适的列数。 */
export function computeCardColumns(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 3
  return Math.max(1, Math.floor((containerWidth + CARD_GRID_GAP) / (CARD_MIN_WIDTH + CARD_GRID_GAP)))
}

/**
 * 将每页数量对齐为当前列数的整倍数，消除“还差一张填满最后一行”的空位。
 * 余数不小于半行且未超上限时向上补齐一行，否则向下取整行。
 */
export function alignCardPageSize(preferred: number, columns: number): number {
  const cols = Math.max(1, Math.trunc(columns) || 1)
  const target = Math.max(1, Math.min(100, Math.trunc(preferred) || DEFAULT_CARD_PAGE_SIZE))
  if (cols === 1) return target
  const rem = target % cols
  if (rem === 0) return target
  const down = target - rem
  const up = down + cols
  if (up <= 100 && (down < cols || rem * 2 >= cols)) return up
  return Math.max(cols, down)
}

function estimateInitialColumns(): number {
  if (typeof window === 'undefined') return 3
  return computeCardColumns(Math.min(window.innerWidth, 1380) - 36)
}

/** 仅在卡片布局激活时监听容器宽度变化，并只在整数列数变化时触发重渲染。 */
export function useAdaptiveCardColumns(ref: RefObject<HTMLElement | null>, active: boolean): number {
  const [columns, setColumns] = useState<number>(estimateInitialColumns)

  useLayoutEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    const update = (width: number) => {
      if (width <= 0) return
      const next = computeCardColumns(width)
      setColumns((prev) => (prev === next ? prev : next))
    }
    update(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => update(el.clientWidth)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth
      update(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, active])

  return columns
}
