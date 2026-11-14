import { LIVE } from '../data/live'
import { REACH } from '../data/war'
import { FRONTIER } from '../data/systems'
import { clamp, distanceKm, emptyUnits, newId, totalUnits } from './helpers'
import { fireMissiles } from './systems'
import { canAttackRegion, commitShare } from './warfare'
import type { Army, AttackOrder, GameState, GeoPoint, MissileFlight, NationId, Order, RegionId, Via, WorldMap } from './types'
import { UNIT_TYPES } from './types'

type Strike = Extract<Order, { type: 'strike' }>

const centre = (map: WorldMap, id: RegionId): GeoPoint => ({ lat: map.regions[id].lat, lng: map.regions[id].lng })

/** Days a march of `km` takes by this route, kept between the route's shortest and longest. */
export function travelDays(km: number, via: Via): number {
  const t = LIVE.travel[via]
  return clamp(Math.ceil(km / t.kmPerDay) + t.extra, t.min, t.max)
}

/** The point a fraction `t` of the way along the shortest path over the globe from `a` to `b`. */
export function greatCircle(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  const rad = Math.PI / 180
  const p1 = a.lat * rad
  const l1 = a.lng * rad
  const p2 = b.lat * rad
  const l2 = b.lng * rad
  const x1 = Math.cos(p1) * Math.cos(l1)
  const y1 = Math.cos(p1) * Math.sin(l1)
  const z1 = Math.sin(p1)
  const x2 = Math.cos(p2) * Math.cos(l2)
  const y2 = Math.cos(p2) * Math.sin(l2)
  const z2 = Math.sin(p2)
  const omega = Math.acos(clamp(x1 * x2 + y1 * y2 + z1 * z2, -1, 1))
  const sin = Math.sin(omega)
  // The same point twice, or opposite points where every path is as short as another.
  if (omega < 1e-9) return { lat: a.lat, lng: a.lng }
  if (sin < 1e-9) return t < 0.5 ? { lat: a.lat, lng: a.lng } : { lat: b.lat, lng: b.lng }
  const k1 = Math.sin((1 - t) * omega) / sin
  const k2 = Math.sin(t * omega) / sin
  const x = k1 * x1 + k2 * x2
  const y = k1 * y1 + k2 * y2
  const z = k1 * z1 + k2 * z2
  return { lat: Math.asin(clamp(z, -1, 1)) / rad, lng: Math.atan2(y, x) / rad }
}

/** Where an army is at an absolute day, how far along its leg it is (0 to 1), and how high its path arcs above the globe. */
export function armyAt(a: Army, t: number): GeoPoint & { progress: number; alt: number } {
  const progress = clamp((t - a.start) / Math.max(1e-6, a.end - a.start), 0, 1)
  const here = greatCircle(a.from, a.to, progress)
  return { ...here, progress, alt: LIVE.arcHeight[a.via] * Math.sin(Math.PI * progress) }
}

/** The country an army sets out from for this route: the nearest that qualifies, the lower id breaking a tie. */
export function launchPoint(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, via: Via): RegionId | null {
  const t = map.regions[target]
  if (!t) return null
  const candidates: RegionId[] = []
  if (via === 'land') {
    for (const id of t.neighbors) if (s.regions[id]?.owner === nationId) candidates.push(id)
  } else if (via === 'lane') {
    for (const id of t.seaLanes) {
      const r = s.regions[id]
      if (r?.owner === nationId && r.buildings.port > 0) candidates.push(id)
    }
  } else {
    for (const r of Object.values(s.regions)) {
      if (r.owner !== nationId || !map.regions[r.id]) continue
      const km = distanceKm(map.regions[r.id], t)
      if (via === 'fleet' ? r.buildings.port > 0 && km <= REACH.seaKm : r.buildings.factory > 0 && km <= REACH.airKm) candidates.push(r.id)
    }
  }
  let best: RegionId | null = null
  let bestKm = Infinity
  for (const id of candidates.sort()) {
    if (!map.regions[id]) continue
    const km = distanceKm(map.regions[id], t)
    if (km < bestKm) {
      best = id
      bestKm = km
    }
  }
  return best
}

export interface Trip {
  via: Via
  bySea: boolean
  from: RegionId
  km: number
  /** Days of marching, one way. */
  days: number
}

/** How an attack on a country would travel, or null when it cannot reach it. */
export function planTrip(s: GameState, map: WorldMap, nationId: NationId, target: RegionId): Trip | null {
  const reach = canAttackRegion(s, map, nationId, target)
  if (!reach.ok || !reach.via) return null
  const from = launchPoint(s, map, nationId, target, reach.via)
  if (!from) return null
  const km = distanceKm(map.regions[from], map.regions[target])
  return { via: reach.via, bySea: reach.bySea, from, km, days: travelDays(km, reach.via) }
}

/** When an army launched on `today` would set out, arrive, and be home again, in absolute days. */
export function tripSchedule(trip: Trip, today: number): { leaves: number; arrives: number; homeBy: number } {
  const leaves = today + LIVE.musterDays
  const arrives = leaves + trip.days
  return { leaves, arrives, homeBy: arrives + LIVE.battleDays + trip.days }
}

/** Sends part of a nation's military to attack. The units leave the national military now and rejoin it when the army is home. Mutates `s`. */
export function launchArmy(s: GameState, map: WorldMap, o: AttackOrder, today: number): Army | null {
  const n = s.nations[o.nationId]
  const trip = planTrip(s, map, o.nationId, o.target)
  if (!n || !trip) return null
  const commit = o.commit ?? 'main'
  const stance = o.stance ?? 'assault'
  const share = commitShare(n, commit)
  const units = emptyUnits()
  for (const k of UNIT_TYPES) {
    const take = n.military.units[k] * share
    units[k] = take
    n.military.units[k] -= take
  }
  // The player may choose exactly how many missiles go along. Otherwise they go in the same share as everything else.
  if (o.missiles !== undefined) {
    n.military.units.missile += units.missile
    units.missile = Math.min(Math.max(0, Math.floor(o.missiles)), Math.floor(n.military.units.missile + 1e-9))
    n.military.units.missile -= units.missile
  }
  const m = n.military
  m.attacksThisTurn = m.lastAttackTurn === s.turn ? m.attacksThisTurn + 1 : 1
  m.lastAttackTurn = s.turn
  const { leaves, arrives } = tripSchedule(trip, today)
  const army: Army = {
    id: newId(s, 'a'),
    nationId: o.nationId,
    units,
    commit,
    stance,
    share,
    via: trip.via,
    bySea: trip.bySea,
    home: trip.from,
    target: o.target,
    phase: 'outbound',
    from: centre(map, trip.from),
    to: centre(map, o.target),
    start: leaves,
    end: arrives,
    launched: today,
  }
  ;(s.armies ??= []).push(army)
  return army
}

/** Where an army heading home should go: its launch country if it is still held, else the nearest country its nation holds. */
export function homeFor(s: GameState, map: WorldMap, a: Army, at: GeoPoint): RegionId | null {
  if (s.regions[a.home]?.owner === a.nationId) return a.home
  let best: RegionId | null = null
  let bestKm = Infinity
  for (const r of Object.values(s.regions).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (r.owner !== a.nationId || !map.regions[r.id]) continue
    const km = distanceKm(map.regions[r.id], at)
    if (km < bestKm) {
      best = r.id
      bestKm = km
    }
  }
  return best
}

/** The army's units go back into the national military and the army is no more. */
export function bringHome(s: GameState, a: Army) {
  const n = s.nations[a.nationId]
  if (n?.alive) for (const k of UNIT_TYPES) n.military.units[k] += a.units[k]
  s.armies = (s.armies ?? []).filter((x) => x.id !== a.id)
}

function disband(s: GameState, a: Army) {
  s.armies = (s.armies ?? []).filter((x) => x.id !== a.id)
}

/** Starts the march home. From a battle it leaves at once; from the road it leaves from where the army is. */
function heading(s: GameState, map: WorldMap, a: Army, here: GeoPoint, today: number, days: number | null) {
  const home = homeFor(s, map, a, here)
  if (!home) return disband(s, a)
  const to = centre(map, home)
  a.phase = 'returning'
  a.from = here
  a.to = to
  a.start = today
  a.end = today + (days ?? travelDays(distanceKm(here, to), a.via))
}

/** After the battle the army marches home from the country it fought in. */
export function sendHome(s: GameState, map: WorldMap, a: Army, today: number) {
  heading(s, map, a, centre(map, a.target), today, null)
}

/**
 * Calls an army off before it arrives, because it was recalled or the reason for the march is gone.
 * Still mustering, it is back at once. On the road it turns round and takes as long to get home as it has marched.
 */
export function turnBack(s: GameState, map: WorldMap, a: Army, today: number, why: NonNullable<Army['outcome']>) {
  if (today < a.start) {
    bringHome(s, a)
    return
  }
  const here = armyAt(a, today)
  const marched = Math.max(1, Math.ceil(here.progress * (a.end - a.start)))
  a.outcome = why
  heading(s, map, a, { lat: here.lat, lng: here.lng }, today, marched)
}

export const armiesOf = (s: Pick<GameState, 'armies'>, nationId?: NationId): Army[] => (s.armies ?? []).filter((a) => !nationId || a.nationId === nationId)

/** Armies on their way out to attack a country this nation holds. */
export const incomingArmies = (s: GameState, nationId: NationId): Army[] => (s.armies ?? []).filter((a) => a.phase === 'outbound' && s.regions[a.target]?.owner === nationId)

/** Divisions a nation has in the field. */
export function inTheField(s: Pick<GameState, 'armies'>, nationId: NationId): number {
  let sum = 0
  for (const a of s.armies ?? []) if (a.nationId === nationId) sum += totalUnits(a.units)
  return sum
}

export function recallProblem(s: GameState, nationId: NationId, armyId: string): string | null {
  const a = s.armies?.find((x) => x.id === armyId)
  if (!a || a.nationId !== nationId) return 'That army is not yours'
  if (a.phase !== 'outbound') return a.phase === 'fighting' ? 'It is fighting now' : 'It is already on its way home'
  return null
}

/** Fires a salvo of hypersonic missiles. They leave now and land a day later. Mutates `s`. */
export function launchStrike(s: GameState, map: WorldMap, o: Strike, today: number): MissileFlight | null {
  const fired = fireMissiles(s, o)
  if (fired < 1) return null
  const t = map.regions[o.target]
  let from: RegionId | null = null
  let bestKm = Infinity
  for (const r of Object.values(s.regions).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (r.owner !== o.nationId || r.buildings.factory <= 0 || !map.regions[r.id]) continue
    const km = distanceKm(map.regions[r.id], t)
    if (km <= FRONTIER.strikeKm && km < bestKm) {
      from = r.id
      bestKm = km
    }
  }
  const flight: MissileFlight = { id: newId(s, 'f'), nationId: o.nationId, from: from ?? o.target, target: o.target, count: fired, launched: today, lands: today + LIVE.missileDays }
  ;(s.flights ??= []).push(flight)
  return flight
}
