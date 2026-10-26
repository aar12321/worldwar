import { TECH_BY_ID } from '../data/techTree'
import { BUILDING_SPECS, DRAFT_LIMITS, LAW_SPECS, PROPOSAL_LABELS, UNIT_SPECS, trainingRank } from '../data/unitTypes'
import { applyDeals, cancelDeal, declareWar, expireDiplomacy, leaveAlliance, propose, respond } from './diplomacy'
import { applyEconomy } from './economy'
import { runSpyMission } from './espionage'
import { EVENT_GAP_TURNS, scheduleEvent } from './events'
import { addLog, regionsOf } from './helpers'
import { orderCost, validateOrder } from './orders'
import { createRng } from './rng'
import { research } from './tech'
import { tickTraining, trainMonths } from './training'
import { UNIT_TYPES, type BattleReport, type GameState, type Order, type WorldMap } from './types'
import { checkOutcome } from './victory'
import { killNation, resolveAttack, resolveRebels } from './warfare'

export function describeOrder(s: GameState, map: WorldMap, o: Order): string {
  const region = (id: string) => map.regions[id]?.name ?? id
  const nation = (id: string) => s.nations[id]?.name ?? id
  switch (o.type) {
    case 'setPolicy':
      return `Set taxes ${Math.round(o.taxRate * 100)}% / draft ${Math.round(o.draftRate * 100)}%`
    case 'build':
      return `Upgrade ${BUILDING_SPECS[o.building].name} in ${region(o.regionId)}`
    case 'queueTrain':
      return `Train ${UNIT_SPECS[o.unit].name} (${trainMonths(o.unit)} mo)`
    case 'cancelTrain': {
      const job = s.trainingQueue?.find((item) => item.id === o.jobId)
      return `Cancel ${job ? UNIT_SPECS[job.unit].name : 'training'}`
    }
    case 'train':
      return `Drill ${UNIT_SPECS[o.unit].name}`
    case 'upgradeWeapons':
      return `Upgrade ${UNIT_SPECS[o.unit].name} weapons`
    case 'research':
      return `Research ${TECH_BY_ID[o.techId]?.name ?? o.techId}`
    case 'attack':
      return `Attack ${region(o.target)}`
    case 'assignGeneral': {
      if (!o.generalId) return 'Remove the commander'
      const name = s.nations[o.nationId]?.generals.find((g) => g.id === o.generalId)?.name
      return name ? `Appoint ${name} commander` : 'Appoint a commander'
    }
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
      return `Sabotage ${region(o.target)}`
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
  ['cancelTrain'],
  ['research', 'build', 'queueTrain', 'upgradeWeapons', 'suppressRebels', 'assignGeneral'],
  ['train'],
  ['spy'],
]

/**
 * Resolves one month. Pure: returns a new state and never mutates `prev`.
 * Month-end orders from every nation, and the AI's other orders, apply in fixed phases.
 * Then training, one attack per nation, rebels, the economy and diplomacy run.
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

  tickTraining(s)
  drillWithCommanders(s)

  // Each nation's one attack for the turn. The AI goes in a seeded order.
  for (const o of live) {
    if (o.type !== 'attack' || validateOrder(s, map, o)) continue
    resolveAttack(s, map, o.nationId, o.target, rng)
  }
  resolveRebels(s, map, rng)

  const alive = Object.values(s.nations)
    .filter((n) => n.alive)
    .map((n) => n.id)
    .sort()
  for (const id of alive) if (regionsOf(s, id).length === 0) killNation(s, id, null)
  for (const id of alive) if (s.nations[id].alive) applyEconomy(s, map, id, rng)
  applyDeals(s)

  s.turn++
  expireDiplomacy(s)
  const player = s.nations[s.playerId]
  if (player.alive && s.turn >= s.nextEventTurn) {
    s.pendingEvent = scheduleEvent(s, map, s.playerId, rng)
    s.nextEventTurn = s.turn + EVENT_GAP_TURNS
  }
  s.outcome = checkOutcome(s)
  return s
}

/**
 * Pays for one order and runs it at once. The player's building, training, weapons, war and attack orders go through here.
 * Mutates `s`; the caller passes a copy. An attack also returns its battle report.
 */
/** `pending` are month-end orders already queued: their costs are held back from what this order may spend. */
export function applyOrderNow(s: GameState, map: WorldMap, o: Order, pending: Order[] = []): { error: string | null; battle?: BattleReport } {
  const err = validateOrder(s, map, o, pending)
  if (err) return { error: err }
  const n = s.nations[o.nationId]
  const cost = orderCost(s, o)
  n.resources.capital -= cost.capital
  n.resources.pp -= cost.pp
  n.militaryPool -= cost.manpower
  const rng = createRng(s.seed, s.turn * 31 + s.nextId)
  if (o.type === 'attack') {
    const result = resolveAttack(s, map, o.nationId, o.target, rng)
    s.outcome = checkOutcome(s)
    return result ? { error: null, battle: result.report } : { error: 'The attack could not be made' }
  }
  executeOrder(s, map, o, rng)
  return { error: null }
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
      if (n.isPlayer) addLog(s, 'economy', `${BUILDING_SPECS[o.building].name} upgraded to level ${s.regions[o.regionId].buildings[o.building]} in ${map.regions[o.regionId].name}.`, [o.nationId])
      break
    case 'queueTrain': {
      const total = trainMonths(o.unit)
      s.trainingQueue ??= []
      s.trainingQueue.push({ id: `q${s.nextId++}`, nationId: o.nationId, unit: o.unit, remaining: total, total })
      break
    }
    case 'cancelTrain': {
      const index = (s.trainingQueue ?? []).findIndex((job) => job.id === o.jobId && job.nationId === o.nationId)
      if (index < 0) break
      const job = s.trainingQueue[index]
      const spec = UNIT_SPECS[job.unit]
      const refund = job.remaining === job.total ? 1 : 0.5
      n.resources.capital += spec.capitalCost * refund
      n.militaryPool += spec.manpowerCost * refund
      s.trainingQueue.splice(index, 1)
      if (n.isPlayer) addLog(s, 'info', `Cancelled ${spec.name} training. ${refund === 1 ? 'The full cost' : 'Half the cost'} was refunded.`, [o.nationId])
      break
    }
    case 'train':
      n.military.drill[o.unit] = Math.min(5, (n.military.drill[o.unit] ?? 0) + 1)
      if (n.isPlayer) addLog(s, 'info', `${UNIT_SPECS[o.unit].name} is now ${trainingRank(n.military.drill[o.unit])}.`, [o.nationId])
      break
    case 'upgradeWeapons':
      n.military.weapons[o.unit] = (n.military.weapons[o.unit] ?? 0) + 1
      if (n.isPlayer) addLog(s, 'economy', `${UNIT_SPECS[o.unit].name} weapons are now level ${n.military.weapons[o.unit]}.`, [o.nationId])
      break
    case 'suppressRebels': {
      const r = s.regions[o.regionId]
      r.rebels *= 0.5
      if (r.rebels < 0.2) r.rebels = 0
      addLog(s, 'event', `Security forces cracked down on the rebels in ${map.regions[o.regionId].name}.`, [o.nationId])
      break
    }
    case 'assignGeneral':
      n.military.commanderId = o.generalId
      break
    case 'spy':
      runSpyMission(s, map, o.nationId, o.target, o.mission, rng)
      break
    default:
      break
  }
}

/** A commander drills the least-trained unit type one rank each month, at no cost. */
function drillWithCommanders(s: GameState) {
  for (const n of Object.values(s.nations)) {
    if (!n.alive || !n.military.commanderId) continue
    const types = UNIT_TYPES.filter((k) => n.military.units[k] >= 0.05 && n.military.drill[k] < 5).sort((a, b) => n.military.drill[a] - n.military.drill[b])
    const k = types[0]
    if (!k) continue
    n.military.drill[k] += 1
    if (n.isPlayer) {
      const name = n.generals.find((g) => g.id === n.military.commanderId)?.name ?? 'Your commander'
      addLog(s, 'info', `${name} drilled the troops for free. ${UNIT_SPECS[k].name} is now ${trainingRank(n.military.drill[k])}.`, [n.id])
    }
  }
}
