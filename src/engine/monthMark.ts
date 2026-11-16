import { forceUnits, totalUnits } from './helpers'
import type { GameState, MonthMark, MonthStats, NationId } from './types'

const STAT_KEYS: (keyof MonthStats)[] = ['money', 'food', 'influence', 'research', 'oil', 'steel', 'goods', 'soldiers', 'divisions', 'stability']

/** How a nation stands now, in the numbers the monthly report compares. Divisions count armies in the field. */
export function statsOf(s: GameState, id: NationId): MonthStats {
  const n = s.nations[id]
  return {
    money: n.resources.capital,
    food: n.resources.food,
    influence: n.resources.pp,
    research: n.resources.tp,
    oil: n.resources.oil,
    steel: n.resources.steel,
    goods: n.resources.goods,
    soldiers: n.militaryPool,
    divisions: totalUnits(forceUnits(s, id)),
    stability: n.stability,
  }
}

/** A month's starting point: the nation as it stands now, and the battles of the month so far. */
export function markMonth(s: GameState, id: NationId, battles: MonthMark['battles'] = []): MonthMark {
  return { turn: s.turn, stats: statsOf(s, id), battles }
}

/**
 * A month's starting point read back from a save, or null when it is damaged or belongs to another month.
 * Built field by field, in the same order as `markMonth`, so a clean mark comes back exactly as it was saved.
 */
export function cleanMark(raw: unknown, turn: number): MonthMark | null {
  const m = raw as Partial<MonthMark> | null | undefined
  if (!m || typeof m !== 'object' || m.turn !== turn || !m.stats || typeof m.stats !== 'object') return null
  const stats = {} as MonthStats
  for (const k of STAT_KEYS) {
    const v = (m.stats as Partial<Record<keyof MonthStats, unknown>>)[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    stats[k] = v
  }
  const battles = (Array.isArray(m.battles) ? m.battles : []).filter((b) => !!b && typeof b.text === 'string' && typeof b.good === 'boolean').map((b) => ({ text: b.text, good: b.good }))
  return { turn, stats, battles }
}
