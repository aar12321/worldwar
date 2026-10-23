import { UNIT_SPECS } from '../data/unitTypes'
import { armiesOf } from '../engine/helpers'
import { conquestGoal } from '../engine/victory'
import { useGame } from '../store'
import { usePlayerView } from './hooks'

const STEPS = 3

/** A short introduction, then one quiet prompt when the globe is clear. */
export function Guide() {
  const show = useGame((s) => s.settings.showTips)
  const step = useGame((s) => s.settings.tutorialStep ?? 0)
  const update = useGame((s) => s.updateSettings)
  const selected = useGame((s) => s.selectedRegion)
  const panel = useGame((s) => s.panel)
  const targetMode = useGame((s) => s.targetMode)
  const view = usePlayerView()
  if (!show || !view) return null

  if (step < STEPS) {
    const { player, game } = view
    const lands = conquestGoal(game.settings.victoryShare)
    const cards = [
      {
        title: `Lead ${player.name} to victory`,
        body: `Win by taking ${lands} territories outside ${player.name}, or by leading ${Math.round(game.settings.victoryShare * 100)}% of the world's people. You lose if ${player.name} is wiped out.`,
      },
      {
        title: 'Feed the army you train',
        body: `Open Military and train infantry. Each one eats ${UNIT_SPECS.infantry.food} food a month and finishes in a few seconds. If food turns red, build a farm before you recruit more.`,
      },
      {
        title: 'Take a border territory',
        body: 'Click a neighbor and declare war. Select your army, press Attack, then click a highlighted territory. A port lets you cross a sea lane. Space pauses. 2× and 4× speed the clock.',
      },
    ]
    const card = cards[step]
    return (
      <div className="pointer-events-auto self-center w-full max-w-md" data-tutorial={step}>
        <div className="glass rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-semibold text-white/50">
              Introduction {step + 1} of {STEPS}
            </p>
            <button type="button" className="text-[12px] font-semibold text-[#64a8ff]" onClick={() => update({ showTips: false })}>
              Hide
            </button>
          </div>
          <p className="mt-1 text-[15px] font-semibold tracking-tight">{card.title}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-white/65">{card.body}</p>
          <button type="button" className="btn btn-primary mt-3 px-3 py-1.5 text-[13px]" onClick={() => update({ tutorialStep: step + 1 })}>
            {step === STEPS - 1 ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    )
  }

  if (selected || panel !== 'none' || targetMode) return null
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
    body = 'Open Military to train infantry, armor, planes, or fleets. Select an army and attack a bordering territory. Space pauses.'
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
