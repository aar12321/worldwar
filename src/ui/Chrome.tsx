import { AnimatePresence, motion } from 'framer-motion'
import { turnDate } from '../engine/helpers'
import { describeOrder } from '../engine/resolveTurn'
import { populationShare } from '../engine/victory'
import { getWorld } from '../map/world'
import { useGame, type Panel } from '../store'
import { usePlayerView } from './hooks'

const NAV: { panel: Panel; label: string; key: string }[] = [
  { panel: 'nation', label: 'Nation', key: 'N' },
  { panel: 'tech', label: 'Tech', key: 'T' },
  { panel: 'diplomacy', label: 'Diplo', key: 'D' },
  { panel: 'log', label: 'Log', key: 'L' },
  { panel: 'settings', label: 'Menu', key: '' },
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
    <nav className="glass absolute left-3 top-28 z-30 rounded-xl p-1.5 flex flex-col gap-1.5">
      {NAV.map((n) => (
        <button
          key={n.panel}
          onClick={() => setPanel(n.panel)}
          className={`relative w-14 h-14 rounded-lg flex flex-col items-center justify-center transition-all ${panel === n.panel ? 'bg-cyan-400/20 shadow-[0_0_16px_rgba(34,211,238,0.45)] text-cyan-100' : 'text-slate-400 hover:text-cyan-200 hover:bg-white/5'}`}
          title={n.key ? `${n.label} (${n.key})` : n.label}
        >
          <span className="font-display text-[10px] font-bold tracking-widest">{n.label.toUpperCase()}</span>
          {n.key && <span className="text-[9px] text-slate-500 mt-0.5">{n.key}</span>}
          {n.panel === 'diplomacy' && offers > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-[9px] font-bold text-slate-950 flex items-center justify-center shadow-[0_0_8px_#fbbf24] animate-pulse">{offers}</span>
          )}
        </button>
      ))}
    </nav>
  )
}

export function OrdersTray() {
  const view = usePlayerView()
  const removeOrder = useGame((s) => s.removeOrder)
  if (!view) return null
  const { game, orders } = view
  const { map } = getWorld()
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 max-w-[70vw]">
      <div className="glass rounded-xl px-3 py-2 flex items-center gap-2 overflow-x-auto scroll-thin">
        <span className="label whitespace-nowrap mr-1">Orders ({orders.length})</span>
        {orders.length === 0 && <span className="text-sm text-slate-500 whitespace-nowrap">Select a region to build, raise armies at a muster, or give orders.</span>}
        <AnimatePresence initial={false}>
          {orders.map((o, i) => (
            <motion.button
              key={`${i}-${describeOrder(game, map, o)}`}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => removeOrder(i)}
              className={`whitespace-nowrap rounded-md border px-2 py-1 text-xs hover:line-through ${o.type === 'attack' || o.type === 'declareWar' ? 'border-fuchsia-400/60 text-fuchsia-200' : 'border-cyan-400/40 text-cyan-100'}`}
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
        <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} className="absolute top-28 left-1/2 -translate-x-1/2 z-30">
          <div className={`glass rounded-full px-5 py-2 text-sm flex items-center gap-3 ${targetMode === 'attack' ? 'border-fuchsia-400/60' : ''}`}>
            <span className={`font-display text-xs tracking-widest ${targetMode === 'attack' ? 'text-fuchsia-300 neon-text-magenta' : 'text-cyan-300 neon-text'}`}>
              {targetMode === 'attack' ? 'DRAW FRONTLINE' : 'REDEPLOY'}
            </span>
            <span className="text-slate-300">Click a highlighted region {targetMode === 'attack' ? 'to attack' : 'to move to'}.</span>
            <button className="text-slate-400 hover:text-white" onClick={() => setTargetMode(null)}>
              Esc
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
    <div className="absolute bottom-20 right-3 z-50 flex flex-col gap-2 items-end">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            onClick={() => dismiss(t.id)}
            className={`glass rounded-lg px-4 py-2 text-sm cursor-pointer ${t.tone === 'error' ? 'border-rose-500/60 text-rose-200' : t.tone === 'success' ? 'border-emerald-400/50 text-emerald-200' : ''}`}
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80">
      <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="text-center">
        <div className={`font-display text-7xl font-black tracking-[0.3em] ${win ? 'text-cyan-200 neon-text' : 'text-rose-300 neon-text-magenta'}`}>{win ? 'HEGEMONY' : 'DEFEAT'}</div>
        <p className="mt-4 text-xl text-slate-300">
          {win
            ? `${p.name} controls ${(populationShare(game, p.id) * 100).toFixed(1)}% of humanity as of ${turnDate(game.turn)}.`
            : `${p.name} has fallen in ${turnDate(game.turn)}.`}
        </p>
        <button className="btn btn-primary mt-8 px-8 py-3" onClick={quit}>
          Return to Main Menu
        </button>
      </motion.div>
    </motion.div>
  )
}
