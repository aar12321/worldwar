import { AnimatePresence } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { useGame } from './store'
import { BattleFX } from './ui/BattleFX'
import { GameOver, NavRail, OrdersTray, TargetHint, Toasts } from './ui/Chrome'
import { CountryPanel } from './ui/CountryPanel'
import { EventModal } from './ui/EventModal'
import { WorldGlobe } from './ui/Globe'
import { useFx } from './ui/globeBridge'
import { HUD } from './ui/HUD'
import { Setup } from './ui/Setup'
import { DiplomacyPanel, LogPanel, NationPanel, SettingsPanel } from './ui/SidePanels'
import { TechTree } from './ui/TechTree'

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
      const st = useGame.getState()
      if (!st.game) return
      if (e.key === 'Escape') {
        if (st.targetMode) st.setTargetMode(null)
        else if (st.panel !== 'none') st.setPanel(st.panel)
        else st.selectRegion(null)
      } else if (e.key === 'Enter') {
        st.endTurn()
      } else {
        const map: Record<string, 'tech' | 'nation' | 'diplomacy' | 'log'> = { t: 'tech', n: 'nation', d: 'diplomacy', l: 'log' }
        const panel = map[e.key.toLowerCase()]
        if (panel) st.setPanel(panel)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function ShakeLayer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const shakeKey = useFx((s) => s.shakeKey)
  const strength = useFx((s) => s.shakeStrength)
  const reduced = useGame((s) => s.settings.reducedMotion)
  useEffect(() => {
    const el = ref.current
    if (!el || !shakeKey || reduced) return
    el.style.setProperty('--shake', String(strength))
    el.classList.remove('shake')
    void el.offsetWidth
    el.classList.add('shake')
  }, [shakeKey, strength, reduced])
  return (
    <div ref={ref} className="absolute inset-0">
      {children}
    </div>
  )
}

export default function App() {
  const inGame = useGame((s) => !!s.game)
  const panel = useGame((s) => s.panel)
  useShortcuts()

  return (
    <div className="relative w-full h-full select-none">
      <div className="starfield" />
      <ShakeLayer>
        <WorldGlobe />
      </ShakeLayer>
      {!inGame && <Setup />}
      {inGame && (
        <>
          <HUD />
          <NavRail />
          <TargetHint />
          <AnimatePresence>
            {panel === 'nation' && <NationPanel key="nation" />}
            {panel === 'diplomacy' && <DiplomacyPanel key="diplomacy" />}
            {panel === 'log' && <LogPanel key="log" />}
            {panel === 'settings' && <SettingsPanel key="settings" />}
          </AnimatePresence>
          <CountryPanel />
          <AnimatePresence>{panel === 'tech' && <TechTree key="tech" />}</AnimatePresence>
          <OrdersTray />
          <BattleFX />
          <EventModal />
          <GameOver />
        </>
      )}
      <Toasts />
    </div>
  )
}
