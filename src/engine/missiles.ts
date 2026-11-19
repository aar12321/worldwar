import { addOpinion } from '../ai/opinion'
import { AIRCRAFT_RULES, type AircraftEffects } from '../data/aircraft'
import { MW } from '../data/missileWar'
import { MISSILES, MISSILE_PROGRAM, MISSILE_TYPES, PROGRAM_MISSILES } from '../data/missiles'
import { aircraftEffects, pastDefenses } from './aircraft'
import { interceptFactor } from './combat'
import { airPatrolStop, patrolFighters } from './deployment'
import { addInfamy, addLog, atWar, canUseUnit, clamp, distanceKm } from './helpers'
import { resolveSalvo, siteDown, specOf, trucePair } from './missileWar'
import { programCapacity, programCostCut, programStorage, rangeKm } from './programEffects'
import type { GameState, MissileFlight, MissileType, Nation, NationId, Order, RegionId, SalvoReport, StrikeAim, WorldMap } from './types'
import { UNIT_TYPES } from './types'

type Strike = Extract<Order, { type: 'strike' }>
type Build = Extract<Order, { type: 'buildMissiles' }>

export const strikeKind = (o: { kind?: MissileType }): MissileType => o.kind ?? 'hypersonic'

/** Missiles of a kind in store. Hypersonic ones are the military's own unit, the rest are the arsenal. */
export const missileStock = (n: Nation, kind: MissileType): number => Math.floor((kind === 'hypersonic' ? n.military.units.missile : (n.arsenal?.[kind] ?? 0)) + 1e-9)

/** Missiles of a kind still free to fire: the stock, less what strikes waiting for the month end already claim (and, for hypersonic, attacks that carry some). */
export function missilesFree(n: Nation, kind: MissileType, pending: Order[]): number {
  let used = 0
  for (const p of pending) {
    if (p.nationId !== n.id) continue
    if (p.type === 'strike' && p.weapon === 'missile' && strikeKind(p) === kind) used += p.count ?? 1
    else if (p.type === 'attack' && kind === 'hypersonic') used += p.missiles ?? 0
  }
  return Math.max(0, missileStock(n, kind) - used)
}

/** Takes missiles out of the stock and returns how many left. */
export function takeMissiles(n: Nation, kind: MissileType, count: number): number {
  const fired = Math.min(count, missileStock(n, kind))
  if (fired < 1) return 0
  if (kind === 'hypersonic') n.military.units.missile -= fired
  else (n.arsenal ??= {})[kind] = (n.arsenal[kind] ?? 0) - fired
  return fired
}

/** The kinds a nation can use now: some are in store, or it can make or train them. The Missile War tab and the program list these. */
export function missileKinds(n: Nation): MissileType[] {
  return MISSILE_TYPES.filter((k) => missileStock(n, k) >= 1 || (k === 'hypersonic' ? canUseUnit(n, 'missile') : programLevel(n) >= MISSILES[k].level))
}

/** Missiles in the air (live games) that will land on a country this nation holds, fired by someone else. */
export function incomingMissiles(s: Pick<GameState, 'flights' | 'regions'>, nationId: NationId): MissileFlight[] {
  return (s.flights ?? []).filter((f) => f.nationId !== nationId && s.regions[f.target]?.owner === nationId)
}

/** The fighters at home on each side of a strike, with what their developments add up to: hunters shoot missiles down, stealth gets past shields. */
export interface AirDefense {
  attacker?: AircraftEffects
  defender?: AircraftEffects
  /** Fighters the defender has at home, in divisions. */
  fighters: number
}

/**
 * The share of a salvo that gets through: the shield's own rating, made harsher or kinder by the kind of missile, and then the
 * defender's missile-hunter fighters (a full wing of three or more at home, less with fewer; slow cruise missiles are easiest to
 * catch, ballistic warheads hardest). The attacker's stealth and electronic warfare weaken both. Without `air` it is the shield alone.
 */
export function getsThrough(shield: number, kind: MissileType, air?: AirDefense): number {
  const base = clamp(1 - (1 - interceptFactor(shield)) * MISSILES[kind].intercept, 0.05, 1)
  if (!air || (!air.attacker && !air.defender)) return base
  return clamp(pastDefenses(base, air.attacker, air.defender, air.fighters, AIRCRAFT_RULES.huntVs[kind]), 0.05, 1)
}

/** How far a kind reaches for a nation: the table's range, plus what its missile program's propulsion work adds. */
export const reachKm = (n: Pick<Nation, 'mprog'> | undefined, kind: MissileType): number => rangeKm(n, kind, MISSILES[kind].km)

/** Where a strike would leave from: the nearest of your countries with a factory that reaches the target, or null if none does. */
export function launchSite(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, kind: MissileType): RegionId | null {
  const t = map.regions[target]
  let best: RegionId | null = null
  let bestKm = Infinity
  for (const r of Object.values(s.regions).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (r.owner !== nationId || r.buildings.factory <= 0 || !map.regions[r.id]) continue
    // A launch site that a counterforce strike shut cannot fire until it reopens.
    if (MW.enabled && siteDown(s, s.nations[nationId], r.id)) continue
    const km = distanceKm(map.regions[r.id], t)
    if (km <= reachKm(s.nations[nationId], kind) && km < bestKm) {
      best = r.id
      bestKm = km
    }
  }
  return best
}

export function validateMissileStrike(s: GameState, map: WorldMap, o: Strike, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const kind = strikeKind(o)
  const spec = MISSILES[kind]
  // Hypersonic missiles keep the plain word they have always had.
  const noun = kind === 'hypersonic' ? 'missile' : spec.name.toLowerCase()
  if (missileStock(n, kind) < 1) return kind === 'hypersonic' ? 'Needs hypersonic missiles' : `You have no ${noun}s`
  const count = o.count ?? 1
  if (!Number.isInteger(count) || count < 1) return 'Choose how many missiles to fire'
  const left = missilesFree(n, kind, pending)
  if (left < count) return left <= 0 ? `No ${noun}s left this month` : `Only ${left} ${noun}${left === 1 ? '' : 's'} left this month`
  if (o.aim !== undefined && o.aim !== 'country' && o.aim !== 'site') return 'Choose what to aim at'
  const victim = s.regions[o.target]?.owner
  if (MW.enabled && victim && trucePair(s, o.nationId, victim) !== null) return 'A missile ceasefire holds with them'
  if (o.aim === 'site' && (s.regions[o.target]?.buildings.factory ?? 0) <= 0) return 'No launch site there (it needs a factory)'
  if (!launchSite(s, map, o.nationId, o.target, kind)) {
    const shut = MW.enabled && Object.values(s.regions).some((r) => r.owner === o.nationId && r.buildings.factory > 0 && siteDown(s, n, r.id))
    return shut ? 'Your launch sites are shut by a counterforce strike. They reopen in a month or two.' : `Out of range: ${spec.name.toLowerCase()}s reach ${reachKm(n, kind)} km from a country with a factory`
  }
  return null
}

/** The rules before the missile war (kept so a test can prove nothing else moved): shield and hunters only, no reports, no tension. */
function strikeHitsLegacy(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, kind: MissileType, fired: number) {
  const spec = specOf(kind)
  const n = s.nations[nationId]
  const region = s.regions[target]
  const victim = s.nations[region.owner]
  const place = map.regions[target].name
  const fxA = aircraftEffects(n)
  const fxD = aircraftEffects(victim)
  // The victim's air patrols shoot some of a salvo down before the shield does its work.
  const patrol = airPatrolStop(s, victim.id, kind)
  const through = getsThrough(victim.systems?.shield ?? 0, kind, fxA || fxD ? { attacker: fxA, defender: fxD, fighters: victim.military.units.fighter + patrolFighters(s, victim.id) } : undefined) * (1 - patrol)
  const stopped = Math.round((1 - through) * 100)
  const parts: string[] = []
  if (spec.line > 0) {
    const hit = Math.min(spec.lineMax, fired * spec.line) * through
    // A strike never leaves a line lower than half a point, and never heals one that a battle already wore below that.
    region.line = Math.min(region.line, Math.max(0.5, region.line - hit))
    parts.push(`the Defense Line fell by ${hit.toFixed(1)}`)
  }
  // The factories stop only if enough of the salvo gets through the shield: one cruise missile shot down halts nothing.
  if (spec.factoryTurns > 0 && fired * through >= (spec.factoryNeed ?? 0.5) - 1e-9) {
    region.sabotaged = Math.max(region.sabotaged, spec.factoryTurns)
    parts.push(`the factories stopped for ${spec.factoryTurns} month${spec.factoryTurns === 1 ? '' : 's'}`)
  }
  if (spec.army > 0) {
    const share = Math.min(spec.armyMax, fired * spec.army) * through
    for (const k of UNIT_TYPES) victim.military.units[k] *= 1 - share
    for (const a of s.armies ?? []) if (a.nationId === victim.id) for (const k of UNIT_TYPES) a.units[k] *= 1 - share
    parts.push(`${Math.round(share * 100)}% of its army was destroyed`)
  }
  if (spec.perBuilding > 0) {
    const kills = Math.floor((fired * through) / spec.perBuilding)
    let lost = 0
    for (let i = 0; i < kills; i++) {
      const b = (Object.keys(region.buildings) as (keyof typeof region.buildings)[]).filter((k) => region.buildings[k] > 0).sort((a, c) => region.buildings[c] - region.buildings[a])[0]
      if (!b) break
      region.buildings[b]--
      lost++
    }
    if (lost) parts.push(`${lost} building${lost === 1 ? '' : 's'} destroyed`)
  }
  if (spec.people > 0) {
    const loss = Math.min(spec.peopleMax, fired * spec.people) * through
    region.population *= 1 - loss
    parts.push(`${(loss * 100).toFixed(1)}% of the people died`)
  }
  if (spec.infamy) addInfamy(s, nationId, spec.infamy)
  if (spec.opinion) addOpinion(s, region.owner, nationId, 'Bombarded us with ballistic missiles', spec.opinion, 0.3)
  // The struck nation remembers, and a nation that can answer will.
  ;(victim.struckBy ??= {})[nationId] = s.turn
  ;(victim.struckWith ??= {})[nationId] = kind
  const stoppedBy = patrol > 0.005 ? 'the shield and the air patrols' : fxD && fxD.hunt > 0 ? 'shield and fighters' : 'the shield'
  addLog(s, 'battle', `${fired} ${spec.name.toLowerCase()}${fired === 1 ? '' : 's'} from ${n.name} hit ${place}${stopped > 0 ? ` (${stoppedBy} stopped ${stopped}%)` : ''}: ${parts.join(', ') || 'little damage'}.`, [nationId, region.owner])
}

/**
 * What a salvo of `fired` missiles of a kind does when it lands on a country: the shield (with its rounds), batteries, radar, hunters and
 * patrols stop a share, and what gets through hurts the people AND the Defense Line, whatever the kind (see data/missiles.ts and
 * data/missileWar.ts). Returns the salvo's report for the war panel.
 */
export function strikeHitsKind(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, kind: MissileType, fired: number, opts: { aim?: StrikeAim; scrambled?: boolean; auto?: boolean; origin?: RegionId } = {}): SalvoReport | undefined {
  if (!MW.enabled) {
    strikeHitsLegacy(s, map, nationId, target, kind, fired)
    return undefined
  }
  return resolveSalvo(s, map, nationId, target, kind, fired, opts)
}

// ---- The missile program ----

export const programLevel = (n: Pick<Nation, 'missileProgram'>) => n.missileProgram ?? 0

export function fundMissilesProblem(n: Nation): string | null {
  const level = programLevel(n)
  if (level >= MISSILE_PROGRAM.maxLevel) return 'The missile program is at its best'
  return null
}

export const fundMissilesCost = (n: Nation) => ({ capital: MISSILE_PROGRAM.money[Math.min(programLevel(n), 2)], tp: MISSILE_PROGRAM.research[Math.min(programLevel(n), 2)] })

/** Missiles the program may still build this month. */
export function buildRoom(n: Nation, turn: number): number {
  const built = n.missileBuilt?.turn === turn ? n.missileBuilt.count : 0
  return Math.max(0, MISSILE_PROGRAM.capacity[programLevel(n)] + (programLevel(n) > 0 ? programCapacity(n) : 0) - built)
}

/** Missiles of a kind the program could still build this month: small ones (decoys) take less of the capacity. */
export const buildRoomFor = (n: Nation, turn: number, kind: MissileType, queued = 0): number => Math.max(0, Math.floor((buildRoom(n, turn) - queued) / MISSILES[kind].slots + 1e-9))

/** Missiles of every program kind in store (hypersonic ones are the military's own units and have their own limits). */
export const arsenalSize = (n: Nation): number => PROGRAM_MISSILES.reduce((sum, k) => sum + Math.floor((n.arsenal?.[k] ?? 0) + 1e-9) * MISSILES[k].slots, 0)

/** The most missiles the program can keep in its stores: a few months of its own production, so a stockpile has a ceiling. */
export const storageCap = (n: Pick<Nation, 'missileProgram' | 'mprog'>): number => MISSILE_PROGRAM.capacity[programLevel(n)] * MISSILE_PROGRAM.storageMonths + programStorage(n)

export function buildMissilesProblem(s: GameState, o: Build, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const spec = MISSILES[o.kind]
  if (!spec || !PROGRAM_MISSILES.includes(o.kind)) return 'Unknown missile'
  if (!Number.isInteger(o.count) || o.count < 1) return 'Choose how many to build'
  if (programLevel(n) < spec.level) return `Needs the missile program at level ${spec.level}`
  const queued = pending.reduce((sum, p) => (p.type === 'buildMissiles' && p.nationId === o.nationId ? sum + p.count * MISSILES[p.kind].slots : sum), 0)
  const room = buildRoomFor(n, s.turn, o.kind, queued)
  if (o.count > room) return room <= 0 ? 'The program has built all it can this month' : `The program can build ${room} more this month`
  if (n.resources.oil < spec.oil * o.count) return `Not enough oil (needs ${spec.oil * o.count})`
  const space = Math.floor((storageCap(n) - arsenalSize(n) - queued) / spec.slots + 1e-9)
  if (o.count > space) return space <= 0 ? `The stores are full (${storageCap(n)} missiles). Fire some first.` : `The stores have room for ${space} more`
  return null
}

/** What a batch costs. A missile program's cheaper lines take a share off the money (never the steel). */
export const buildMissilesCost = (o: Build, n?: Pick<Nation, 'mprog'>) => {
  const cut = programCostCut(n)
  return { capital: Math.ceil(MISSILES[o.kind].money * o.count * (cut > 0 ? 1 - cut : 1)), steel: MISSILES[o.kind].steel * o.count }
}

export function applyFundMissiles(s: GameState, n: Nation) {
  // The research is paid here: the generic order charge covers money, influence, soldiers and steel, not research.
  n.resources.tp -= fundMissilesCost(n).tp
  n.missileProgram = programLevel(n) + 1
  if (n.isPlayer) addLog(s, 'economy', `${n.name} raised its missile program to level ${n.missileProgram}.`, [n.id])
}

export function applyBuildMissiles(s: GameState, n: Nation, o: Build) {
  n.resources.oil -= MISSILES[o.kind].oil * o.count
  ;(n.arsenal ??= {})[o.kind] = (n.arsenal[o.kind] ?? 0) + o.count
  n.missileBuilt = { turn: s.turn, count: (n.missileBuilt?.turn === s.turn ? n.missileBuilt.count : 0) + o.count * MISSILES[o.kind].slots }
}

/** Whether a nation is at war with one that struck it lately, for the AI to answer in kind. */
export function recentAttackers(s: GameState, n: Nation, within = 2): NationId[] {
  return Object.entries(n.struckBy ?? {})
    .filter(([id, turn]) => s.turn - turn <= within && s.nations[id]?.alive && atWar(s, n.id, id))
    .map(([id]) => id)
    .sort()
}
