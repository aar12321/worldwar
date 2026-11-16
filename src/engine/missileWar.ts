import { addOpinion } from '../ai/opinion'
import { AIRCRAFT_RULES } from '../data/aircraft'
import { DEFENSE_TEXT, DOCTRINES, MW, rungOf } from '../data/missileWar'
import { LEGACY_MISSILES, MISSILES, type MissileSpec } from '../data/missiles'
import { STATION } from '../data/deployment'
import { difficultyOf } from '../data/difficulty'
import { aircraftEffects, airReach, devDone, huntCover, pastDefenses } from './aircraft'
import { interceptFactor } from './combat'
import { freeUnits, patrolCover } from './deployment'
import { addInfamy, addLog, atWar, clamp, distanceKm, newId, pairKey } from './helpers'
import { addMissileScore } from './warscore'
import type { DefenseItem, GameState, MissileLedger, MissileType, Nation, NationId, Order, RegionId, RegionState, SalvoReport, StrikeAim, WorldMap } from './types'
import { UNIT_TYPES } from './types'

type Defense = Extract<Order, { type: 'missileDefense' }>
type Raid = Extract<Order, { type: 'raid' }>

/** A missile kind's numbers: the war's table, or, with the war switched off (tests only), the old one. */
export function specOf(kind: MissileType): MissileSpec {
  return MW.enabled || !LEGACY_MISSILES[kind] ? MISSILES[kind] : { ...MISSILES[kind], ...LEGACY_MISSILES[kind] }
}

const emptyLedger = (): MissileLedger => ({ fired: 0, hits: 0, shotDown: 0, killed: 0, lost: 0, lineDealt: 0, lineTaken: 0, sitesHit: 0, stockDestroyed: 0, interceptorsSpent: 0, aircraftLost: 0 })
export const ledgerOf = (n: Nation): MissileLedger => n.missileWar?.ledger ?? emptyLedger()
const writable = (n: Nation) => ((n.missileWar ??= {}).ledger ??= emptyLedger())

// ---- Defences ----

/** Interceptor rounds a nation's store can hold: its shield and its batteries. */
export function interceptorCap(n: Pick<Nation, 'systems' | 'missileWar'>): number {
  const batteries = Object.values(n.missileWar?.batteries ?? {}).reduce((a, b) => a + b, 0)
  return Math.round((n.systems?.shield ?? 0) * MW.roundsPerShield + batteries * MW.roundsPerBattery)
}

/** Rounds in store. A nation that never fired any has the full store. */
export function interceptorsOf(n: Pick<Nation, 'systems' | 'missileWar'>): number {
  const cap = interceptorCap(n)
  return Math.min(cap, Math.floor((n.missileWar?.interceptors ?? cap) + 1e-9))
}

/** Early-warning level: the radar program plus the airborne early-warning of finished aircraft developments. */
export function radarLevel(n: Pick<Nation, 'missileWar' | 'aircraft'>): number {
  const awacs = MW.awacsNodes.filter((id) => devDone(n, id)).length
  return Math.min(MW.radarMax, (n.missileWar?.radar ?? 0) + awacs)
}

export const batteryLevel = (n: Pick<Nation, 'missileWar'>, region: RegionId): number => n.missileWar?.batteries?.[region] ?? 0
export const mobileLevel = (n: Pick<Nation, 'missileWar'>): number => n.missileWar?.mobile ?? 0
export const doctrineOf = (n: Pick<Nation, 'missileWar'>) => n.missileWar?.doctrine ?? 'hold'

/** How much of a country is city, 0 to 1: the share of its people who live where a missile hurts most. */
export const urbanShare = (r: Pick<RegionState, 'cities'>): number => clamp(r.cities.reduce((sum, c) => sum + c.level, 0) / 8, 0, 1)

/** Whether a launch site (a country with a factory) is shut by a counterforce strike. */
export const siteDown = (s: Pick<GameState, 'turn'>, n: Pick<Nation, 'missileWar'>, region: RegionId): boolean => (n.missileWar?.down?.[region] ?? -1) >= s.turn

/** Whether a recon sortie has found `foe`'s launchers for `by`. */
export const launchersSeen = (s: Pick<GameState, 'turn'>, by: Pick<Nation, 'missileWar'>, foe: NationId): boolean => (by.missileWar?.seen?.[foe] ?? -1) >= s.turn

export const trucePair = (s: Pick<GameState, 'truces' | 'turn'>, a: NationId, b: NationId): number | null => {
  const until = s.truces?.[pairKey(a, b)]
  return until !== undefined && until >= s.turn ? until : null
}

export const tensionOf = (s: Pick<GameState, 'missileTension'>): number => s.missileTension ?? 0
export const rungNow = (s: Pick<GameState, 'missileTension'>): number => rungOf(tensionOf(s))

function addTension(s: GameState, amount: number) {
  if (amount <= 0) return
  s.missileTension = clamp(tensionOf(s) + amount, 0, 100)
}

// ---- One salvo ----

export interface SalvoDefense {
  /** Share of the salvo that gets through. */
  through: number
  /** Share of the salvo each defence stops, as parts of the whole (they add up to 1 - through). */
  stopped: { shield: number; batteries: number; fighters: number; patrol: number }
  /** Rounds the salvo asks for, rounds in store, and the share of the shield's strength that works. */
  needed: number
  stock: number
  coverage: number
}

/**
 * What a salvo meets. The shield's strength falls as its rounds run out (a salvo asks for `drain` rounds per missile), batteries and radar
 * add to it, and then the defender's hunters, patrols and scrambled fighters work on what is left. Pure: used for the real thing and the forecast.
 * With a full store and no batteries, radar or scramble it equals the old shield-and-hunters rule exactly.
 */
export function salvoDefense(s: GameState, attackerId: NationId, victimId: NationId, target: RegionId, kind: MissileType, fired: number, scrambled = false): SalvoDefense {
  const spec = MISSILES[kind]
  const victim = s.nations[victimId]
  const fxA = aircraftEffects(s.nations[attackerId])
  const fxD = aircraftEffects(victim)
  const shield = victim.systems?.shield ?? 0
  const needed = fired * spec.drain
  const stock = interceptorsOf(victim)
  const cap = interceptorCap(victim)
  const coverage = !MW.enabled || cap <= 0 || needed <= 0 ? 1 : Math.min(1, stock / needed)
  // The shield alone, then weakened by an empty store.
  const q0 = clamp(1 - (1 - interceptFactor(shield)) * spec.intercept, 0.05, 1)
  const q1 = MW.enabled ? clamp(1 - (1 - q0) * coverage, 0.05, 1) : q0
  // Batteries in the struck country and radar cueing the interceptors.
  const bats = MW.enabled ? batteryLevel(victim, target) : 0
  // Radar only cues interceptors: with no shield and no battery there is nothing to cue.
  const radar = MW.enabled && cap > 0 ? radarLevel(victim) : 0
  const extra = MW.enabled ? clamp((bats * MW.batteryStop + radar * MW.radarStop) * spec.intercept, 0, 0.7) : 0
  const q2 = clamp(q1 * (1 - extra), 0.05, 1)
  // Hunters: fighters at home, with the patrols already aloft and the wing scrambled against this very salvo.
  const patrolFighters = victim.military.deployment ? STATION.patrolCue * Math.min(1, victim.military.deployment.air) * victim.military.units.fighter : 0
  const wing = (victim.military.units.fighter + patrolFighters) * (scrambled && MW.enabled ? MW.scrambleWing : 1)
  const hunted = AIRCRAFT_RULES.huntVs[kind]
  let afterHunters = q2
  if (fxA || fxD) afterHunters = clamp(pastDefenses(q2, fxA, fxD, wing, hunted), 0.05, 1)
  const scramble = scrambled && MW.enabled && victim.military.units.fighter >= 0.5 ? Math.min(0.3, MW.scrambleStop * hunted) : 0
  const afterScramble = afterHunters * (1 - scramble)
  const patrol = victim.military.deployment ? Math.min(STATION.missileStopMax, STATION.missileStopPer * patrolCover(s, victimId).air) * STATION.missileCatch[kind] : 0
  const through = clamp(afterScramble * (1 - patrol), 0.05, 1)
  // Where it was stopped, in order met. The floor of 5% is not a defence, so the parts are scaled to add up to what really was stopped.
  const parts = { shield: 1 - q1, batteries: q1 - q2, fighters: q2 - afterScramble, patrol: afterScramble - afterScramble * (1 - patrol) }
  const sum = parts.shield + parts.batteries + parts.fighters + parts.patrol
  const k = sum > 1e-9 ? (1 - through) / sum : 0
  return { through, stopped: { shield: parts.shield * k, batteries: parts.batteries * k, fighters: parts.fighters * k, patrol: parts.patrol * k }, needed, stock, coverage }
}

export interface Harm {
  /** Share of the country's people killed, and millions. */
  lossPct: number
  line: number
  army: number
  buildings: number
  factories: boolean
  /** Share of the oil stock burned and of the aircraft on the ground destroyed. */
  fuel: number
  air: number
  /** Share of the enemy's missiles in store destroyed (counterforce only), and months the launch site stays shut. */
  stock: number
  down: number
  /** World tension added. */
  tension: number
}

/** The harm `count` missiles' worth of a kind does when `through` of them arrive. Pure: used for the real thing and the forecast. */
export function harmOf(kind: MissileType, count: number, through: number, aim: StrikeAim, region: Pick<RegionState, 'cities'>, mobile = 0, seen = false): Harm {
  const spec = MISSILES[kind]
  const site = aim === 'site'
  const harm = site ? MW.siteHarm : 1
  const landed = count * through
  const lossPct = Math.min(spec.peopleMax, count * spec.people) * through * harm * (1 + spec.urban * urbanShare(region))
  const hide = site && !seen ? Math.min(0.9, mobile * MW.mobileHide) : 0
  const stock = site ? Math.min(spec.siteMax, count * spec.site) * through * (1 - hide) : 0
  return {
    lossPct,
    line: spec.line > 0 ? Math.min(spec.lineMax, count * spec.line) * through * harm : 0,
    army: !site && spec.army > 0 ? Math.min(spec.armyMax, count * spec.army) * through : 0,
    buildings: !site && spec.perBuilding > 0 ? Math.floor(landed / spec.perBuilding) : 0,
    factories: !site && spec.factoryTurns > 0 && landed >= (spec.factoryNeed ?? 0.5) - 1e-9,
    fuel: !site && spec.fuel > 0 ? Math.min(spec.fuelMax, count * spec.fuel) * through : 0,
    air: spec.air > 0 ? Math.min(spec.airMax, count * spec.air) * through * (site ? 1.5 : 1) : 0,
    stock,
    down: site ? Math.min(MW.siteDownMax, Math.ceil(landed * MW.siteDownPer)) : 0,
    tension: spec.tension * landed * (site ? MW.siteTension : 1),
  }
}

/** The war-crime reputation one salvo earns: harsher as the ladder climbs. */
function crimeInfamy(s: GameState, kind: MissileType, lossPct: number): number {
  const spec = MISSILES[kind]
  const rungs = Math.max(0, rungNow(s) - MW.crimeFromRung + 1)
  return Math.min(MW.infamyMax, lossPct * 100 * spec.crime * (1 + MW.crimePerRung * rungs))
}

interface SalvoOpts {
  aim?: StrikeAim
  scrambled?: boolean
  auto?: boolean
  origin?: RegionId
  /** A raid: harm is applied as this kind and the defence has already been met, so none of the shield rules apply. */
  raid?: { survivors: number; sent: number; lost: number; escortLost: number }
}

/** Records a salvo or raid for the war panel, keeping the newest. */
function record(s: GameState, r: Omit<SalvoReport, 'id' | 'turn'>): SalvoReport {
  const report: SalvoReport = { id: newId(s, 'v'), turn: s.turn, ...(s.day !== undefined ? { day: s.day } : {}), ...r }
  const list = (s.salvos ??= [])
  list.push(report)
  if (list.length > MW.keepSalvos) list.splice(0, list.length - MW.keepSalvos)
  return report
}

/** Applies one harm to a country and writes the news line. Returns the report. */
function applyHarm(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, kind: MissileType, fired: number, def: SalvoDefense, o: SalvoOpts, weapon: 'missile' | 'raid'): SalvoReport {
  const spec = MISSILES[kind]
  const aim = o.aim ?? 'country'
  const n = s.nations[nationId]
  const region = s.regions[target]
  const victim = s.nations[region.owner]
  const place = map.regions[target].name
  const through = def.through
  const bomberLine = o.raid ? 1 + (aircraftEffects(n)?.bomberLine ?? 0) : 1
  const h = harmOf(kind, o.raid ? o.raid.survivors * MW.raid.perBomber : fired, o.raid ? 1 : through, aim, region, mobileLevel(victim), launchersSeen(s, n, victim.id))
  const parts: string[] = []
  const lineBefore = region.line
  if (h.line > 0) {
    // A strike never leaves a line lower than half a point, and never heals one that a battle already wore below that.
    region.line = Math.min(region.line, Math.max(0.5, region.line - h.line * bomberLine))
    parts.push(`the Defense Line fell by ${(lineBefore - region.line).toFixed(1)}`)
  }
  if (h.factories) {
    region.sabotaged = Math.max(region.sabotaged, spec.factoryTurns)
    parts.push(`the factories stopped for ${spec.factoryTurns} month${spec.factoryTurns === 1 ? '' : 's'}`)
  }
  if (h.army > 0) {
    for (const k of UNIT_TYPES) victim.military.units[k] *= 1 - h.army
    for (const a of s.armies ?? []) if (a.nationId === victim.id) for (const k of UNIT_TYPES) a.units[k] *= 1 - h.army
    parts.push(`${Math.round(h.army * 100)}% of its army was destroyed`)
  }
  let lost = 0
  for (let i = 0; i < h.buildings; i++) {
    const b = (Object.keys(region.buildings) as (keyof typeof region.buildings)[]).filter((k) => region.buildings[k] > 0).sort((a, c) => region.buildings[c] - region.buildings[a])[0]
    if (!b) break
    region.buildings[b]--
    lost++
  }
  if (lost) parts.push(`${lost} building${lost === 1 ? '' : 's'} destroyed`)
  const before = region.population
  region.population = Math.max(0.01, region.population * (1 - h.lossPct))
  const dead = before - region.population
  if (h.lossPct > 0.0005) parts.push(`${dead >= 0.1 ? dead.toFixed(1) : dead.toFixed(2)} million civilians died (${(h.lossPct * 100).toFixed(1)}%)`)
  if (h.fuel > 0.002) {
    victim.resources.oil *= 1 - h.fuel
    parts.push(`${Math.round(h.fuel * 100)}% of the fuel stores burned`)
  }
  let aircraftKilled = 0
  if (h.air > 0.002) {
    for (const k of ['fighter', 'air'] as const) {
      aircraftKilled += victim.military.units[k] * h.air
      victim.military.units[k] *= 1 - h.air
    }
    for (const a of s.armies ?? []) if (a.nationId === victim.id) for (const k of ['fighter', 'air'] as const) a.units[k] *= 1 - h.air
    parts.push(`${Math.round(h.air * 100)}% of the aircraft on the ground destroyed`)
  }
  let stock = 0
  let siteHit = false
  if (aim === 'site' && h.stock > 0) {
    // The stores: everything but the bomb itself, which sits in a hardened silo.
    for (const k of Object.keys(victim.arsenal ?? {}) as MissileType[]) {
      const have = victim.arsenal![k] ?? 0
      stock += have * h.stock
      victim.arsenal![k] = have * (1 - h.stock)
    }
    stock += victim.military.units.missile * h.stock
    victim.military.units.missile *= 1 - h.stock
    stock = Math.round(stock * 10) / 10
    if (stock >= 0.1) parts.push(`${stock.toFixed(1)} missiles in store destroyed`)
  }
  if (aim === 'site' && h.down > 0 && region.buildings.factory > 0) {
    const war = (victim.missileWar ??= {})
    const months = Math.max(1, h.down - Math.floor(mobileLevel(victim) / 2))
    ;(war.down ??= {})[target] = Math.max(war.down[target] ?? -1, s.turn + months)
    siteHit = true
    parts.push(`the launch site is shut for ${months} month${months === 1 ? '' : 's'}`)
  }

  // The people: stability, weariness, the war-crime reputation and the world's opinion.
  const pct = h.lossPct * 100
  if (pct > 0.05) {
    victim.stability = Math.max(0, victim.stability - Math.min(MW.stabilityMax, pct * spec.stability))
    victim.warWeariness += pct * MW.weariness
  }
  const crime = crimeInfamy(s, kind, h.lossPct)
  if (spec.infamy + crime > 0.05) addInfamy(s, nationId, spec.infamy + crime)
  if (spec.opinion) addOpinion(s, region.owner, nationId, 'Bombarded us with ballistic missiles', spec.opinion, 0.3)
  else if (crime >= 1) addOpinion(s, region.owner, nationId, 'Killed our civilians with missiles', -Math.min(8, Math.round(crime * 2)), 0.3)
  addMissileScore(s, nationId, victim.id, lineBefore - region.line, pct)
  addTension(s, h.tension)
  ;(victim.struckBy ??= {})[nationId] = s.turn
  ;(victim.struckWith ??= {})[nationId] = kind

  // The books.
  const hit = weapon === 'raid' ? o.raid!.survivors : Math.round(fired * through)
  const a = writable(n)
  const v = writable(victim)
  a.fired += weapon === 'raid' ? 0 : fired
  a.hits += weapon === 'raid' ? 0 : hit
  a.shotDown += weapon === 'raid' ? 0 : fired - hit
  a.killed += dead
  a.lineDealt += lineBefore - region.line
  a.stockDestroyed += stock
  if (siteHit) a.sitesHit++
  v.lost += dead
  v.lineTaken += lineBefore - region.line
  v.aircraftLost += aircraftKilled
  const used = weapon === 'missile' && def.stock > 0 ? Math.min(def.stock, def.needed) : 0
  v.interceptorsSpent += used
  if (o.raid) a.aircraftLost += o.raid.lost + o.raid.escortLost
  return record(s, {
    from: nationId,
    to: victim.id,
    region: target,
    weapon,
    ...(weapon === 'missile' ? { kind } : {}),
    aim,
    fired: weapon === 'raid' ? o.raid!.sent : fired,
    hit,
    shield: def.stopped.shield,
    batteries: def.stopped.batteries,
    patrol: def.stopped.patrol,
    fighters: def.stopped.fighters,
    interceptorsUsed: used,
    coverage: def.coverage,
    dead,
    line: lineBefore - region.line,
    factories: h.factories,
    buildings: lost,
    army: h.army,
    stock,
    site: siteHit,
    aircraftLost: weapon === 'raid' ? o.raid!.lost + o.raid!.escortLost : aircraftKilled,
    ...(o.scrambled ? { scrambled: true } : {}),
    ...(o.auto ? { auto: true } : {}),
    ...(o.origin ? { origin: o.origin } : {}),
    news: parts.join(', ') || 'little damage',
    place,
  })
}

const stoppedBy = (r: Pick<SalvoReport, 'shield' | 'batteries' | 'patrol' | 'fighters'>): string[] => {
  const out: string[] = []
  if (r.shield > 0.005) out.push(`the shield ${Math.round(r.shield * 100)}%`)
  if (r.batteries > 0.005) out.push(`batteries and radar ${Math.round(r.batteries * 100)}%`)
  if (r.fighters > 0.005) out.push(`fighters ${Math.round(r.fighters * 100)}%`)
  if (r.patrol > 0.005) out.push(`air patrols ${Math.round(r.patrol * 100)}%`)
  return out
}

/** The whole of a salvo landing: the defence, then the harm, the books and the news. Mutates `s`. */
export function resolveSalvo(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, kind: MissileType, fired: number, o: SalvoOpts = {}): SalvoReport {
  const region = s.regions[target]
  const victim = s.nations[region.owner]
  const def = salvoDefense(s, nationId, victim.id, target, kind, fired, o.scrambled)
  // The rounds the salvo drew are gone.
  if (def.stock > 0) victim.missileWar = { ...(victim.missileWar ?? {}), interceptors: Math.max(0, def.stock - Math.min(def.stock, def.needed)) }
  const r = applyHarm(s, map, nationId, target, kind, fired, def, o, 'missile')
  const n = s.nations[nationId]
  const spec = MISSILES[kind]
  const cut = stoppedBy(r)
  addLog(
    s,
    'battle',
    `${fired} ${spec.name.toLowerCase()}${fired === 1 ? '' : 's'} from ${n.name}${o.auto ? ' (retaliation)' : ''} ${r.aim === 'site' ? 'at the launch sites of' : 'hit'} ${r.place}${cut.length ? ` (stopped by ${cut.join(', ')}; ${r.hit} of ${fired} got through)` : ''}${def.coverage < 0.999 && def.stock >= 0 ? `. The interceptor store ran short (${def.stock} rounds for ${Math.ceil(def.needed)} asked)` : ''}: ${r.news}.`,
    [nationId, region.owner],
  )
  return r
}

// ---- Counterforce and raids ----

export interface RaidPlan {
  sent: number
  escorts: number
  /** Expected share of the bombers lost, and the share of the loss that comes from batteries. */
  loss: number
  flak: number
  survivors: number
  from: RegionId | null
}

/** The country a raid would take off from: the nearest of yours with a factory (an airbase) that reaches the target. */
export function raidBase(s: GameState, map: WorldMap, nationId: NationId, target: RegionId): RegionId | null {
  const n = s.nations[nationId]
  const t = map.regions[target]
  if (!t) return null
  let best: RegionId | null = null
  let bestKm = Infinity
  for (const r of Object.values(s.regions).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (r.owner !== nationId || r.buildings.factory <= 0 || !map.regions[r.id]) continue
    const km = distanceKm(map.regions[r.id], t)
    if (km <= airReach(n) && km < bestKm) {
      best = r.id
      bestKm = km
    }
  }
  return best
}

/** What a raid would meet and deliver. Pure: the forecast and the real thing use it. */
export function raidPlan(s: GameState, map: WorldMap, o: Pick<Raid, 'nationId' | 'target' | 'share'>): RaidPlan {
  const n = s.nations[o.nationId]
  const region = s.regions[o.target]
  const victim = s.nations[region?.owner]
  const free = freeUnits(s, o.nationId)
  const sent = Math.floor(free.air * clamp(o.share ?? MW.raid.shareDefault, 0.1, 1) * 100) / 100
  const escorts = Math.min(free.fighter, sent)
  const fxA = aircraftEffects(n)
  const fxD = victim ? aircraftEffects(victim) : undefined
  const defFighters = victim ? victim.military.units.fighter + (victim.military.deployment ? STATION.patrolCue * Math.min(1, victim.military.deployment.air) * victim.military.units.fighter : 0) : 0
  const jam = fxA?.jam ?? 0
  const bats = victim ? batteryLevel(victim, o.target) : 0
  const flak = bats * MW.batteryFlak
  const hunters = (MW.raid.perFighter * Math.min(3, defFighters) + (fxD ? huntCover(fxD, defFighters) * 0.3 : 0)) * (1 - jam)
  const stealth = clamp((fxA?.bomberFloor ?? 0) + (fxA?.pierce ?? 0), 0, 0.7)
  const raw = (MW.raid.baseLoss + hunters + flak) * (1 / (1 + (sent > 0 ? (escorts / sent) * MW.raid.escortCover : 0))) * (1 - stealth)
  const loss = clamp(raw, 0, MW.raid.maxLoss)
  return { sent, escorts, loss, flak: flak > 0 ? flak / Math.max(1e-9, MW.raid.baseLoss + hunters + flak) : 0, survivors: sent * (1 - loss), from: raidBase(s, map, o.nationId, o.target) }
}

export function raidProblem(s: GameState, map: WorldMap, o: Raid, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const r = s.regions[o.target]
  if (!r || !map.regions[o.target]) return 'Unknown country'
  if (r.owner === o.nationId || !atWar(s, o.nationId, r.owner)) return 'You can only raid a country you are at war with'
  if (s.nations[r.owner]?.overlord === o.nationId) return 'They are your puppet'
  if (o.aim !== undefined && o.aim !== 'country' && o.aim !== 'site') return 'Choose what to bomb'
  if (o.share !== undefined && (!Number.isFinite(o.share) || o.share < 0.1 || o.share > 1)) return 'Send between 10% and 100% of your bombers'
  if (trucePair(s, o.nationId, r.owner) !== null) return 'A missile ceasefire holds with them'
  if (n.missileWar?.lastRaid !== undefined && s.turn - n.missileWar.lastRaid < MW.raid.cooldown) return 'The crews need a month before the next raid'
  if (pending.some((p) => p.type === 'raid' && p.nationId === o.nationId)) return 'One raid a month'
  if (o.aim === 'site' && r.buildings.factory <= 0) return 'No launch site there (it needs a factory)'
  const plan = raidPlan(s, map, o)
  if (plan.sent < MW.raid.minBombers) return `Needs strike aircraft at home (at least ${MW.raid.minBombers} division)`
  if (!plan.from) return `Out of range: bombers reach ${Math.round(airReach(n))} km from a country with a factory`
  if (n.resources.oil < MW.raid.oil) return `Not enough oil (needs ${MW.raid.oil})`
  return null
}

export const raidCost = () => ({ capital: MW.raid.money })

/** Flies the raid. Mutates `s`. */
export function runRaid(s: GameState, map: WorldMap, o: Raid): SalvoReport | null {
  const n = s.nations[o.nationId]
  const region = s.regions[o.target]
  if (!region || !n) return null
  const plan = raidPlan(s, map, o)
  if (plan.sent < MW.raid.minBombers || !plan.from) return null
  n.resources.oil = Math.max(0, n.resources.oil - MW.raid.oil)
  const aim = o.aim ?? 'country'
  const lost = plan.sent * plan.loss
  const escortLost = plan.escorts * plan.loss * 0.5
  n.military.units.air = Math.max(0, n.military.units.air - lost)
  n.military.units.fighter = Math.max(0, n.military.units.fighter - escortLost)
  ;(n.missileWar ??= {}).lastRaid = s.turn
  const victim = s.nations[region.owner]
  const def: SalvoDefense = { through: 1 - plan.loss, stopped: { shield: 0, batteries: plan.loss * plan.flak, fighters: plan.loss * (1 - plan.flak), patrol: 0 }, needed: 0, stock: 0, coverage: 1 }
  const kind: MissileType = aim === 'site' ? 'tactical' : 'cruise'
  const report = applyHarm(s, map, o.nationId, o.target, kind, plan.sent, def, { aim, raid: { survivors: plan.survivors, sent: plan.sent, lost, escortLost } }, 'raid')
  addLog(s, 'battle', `A raid by ${n.name} on ${report.place}${aim === 'site' ? ' (launch sites)' : ''}: ${plan.sent.toFixed(1)} bomber divisions and ${plan.escorts.toFixed(1)} escorts flew, ${(lost + escortLost).toFixed(2)} aircraft lost to ${plan.flak > 0.4 ? 'batteries and fighters' : 'fighters'}; ${report.news}.`, [o.nationId, victim.id])
  return report
}

export function reconProblem(s: GameState, o: Extract<Order, { type: 'recon' }>): string | null {
  const n = s.nations[o.nationId]
  const t = s.nations[o.target]
  if (!t?.alive || o.target === o.nationId) return 'Unknown nation'
  if (!atWar(s, o.nationId, o.target)) return 'You can only scout a nation you are at war with'
  const free = freeUnits(s, o.nationId)
  if (free.fighter + free.air < 0.25) return 'Needs fighters or strike aircraft at home'
  if (launchersSeen(s, n, o.target)) return 'Their launchers are already found'
  return null
}

export function applyRecon(s: GameState, o: Extract<Order, { type: 'recon' }>) {
  const n = s.nations[o.nationId]
  ;((n.missileWar ??= {}).seen ??= {})[o.target] = s.turn + MW.reconMonths
  if (n.isPlayer) addLog(s, 'info', `A recon flight found ${s.nations[o.target].name}'s launchers. Mobile launchers cannot hide from your counterforce strikes for ${MW.reconMonths} months.`, [o.nationId])
}

// ---- Defence orders ----

export function defenseProblem(s: GameState, o: Defense): string | null {
  const n = s.nations[o.nationId]
  const war = n.missileWar
  switch (o.item) {
    case 'radar':
      return (war?.radar ?? 0) >= MW.radarMax ? 'The radar network is at its best' : null
    case 'mobile':
      return (war?.mobile ?? 0) >= MW.mobileMax ? 'Your launchers are all mobile already' : null
    case 'battery': {
      const r = o.regionId ? s.regions[o.regionId] : undefined
      if (!r || r.owner !== o.nationId) return 'Choose one of your countries'
      return batteryLevel(n, r.id) >= MW.batteryMax ? 'That country has the most batteries it can hold' : null
    }
    case 'interceptors': {
      const count = o.count ?? 0
      if (!Number.isInteger(count) || count < 1 || count > MW.roundsMaxOrder) return `Buy between 1 and ${MW.roundsMaxOrder} rounds`
      const room = interceptorCap(n) - interceptorsOf(n)
      if (interceptorCap(n) <= 0) return 'Needs an Interceptor Shield or a battery to hold rounds'
      if (room <= 0) return 'The store is full'
      return count > room ? `The store has room for ${room} more` : null
    }
    default:
      return 'Unknown defence'
  }
}

export function defenseCost(s: GameState, o: Defense): { capital: number } {
  const n = s.nations[o.nationId]
  switch (o.item) {
    case 'radar':
      return { capital: MW.radarMoney[Math.min(MW.radarMax - 1, n?.missileWar?.radar ?? 0)] }
    case 'mobile':
      return { capital: MW.mobileMoney[Math.min(MW.mobileMax - 1, n?.missileWar?.mobile ?? 0)] }
    case 'battery':
      return { capital: MW.batteryMoney * (1 + (o.regionId && n ? batteryLevel(n, o.regionId) : 0)) }
    default:
      return { capital: (o.count ?? 0) * MW.roundCost }
  }
}

export function applyDefense(s: GameState, o: Defense) {
  const n = s.nations[o.nationId]
  const war = (n.missileWar ??= {})
  if (o.item === 'radar') war.radar = (war.radar ?? 0) + 1
  else if (o.item === 'mobile') war.mobile = (war.mobile ?? 0) + 1
  else if (o.item === 'battery') (war.batteries ??= {})[o.regionId!] = batteryLevel(n, o.regionId!) + 1
  else war.interceptors = Math.min(interceptorCap(n), interceptorsOf(n) + (o.count ?? 0))
  if (n.isPlayer) addLog(s, 'info', `${DEFENSE_TEXT[o.item as DefenseItem].name}: done.`, [o.nationId])
}

export function doctrineProblem(o: Extract<Order, { type: 'setDoctrine' }>): string | null {
  return o.doctrine in DOCTRINES ? null : 'Unknown doctrine'
}

export function scrambleProblem(s: GameState, o: Extract<Order, { type: 'scramble' }>): string | null {
  const f = s.flights?.find((x) => x.id === o.flightId)
  if (!f) return 'That salvo is gone'
  if (s.regions[f.target]?.owner !== o.nationId) return 'That salvo is not aimed at you'
  if (f.scrambled) return 'Fighters are already scrambled against it'
  if (s.nations[o.nationId].military.units.fighter < 0.5) return 'Needs fighters at home (half a division)'
  return null
}

export function applyScramble(s: GameState, o: Extract<Order, { type: 'scramble' }>) {
  const f = s.flights?.find((x) => x.id === o.flightId)
  if (f) f.scrambled = true
}

// ---- Ceasefire ----

/** Whether an AI rival would accept a missile ceasefire to make one. Deterministic: no dice, so the answer can be shown before it is asked. */
export function truceAnswer(s: GameState, to: NationId): { accepts: boolean; why: string } {
  const t = s.nations[to]
  if (!t || t.isPlayer || s.humans.includes(to)) return { accepts: false, why: 'Only AI rivals answer ceasefire offers' }
  const skill = difficultyOf(s.settings.difficulty).skill
  const need = MW.truceTension[skill]
  const tension = tensionOf(s)
  const led = ledgerOf(t)
  const hurting = led.lost > 0.2 && led.lost > led.killed * 1.2
  if (tension >= need) return { accepts: true, why: `The world is on edge (tension ${Math.round(tension)}).` }
  if (hurting) return { accepts: true, why: `${t.name} has lost more than it has dealt.` }
  return { accepts: false, why: `${t.name} sees no reason to stop yet (tension ${Math.round(tension)}, it needs ${need}).` }
}

export function truceProblem(s: GameState, o: Extract<Order, { type: 'missileTruce' }>): string | null {
  if (!s.nations[o.target]?.alive || o.target === o.nationId) return 'Unknown nation'
  if (o.lift) return trucePair(s, o.nationId, o.target) === null ? 'There is no ceasefire to lift' : null
  if (!atWar(s, o.nationId, o.target)) return 'You are not at war with them'
  if (trucePair(s, o.nationId, o.target) !== null) return 'A ceasefire already holds'
  const a = truceAnswer(s, o.target)
  return a.accepts ? null : a.why
}

export function applyTruce(s: GameState, o: Extract<Order, { type: 'missileTruce' }>) {
  const key = pairKey(o.nationId, o.target)
  const a = s.nations[o.nationId]
  const b = s.nations[o.target]
  if (o.lift) {
    delete s.truces?.[key]
    if (s.truces && Object.keys(s.truces).length === 0) delete s.truces
    addInfamy(s, o.nationId, MW.truceLiftInfamy)
    addLog(s, 'news', `${a.name} ended the missile ceasefire with ${b.name}.`, [o.nationId, o.target])
    return
  }
  ;(s.truces ??= {})[key] = s.turn + MW.truceMonths
  s.missileTension = Math.max(0, tensionOf(s) - MW.truceTensionDrop)
  addLog(s, 'news', `A missile ceasefire: ${a.name} and ${b.name} stop firing missiles and bombers at each other until month ${s.turn + MW.truceMonths + 1}. The armies are still at war.`, [o.nationId, o.target])
}

// ---- The month ----

/** The month's upkeep of the missile war: stores refill, closed sites reopen, tension fades. Not run in a game that never fired. */
export function runMissileWar(s: GameState) {
  if (!MW.enabled) return
  for (const n of Object.values(s.nations)) {
    const war = n.missileWar
    if (!war) continue
    if (war.interceptors !== undefined) {
      const cap = interceptorCap(n)
      const next = Math.min(cap, war.interceptors + Math.ceil(cap * MW.regen))
      if (next >= cap) delete war.interceptors
      else war.interceptors = next
    }
    for (const key of ['down', 'seen'] as const) {
      const m = war[key] as Record<string, number> | undefined
      if (!m) continue
      for (const id of Object.keys(m)) if (m[id] < s.turn) delete m[id]
      if (Object.keys(m).length === 0) delete war[key]
    }
  }
  if (s.truces) {
    for (const k of Object.keys(s.truces)) if (s.truces[k] < s.turn) delete s.truces[k]
    if (Object.keys(s.truces).length === 0) delete s.truces
  }
  if (s.missileTension !== undefined) {
    const last = s.salvos?.[s.salvos.length - 1]
    const quiet = !last || last.turn < s.turn
    s.missileTension = Math.max(0, s.missileTension - MW.tensionFade - (quiet ? MW.tensionQuietFade : 0))
    if (s.missileTension < 0.5) delete s.missileTension
  }
}

/** Missiles of every kind a nation has in store (hypersonic ones are units). */
export function missilesInStore(n: Nation): number {
  return Math.floor(n.military.units.missile + 1e-9) + (Object.values(n.arsenal ?? {}) as number[]).reduce((a, b) => a + Math.floor(b + 1e-9), 0)
}

