import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/controls.css'
import './styles/feedback.css'
import './styles/badges.css'
import './styles/overview.css'
import './styles/credentials.css'
import './styles/overlays.css'
import './styles/views.css'
import './styles/pelican.css'
import { reconnect } from './store/live'
import { useStore } from './store/store'

if (window.parent !== window) {
  // Manager Plus inserts its defaults into the iframe, including rules for all card-like classes.
  // Leave the style element in place so host theme updates can reuse it.
  const disableHostStyles = () => {
    const style = document.head.querySelector<HTMLStyleElement>('style#cpamp-plugin-host-style[data-cpamp-plugin-host]')
    if (style) style.media = 'not all'
  }
  new MutationObserver(disableHostStyles).observe(document.head, { childList: true })
  disableHostStyles()
}

document.documentElement.dataset.pluginTheme = useStore.getState().settings.theme
document.documentElement.dataset.maskNames = useStore.getState().settings.maskNames ? 'true' : 'false'
const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
createRoot(root).render(<StrictMode><App /></StrictMode>)
reconnect()
