import { useEffect } from 'react'
import { useGame } from '../store'
import { applyPrefs, motionReduced, systemReducesMotion } from './prefs'

/**
 * Keeps the page in step with the look-and-feel settings: applies them to the page root, and when motion follows the system,
 * follows the system switch while the game is open.
 */
export function usePrefsEffects() {
  const ui = useGame((s) => s.settings.ui)
  useEffect(() => {
    applyPrefs(ui)
  }, [ui])
  useEffect(() => {
    if (ui.motion !== 'system' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => {
      const st = useGame.getState()
      const reduced = motionReduced(st.settings.ui.motion, systemReducesMotion())
      if (st.settings.reducedMotion !== reduced) st.updateSettings({ reducedMotion: reduced })
      applyPrefs(st.settings.ui)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [ui.motion])
}
