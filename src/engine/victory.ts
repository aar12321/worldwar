import { armiesOf, regionsOf } from './helpers'
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

export function checkOutcome(s: GameState): GameState['outcome'] {
  const p = s.nations[s.playerId]
  if (!p.alive || regionsOf(s, p.id).length === 0) return 'defeat'
  const capitalLost = s.regions[p.originalCapital].owner !== p.id
  if (capitalLost && armiesOf(s, p.id).length === 0) return 'defeat'
  if (populationShare(s, p.id) >= s.settings.victoryShare) return 'victory'
  return 'playing'
}
