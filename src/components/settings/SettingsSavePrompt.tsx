import { useEffect } from 'react'
import { useStore } from '../../store/store'
import { changedSettings, settingsErrors } from '../../lib/settingsDraft'
import { Icon, Modal } from '../ui'

export function SettingsSavePrompt() {
  const actual = useStore((state) => state.settings)
  const draft = useStore((state) => state.settingsDraft)
  const pendingTab = useStore((state) => state.pendingTab)
  const save = useStore((state) => state.saveSettingsDraft)
  const saving = useStore((state) => state.settingsSaving)
  const connected = useStore((state) => state.connection === 'connected')
  const discard = useStore((state) => state.discardSettingsDraft)
  const cancel = useStore((state) => state.cancelSettingsNavigation)
  const changes = changedSettings(actual, draft)
  const dirty = changes.length > 0
  const errors = draft ? settingsErrors(draft) : []
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  if (!dirty) return null
  return (
    <>
      <div className="settings-save-prompt" role="status" aria-live="polite">
        <Icon.Info />
        <div className="settings-save-copy">
          <strong>设置尚未保存</strong>
          <span>{errors[0] ?? `${changes.length} 项配置待保存，确认后才会生效。`}</span>
        </div>
        <button type="button" className="btn btn-sm" disabled={saving} onClick={discard}>
          撤销修改
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={saving || !connected || errors.length > 0}
          onClick={() => void save()}
        >
          {saving ? '正在保存…' : '确认保存'}
        </button>
      </div>
      <Modal
        open={pendingTab !== null}
        title="离开前保存设置"
        sub="当前页面有尚未提交的设置修改"
        className="settings-leave-modal"
        onClose={cancel}
        footer={
          <>
            <button type="button" className="btn btn-danger" disabled={saving} onClick={discard}>
              放弃修改并离开
            </button>
            <span className="spacer" />
            <button type="button" className="btn" disabled={saving} onClick={cancel}>
              继续编辑
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || !connected || errors.length > 0}
              onClick={() => void save()}
            >
              {saving ? '正在保存…' : '保存并离开'}
            </button>
          </>
        }
      >
        <div className="consent-introduction" style={{ marginBottom: errors.length > 0 ? 10 : 2 }}>
          <span className="consent-icon is-warn">
            <Icon.Alert />
          </span>
          <p>
            你修改了 <strong>{changes.length} 项</strong> 设置但尚未保存。保存后修改将立即持久化并应用，也可选择放弃这些更改。
          </p>
        </div>
        {errors.length > 0 && (
          <p className="consent-error" role="alert">
            {errors[0]}，请继续编辑修正后再保存。
          </p>
        )}
      </Modal>
    </>
  )
}
