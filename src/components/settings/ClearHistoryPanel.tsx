import { useState } from 'react'
import { clearInspectionHistory } from '../../store/historyActions'
import { useStore } from '../../store/store'
import { SettingsPanel } from './SettingsPanel'
import { Icon, Modal } from '../ui'

export function ClearHistoryPanel() {
  const connected = useStore((state) => state.connection === 'connected')
  const saving = useStore((state) => state.settingsSaving)
  const running = useStore((state) => state.starting || state.tasks.some((task) => task.status === 'running'))
  const [open, setOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')
  const disabled = !connected || running || saving || clearing
  const close = () => {
    if (clearing) return
    setOpen(false)
    setError('')
  }
  const confirm = async () => {
    if (disabled) return
    setClearing(true)
    setError('')
    try {
      if (await clearInspectionHistory()) setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setClearing(false)
    }
  }

  return <SettingsPanel icon={<Icon.Database />} title="历史巡检日志" desc="清理插件保存的历史批次与证据数据。">
    <div className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>
      清空将移除所有账号的历史巡检批次、结论、近况灯与连续异常累计；已应用的凭证分组、模型前缀、优先级与系统设置会完整保留。
    </div>
    <button type="button" className="btn btn-danger btn-sm" disabled={disabled} onClick={() => setOpen(true)}>清空历史巡检日志</button>
    {running && <p className="field-hint">请等待巡检结束后再清空。</p>}
    <Modal open={open} onClose={close} title="清空历史巡检日志？" className="compact-modal"
      footer={<>
        <button type="button" className="btn" disabled={clearing} onClick={close}>取消</button>
        <span className="spacer" />
        <button type="button" className="btn btn-danger" disabled={disabled} onClick={() => void confirm()}>
          {clearing ? '正在清空…' : '确认清空'}
        </button>
      </>}>
      <div className="rule-box"><strong>清空后无法撤销。</strong>
        <p>所有账号的巡检批次、结论和检测依据都会删除。历史统计、近况灯和连续异常计数会从后续巡检重新累积。</p>
        <p>已应用的分组、模型前缀、优先级和现有设置继续生效。</p>
      </div>
      {running && <p className="field-hint">请等待巡检结束后再清空。</p>}
      {error && <p className="consent-error" role="alert">{error}</p>}
    </Modal>
  </SettingsPanel>
}
