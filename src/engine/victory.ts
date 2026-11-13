import { UNIT_SPECS } from '../data/unitTypes'
import { puppetsOf, regionsOf, totalUnits } from './helpers'
import { computeEconomy } from './economy'
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

/** Countries outside your starting one. Short games ask for 3, full for 6, long for 12. */
export function conquestGoal(victoryShare: number): number {
  if (victoryShare <= 0.25) return 3
  if (victoryShare >= 0.6) return 12
  return 6
}

/** Countries the player holds that were not the country they started as. */
export function countriesTaken(s: GameState, id: NationId = s.playerId): number {
  // A puppet counts as half a country.
  return regionsOf(s, id).filter((r) => r !== id).length + Math.floor(puppetsOf(s, id).length / 2)
}

/** Share of the world's output needed to win by economy: well under the conquest goals, but only big economies get there. */
export function economicGoal(victoryShare: number): number {
  return Math.round(victoryShare * 0.45 * 1000) / 1000
}

/** A nation's gross income: what lenders and the economic victory both look at. */
export function grossIncome(s: GameState, map: WorldMap, nationId: NationId): number {
  const e = computeEconomy(s, map, nationId)
  return Math.max(0, e.taxIncome + e.factoryIncome + e.tradeIncome + e.corporateIncome)
}

/** The nation's share of the world's output, counting half of each puppet's. Needs the world total from the last turn. */
export function economicShare(s: GameState, map: WorldMap, nationId: NationId): number {
  if (!(s.worldGross > 0)) return 0
  let mine = grossIncome(s, map, nationId)
  for (const id of puppetsOf(s, nationId)) mine += grossIncome(s, map, id) * 0.5
  return mine / s.worldGross
}

/** Adds up every nation's gross income. Done once a turn. */
export function worldGross(s: GameState, map: WorldMap): number {
  let total = 0
  for (const n of Object.values(s.nations)) if (n.alive) total += grossIncome(s, map, n.id)
  return total
}

/** Where one human stands: still in it, won, or out. */
export function humanStatus(s: GameState, id: NationId, map?: WorldMap): 'playing' | 'won' | 'lost' {
  const p = s.nations[id]
  if (!p?.alive || regionsOf(s, id).length === 0) return 'lost'
  const capitalLost = s.regions[p.originalCapital].owner !== id
  // Losing the capital only ends the game once there is nothing left to fight back with.
  const canRebuild = (s.trainingQueue ?? []).some((job) => job.nationId === id) || p.resources.capital >= UNIT_SPECS.infantry.capitalCost
  if (capitalLost && totalUnits(p.military.units) < 0.1 && !canRebuild) return 'lost'
  if (countriesTaken(s, id) >= conquestGoal(s.settings.victoryShare)) return 'won'
  if (populationShare(s, id) >= s.settings.victoryShare) return 'won'
  if (map && economicShare(s, map, id) >= economicGoal(s.settings.victoryShare)) return 'won'
  return 'playing'
}

/**
 * The game's outcome. Anyone who wins ends it. A human who is knocked out of an online game drops out and the AI takes
 * over their nation; when no humans are left, the game is lost.
 */
export function checkOutcome(s: GameState, map?: WorldMap): GameState['outcome'] {
  const humans = s.humans?.length ? s.humans : [s.playerId]
  for (const id of humans) {
    if (humanStatus(s, id, map) === 'won') {
      s.winner = id
      return 'victory'
    }
  }
  const out = humans.filter((id) => humanStatus(s, id, map) === 'lost')
  if (out.length === humans.length) return 'defeat'
  for (const id of out) {
    s.humans = s.humans.filter((h) => h !== id)
    s.eliminated = [...(s.eliminated ?? []), id]
    if (s.nations[id]) s.nations[id].isPlayer = false
  }
  return 'playing'
}
