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
    case 'skills':
      return 'neutral'
    case 'people':
      return (e.key === 'unemployment' ? -e.amount : e.amount) >= 0 ? 'good' : 'bad'
    case 'bank':
      return (e.key === 'inflation' ? -e.amount : e.amount) >= 0 ? 'good' : 'bad'
    case 'epidemic':
      return 'bad'
    case 'projectProgress':
      return e.months >= 0 ? 'good' : 'bad'
  }
}

const TONE_CLASS = { good: 'text-[#6eeb8a]', bad: 'text-[#ff8a84]', neutral: 'text-white/75' }

export function EventModal() {
  // Only read while a decision is waiting, so a running game does not re-render this every day.
  const game = useGame((s) => (s.game?.pendingEvent || (s.game?.multiplayer && s.game.pendingEvents?.[s.game.playerId]) ? s.game : null))
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const summaryOpen = useGame((s) => !!s.summary)
  const answered = useGame((s) => s.orders.some((o) => o.type === 'eventChoice'))
  const dismissedTurn = useGame((s) => s.eventDismissedTurn)
  const choose = useGame((s) => s.chooseEventOption)
  const dismiss = useGame((s) => s.dismissEvent)
  const multi = !!game?.multiplayer
  const ev = game ? (multi ? game.pendingEvents?.[game.playerId] : game.pendingEvent) : null
  const { map } = getWorld()
  const def = ev ? EVENT_BY_ID[ev.eventId] : null
  if (!game || !ev || !def || fxBusy || summaryOpen) return null
  // Online the decision never holds the month: it can wait, and once answered it travels with the plan.
  if (multi && (answered || dismissedTurn === game.turn)) return null
  const tone = TONE[def.tone]
  const workforce = computeEconomy(game, map, game.playerId).workforce

  return (
    <Modal
      title={def.title}
      kicker={`Decision · ${tone.label} · ${turnDate(game.turn)}`}
      tone={tone.color}
      wide
      onClose={multi ? () => dismiss(game.turn) : undefined}
      footer={
        multi ? (
          <>
            <span className="text-[13px] text-white/65 mr-auto max-w-[60%]">Nobody waits for this. If you do not decide, your ministers take the first choice when the month ends.</span>
            <button className="btn px-5 py-2.5 text-[15px]" onClick={() => dismiss(game.turn)}>
              Decide later
            </button>
          </>
        ) : undefined
      }
    >
      <p className="text-[17px] text-white/85 leading-relaxed">{fillEventText(def.text, game, map, ev, game.playerId)}</p>
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
            <p className="text-[14px] text-white/75 mt-1">{fillEventText(opt.description, game, map, ev, game.playerId)}</p>
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

/** Online: a decision is waiting, or has been answered and goes in with the plan. Opens the decision again. */
export function EventChip() {
  const waiting = useGame((s) => !!(s.game?.multiplayer && s.game.pendingEvents?.[s.game.playerId]))
  const answered = useGame((s) => s.orders.some((o) => o.type === 'eventChoice'))
  const reopen = useGame((s) => s.reopenEvent)
  if (!waiting) return null
  return (
    <button className="advice-pill pointer-events-auto" onClick={reopen} title={answered ? 'Change your decision before the month ends' : 'A decision is waiting for you'}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: answered ? '#30d158' : '#ffd60a' }} />
      <span className="truncate">{answered ? 'Decision sent with your plan' : 'A decision is waiting'}</span>
      <span className="text-white/65 shrink-0">{answered ? 'Change ›' : 'Decide ›'}</span>
    </button>
  )
}
