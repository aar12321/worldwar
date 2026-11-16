import { ALERT, ALERT_LEVELS, CHOKEPOINTS, PRESENCE, type AlertLevel } from '../data/presence'
import { UNIT_SPECS } from '../data/unitTypes'
import { STATION } from '../data/deployment'
import { addOpinion } from '../ai/opinion'
import { borderTension, neighborsOf } from './borders'
import { garrisonDivisions, heatNow, patrolCover, postedUnits } from './deployment'
import { addLog, atWar, clamp, enemiesOf, grantJustification, isAllied, pairKey, sanctionersOf } from './helpers'
import { hasIntel } from './intel'
import { createRng } from './rng'
import type { Deployment, GameState, NationId, Order, PresenceRecord, RegionId, UnitType, WorldMap } from './types'

/**
 * Presence: what forces on station do in the world, month by month. Patrols protect the sea trade and hold the straits, a fleet at
 * war blockades the other's ports, patrols and air screens learn what neighbors keep, patrols of tense neighbors sometimes meet
 * (collisions, shoot-downs), tense borders sometimes cool by talks, and a show of force or an exercise raises readiness and heat.
 *
 * Rules that keep it honest: nothing here runs for a nation that never set a posture (the old game is the same game); a patrol's
 * trade gain can never pay for its own upkeep; every gain has a soft cap; the dice come from their own stream, so the rest of the
 * month rolls what it always did; a readiness level moves a few points a month, so it cannot be flipped on when the shot is fired.
 */

const sq = (v: number) => Math.sqrt(Math.max(0, v))

export const alertOf = (d: Deployment | undefined): AlertLevel => d?.alert ?? 'normal'

const blank = (): PresenceRecord => ({ deterred: 0, trade: 0, blockaded: 0, intel: 0, detected: 0, sorties: 0, incidents: 0, shows: 0, spent: 0 })

/** The record of what a nation's forces have done, made on first use. Mutates `s`. */
export function ledgerFor(s: GameState, id: NationId): PresenceRecord {
  return ((s.presence ??= {})[id] ??= blank())
}

/** Credits a nation's forces with provocations turned back. Mutates `s`. */
export function noteDeterred(s: GameState, id: NationId, n = 1) {
  if (!PRESENCE.on || !s.nations[id]?.military.deployment) return
  ledgerFor(s, id).deterred += n
}

/** Money and oil a month of the units on station costs in upkeep. */
export function postedUpkeep(s: GameState, id: NationId): { money: number; oil: number; naval: number } {
  const p = postedUnits(s, id)
  let money = 0
  let oil = 0
  for (const k of Object.keys(p) as UnitType[]) {
    money += p[k] * UNIT_SPECS[k].upkeep
    oil += p[k] * UNIT_SPECS[k].oil
  }
  return { money, oil, naval: p.naval * UNIT_SPECS.naval.upkeep }
}

/** What the alert level costs (positive) or saves (negative) each month in money and oil. */
export function alertCost(s: GameState, id: NationId): { money: number; oil: number } {
  const d = s.nations[id]?.military.deployment
  if (!d) return { money: 0, oil: 0 }
  const u = postedUpkeep(s, id)
  const a = ALERT[alertOf(d)]
  return { money: u.money * a.upkeep, oil: u.oil * a.oil }
}

/** Readiness the force is working toward. */
export function readyTarget(s: GameState, id: NationId): number {
  const n = s.nations[id]
  const d = n?.military.deployment
  if (!d) return PRESENCE.readyBase
  let t = ALERT[alertOf(d)].target
  if ((d.exerciseUntil ?? -1) >= s.turn) t += PRESENCE.exercise.ready
  if (n.resources.oil <= 0.01 && postedUpkeep(s, id).oil > 0.01) t -= PRESENCE.drySupply
  return clamp(t, 0, 100)
}

/** Readiness now, 0 to 100. */
export const readinessOf = (d: Deployment | undefined) => d?.ready ?? PRESENCE.readyBase

// ---- Chokepoints ----

export interface ChokeView {
  id: string
  name: string
  a: RegionId
  b: RegionId
  lat: number
  lng: number
  /** The nation that holds the strait, if one does. */
  holder: NationId | null
  /** Two nations both patrol it and neither has the edge. */
  contested: boolean
  /** Patrol strength each owner of an end brings to it. */
  power: Record<NationId, number>
}

/** Who holds each strait and canal: the owner of an end whose patrols are at least 1.5 times the other's. Nobody if neither patrols. */
export function chokeStatus(s: GameState, map: WorldMap): ChokeView[] {
  const live = CHOKEPOINTS.filter((c) => s.regions[c.a] && s.regions[c.b] && map.regions[c.a]?.seaLanes.includes(c.b) && map.regions[c.b])
  const lanes = new Map<NationId, number>()
  for (const c of live) for (const r of [c.a, c.b]) lanes.set(s.regions[r].owner, (lanes.get(s.regions[r].owner) ?? 0) + 1)
  const cache = new Map<NationId, number>()
  const powerOf = (id: NationId) => {
    let v = cache.get(id)
    if (v === undefined) {
      const c = patrolCover(s, id)
      v = (c.coastal + c.subs * 0.8 + c.air * 0.4) / sq(lanes.get(id) ?? 1)
      cache.set(id, v)
    }
    return v
  }
  return live.map((c) => {
    const oa = s.regions[c.a].owner
    const ob = s.regions[c.b].owner
    const power: Record<NationId, number> = {}
    for (const o of new Set([oa, ob])) if (s.nations[o]?.alive) power[o] = powerOf(o)
    const owners = Object.keys(power).sort()
    let holder: NationId | null = null
    let contested = false
    if (owners.length === 1) holder = power[owners[0]] >= PRESENCE.chokeMin ? owners[0] : null
    else if (owners.length === 2) {
      const [x, y] = owners
      const hi = power[x] >= power[y] ? x : y
      const lo = hi === x ? y : x
      if (power[hi] >= PRESENCE.chokeMin && power[hi] >= power[lo] * PRESENCE.chokeEdge) holder = hi
      else contested = power[hi] >= PRESENCE.chokeMin && power[lo] >= PRESENCE.chokeMin
    }
    const ra = map.regions[c.a]
    const rb = map.regions[c.b]
    return { id: c.id, name: c.name, a: c.a, b: c.b, lat: (ra.lat + rb.lat) / 2, lng: Math.abs(ra.lng - rb.lng) > 180 ? ra.lng : (ra.lng + rb.lng) / 2, holder, contested, power }
  })
}

// ---- The month ----

const seaPatrol = (s: GameState, id: NationId) => {
  const c = patrolCover(s, id)
  return c.coastal + c.subs
}

/** Share of a nation's countries on a coast. */
function coastalShare(s: GameState, map: WorldMap, id: NationId, memo: Map<NationId, number>): number {
  let v = memo.get(id)
  if (v === undefined) {
    let all = 0
    let coast = 0
    for (const r of Object.values(s.regions)) {
      if (r.owner !== id) continue
      all++
      if (map.regions[r.id]?.coastal) coast++
    }
    v = all ? coast / all : 0
    memo.set(id, v)
  }
  return v
}

/** Money each month a nation's trade at sea is worth: the part of its income that rides the sea. */
const seaIncome = (s: GameState, map: WorldMap, id: NationId, gross: ReadonlyMap<NationId, number>, memo: Map<NationId, number>) => (gross.get(id) ?? 0) * coastalShare(s, map, id, memo) * PRESENCE.seaShare

/**
 * The month of presence. Called once a month after the borders have been tended. `gross` is each nation's income this month.
 * Mutates `s`. A nation that never posted anything is untouched.
 */
export function runPresence(s: GameState, map: WorldMap, gross: ReadonlyMap<NationId, number>) {
  if (!PRESENCE.on) return
  const ids = Object.values(s.nations)
    .filter((n) => n.alive && n.military.deployment)
    .map((n) => n.id)
    .sort()
  if (!ids.length) return
  const rng = createRng((s.seed ^ 0x51ab1e) >>> 0, s.turn)
  const memo = new Map<NationId, number>()
  const player = (id: NationId) => !!s.nations[id]?.isPlayer

  // 1. Readiness and what the alert costs. A force that never set an alert, and is not drilling, keeps no readiness at all.
  for (const id of ids) {
    const n = s.nations[id]
    const d = n.military.deployment!
    const c = alertCost(s, id)
    if (c.money !== 0 || c.oil !== 0) {
      n.resources.capital -= c.money
      n.resources.oil = Math.max(0, n.resources.oil - c.oil)
      ledgerFor(s, id).spent += c.money
    }
    const target = readyTarget(s, id)
    if (d.ready === undefined && target === PRESENCE.readyBase) continue
    const now = readinessOf(d)
    d.ready = clamp(now + clamp(target - now, -PRESENCE.readyStep, PRESENCE.readyStep), 0, 100)
    if (d.ready === PRESENCE.readyBase && !d.alert && (d.exerciseUntil ?? -1) < s.turn) delete d.ready
  }

  // 2. Landings that patrols met this month count as deterred.
  for (const b of s.battles) {
    if (b.turn !== s.turn || !b.intercept || b.intercept.share <= 0) continue
    if (s.nations[b.intercept.by]?.military.deployment) ledgerFor(s, b.intercept.by).deterred++
  }

  // 3. Protected trade: patrols and held straits. Never more than a share of the fleet's own upkeep.
  const chokes = chokeStatus(s, map)
  const held = new Map<NationId, number>()
  for (const c of chokes) if (c.holder) held.set(c.holder, (held.get(c.holder) ?? 0) + 1)
  for (const id of ids) {
    const patrol = seaPatrol(s, id)
    const lanes = held.get(id) ?? 0
    if (patrol < STATION.minPatrol && lanes === 0) continue
    const frac = Math.min(PRESENCE.tradeCap, PRESENCE.tradePer * sq(patrol) + PRESENCE.chokeValue * Math.min(2, lanes))
    const cap = postedUpkeep(s, id).naval * PRESENCE.tradeVsUpkeep
    const gain = Math.min(seaIncome(s, map, id, gross, memo) * frac, cap)
    if (gain <= 0.005) continue
    s.nations[id].resources.capital += gain
    ledgerFor(s, id).trade += gain
  }

  // 4. Blockades at war, and sanctions that patrols enforce: a fleet that outguns the other side's shuts part of its sea trade.
  const squeeze = new Map<NationId, { by: Map<NationId, number> }>()
  const press = (x: NationId, y: NationId, weight: number) => {
    const px = seaPatrol(s, x)
    if (px < 1 || !s.nations[y]?.alive) return
    const strength = clamp((px - seaPatrol(s, y)) / PRESENCE.blockadeFull, 0, 1) * weight
    if (strength <= 0.02) return
    const e = squeeze.get(y) ?? { by: new Map() }
    e.by.set(x, (e.by.get(x) ?? 0) + strength)
    squeeze.set(y, e)
  }
  for (const id of ids) {
    for (const foe of enemiesOf(s, id)) press(id, foe, 1)
    for (const t of Object.keys(s.nations)) if (t !== id && s.nations[t].alive && sanctionersOf(s, t).includes(id)) press(id, t, PRESENCE.sanctionShare)
  }
  for (const y of [...squeeze.keys()].sort()) {
    const e = squeeze.get(y)!
    const total = Math.min(1, [...e.by.values()].reduce((a, b) => a + b, 0))
    const ny = s.nations[y]
    const loss = Math.min(Math.max(0, ny.resources.capital), seaIncome(s, map, y, gross, memo) * PRESENCE.blockadeCut * total)
    if (loss <= 0.005) continue
    ny.resources.capital -= loss
    const first = [...e.by.keys()].sort()[0]
    for (const x of e.by.keys()) ledgerFor(s, x).blockaded += loss * ((e.by.get(x) ?? 0) / [...e.by.values()].reduce((a, b) => a + b, 0))
    if (player(y) && s.turn % 6 === 0) addLog(s, 'economy', `${s.nations[first].name}'s fleet is choking your sea trade: about ${Math.round(loss)} lost this month.`, [y, first])
  }

  // 5. Watching: patrols, submarine screens and air screens learn what the neighbors keep.
  const near = new Map<NationId, Set<NationId>>()
  for (const id of ids) {
    const c = patrolCover(s, id)
    ledgerFor(s, id).sorties += Math.round(c.air * PRESENCE.sorties)
    const power = c.coastal * PRESENCE.watchWeight.coastal + c.subs * PRESENCE.watchWeight.subs + c.air * PRESENCE.watchWeight.air
    const set = new Set<NationId>(neighborsOf(s, map, id).map((x) => x.id))
    for (const e of enemiesOf(s, id)) set.add(e)
    near.set(id, set)
    if (power < STATION.minPatrol) continue
    const chance = 1 - Math.exp(-PRESENCE.watchPer * power)
    const rec = ledgerFor(s, id)
    let learned = 0
    for (const x of [...set].sort()) {
      if (learned >= PRESENCE.watchMax || !s.nations[x]?.alive) continue
      const roll = rng.next()
      if (hasIntel(s, id, x) || roll >= chance) continue
      s.intel[`${id}|${x}`] = s.turn + PRESENCE.watchMonths
      learned++
      rec.intel++
      const theirs = patrolCover(s, x)
      if (theirs.coastal + theirs.subs + theirs.air >= STATION.minPatrol) rec.detected++
      if (player(id) && s.turn - (rec.seenAt?.[x] ?? -99) >= 12) {
        addLog(s, 'spy', `Our ${c.subs >= c.coastal && c.subs > 0 ? 'submarine screen' : c.air > c.coastal ? 'air patrols' : 'patrols'} located ${s.nations[x].name}'s forces: what it keeps on station is now visible.`, [id, x])
      }
      ;(rec.seenAt ??= {})[x] = s.turn
    }
  }

  // 6. Tense neighbors whose patrols meet: collisions and shoot-downs, with diplomatic consequences.
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]
      const b = ids[j]
      const u = rng.next()
      if (u >= PRESENCE.incidentPer * 100 || !near.get(a)?.has(b) || atWar(s, a, b) || isAllied(s, a, b)) continue
      const ca = patrolCover(s, a)
      const cb = patrolCover(s, b)
      const sea = ca.coastal + ca.subs >= STATION.minPatrol && cb.coastal + cb.subs >= STATION.minPatrol
      const air = ca.air >= STATION.minPatrol && cb.air >= STATION.minPatrol
      if (!sea && !air) continue
      const tension = borderTension(s, map, a, b).total
      if (tension < PRESENCE.incidentFrom || u >= PRESENCE.incidentPer * tension) continue
      const kind = air && (!sea || rng.chance(0.4)) ? 'air' : 'naval'
      const culprit = rng.chance(0.5) ? a : b
      const victim = culprit === a ? b : a
      const nc = s.nations[culprit]
      const nv = s.nations[victim]
      if (kind === 'naval') {
        nc.military.units.naval = Math.max(0, nc.military.units.naval - PRESENCE.incidentLoss)
        nv.military.units.naval = Math.max(0, nv.military.units.naval - PRESENCE.incidentLoss)
      } else nc.military.units.fighter = Math.max(0, nc.military.units.fighter - 2 * PRESENCE.incidentLoss)
      grantJustification(s, victim, culprit, kind === 'naval' ? 'Naval incident' : 'Air incident', 6)
      addOpinion(s, victim, culprit, kind === 'naval' ? 'Naval incident' : 'Air incident', PRESENCE.incidentOpinion, 0.3)
      addHeat(s, a, b, PRESENCE.incidentHeat)
      ledgerFor(s, a).incidents++
      ledgerFor(s, b).incidents++
      addLog(
        s,
        'war',
        kind === 'naval' ? `A ${nc.name} warship collided with a ${nv.name} patrol vessel in contested waters. ${nv.name} protests.` : `A ${nv.name} interceptor shot down a ${nc.name} reconnaissance aircraft near its border. ${nc.name} denies it was over ${nv.name}.`,
        [victim, culprit],
      )
    }
  }

  // 7. Talks that cool a tense border, when neither side is on high alert.
  for (const key of Object.keys(s.borders ?? {}).sort()) {
    const rec = s.borders![key]
    const [a, b] = key.split('|')
    if (heatNow(s, rec) < PRESENCE.easeHeat * 1.5 || !s.nations[a]?.alive || !s.nations[b]?.alive || atWar(s, a, b)) continue
    if (alertOf(s.nations[a].military.deployment) === 'high' || alertOf(s.nations[b].military.deployment) === 'high') continue
    if (!rng.chance(PRESENCE.easeChance)) continue
    addHeat(s, a, b, -PRESENCE.easeHeat)
    for (const x of [a, b]) if (s.nations[x].military.deployment) ledgerFor(s, x).deterred++
    if (player(a) || player(b)) addLog(s, 'diplomacy', `Talks between ${s.nations[a].name} and ${s.nations[b].name} eased tension on their border.`, [a, b])
  }

  // 8. The player's desk remembers how tense each border was, to say what is changing.
  for (const id of ids) {
    if (!player(id)) continue
    const t: Record<NationId, number> = {}
    for (const nb of neighborsOf(s, map, id)) t[nb.id] = borderTension(s, map, id, nb.id).total
    ledgerFor(s, id).tension = t
  }
}

/** Adds heat to (or takes it from) the border between two nations, keeping what is left of the old heat. Mutates `s`. */
export function addHeat(s: GameState, a: NationId, b: NationId, heat: number) {
  const key = pairKey(a, b)
  const rec = ((s.borders ??= {})[key] ??= {})
  const now = heatNow(s, rec)
  const next = clamp(now + heat, 0, 60)
  rec.at = s.turn
  if (next <= 0) delete rec.heat
  else rec.heat = next
  if (!rec.closedBy && rec.heat === undefined) delete s.borders[key]
  if (Object.keys(s.borders).length === 0) delete s.borders
}

// ---- Orders ----

type SetAlert = Extract<Order, { type: 'setAlert' }>
type Show = Extract<Order, { type: 'showOfForce' }>

export function validateSetAlert(s: GameState, o: SetAlert): string | null {
  const d = s.nations[o.nationId]?.military.deployment
  if (!ALERT_LEVELS.includes(o.alert)) return 'Choose relaxed, normal or high alert'
  if (!d) return 'Post some forces on station first'
  if (alertOf(d) === o.alert) return `Your forces are already on ${ALERT[o.alert].name.toLowerCase()}`
  return null
}

export function applySetAlert(s: GameState, o: SetAlert) {
  const d = s.nations[o.nationId].military.deployment!
  if (o.alert === 'normal') delete d.alert
  else d.alert = o.alert
  if (s.nations[o.nationId].isPlayer) addLog(s, 'info', `Alert level: ${ALERT[o.alert].name.toLowerCase()}.`, [o.nationId])
}

/** Divisions of the force a show would be made with. */
export function showStrength(s: GameState, id: NationId, kind: Show['kind'], target?: NationId): number {
  const c = patrolCover(s, id)
  if (kind === 'naval') return c.coastal + c.subs
  if (kind === 'air') return c.air
  if (kind === 'ground') return target ? garrisonDivisions(s, id, target) : 0
  return c.coastal + c.subs + c.air + Object.keys(s.nations[id]?.military.deployment?.border ?? {}).reduce((t, x) => t + garrisonDivisions(s, id, x), 0)
}

/** Capital a show of force or an exercise costs. */
export function showCost(s: GameState, o: Show): number {
  const strength = showStrength(s, o.nationId, o.kind, o.target)
  const k = o.kind === 'exercise' ? PRESENCE.exercise : PRESENCE.show
  return Math.round(k.capital + k.capitalPerDivision * Math.min(8, strength))
}

export function validateShow(s: GameState, map: WorldMap, o: Show, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const d = n?.military.deployment
  if (!['naval', 'air', 'ground', 'exercise'].includes(o.kind)) return 'Choose a naval, air, ground or exercise show'
  if (!d) return 'Post some forces on station first'
  if (pending.some((p) => p.type === 'showOfForce' && p.nationId === o.nationId)) return 'One show of force a month'
  const rec = s.presence?.[o.nationId]
  const strength = showStrength(s, o.nationId, o.kind, o.target)
  if (strength < PRESENCE.show.minDivisions) return o.kind === 'exercise' ? 'You have nothing on station to drill' : 'You have too little posted for that: post more forces first'
  if (n.resources.oil < (o.kind === 'exercise' ? PRESENCE.exercise.oil : PRESENCE.show.oil)) return 'Not enough oil'
  if (o.kind === 'exercise') {
    if (rec?.exerciseAt !== undefined && s.turn - rec.exerciseAt < PRESENCE.exercise.cooldown) return `Your forces drilled recently. Another exercise in ${PRESENCE.exercise.cooldown - (s.turn - rec.exerciseAt)} months.`
    return null
  }
  const t = o.target ? s.nations[o.target] : undefined
  if (!o.target || !t?.alive || o.target === o.nationId) return 'Choose a neighboring nation to show force to'
  if (!neighborsOf(s, map, o.nationId).some((x) => x.id === o.target)) return `${t.name} is not your neighbor`
  if (isAllied(s, o.nationId, o.target) || t.overlord === o.nationId || n.overlord === o.target) return `${t.name} is a friend`
  if (atWar(s, o.nationId, o.target)) return 'You are already at war with them'
  const last = rec?.showAt?.[o.target]
  if (last !== undefined && s.turn - last < PRESENCE.show.cooldown) return `You showed force to ${t.name} recently. Again in ${PRESENCE.show.cooldown - (s.turn - last)} months.`
  return null
}

/** Pays the oil, trains the forces, raises readiness and heat, and tells the neighbor. Mutates `s`. (The capital is charged with the order.) */
export function applyShow(s: GameState, o: Show) {
  const n = s.nations[o.nationId]
  const d = n.military.deployment!
  const rec = ledgerFor(s, o.nationId)
  const k = o.kind === 'exercise' ? PRESENCE.exercise : PRESENCE.show
  n.resources.oil = Math.max(0, n.resources.oil - k.oil)
  rec.spent += showCost(s, o) + k.oil
  rec.shows++
  // Training: the posted kinds drill a little, up to a soft cap.
  const posted = postedUnits(s, o.nationId)
  for (const u of Object.keys(posted) as UnitType[]) {
    if (posted[u] < 0.05) continue
    n.military.drill[u] = Math.max(n.military.drill[u], Math.min(k.drillCap, n.military.drill[u] + k.drill))
  }
  d.ready = clamp(readinessOf(d) + k.ready, 0, 100)
  if (o.kind === 'exercise') {
    d.exerciseUntil = s.turn + PRESENCE.exercise.months
    rec.exerciseAt = s.turn
    if (n.isPlayer) addLog(s, 'info', 'Your forces held a large exercise: readiness and training are up.', [o.nationId])
    return
  }
  // The forces stay keyed up for a couple of months after a show.
  d.exerciseUntil = Math.max(d.exerciseUntil ?? -1, s.turn + 2)
  const target = o.target!
  ;(rec.showAt ??= {})[target] = s.turn
  addOpinion(s, target, o.nationId, 'Show of force', PRESENCE.show.opinion, 0.25)
  addHeat(s, o.nationId, target, PRESENCE.show.heat)
  const what = o.kind === 'naval' ? 'a naval squadron' : o.kind === 'air' ? 'a wing of fighters' : 'troops along the border'
  addLog(s, 'diplomacy', `${n.name} showed force to ${s.nations[target].name}: ${what}.`, [o.nationId, target])
}
