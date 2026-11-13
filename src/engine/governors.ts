import { EMPIRE } from '../data/war'
import { regionsOf } from './helpers'
import { orderCost, validateOrder } from './orders'
import type { BuildingType, GameState, Governor, Order, WorldMap } from './types'

/** What each governor builds, in the order it prefers. */
export const GOVERNOR_BUILDS: Record<Exclude<Governor, 'off'>, BuildingType[]> = {
  growth: ['farm', 'factory', 'university', 'civic'],
  industry: ['factory', 'port'],
  farming: ['farm'],
  research: ['university', 'civic'],
}

export const GOVERNOR_LABELS: Record<Governor, string> = {
  off: 'You decide',
  growth: 'Balanced growth',
  industry: 'Industry',
  farming: 'Farming',
  research: 'Research',
}

/**
 * Each month, a player's governors upgrade their country on their own: one building a month in each, but never
 * spending the nation's last money. The orders go through the same checks and costs as any other.
 */
export function governorOrders(s: GameState, map: WorldMap): Order[] {
  const out: Order[] = []
  for (const id of s.humans) {
    const n = s.nations[id]
    if (!n?.alive) continue
    let money = n.resources.capital - EMPIRE.governorReserve
    for (const regionId of regionsOf(s, id)) {
      const r = s.regions[regionId]
      const gov = r.governor
      if (!gov || gov === 'off') continue
      const wanted = [...GOVERNOR_BUILDS[gov]].sort((a, b) => r.buildings[a] - r.buildings[b])
      for (const building of wanted) {
        const order: Order = { type: 'build', nationId: id, regionId, building }
        if (validateOrder(s, map, order, out) !== null) continue
        const cost = orderCost(s, order).capital
        if (cost > money) continue
        money -= cost
        out.push(order)
        break
      }
    }
  }
  return out
}
