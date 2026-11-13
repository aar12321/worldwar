import type { ReactNode } from 'react'
import { validateOrder } from '../engine/orders'
import type { Order } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame, type Panel } from '../store'
import { usePlayerView } from './hooks'
import { speak } from './plain'

/** A side drawer. The header stays put and the body is the only part that scrolls. */
export function PanelShell({ title, kicker, panel, children, wide = false, tabs }: { title: string; kicker: string; panel: Panel; children: ReactNode; wide?: boolean; tabs?: ReactNode }) {
  const setPanel = useGame((s) => s.setPanel)
  return (
    <aside data-section={panel} aria-label={title} className={`drawer surface ${wide ? 'drawer-wide' : ''}`}>
      <div className="px-5 pt-4 pb-3 border-b border-white/10 flex-none space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
            <p className="text-[14px] text-white/65 mt-0.5">{kicker}</p>
          </div>
          <button className="icon-close" aria-label="Close" onClick={() => setPanel(panel)}>
            ×
          </button>
        </div>
        {tabs}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-5 space-y-5">{children}</div>
    </aside>
  )
}

/** Tabs inside a desk. */
export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} aria-pressed={value === id} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * The one button for anything that issues an order. It always says what it does and what it costs,
 * and when it cannot be pressed it says why in place of the effect.
 */
export function OrderButton({
  order,
  label,
  cost,
  effect,
  tone = '',
  className = '',
  onDone,
}: {
  order: Order
  label: string
  /** Shown after the label, e.g. "40 money". */
  cost?: string
  /** One line on what pressing it does. Replaced by the reason when the order is not allowed. */
  effect?: string
  tone?: string
  className?: string
  onDone?: () => void
}) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const err = validateOrder(view.game, getWorld().map, order, view.orders)
  const why = err ? speak(err) : null
  const detail = why ?? effect
  return (
    <button
      className={`btn ${tone} ${className} ${detail ? 'order-btn' : ''}`}
      disabled={!!err}
      title={why ?? effect ?? ''}
      onClick={() => {
        if (issueOrder(order)) onDone?.()
      }}
    >
      {detail ? (
        <>
          <span className="order-btn-top">
            <span>{label}</span>
            {cost && <span className="order-btn-cost">{cost}</span>}
          </span>
          <span className={`order-btn-detail ${why ? 'order-btn-why' : ''}`}>{detail}</span>
        </>
      ) : (
        <span>
          {label}
          {cost && <span className="opacity-80"> · {cost}</span>}
        </span>
      )}
    </button>
  )
}
