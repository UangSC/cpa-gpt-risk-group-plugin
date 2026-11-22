import { useState } from 'react'
import pluginLogo from '../../assets/logo.svg'
import { useStore } from '../store/store'
import { loginWithKey, reconnect } from '../store/live'
import { forgetRememberedManagementKey, hasRememberedManagementKey } from '../api/auth'
import { Icon } from './ui'

export function ConnectionPanel() {
  const connection = useStore((state) => state.connection)
  const error = useStore((state) => state.connectionError)
  const authenticated = useStore((state) => state.authenticated)
  const lastUpdated = useStore((state) => state.lastUpdatedAt)
  const [key, setKey] = useState('')
  const [remember, setRemember] = useState(hasRememberedManagementKey)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const connecting = connection === 'connecting'

  if (authenticated) {
    if (connection === 'connected') return null
    return <section className="connection-panel" aria-label="CPA 连接状态" role="status">
      <Icon.Info />
      <div className="connection-content">
        <h2>{connecting ? '正在恢复连接' : 'CPA 连接暂不可用'}</h2>
        <p>{error || '正在重新读取当前 CPA 的状态。'}</p>
        {lastUpdated && <p>保留上次读取的状态：{new Date(lastUpdated).toLocaleString('zh-CN')}。</p>}
        <button type="button" className="btn btn-primary" disabled={connecting} onClick={reconnect}>重新连接</button>
      </div>
    </section>
  }

  return <main className="login-screen">
    <section className="login-card" role="dialog" aria-modal="true" aria-labelledby="login-title" aria-describedby="login-description">
      <div className="login-brand" aria-hidden="true">
        <img src={pluginLogo} alt="" className="login-brand-img" />
      </div>
      <h1 id="login-title">管理员登录</h1>
      <p id="login-description">输入 CPA 管理密钥，进入 Codex 风控检测插件。</p>
      <form className="login-form" onSubmit={async (event) => {
        event.preventDefault()
        if (connecting || submitting) return
        if (!key.trim()) { setFormError('请输入管理员密钥。'); return }
        setFormError('')
        setSubmitting(true)
        try {
          if (await loginWithKey(key, remember)) setKey('')
        } finally { setSubmitting(false) }
      }}>
        <label htmlFor="management-key">管理密钥</label>
        <input id="management-key" className="input login-key" type="password" autoComplete="off"
          autoFocus value={key} onChange={(event) => { setKey(event.target.value); setFormError('') }}
          placeholder="请输入管理员密钥" disabled={submitting || connecting}
          aria-invalid={!!formError || (!!error && !connecting)} aria-describedby="login-message" />
        <label className="login-remember">
          <input type="checkbox" checked={remember} onChange={(event) => { setRemember(event.target.checked); if (!event.target.checked) forgetRememberedManagementKey() }} disabled={submitting || connecting} />
          <span>记住管理员密钥</span>
        </label>
        <div id="login-message" className={`login-message ${formError || error ? 'is-error' : ''}`} role={formError || error ? 'alert' : 'status'}>
          {connecting ? <><span className="login-spinner" aria-hidden="true" />正在验证管理密钥…</> : formError || error || '已记住密钥后，下次打开将自动登录。'}
        </div>
        <button type="submit" className="btn btn-primary login-submit" disabled={submitting || connecting}>
          {submitting || connecting ? '正在登录…' : '登录插件'}
        </button>
      </form>
    </section>
  </main>
}
