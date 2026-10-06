import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { useGame } from './store'
import { globeBridge } from './ui/globeBridge'

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__game', { get: () => useGame.getState() })
  Object.defineProperty(window, '__globe', { get: () => globeBridge.api })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
