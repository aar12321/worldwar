import { lazy, Suspense, useEffect, useRef } from 'react'
import { AnimatePresence, MotionConfig } from 'framer-motion'
import { isLive } from './engine/calendar'
import { attackableRegions } from './engine/warfare'
import { getWorld } from './map/world'
import { useGame } from './store'
import { ArmiesDock, ArmyCard } from './ui/ArmiesTab'
import { BattleFX } from './ui/BattleFX'
import { GameOver, NavRail, OrdersTray, Toasts, TurnSummary } from './ui/Chrome'
import { DeskSlot } from './ui/Desks'
import { ConfirmDialog } from './ui/confirm'
import { Palette } from './ui/Palette'
import { CountryPanel } from './ui/CountryPanel'
import { EventModal } from './ui/EventModal'
import { useFx } from './ui/globeBridge'
import { Help } from './ui/Help'
import { HUD } from './ui/HUD'
import { MissileAlert } from './ui/MissileAlert'
import { useLiveClock } from './ui/liveClock'
import { MapModes } from './ui/MapModes'
import { Setup } from './ui/Setup'
import { belongsToControl, mapModeForKey, stepIndex } from './ui/shortcuts'
import { Announcer } from './ui/Announcer'
import { usePrefsEffects } from './ui/prefsEffects'
import { goBack, installNav } from './ui/navState'
import { currentTab, targetForKey, visibleTabs } from './ui/registry'
import { regCtxOf } from './ui/regCtx'
import { Lobby } from './ui/Online'
import { WarRoom } from './ui/WarRoom'

// The globe (three.js, about 2 MB) and the big desks load in their own files, so the start screen appears at once.
import { PresenceCard } from './ui/PresenceCard'
const WorldGlobe = lazy(() => import('./ui/Globe').then((m) => ({ default: m.WorldGlobe })))
const AircraftDev = lazy(() => import('./ui/AircraftDev').then((m) => ({ default: m.AircraftDev })))

function useShortcuts() {
  useEffect(() => {
    installNav()
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      // The command palette opens from anywhere, even with a desk open.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const st = useGame.getState()
        if (st.game) st.setPalette(!st.paletteOpen)
        return
      }
      // Undo the last thing that happened at once.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        useGame.getState().undo()
        return
      }
      // Back to the desk or tab you were on.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft' && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        const st = useGame.getState()
        if (st.game && !st.paletteOpen && !st.helpOpen && !st.confirm && goBack()) e.preventDefault()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (belongsToControl({ key: '', target })) return
      const st = useGame.getState()
      if (!st.game) return
      // The aircraft screen closes on Escape even when a button inside it has just gone away and focus fell to the page.
      if (e.key === 'Escape' && st.aircraftOpen) {
        st.setAircraftOpen(false)
        return
      }
      // A dialog is open: it handles its own keys.
      if (st.game.pendingEvent || st.game.outcome !== 'playing' || st.fxQueue.length > 0 || st.helpOpen || st.summary || st.warRoom || st.aircraftOpen || st.confirm || st.paletteOpen) return
      const mapMode = mapModeForKey(e.key)
      if (e.key === 'Escape') {
        if (st.panel !== 'none') st.setPanel(st.panel)
        else st.selectRegion(null)
      } else if (e.key === 'Enter') {
        // A focused button, a disclosure, a tab or a row uses Enter for itself.
        if (belongsToControl({ key: 'Enter', target }) || e.repeat) return
        e.preventDefault()
        st.endTurn()
      } else if (e.key === ' ' && isLive(st.game)) {
        // A focused button uses Space for itself.
        if (belongsToControl({ key: ' ', target }) || e.repeat) return
        e.preventDefault()
        st.togglePause()
      } else if ((e.key === '1' || e.key === '2' || e.key === '3') && isLive(st.game)) {
        st.setSpeed(([1, 2, 4] as const)[Number(e.key) - 1])
      } else if (mapMode && st.panel === 'none') {
        // The Map colors bar only shows with no desk open, so the keys only work there.
        st.setMapMode(mapMode)
      } else if (e.key.toLowerCase() === 'a') {
        // Attack the selected country if your military can reach it.
        const target = st.selectedRegion
        if (target && attackableRegions(st.game, getWorld().map, st.game.playerId).includes(target)) st.openWarRoom(target)
        else st.toast('Select an enemy country you are at war with and border, then press A', 'error')
      } else if (e.key === '?') {
        st.setHelpTab('guide')
        st.setHelp(true)
      } else if (e.key === '/') {
        e.preventDefault()
        st.setPalette(true)
      } else if ((e.key === '[' || e.key === ']') && st.panel !== 'none') {
        // Step through the tabs of the open desk.
        const tabs = visibleTabs(st.panel, regCtxOf(st.game, st.orders))
        if (tabs.length > 1) {
          const now = currentTab({ economyTab: st.economyTab, militaryTab: st.militaryTab, empireTab: st.empireTab, deskTabs: st.deskTabs }, st.panel)
          const i = Math.max(
            0,
            tabs.findIndex((t) => t.id === now),
          )
          st.setDeskTab(st.panel, tabs[stepIndex(i, tabs.length, e.key === ']' ? 1 : -1)].id)
        }
      } else {
        // Desk and tab keys come from the registry, so a new desk's key works without touching this file.
        const hit = targetForKey(e.key, regCtxOf(st.game, st.orders))
        if (hit?.tab) st.openTab(hit.desk, hit.tab)
        else if (hit) st.setPanel(hit.desk)
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
    <div ref={ref} className="absolute inset-0 isolate">
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
  const aircraftOpen = useGame((s) => s.aircraftOpen)
  useShortcuts()
  usePrefsEffects()
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
          <MissileAlert />
          <NavRail />
          {/* A desk covers these, so they are not rendered (and do not redo their work every live day) while one is open. */}
          {panel === 'none' && <MapModes />}
          {/* One desk at a time, found in the registry (src/ui/registry.ts) and loaded the first time it opens. */}
          <AnimatePresence>{panel !== 'none' && <DeskSlot key={panel} id={panel} />}</AnimatePresence>
          {panel === 'none' && <CountryPanel />}
          <ArmyCard />
          <PresenceCard />
          {panel === 'none' && <ArmiesDock />}
          <OrdersTray />
          <WarRoom />
          {aircraftOpen && (
            <Suspense fallback={null}>
              <AircraftDev />
            </Suspense>
          )}
          <BattleFX />
          <TurnSummary />
          <EventModal />
          <Help />
          <ConfirmDialog />
          <Palette />
          <Announcer />
          <GameOver />
        </>
      )}
      <Toasts />
    </div>
    </MotionConfig>
  )
}
