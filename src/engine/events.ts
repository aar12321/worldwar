import { addOpinion } from '../ai/opinion'
import { EVENT_BY_ID, EVENTS, type GameEventDef } from '../data/events'
import { TECH_BY_ID, TECHS } from '../data/techTree'
import { BUILDING_SPECS } from '../data/unitTypes'
import { computeEconomy, ECON } from './economy'
import { addLog, armiesOf, clamp, regionsOf } from './helpers'
import { createRng, type Rng } from './rng'
import type { EventEffect, GameState, NationId, PendingEvent, RegionId, WorldMap } from './types'
import { UNIT_TYPES } from './types'

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

export function fillEventText(text: string, s: GameState, map: WorldMap, ev: PendingEvent): string {
  return text
    .replaceAll('{region}', ev.regionId ? map.regions[ev.regionId].name : 'the provinces')
    .replaceAll('{rival}', ev.rivalId ? s.nations[ev.rivalId].name : 'a rival nation')
    .replaceAll('{nation}', s.nations[s.playerId].name)
}

export function effectAmount(e: Extract<EventEffect, { type: 'resource' }>, workforce: number): number {
  return Math.round(e.amount + (e.perWorkforce ?? 0) * workforce)
}

export function describeEffect(e: EventEffect, workforce: number, s: GameState, map: WorldMap, ev: PendingEvent): string {
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)
  const labels = { capital: 'Capital', food: 'Food', pp: 'Political Points', tp: 'Tech Points' }
  const rival = ev.rivalId ? s.nations[ev.rivalId].name : 'Rival'
  switch (e.type) {
    case 'opinion':
      return `${rival}'s opinion of you ${sign(e.amount)}`
    case 'rivalResource': {
      const v = effectAmount({ type: 'resource', key: e.key, amount: e.amount, perWorkforce: e.perWorkforce }, workforce)
      return `${rival} ${v >= 0 ? 'receives' : 'loses'} ${Math.abs(v)} ${labels[e.key]}`
    }
    case 'clearCasusBelli':
      return `${rival} drops its casus belli against you`
    case 'embargo':
      return `Port trade -${Math.round((1 - ECON.embargoTradeMult) * 100)}% for ${e.turns} months`
    case 'resource':
      return `${sign(effectAmount(e, workforce))} ${labels[e.key]}`
    case 'stability':
      return `${sign(e.amount)} Stability`
    case 'militaryPool':
      return e.fraction > 0 ? `-${Math.round(e.fraction * 100)}% Military Manpower` : `+${Math.round(-e.fraction * 100)}% Military Manpower`
    case 'armyAttrition':
      return `-${Math.round(e.fraction * 100)}% strength to all armies`
    case 'unlockRandomTech':
      return 'Unlock a random available technology'
    case 'casusBelliForRival':
      return `${ev.rivalId ? s.nations[ev.rivalId].name : 'Rival'} gains a casus belli for ${e.turns} months`
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
  }
}

export function applyEventChoice(state: GameState, map: WorldMap, optionIndex: number): GameState {
  const s = structuredClone(state)
  const ev = s.pendingEvent
  if (!ev) return state
  const def = EVENT_BY_ID[ev.eventId]
  const option = def.options[optionIndex]
  if (!option) return state
  const nationId = s.playerId
  const n = s.nations[nationId]
  const rng = createRng(s.seed, s.turn * 977 + 13)
  const workforce = computeEconomy(s, map, nationId).workforce
  const region = ev.regionId ? s.regions[ev.regionId] : null

  for (const e of option.effects) {
    switch (e.type) {
      case 'resource':
        n.resources[e.key] = Math.max(e.key === 'capital' ? -9999 : 0, n.resources[e.key] + effectAmount(e, workforce))
        break
      case 'stability':
        n.stability = clamp(n.stability + e.amount, 0, 100)
        break
      case 'militaryPool':
        n.militaryPool = Math.max(0, n.militaryPool * (1 - e.fraction))
        break
      case 'armyAttrition':
        for (const a of armiesOf(s, nationId)) for (const k of UNIT_TYPES) a.units[k] *= 1 - e.fraction
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
        if (ev.rivalId) s.casusBelli[`${ev.rivalId}|${nationId}`] = s.turn + e.turns
        break
      case 'spawnRebels':
        if (region && region.owner === nationId) region.rebels += e.strength
        break
      case 'loseBuilding':
        if (region && region.buildings[e.building] > 0) region.buildings[e.building]--
        break
      case 'addBuilding':
        if (region && region.owner === nationId) region.buildings[e.building]++
        break
      case 'popLoss':
        if (region) region.population *= 1 - e.fraction
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
        if (ev.rivalId) delete s.casusBelli[`${ev.rivalId}|${nationId}`]
        break
      case 'embargo':
        n.embargoedUntil = Math.max(n.embargoedUntil ?? 0, s.turn + e.turns - 1)
        break
    }
  }
  addLog(s, 'event', `${def.title}: you chose "${option.label}".`, [nationId])
  s.pendingEvent = null
  return s
}
