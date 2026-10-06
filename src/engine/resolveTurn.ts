import { TECH_BY_ID } from '../data/techTree'
import { BUILDING_SPECS, DRAFT_LIMITS, LAW_SPECS, PROPOSAL_LABELS, UNIT_SPECS } from '../data/unitTypes'
import { applyDeals, cancelDeal, declareWar, expireDiplomacy, leaveAlliance, propose, respond } from './diplomacy'
import { applyEconomy } from './economy'
import { runSpyMission } from './espionage'
import { scheduleEvent } from './events'
import { addLog, armiesIn, armiesOf, newId, regionsOf } from './helpers'
import { orderCost, validateOrder } from './orders'
import { createRng } from './rng'
import { applySupply } from './supply'
import { research } from './tech'
import type { Army, GameState, Order, WorldMap } from './types'
import { checkOutcome } from './victory'
import { killNation, resolveAttacks, resolveMoves, resolveRebels } from './warfare'

export function describeOrder(s: GameState, map: WorldMap, o: Order): string {
  const region = (id: string) => map.regions[id]?.name ?? id
  const nation = (id: string) => s.nations[id]?.name ?? id
  switch (o.type) {
    case 'setPolicy':
      return `Set taxes ${Math.round(o.taxRate * 100)}% / draft ${Math.round(o.draftRate * 100)}%`
    case 'build':
      return `Build ${BUILDING_SPECS[o.building].name} in ${region(o.regionId)}`
    case 'recruit':
      return `Recruit ${UNIT_SPECS[o.unit].name} in ${region(o.regionId)}`
    case 'research':
      return `Research ${TECH_BY_ID[o.techId]?.name ?? o.techId}`
    case 'move':
      return `Move army to ${region(o.to)}`
    case 'attack':
      return `Attack ${region(o.target)}`
    case 'assignGeneral':
      return o.generalId ? 'Assign general' : 'Unassign general'
    case 'declareWar':
      return `Declare war on ${nation(o.target)}`
    case 'propose':
      return o.proposal.kind === 'callToArms'
        ? `Call ${nation(o.target)} to arms against ${nation(o.proposal.enemy)}`
        : `Propose ${PROPOSAL_LABELS[o.proposal.kind].toLowerCase()} to ${nation(o.target)}`
    case 'respond': {
      const p = s.proposals.find((x) => x.id === o.proposalId)
      const what = p ? `${PROPOSAL_LABELS[p.kind].toLowerCase()} from ${nation(p.from)}` : 'proposal'
      return `${o.accept ? 'Accept' : 'Decline'} ${what}`
    }
    case 'cancelDeal':
      return 'Cancel deal'
    case 'leaveAlliance':
      return `Leave alliance with ${nation(o.target)}`
    case 'spy':
      return `${o.mission === 'sabotage' ? 'Sabotage' : 'Steal maps of'} ${region(o.target)}`
    case 'enactLaw':
      return `Enact ${LAW_SPECS[o.law].name}`
    case 'repealLaw':
      return `Repeal ${LAW_SPECS[o.law].name}`
    case 'suppressRebels':
      return `Suppress rebels in ${region(o.regionId)}`
  }
}

const PHASES: Order['type'][][] = [
  ['respond'],
  ['setPolicy', 'enactLaw', 'repealLaw'],
  ['cancelDeal', 'leaveAlliance'],
  ['declareWar', 'propose'],
  ['research', 'build', 'recruit', 'suppressRebels', 'assignGeneral'],
  ['spy'],
]

/**
 * Resolves one month. Pure: returns a new state and never mutates `prev`.
 * All nations' orders are applied simultaneously in fixed phases, then combat, supply, and economy run.
 */
export function resolveTurn(prev: GameState, map: WorldMap, orders: Order[]): GameState {
  if (prev.outcome !== 'playing' || prev.pendingEvent) return prev
  const s = structuredClone(prev)
  const rng = createRng(s.seed, s.turn)
  s.battles = []
  s.dispatches = []
  const live = orders.filter((o) => s.nations[o.nationId]?.alive)

  for (const phase of PHASES) {
    for (const o of live) {
      if (!phase.includes(o.type)) continue
      const err = validateOrder(s, map, o)
      if (err) {
        if (s.nations[o.nationId].isPlayer) addLog(s, 'info', `Order failed: ${describeOrder(s, map, o)} (${err}).`, [o.nationId])
        continue
      }
      const n = s.nations[o.nationId]
      const cost = orderCost(s, o)
      n.resources.capital -= cost.capital
      n.resources.pp -= cost.pp
      n.militaryPool -= cost.manpower
      executeOrder(s, map, o, rng)
    }
  }

  const acted = new Set<string>()
  resolveMoves(s, map, live, acted)
  resolveAttacks(s, map, live, rng, acted)
  resolveRebels(s, map, rng)
  for (const a of Object.values(s.armies)) a.entrenched = acted.has(a.id) ? 0 : Math.min(3, (a.entrenched ?? 0) + 1)

  const alive = Object.values(s.nations)
    .filter((n) => n.alive)
    .map((n) => n.id)
    .sort()
  for (const id of alive) if (regionsOf(s, id).length === 0) killNation(s, id, null)
  for (const id of alive) if (s.nations[id].alive) applySupply(s, map, id)
  for (const id of alive) if (s.nations[id].alive) applyEconomy(s, map, id, rng)
  applyDeals(s)

  s.turn++
  expireDiplomacy(s)
  const player = s.nations[s.playerId]
  if (player.alive && s.turn >= s.nextEventTurn) {
    s.pendingEvent = scheduleEvent(s, map, s.playerId, rng)
    s.nextEventTurn = s.turn + rng.int(2, 4)
  }
  s.outcome = checkOutcome(s)
  return s
}

function executeOrder(s: GameState, map: WorldMap, o: Order, rng: ReturnType<typeof createRng>) {
  const n = s.nations[o.nationId]
  switch (o.type) {
    case 'respond':
      respond(s, map, o.nationId, o.proposalId, o.accept, rng)
      break
    case 'cancelDeal':
      cancelDeal(s, o.nationId, o.dealId)
      break
    case 'leaveAlliance':
      leaveAlliance(s, o.nationId, o.target)
      break
    case 'setPolicy':
      n.taxRate = o.taxRate
      n.draftRate = o.draftRate
      break
    case 'enactLaw':
      n.laws.push(o.law)
      addLog(s, 'info', `${n.name} enacted ${LAW_SPECS[o.law].name}.`, [o.nationId])
      break
    case 'repealLaw':
      n.laws = n.laws.filter((l) => l !== o.law)
      if (o.law === 'conscription_act') n.draftRate = Math.min(n.draftRate, DRAFT_LIMITS.max)
      break
    case 'declareWar':
      declareWar(s, map, o.nationId, o.target, rng)
      break
    case 'propose':
      propose(s, map, o.nationId, o.target, o.proposal, rng)
      break
    case 'research':
      research(s, o.nationId, o.techId)
      break
    case 'build':
      s.regions[o.regionId].buildings[o.building]++
      if (n.isPlayer) addLog(s, 'economy', `Construction complete: ${BUILDING_SPECS[o.building].name} in ${map.regions[o.regionId].name}.`, [o.nationId])
      break
    case 'recruit': {
      const existing = armiesIn(s, o.regionId, o.nationId)
      let army: Army | undefined = existing[0]
      if (!army) {
        army = { id: newId(s, 'a'), owner: o.nationId, location: o.regionId, units: { infantry: 0, armor: 0, air: 0, naval: 0 }, generalId: null, outOfSupplyTurns: 0, entrenched: 0 }
        s.armies[army.id] = army
      }
      army.units[o.unit] += 1
      break
    }
    case 'suppressRebels': {
      const r = s.regions[o.regionId]
      r.rebels *= 0.5
      if (r.rebels < 0.2) r.rebels = 0
      addLog(s, 'event', `Security forces cracked down on the rebels in ${map.regions[o.regionId].name}.`, [o.nationId])
      break
    }
    case 'assignGeneral':
      for (const a of armiesOf(s, o.nationId)) if (o.generalId && a.generalId === o.generalId) a.generalId = null
      s.armies[o.armyId].generalId = o.generalId
      break
    case 'spy':
      runSpyMission(s, map, o.nationId, o.target, o.mission, rng)
      break
    default:
      break
  }
}
