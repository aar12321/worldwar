import { armiesOf } from '../engine/helpers'
import { useGame } from '../store'
import { usePlayerView } from './hooks'

/** One quiet prompt for the moment you are looking at the globe with nothing open. */
export function Guide() {
  const show = useGame((s) => s.settings.showTips)
  const update = useGame((s) => s.updateSettings)
  const selected = useGame((s) => s.selectedRegion)
  const panel = useGame((s) => s.panel)
  const targetMode = useGame((s) => s.targetMode)
  const view = usePlayerView()
  if (!show || !view || selected || panel !== 'none' || targetMode) return null
  const { game, player, orders } = view
  const armies = armiesOf(game, player.id)
  let title = 'Your land is on the map'
  let body = `${player.name} is split into territories. Open Land to develop them, or Military to train units into the army that holds each one.`
  if (orders.length > 0) {
    title = 'Your month is planned'
    body = 'Diplomacy along the bottom settles when the month bar fills. Training, building, and marches start immediately.'
  } else if (armies.length === 0) {
    title = 'Raise your first army'
    body = `Click ${player.name}, then press Raise an army. Or open Military and queue training. A barracks is required.`
  } else {
    title = 'Train, then march'
    body = 'Open Military to train infantry (10s), armor (30s), planes (45s), or fleets (40s). Select an army and attack a bordering territory. Space pauses.'
  }
  return (
    <div className="pointer-events-auto self-center w-full max-w-md">
      <div className="glass rounded-2xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-semibold text-white/50">What to do</p>
          <button type="button" className="text-[12px] font-semibold text-[#64a8ff]" onClick={() => update({ showTips: false })}>
            Hide
          </button>
        </div>
        <p className="mt-1 text-[15px] font-semibold tracking-tight">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-white/65">{body}</p>
      </div>
    </div>
  )
}
