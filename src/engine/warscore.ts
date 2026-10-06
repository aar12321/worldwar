import { regionWorkforce } from './economy'
import { clamp, totalUnits } from './helpers'
import type { BattleReport, GameState, NationId, PeaceTerms, RegionId, WorldMap } from './types'

export const WARSCORE = {
  battleWin: 3,
  perLossInflicted: 0.6,
  capture: 8,
  capitalCapture: 14,
  max: 100,
}

export const REPARATION_MONTHS = 12
export const MAX_REPARATIONS = 30

const scoreKey = (a: NationId, b: NationId) => `${a}>${b}`

export function addWarScore(s: GameState, a: NationId, b: NationId, amount: number) {
  const key = scoreKey(a, b)
  s.warScore[key] = clamp((s.warScore[key] ?? 0) + amount, 0, WARSCORE.max)
}

/** War score of `a` against `b` minus the reverse, from -100 to 100. */
export function netWarScore(s: GameState, a: NationId, b: NationId): number {
  return Math.round(clamp((s.warScore[scoreKey(a, b)] ?? 0) - (s.warScore[scoreKey(b, a)] ?? 0), -WARSCORE.max, WARSCORE.max))
}

export function clearWarScore(s: GameState, a: NationId, b: NationId) {
  delete s.warScore[scoreKey(a, b)]
  delete s.warScore[scoreKey(b, a)]
}

export function recordBattle(s: GameState, b: BattleReport, capitalTaken: boolean) {
  const att = b.attacker.nationId
  const def = b.defender.nationId
  if (att === 'rebels' || def === 'rebels') return
  addWarScore(s, att, def, totalUnits(b.defender.losses) * WARSCORE.perLossInflicted)
  addWarScore(s, def, att, totalUnits(b.attacker.losses) * WARSCORE.perLossInflicted)
  if (b.winner === 'attacker') addWarScore(s, att, def, WARSCORE.battleWin + (b.captured ? (capitalTaken ? WARSCORE.capitalCapture : WARSCORE.capture) : 0))
  else addWarScore(s, def, att, WARSCORE.battleWin)
}

/** War score needed to demand a region at the peace table. */
export function regionValue(s: GameState, map: WorldMap, id: RegionId): number {
  const r = s.regions[id]
  return Math.round(clamp(6 + regionWorkforce(r, map.regions[id]) * 1.6, 6, 45))
}

export function termsCost(s: GameState, map: WorldMap, terms: PeaceTerms, proposer: NationId, target: NationId) {
  let demand = 0
  let concession = 0
  for (const id of terms.cede) {
    const owner = s.regions[id]?.owner
    if (owner === target) demand += regionValue(s, map, id)
    else if (owner === proposer) concession += regionValue(s, map, id)
  }
  if (terms.reparations > 0) demand += terms.reparations * 1.2
  else concession += -terms.reparations * 1.2
  return { demand: Math.round(demand), concession: Math.round(concession) }
}

export function validatePeaceTerms(s: GameState, map: WorldMap, terms: PeaceTerms, proposer: NationId, target: NationId, checkBudget = true): string | null {
  const seen = new Set<RegionId>()
  for (const id of terms.cede) {
    const r = s.regions[id]
    if (!r || seen.has(id)) return 'Invalid region in terms'
    seen.add(id)
    if (r.owner !== proposer && r.owner !== target) return `${map.regions[id].name} is not held by either side`
    if (s.nations[r.owner].capital === id) return 'Capitals cannot be ceded'
  }
  if (!Number.isFinite(terms.reparations) || Math.abs(terms.reparations) > MAX_REPARATIONS) return `Reparations are capped at ${MAX_REPARATIONS} per month`
  if (!checkBudget) return null
  const { demand, concession } = termsCost(s, map, terms, proposer, target)
  const budget = Math.max(0, netWarScore(s, proposer, target))
  if (demand - concession > budget) return `Demands (${demand - concession}) exceed your war score (${budget})`
  return null
}
