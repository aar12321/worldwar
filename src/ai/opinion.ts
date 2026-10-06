import { PERSONALITIES } from '../data/personalities'
import { atWar, clamp, enemiesOf, hasCasusBelli, hasPact, isAllied } from '../engine/helpers'
import type { GameState, NationId, OpinionModifier, WorldMap } from '../engine/types'
import { populationShare } from '../engine/victory'

/** A coalition forms against the player once they hold this fraction of their victory target. */
export const COALITION_THRESHOLD = 0.35
const MODIFIER_CAP = 60

const opinionKey = (holder: NationId, target: NationId) => `${holder}>${target}`

/** Records a remembered grievance or favour. Repeated causes stack up to a cap; the player holds no opinions. */
export function addOpinion(s: GameState, holder: NationId, target: NationId, label: string, value: number, decay = 1) {
  if (holder === target || !s.nations[holder] || s.nations[holder].isPlayer || !s.nations[target]) return
  const key = opinionKey(holder, target)
  const list = (s.opinions[key] ??= [])
  const existing = list.find((m) => m.label === label)
  if (existing) {
    existing.value = clamp(existing.value + value, -MODIFIER_CAP, MODIFIER_CAP)
    existing.decay = Math.max(existing.decay, decay)
  } else {
    list.push({ label, value: clamp(value, -MODIFIER_CAP, MODIFIER_CAP), decay })
  }
}

export function storedOpinion(s: GameState, holder: NationId, target: NationId): OpinionModifier[] {
  return s.opinions[opinionKey(holder, target)] ?? []
}

export function decayOpinions(s: GameState) {
  for (const [key, list] of Object.entries(s.opinions)) {
    const kept: OpinionModifier[] = []
    for (const m of list) {
      const value = m.value > 0 ? Math.max(0, m.value - m.decay) : Math.min(0, m.value + m.decay)
      if (Math.abs(value) >= 0.5) kept.push({ ...m, value })
    }
    if (kept.length) s.opinions[key] = kept
    else delete s.opinions[key]
  }
}

export function forgetNation(s: GameState, id: NationId) {
  for (const key of Object.keys(s.opinions)) {
    const [a, b] = key.split('>')
    if (a === id || b === id) delete s.opinions[key]
  }
}

export function coalitionActive(s: GameState): boolean {
  const p = s.nations[s.playerId]
  if (!p?.alive) return false
  return populationShare(s, p.id) >= s.settings.victoryShare * COALITION_THRESHOLD
}

/** Nations sharing a land border or sea lane with `id`. */
export function nationNeighbors(s: GameState, map: WorldMap, id: NationId): Set<NationId> {
  const out = new Set<NationId>()
  for (const r of Object.values(s.regions)) {
    if (r.owner !== id) continue
    const mr = map.regions[r.id]
    for (const nb of mr.neighbors) {
      const o = s.regions[nb]?.owner
      if (o && o !== id) out.add(o)
    }
    for (const nb of mr.seaLanes) {
      const o = s.regions[nb]?.owner
      if (o && o !== id) out.add(o)
    }
  }
  return out
}

export interface OpinionPart {
  label: string
  value: number
}

export interface OpinionReport {
  total: number
  parts: OpinionPart[]
}

export interface OpinionContext {
  borders?: boolean
  coalition?: boolean
  /** Precomputed enemies of every nation, valid while the state is not mutated. */
  enemies?: Map<NationId, NationId[]>
}

/** How `holder` feels about `target`, from -100 (hatred) to 100 (devotion), with the reasons. */
export function opinionReport(s: GameState, map: WorldMap, holder: NationId, target: NationId, ctx: OpinionContext = {}): OpinionReport {
  const h = s.nations[holder]
  const parts: OpinionPart[] = []
  const push = (label: string, value: number) => {
    if (Math.abs(value) >= 0.5) parts.push({ label, value: Math.round(value) })
  }
  if (!h || holder === target) return { total: 0, parts }
  const persona = PERSONALITIES[h.personality ?? 'honorable']
  push('Temperament', persona.temperament)
  if (atWar(s, holder, target)) push('At war', -50)
  if (isAllied(s, holder, target)) push('Allies', 35)
  else if (hasPact(s, holder, target)) push('Non-aggression pact', 10)
  if (s.deals.some((d) => d.kind === 'trade' && ((d.from === holder && d.to === target) || (d.from === target && d.to === holder)))) push('Trade partners', 10)
  const theirEnemies = ctx.enemies ? (ctx.enemies.get(target) ?? []) : enemiesOf(s, target)
  const mine = ctx.enemies ? (ctx.enemies.get(holder) ?? []) : enemiesOf(s, holder)
  const shared = mine.filter((e) => theirEnemies.includes(e)).length
  push('Common enemy', Math.min(30, shared * 15))
  const borders = ctx.borders ?? nationNeighbors(s, map, holder).has(target)
  if (borders) push('Border tensions', h.personality === 'expansionist' ? -14 : -6)
  if (hasCasusBelli(s, holder, target)) push('Grievance', -15)
  const coalition = ctx.coalition ?? coalitionActive(s)
  if (coalition && target === s.playerId && borders) push('Fears your power', -20)
  for (const m of storedOpinion(s, holder, target)) push(m.label, m.value)
  const total = Math.round(clamp(parts.reduce((sum, p) => sum + p.value, 0), -100, 100))
  return { total, parts }
}

export const opinionOf = (s: GameState, map: WorldMap, holder: NationId, target: NationId, ctx?: OpinionContext) =>
  opinionReport(s, map, holder, target, ctx).total

export function opinionLabel(v: number): string {
  if (v >= 60) return 'Devoted'
  if (v >= 25) return 'Friendly'
  if (v >= 5) return 'Cordial'
  if (v > -5) return 'Neutral'
  if (v > -25) return 'Wary'
  if (v > -60) return 'Hostile'
  return 'Hateful'
}
