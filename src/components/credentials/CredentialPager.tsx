import { Icon } from '../ui'

/** 页码始终收敛到有效范围，过滤或移入排除池不会产生空白越界页。 */
export function credentialPage<T>(items: T[], page: number, pageSize: number) {
  const size = Math.max(1, Math.trunc(pageSize) || 1)
  const pages = Math.max(1, Math.ceil(items.length / size))
  const safePage = Math.min(Math.max(0, Math.trunc(page) || 0), pages - 1)
  const start = safePage * size
  return {
    items: items.slice(start, start + size),
    page: safePage,
    pages,
    total: items.length,
    size,
    from: items.length ? start + 1 : 0,
    to: Math.min(items.length, start + size),
  }
}

export function CredentialPager({
  page,
  pages,
  total,
  pageSize,
  onPage,
  label,
  hideWhenSinglePage = false,
  metaHint,
}: {
  page: number
  pages: number
  total: number
  pageSize: number
  onPage: (next: number) => void
  label: string
  hideWhenSinglePage?: boolean
  metaHint?: string
}) {
  if (pages <= 1) {
    if (hideWhenSinglePage || total === 0) return null
    return (
      <nav className="credential-pagination" aria-label={`${label}分页`}>
        <span className="pagination-range">
          共 {total} 个凭证{metaHint ? ` · ${metaHint}` : ''}
        </span>
      </nav>
    )
  }
  const first = total ? page * pageSize + 1 : 0
  const last = Math.min(total, (page + 1) * pageSize)
  return (
    <nav className="credential-pagination" aria-label={`${label}分页`}>
      <span className="pagination-range">
        {first}–{last} / {total} 个 · 每页 {pageSize}
        {metaHint ? ` · ${metaHint}` : ''}
      </span>
      <div className="pagination-actions">
        <button
          type="button"
          className="btn btn-sm pagination-button"
          disabled={page <= 0}
          onClick={() => onPage(page - 1)}
          aria-label={`${label}上一页`}
        >
          <span className="pagination-chevron is-previous">
            <Icon.Chevron dir="right" />
          </span>
          上一页
        </button>
        <span className="pagination-position" aria-live="polite">
          <strong>{page + 1}</strong> / {pages}
        </span>
        <button
          type="button"
          className="btn btn-sm pagination-button"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
          aria-label={`${label}下一页`}
        >
          下一页
          <span className="pagination-chevron">
            <Icon.Chevron dir="right" />
          </span>
        </button>
      </div>
    </nav>
  )
}
