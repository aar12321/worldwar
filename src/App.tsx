import { AnimatePresence, motion } from 'framer-motion'
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
import { DiplomacyPanel } from './ui/Diplomacy'
import { MilitaryPanel } from './ui/MilitaryPanel'
import { LogPanel, NationPanel, SettingsPanel } from './ui/SidePanels'
import { TechTree } from './ui/TechTree'
import { TerritoriesPanel } from './ui/TerritoriesPanel'

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
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        st.togglePause()
      } else {
        const map: Record<string, 'tech' | 'nation' | 'diplomacy' | 'log' | 'territories' | 'military'> = {
          t: 'tech',
          n: 'nation',
          d: 'diplomacy',
          l: 'log',
          r: 'territories',
          m: 'military',
        }
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

function useClock() {
  useEffect(() => {
    let last = performance.now()
    let acc = 0
    let saveAcc = 0
    let frame = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(1, (now - last) / 1000)
      last = now
      acc += dt
      if (acc < 0.1) return
      const stepDt = acc
      acc = 0
      const st = useGame.getState()
      if (!st.game || st.paused || st.game.pendingEvent || st.game.outcome !== 'playing' || st.fxQueue.length > 0) return
      st.step(stepDt)
      saveAcc += stepDt
      if (saveAcc > 5) {
        saveAcc = 0
        useGame.getState().persist()
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
}

function LiveBanner() {
  const banner = useGame((s) => s.banner)
  const paused = useGame((s) => s.paused)
  const resume = useGame((s) => s.resume)
  if (!banner || !paused) return null
  return (
    <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40 w-[min(440px,calc(100vw-48px))]">
      <div className={`glass rounded-2xl px-4 py-3 flex items-center gap-3 ${banner.tone === 'bad' ? 'ring-1 ring-[#ff453a]/50' : 'ring-1 ring-[#30d158]/40'}`}>
        <div className="min-w-0 flex-1">
          <div className="label">
            {banner.text.toLowerCase().includes('captured') ? 'Territory captured' : banner.tone === 'bad' ? 'Territory lost' : banner.text.toLowerCase().includes('war') ? 'War' : banner.text.toLowerCase().includes('training') ? 'Unit ready' : 'Paused'}
          </div>
          <p className="text-[15px] font-semibold tracking-tight">{banner.text}</p>
        </div>
        <button className="btn btn-primary shrink-0" onClick={resume}>
          Resume
        </button>
      </div>
    </motion.div>
  )
}

export default function App() {
  const inGame = useGame((s) => !!s.game)
  const panel = useGame((s) => s.panel)
  useShortcuts()
  useClock()

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
            {panel === 'territories' && <TerritoriesPanel key="territories" />}
            {panel === 'military' && <MilitaryPanel key="military" />}
            {panel === 'nation' && <NationPanel key="nation" />}
            {panel === 'diplomacy' && <DiplomacyPanel key="diplomacy" />}
            {panel === 'log' && <LogPanel key="log" />}
            {panel === 'settings' && <SettingsPanel key="settings" />}
          </AnimatePresence>
          <CountryPanel />
          <AnimatePresence>{panel === 'tech' && <TechTree key="tech" />}</AnimatePresence>
          <OrdersTray />
          <LiveBanner />
          <BattleFX />
          <EventModal />
          <GameOver />
        </>
      )}
      <Toasts />
    </div>
  )
}
