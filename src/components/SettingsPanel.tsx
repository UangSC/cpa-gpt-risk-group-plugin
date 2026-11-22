import type { ReactNode } from 'react'

export function SettingsPanel({
  title,
  desc,
  icon,
  badge,
  full = false,
  children,
}: {
  title: string
  desc?: string
  icon?: ReactNode
  badge?: ReactNode
  full?: boolean
  children: ReactNode
}) {
  return (
    <section className={`panel ${full ? 'is-full' : ''}`}>
      <header className="panel-head">
        {icon && (
          <span className="panel-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="panel-head-text">
          <h3>{title}</h3>
          {desc && <p>{desc}</p>}
        </div>
        {badge && <div className="panel-head-badge">{badge}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}
