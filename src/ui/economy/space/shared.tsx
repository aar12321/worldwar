import type { ReactNode } from 'react'
import { validateOrder } from '../../../engine/orders'
import type { Order } from '../../../engine/types'
import { getWorld } from '../../../map/world'
import { useGame } from '../../../store'
import { usePlayerView } from '../../hooks'
import { speak } from '../../plain'

/** A small chip: a label and a value, for samples and staff. */
export function Chip({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-[#ff8a84]' : tone === 'warn' ? 'text-[#ffd60a]' : tone === 'good' ? 'text-[#6eeb8a]' : 'text-white/80'
  return <span className={`inline-flex items-center whitespace-nowrap shrink-0 rounded-full bg-white/8 px-2.5 py-0.5 text-[12px] tabular-nums ${color}`}>{children}</span>
}

/** A search box that says what it searches. */
export function Search({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} className="field w-full px-3 py-2 text-[14px]" />
}

/** A small button for a repeated order such as hiring: it says what it does, and the reason it cannot be pressed is its tooltip, so a row of them stays tidy. */
export function QuickOrder({ order, label, tone = '' }: { order: Order; label: string; tone?: string }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const err = validateOrder(view.game, getWorld().map, order, view.orders)
  return (
    <button className={`btn ${tone} px-3 py-1.5 text-[13px]`} disabled={!!err} title={err ? speak(err) : label} onClick={() => issueOrder(order)}>
      {label}
    </button>
  )
}
