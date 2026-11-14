import { BUILDING_TYPES, type BuildingType, type GameState, type NationId, type Order, type WorldMap } from './types'
import { orderCost } from './orders'
import { regionsOf } from './helpers'
import { applyOrderNow } from './resolveTurn'

/** What a bulk upgrade does: one kind of building, every city, or a little of everything. */
export type BulkTarget = BuildingType | 'cities' | 'all'

export interface BulkSpec {
  target: BulkTarget
  /** Levels to add in every country (the most each can take). */
  levels: number
  /** Skip countries that are still settling in. */
  settledOnly: boolean
  /** Money to leave untouched. */
  reserve: number
}

export interface BulkPlan {
  /** The orders to issue, in order. They are valid one after another. */
  orders: Order[]
  /** Countries that get at least one upgrade. */
  countries: number
  /** Upgrades in all. */
  upgrades: number
  cost: number
  /** Upgrades that could not be made, and why, so the player is not left guessing. */
  skipped: { atMax: number; noMoney: number; other: number }
}

/**
 * Works out a bulk upgrade by playing it forward on a copy of the game, one order at a time, so every cost and limit is
 * exactly what it will be when the orders are issued for real. Countries with the lowest level go first, and one level
 * is added everywhere before a second is added anywhere, so the money is spread evenly.
 */
export function planBulk(s: GameState, map: WorldMap, nationId: NationId, spec: BulkSpec): BulkPlan {
  const sim = structuredClone(s)
  const orders: Order[] = []
  const touched = new Set<string>()
  const skipped = { atMax: 0, noMoney: 0, other: 0 }
  let cost = 0
  const owned = regionsOf(sim, nationId).filter((id) => !spec.settledOnly || sim.regions[id].integration >= 1)
  const buildings: BuildingType[] = spec.target === 'all' ? BUILDING_TYPES : spec.target === 'cities' ? [] : [spec.target]
  const levels = Math.max(1, Math.min(10, Math.floor(spec.levels)))

  const tryOrder = (order: Order, regionId: string): boolean => {
    const price = orderCost(sim, order).capital
    if (sim.nations[nationId].resources.capital - price < spec.reserve) {
      skipped.noMoney++
      return false
    }
    const before = sim.nations[nationId].resources.capital
    const result = applyOrderNow(sim, map, order, [])
    if (result.error) {
      if (/highest level|top level|already/i.test(result.error)) skipped.atMax++
      else if (/Not enough money/.test(result.error)) skipped.noMoney++
      else skipped.other++
      return false
    }
    cost += before - sim.nations[nationId].resources.capital
    orders.push(order)
    touched.add(regionId)
    return true
  }

  for (let round = 0; round < levels; round++) {
    let any = false
    for (const building of buildings) {
      const order = [...owned].sort((a, b) => sim.regions[a].buildings[building] - sim.regions[b].buildings[building] || (a < b ? -1 : 1))
      for (const regionId of order) if (tryOrder({ type: 'build', nationId, regionId, building }, regionId)) any = true
    }
    if (spec.target === 'cities') {
      for (const regionId of owned) {
        const cities = [...sim.regions[regionId].cities].sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : 1))
        for (const city of cities) if (tryOrder({ type: 'developCity', nationId, regionId, cityId: city.id }, regionId)) any = true
      }
    }
    if (!any) break
  }
  return { orders, countries: touched.size, upgrades: orders.length, cost, skipped }
}
