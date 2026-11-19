import { PERSONALITIES } from '../data/personalities'
import { atWar, clamp, enemiesOf, hasCasusBelli, hasPact, isAllied } from '../engine/helpers'
import type { GameState, NationId, OpinionModifier, WorldMap } from '../engine/types'
import { conquestGoal, countriesTaken, populationShare } from '../engine/victory'
import { sameFaction } from '../engine/factions'
import { FACTION } from '../data/factions'
import { RELATIONS, TIES } from '../data/relations'
import { difficultyOf } from '../data/difficulty'
import { tieLines } from '../engine/ties'
import { relationLines } from '../engine/relationParts'
import { foreignMinisterOpinion } from '../engine/civics'

/** A coalition forms against the player once they hold this fraction of their victory target. */
export const COALITION_THRESHOLD = 0.35
/** Reputation (infamy) at which rivals band together against a player whatever their size. */
export const COALITION_INFAMY = 60
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

/** Records a favour that can stack only up to `cap` in all (a positive line). Used with ties on, so repeating a gift cannot buy unlimited goodwill. */
export function addOpinionCapped(s: GameState, holder: NationId, target: NationId, label: string, value: number, decay: number, cap: number) {
  const have = (s.opinions[opinionKey(holder, target)] ?? []).find((m) => m.label === label)?.value ?? 0
  const room = Math.max(0, cap - have)
  if (Math.min(value, room) >= 0.5) addOpinion(s, holder, target, label, Math.min(value, room), decay)
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

/** Rivals also band together once the player has taken half the countries their victory needs. */
export function coalitionActive(s: GameState, map?: WorldMap): boolean {
  // With ties on, a difficulty without coalitions (Easy) never has one, whoever asks.
  if (TIES.on && !difficultyOf(s.settings.difficulty).coalitions) return false
  return s.humans.some((id) => {
    const p = s.nations[id]
    if (!p?.alive) return false
    // A player with a dreadful reputation alarms the world whatever their size.
    if ((s.infamy[id] ?? 0) >= COALITION_INFAMY) return true
    // With ties on, size alone alarms nobody until the player has started taking land: a nation that starts big is no threat yet.
    if (TIES.on && countriesTaken(s, id) < TIES.fearAfterTaken) return false
    // Trying to hold the whole world alarms everyone long before it is done.
    if (s.settings.goal === 'world') return populationShare(s, id) >= 0.12 || countriesTaken(s, id) >= 6
    if (populationShare(s, id) >= s.settings.victoryShare * COALITION_THRESHOLD) return true
    return !!map && countriesTaken(s, id) >= Math.ceil(conquestGoal(s.settings.victoryShare) / 2)
  })
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
  push('Temperament', TIES.on ? (TIES.temperament[h.personality ?? 'honorable'] ?? 0) : persona.temperament)
  if (atWar(s, holder, target)) push('At war', -50)
  if (isAllied(s, holder, target)) push('Allies', 35)
  else if (hasPact(s, holder, target)) push('Non-aggression pact', 10)
  const trading = s.deals.some((d) => d.kind === 'trade' && ((d.from === holder && d.to === target) || (d.from === target && d.to === holder)))
  // With ties on, trade is a line that grows with the deal's worth and how long the trade has run (below).
  if (trading && !TIES.on) push('Trade partners', 10)
  const theirEnemies = ctx.enemies ? (ctx.enemies.get(target) ?? []) : enemiesOf(s, target)
  const mine = ctx.enemies ? (ctx.enemies.get(holder) ?? []) : enemiesOf(s, holder)
  const shared = mine.filter((e) => theirEnemies.includes(e)).length
  push('Common enemy', Math.min(30, shared * 15))
  if (sameFaction(s, holder, target)) push('Faction partners', FACTION.opinionBonus)
  if (RELATIONS.on) {
    // Like governments understand each other; an open society and a closed one do not.
    const hg = h.government
    const tg = s.nations[target]?.government
    if (tg && hg === tg) push('Same system of government', 2)
    else if (tg && ((hg === 'democracy' && (tg === 'junta' || tg === 'one_party')) || (tg === 'democracy' && (hg === 'junta' || hg === 'one_party')))) push('Opposed systems of government', -2)
  }
  const borders = ctx.borders ?? nationNeighbors(s, map, holder).has(target)
  if (borders && !TIES.on) push('Border tensions', h.personality === 'expansionist' ? -14 : -6)
  else if (borders) {
    // A neighbor is a little uneasy about a shared border, an expansionist more so; a treaty or a shared bloc settles it, trade halves it.
    const settled = isAllied(s, holder, target) || hasPact(s, holder, target) || sameFaction(s, holder, target)
    const base = h.personality === 'expansionist' ? TIES.border.expansionist : TIES.border.base
    if (!settled) push('Border tensions', base * (trading ? TIES.border.tradeShare : 1))
  }
  if (hasCasusBelli(s, holder, target)) push('Grievance', -15)
  const coalition = ctx.coalition ?? coalitionActive(s, TIES.on ? map : undefined)
  if (coalition && s.humans.includes(target) && borders) push('Fears your power', TIES.on ? TIES.fear : -20)
  // A reputation for aggression: the world is uneasy about a nation that starts wars and takes land, until it fades.
  push('Uneasy about its wars', -Math.min(30, (s.infamy?.[target] ?? 0) * 0.5))
  for (const m of storedOpinion(s, holder, target)) push(m.label, m.value)
  // Embassies, running programs, a joint war plan, long friendship and neglect: worked out from the state, not stored.
  if (s.relations) for (const l of relationLines(s, holder, target)) push(l.label, l.value)
  // Ties: trade that grows with worth and time, their money in our businesses, a long peace (nothing with ties off).
  for (const l of tieLines(s, holder, target, borders)) push(l.label, l.value)
  // A capable foreign minister wins a little goodwill everywhere (the government desk; nothing without one).
  push('Their foreign minister', foreignMinisterOpinion(s.nations[target]))
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
