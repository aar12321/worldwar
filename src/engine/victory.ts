import { scenarioGoalSentence } from '../data/scenarios'
import { UNIT_SPECS } from '../data/unitTypes'
import { tierSpec } from '../data/empire'
import { forceUnits, puppetsOf, regionsOf, territoriesOf, totalUnits } from './helpers'
import { computeEconomy } from './economy'
import { countWeight } from './puppets'
import { territoryCountWeight } from './territories'
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
  // A puppet counts as half a country, more when it is loyal and less when it is restive (the weights the empire tier uses).
  return regionsOf(s, id).filter((r) => r !== id).length + Math.floor(puppetsOf(s, id).reduce((sum, p) => sum + countWeight(s.nations[p]), 0)) + territoryCountWeight(s, id)
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

/** The nation's share of the world's output, counting each puppet's by the loyalty weights (half when it has none). Needs the world total from the last turn. */
export function economicShare(s: GameState, map: WorldMap, nationId: NationId): number {
  if (!(s.worldGross > 0)) return 0
  let mine = grossIncome(s, map, nationId)
  for (const id of puppetsOf(s, nationId)) mine += grossIncome(s, map, id) * countWeight(s.nations[id])
  return mine / s.worldGross
}

/** Adds up every nation's gross income. Done once a turn. */
export function worldGross(s: GameState, map: WorldMap): number {
  let total = 0
  for (const n of Object.values(s.nations)) if (n.alive) total += grossIncome(s, map, n.id)
  return total
}

/** Every country the nation holds itself or through puppets, the way the World Conquest goal counts. */
export function controlled(s: GameState, id: NationId): number {
  let total = regionsOf(s, id).length
  for (const p of puppetsOf(s, id)) total += regionsOf(s, p).length
  // Territories are held land: they count for the map, never for people or output.
  for (const q of territoriesOf(s, id)) total += regionsOf(s, q).length
  return total
}

/** True when every country still on the map is the nation's own or a puppet of it, however many steps down. */
export function holdsTheWorld(s: GameState, id: NationId): boolean {
  const lord = (n: string): string | null => s.nations[n]?.overlord ?? s.nations[n]?.territoryOf ?? null
  for (const n of Object.values(s.nations)) {
    if (!n.alive || n.id === id) continue
    let at: string | null = n.id
    for (let hops = 0; at && at !== id && hops < 12; hops++) at = lord(at)
    if (at !== id) return false
  }
  return true
}

/** Where one human stands: still in it, won, or out. */
export function humanStatus(s: GameState, id: NationId, map?: WorldMap): 'playing' | 'won' | 'lost' {
  const p = s.nations[id]
  if (!p?.alive || regionsOf(s, id).length === 0) return 'lost'
  const capitalLost = s.regions[p.originalCapital].owner !== id
  // Losing the capital only ends the game once there is nothing left to fight back with.
  const canRebuild = (s.trainingQueue ?? []).some((job) => job.nationId === id) || p.resources.capital >= UNIT_SPECS.infantry.capitalCost
  if (capitalLost && totalUnits(forceUnits(s, id)) < 0.1 && !canRebuild) return 'lost'
  // A scenario's own goal (survive, grow, out-earn), checked in place of the game's.
  const sg = s.scenario?.goal
  if (sg && (sg.kind === 'survive' || sg.kind === 'tier' || sg.kind === 'economy')) {
    const months = s.turn - s.scenario!.start
    if (sg.kind === 'survive') return months >= sg.months ? 'won' : 'playing'
    if (sg.kind === 'tier' ? p.tier >= sg.tier : !!map && economicShare(s, map, id) >= sg.share) return 'won'
    return sg.deadline !== undefined && months >= sg.deadline ? 'lost' : 'playing'
  }
  if (s.settings.goal === 'world') return holdsTheWorld(s, id) ? 'won' : 'playing'
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

/** The win condition in plain words, from the game's own rules. */
export function goalSentence(s: GameState): string {
  const own = s.scenario ? scenarioGoalSentence(s.scenario.goal) : null
  if (own) return own
  if (s.settings.goal !== 'classic') return 'hold every country in the world, yours or puppets of yours'
  return `take ${conquestGoal(s.settings.victoryShare)} countries, hold ${Math.round(s.settings.victoryShare * 100)}% of the world's people, or reach ${Math.round(economicGoal(s.settings.victoryShare) * 100)}% of its output`
}

/** How close a nation is to winning, 0 to 1: the nearest of the goals that count in this game. */
export function goalProgress(s: GameState, map: WorldMap, id: NationId): number {
  const sg = s.scenario?.goal
  if (sg?.kind === 'survive') return Math.min(1, Math.max(0, (s.turn - s.scenario!.start) / sg.months))
  if (sg?.kind === 'tier') return Math.min(1, Math.max(0, (s.nations[id]?.tier ?? 1) >= sg.tier ? 1 : controlled(s, id) / Math.max(1, tierSpec(sg.tier).countries)))
  if (sg?.kind === 'economy') return Math.min(1, economicShare(s, map, id) / sg.share)
  if (s.settings.goal !== 'classic') {
    const lands = Object.keys(s.regions).length
    return lands > 0 ? Math.min(1, controlled(s, id) / lands) : 0
  }
  const share = s.settings.victoryShare
  return Math.min(1, Math.max(countriesTaken(s, id) / conquestGoal(share), populationShare(s, id) / share, economicShare(s, map, id) / Math.max(0.0001, economicGoal(share))))
}
