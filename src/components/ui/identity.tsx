import { useStore } from '../../store/store'
import { HoverCard } from './HoverCard'
import { Icon } from './icons'

export function NameMaskToggle() {
  const masked = useStore((state) => state.settings.maskNames)
  const updateSettings = useStore((state) => state.updateSettings)
  return (
    <HoverCard
      compact
      placement="bottom"
      content={masked ? '已隐藏账号名称（点击恢复显示）' : '隐藏账号名称（模糊保护）'}
    >
      <button
        type="button"
        className="icon-btn eye-btn"
        aria-pressed={masked}
        aria-label={masked ? '取消隐藏账号名称' : '隐藏账号名称（模糊）'}
        onClick={() => updateSettings({ maskNames: !masked })}
      >
        {masked ? <Icon.EyeOff /> : <Icon.Eye />}
      </button>
    </HoverCard>
  )
}

/**
 * Credential identity. Blur is a presentation toggle (the eye button); the text itself is
 * always the full identity, so switching masking on/off never changes stored data.
 * Only the visible text span itself triggers click-to-copy and pointer cursor; trailing
 * blank space inside flex containers passes clicks through to the parent card/row.
 */
export function SecretName({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const masked = useStore((s) => s.settings.maskNames)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(name)
      useStore.getState().notify({ tone: 'success', title: '完整账号名称已复制' })
    } catch {
      useStore.getState().notify({ tone: 'warning', title: '未能复制账号名称', detail: '请检查浏览器剪贴板权限。' })
    }
  }
  return (
    <span className={`secret-name-slot ${className ?? ''}`}>
      <HoverCard
        compact
        placement="top"
        content="点击复制账号名称"
        wrapperStyle={{ display: 'inline-flex', maxWidth: '100%', minWidth: 0 }}
      >
        <span
          className="secret-name secret-name-trigger"
          role="button"
          tabIndex={0}
          aria-label={masked ? '复制账号名称' : `复制 ${name}`}
          onClick={(event) => {
            event.stopPropagation()
            event.preventDefault()
            void copy()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.stopPropagation()
              event.preventDefault()
              void copy()
            }
          }}
        >
          {name}
        </span>
      </HoverCard>
    </span>
  )
}
