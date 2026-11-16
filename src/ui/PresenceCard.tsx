import { useMemo } from 'react'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { OrderButton } from './panel'
import { buildCard } from './presenceCardData'
import { usePresenceUi } from './globe/presenceUi'

/** The card that opens when a military badge on the globe is clicked. */
export function PresenceCard() {
  const card = usePresenceUi((s) => s.card)
  const close = usePresenceUi((s) => s.close)
  const view = usePlayerView()
  const openTab = useGame((s) => s.openTab)
  const panel = useGame((s) => s.panel)
  const built = useMemo(() => (card && view ? buildCard(view.game, card) : null), [card, view])
  // A desk covers the globe, so the card waits behind it.
  if (!card || !view || !built || panel !== 'none') return null
  const go = (tab: string) => {
    close()
    openTab('military', tab)
  }
  return (
    <aside className="presence-card inset-card p-3.5 space-y-2.5" role="dialog" aria-label={built.title}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold leading-tight">{built.title}</div>
          <div className="text-[12px] text-white/60">{built.subtitle}</div>
        </div>
        <button className="btn btn-quiet" onClick={close} aria-label="Close">
          Close
        </button>
      </div>
      <p className="text-[13px] text-white/80">{built.what}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
        {built.rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-white/60">{r.label}</dt>
            <dd className="tabular-nums text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        {built.orders.map((o) => (
          <OrderButton key={o.label} order={o.order} label={o.label} effect={o.effect} cost={o.cost} tone="btn-quiet" onDone={close} />
        ))}
        {card.nation === view.game.playerId && (
          <button className="btn btn-quiet" onClick={() => go('deploy')}>
            Relocate
          </button>
        )}
        {card.nation === view.game.playerId && (
          <button className="btn btn-quiet" onClick={() => go('forces')}>
            Upgrade
          </button>
        )}
        <button className="btn btn-quiet" onClick={() => go('theatres')}>
          Theatres
        </button>
      </div>
    </aside>
  )
}

