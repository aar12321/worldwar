import { BLOC } from '../data/blocs'
import { emptyUnits, totalUnits } from './helpers'
import type { Army, GameState, NationId, UnitCounts } from './types'
import { UNIT_TYPES } from './types'

/**
 * What blocs add to a battle, kept apart so the combat code can ask without importing the bloc rules. Both are exactly 1 (no change)
 * for a nation outside any bloc, for a bloc that has not used them, and with `BLOC.on` off.
 */

/** A Shield member's countries defend harder. */
export function shieldFactor(s: Pick<GameState, 'factions'>, defender: NationId): number {
  if (!BLOC.on || !s.factions?.length) return 1
  for (const f of s.factions) if (f.members.includes(defender)) return f.bloc?.roles[defender] === 'shield' ? 1 + BLOC.shieldDefense : 1
  return 1
}

/** The combined-arms bonus an operation's army carries. */
export function opFactor(army: Army | undefined): number {
  return army?.op && army.op.bonus > 0 ? 1 + army.op.bonus : 1
}

/** What comes home is shared back to the members who sent it, in the proportions they sent each kind. */
export function shareBack(s: GameState, from: Record<NationId, UnitCounts>, left: UnitCounts): Record<NationId, UnitCounts> {
  const sent = emptyUnits()
  for (const m of Object.keys(from)) for (const k of UNIT_TYPES) sent[k] += from[m][k]
  const out: Record<NationId, UnitCounts> = {}
  for (const m of Object.keys(from).sort()) {
    const back = emptyUnits()
    for (const k of UNIT_TYPES) back[k] = sent[k] > 1e-9 ? left[k] * (from[m][k] / sent[k]) : 0
    out[m] = back
    const n = s.nations[m]
    if (n?.alive) for (const k of UNIT_TYPES) n.military.units[k] += back[k]
  }
  return out
}

/** Live: an operation's army is home. Its divisions go back to the members who sent them, and the report counts what each lost. */
export function opArmyHome(s: GameState, a: Army) {
  if (!a.op) return
  const back = shareBack(s, a.op.from, a.units)
  const op = s.factions?.find((f) => f.id === a.op!.bloc)?.bloc?.ops.find((o) => o.id === a.op!.id)
  if (!op) return
  if (op.status === 'marching') {
    op.status = 'done'
    op.result ??= { won: false, captured: false, turn: s.turn, day: s.day ?? 0, lead: a.nationId, bonus: a.op.bonus, members: {}, failed: 'it turned back before the battle' }
  }
  if (op.result) for (const m of Object.keys(op.result.members)) op.result.members[m].lost = Math.max(0, op.result.members[m].sent - totalUnits(back[m] ?? emptyUnits()))
}
