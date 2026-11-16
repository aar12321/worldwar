import { addOpinion } from '../ai/opinion'
import { difficultyOf } from '../data/difficulty'
import { NUCLEAR } from '../data/nuclear'
import { blocsOf } from './blocs'
import { interceptFactor } from './combat'
import { declareWar } from './diplomacy'
import { tierGate } from './empire'
import { addInfamy, addLog, alliesOf, atWar, clamp, distanceKm, enemiesOf, grantJustification, hasTech, isAllied, maxWars, newId, regionsOf } from './helpers'
import { militaryPower } from './militaryStats'
import { aircraftEffects, pastDefenses } from './aircraft'
import { recentAttackers, type AirDefense } from './missiles'
import type { Rng } from './rng'
import type { GameState, NationId, Nation, NukeFlight, Order, RegionId, WorldMap } from './types'
import { UNIT_TYPES } from './types'
import { lineMax } from './economy'

type Build = Extract<Order, { type: 'buildWarhead' }>
type Nuke = Extract<Order, { type: 'nuke' }>

const nm = (s: GameState, id: NationId) => s.nations[id]?.name ?? id

/** Warheads a nation has in store. */
export const warheadsOf = (n: Pick<Nation, 'nuclear'>): number => Math.floor((n.nuclear?.warheads ?? 0) + 1e-9)

/** Warheads still being built, and the turn the next one is done. */
export const warheadsBuilding = (n: Pick<Nation, 'nuclear'>): number => n.nuclear?.building.length ?? 0

/** Why a nation cannot work on nuclear weapons at all, or null: the tier and the technology. */
export function nuclearAccess(s: GameState, id: NationId): string | null {
  const gate = tierGate(s, id, NUCLEAR.tier)
  if (gate) return gate
  const n = s.nations[id]
  if (!hasTech(n, NUCLEAR.tech)) return 'Needs Hypersonic Missiles (Research, Frontier)'
  return null
}

export const buildWarheadCost = () => ({ capital: NUCLEAR.money, steel: NUCLEAR.steel, tp: NUCLEAR.research })

export function buildWarheadProblem(s: GameState, o: Build, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const access = nuclearAccess(s, o.nationId)
  if (access) return access
  const queued = pending.filter((p) => p.type === 'buildWarhead' && p.nationId === o.nationId).length
  if (warheadsBuilding(n) + queued >= NUCLEAR.inProgress) return 'A warhead is already being built'
  if (warheadsOf(n) + warheadsBuilding(n) + queued >= NUCLEAR.maxStock) return `Your arsenal is full (${NUCLEAR.maxStock} warheads)`
  if (!regionsOf(s, o.nationId).some((id) => s.regions[id].buildings.factory > 0)) return 'Needs a factory to build them in'
  return null
}

/** Pays the research and starts the work. The money and steel are taken with every other order's cost. */
export function applyBuildWarhead(s: GameState, n: Nation) {
  n.resources.tp -= NUCLEAR.research
  const state = (n.nuclear ??= { warheads: 0, building: [] })
  state.building.push(s.turn + NUCLEAR.months)
  if (n.isPlayer) addLog(s, 'economy', `Work began on a nuclear warhead. It will be ready in ${NUCLEAR.months} months.`, [n.id])
}

/** The country a warhead would leave from: the nearest of the nation's countries with a factory, within reach of the target. */
export function nukeSite(s: GameState, map: WorldMap, nationId: NationId, target: RegionId): RegionId | null {
  const t = map.regions[target]
  if (!t) return null
  let best: RegionId | null = null
  let bestKm = Infinity
  for (const r of Object.values(s.regions).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (r.owner !== nationId || r.buildings.factory <= 0 || !map.regions[r.id]) continue
    const km = distanceKm(map.regions[r.id], t)
    if (km <= NUCLEAR.km && km < bestKm) {
      best = r.id
      bestKm = km
    }
  }
  return best
}

export function nukeProblem(s: GameState, map: WorldMap, o: Nuke, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const access = nuclearAccess(s, o.nationId)
  if (access) return access
  const r = s.regions[o.target]
  if (!r || !map.regions[o.target]) return 'Unknown country'
  if (r.owner === o.nationId || !atWar(s, o.nationId, r.owner)) return 'You can only strike a country you are at war with'
  if (s.nations[r.owner]?.overlord === o.nationId) return 'They are your puppet'
  if (pending.some((p) => p.type === 'nuke' && p.nationId === o.nationId)) return 'One warhead at a time'
  if (warheadsOf(n) < 1) return 'You have no warhead. Build one first.'
  const last = n.nuclear?.last
  if (last !== undefined && s.turn - last < NUCLEAR.cooldown) return `The launch crews need ${NUCLEAR.cooldown - (s.turn - last)} more months`
  if (!nukeSite(s, map, o.nationId, o.target)) return 'No country of yours with a factory can launch it'
  return null
}

/** The share of the blast that gets past the victim's Interceptor Shield. The shield stops only a part of its own rating. */
export function nukeThrough(shield: number, air?: AirDefense): number {
  const base = clamp(1 - (1 - interceptFactor(shield)) * NUCLEAR.intercept, 0.05, 1)
  if (!air || (!air.attacker && !air.defender)) return base
  // Missile-hunter fighters and stealth count, as for any missile, but fighters catch a warhead poorly.
  return clamp(pastDefenses(base, air.attacker, air.defender, air.fighters, NUCLEAR.hunted), 0.05, 1)
}

/** What a warhead meets besides the shield: the victim's hunters at home and the attacker's stealth. Undefined when neither side has developments, so the plain path is untouched. */
export function nukeAir(s: GameState, attacker: NationId, victim: NationId): AirDefense | undefined {
  const fxA = aircraftEffects(s.nations[attacker])
  const fxD = aircraftEffects(s.nations[victim])
  return fxA || fxD ? { attacker: fxA, defender: fxD, fighters: s.nations[victim].military.units.fighter } : undefined
}

/** Takes a warhead out of the store at launch. */
function spendWarhead(s: GameState, n: Nation) {
  n.nuclear!.warheads -= 1
  n.nuclear!.last = s.turn
  n.nuclear!.fired = (n.nuclear!.fired ?? 0) + 1
}

/** A turn game's warhead lands at once; a live game's flies for days, and the victim can see it coming. */
export function launchNuke(s: GameState, map: WorldMap, o: Nuke, today: number): NukeFlight | null {
  const n = s.nations[o.nationId]
  const from = nukeSite(s, map, o.nationId, o.target)
  if (!from || warheadsOf(n) < 1) return null
  spendWarhead(s, n)
  const victim = s.regions[o.target].owner
  const flight: NukeFlight = { id: newId(s, 'n'), nationId: o.nationId, from, target: o.target, launched: today, lands: today + NUCLEAR.flightDays, foe: victim }
  ;(s.nukes ??= []).push(flight)
  const place = map.regions[o.target].name
  addLog(s, 'news', `ALERT: ${n.name} has launched a nuclear missile at ${place}. It will land in ${NUCLEAR.flightDays} days.`, [o.nationId, victim])
  return flight
}

/** Fires at once, in a turn game. */
export function fireNuke(s: GameState, map: WorldMap, o: Nuke, rng: Rng) {
  const n = s.nations[o.nationId]
  if (warheadsOf(n) < 1) return
  spendWarhead(s, n)
  detonate(s, map, rng, o.nationId, o.target)
}

/** A warhead that was in the air cannot land if the war ended, or the country is no longer an enemy's. Returns why, or null. */
export function nukeCalledOff(s: GameState, f: NukeFlight): 'taken' | 'changed' | 'peace' | null {
  const owner = s.regions[f.target]?.owner
  if (owner === f.nationId) return 'taken'
  if (!owner || !s.nations[owner]?.alive || (f.foe && owner !== f.foe)) return 'changed'
  return atWar(s, f.nationId, owner) ? null : 'peace'
}

/**
 * What a warhead does to the country it lands on, and to the one who fired it. The country's army and infrastructure go to almost
 * nothing, its people die, its output stays crippled for years; and the world answers with contempt, sanctions and war.
 */
export function detonate(s: GameState, map: WorldMap, rng: Rng, nationId: NationId, target: RegionId) {
  const n = s.nations[nationId]
  const region = s.regions[target]
  const victim = s.nations[region.owner]
  const place = map.regions[target].name
  const through = nukeThrough(victim.systems?.shield ?? 0, nukeAir(s, nationId, victim.id))
  const stopped = Math.round((1 - through) * 100)

  // The land: buildings, projects and cities, the people, the line, the factories, the output.
  let lost = 0
  for (const k of Object.keys(region.buildings) as (keyof typeof region.buildings)[]) {
    const left = Math.floor(region.buildings[k] * (1 - NUCLEAR.buildings * through) + 1e-9)
    lost += region.buildings[k] - left
    region.buildings[k] = left
  }
  if (region.works) for (const k of Object.keys(region.works) as (keyof NonNullable<typeof region.works>)[]) if (through >= 0.5) delete region.works[k]
  for (const c of region.cities) c.level = Math.max(1, Math.floor(c.level * (1 - 0.8 * through)))
  const dead = region.population * NUCLEAR.people * through
  region.population = Math.max(0.01, region.population - dead)
  region.line = Math.max(NUCLEAR.lineFloor, region.line * (1 - through))
  region.sabotaged = Math.max(region.sabotaged, NUCLEAR.factoryMonths)
  region.fallout = Math.max(region.fallout ?? 0, NUCLEAR.falloutMonths)
  region.rebels = Math.max(region.rebels, NUCLEAR.rebels * through)
  region.attackedTurn = s.turn

  // The army: the capital, or a small nation's land, is where its army stands.
  const core = victim.capital === target || regionsOf(s, victim.id).length <= NUCLEAR.smallNation
  const share = (core ? NUCLEAR.armyCore : NUCLEAR.armyPart) * through
  for (const k of UNIT_TYPES) {
    victim.military.units[k] *= 1 - share
  }
  for (const a of s.armies ?? []) if (a.nationId === victim.id) for (const k of UNIT_TYPES) a.units[k] *= 1 - share
  victim.stability = Math.max(0, victim.stability - NUCLEAR.stability * through)
  victim.warWeariness += NUCLEAR.weariness * through
  ;(victim.struckBy ??= {})[nationId] = s.turn

  addLog(
    s,
    'battle',
    `NUCLEAR STRIKE: ${n.name} destroyed ${place}${victim.capital === target ? ', the capital of ' + victim.name + ',' : ''} with a nuclear warhead${stopped > 0 ? ` (the shield stopped ${stopped}%)` : ''}. ${Math.round(dead * 10) / 10} million died, ${lost} buildings are gone, ${Math.round(share * 100)}% of ${victim.name}'s army is destroyed and the Defense Line is broken.`,
    [nationId, victim.id],
  )
  worldReacts(s, map, rng, nationId, victim.id)
}

/**
 * The strongest alliance blocs and, when there are too few, nations that are not the attacker's: the world's leading factions.
 * The victim and its friends are left out: they are already in the war.
 */
export function leadingFactions(s: GameState, attacker: NationId, count: number, victim?: NationId): NationId[][] {
  const mine = new Set<NationId>([attacker, ...Object.values(s.nations).filter((x) => x.alive && x.overlord === attacker).map((x) => x.id)])
  for (const b of blocsOf(s)) if (b.members.some((m) => mine.has(m))) for (const m of b.members) mine.add(m)
  const humans = new Set(s.humans)
  const groups: { members: NationId[]; power: number }[] = []
  const seen = new Set<NationId>()
  const theirs = new Set<NationId>(victim ? [victim, ...alliesOf(s, victim)] : [])
  for (const b of blocsOf(s)) {
    if (b.members.some((m) => mine.has(m) || theirs.has(m))) continue
    const members = b.members.filter((m) => !humans.has(m) && !s.nations[m]?.overlord)
    for (const m of b.members) seen.add(m)
    if (members.length) groups.push({ members, power: b.power })
  }
  for (const n of Object.values(s.nations).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!n.alive || mine.has(n.id) || theirs.has(n.id) || seen.has(n.id) || humans.has(n.id) || n.overlord) continue
    groups.push({ members: [n.id], power: militaryPower(s, n.id) })
  }
  return groups
    .sort((a, b) => b.power - a.power || (a.members[0] < b.members[0] ? -1 : 1))
    .slice(0, count)
    .map((g) => g.members)
}

/** The world's answer to a nuclear strike: infamy, opinion, tension, sanctions, and the leading factions at war with the attacker. */
export function worldReacts(s: GameState, map: WorldMap, rng: Rng, attacker: NationId, victim: NationId) {
  const n = s.nations[attacker]
  addInfamy(s, attacker, NUCLEAR.infamy)
  for (const other of Object.keys(s.nations).sort()) {
    if (other === attacker || !s.nations[other].alive) continue
    addOpinion(s, other, attacker, 'Used nuclear weapons', NUCLEAR.opinion, NUCLEAR.opinionDecay)
  }
  addOpinion(s, victim, attacker, 'Destroyed us with a nuclear weapon', NUCLEAR.victimOpinion, NUCLEAR.victimDecay)
  s.shock = (s.shock ?? 0) + NUCLEAR.tension
  s.nukeLast = s.turn
  // Trade is cut off by everyone who is not the attacker's friend.
  const friends = new Set<NationId>([attacker, ...alliesOf(s, attacker)])
  let sanctioners = 0
  for (const other of Object.keys(s.nations).sort()) {
    if (friends.has(other) || !s.nations[other].alive || s.nations[other].overlord === attacker || s.nations[attacker].overlord === other) continue
    if (s.sanctions.some((x) => x.from === other && x.to === attacker && x.until >= s.turn + NUCLEAR.sanctionsMonths - 1)) continue
    s.sanctions = s.sanctions.filter((x) => !(x.from === other && x.to === attacker))
    s.sanctions.push({ from: other, to: attacker, until: s.turn + NUCLEAR.sanctionsMonths })
    sanctioners++
  }
  // The leading factions declare war, each member within its own limit of wars. Easy rivals send only the first.
  // The attacker's own limit never shields it: being at its limit does not stop the world answering (that is the consequence of the bomb).
  // It can exceed its limit only by these declarations, and cannot start another war of its own until it is back under it.
  const easy = (s.settings.difficulty ?? 'normal') === 'easy'
  const factions = leadingFactions(s, attacker, easy ? NUCLEAR.factionsEasy : NUCLEAR.factions, victim)
  const declared: NationId[] = []
  for (const members of factions) {
    for (const id of members) {
      if (atWar(s, id, attacker) || isAllied(s, id, attacker) || enemiesOf(s, id).length >= maxWars(s, id)) continue
      grantJustification(s, id, attacker, 'Nuclear aggression', NUCLEAR.reasonMonths)
      declareWar(s, map, id, attacker, rng)
      declared.push(id)
    }
  }
  const names = factions.map((m) => nm(s, m[0]) + (m.length > 1 ? ` bloc (${m.length})` : ''))
  addLog(s, 'news', `The world answers ${n.name}'s nuclear strike: it is condemned by every nation, ${sanctioners} sanction it, and ${names.join(' and ') || 'no one'} ${declared.length ? `declare${names.length === 1 && declared.length === 1 ? 's' : ''} war` : 'cannot go to war'}.`, [attacker, victim, ...declared])
}

/** The month's work of the nuclear programs: warheads come off the line, they cost to keep, tension fades and ruined land heals. */
export function runNuclear(s: GameState) {
  for (const n of Object.values(s.nations)) {
    const st = n.nuclear
    if (!n.alive || !st) continue
    const done = st.building.filter((t) => t <= s.turn)
    if (done.length) {
      st.building = st.building.filter((t) => t > s.turn)
      st.warheads += done.length
      if (n.isPlayer) addLog(s, 'economy', `A nuclear warhead is ready. You now have ${warheadsOf(n)}.`, [n.id])
      else if (n.tier >= NUCLEAR.tier) addLog(s, 'news', `Intelligence reports that ${n.name} has finished building a nuclear warhead.`, [n.id])
    }
    if (st.warheads > 0) n.resources.capital -= st.warheads * NUCLEAR.upkeep
  }
  if (s.shock !== undefined) {
    s.shock *= 1 - NUCLEAR.tensionFade
    if (s.shock < 0.3) delete s.shock
  }
  for (const r of Object.values(s.regions)) {
    if (r.fallout === undefined) continue
    r.fallout -= 1
    if (r.fallout <= 0) delete r.fallout
  }
}

/** Nations that hold a warhead and are at war with this one, for the advisor and the AI to weigh. */
export function nuclearThreats(s: GameState, id: NationId): NationId[] {
  return enemiesOf(s, id).filter((e) => warheadsOf(s.nations[e]) >= 1 && nuclearAccess(s, e) === null)
}

/**
 * What a Hard rival does with the bomb. It builds one when it has the means and a war, and fires it only when it is desperate or
 * has been provoked, never twice in three years, and never while the world is still shaken by the last one.
 */
export function aiNuclearOrder(s: GameState, map: WorldMap, nationId: NationId, rng: Rng): Order | null {
  const n = s.nations[nationId]
  // Only the strongest tier of rival ever thinks of it.
  if (difficultyOf(s.settings.difficulty).skill < 2 || nuclearAccess(s, nationId)) return null
  const enemies = enemiesOf(s, nationId).filter((e) => s.nations[e]?.alive)
  if (enemies.length === 0) return null
  if (warheadsOf(n) >= 1) {
    if (s.nukeLast !== undefined && s.turn - s.nukeLast < NUCLEAR.worldQuiet) return null
    if (n.nuclear?.last !== undefined && s.turn - n.nuclear.last < NUCLEAR.aiEvery) return null
    const myPower = Math.max(1, militaryPower(s, nationId))
    const capitalLine = s.regions[n.capital]?.owner === nationId ? s.regions[n.capital].line / Math.max(0.5, lineMax(s, map, n.capital)) : 1
    const attackers = recentAttackers(s, n, 6)
    for (const e of enemies) {
      const foe = s.nations[e]
      const provoked = attackers.includes(e) || (foe.nuclear?.last !== undefined && s.turn - foe.nuclear.last <= 24)
      const desperate = capitalLine < NUCLEAR.aiDesperateLine || myPower < militaryPower(s, e) * NUCLEAR.aiDesperatePower
      if (!provoked && !desperate) continue
      if (!rng.chance(0.5)) continue
      // The capital if it can be hit, then the biggest country.
      const lands = regionsOf(s, e).sort((a, b) => (a === foe.capital ? -1 : b === foe.capital ? 1 : s.regions[b].population - s.regions[a].population || (a < b ? -1 : 1)))
      for (const t of lands.slice(0, 4)) {
        const order: Order = { type: 'nuke', nationId, target: t }
        if (nukeProblem(s, map, order, []) === null) return order
      }
    }
    return null
  }
  // Building one: only a rich nation at war, and only one at a time.
  if (warheadsBuilding(n) === 0 && n.resources.capital > NUCLEAR.money + NUCLEAR.aiReserve && rng.chance(0.25)) {
    const order: Order = { type: 'buildWarhead', nationId }
    if (buildWarheadProblem(s, order, []) === null && n.resources.steel >= NUCLEAR.steel && n.resources.tp >= NUCLEAR.research) return order
  }
  return null
}
