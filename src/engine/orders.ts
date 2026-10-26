import { TECH_BY_ID } from '../data/techTree'
import { BUILDING_SPECS, COSTS, DRAFT_LIMITS, LAW_SPECS, PROPOSAL_COSTS, TAX_LIMITS, TRAIN_QUEUE_LIMIT, TRAINING, UNIT_SPECS, buildingCost, trainingCost, weaponCost } from '../data/unitTypes'
import { nextWeaponLevel } from './arms'
import { validateProposal } from './diplomacy'
import { buildingCap, computeEconomy, regionWorkforce } from './economy'
import { atWar, canUseUnit, hasCasusBelli, hasPact, isAllied, totalUnits } from './helpers'
import { trainingSlots } from './training'
import type { GameState, Order, UnitType, WorldMap } from './types'
import { canAttackRegion } from './warfare'

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
}

export function orderCost(s: GameState, o: Order): OrderCost {
  const c: OrderCost = { capital: 0, pp: 0, tp: 0, manpower: 0 }
  switch (o.type) {
    case 'build':
      c.capital = buildingCost(o.building, s.regions[o.regionId]?.buildings[o.building] ?? 0)
      break
    case 'queueTrain':
      c.capital = UNIT_SPECS[o.unit].capitalCost
      c.manpower = UNIT_SPECS[o.unit].manpowerCost
      break
    case 'train':
      c.capital = trainingCost(s.nations[o.nationId]?.military.drill[o.unit] ?? 0)
      break
    case 'upgradeWeapons':
      c.capital = weaponCost(s.nations[o.nationId]?.military.weapons[o.unit] ?? 0)
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
  const total: OrderCost = { capital: 0, pp: 0, tp: 0, manpower: 0 }
  for (const o of orders) {
    const c = orderCost(s, o)
    total.capital += c.capital
    total.pp += c.pp
    total.tp += c.tp
    total.manpower += c.manpower
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
  return null
}

function checkRules(s: GameState, map: WorldMap, o: Order, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  switch (o.type) {
    case 'setPolicy': {
      const maxDraft = n.laws.includes('conscription_act') ? DRAFT_LIMITS.maxWithConscription : DRAFT_LIMITS.max
      if (o.taxRate < TAX_LIMITS.min || o.taxRate > TAX_LIMITS.max) return 'Tax rate out of range'
      if (o.draftRate < DRAFT_LIMITS.min || o.draftRate > maxDraft + 1e-9) return 'Draft rate out of range'
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
      if (n.military.lastAttackTurn === s.turn) return 'Your military has already attacked this turn'
      if (totalUnits(n.military.units) < 0.1) return 'You have no military to attack with'
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
