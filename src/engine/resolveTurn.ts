import { TECH_BY_ID } from '../data/techTree'
import { DIRECTIVES } from '../data/companies'
import { FOCUS } from '../data/cities'
import { JUSTIFY } from '../data/war'
import { ACTION_LABELS } from '../data/crises'
import { DOMESTIC_OPS, FOREIGN_OPS } from '../data/agencies'
import { fundAgency, runDomestic, runOperation } from './agencies'
import { GOVERNOR_LABELS, governorOrders } from './governors'
import { buyShares, runStocks, sellShares, setDirective } from './stocks'
import { SYSTEM_SPECS } from '../data/systems'
import { fundSystem, runStrike, runSystems } from './systems'
import { MISSILES } from '../data/missiles'
import { AIRCRAFT_NODES } from '../data/aircraft'
import { applyPauseAircraftDev, applyStartAircraftDev } from './aircraft'
import { applyBuildMissiles, applyFundMissiles } from './missiles'
import { applyBuildWarhead, fireNuke, launchNuke, runNuclear } from './nuclear'
import { runCoalitions } from './coalition'
import { applySpace, describeSpace, runSpaceWorld } from './space'
import { applyDeployment, runDeployment } from './deployment'
import { applySetBorder } from './borders'
import { INVEST, SECTORS } from '../data/business'
import { GOVERNMENTS, REFORM } from '../data/government'
import { addOpinion } from '../ai/opinion'
import { BUILDING_SPECS, DRAFT_LIMITS, LAW_SPECS, MARKET, PROPOSAL_LABELS, UNIT_SPECS, trainingRank } from '../data/unitTypes'
import { annexPuppet, applyDeals, breakPact, cancelDeal, declareWar, expireDiplomacy, imposeSanctions, leaveAlliance, liftSanctions, propose, releasePuppet, respond } from './diplomacy'
import { addToSector, cleanInvestments, makeInvestment } from './business'
import { applyEconomy, computeEconomy, nationWorkforce } from './economy'
import { BANKING } from '../data/banking'
import { EMPIRE_RULES, OCCUPATION, RESOLUTIONS } from '../data/empire'
import { FOCUSES, IMMIGRATION, STAGES } from '../data/people'
import { PROJECTS, RESEARCH_PROGRAMS, programCost } from '../data/projects'
import { issueBond, moveFund, newBondRate, printMoney, repayBonds } from './bank'
import { runResolution } from './council'
import { setStateOwned, startProject } from './industry'
import { LOCAL, isLocalProject } from '../data/localProjects'
import { applyRush, startLocal } from './works'
import { cleanSpending } from './people'
import { recordHistory, runWorld, spendingFromBudget } from './statecraft'
import { runEpidemics } from './epidemics'
import { updateTiers } from './empire'
import { nationNeighborMap } from './helpers'
import { EVENT_BY_ID } from '../data/events'
import { CAMPAIGNS, LEVEL_NAMES, SOCIAL } from '../data/society'
import { applyCampaign, applySocial } from './society'
import { EVENT_GAP_TURNS, resolveEvent, scheduleEvent, scheduleHumanEvents, settleUnanswered } from './events'
import { addLog, forceUnits, reach, regionsOf } from './helpers'
import { clockOf, isLive } from './calendar'
import { launchArmy, launchStrike, turnBack } from './armies'
import { answerCrisis, runCrises } from './crises'
import { runJustification } from './justification'
import { describeGift, executeFactionOrder, factionOf, isFactionOrder, resolveFactionVotes, runFactionCampaigns, runFactionMonth } from './factions'
import { orderCost, validateOrder } from './orders'
import { createRng } from './rng'
import { runPolitics } from './politics'
import { research } from './tech'
import { fadeMarket, marketPrices, marketValue, pushMarket } from './trade'
import { tickTraining, trainMonths } from './training'
import { UNIT_TYPES, type Army, type AttackOrder, type BattleReport, type GameState, type Order, type TrainingJob, type WorldMap } from './types'
import { checkOutcome, worldGross } from './victory'
import { killNation, resolveAttack, resolveRebels } from './warfare'

/** A project's name, whether it is a nation's or a country's. */
const projectName = (id: string) => (isLocalProject(id) ? LOCAL[id].name : PROJECTS[id as keyof typeof PROJECTS].name)

export function describeOrder(s: GameState, map: WorldMap, o: Order): string {
  const region = (id: string) => map.regions[id]?.name ?? id
  const nation = (id: string) => s.nations[id]?.name ?? id
  switch (o.type) {
    case 'setPolicy':
      return `Set taxes ${Math.round(o.taxRate * 100)}% / draft ${Math.round(o.draftRate * 100)}%${o.corporateTax !== undefined ? ` / business tax ${Math.round(o.corporateTax * 100)}%` : ''}${o.spending || o.budget ? ' / new spending' : ''}`
    case 'setPrograms': {
      const parts: string[] = []
      if (o.rate !== undefined) parts.push(`interest rate ${o.rate}%`)
      if (o.programs.stage) parts.push(`${STAGES[o.programs.stage].name.toLowerCase()} schools`)
      if (o.programs.focus) parts.push(`${FOCUSES[o.programs.focus].name.toLowerCase()} focus`)
      if (o.programs.immigration) parts.push(`${IMMIGRATION[o.programs.immigration].name.toLowerCase()} immigration`)
      if (o.programs.occupation) parts.push(`${OCCUPATION[o.programs.occupation].name.toLowerCase()} occupation`)
      if (o.programs.armsExports) parts.push(o.programs.armsExports === 'off' ? 'no arms exports' : `arms exports to ${o.programs.armsExports}`)
      if (o.programs.quarantine !== undefined) parts.push(o.programs.quarantine ? 'quarantine' : 'end quarantine')
      if (o.programs.creditSector !== undefined) parts.push(o.programs.creditSector ? `credit to ${SECTORS[o.programs.creditSector].name.toLowerCase()}` : 'end directed credit')
      return parts.length ? `Set ${parts.join(', ')}` : 'Change programs'
    }
    case 'printMoney':
      return `Print money (${Math.round(o.share * 100)}% of a month's income)`
    case 'wealthFund':
      return o.amount > 0 ? `Put ${Math.round(o.amount)} in the wealth fund` : `Take ${Math.round(-o.amount)} from the wealth fund`
    case 'setStateOwned':
      return `${o.mode === 'buy' ? 'Buy' : o.mode === 'seize' ? 'Seize' : 'Sell'} the ${SECTORS[o.sector].name.toLowerCase()} business`
    case 'startProject':
      return `Start the ${projectName(o.project).toLowerCase()}${o.regionId ? ` in ${region(o.regionId)}` : ''}`
    case 'pauseProject':
      return `${o.paused ? 'Pause' : 'Resume'} the ${projectName(o.project).toLowerCase()}${o.regionId ? ` in ${region(o.regionId)}` : ''}`
    case 'rushProject':
      return `Rush the ${projectName(o.project).toLowerCase()}${o.regionId ? ` in ${region(o.regionId)}` : ''}`
    case 'moveCapital':
      return `Move the capital to ${region(o.regionId)}`
    case 'setRegionalCapital':
      return o.on ? `Make ${region(o.regionId)} a regional capital` : `${region(o.regionId)} is no longer a regional capital`
    case 'fundAcademy':
      return 'Expand the military academy'
    case 'researchProgram':
      return `Research program: ${RESEARCH_PROGRAMS[o.track].name}`
    case 'resolution':
      return `Put ${RESOLUTIONS[o.kind].name.toLowerCase()} to the World Council${o.target ? ` (${nation(o.target)}${o.target2 ? `, ${nation(o.target2)}` : ''})` : ''}`
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
      return o.war ? `Sell ${Math.round(o.amount)} in war bonds` : `Issue ${Math.round(o.amount)} in bonds${o.term ? ` for ${o.term} months` : ''}`
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
    case 'buyShares':
      return `Buy ${o.shares} shares of ${s.stocks.meta[o.company]?.name ?? o.company}`
    case 'sellShares':
      return `Sell ${o.shares} shares of ${s.stocks.meta[o.company]?.name ?? o.company}`
    case 'setDirective':
      return `Tell ${s.stocks.meta[o.company]?.name ?? o.company}: ${DIRECTIVES[o.directive]?.name ?? o.directive}`
    case 'fundSystem':
      return `Raise ${SYSTEM_SPECS[o.system].name}${(o.levels ?? 1) > 1 ? ` by ${o.levels} levels` : ''}`
    case 'recall': {
      const a = s.armies?.find((x) => x.id === o.armyId)
      return a ? `Recall the army marching on ${region(a.target)}` : 'Recall an army'
    }
    case 'strike':
      return o.weapon === 'orbital' ? `Orbital strike on ${region(o.target)}` : `Fire ${o.count ?? 1} ${MISSILES[o.kind ?? 'hypersonic'].name.toLowerCase()}${(o.count ?? 1) === 1 ? '' : 's'} at ${region(o.target)}`
    case 'buildWarhead':
      return 'Build a nuclear warhead'
    case 'nuke':
      return `Launch a nuclear missile at ${region(o.target)}`
    case 'space':
      return describeSpace(o.action)
    case 'setDeployment':
      return 'Post forces on station'
    case 'setBorder':
      return `${o.closed ? 'Close' : 'Reopen'} the border with ${nation(o.neighbor)}`
    case 'fundMissiles':
      return 'Raise the missile program'
    case 'buildMissiles':
      return `Build ${o.count} ${MISSILES[o.kind].name.toLowerCase()}${o.count === 1 ? '' : 's'}`
    case 'startAircraftDev':
      return `Develop ${AIRCRAFT_NODES[o.node]?.name.toLowerCase() ?? 'aircraft'}`
    case 'pauseAircraftDev':
      return `${o.paused ? 'Pause' : 'Resume'} developing ${AIRCRAFT_NODES[o.node]?.name.toLowerCase() ?? 'aircraft'}`
    case 'setGovernor':
      return `Governor of ${region(o.regionId)}: ${GOVERNOR_LABELS[o.governor]}`
    case 'fundAgency':
      return `Grow the ${o.agency === 'foreign' ? 'foreign' : 'domestic'} agency${(o.levels ?? 1) > 1 ? ` by ${o.levels} levels` : ''}`
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
    case 'breakPact':
      return `Break the pact with ${nation(o.target)}`
    case 'enactLaw':
      return `Enact ${LAW_SPECS[o.law].name}`
    case 'repealLaw':
      return `Repeal ${LAW_SPECS[o.law].name}`
    case 'setSocial':
      return `${SOCIAL[o.policy]?.name ?? 'Program'}: ${LEVEL_NAMES[o.level] ?? o.level}`
    case 'campaign':
      return `Run a ${CAMPAIGNS[o.campaign]?.name.toLowerCase() ?? 'campaign'}`
    case 'suppressRebels':
      return `Suppress rebels in ${region(o.regionId)}`
    case 'eventChoice': {
      const ev = s.pendingEvents?.[o.nationId]
      const def = ev ? EVENT_BY_ID[ev.eventId] : null
      return def ? `Decide: ${def.title} (${def.options[o.index]?.label ?? 'option'})` : 'Answer a decision'
    }
    case 'factionFound':
      return `Found the faction ${o.name}`
    case 'factionJoin':
      return `Join ${s.factions?.find((f) => f.id === o.factionId)?.name ?? 'a faction'}`
    case 'factionInvite':
      return `Invite ${nation(o.target)} to the faction`
    case 'factionLeave':
      return `Leave ${factionOf(s, o.nationId)?.name ?? 'the faction'}`
    case 'factionContribute':
      return `Put ${describeGift(o.gift)} into the pool`
    case 'factionWithdraw':
      return `Take ${describeGift(o.gift)} out of the pool`
    case 'factionPropose':
      return o.proposal.kind === 'war' ? `Propose war on ${nation(o.proposal.target)} to the faction` : 'Propose a supply contract to the faction'
    case 'factionVote': {
      const p = factionOf(s, o.nationId)?.proposals.find((x) => x.id === o.proposalId)
      return `Vote ${o.vote} on ${p ? (p.kind === 'war' ? `war on ${nation(p.target!)}` : 'a contract') : 'a proposal'}`
    }
  }
}

const PHASES: Order['type'][][] = [
  ['eventChoice'],
  ['respond'],
  ['setPolicy', 'setPrograms', 'setGovernment', 'enactLaw', 'repealLaw', 'setSocial', 'campaign', 'setGovernor', 'setDirective', 'moveCapital', 'setDeployment', 'setBorder'],
  ['cancelDeal', 'leaveAlliance', 'breakPact'],
  ['factionFound', 'factionJoin', 'factionInvite'],
  ['factionLeave'],
  ['factionContribute', 'factionWithdraw'],
  ['factionPropose'],
  ['factionVote'],
  ['declareWar', 'buildCase', 'annexPuppet', 'crisisAction', 'propose', 'resolution'],
  ['cancelTrain'],
  ['setAutoBuy', 'setSubsidies', 'marketSell', 'marketBuy', 'sellShares', 'buyShares'],
  ['issueBonds', 'repayDebt', 'printMoney', 'wealthFund', 'setStateOwned', 'fundSector', 'invest', 'developCity', 'setCityFocus', 'imposeSanctions', 'liftSanctions', 'releasePuppet'],
  ['research', 'researchProgram', 'build', 'startProject', 'pauseProject', 'rushProject', 'setRegionalCapital', 'fundAcademy', 'queueTrain', 'upgradeWeapons', 'suppressRebels', 'assignGeneral'],
  ['train'],
  ['fundAgency', 'fundSystem'],
  ['fundMissiles', 'buildMissiles', 'buildWarhead', 'startAircraftDev', 'pauseAircraftDev'],
  ['space'],
  ['operation', 'domestic', 'strike', 'nuke'],
]

/**
 * Resolves one month. Pure: returns a new state and never mutates `prev`.
 * Month-end orders from every nation, and the AI's other orders, apply in fixed phases.
 * Then training, one attack per nation, rebels, the economy and diplomacy run.
 */
export function resolveTurn(prev: GameState, map: WorldMap, orders: Order[]): GameState {
  if (prev.outcome !== 'playing' || prev.pendingEvent) return prev
  const s = structuredClone(prev)
  runMonth(s, map, orders)
  return s
}

export interface MonthResult {
  /** Live mode: the attacks the month's orders asked for. They are not fought here; the clock sends them out as armies. */
  attacks: AttackOrder[]
  /** Training that finished this month. */
  trained: TrainingJob[]
}

/**
 * The month's work on a state the caller owns (it mutates `s`): orders in phases, training, the economy, politics, the end of
 * the month. In a turn game attacks are fought here. In a live game they are handed back, because armies march and fight on
 * their own days.
 */
export function runMonth(s: GameState, map: WorldMap, orders: Order[]): MonthResult {
  const rng = createRng(s.seed, s.turn)
  const attacks: AttackOrder[] = []
  s.battles = []
  s.dispatches = []
  // A player's governors add their own upgrades to the month's orders.
  const all = [...orders, ...governorOrders(s, map)].filter((o) => s.nations[o.nationId]?.alive)

  for (const phase of PHASES) {
    for (const o of all) {
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

  // Factions: votes that have settled are carried out, so a joint war is on before the month's attacks.
  resolveFactionVotes(s, map, rng)
  // Online, a decision nobody answered is made by the nation's ministers, so no month ever waits on one.
  settleUnanswered(s, map)

  const trained = tickTraining(s)
  drillWithCommanders(s)

  // Each nation's one attack for the turn. The AI goes in a seeded order.
  const marching = isLive(s)
  for (const o of all) {
    if (o.type !== 'attack') continue
    if (marching) {
      attacks.push(o)
      continue
    }
    if (validateOrder(s, map, o)) continue
    resolveAttack(s, map, o.nationId, o.target, rng, o.commit, o.stance, o.missiles, undefined, o.share)
  }
  // The pooled armies of factions at war attack as one.
  runFactionCampaigns(s, map, rng)
  resolveRebels(s, map, rng)
  // Armies that fought this turn are back at their posts for the next one.
  for (const n of Object.values(s.nations)) n.military.exposed = 0

  const alive = Object.values(s.nations)
    .filter((n) => n.alive)
    .map((n) => n.id)
    .sort()
  for (const id of alive) if (regionsOf(s, id).length === 0) killNation(s, id, null)
  cleanInvestments(s)
  fadeMarket(s)
  const prices = marketPrices(s)
  // The economy, and with it each nation's people, bank and projects. What it earns feeds the world's numbers below.
  const gross = new Map<string, number>()
  const net = new Map<string, number>()
  const workforce = new Map<string, number>()
  const doctors = new Map<string, number>()
  for (const id of alive) {
    if (!s.nations[id].alive) continue
    const e = applyEconomy(s, map, id, rng, prices)
    gross.set(id, e.gross)
    net.set(id, e.netCapital)
    workforce.set(id, e.workforce)
    doctors.set(id, e.coverage.doctors)
  }
  applyDeals(s, map, rng)
  runFactionMonth(s)
  runPolitics(s, map, rng)
  runEpidemics(s, map, nationNeighborMap(s, map), doctors)
  runDeployment(s, map)
  runJustification(s, map, rng)
  runCrises(s, map, rng)
  runStocks(s, map, rng)
  runSystems(s)
  runNuclear(s)
  runCoalitions(s, map, rng)
  runSpaceWorld(s)
  runWorld(s, gross, workforce)
  updateTiers(s)
  recordHistory(s, gross, net)

  s.turn++
  // A live clock reads the 1st of the new month from here on, so the news below carries the right date.
  if (isLive(s)) s.day = 0
  expireDiplomacy(s)
  // Surprise decisions. A one-player game stops for its player. Online, each human gets their own and the month never waits.
  if (s.multiplayer) {
    if (s.turn >= s.nextEventTurn) scheduleHumanEvents(s, map, rng)
  } else {
    const player = s.nations[s.humans[0] ?? s.playerId]
    if (s.humans.length === 1 && player?.alive && s.turn >= s.nextEventTurn) {
      s.pendingEvent = scheduleEvent(s, map, player.id, rng)
      s.nextEventTurn = s.turn + EVENT_GAP_TURNS
    }
  }
  s.worldGross = worldGross(s, map)
  s.outcome = checkOutcome(s, map)
  return { attacks, trained }
}

/**
 * Pays for one order and runs it at once. The player's building, training, weapons, war and attack orders go through here.
 * Mutates `s`; the caller passes a copy. An attack also returns its battle report.
 */
/** `pending` are month-end orders already queued: their costs are held back from what this order may spend. */
export function applyOrderNow(s: GameState, map: WorldMap, o: Order, pending: Order[] = []): { error: string | null; battle?: BattleReport; army?: Army } {
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
    // In a live game the attack becomes an army that marches. It fights when it arrives.
    if (isLive(s)) {
      const army = launchArmy(s, map, o, clockOf(s))
      return army ? { error: null, army } : { error: 'The attack could not be made' }
    }
    const result = resolveAttack(s, map, o.nationId, o.target, rng, o.commit, o.stance, o.missiles, undefined, o.share)
    s.outcome = checkOutcome(s, map)
    return result ? { error: null, battle: result.report } : { error: 'The attack could not be made' }
  }
  executeOrder(s, map, o, rng)
  return { error: null }
}

function executeOrder(s: GameState, map: WorldMap, o: Order, rng: ReturnType<typeof createRng>) {
  const n = s.nations[o.nationId]
  switch (o.type) {
    case 'eventChoice':
      resolveEvent(s, map, o.index, o.nationId, false)
      break
    case 'respond':
      respond(s, map, o.nationId, o.proposalId, o.accept, rng)
      break
    case 'cancelDeal':
      cancelDeal(s, o.nationId, o.dealId)
      break
    case 'leaveAlliance':
      leaveAlliance(s, o.nationId, o.target)
      break
    case 'breakPact':
      breakPact(s, o.nationId, o.target)
      break
    case 'setPolicy':
      n.taxRate = o.taxRate
      n.draftRate = o.draftRate
      if (o.corporateTax !== undefined) n.corporateTax = o.corporateTax
      if (o.spending) n.spending = cleanSpending({ ...n.spending, ...o.spending })
      else if (o.budget) n.spending = spendingFromBudget(o.budget, false)
      break
    case 'setPrograms': {
      const focus = o.programs.focus
      if (focus && focus !== n.programs.focus) {
        // A new focus starts specializing again from nothing.
        n.people.specialization = 0
        n.people.focusSince = s.turn
      }
      n.programs = { ...n.programs, ...o.programs }
      if (o.rate !== undefined) n.bank.rate = o.rate
      break
    }
    case 'printMoney':
      printMoney(n, o.share, computeEconomy(s, map, o.nationId).gross)
      if (n.isPlayer) addLog(s, 'economy', `The central bank printed ${Math.round(o.share * 100)}% of a month's income. Inflation will follow.`, [o.nationId])
      break
    case 'wealthFund':
      moveFund(n, o.amount)
      break
    case 'setStateOwned':
      setStateOwned(s, n, o.sector, o.mode)
      break
    case 'startProject':
      if (isLocalProject(o.project)) {
        startLocal(s, n, o.project, o.regionId!)
        if (n.isPlayer) addLog(s, 'economy', `Work began on a ${LOCAL[o.project].name.toLowerCase()} in ${map.regions[o.regionId!].name}.`, [o.nationId])
      } else {
        startProject(n, o.project)
        if (n.isPlayer) addLog(s, 'economy', `Work began on the ${PROJECTS[o.project].name.toLowerCase()}. It takes about ${PROJECTS[o.project].months} months.`, [o.nationId])
      }
      break
    case 'pauseProject': {
      const p = isLocalProject(o.project) ? s.regions[o.regionId!]?.works?.[o.project] : n.projects[o.project]
      if (p) p.paused = o.paused
      break
    }
    case 'rushProject':
      applyRush(s, n, o.project, o.regionId)
      break
    case 'moveCapital':
      n.regionalCapitals = (n.regionalCapitals ?? []).filter((id) => id !== o.regionId)
      n.capital = o.regionId
      n.capitalMoved = s.turn
      n.stability = Math.max(0, n.stability - EMPIRE_RULES.capitalMoveStability)
      addLog(s, 'news', `${n.name} moved its capital to ${map.regions[o.regionId].name}.`, [o.nationId])
      break
    case 'setRegionalCapital':
      n.regionalCapitals = o.on ? [...new Set([...(n.regionalCapitals ?? []), o.regionId])] : (n.regionalCapitals ?? []).filter((id) => id !== o.regionId)
      break
    case 'fundAcademy':
      n.academy = Math.min(3, (n.academy ?? 0) + 1)
      if (n.isPlayer) addLog(s, 'info', `The military academy is now level ${n.academy}. New recruits join at that drill rank.`, [o.nationId])
      break
    case 'researchProgram': {
      const cost = programCost(n.research2[o.track] ?? 0)
      if (n.resources.tp < cost) break
      n.resources.tp -= cost
      n.research2[o.track] = (n.research2[o.track] ?? 0) + 1
      if (n.isPlayer) addLog(s, 'tech', `${RESEARCH_PROGRAMS[o.track].name} program reached level ${n.research2[o.track]}.`, [o.nationId])
      break
    }
    case 'resolution': {
      const gross = new Map<string, number>()
      for (const x of Object.values(s.nations)) if (x.alive) gross.set(x.id, computeEconomy(s, map, x.id).gross)
      runResolution(s, map, o.nationId, o.kind, o.target, o.target2, gross)
      break
    }
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
    case 'issueBonds': {
      const e = computeEconomy(s, map, o.nationId)
      issueBond(s, n, o.amount, o.war ? BANKING.warBondTerm : (o.term ?? 36), newBondRate(s, n, e.credit.rate, o.war), o.war)
      break
    }
    case 'repayDebt':
      if (n.bonds?.length) repayBonds(n, o.amount)
      else n.debt = Math.max(0, n.debt - o.amount)
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
    case 'setSocial':
      applySocial(s, n, o.policy, o.level)
      break
    case 'campaign':
      applyCampaign(s, n, o.campaign)
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
      pushMarket(s, o.resource, o.amount)
      break
    case 'marketSell':
      n.resources[o.resource as 'food'] -= o.amount
      n.resources.capital += marketValue(s, n, o.resource, o.amount, 'sell')
      n.tradeUsed += o.amount
      pushMarket(s, o.resource, -o.amount)
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
      fundAgency(s, o.nationId, o.agency, o.levels ?? 1)
      break
    case 'setGovernor':
      s.regions[o.regionId].governor = o.governor
      break
    case 'fundSystem':
      fundSystem(s, o.nationId, o.system, o.levels ?? 1)
      break
    case 'space':
      applySpace(s, n, o.action)
      break
    case 'setDeployment':
      applyDeployment(s, map, o)
      break
    case 'setBorder':
      applySetBorder(s, o)
      break
    case 'fundMissiles':
      applyFundMissiles(s, n)
      break
    case 'buildMissiles':
      applyBuildMissiles(s, n, o)
      break
    case 'buildWarhead':
      applyBuildWarhead(s, n)
      break
    case 'nuke':
      // A live warhead flies for days before it lands. In a turn game it falls at once.
      if (isLive(s)) launchNuke(s, map, o, clockOf(s))
      else fireNuke(s, map, o, rng)
      break
    case 'startAircraftDev':
      applyStartAircraftDev(s, n, o)
      break
    case 'pauseAircraftDev':
      applyPauseAircraftDev(n, o)
      break
    case 'strike':
      // Live missiles fly for a day before they land. Everything else lands at once.
      if (isLive(s) && o.weapon === 'missile') launchStrike(s, map, o, clockOf(s))
      else runStrike(s, map, o)
      break
    case 'recall': {
      const a = s.armies?.find((x) => x.id === o.armyId)
      if (a) turnBack(s, map, a, clockOf(s), 'recalled')
      break
    }
    case 'setDirective':
      setDirective(s, o.company, o.directive)
      break
    case 'buyShares':
      buyShares(s, o.nationId, o.company, o.shares)
      break
    case 'sellShares':
      sellShares(s, o.nationId, o.company, o.shares)
      break
    default:
      if (isFactionOrder(o)) executeFactionOrder(s, map, o, rng)
      break
  }
}

/** A commander drills the least-trained unit type one rank each month, at no cost. */
function drillWithCommanders(s: GameState) {
  for (const n of Object.values(s.nations)) {
    if (!n.alive || !n.military.commanderId) continue
    const force = forceUnits(s, n.id)
    const types = UNIT_TYPES.filter((k) => force[k] >= 0.05 && n.military.drill[k] < 5).sort((a, b) => n.military.drill[a] - n.military.drill[b])
    const k = types[0]
    if (!k) continue
    n.military.drill[k] += 1
    if (n.isPlayer) {
      const name = n.generals.find((g) => g.id === n.military.commanderId)?.name ?? 'Your commander'
      addLog(s, 'info', `${name} drilled the troops for free. ${UNIT_SPECS[k].name} is now ${trainingRank(n.military.drill[k])}.`, [n.id])
    }
  }
}
