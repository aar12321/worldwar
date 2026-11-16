import { AIR_UNITS, BORDER, GROUND_UNITS, NAVAL_UNITS, STATION } from '../data/deployment'
import { addLog, clamp, emptyUnits, forceUnits, pairKey, totalUnits } from './helpers'
import type { BorderRecord, Deployment, GameState, MissileType, Nation, NationId, Order, RegionId, UnitCounts, UnitType, Via, WorldMap } from './types'
import { UNIT_TYPES } from './types'

/**
 * Active military: forces on station. A nation may post shares of its warships on coastal patrol or in a submarine screen, of its
 * fighters and drones on air patrol, and of its ground forces on the border with each neighbor. What is left is the reserve.
 *
 * The rules, all of them here:
 * - Posted units cannot attack. Only the reserve can be sent (`freeUnits`). They still cost upkeep, food and oil as part of the force.
 * - Posted units still defend. A garrison fights at +35% on its own border and at half strength on any other front; patrols and the
 *   air screen fight at +35% against a landing from the sea or the air (`defenseWeights`).
 * - A garrison lengthens the Defense Line of the countries along its border (`lineBonus`) and blunts a surprise attack (`surpriseBonus`).
 * - Patrols meet landings from the sea or air and sink part of the landing force (`interception`), and the air screen shoots down
 *   part of a missile salvo (`airPatrolStop`).
 * A nation that has never set a posture has none of this: no bonus, no weak spot.
 */

type Share = Record<UnitType, number>

const sum = (u: UnitCounts, kinds: UnitType[]) => kinds.reduce((t, k) => t + u[k], 0)

export const deploymentOf = (n: Pick<Nation, 'military'> | undefined): Deployment | undefined => n?.military.deployment

/** Share of the ground forces on all borders, never more than all of them. */
export function groundPosted(d: Deployment): number {
  let t = 0
  for (const v of Object.values(d.border)) t += v
  return Math.min(1, t)
}

/** The share of the ground forces on the border with `x`. If the shares ever add up to more than all, they are scaled back to fit. */
export function borderShare(d: Deployment, x: NationId): number {
  let t = 0
  for (const v of Object.values(d.border)) t += v
  const v = d.border[x] ?? 0
  return t > 1 ? v / t : v
}

/** The share of each kind of unit that is on station. */
export function postedShares(d: Deployment): Share {
  const out = {} as Share
  const g = groundPosted(d)
  const sea = Math.min(1, d.coastal + d.subs)
  for (const k of UNIT_TYPES) out[k] = GROUND_UNITS.includes(k) ? g : NAVAL_UNITS.includes(k) ? sea : AIR_UNITS.includes(k) ? Math.min(1, d.air) : 0
  return out
}

/**
 * The units a nation can send to attack: its military less what stands on station. The same object as the military's own when no
 * posture is set, so a nation that never uses this plays as it always did. Armies in the field count toward what is posted, so a
 * nation does not lose its guard by sending an army out.
 */
export function freeUnits(s: Pick<GameState, 'nations' | 'armies'>, id: NationId): UnitCounts {
  const n = s.nations[id]
  if (!n) return emptyUnits()
  const d = n.military.deployment
  if (!d) return n.military.units
  const force = forceUnits(s, id)
  const share = postedShares(d)
  const out = { ...n.military.units }
  for (const k of UNIT_TYPES) if (share[k] > 0) out[k] = Math.max(0, out[k] - force[k] * share[k])
  return out
}

/** The units on station, by kind. */
export function postedUnits(s: Pick<GameState, 'nations' | 'armies'>, id: NationId): UnitCounts {
  const out = emptyUnits()
  const d = s.nations[id]?.military.deployment
  if (!d) return out
  const force = forceUnits(s, id)
  const share = postedShares(d)
  for (const k of UNIT_TYPES) out[k] = force[k] * share[k]
  return out
}

/** Divisions of the free units (the reserve) a nation can attack with. */
export const reserveDivisions = (s: Pick<GameState, 'nations' | 'armies'>, id: NationId) => totalUnits(freeUnits(s, id))

/** Nations that share a land border with `id`, each with the number of `id`'s countries along it. */
export function landBorders(s: GameState, map: WorldMap, id: NationId): Map<NationId, number> {
  const along = new Map<NationId, Set<RegionId>>()
  for (const r of Object.values(s.regions)) {
    if (r.owner !== id) continue
    const mr = map.regions[r.id]
    if (!mr) continue
    for (const nb of mr.neighbors) {
      const o = s.regions[nb]?.owner
      if (!o || o === id || !s.nations[o]?.alive) continue
      let set = along.get(o)
      if (!set) along.set(o, (set = new Set()))
      set.add(r.id)
    }
  }
  const out = new Map<NationId, number>()
  for (const [o, set] of along) out.set(o, set.size)
  return out
}

/** The countries of `id` along its border with `x`: as noted when the posture was set or last kept up, else worked out now. */
export function frontsOf(s: GameState, map: WorldMap, id: NationId, x: NationId): number {
  const noted = s.nations[id]?.military.deployment?.fronts?.[x]
  return noted ?? landBorders(s, map, id).get(x) ?? 0
}

/** Divisions of ground troops `id` keeps on its border with `x`. */
export function garrisonDivisions(s: GameState, id: NationId, x: NationId): number {
  const d = s.nations[id]?.military.deployment
  if (!d) return 0
  return sum(forceUnits(s, id), GROUND_UNITS) * borderShare(d, x)
}

/** The heat of a border's incidents this month: what the record held, less the fade since. */
export const heatNow = (s: Pick<GameState, 'turn'>, rec: BorderRecord | undefined) => (rec?.heat ? Math.max(0, rec.heat - BORDER.heatFade * (s.turn - (rec.at ?? s.turn))) : 0)

/** Whether `by` has closed the border with `other`. */
export const closedBy = (s: Pick<GameState, 'borders'>, by: NationId, other: NationId) => !!s.borders?.[pairKey(by, other)]?.closedBy?.includes(by)

/**
 * How well `defender` guards its border with `attacker`, from 0 (nobody there) to 1 (fully guarded): the garrison's divisions against
 * what the border needs, which is about eight tenths of a division for each of the defender's countries along it. A closed border adds
 * checkpoints. It is zero where there is no land border.
 */
export function borderCover(s: GameState, map: WorldMap, defender: NationId, attacker: NationId): number {
  const g = garrisonDivisions(s, defender, attacker)
  // Nobody posted there: the border needs no search of the map.
  if (g <= 0 && !closedBy(s, defender, attacker)) return 0
  const front = frontsOf(s, map, defender, attacker)
  if (!front) return 0
  const checkpoints = g > 0 && closedBy(s, defender, attacker) ? 0.25 : 0
  return clamp(g / (STATION.fullPerRegion * front) + checkpoints, 0, 1)
}

/**
 * Defense Line points the garrisons add to a country: for each neighbor it borders, the garrison on that border shared among the
 * countries along it. A nation with no garrisons gets nothing.
 */
export function lineBonus(s: GameState, map: WorldMap, regionId: RegionId): number {
  const r = s.regions[regionId]
  const d = s.nations[r?.owner]?.military.deployment
  if (!d) return 0
  let any = false
  for (const v of Object.values(d.border)) if (v > 0) any = true
  if (!any) return 0
  const mr = map.regions[regionId]
  const seen = new Set<NationId>()
  let bonus = 0
  for (const nb of mr.neighbors) {
    const o = s.regions[nb]?.owner
    if (!o || o === r.owner || seen.has(o)) continue
    seen.add(o)
    if (!((d.border[o] ?? 0) > 0)) continue
    bonus += (STATION.linePerDivision * garrisonDivisions(s, r.owner, o)) / Math.max(1, frontsOf(s, map, r.owner, o))
  }
  return Math.min(STATION.lineCap, bonus)
}

/**
 * How much of each kind of unit stands in a fight, as a multiplier on its numbers, when `attacker` comes at this nation. The reserve
 * stands at full strength. A garrison stands at +35% on its own border and at half on any other; patrols and the air screen stand at
 * +35% against a landing from the sea or air. Null when no posture is set, so everything stands as it always did.
 */
export function defenseWeights(s: GameState, defender: NationId, attacker: NationId, bySea: boolean): Share | null {
  const d = s.nations[defender]?.military.deployment
  if (!d) return null
  const posted = postedShares(d)
  const total = groundPosted(d)
  const on = bySea ? 0 : Math.min(total, borderShare(d, attacker))
  const out = {} as Share
  for (const k of UNIT_TYPES) {
    if (GROUND_UNITS.includes(k)) out[k] = 1 - total + on * (1 + STATION.postBonus) + (total - on) * STATION.elsewhere
    else if (posted[k] > 0) out[k] = 1 - posted[k] + posted[k] * (bySea ? 1 + STATION.seaPostBonus : 1)
    else out[k] = 1
  }
  return out
}

/** Divisions on patrol: surface ships, the submarine screen, and the air screen. */
export function patrolCover(s: GameState, id: NationId): { coastal: number; subs: number; air: number } {
  const d = s.nations[id]?.military.deployment
  if (!d) return { coastal: 0, subs: 0, air: 0 }
  const force = forceUnits(s, id)
  const navy = sum(force, NAVAL_UNITS)
  const sea = d.coastal + d.subs > 1 ? 1 / (d.coastal + d.subs) : 1
  return { coastal: navy * d.coastal * sea, subs: navy * d.subs * sea, air: sum(force, AIR_UNITS) * Math.min(1, d.air) }
}

/** Whether the nation watches its waters: some warships posted on patrol or in the screen. */
export function watchesWaters(s: GameState, id: NationId): boolean {
  const c = patrolCover(s, id)
  return c.coastal + c.subs >= STATION.minPatrol
}

export interface Intercept {
  /** Share of the landing force lost on the way in. */
  share: number
  /** Patrol strength that met it, in divisions, after weighing each kind of patrol against this kind of crossing. */
  patrol: number
}

/** How the defender's patrols meet a landing that crosses water or air by `via`: the share of the landing force they sink. */
export function interception(s: GameState, defender: NationId, via: Via, landing: UnitCounts): Intercept {
  const none = { share: 0, patrol: 0 }
  if (via === 'land' || !s.nations[defender]?.military.deployment) return none
  const c = patrolCover(s, defender)
  const w = STATION.patrolWeight[via]
  const patrol = c.coastal * w.coastal + c.subs * w.subs + c.air * w.air
  if (patrol < STATION.minPatrol) return { share: 0, patrol }
  const landed = Math.max(0.5, totalUnits(landing) - landing.missile)
  return { share: Math.min(STATION.interceptMax, (STATION.interceptPerRatio * patrol) / landed), patrol }
}

/** The share of a missile salvo the victim's air patrols shoot down. */
export function airPatrolStop(s: GameState, victim: NationId, kind: MissileType): number {
  if (!s.nations[victim]?.military.deployment) return 0
  return Math.min(STATION.missileStopMax, STATION.missileStopPer * patrolCover(s, victim).air) * STATION.missileCatch[kind]
}

/**
 * How much stronger a first strike makes `attacker` when it crosses a border `defender` is not guarding, in the first months of a
 * war. Zero for a nation that has no posture, and for a border that is fully guarded.
 */
export function surpriseBonus(s: GameState, map: WorldMap, defender: NationId, attacker: NationId): number {
  if (!s.nations[defender]?.military.deployment) return 0
  const age = s.turn - (s.warStarted[pairKey(attacker, defender)] ?? -99)
  if (age > STATION.surpriseMonths) return 0
  return STATION.surpriseMax * (1 - borderCover(s, map, defender, attacker))
}

// ---- Orders ----

type SetDeployment = Extract<Order, { type: 'setDeployment' }>

const share2 = (v: number) => Math.round(v * 100) / 100

export function validateDeployment(s: GameState, map: WorldMap, o: SetDeployment, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const shares = [o.coastal, o.subs, o.air, ...Object.values(o.border ?? {})]
  if (shares.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) return 'Shares go from 0 to 100%'
  if (o.coastal + o.subs > 1 + 1e-6) return 'Coastal patrol and the submarine screen cannot take more than all your warships'
  const ground = Object.values(o.border).reduce((t, v) => t + v, 0)
  if (ground > 1 + 1e-6) return 'Border garrisons cannot take more than all your ground forces'
  const front = landBorders(s, map, o.nationId)
  for (const [x, v] of Object.entries(o.border)) {
    if (v > 0 && !front.has(x)) return `${s.nations[x]?.name ?? x} is not on your land border`
  }
  if (pending.some((p) => p.type === 'setDeployment' && p.nationId === o.nationId)) return 'Already redeployed this month'
  const d = n.military.deployment
  if (d && d.changed >= s.turn) return 'Your forces were moved this month. They can be moved again next month.'
  return null
}

/** Posts the forces. Mutates `s`. */
export function applyDeployment(s: GameState, map: WorldMap, o: SetDeployment) {
  const n = s.nations[o.nationId]
  const border: Record<NationId, number> = {}
  const fronts: Record<NationId, number> = {}
  const front = landBorders(s, map, o.nationId)
  for (const x of Object.keys(o.border).sort()) {
    if (!(o.border[x] > 0)) continue
    border[x] = share2(o.border[x])
    fronts[x] = front.get(x) ?? 1
  }
  n.military.deployment = { coastal: share2(o.coastal), subs: share2(o.subs), air: share2(o.air), border, changed: s.turn, fronts }
  if (n.isPlayer) addLog(s, 'info', `Forces on station: ${describePosture(s, o.nationId)}.`, [o.nationId])
}

/** One line on what is on station, for the log. */
export function describePosture(s: GameState, id: NationId): string {
  const d = s.nations[id]?.military.deployment
  if (!d) return 'none'
  const parts: string[] = []
  if (d.coastal > 0) parts.push(`${Math.round(d.coastal * 100)}% of the fleet on patrol`)
  if (d.subs > 0) parts.push(`${Math.round(d.subs * 100)}% in the submarine screen`)
  if (d.air > 0) parts.push(`${Math.round(d.air * 100)}% of the air force on patrol`)
  const ground = groundPosted(d)
  if (ground > 0) parts.push(`${Math.round(ground * 100)}% of the ground forces on ${Object.keys(d.border).length} border${Object.keys(d.border).length === 1 ? '' : 's'}`)
  return parts.join(', ') || 'everything in reserve'
}

/** The month's upkeep of postures: garrisons for nations that no longer border, or are gone, are stood down. Mutates `s`. */
export function runDeployment(s: GameState, map: WorldMap) {
  for (const n of Object.values(s.nations)) {
    const d = n.military.deployment
    if (!n.alive || !d) continue
    const keys = Object.keys(d.border)
    if (keys.length === 0) continue
    const front = landBorders(s, map, n.id)
    const fronts: Record<NationId, number> = {}
    for (const x of keys) {
      if (!front.has(x)) delete d.border[x]
      else fronts[x] = front.get(x)!
    }
    d.fronts = fronts
  }
  if (s.borders) {
    for (const [key, rec] of Object.entries(s.borders)) {
      const [a, b] = key.split('|')
      if (rec.closedBy) {
        rec.closedBy = rec.closedBy.filter((x) => s.nations[x]?.alive && (x === a || x === b))
        if (!rec.closedBy.length || !s.nations[a]?.alive || !s.nations[b]?.alive) delete rec.closedBy
      }
      if (heatNow(s, rec) <= 0) {
        delete rec.heat
        delete rec.at
      }
      if (!rec.closedBy && rec.heat === undefined) delete s.borders[key]
    }
    if (Object.keys(s.borders).length === 0) delete s.borders
  }
}
