import { useEffect, useState } from 'react'
import { useStore } from '../store/store'
import { saveCredentialRouting } from '../store/actions'
import { suppressWeightZeroWarning } from '../lib/weightZeroWarning'
import { Icon, Modal, SecretName } from './ui'

export function WeightZeroWarningDialog() {
  const pending = useStore((state) => state.pendingWeightZero)
  const close = useStore((state) => state.closeWeightZeroWarning)
  const [dontRemind, setDontRemind] = useState(false)

  useEffect(() => {
    setDontRemind(false)
  }, [pending?.credentialId])

  if (!pending) return null

  const confirm = () => {
    if (dontRemind) suppressWeightZeroWarning()
    const targetId = pending.credentialId
    close()
    void saveCredentialRouting({ credentialId: targetId, weight: 0 })
  }

  return (
    <Modal
      open
      onClose={close}
      className="weight-zero-modal"
      title="确认将权重设为 0？"
      sub="该设置将立即写入 CLIProxyAPI 凭证配置"
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-danger" onClick={confirm}>
            确认设为 0
          </button>
        </>
      }
    >
      <div className="consent-introduction">
        <span className="consent-icon is-warn">
          <Icon.Alert />
        </span>
        <div>
          <p>
            准备将凭证 <SecretName name={pending.credentialName} className="weight-zero-cred-name" /> 的路由权重调整为{' '}
            <code className="inline-code">0</code>。
          </p>
        </div>
      </div>

      <div className="weight-zero-alert">
        <strong>注意：CPA 中权重为 0 会停止分配新请求</strong>
        <p>
          在 CLIProxyAPI 的加权轮询（weighted-round-robin）策略下，权重设为 <code>0</code> 的凭证不会参与新的轮询路由选中（已有会话亲和绑定在过期或故障转移前可能仍保持）。若只是希望降低分配比例，建议设为{' '}
          <code>1</code> 或其它正整数。
        </p>
      </div>

      <div className="consent-reminder-preference">
        <label>
          <input
            className="checkbox"
            type="checkbox"
            checked={dontRemind}
            onChange={(event) => setDontRemind(event.target.checked)}
          />
          不再提醒
        </label>
        <p>勾选后，后续将权重设为 0 不再弹出确认；可在「设置」中随时恢复提醒。</p>
      </div>
    </Modal>
  )
}
