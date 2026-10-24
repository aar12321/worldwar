import type { ReactNode } from 'react'
import { validateOrder } from '../engine/orders'
import type { Order } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame, type Panel } from '../store'
import { usePlayerView } from './hooks'
import { speak } from './plain'

export function PanelShell({
  title,
  kicker,
  panel,
  children,
  pinned,
  footer,
}: {
  title: string
  kicker: string
  panel: Panel
  children: ReactNode
  pinned?: ReactNode
  footer?: ReactNode
}) {
  const setPanel = useGame((s) => s.setPanel)
  return (
    <aside
      data-section={panel}
      className="glass side-panel panel-in absolute left-[120px] bottom-28 z-[22] w-[min(680px,calc(100vw-148px))] rounded-[22px] flex flex-col overflow-hidden"
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
      {pinned && <div className="px-4 pt-3 pb-2 border-b border-white/10 space-y-3">{pinned}</div>}
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-4 space-y-5">{children}</div>
      {footer && <div className="px-4 py-3 border-t border-white/10">{footer}</div>}
    </aside>
  )
}

export function OrderButton({ order, label, sub, tone = '', showError = false, className = '' }: { order: Order; label: string; sub?: string; tone?: string; showError?: boolean; className?: string }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const err = validateOrder(view.game, getWorld().map, order, view.orders)
  const why = err ? speak(err) : null
  const detail = why ?? (showError ? sub : null)
  return (
    <button className={`btn ${tone} ${className} ${detail ? 'flex flex-col items-start gap-0.5 text-left' : ''}`} disabled={!!err} title={why ?? sub ?? ''} onClick={() => issueOrder(order)}>
      <span>{label}</span>
      {detail && <span className={`font-ui normal-case tracking-normal text-[11px] font-medium ${why ? 'text-white/85' : 'text-white/50'}`}>{detail}</span>}
    </button>
  )
}
