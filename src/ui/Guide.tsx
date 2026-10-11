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
  let title = 'Click your country'
  let body = `${player.name} is outlined in blue. Click it to raise an army, build, or look around.`
  if (orders.length > 0) {
    title = 'Your month is planned'
    body = 'The orders along the bottom all happen together when you press End month. Click one to take it back.'
  } else if (armies.length === 0) {
    title = 'Raise your first army'
    body = `Click ${player.name}, then press Raise an army. If that button is unavailable, build a barracks first.`
  } else {
    title = 'Your armies are in one place'
    body = 'Open Nation, then Armies. Each army fights as one. Add a general to train every unit for free, or pay to train a unit yourself.'
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
