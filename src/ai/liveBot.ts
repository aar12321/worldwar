import { difficultyOf } from '../data/difficulty'
import { UNIT_SPECS } from '../data/unitTypes'
import { incomingArmies } from '../engine/armies'
import type { GameState, NationId, RegionId, UnitCounts, WorldMap } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'
import { garrisonStrength } from '../engine/warfare'

/** A rough measure of what a force can do, from the same attack and defense numbers battles use. */
export const forceStrength = (u: UnitCounts) => UNIT_TYPES.reduce((sum, k) => sum + u[k] * (UNIT_SPECS[k].attack + UNIT_SPECS[k].defense) * 0.5, 0)

/** Rivals of Medium and Hard watch for armies marching on them. Easy ones do not. */
const watchful = (s: GameState, nationId: NationId) => !s.nations[nationId]?.isPlayer && difficultyOf(s.settings.difficulty).skill >= 1

/**
 * Whether armies already marching on a nation's countries would beat what it has at home, counting each country's garrison.
 * It does not matter how far away they still are: a rival acts as soon as it sees them coming, and nothing in this answer
 * depends on the day, so a quiet day cannot change it. No random numbers: the same game always answers the same.
 */
export function homeThreatened(s: GameState, map: WorldMap, nationId: NationId): boolean {
  const coming = incomingArmies(s, nationId).filter((a) => a.nationId !== nationId)
  if (coming.length === 0) return false
  const home = forceStrength(s.nations[nationId].military.units)
  const garrison = (id: RegionId) => garrisonStrength(s, map, id) * (UNIT_SPECS.infantry.attack + UNIT_SPECS.infantry.defense) * 0.5
  const byTarget = new Map<RegionId, number>()
  for (const a of coming) byTarget.set(a.target, (byTarget.get(a.target) ?? 0) + forceStrength(a.units))
  for (const [target, attack] of byTarget) if (attack > (home + garrison(target)) * 1.1) return true
  return false
}

/**
 * Whether a nation holds back an attack it planned, because it is about to be attacked itself. Only Medium and Hard
 * rivals do; they plan again next month.
 */
export function holdsBackLaunch(s: GameState, map: WorldMap, nationId: NationId): boolean {
  return watchful(s, nationId) && homeThreatened(s, map, nationId)
}

/**
 * The armies a nation calls home today because its country is about to be overrun: its strongest army still marching
 * out, one a day. Only Medium and Hard rivals do this.
 */
export function armiesToRecall(s: GameState, map: WorldMap, today: number): string[] {
  const out: string[] = []
  const seen = new Set<NationId>()
  for (const a of s.armies ?? []) {
    if (a.phase !== 'outbound' || a.end - today < 1 || seen.has(a.nationId) || !watchful(s, a.nationId)) continue
    seen.add(a.nationId)
    if (!homeThreatened(s, map, a.nationId)) continue
    const mine = (s.armies ?? []).filter((x) => x.nationId === a.nationId && x.phase === 'outbound' && x.end - today >= 1)
    const strongest = mine.reduce((best, x) => (forceStrength(x.units) > forceStrength(best.units) || (forceStrength(x.units) === forceStrength(best.units) && x.id < best.id) ? x : best), mine[0])
    out.push(strongest.id)
  }
  return out.sort()
}
