import { TECH_BY_ID } from '../data/techTree'
import { BUILDING_SPECS, COSTS, DRAFT_LIMITS, LAW_SPECS, MARKET, PROPOSAL_COSTS, TAX_LIMITS, TRAIN_QUEUE_LIMIT, TRAINING, UNIT_SPECS, buildingCost, trainingCost, weaponCost } from '../data/unitTypes'
import { CITY_RULES, FOCUS } from '../data/cities'
import { BUSINESS, INVEST, SECTORS, SECTOR_IDS, TREASURY } from '../data/business'
import { BUDGET_KEYS, BUDGET_LIMITS, CORPORATE_TAX, EVEN_BUDGET, REFORM, buildDiscount } from '../data/government'
import { MAX_WARS, STANCES, WAR } from '../data/war'
import { nextWeaponLevel } from './arms'
import { validateProposal } from './diplomacy'
import { cityDevelopCost, cityLevelCap } from './cities'
import { investedIn, sectorCap, sectorYield } from './business'
import { buildingCap, computeEconomy, nationWorkforce, regionWorkforce } from './economy'
import { atWar, canUseUnit, enemiesOf, hasCasusBelli, hasPact, isAllied, totalUnits } from './helpers'
import { trainingSlots } from './training'
import { MARKET_GOODS, marketValue, tradeRoom } from './trade'
import type { GameState, Order, UnitType, WorldMap } from './types'
import { canAttackRegion, commitShare } from './warfare'

/** Orders that wait for the month to end. Everything else happens the moment you issue it. */
export const MONTH_END_ORDERS = new Set<Order['type']>(['setPolicy', 'propose', 'respond', 'research', 'spy', 'cancelDeal', 'leaveAlliance'])

/** Blocks training that would march a nation into a food shortage. */
export function foodForTroops(s: GameState, map: WorldMap, nationId: string, unit: UnitType): string | null {
  const nation = s.nations[nationId]
  const spec = UNIT_SPECS[unit]
  const econ = computeEconomy(s, map, nationId)
  const training = (s.trainingQueue ?? []).reduce((sum, job) => (job.nationId === nationId ? sum + UNIT_SPECS[job.unit].food : sum), 0)
  if (nation.foodShortage || nation.resources.food <= 0) return 'Not enough food to feed them. Build a farm first.'
  if (econ.netFood < spec.food + training && nation.resources.food < econ.foodConsumption * 2) return 'Not enough food to feed them. Build a farm first.'
  return null
}

export interface OrderCost {
  capital: number
  pp: number
  tp: number
  manpower: number
  steel: number
}

export function orderCost(s: GameState, o: Order): OrderCost {
  const c: OrderCost = { capital: 0, pp: 0, tp: 0, manpower: 0, steel: 0 }
  switch (o.type) {
    case 'build':
      c.capital = Math.round(buildingCost(o.building, s.regions[o.regionId]?.buildings[o.building] ?? 0) * (1 + buildDiscount(s.nations[o.nationId]?.budget ?? EVEN_BUDGET)))
      break
    case 'setGovernment':
      c.pp = REFORM.cost
      break
    case 'developCity': {
      const city = s.regions[o.regionId]?.cities.find((x) => x.id === o.cityId)
      c.capital = city ? cityDevelopCost(city) : 0
      break
    }
    case 'setCityFocus':
      c.capital = CITY_RULES.focusCost
      break
    case 'fundSector':
    case 'repayDebt':
    case 'invest':
      c.capital = o.amount
      break
    case 'queueTrain':
      c.capital = Math.round(UNIT_SPECS[o.unit].capitalCost * (1 - (s.nations[o.nationId] ? sectorYield(s.nations[o.nationId]).armsDiscount : 0)))
      c.manpower = UNIT_SPECS[o.unit].manpowerCost
      c.steel = UNIT_SPECS[o.unit].steel
      break
    case 'marketBuy':
      c.capital = s.nations[o.nationId] ? marketValue(s, s.nations[o.nationId], o.resource, o.amount, 'buy') : 0
      break
    case 'train':
      c.capital = trainingCost(s.nations[o.nationId]?.military.drill[o.unit] ?? 0)
      break
    case 'upgradeWeapons':
      c.capital = weaponCost(s.nations[o.nationId]?.military.weapons[o.unit] ?? 0)
      break
    case 'attack':
      c.capital = STANCES[o.stance ?? 'assault'].cost
      break
    case 'research':
      c.tp = TECH_BY_ID[o.techId]?.cost ?? 0
      break
    case 'declareWar':
      c.pp = hasCasusBelli(s, o.nationId, o.target) ? COSTS.declareWarWithCasusBelli : COSTS.declareWar
      break
    case 'propose':
      c.pp = PROPOSAL_COSTS[o.proposal.kind]
      break
    case 'leaveAlliance':
      c.pp = COSTS.leaveAlliance
      break
    case 'spy':
      c.capital = COSTS.spy
      break
    case 'enactLaw':
      c.pp = LAW_SPECS[o.law].cost
      break
    case 'suppressRebels':
      c.pp = COSTS.suppressRebels
      break
    default:
      break
  }
  return c
}

export function committedCost(s: GameState, orders: Order[]): OrderCost {
  const total: OrderCost = { capital: 0, pp: 0, tp: 0, manpower: 0, steel: 0 }
  for (const o of orders) {
    const c = orderCost(s, o)
    total.capital += c.capital
    total.pp += c.pp
    total.tp += c.tp
    total.manpower += c.manpower
    total.steel += c.steel
  }
  return total
}

/** Returns a human readable reason the order is invalid, or null if it can be issued. */
export function validateOrder(s: GameState, map: WorldMap, o: Order, pending: Order[] = []): string | null {
  const n = s.nations[o.nationId]
  if (!n?.alive) return 'Your nation has fallen.'
  const ruleError = checkRules(s, map, o, pending)
  if (ruleError) return ruleError
  const spent = committedCost(s, pending)
  const cost = orderCost(s, o)
  if (cost.capital > 0 && n.resources.capital - spent.capital < cost.capital) return `Not enough money (costs ${cost.capital})`
  if (cost.pp > 0 && n.resources.pp - spent.pp < cost.pp) return `Not enough influence (costs ${cost.pp})`
  if (cost.tp > 0 && n.resources.tp - spent.tp < cost.tp) return `Not enough research (costs ${cost.tp})`
  if (cost.manpower > 0 && n.militaryPool - spent.manpower < cost.manpower) return `Not enough soldiers (needs ${cost.manpower},000)`
  // Steel bought earlier in the same list counts as already in the store.
  const bought = pending.reduce((sum, p) => (p.type === 'marketBuy' && p.resource === 'steel' ? sum + p.amount : sum), 0)
  if (cost.steel > 0 && n.resources.steel + bought - spent.steel < cost.steel) return `Not enough steel (costs ${cost.steel}). Build factories or buy it on the market.`
  return null
}

function checkRules(s: GameState, map: WorldMap, o: Order, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  switch (o.type) {
    case 'setPolicy': {
      const maxDraft = n.laws.includes('conscription_act') ? DRAFT_LIMITS.maxWithConscription : DRAFT_LIMITS.max
      if (o.taxRate < TAX_LIMITS.min || o.taxRate > TAX_LIMITS.max) return 'Tax rate out of range'
      if (o.draftRate < DRAFT_LIMITS.min || o.draftRate > maxDraft + 1e-9) return 'Draft rate out of range'
      if (o.corporateTax !== undefined && (!Number.isFinite(o.corporateTax) || o.corporateTax < CORPORATE_TAX.min || o.corporateTax > CORPORATE_TAX.max + 1e-9)) return 'Business tax out of range'
      if (o.budget) {
        const shares = BUDGET_KEYS.map((k) => o.budget![k])
        if (shares.some((v) => !Number.isFinite(v) || v < BUDGET_LIMITS.min - 1e-9 || v > BUDGET_LIMITS.max + 1e-9)) return `Each part of the budget must be between ${Math.round(BUDGET_LIMITS.min * 100)}% and ${Math.round(BUDGET_LIMITS.max * 100)}%`
        if (Math.abs(shares.reduce((a, b) => a + b, 0) - 1) > 0.011) return 'The budget must add up to 100%'
      }
      return null
    }
    case 'fundSector': {
      const at = n.sectors[o.sector] ?? 0
      if (!Number.isFinite(o.amount) || o.amount < BUSINESS.minFunding) return `A grant must be at least ${BUSINESS.minFunding} money`
      const cap = sectorCap(nationWorkforce(s, map, o.nationId)) * 1.5
      if (at >= cap - 0.05) return `${SECTORS[o.sector].name} cannot grow any bigger in your country`
      return null
    }
    case 'developCity': {
      const r = s.regions[o.regionId]
      const city = r?.cities.find((c) => c.id === o.cityId)
      if (r?.owner !== o.nationId || !city) return 'You do not hold that city'
      if (city.level >= CITY_RULES.maxLevel) return `${city.name} is as big as a city can get`
      const cap = cityLevelCap(regionWorkforce(r, map.regions[o.regionId]))
      if (city.level >= cap) return `${city.name} cannot grow past level ${cap} in a country this size. A bigger workforce raises it.`
      return null
    }
    case 'setCityFocus': {
      const r = s.regions[o.regionId]
      const city = r?.cities.find((c) => c.id === o.cityId)
      if (r?.owner !== o.nationId || !city) return 'You do not hold that city'
      if (city.focus === o.focus) return 'It already has that focus'
      if (FOCUS[o.focus].needsPort && !city.port) return `${city.name} is not on the coast, so it cannot be a harbor`
      return null
    }
    case 'setSubsidies':
      return o.sectors.every((x) => SECTOR_IDS.includes(x)) ? null : 'Unknown sector'
    case 'issueBonds': {
      if (!Number.isFinite(o.amount) || o.amount < TREASURY.min) return `Bonds start at ${TREASURY.min} money`
      const credit = computeEconomy(s, map, o.nationId).credit
      if (credit.locked) return 'Nobody will lend to you after your default'
      if (o.amount > credit.room + 1e-6) return `Lenders will give you at most ${Math.floor(credit.room)} more (rating ${credit.rating})`
      return null
    }
    case 'repayDebt':
      if (n.debt <= 0) return 'You owe nothing'
      if (!Number.isFinite(o.amount) || o.amount <= 0) return 'Pick an amount'
      if (o.amount > n.debt + 1e-6) return `You only owe ${Math.ceil(n.debt)}`
      return null
    case 'invest': {
      const t = s.nations[o.target]
      if (!t?.alive || o.target === o.nationId) return 'Choose another nation'
      if (atWar(s, o.nationId, o.target)) return 'You cannot invest in a nation you are at war with'
      if (!Number.isFinite(o.amount) || o.amount < INVEST.min) return `Investments start at ${INVEST.min} money`
      if (investedIn(s, o.target, o.sector) + o.amount > Math.max(1, t.sectors[o.sector] ?? 0) * INVEST.maxPerSize) return `${t.name}'s ${SECTORS[o.sector].name.toLowerCase()} cannot take that much outside money`
      return null
    }
    case 'setGovernment': {
      if (n.government === o.government) return 'You already have that government'
      if (s.turn - n.lastReform < REFORM.cooldown && n.lastReform > 0) return `The government can change again in ${REFORM.cooldown - (s.turn - n.lastReform)} months`
      return null
    }
    case 'build': {
      const r = s.regions[o.regionId]
      if (r?.owner !== o.nationId) return 'You do not control this country'
      if (BUILDING_SPECS[o.building].requiresCoast && !map.regions[o.regionId].coastal) return 'Requires a coastline'
      const cap = buildingCap(regionWorkforce(r, map.regions[o.regionId]), o.building)
      if (r.buildings[o.building] >= cap) return `${BUILDING_SPECS[o.building].name} is at its highest level (${cap})`
      return null
    }
    case 'queueTrain': {
      if (!canUseUnit(n, o.unit)) return 'Technology required'
      const spec = UNIT_SPECS[o.unit]
      const owned = Object.values(s.regions).filter((r) => r.owner === o.nationId)
      if (!owned.some((r) => r.buildings[spec.requiresBuilding] > 0)) return `Requires a ${BUILDING_SPECS[spec.requiresBuilding].name}`
      const hungry = foodForTroops(s, map, o.nationId, o.unit)
      if (hungry) return hungry
      const waiting = (s.trainingQueue ?? []).filter((job) => job.nationId === o.nationId).length
      if (waiting >= trainingSlots(s, o.nationId) + TRAIN_QUEUE_LIMIT) return 'Training queue is full'
      return null
    }
    case 'cancelTrain': {
      const job = (s.trainingQueue ?? []).find((item) => item.id === o.jobId)
      if (!job || job.nationId !== o.nationId) return 'No such training'
      return null
    }
    case 'train': {
      if (n.military.units[o.unit] < 0.05) return 'No troops of that type'
      if (n.military.drill[o.unit] >= TRAINING.max) return 'Already fully trained'
      if (n.military.commanderId) return 'A commander trains your military for free'
      return null
    }
    case 'upgradeWeapons':
      return nextWeaponLevel(s, o.nationId, o.unit).error
    case 'marketBuy':
    case 'marketSell': {
      if (!MARKET_GOODS.includes(o.resource)) return 'That cannot be traded on the market'
      if (!Number.isFinite(o.amount) || o.amount <= 0) return 'Pick an amount'
      const room = tradeRoom(s, map, o.nationId)
      if (o.amount > room + 1e-9) return room < 0.05 ? 'You have used all your trade capacity this month. Ports raise it.' : `You can move ${room.toFixed(1)} more this month. Ports raise it.`
      if (o.type === 'marketSell' && n.resources[o.resource as 'food'] < o.amount) return `You do not have that much ${MARKET[o.resource].name.toLowerCase()}`
      return null
    }
    case 'setAutoBuy':
      return o.resources.every((r) => MARKET_GOODS.includes(r)) ? null : 'Only food and materials can be bought automatically'
    case 'research': {
      const t = TECH_BY_ID[o.techId]
      if (!t) return 'Unknown technology'
      if (n.techs.includes(t.id)) return 'Already researched'
      if (pending.some((p) => p.type === 'research' && p.techId === t.id)) return 'Already queued'
      const queuedTechs = pending.filter((p) => p.type === 'research').map((p) => (p as { techId: string }).techId)
      if (!t.requires.every((r) => n.techs.includes(r) || queuedTechs.includes(r))) return 'Prerequisites missing'
      return null
    }
    case 'attack': {
      const target = s.regions[o.target]
      if (!target) return 'Unknown country'
      if (target.owner === o.nationId) return 'That country is already yours'
      const pendingWar = pending.some((p) => p.type === 'declareWar' && p.target === target.owner)
      if (!atWar(s, o.nationId, target.owner) && !pendingWar) return `Not at war with ${s.nations[target.owner].name}`
      if (n.military.lastAttackTurn === s.turn && n.military.attacksThisTurn >= WAR.maxAttacksPerTurn) return `Your military has already attacked ${WAR.maxAttacksPerTurn} times this turn`
      if (totalUnits(n.military.units) < 0.1) return 'You have no military to attack with'
      if (commitShare(n, o.commit ?? 'main') < 0.05) return 'Your military is spent this turn. It can fight again next turn.'
      if (!canAttackRegion(s, map, o.nationId, o.target).ok) return 'Not on your border. A sea attack needs a port.'
      return null
    }
    case 'assignGeneral':
      if (o.generalId && !n.generals.some((g) => g.id === o.generalId)) return 'Unknown commander'
      return null
    case 'declareWar': {
      const t = s.nations[o.target]
      if (!t?.alive || o.target === o.nationId) return 'Invalid target'
      if (atWar(s, o.nationId, o.target)) return 'Already at war'
      if (isAllied(s, o.nationId, o.target)) return 'You are allied'
      if (hasPact(s, o.nationId, o.target)) return 'A non-aggression pact is in force'
      const pendingWars = pending.filter((p) => p.type === 'declareWar').length
      if (enemiesOf(s, o.nationId).length + pendingWars >= MAX_WARS) return `You are already fighting ${MAX_WARS} wars. End one first.`
      if (enemiesOf(s, o.target).length >= MAX_WARS) return `${t.name} is already fighting ${MAX_WARS} wars`
      return null
    }
    case 'propose': {
      if (
        pending.some((p) => p.type === 'propose' && p.target === o.target && p.proposal.kind === o.proposal.kind) ||
        s.proposalMemory[`${o.nationId}>${o.target}:${o.proposal.kind}`] === s.turn
      )
        return 'Already proposed this month'
      if (s.proposals.some((p) => p.from === o.nationId && p.to === o.target && p.kind === o.proposal.kind)) return 'Awaiting their answer'
      return validateProposal(s, map, o.nationId, o.target, o.proposal)
    }
    case 'respond': {
      const p = s.proposals.find((x) => x.id === o.proposalId && x.to === o.nationId)
      if (!p) return 'No such proposal'
      if (pending.some((x) => x.type === 'respond' && x.proposalId === o.proposalId)) return 'Already answered'
      if (o.accept && p.kind === 'callToArms' && enemiesOf(s, o.nationId).length >= MAX_WARS) return `You are already fighting ${MAX_WARS} wars`
      return o.accept ? validateProposal(s, map, p.from, p.to, p, true) : null
    }
    case 'cancelDeal': {
      const d = s.deals.find((x) => x.id === o.dealId)
      if (!d || (d.from !== o.nationId && d.to !== o.nationId)) return 'No such deal'
      if (d.kind === 'reparations' && d.from === o.nationId) return 'Reparations are binding'
      return null
    }
    case 'leaveAlliance':
      return isAllied(s, o.nationId, o.target) ? null : 'Not allied'
    case 'spy': {
      const r = s.regions[o.target]
      if (!r || r.owner === o.nationId) return 'Choose a foreign region'
      return null
    }
    case 'enactLaw':
      return n.laws.includes(o.law) ? 'Already enacted' : null
    case 'repealLaw':
      return n.laws.includes(o.law) ? null : 'Not enacted'
    case 'suppressRebels': {
      const r = s.regions[o.regionId]
      if (r?.owner !== o.nationId || r.rebels <= 0) return 'No rebels here'
      return null
    }
  }
}
