import { EVENT_BY_ID } from '../data/events'
import { computeEconomy } from '../engine/economy'
import { describeEffect, fillEventText } from '../engine/events'
import { turnDate } from '../engine/helpers'
import type { EventEffect } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { Modal } from './Modal'

const TONE = {
  crisis: { color: '#ff453a', label: 'Crisis' },
  opportunity: { color: '#0a84ff', label: 'Opportunity' },
  war: { color: '#ff9f0a', label: 'Security' },
}

/** Whether an effect helps or hurts the player, judged by what it does rather than how its text starts. */
function effectTone(e: EventEffect): 'good' | 'bad' | 'neutral' {
  switch (e.type) {
    case 'resource':
      return e.amount + (e.perWorkforce ?? 0) >= 0 ? 'good' : 'bad'
    case 'stability':
    case 'opinion':
      return e.amount >= 0 ? 'good' : 'bad'
    case 'militaryPool':
      return e.fraction < 0 ? 'good' : 'bad'
    case 'unlockRandomTech':
    case 'addBuilding':
    case 'clearCasusBelli':
      return 'good'
    case 'armyAttrition':
    case 'casusBelliForRival':
    case 'spawnRebels':
    case 'loseBuilding':
    case 'popLoss':
    case 'embargo':
      return 'bad'
    case 'warWeariness':
      return e.amount > 0 ? 'bad' : 'good'
    case 'rivalResource':
      return 'neutral'
  }
}

const TONE_CLASS = { good: 'text-emerald-300', bad: 'text-rose-300', neutral: 'text-white/75' }

export function EventModal() {
  const game = useGame((s) => s.game)
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const summaryOpen = useGame((s) => !!s.summary)
  const choose = useGame((s) => s.chooseEventOption)
  const ev = game?.pendingEvent
  const { map } = getWorld()
  const def = ev ? EVENT_BY_ID[ev.eventId] : null
  if (!game || !ev || !def || fxBusy || summaryOpen) return null
  const tone = TONE[def.tone]
  const workforce = computeEconomy(game, map, game.playerId).workforce

  return (
    <Modal title={def.title} kicker={`Decision · ${tone.label} · ${turnDate(game.turn)}`} tone={tone.color} wide>
      <p className="text-[17px] text-white/85 leading-relaxed">{fillEventText(def.text, game, map, ev)}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        {def.options.map((opt, i) => (
          <button
            key={opt.label}
            data-autofocus={i === 0 ? true : undefined}
            onClick={() => choose(i)}
            className="text-left rounded-2xl p-4 bg-white/7 hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-[#0a84ff] transition-colors"
          >
            <div className="text-[13px] font-medium text-white/65">Choice {i + 1}</div>
            <div className="text-[18px] font-semibold tracking-tight mt-1">{opt.label}</div>
            <p className="text-[14px] text-white/75 mt-1">{fillEventText(opt.description, game, map, ev)}</p>
            <ul className="mt-3 space-y-1">
              {opt.effects.map((e, j) => (
                <li key={j} className={`text-[14px] font-semibold ${TONE_CLASS[effectTone(e)]}`}>
                  {describeEffect(e, workforce, game, map, ev)}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </Modal>
  )
}
