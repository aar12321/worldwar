import { TECH_BY_ID } from '../data/techTree'
import { FOCUS } from '../data/cities'
import { JUSTIFY } from '../data/war'
import { ACTION_LABELS } from '../data/crises'
import { DOMESTIC_OPS, FOREIGN_OPS } from '../data/agencies'
import { fundAgency, runDomestic, runOperation } from './agencies'
import { INVEST, SECTORS } from '../data/business'
import { GOVERNMENTS, REFORM } from '../data/government'
import { addOpinion } from '../ai/opinion'
import { BUILDING_SPECS, DRAFT_LIMITS, LAW_SPECS, MARKET, PROPOSAL_LABELS, UNIT_SPECS, trainingRank } from '../data/unitTypes'
import { annexPuppet, applyDeals, cancelDeal, declareWar, expireDiplomacy, imposeSanctions, leaveAlliance, liftSanctions, propose, releasePuppet, respond } from './diplomacy'
import { addToSector, cleanInvestments, makeInvestment } from './business'
import { applyEconomy, nationWorkforce } from './economy'
import { runSpyMission } from './espionage'
import { EVENT_GAP_TURNS, scheduleEvent } from './events'
import { addLog, reach, regionsOf } from './helpers'
import { answerCrisis, runCrises } from './crises'
import { runJustification } from './justification'
import { orderCost, validateOrder } from './orders'
import { createRng } from './rng'
import { runPolitics } from './politics'
import { research } from './tech'
import { marketPrices, marketValue } from './trade'
import { tickTraining, trainMonths } from './training'
import { UNIT_TYPES, type BattleReport, type GameState, type Order, type WorldMap } from './types'
import { checkOutcome, worldGross } from './victory'
import { killNation, resolveAttack, resolveRebels } from './warfare'

export function describeOrder(s: GameState, map: WorldMap, o: Order): string {
  const region = (id: string) => map.regions[id]?.name ?? id
  const nation = (id: string) => s.nations[id]?.name ?? id
  switch (o.type) {
    case 'setPolicy':
      return `Set taxes ${Math.round(o.taxRate * 100)}% / draft ${Math.round(o.draftRate * 100)}%${o.corporateTax !== undefined ? ` / business tax ${Math.round(o.corporateTax * 100)}%` : ''}${o.budget ? ' / new budget' : ''}`
    case 'developCity': {
      const city = s.regions[o.regionId]?.cities.find((c) => c.id === o.cityId)
      return `Develop ${city?.name ?? 'a city'}`
    }
    case 'setCityFocus': {
      const city = s.regions[o.regionId]?.cities.find((c) => c.id === o.cityId)
      return `Make ${city?.name ?? 'a city'} a ${FOCUS[o.focus].name.toLowerCase()} city`
    }
    case 'imposeSanctions':
      return `Sanction ${nation(o.target)}`
    case 'liftSanctions':
      return `Lift sanctions on ${nation(o.target)}`
    case 'releasePuppet':
      return `Set ${nation(o.target)} free`
    case 'fundSector':
      return `Fund ${SECTORS[o.sector].name.toLowerCase()} with ${Math.round(o.amount)}`
    case 'setSubsidies':
      return 'Change the subsidies'
    case 'issueBonds':
      return `Issue ${Math.round(o.amount)} in bonds`
    case 'repayDebt':
      return `Repay ${Math.round(o.amount)} of debt`
    case 'invest':
      return `Invest ${Math.round(o.amount)} in ${nation(o.target)}'s ${SECTORS[o.sector].name.toLowerCase()}`
    case 'setGovernment':
      return `Change the government to ${GOVERNMENTS[o.government].name}`
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
    case 'marketBuy':
      return `Buy ${Math.round(o.amount)} ${MARKET[o.resource].name.toLowerCase()}`
    case 'marketSell':
      return `Sell ${Math.round(o.amount)} ${MARKET[o.resource].name.toLowerCase()}`
    case 'setAutoBuy':
      return 'Change what is bought automatically'
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
    case 'buildCase':
      return `Build a case against ${nation(o.target)}`
    case 'annexPuppet':
      return `Annex ${nation(o.target)}`
    case 'operation':
      return `${FOREIGN_OPS[o.op].name}: ${nation(o.target)}`
    case 'domestic':
      return DOMESTIC_OPS[o.op].name
    case 'fundAgency':
      return `Grow the ${o.agency === 'foreign' ? 'foreign' : 'domestic'} agency`
    case 'crisisAction':
      return `${ACTION_LABELS[o.action]}: ${s.nations[s.crises.find((c) => c.id === o.crisisId)?.nation ?? '']?.name ?? 'a crisis'}`
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
  ['setPolicy', 'setGovernment', 'enactLaw', 'repealLaw'],
  ['cancelDeal', 'leaveAlliance'],
  ['declareWar', 'buildCase', 'annexPuppet', 'crisisAction', 'propose'],
  ['cancelTrain'],
  ['setAutoBuy', 'setSubsidies', 'marketSell', 'marketBuy'],
  ['issueBonds', 'repayDebt', 'fundSector', 'invest', 'developCity', 'setCityFocus', 'imposeSanctions', 'liftSanctions', 'releasePuppet'],
  ['research', 'build', 'queueTrain', 'upgradeWeapons', 'suppressRebels', 'assignGeneral'],
  ['train'],
  ['fundAgency'],
  ['spy', 'operation', 'domestic'],
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
      n.resources.steel -= cost.steel
      executeOrder(s, map, o, rng)
    }
  }

  tickTraining(s)
  drillWithCommanders(s)

  // Each nation's one attack for the turn. The AI goes in a seeded order.
  for (const o of live) {
    if (o.type !== 'attack' || validateOrder(s, map, o)) continue
    resolveAttack(s, map, o.nationId, o.target, rng, o.commit, o.stance)
  }
  resolveRebels(s, map, rng)
  // Armies that fought this turn are back at their posts for the next one.
  for (const n of Object.values(s.nations)) n.military.exposed = 0

  const alive = Object.values(s.nations)
    .filter((n) => n.alive)
    .map((n) => n.id)
    .sort()
  for (const id of alive) if (regionsOf(s, id).length === 0) killNation(s, id, null)
  cleanInvestments(s)
  const prices = marketPrices(s)
  for (const id of alive) if (s.nations[id].alive) applyEconomy(s, map, id, rng, prices)
  applyDeals(s)
  runPolitics(s, map, rng)
  runJustification(s, map, rng)
  runCrises(s, map, rng)

  s.turn++
  expireDiplomacy(s)
  // Surprise decisions are for single-player games. Online, everyone plans the same month, with no interruptions.
  const player = s.nations[s.humans[0] ?? s.playerId]
  if (s.humans.length === 1 && player?.alive && s.turn >= s.nextEventTurn) {
    s.pendingEvent = scheduleEvent(s, map, player.id, rng)
    s.nextEventTurn = s.turn + EVENT_GAP_TURNS
  }
  s.worldGross = worldGross(s, map)
  s.outcome = checkOutcome(s, map)
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
  n.resources.steel -= cost.steel
  const rng = createRng(s.seed, s.turn * 31 + s.nextId)
  if (o.type === 'attack') {
    const result = resolveAttack(s, map, o.nationId, o.target, rng, o.commit, o.stance)
    s.outcome = checkOutcome(s, map)
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
      if (o.corporateTax !== undefined) n.corporateTax = o.corporateTax
      if (o.budget) n.budget = { ...o.budget }
      break
    case 'developCity': {
      const city = s.regions[o.regionId].cities.find((c) => c.id === o.cityId)
      if (city) {
        city.level++
        if (n.isPlayer) addLog(s, 'economy', `${city.name} grew to level ${city.level}.`, [o.nationId])
      }
      break
    }
    case 'setCityFocus': {
      const city = s.regions[o.regionId].cities.find((c) => c.id === o.cityId)
      if (city) city.focus = o.focus
      break
    }
    case 'imposeSanctions':
      imposeSanctions(s, o.nationId, o.target)
      break
    case 'liftSanctions':
      liftSanctions(s, o.nationId, o.target)
      break
    case 'releasePuppet':
      releasePuppet(s, o.nationId, o.target)
      break
    case 'fundSector':
      addToSector(n, o.sector, o.amount, nationWorkforce(s, map, o.nationId))
      break
    case 'setSubsidies':
      n.subsidies = [...new Set(o.sectors)]
      break
    case 'issueBonds':
      n.resources.capital += o.amount
      n.debt += o.amount
      break
    case 'repayDebt':
      n.debt = Math.max(0, n.debt - o.amount)
      break
    case 'invest': {
      const target = s.nations[o.target]
      addToSector(target, o.sector, o.amount, nationWorkforce(s, map, o.target), INVEST.efficiency)
      makeInvestment(s, o.nationId, o.target, o.sector, o.amount)
      addOpinion(s, o.target, o.nationId, 'Invested in our businesses', 12, 0.2)
      if (n.isPlayer) addLog(s, 'economy', `You invested ${Math.round(o.amount)} in ${target.name}'s ${SECTORS[o.sector].name.toLowerCase()}. It pays dividends while you stay at peace.`, [o.nationId, o.target])
      break
    }
    case 'setGovernment':
      n.government = o.government
      n.stability = Math.max(0, n.stability - REFORM.turmoil)
      n.lastReform = s.turn
      n.nextElection = GOVERNMENTS[o.government].election > 0 ? s.turn + GOVERNMENTS[o.government].election : 0
      addLog(s, 'event', `${n.name} is now a ${GOVERNMENTS[o.government].name.toLowerCase()}.`, [o.nationId])
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
      reach(n, 'war')
      break
    case 'annexPuppet':
      annexPuppet(s, map, o.nationId, o.target)
      break
    case 'crisisAction':
      answerCrisis(s, o.nationId, o.crisisId, o.action)
      break
    case 'buildCase':
      s.cases.push({ holder: o.nationId, target: o.target, ready: s.turn + JUSTIFY.caseMonths })
      if (n.isPlayer) addLog(s, 'diplomacy', `Your diplomats and lawyers begin building a case against ${s.nations[o.target].name}. It will be ready in ${JUSTIFY.caseMonths} months.`, [o.nationId])
      break
    case 'propose':
      propose(s, map, o.nationId, o.target, o.proposal, rng)
      break
    case 'research':
      if (research(s, o.nationId, o.techId)) reach(n, 'research')
      break
    case 'marketBuy':
      n.resources[o.resource as 'food'] += o.amount
      n.tradeUsed += o.amount
      break
    case 'marketSell':
      n.resources[o.resource as 'food'] -= o.amount
      n.resources.capital += marketValue(s, n, o.resource, o.amount, 'sell')
      n.tradeUsed += o.amount
      break
    case 'setAutoBuy':
      n.autoBuy = [...new Set(o.resources)]
      break
    case 'build':
      s.regions[o.regionId].buildings[o.building]++
      reach(n, 'build')
      if (n.isPlayer) addLog(s, 'economy', `${BUILDING_SPECS[o.building].name} upgraded to level ${s.regions[o.regionId].buildings[o.building]} in ${map.regions[o.regionId].name}.`, [o.nationId])
      break
    case 'queueTrain': {
      const total = trainMonths(o.unit)
      s.trainingQueue ??= []
      s.trainingQueue.push({ id: `q${s.nextId++}`, nationId: o.nationId, unit: o.unit, remaining: total, total })
      reach(n, 'train')
      break
    }
    case 'cancelTrain': {
      const index = (s.trainingQueue ?? []).findIndex((job) => job.id === o.jobId && job.nationId === o.nationId)
      if (index < 0) break
      const job = s.trainingQueue[index]
      const spec = UNIT_SPECS[job.unit]
      const refund = job.remaining === job.total ? 1 : 0.5
      n.resources.steel += spec.steel * refund
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
    case 'operation':
      runOperation(s, map, o.nationId, o.op, o.target, rng)
      break
    case 'domestic':
      runDomestic(s, o.nationId, o.op, o.regionId)
      break
    case 'fundAgency':
      fundAgency(s, o.nationId, o.agency)
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
