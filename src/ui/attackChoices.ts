import { UNIT_SPECS } from '../data/unitTypes'
import { COMMITS, type Commit, type Stance } from '../data/war'
import { compactUnits, SENDABLE, shareOfPool } from '../engine/deploy'
import { presetUnits } from '../engine/commander'
import { forecastMemo, type AttackPlan, type Forecast } from '../engine/forecast'
import { formatDivisions, totalUnits } from '../engine/helpers'
import type { GameState, NationId, Order, RegionId, UnitCounts, WorldMap } from '../engine/types'

/**
 * The attack planner's four choices: send nothing, a probe, the main force or everything. Each is a share of every kind that is free
 * (`COMMITS`), sent as named units, so the forecast and the battle see the same force. An attack never carries missiles: those are
 * fired from Military, Missile War.
 */
export type Choice = 'none' | Commit
export const CHOICES: readonly Choice[] = ['none', 'probe', 'main', 'allin']

export const choiceName = (c: Choice): string => (c === 'none' ? 'None' : COMMITS[c].name)
export const choiceShare = (c: Choice): number => (c === 'none' ? 0 : COMMITS[c].share)

/** The divisions a choice sends from `pool`. Warships stay home when the target is inland: they cannot fight there. */
export function choiceUnits(pool: UnitCounts, c: Choice, coastal: boolean): UnitCounts {
  if (c !== 'none') return presetUnits(pool, c, coastal)
  const out = shareOfPool(pool, 0)
  if (!coastal) out.naval = 0
  out.missile = 0
  return out
}

/** A size and stance to open the War Room on (the target ranking's Open), taken once by the War Room for that target. */
export const warRoomPick: { current: { target: RegionId; choice: Choice; stance: Stance } | null } = { current: null }

/** The forecast's plan for a choice: named units, never missiles. */
export function choicePlan(target: RegionId, stance: Stance, units: UnitCounts): AttackPlan {
  return { target, stance, units: compactUnits(units) }
}

/** The order the War Room sends for a choice: the same named units as the plan, and no missiles field at all. */
export function choiceOrder(nationId: NationId, target: RegionId, stance: Stance, units: UnitCounts): Extract<Order, { type: 'attack' }> {
  return { type: 'attack', nationId, target, commit: 'main', stance, units: compactUnits(units) }
}

/** "Infantry 6 · Tanks 2 · Artillery 1": what a force is made of, in one line. */
export function unitsLine(units: Partial<UnitCounts>): string {
  const parts = SENDABLE.filter((k) => (units[k] ?? 0) >= 0.05).map((k) => `${UNIT_SPECS[k].name} ${formatDivisions(units[k]!)}`)
  return parts.length ? parts.join(' · ') : 'nothing'
}

/** The choice whose force `units` is, if it is one of the four. */
export function choiceOf(pool: UnitCounts, units: UnitCounts, coastal: boolean): Choice | null {
  for (const c of CHOICES) {
    const want = choiceUnits(pool, c, coastal)
    if (SENDABLE.every((k) => Math.abs((want[k] ?? 0) - (units[k] ?? 0)) < 0.05)) return c
  }
  return null
}

/** The forecast of one choice, the same call the War Room's big number makes, so a row and the headline always agree. */
export function choiceForecast(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, stance: Stance, pool: UnitCounts, c: Choice, coastal: boolean, runs?: number): Forecast | null {
  const units = choiceUnits(pool, c, coastal)
  if (totalUnits(units) < 0.05) return null
  return forecastMemo(s, map, nationId, choicePlan(target, stance, units), runs)
}

/** The smallest of the usual sizes that is likely to win, so the War Room opens on a sensible plan. */
export function suggestedChoice(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, pool: UnitCounts, coastal: boolean): Choice {
  for (const c of ['probe', 'main'] as const) {
    const f = choiceForecast(s, map, nationId, target, 'assault', pool, c, coastal, 64)
    if (f && f.winChance >= 0.75) return c
  }
  return 'main'
}
