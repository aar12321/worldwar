import { SENDABLE } from '../engine/deploy'
import { formatDivisions, totalUnits } from '../engine/helpers'
import type { Nation, UnitCounts } from '../engine/types'
import { CHOICES, choiceName, choiceShare, choiceUnits, unitsLine, type Choice } from './attackChoices'

/** What a row says about its odds: the parent computes it with the same forecast the big number uses. */
export interface ChoiceOdds {
  /** "Likely · 82%", or a rough band without AI Battle Command. */
  text: string
  tone: 'good' | 'even' | 'bad'
  /** Divisions you lose on average. */
  losses: number
}

const TONE = { good: 'text-[#6eeb8a]', even: 'text-[#ffd60a]', bad: 'text-[#ff8a84]' }

/**
 * The force, as one of four choices: None, Probe, Main force or All in (`COMMITS`). Each row says what it sends (divisions by kind),
 * its odds, what stays home to defend and what it costs. No steppers and no missiles: missile strikes are in Military, Missile War.
 */
export function DeployPanel({
  player,
  pool,
  choice,
  setChoice,
  coastal,
  stanceCost,
  live,
  odds,
  title = 'Your force',
}: {
  player: Nation
  pool: UnitCounts
  choice: Choice
  setChoice: (c: Choice) => void
  coastal: boolean
  stanceCost: number
  live: boolean
  odds?: (c: Choice) => ChoiceOdds | null
  title?: string
}) {
  const force = player.military.units
  const army = SENDABLE.reduce((sum, k) => sum + force[k], 0)
  const free = totalUnits(pool)
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <span className="text-[12px] text-white/70 tabular-nums">{formatDivisions(free)} divisions free{live ? ' (a home guard always stays)' : ''}</span>
      </div>
      <div className="grid gap-1.5" role="radiogroup" aria-label={`${title}: how much to send`}>
        {CHOICES.map((c) => {
          const units = choiceUnits(pool, c, coastal)
          const sent = totalUnits(units)
          const home = SENDABLE.reduce((sum, k) => sum + Math.max(0, force[k] - units[k]), 0)
          const o = c === 'none' ? null : (odds?.(c) ?? null)
          const on = choice === c
          const empty = c !== 'none' && sent < 0.05
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={empty}
              data-choice={c}
              onClick={() => setChoice(c)}
              className={`rounded-xl px-3 py-2 text-left border disabled:opacity-50 ${on ? 'border-[#0a84ff] bg-[#0a84ff]/20' : 'border-white/10 bg-white/6 hover:bg-white/10'}`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-semibold">
                  {choiceName(c)}
                  {c !== 'none' && <span className="ml-1.5 text-[12px] font-normal text-white/60">{Math.round(choiceShare(c) * 100)}%</span>}
                </span>
                {o && <span className={`text-[13px] font-semibold tabular-nums whitespace-nowrap ${TONE[o.tone]}`}>{o.text}</span>}
              </span>
              <span className="block text-[12px] text-white/80 truncate" title={unitsLine(units)}>
                {c === 'none' ? 'Send nothing' : empty ? 'Nothing free to send' : `${formatDivisions(sent)} div: ${unitsLine(units)}`}
              </span>
              <span className="block text-[12px] text-white/60 tabular-nums">
                Home keeps {formatDivisions(home)}
                {army > 0 ? ` (${Math.round((home / army) * 100)}%)` : ''}
                {o ? ` · lose ~${formatDivisions(o.losses)}` : ''}
                {c !== 'none' && stanceCost > 0 ? ` · ${stanceCost} money` : ''}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
