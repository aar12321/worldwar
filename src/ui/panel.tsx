import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { validateOrder } from '../engine/orders'
import type { Order } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame, type Panel } from '../store'
import { usePlayerView } from './hooks'

export function PanelShell({ title, kicker, panel, children }: { title: string; kicker: string; panel: Panel; children: ReactNode }) {
  const setPanel = useGame((s) => s.setPanel)
  return (
    <motion.aside
      initial={{ x: -380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -380, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="glass absolute left-20 top-28 bottom-24 z-20 w-[380px] rounded-xl flex flex-col overflow-hidden"
    >
      <div className="p-4 border-b border-cyan-400/15 flex items-start justify-between">
        <div>
          <div className="label">{kicker}</div>
          <h2 className="font-display text-lg font-bold tracking-[0.18em] neon-text">{title}</h2>
        </div>
        <button className="text-slate-400 hover:text-white text-sm" onClick={() => setPanel(panel)}>
          close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-5">{children}</div>
    </motion.aside>
  )
}

export function OrderButton({ order, label, sub, tone = '', showError = false }: { order: Order; label: string; sub?: string; tone?: string; showError?: boolean }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const err = validateOrder(view.game, getWorld().map, order, view.orders)
  return (
    <button className={`btn ${tone} ${showError ? 'flex flex-col items-start gap-0.5 text-left' : ''}`} disabled={!!err} title={err ?? sub ?? ''} onClick={() => issueOrder(order)}>
      <span>{label}</span>
      {showError && (err || sub) && <span className="font-ui normal-case tracking-normal text-[11px] text-slate-400">{err ?? sub}</span>}
    </button>
  )
}
