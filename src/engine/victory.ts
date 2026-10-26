import { UNIT_SPECS } from '../data/unitTypes'
import { regionsOf, totalUnits } from './helpers'
import type { GameState, NationId } from './types'

export function populationShare(s: GameState, nationId: NationId): number {
  let mine = 0
  let total = 0
  for (const r of Object.values(s.regions)) {
    total += r.population
    if (r.owner === nationId) mine += r.population
  }
  return total > 0 ? mine / total : 0
}

/** Countries outside your starting one. Short games ask for 3, full for 6, long for 12. */
export function conquestGoal(victoryShare: number): number {
  if (victoryShare <= 0.25) return 3
  if (victoryShare >= 0.6) return 12
  return 6
}

/** Countries the player holds that were not the country they started as. */
export function countriesTaken(s: GameState): number {
  return regionsOf(s, s.playerId).filter((id) => id !== s.playerId).length
}

export function checkOutcome(s: GameState): GameState['outcome'] {
  const p = s.nations[s.playerId]
  if (!p.alive || regionsOf(s, p.id).length === 0) return 'defeat'
  const capitalLost = s.regions[p.originalCapital].owner !== p.id
  // Losing the capital only ends the game once there is nothing left to fight back with.
  const canRebuild = (s.trainingQueue ?? []).some((job) => job.nationId === p.id) || p.resources.capital >= UNIT_SPECS.infantry.capitalCost
  if (capitalLost && totalUnits(p.military.units) < 0.1 && !canRebuild) return 'defeat'
  if (countriesTaken(s) >= conquestGoal(s.settings.victoryShare)) return 'victory'
  if (populationShare(s, p.id) >= s.settings.victoryShare) return 'victory'
  return 'playing'
}
