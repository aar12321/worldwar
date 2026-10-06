import { addLog, armiesOf, nationModifiers } from './helpers'
import type { GameState, NationId, RegionId, WorldMap } from './types'
import { UNIT_TYPES } from './types'

export const SUPPLY = {
  baseRange: 4,
  seaEdgeCost: 2,
  attrition: 0.15,
  surrenderAfter: 3,
}

function supplyEdges(s: GameState, map: WorldMap, nationId: NationId, cur: RegionId, seaCost: number): [RegionId, number][] {
  const out: [RegionId, number][] = []
  for (const x of map.regions[cur].neighbors) if (s.regions[x]?.owner === nationId) out.push([x, 1])
  if (s.regions[cur].buildings.port > 0)
    for (const x of map.regions[cur].seaLanes) {
      const r = s.regions[x]
      if (r?.owner === nationId && r.buildings.port > 0) out.push([x, seaCost])
    }
  return out
}

/**
 * Supply distance to every owned region that is connected to the capital.
 * The capital and supply depots are full hubs; ports resupply one step inland and barracks feed their own region.
 * Hubs only work while they are connected to the capital's network.
 */
export function supplyDistances(s: GameState, map: WorldMap, nationId: NationId): Map<RegionId, number> {
  const n = s.nations[nationId]
  const dist = new Map<RegionId, number>()
  if (!n?.alive || s.regions[n.capital]?.owner !== nationId) return dist
  const mods = nationModifiers(n)
  const seaCost = Math.max(0, SUPPLY.seaEdgeCost - mods.seaSupplyRange)
  const range = SUPPLY.baseRange + mods.supplyRange

  const connected = new Set<RegionId>([n.capital])
  const stack = [n.capital]
  while (stack.length) {
    const cur = stack.pop()!
    for (const [next] of supplyEdges(s, map, nationId, cur, seaCost))
      if (!connected.has(next)) {
        connected.add(next)
        stack.push(next)
      }
  }

  const frontier: RegionId[] = []
  for (const id of connected) {
    const b = s.regions[id].buildings
    const seed = id === n.capital || b.depot > 0 ? 0 : b.port > 0 ? range - 1 : b.barracks > 0 ? range : Infinity
    if (seed === Infinity) continue
    dist.set(id, seed)
    frontier.push(id)
  }
  while (frontier.length) {
    frontier.sort((a, b) => dist.get(a)! - dist.get(b)! || (a < b ? -1 : 1))
    const cur = frontier.shift()!
    const d = dist.get(cur)!
    for (const [next, cost] of supplyEdges(s, map, nationId, cur, seaCost)) {
      const nd = d + cost
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd)
        frontier.push(next)
      }
    }
  }
  return dist
}

export function supplyRange(s: GameState, nationId: NationId): number {
  return SUPPLY.baseRange + nationModifiers(s.nations[nationId]).supplyRange
}

export function suppliedRegions(s: GameState, map: WorldMap, nationId: NationId): Set<RegionId> {
  const range = supplyRange(s, nationId)
  const out = new Set<RegionId>()
  for (const [id, d] of supplyDistances(s, map, nationId)) if (d <= range) out.add(id)
  return out
}

function isArmySupplied(
  s: GameState,
  dist: Map<RegionId, number>,
  range: number,
  armyId: string,
): boolean {
  const a = s.armies[armyId]
  const n = s.nations[a.owner]
  const general = n.generals.find((g) => g.id === a.generalId)
  const tolerance = general?.trait === 'logistician' ? 1 : 0
  const d = dist.get(a.location)
  return d !== undefined && d <= range + tolerance
}

export function applySupply(s: GameState, map: WorldMap, nationId: NationId) {
  const n = s.nations[nationId]
  const dist = supplyDistances(s, map, nationId)
  const range = supplyRange(s, nationId)
  for (const a of armiesOf(s, nationId)) {
    const general = n.generals.find((g) => g.id === a.generalId)
    const foodLoss = n.foodShortage ? 0.05 : 0
    if (isArmySupplied(s, dist, range, a.id)) {
      a.outOfSupplyTurns = 0
    } else {
      a.outOfSupplyTurns++
      if (a.outOfSupplyTurns >= SUPPLY.surrenderAfter) {
        delete s.armies[a.id]
        addLog(s, 'war', `${n.name}'s starving army in ${map.regions[a.location].name} surrendered after ${a.outOfSupplyTurns} months without supply.`, [nationId])
        continue
      }
      const loss = SUPPLY.attrition * (general?.trait === 'logistician' ? 0.5 : 1)
      for (const k of UNIT_TYPES) a.units[k] *= 1 - loss
      if (a.outOfSupplyTurns === 1)
        addLog(s, 'war', `${n.name}'s army in ${map.regions[a.location].name} is out of supply!`, [nationId])
    }
    if (foodLoss > 0) for (const k of UNIT_TYPES) a.units[k] *= 1 - foodLoss
  }
}
