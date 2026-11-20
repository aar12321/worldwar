import { callOutlooks } from '../ai/blocs'
import type { DiceRule, OddsFactor } from '../ai/diplomat'
import { TONE_TEXT, verdictOf, type OddsTone } from './oddsText'
import type { Faction, GameState, NationId, WorldMap } from '../engine/types'

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v))}`

/** The terms of a score and what it must beat, for the folded details. */
function Factors({ factors, dice }: { factors: OddsFactor[]; dice: DiceRule }) {
  const shown = factors.filter((f) => Math.abs(f.value) >= 0.05)
  return (
    <div className="mt-1 ml-3 space-y-0.5 text-white/65">
      {shown.map((f) => (
        <div key={f.label} className="flex justify-between gap-3">
          <span className="min-w-0">{f.label}</span>
          <span className={`tabular-nums ${f.value >= 0 ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}`}>{signed(f.value)}</span>
        </div>
      ))}
      <div className="border-t border-white/10 pt-0.5 text-white/60">
        Score {signed(dice.base)}, plus a roll from −{dice.spread} to +{dice.spread}, must beat {dice.need}{dice.why ? ` ${dice.why}` : ''}.
      </div>
    </div>
  )
}

/**
 * One line: a coloured verdict and its top reason, with the terms behind it folded away when there are any. Every outlook on the desks
 * shows this way, so it reads the same in Diplomacy and on the Bloc desk.
 */
export function OddsLine({ label, text, tone, reason, quote = true, extra, factors, dice, testId, kind }: { label?: string; text: string; tone: OddsTone; reason?: string; quote?: boolean; extra?: { text: string; tone: OddsTone } | null; factors?: OddsFactor[]; dice?: DiceRule; testId?: string; kind?: string }) {
  const line = (
    <>
      {label && <span className="text-white/75">{label}: </span>}
      <span className={TONE_TEXT[tone]}>{text}</span>
      {reason && <span className="text-white/60"> · {quote ? `“${reason}”` : reason}</span>}
      {extra && <span className={TONE_TEXT[extra.tone]}> · {extra.text}</span>}
    </>
  )
  if (!factors?.length || !dice)
    return (
      <p className="text-[12px] leading-snug" data-offer-odds={kind} data-testid={testId}>
        {line}
      </p>
    )
  return (
    <details className="group/odds text-[12px] leading-snug" data-offer-odds={kind} data-testid={testId}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {line}
        <span className="text-white/45 group-open/odds:hidden"> · why ▾</span>
        <span className="text-white/45 hidden group-open/odds:inline"> · ▴</span>
      </summary>
      <Factors factors={factors} dice={dice} />
    </details>
  )
}

/**
 * Who in a bloc would answer a call to arms against `target`, one line each, read off the rules the rivals answer by (`callOutlooks`).
 * `opening`: the call is not made yet. `skip`: members not to list (the viewer, members who answered).
 */
export function CallOddsList({ g, map, f, by, target, opening, skip = [] }: { g: GameState; map: WorldMap; f: Faction; by: NationId; target: NationId; opening: boolean; skip?: NationId[] }) {
  const { members } = callOutlooks(g, map, f, by, target, opening)
  const rows = members.filter((m) => !skip.includes(m.id))
  if (!rows.length) return null
  return (
    <div className="space-y-0.5" data-testid="call-odds">
      {rows.map(({ id, o }) => {
        const v = verdictOf(o.outlook, o.chance, 'join')
        return <OddsLine key={id} label={g.nations[id]?.name ?? id} text={v.text} tone={v.tone} reason={o.outlook === 'human' ? undefined : o.reason} quote={false} factors={o.factors} dice={o.dice} kind={o.outlook} />
      })}
    </div>
  )
}
