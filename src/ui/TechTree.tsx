import { motion } from 'framer-motion'
import { BRANCH_LABELS, TECHS, type Tech } from '../data/techTree'
import { validateOrder } from '../engine/orders'
import type { TechBranch } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { fmt, usePlayerView } from './hooks'
import { speak } from './plain'

const BRANCHES: TechBranch[] = ['land', 'air', 'naval', 'infra']
const BRANCH_COLOR: Record<TechBranch, string> = { land: '#ff9f0a', air: '#64d2ff', naval: '#0a84ff', infra: '#bf5af2' }

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
      transition={{ duration: 0.2, delay: Math.min(0.14, index * 0.01), ease: [0.22, 1, 0.36, 1] }}
      whileHover={state === 'available' ? { y: -2 } : undefined}
      onClick={() => {
        if (queuedIdx >= 0) removeOrder(queuedIdx)
        else if (available) issueOrder(order)
        else if (err) useGame.getState().toast(speak(err), 'error')
      }}
      disabled={state === 'owned'}
      className={`relative w-full text-left rounded-2xl p-3 border transition-colors disabled:cursor-default ${state === 'locked' ? 'cursor-help border-white/10 bg-white/4' : 'border-white/10'}`}
      style={{
        background: owned ? `${color}22` : state === 'queued' ? 'rgba(255,255,255,0.08)' : state === 'available' ? 'rgba(255,255,255,0.06)' : undefined,
        opacity: state === 'locked' ? 0.55 : 1,
      }}
      title={err ? speak(err) : ''}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold" style={{ color }}>
          Step {tech.tier}
        </span>
        <span className="text-[12px] font-medium text-white/60">{owned ? 'Yours' : state === 'queued' ? 'Queued' : `${tech.cost} research`}</span>
      </div>
      <div className="text-[15px] font-semibold tracking-tight mt-1">{tech.name}</div>
      <div className="text-[12px] text-white/55 mt-1 leading-snug">{tech.description}</div>
      {state === 'locked' && err && <div className="text-[12px] text-[#ff8a84] mt-1">{speak(err)}</div>}
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
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-x-4 top-24 bottom-36 z-40 glass rounded-[22px] flex flex-col"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h2 className="text-[28px] font-semibold tracking-tight">Research</h2>
          <p className="text-[13px] text-white/55 mt-0.5">Click a technology to queue it. It finishes when the month ends.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="label">Available</div>
            <div className="text-[22px] font-semibold tabular-nums">{fmt(player.resources.tp - committed.tp)}</div>
          </div>
          <button className="icon-close" aria-label="Close" onClick={() => setPanel('tech')}>
            ×
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto scroll-thin p-6">
        <div className="grid grid-cols-4 gap-5 min-w-[960px]">
          {BRANCHES.map((b) => (
            <div key={b} className="space-y-3">
              <div className="text-[13px] font-semibold pb-2 border-b border-white/10" style={{ color: BRANCH_COLOR[b] }}>
                {BRANCH_LABELS[b]}
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
        <p className="text-[12px] text-white/40 mt-6">Research comes from universities and the people working in your country.</p>
      </div>
    </motion.div>
  )
}
