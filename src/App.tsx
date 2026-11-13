import { useEffect, useRef } from 'react'
import { attackableRegions } from './engine/warfare'
import { getWorld } from './map/world'
import { useGame, type Panel } from './store'
import { BattleFX } from './ui/BattleFX'
import { Briefing } from './ui/Briefing'
import { GameOver, NavRail, OrdersTray, Toasts, TurnSummary } from './ui/Chrome'
import { CountryPanel } from './ui/CountryPanel'
import { DiplomacyPanel } from './ui/Diplomacy'
import { EventModal } from './ui/EventModal'
import { WorldGlobe } from './ui/Globe'
import { useFx } from './ui/globeBridge'
import { Help } from './ui/Help'
import { HUD } from './ui/HUD'
import { MapModes } from './ui/MapModes'
import { MilitaryPanel } from './ui/MilitaryPanel'
import { Setup } from './ui/Setup'
import { EconomyDesk, LogPanel, SettingsPanel } from './ui/SidePanels'
import { TechTree } from './ui/TechTree'
import { WarRoom } from './ui/WarRoom'

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
      const st = useGame.getState()
      if (!st.game) return
      // A dialog is open: it handles its own keys.
      if (st.game.pendingEvent || st.game.outcome !== 'playing' || st.fxQueue.length > 0 || st.helpOpen || st.summary || st.warRoom) return
      if (e.key === 'Escape') {
        if (st.panel !== 'none') st.setPanel(st.panel)
        else st.selectRegion(null)
      } else if (e.key === 'Enter') {
        // A focused button uses Enter for itself.
        if (target.tagName === 'BUTTON' || e.repeat) return
        e.preventDefault()
        st.endTurn()
      } else if (e.key.toLowerCase() === 'a') {
        // Attack the selected country if your military can reach it.
        const target = st.selectedRegion
        if (target && attackableRegions(st.game, getWorld().map, st.game.playerId).includes(target)) st.openWarRoom(target)
        else st.toast('Select an enemy country you are at war with and border, then press A', 'error')
      } else if (e.key === '?') {
        st.setHelp(true)
      } else {
        const key = e.key.toLowerCase()
        if (key === 'w') st.openMilitary('wars')
        else {
          const desks: Record<string, Panel> = { b: 'briefing', e: 'economy', c: 'economy', m: 'military', d: 'diplomacy', r: 'tech', t: 'tech', n: 'log', l: 'log' }
          const panel = desks[key]
          if (panel) st.setPanel(panel)
        }
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

/** Saves when the tab is hidden or closed. The game itself saves after every order and turn. */
function useFlushOnExit() {
  useEffect(() => {
    const flush = () => {
      const st = useGame.getState()
      if (st.game) st.persist()
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])
}

export default function App() {
  const inGame = useGame((s) => !!s.game)
  const panel = useGame((s) => s.panel)
  useShortcuts()
  useFlushOnExit()

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
          <MapModes />
          {panel === 'briefing' && <Briefing key="briefing" />}
          {panel === 'economy' && <EconomyDesk key="economy" />}
          {panel === 'military' && <MilitaryPanel key="military" />}
          {panel === 'diplomacy' && <DiplomacyPanel key="diplomacy" />}
          {panel === 'log' && <LogPanel key="log" />}
          {panel === 'settings' && <SettingsPanel key="settings" />}
          {panel === 'tech' && <TechTree key="tech" />}
          <CountryPanel />
          <OrdersTray />
          <WarRoom />
          <BattleFX />
          <TurnSummary />
          <EventModal />
          <Help />
          <GameOver />
        </>
      )}
      <Toasts />
    </div>
  )
}
