import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { validateOrder } from '../engine/orders'
import type { Order } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame, type Panel } from '../store'
import { usePlayerView } from './hooks'
import { speak } from './plain'

export function PanelShell({ title, kicker, panel, children }: { title: string; kicker: string; panel: Panel; children: ReactNode }) {
  const setPanel = useGame((s) => s.setPanel)
  return (
    <motion.aside
      initial={{ x: -380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -380, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="glass absolute left-4 top-24 bottom-36 z-20 w-[400px] rounded-[22px] flex flex-col overflow-hidden"
    >
      <div className="px-4 py-3.5 border-b border-white/10 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight">{title}</h2>
          <p className="text-[13px] text-white/55 mt-0.5">{kicker}</p>
        </div>
        <button className="icon-close" aria-label="Close" onClick={() => setPanel(panel)}>
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-5">{children}</div>
    </motion.aside>
  )
}

export function OrderButton({ order, label, sub, tone = '', showError = false, className = '' }: { order: Order; label: string; sub?: string; tone?: string; showError?: boolean; className?: string }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const err = validateOrder(view.game, getWorld().map, order, view.orders)
  const why = err ? speak(err) : null
  return (
    <button className={`btn ${tone} ${className} ${showError ? 'flex flex-col items-start gap-0.5 text-left' : ''}`} disabled={!!err} title={why ?? sub ?? ''} onClick={() => issueOrder(order)}>
      <span>{label}</span>
      {showError && (why || sub) && <span className="font-ui normal-case tracking-normal text-[11px] text-white/50">{why ?? sub}</span>}
    </button>
  )
}
