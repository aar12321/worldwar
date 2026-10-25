import { UNIT_SPECS } from '../data/unitTypes'
import { armiesOf, regionsOf } from './helpers'
import { territoryOwner } from './territory'
import type { GameState, NationId, WorldMap } from './types'

export function populationShare(s: GameState, nationId: NationId): number {
  let mine = 0
  let total = 0
  for (const r of Object.values(s.regions)) {
    total += r.population
    if (r.owner === nationId) mine += r.population
  }
  return total > 0 ? mine / total : 0
}

/** Territories outside your starting country. Short games ask for 3, full for 6, long for 12. */
export function conquestGoal(victoryShare: number): number {
  if (victoryShare <= 0.25) return 3
  if (victoryShare >= 0.6) return 12
  return 6
}

/** Territories the player holds that were not part of the country they started as. */
export function territoriesTaken(s: GameState, map: WorldMap): number {
  let taken = 0
  for (const territory of Object.values(map.territories)) {
    if (territory.regionId === s.playerId) continue
    if (territoryOwner(s, map, territory.id) === s.playerId) taken++
  }
  return taken
}

export function checkOutcome(s: GameState, map?: WorldMap): GameState['outcome'] {
  const p = s.nations[s.playerId]
  if (!p.alive || regionsOf(s, p.id).length === 0) return 'defeat'
  const capitalLost = s.regions[p.originalCapital].owner !== p.id
  // Losing the capital only ends the game once there is nothing left to fight back with.
  const canRebuild = (s.trainingQueue ?? []).some((job) => job.nationId === p.id) || p.resources.capital >= UNIT_SPECS.infantry.capitalCost
  if (capitalLost && armiesOf(s, p.id).length === 0 && !canRebuild) return 'defeat'
  if (map && territoriesTaken(s, map) >= conquestGoal(s.settings.victoryShare)) return 'victory'
  if (populationShare(s, p.id) >= s.settings.victoryShare) return 'victory'
  return 'playing'
}
