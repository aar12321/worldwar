import { motion } from 'framer-motion'
import { BRANCH_LABELS, TECHS, type Tech } from '../data/techTree'
import { validateOrder } from '../engine/orders'
import type { TechBranch } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { fmt, usePlayerView } from './hooks'

const BRANCHES: TechBranch[] = ['land', 'air', 'naval', 'infra']
const BRANCH_COLOR: Record<TechBranch, string> = { land: '#fbbf24', air: '#22d3ee', naval: '#60a5fa', infra: '#e879f9' }

function TechNode({ tech, index }: { tech: Tech; index: number }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const removeOrder = useGame((s) => s.removeOrder)
  const { game, player, orders } = view
  const owned = player.techs.includes(tech.id)
  const queuedIdx = orders.findIndex((o) => o.type === 'research' && o.techId === tech.id)
  const order = { type: 'research' as const, nationId: player.id, techId: tech.id }
  const err = owned || queuedIdx >= 0 ? null : validateOrder(game, getWorld().map, order, orders)
  const available = !owned && queuedIdx < 0 && !err
  const color = BRANCH_COLOR[tech.branch]
  const state = owned ? 'owned' : queuedIdx >= 0 ? 'queued' : available ? 'available' : 'locked'

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03 * index }}
      whileHover={state === 'available' ? { scale: 1.04 } : undefined}
      onClick={() => {
        if (queuedIdx >= 0) removeOrder(queuedIdx)
        else if (available) issueOrder(order)
      }}
      disabled={state === 'owned' || state === 'locked'}
      className="relative w-full text-left rounded-lg p-3 border transition-shadow disabled:cursor-default"
      style={{
        borderColor: state === 'locked' ? 'rgba(71,85,105,0.5)' : color,
        background: owned ? `linear-gradient(135deg, ${color}33, rgba(2,6,23,0.85))` : state === 'queued' ? `${color}22` : 'rgba(2,6,23,0.7)',
        boxShadow: owned ? `0 0 18px ${color}55, inset 0 0 12px ${color}22` : state === 'available' ? `0 0 10px ${color}44` : 'none',
        opacity: state === 'locked' ? 0.5 : 1,
      }}
      title={err ?? ''}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-[10px] tracking-widest" style={{ color }}>
          TIER {tech.tier}
        </span>
        <span className="text-[11px] font-semibold text-slate-300">{owned ? 'ACQUIRED' : state === 'queued' ? 'QUEUED (click to cancel)' : `${tech.cost} TP`}</span>
      </div>
      <div className="font-display text-sm font-bold mt-1 tracking-wide">{tech.name}</div>
      <div className="text-xs text-slate-400 mt-1 leading-snug">{tech.description}</div>
      {state === 'locked' && err && <div className="text-[11px] text-rose-300/80 mt-1">{err}</div>}
    </motion.button>
  )
}

export function TechTree() {
  const view = usePlayerView()
  const setPanel = useGame((s) => s.setPanel)
  if (!view) return null
  const { player, committed } = view
  return (
    <motion.div
      initial={{ y: '100%', opacity: 0.4 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 28 }}
      className="absolute inset-x-3 top-24 bottom-3 z-40 glass rounded-2xl flex flex-col"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-400/15">
        <div>
          <div className="label">Research Directorate</div>
          <h2 className="font-display text-2xl font-black tracking-[0.2em] neon-text">TECHNOLOGY TREE</h2>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="label">Available Tech Points</div>
            <div className="font-display text-xl text-cyan-200">{fmt(player.resources.tp - committed.tp)}</div>
          </div>
          <button className="btn" onClick={() => setPanel('tech')}>
            Close
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto scroll-thin p-6">
        <div className="grid grid-cols-4 gap-5 min-w-[960px]">
          {BRANCHES.map((b) => (
            <div key={b} className="space-y-3">
              <div className="font-display text-xs tracking-[0.25em] pb-2 border-b" style={{ color: BRANCH_COLOR[b], borderColor: `${BRANCH_COLOR[b]}55` }}>
                {BRANCH_LABELS[b].toUpperCase()}
              </div>
              {TECHS.filter((t) => t.branch === b)
                .sort((x, y) => x.tier - y.tier)
                .map((t, i) => (
                  <div key={t.id} className="relative">
                    {i > 0 && <div className="absolute -top-3 left-1/2 w-px h-3" style={{ background: `${BRANCH_COLOR[b]}88` }} />}
                    <TechNode tech={t} index={i} />
                  </div>
                ))}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-6">Research is queued now and completes when the month ends. Tech Points come from universities and your workforce.</p>
      </div>
    </motion.div>
  )
}
