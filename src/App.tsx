import { lazy, Suspense, useEffect, useRef } from 'react'
import { MotionConfig } from 'framer-motion'
import { isLive } from './engine/calendar'
import { attackableRegions } from './engine/warfare'
import { getWorld } from './map/world'
import { useGame, type Panel } from './store'
import { ArmiesDock, ArmyCard } from './ui/ArmiesTab'
import { BattleFX } from './ui/BattleFX'
import { Briefing } from './ui/Briefing'
import { GameOver, NavRail, OrdersTray, Toasts, TurnSummary } from './ui/Chrome'
import { CountryPanel } from './ui/CountryPanel'
import { EventModal } from './ui/EventModal'
import { useFx } from './ui/globeBridge'
import { Help } from './ui/Help'
import { HUD } from './ui/HUD'
import { useLiveClock } from './ui/liveClock'
import { MapModes } from './ui/MapModes'
import { Setup } from './ui/Setup'
import { Lobby } from './ui/Online'
import { LogPanel, SettingsPanel } from './ui/SidePanels'
import { WarRoom } from './ui/WarRoom'

// The globe (three.js, about 2 MB) and the big desks load in their own files, so the start screen appears at once.
const WorldGlobe = lazy(() => import('./ui/Globe').then((m) => ({ default: m.WorldGlobe })))
const DiplomacyPanel = lazy(() => import('./ui/Diplomacy').then((m) => ({ default: m.DiplomacyPanel })))
const MilitaryPanel = lazy(() => import('./ui/MilitaryPanel').then((m) => ({ default: m.MilitaryPanel })))
const EconomyDesk = lazy(() => import('./ui/EconomyDesk').then((m) => ({ default: m.EconomyDesk })))
const TechTree = lazy(() => import('./ui/TechTree').then((m) => ({ default: m.TechTree })))

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
      } else if (e.key === ' ' && isLive(st.game)) {
        // A focused button uses Space for itself.
        if (target.tagName === 'BUTTON' || e.repeat) return
        e.preventDefault()
        st.togglePause()
      } else if ((e.key === '1' || e.key === '2' || e.key === '3') && isLive(st.game)) {
        st.setSpeed(([1, 2, 4] as const)[Number(e.key) - 1])
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
    const hidden = () => {
      if (document.hidden) flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])
}

export default function App() {
  const inGame = useGame((s) => !!s.game)
  const online = useGame((s) => !!s.online)
  const panel = useGame((s) => s.panel)
  const live = useGame((s) => !!s.game && isLive(s.game) && !s.online)
  useShortcuts()
  useFlushOnExit()
  useLiveClock(live)
  const reduced = useGame((s) => s.settings.reducedMotion)

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
    <div className="relative w-full h-full select-none">
      <div className="starfield" />
      <ShakeLayer>
        <Suspense fallback={null}>
          <WorldGlobe />
        </Suspense>
      </ShakeLayer>
      {!inGame && !online && <Setup />}
      {!inGame && online && <Lobby />}
      {inGame && (
        <>
          <HUD />
          <NavRail />
          {/* A desk covers these, so they are not rendered (and do not redo their work every live day) while one is open. */}
          {panel === 'none' && <MapModes />}
          {panel === 'briefing' && <Briefing key="briefing" />}
          {/* Each desk that loads on first use waits on its own, so the rest of the screen stays put. */}
          <Suspense fallback={null}>
            {panel === 'economy' && <EconomyDesk key="economy" />}
            {panel === 'military' && <MilitaryPanel key="military" />}
            {panel === 'diplomacy' && <DiplomacyPanel key="diplomacy" />}
            {panel === 'tech' && <TechTree key="tech" />}
          </Suspense>
          {panel === 'log' && <LogPanel key="log" />}
          {panel === 'settings' && <SettingsPanel key="settings" />}
          {panel === 'none' && <CountryPanel />}
          <ArmyCard />
          {panel === 'none' && <ArmiesDock />}
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
    </MotionConfig>
  )
}
