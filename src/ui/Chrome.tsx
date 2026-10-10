import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { turnDate } from '../engine/helpers'
import { describeOrder } from '../engine/resolveTurn'
import { populationShare } from '../engine/victory'
import { getWorld } from '../map/world'
import { useGame, type Panel } from '../store'
import { usePlayerView } from './hooks'

const NAV: { panel: Panel; label: string; key: string; icon: ReactNode }[] = [
  { panel: 'nation', label: 'Nation', key: 'N', icon: <NationIcon /> },
  { panel: 'tech', label: 'Research', key: 'T', icon: <ResearchIcon /> },
  { panel: 'diplomacy', label: 'Diplomacy', key: 'D', icon: <PeopleIcon /> },
  { panel: 'log', label: 'News', key: 'L', icon: <NewsIcon /> },
  { panel: 'settings', label: 'Settings', key: '', icon: <SettingsIcon /> },
]

export function NavRail() {
  const panel = useGame((s) => s.panel)
  const setPanel = useGame((s) => s.setPanel)
  const offers = useGame((s) => {
    if (!s.game) return 0
    const unanswered = s.game.proposals.filter((p) => p.to === s.game!.playerId && !s.orders.some((o) => o.type === 'respond' && o.proposalId === p.id))
    return unanswered.length
  })
  return (
    <nav className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
      <div className="glass rounded-[22px] px-2 py-1.5 flex items-end gap-0.5">
        {NAV.map((n) => (
          <button
            key={n.panel}
            onClick={() => setPanel(n.panel)}
            className={`relative w-[76px] h-[58px] rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-colors ${panel === n.panel ? 'bg-white/14 text-white' : 'text-white/55 hover:text-white hover:bg-white/8'}`}
            title={n.key ? `${n.label} (${n.key})` : n.label}
          >
            {n.icon}
            <span className="text-[11px] font-medium tracking-tight">{n.label}</span>
            {n.panel === 'diplomacy' && offers > 0 && (
              <span className="absolute top-1 right-2 min-w-4 h-4 px-1 rounded-full bg-[#ff453a] text-[10px] font-semibold text-white flex items-center justify-center">{offers}</span>
            )}
          </button>
        ))}
      </div>
    </nav>
  )
}

export function OrdersTray() {
  const view = usePlayerView()
  const removeOrder = useGame((s) => s.removeOrder)
  if (!view || view.orders.length === 0) return null
  const { game, orders } = view
  const { map } = getWorld()
  return (
    <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 max-w-[min(70vw,820px)]">
      <div className="glass rounded-full px-3 py-1.5 flex items-center gap-2 overflow-x-auto scroll-thin">
        <span className="label whitespace-nowrap px-1">This month</span>
        <AnimatePresence initial={false}>
          {orders.map((o, i) => (
            <motion.button
              key={`${i}-${describeOrder(game, map, o)}`}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => removeOrder(i)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-medium hover:line-through ${o.type === 'attack' || o.type === 'declareWar' ? 'bg-[#ff453a]/18 text-[#ff8a84]' : 'bg-white/10 text-white/90'}`}
              title="Click to cancel"
            >
              {describeOrder(game, map, o)}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function TargetHint() {
  const targetMode = useGame((s) => s.targetMode)
  const setTargetMode = useGame((s) => s.setTargetMode)
  return (
    <AnimatePresence>
      {targetMode && (
        <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} className="absolute top-28 left-1/2 -translate-x-1/2 z-30">
          <div className="glass rounded-full px-4 py-2 text-[13px] flex items-center gap-3">
            <span className="font-semibold">{targetMode === 'attack' ? 'Choose where to attack' : 'Choose where to move'}</span>
            <span className="text-white/60">Click a highlighted country.</span>
            <button className="btn btn-quiet" onClick={() => setTargetMode(null)}>
              Cancel
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const dismiss = useGame((s) => s.dismissToast)
  return (
    <div className="absolute bottom-28 right-4 z-50 flex flex-col gap-2 items-end">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            onClick={() => dismiss(t.id)}
            className={`glass rounded-2xl px-4 py-2.5 text-[13px] cursor-pointer max-w-sm ${t.tone === 'error' ? 'text-[#ff8a84]' : t.tone === 'success' ? 'text-[#6eeb8a]' : ''}`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function GameOver() {
  const game = useGame((s) => s.game)
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const quit = useGame((s) => s.quitToMenu)
  if (!game || game.outcome === 'playing' || fxBusy) return null
  const win = game.outcome === 'victory'
  const p = game.nations[game.playerId]
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="text-center px-6">
        <div className="text-[56px] font-semibold tracking-tight text-white">{win ? 'You won' : 'Your nation has fallen'}</div>
        <p className="mt-3 text-[17px] text-white/70">
          {win
            ? `${p.name} leads ${(populationShare(game, p.id) * 100).toFixed(1)}% of the world's people, as of ${turnDate(game.turn)}.`
            : `${p.name} fell in ${turnDate(game.turn)}.`}
        </p>
        <button className="btn btn-primary mt-8 px-6 py-3 text-[15px]" onClick={quit}>
          Back to the menu
        </button>
      </motion.div>
    </motion.div>
  )
}

function IconFrame({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

function NationIcon() {
  return (
    <IconFrame>
      <path d="M4 20h16" />
      <path d="M6 20V10l6-5 6 5v10" />
      <path d="M10 20v-5h4v5" />
    </IconFrame>
  )
}

function ResearchIcon() {
  return (
    <IconFrame>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5" />
    </IconFrame>
  )
}

function PeopleIcon() {
  return (
    <IconFrame>
      <circle cx="8" cy="8" r="2.2" />
      <circle cx="16" cy="8" r="2.2" />
      <path d="M3.5 19a4.5 4.5 0 0 1 9 0" />
      <path d="M13 19a4.5 4.5 0 0 1 7.5-3.3" />
    </IconFrame>
  )
}

function NewsIcon() {
  return (
    <IconFrame>
      <path d="M5 5h9a2 2 0 0 1 2 2v12H7a2 2 0 0 1-2-2V5z" />
      <path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5V19a2 2 0 0 1-2 2H8" />
      <path d="M8 9h5M8 13h5" />
    </IconFrame>
  )
}

function SettingsIcon() {
  return (
    <IconFrame>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="8" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10" cy="17" r="1.6" fill="currentColor" stroke="none" />
    </IconFrame>
  )
}
