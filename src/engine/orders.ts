import { TECH_BY_ID } from '../data/techTree'
import { BUILDING_SPECS, COSTS, DRAFT_LIMITS, LAW_SPECS, TAX_LIMITS, UNIT_SPECS } from '../data/unitTypes'
import { atWar, canUseUnit, hasCasusBelli, hasPact } from './helpers'
import type { GameState, Order, WorldMap } from './types'
import { canReach } from './warfare'

export const MAX_BUILDINGS_PER_TYPE = 12

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
      c.capital = BUILDING_SPECS[o.building].cost
      break
    case 'recruit':
      c.capital = UNIT_SPECS[o.unit].capitalCost
      c.manpower = UNIT_SPECS[o.unit].manpowerCost
      break
    case 'research':
      c.tp = TECH_BY_ID[o.techId]?.cost ?? 0
      break
    case 'declareWar':
      c.pp = hasCasusBelli(s, o.nationId, o.target) ? COSTS.declareWarWithCasusBelli : COSTS.declareWar
      break
    case 'offerPeace':
      c.pp = COSTS.offerPeace
      break
    case 'offerPact':
      c.pp = COSTS.offerPact
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
  const spent = committedCost(s, pending)
  const cost = orderCost(s, o)
  if (cost.capital > 0 && n.resources.capital - spent.capital < cost.capital) return `Needs ${cost.capital} Capital`
  if (cost.pp > 0 && n.resources.pp - spent.pp < cost.pp) return `Needs ${cost.pp} Political Points`
  if (cost.tp > 0 && n.resources.tp - spent.tp < cost.tp) return `Needs ${cost.tp} Tech Points`
  if (cost.manpower > 0 && n.militaryPool - spent.manpower < cost.manpower) return `Needs ${cost.manpower}k military manpower`

  switch (o.type) {
    case 'setPolicy': {
      const maxDraft = n.laws.includes('conscription_act') ? DRAFT_LIMITS.maxWithConscription : DRAFT_LIMITS.max
      if (o.taxRate < TAX_LIMITS.min || o.taxRate > TAX_LIMITS.max) return 'Tax rate out of range'
      if (o.draftRate < DRAFT_LIMITS.min || o.draftRate > maxDraft + 1e-9) return 'Draft rate out of range'
      return null
    }
    case 'build': {
      const r = s.regions[o.regionId]
      if (r?.owner !== o.nationId) return 'You do not control this region'
      if (BUILDING_SPECS[o.building].requiresCoast && !map.regions[o.regionId].coastal) return 'Requires a coastline'
      const queued = pending.filter((p) => p.type === 'build' && p.regionId === o.regionId && p.building === o.building).length
      if (r.buildings[o.building] + queued >= MAX_BUILDINGS_PER_TYPE) return 'Region is at capacity'
      return null
    }
    case 'recruit': {
      const r = s.regions[o.regionId]
      if (r?.owner !== o.nationId) return 'You do not control this region'
      if (!canUseUnit(n, o.unit)) return 'Technology required'
      const spec = UNIT_SPECS[o.unit]
      if (r.buildings[spec.requiresBuilding] <= 0) return `Requires a ${BUILDING_SPECS[spec.requiresBuilding].name}`
      return null
    }
    case 'research': {
      const t = TECH_BY_ID[o.techId]
      if (!t) return 'Unknown technology'
      if (n.techs.includes(t.id)) return 'Already researched'
      if (pending.some((p) => p.type === 'research' && p.techId === t.id)) return 'Already queued'
      const queuedTechs = pending.filter((p) => p.type === 'research').map((p) => (p as { techId: string }).techId)
      if (!t.requires.every((r) => n.techs.includes(r) || queuedTechs.includes(r))) return 'Prerequisites missing'
      return null
    }
    case 'move': {
      const a = s.armies[o.armyId]
      if (!a || a.owner !== o.nationId) return 'Not your army'
      if (s.regions[o.to]?.owner !== o.nationId) return 'Can only move within your territory'
      if (!canReach(s, map, o.nationId, a.location, o.to, 'move').ok) return 'Not adjacent (sea moves need a port and Coastal Gunboats)'
      return null
    }
    case 'attack': {
      const a = s.armies[o.armyId]
      if (!a || a.owner !== o.nationId) return 'Not your army'
      const target = s.regions[o.target]
      if (!target) return 'Unknown region'
      if (target.owner === o.nationId) return target.rebels > 0 ? null : 'Region is already yours'
      const pendingWar = pending.some((p) => p.type === 'declareWar' && p.target === target.owner)
      if (!atWar(s, o.nationId, target.owner) && !pendingWar) return `Not at war with ${s.nations[target.owner].name}`
      if (!canReach(s, map, o.nationId, a.location, o.target, 'attack').ok)
        return 'Not adjacent (sea invasions need a port and Destroyers)'
      return null
    }
    case 'assignGeneral': {
      const a = s.armies[o.armyId]
      if (!a || a.owner !== o.nationId) return 'Not your army'
      if (o.generalId && !n.generals.some((g) => g.id === o.generalId)) return 'Unknown general'
      return null
    }
    case 'declareWar': {
      const t = s.nations[o.target]
      if (!t?.alive || o.target === o.nationId) return 'Invalid target'
      if (atWar(s, o.nationId, o.target)) return 'Already at war'
      if (hasPact(s, o.nationId, o.target)) return 'A non-aggression pact is in force'
      return null
    }
    case 'offerPeace':
      return atWar(s, o.nationId, o.target) ? null : 'Not at war'
    case 'acceptPeace':
      return s.peaceOffers.some((p) => p.from === o.target && p.to === o.nationId) ? null : 'No peace offer'
    case 'offerPact': {
      if (!s.nations[o.target]?.alive || o.target === o.nationId) return 'Invalid target'
      if (atWar(s, o.nationId, o.target)) return 'Make peace first'
      if (hasPact(s, o.nationId, o.target)) return 'Pact already in force'
      return null
    }
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
