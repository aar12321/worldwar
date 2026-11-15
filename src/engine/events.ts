import { addOpinion } from '../ai/opinion'
import { EVENT_BY_ID, EVENTS, type GameEventDef } from '../data/events'
import { TECH_BY_ID, TECHS } from '../data/techTree'
import { BUILDING_SPECS } from '../data/unitTypes'
import { computeEconomy, ECON } from './economy'
import { addLog, clamp, grantJustification, regionsOf } from './helpers'
import { createRng, type Rng } from './rng'
import { startEpidemic } from './epidemics'
import type { EventEffect, GameState, NationId, PendingEvent, RegionId, WorldMap } from './types'
import { UNIT_TYPES } from './types'

/** Opening month is turn 1. The first surprise waits until this turn, seven months later. */
export const FIRST_EVENT_TURN = 8
/** Months between surprise decisions once they start. */
export const EVENT_GAP_TURNS = 12

function availableTechs(s: GameState, nationId: NationId): string[] {
  const n = s.nations[nationId]
  return TECHS.filter((t) => !n.techs.includes(t.id) && t.requires.every((r) => n.techs.includes(r))).map((t) => t.id)
}

function pickRival(s: GameState, map: WorldMap, nationId: NationId, rng: Rng): NationId | null {
  const mine = new Set(regionsOf(s, nationId))
  const neighborNations = new Set<NationId>()
  for (const id of mine)
    for (const nb of [...map.regions[id].neighbors, ...map.regions[id].seaLanes]) {
      const owner = s.regions[nb]?.owner
      if (owner && owner !== nationId) neighborNations.add(owner)
    }
  const avail = new Set(availableTechs(s, nationId))
  const all = Object.values(s.nations).filter((n) => n.alive && n.id !== nationId)
  const knowsSomething = (id: NationId) => s.nations[id].techs.some((t) => avail.has(t))
  const preferred = [...neighborNations].filter(knowsSomething).sort()
  if (preferred.length) return rng.pick(preferred)
  const anyone = all.filter((n) => knowsSomething(n.id)).map((n) => n.id).sort()
  if (anyone.length) return rng.pick(anyone)
  return null
}

function pickRegion(s: GameState, map: WorldMap, nationId: NationId, kind: 'any' | 'border', rng: Rng): RegionId | null {
  const n = s.nations[nationId]
  const owned = regionsOf(s, nationId)
  const candidates =
    kind === 'any'
      ? owned
      : owned.filter((id) => id !== n.capital && map.regions[id].neighbors.some((nb) => s.regions[nb]?.owner !== nationId))
  return candidates.length ? rng.pick(candidates) : null
}

export function scheduleEvent(s: GameState, map: WorldMap, nationId: NationId, rng: Rng): PendingEvent | null {
  const weighted: { def: GameEventDef; w: number }[] = EVENTS.map((def) => ({ def, w: def.weight(s, nationId) })).filter((x) => x.w > 0)
  for (let attempt = 0; attempt < 6 && weighted.length; attempt++) {
    const total = weighted.reduce((sum, x) => sum + x.w, 0)
    let roll = rng.next() * total
    let idx = 0
    while (idx < weighted.length - 1 && roll >= weighted[idx].w) roll -= weighted[idx++].w
    const def = weighted[idx].def
    const candidates = def.rivalCandidates?.(s, nationId)
    const rivalId = !def.needsRival ? null : candidates ? (candidates.length ? rng.pick(candidates) : null) : pickRival(s, map, nationId, rng)
    const regionId = def.needsRegion ? pickRegion(s, map, nationId, def.needsRegion, rng) : null
    if ((def.needsRival && !rivalId) || (def.needsRegion && !regionId)) {
      weighted.splice(idx, 1)
      continue
    }
    return { eventId: def.id, turn: s.turn, rivalId, regionId }
  }
  return null
}

export function fillEventText(text: string, s: GameState, map: WorldMap, ev: PendingEvent, nationId: NationId = s.playerId): string {
  return text
    .replaceAll('{region}', ev.regionId ? map.regions[ev.regionId].name : 'the provinces')
    .replaceAll('{rival}', ev.rivalId ? s.nations[ev.rivalId].name : 'a rival nation')
    .replaceAll('{nation}', s.nations[nationId].name)
}

export function effectAmount(e: Extract<EventEffect, { type: 'resource' }>, workforce: number): number {
  return Math.round(e.amount + (e.perWorkforce ?? 0) * workforce)
}

export function describeEffect(e: EventEffect, workforce: number, s: GameState, map: WorldMap, ev: PendingEvent): string {
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)
  const labels = { capital: 'money', food: 'food', pp: 'influence', tp: 'research', oil: 'oil', steel: 'steel', goods: 'goods' }
  const rival = ev.rivalId ? s.nations[ev.rivalId].name : 'Rival'
  switch (e.type) {
    case 'opinion':
      return `${rival}'s opinion of you ${sign(e.amount)}`
    case 'rivalResource': {
      const v = effectAmount({ type: 'resource', key: e.key, amount: e.amount, perWorkforce: e.perWorkforce }, workforce)
      return `${rival} ${v >= 0 ? 'receives' : 'loses'} ${Math.abs(v)} ${labels[e.key]}`
    }
    case 'clearCasusBelli':
      return `${rival} drops its grievance against you`
    case 'embargo':
      return `Port trade -${Math.round((1 - ECON.embargoTradeMult) * 100)}% for ${e.turns} months`
    case 'resource':
      return `${sign(effectAmount(e, workforce))} ${labels[e.key]}`
    case 'stability':
      return `${sign(e.amount)} Stability`
    case 'militaryPool':
      return e.fraction > 0 ? `-${Math.round(e.fraction * 100)}% soldiers` : `+${Math.round(-e.fraction * 100)}% soldiers`
    case 'armyAttrition':
      return `-${Math.round(e.fraction * 100)}% strength to your military`
    case 'unlockRandomTech':
      return 'Unlock a random available technology'
    case 'casusBelliForRival':
      return `${ev.rivalId ? s.nations[ev.rivalId].name : 'Rival'} gains a grievance for ${e.turns} months`
    case 'spawnRebels':
      return `Rebels (${e.strength} divisions) rise in ${ev.regionId ? map.regions[ev.regionId].name : 'a province'}`
    case 'loseBuilding':
      return `Lose a ${BUILDING_SPECS[e.building].name}`
    case 'addBuilding':
      return `Gain a ${BUILDING_SPECS[e.building].name}`
    case 'popLoss':
      return `-${Math.round(e.fraction * 100)}% population in the region`
    case 'warWeariness':
      return `${sign(e.amount)} War Weariness`
    case 'people': {
      const pct = Math.round(e.amount * 100)
      const what = { health: 'health', schooling: 'schooling', unemployment: 'unemployment', specialization: 'specialization' }[e.key]
      return `${pct > 0 ? '+' : ''}${pct} points of ${what}`
    }
    case 'bank':
      return e.key === 'inflation' ? `Inflation ${sign(e.amount)} points` : `Currency ${e.amount >= 0 ? 'stronger' : 'weaker'} by ${Math.round(Math.abs(e.amount) * 100)}%`
    case 'epidemic':
      return 'An epidemic breaks out'
    case 'skills':
      return `${Math.round(e.amount * 1000) / 10}% of workers move from ${e.from} to ${e.to}`
    case 'projectProgress':
      return e.months >= 0 ? `National projects advance ${e.months} months` : `National projects lose ${-e.months} months of work`
  }
}

/** A small stable number from a nation's id, so each human's decision rolls its own dice in a multiplayer game. */
function idSalt(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return Math.abs(h) % 9973
}

/**
 * Answers the decision waiting for a nation. In a one-player game that is `pendingEvent` and the answer is the player's; in a
 * multiplayer game it is that human's entry in `pendingEvents`, which is cleared without touching anyone else's.
 */
export function applyEventChoice(state: GameState, map: WorldMap, optionIndex: number, forNation?: NationId): GameState {
  const s = structuredClone(state)
  if (!resolveEvent(s, map, optionIndex, forNation ?? s.playerId, false)) return state
  return s
}

/** Plays out a decision on a state the caller owns. `byDefault` says the nation's ministers chose because the player did not. Returns false when nothing was waiting. */
export function resolveEvent(s: GameState, map: WorldMap, optionIndex: number, nationId: NationId, byDefault: boolean): boolean {
  const multi = !!s.multiplayer
  const ev = multi ? s.pendingEvents?.[nationId] : s.pendingEvent
  if (!ev) return false
  const def = EVENT_BY_ID[ev.eventId]
  const option = def?.options[optionIndex]
  if (!option) return false
  const n = s.nations[nationId]
  const rng = createRng(s.seed, s.turn * 977 + 13 + (multi ? idSalt(nationId) : 0))
  const workforce = computeEconomy(s, map, nationId).workforce
  const region = ev.regionId ? s.regions[ev.regionId] : null

  for (const e of option.effects) {
    switch (e.type) {
      case 'resource':
        // Money can go into the red: a choice that costs money is not free for a nation that has none.
        n.resources[e.key] = e.key === 'capital' ? n.resources.capital + effectAmount(e, workforce) : Math.max(0, n.resources[e.key] + effectAmount(e, workforce))
        break
      case 'stability':
        n.stability = clamp(n.stability + e.amount, 0, 100)
        break
      case 'militaryPool':
        n.militaryPool = Math.max(0, n.militaryPool * (1 - e.fraction))
        break
      case 'armyAttrition':
        for (const k of UNIT_TYPES) n.military.units[k] *= 1 - e.fraction
        for (const a of s.armies ?? []) if (a.nationId === nationId) for (const k of UNIT_TYPES) a.units[k] *= 1 - e.fraction
        break
      case 'unlockRandomTech': {
        const avail = availableTechs(s, nationId)
        const rivalTechs = ev.rivalId ? s.nations[ev.rivalId].techs : []
        const fromRival = avail.filter((t) => rivalTechs.includes(t))
        const pool = fromRival.length ? fromRival : avail
        if (pool.length) {
          const tech = rng.pick(pool)
          n.techs.push(tech)
          addLog(s, 'tech', `The defector delivers the secrets of ${TECH_BY_ID[tech].name}!`, [nationId])
        }
        break
      }
      case 'casusBelliForRival':
        if (ev.rivalId) grantJustification(s, ev.rivalId, nationId, 'Provocation', e.turns)
        break
      case 'spawnRebels':
        if (region && region.owner === nationId) region.rebels += e.strength
        break
      case 'loseBuilding':
        if (region && region.owner === nationId && region.buildings[e.building] > 0) region.buildings[e.building]--
        break
      case 'addBuilding':
        if (region && region.owner === nationId) region.buildings[e.building]++
        break
      case 'popLoss':
        if (region && region.owner === nationId) region.population *= 1 - e.fraction
        break
      case 'warWeariness':
        n.warWeariness = clamp(n.warWeariness + e.amount, 0, 60)
        break
      case 'opinion':
        if (ev.rivalId) addOpinion(s, ev.rivalId, nationId, e.label, e.amount, 0.4)
        break
      case 'rivalResource': {
        const rival = ev.rivalId ? s.nations[ev.rivalId] : null
        if (rival?.alive) {
          const amount = effectAmount({ type: 'resource', key: e.key, amount: e.amount, perWorkforce: e.perWorkforce }, workforce)
          rival.resources[e.key] = Math.max(e.key === 'capital' ? -9999 : 0, rival.resources[e.key] + amount)
        }
        break
      }
      case 'clearCasusBelli':
        if (ev.rivalId) {
          delete s.casusBelli[`${ev.rivalId}|${nationId}`]
          delete s.reasons[`${ev.rivalId}|${nationId}`]
        }
        break
      case 'embargo':
        n.embargoedUntil = Math.max(n.embargoedUntil ?? 0, s.turn + e.turns - 1)
        break
      case 'people': {
        const p = n.people
        if (e.key === 'unemployment') p.unemployment = clamp(p.unemployment + e.amount, 0.01, 0.45)
        else if (e.key === 'specialization') p.specialization = clamp(p.specialization + e.amount, 0, 1)
        else p[e.key] = clamp(p[e.key] + e.amount, 0, 0.98)
        break
      }
      case 'bank':
        if (e.key === 'inflation') n.bank.inflation = clamp(n.bank.inflation + e.amount, -5, 60)
        else n.bank.currency = clamp(n.bank.currency + e.amount, 0.6, 1.6)
        break
      case 'epidemic':
        startEpidemic(s, nationId, e.severity)
        break
      case 'skills': {
        const sk = n.people.skills
        const move = Math.min(sk[e.from], e.amount)
        sk[e.from] -= move
        sk[e.to] += move
        break
      }
      case 'projectProgress':
        for (const p of Object.values(n.projects ?? {})) if (p && !p.done) p.progress = Math.max(0, p.progress + e.months)
        break
    }
  }
  addLog(s, 'event', byDefault ? `${def.title}: nobody decided, so your ministers chose "${option.label}".` : `${def.title}: you chose "${option.label}".`, [nationId])
  if (multi) delete s.pendingEvents![nationId]
  else s.pendingEvent = null
  return true
}

/** Multiplayer, once a month's orders are in: every decision nobody answered takes its first option, and a fallen nation's is dropped. */
export function settleUnanswered(s: GameState, map: WorldMap) {
  if (!s.multiplayer || !s.pendingEvents) return
  for (const id of Object.keys(s.pendingEvents).sort()) {
    if (!s.nations[id]?.alive) delete s.pendingEvents[id]
    else resolveEvent(s, map, 0, id, true)
  }
}

/** Multiplayer: each living human gets a decision of their own, drawn with their own dice. Nobody waits for anybody. */
export function scheduleHumanEvents(s: GameState, map: WorldMap, rng: Rng) {
  s.pendingEvents ??= {}
  for (const id of [...s.humans].sort()) {
    if (!s.nations[id]?.alive || s.eliminated.includes(id)) continue
    const ev = scheduleEvent(s, map, id, rng)
    if (ev) s.pendingEvents[id] = ev
  }
  s.nextEventTurn = s.turn + EVENT_GAP_TURNS
}
