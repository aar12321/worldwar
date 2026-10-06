import { addLog, armiesOf, nationModifiers } from './helpers'
import type { GameState, NationId, RegionId, WorldMap } from './types'
import { UNIT_TYPES } from './types'

export const SUPPLY = {
  baseRange: 4,
  seaEdgeCost: 2,
  attrition: 0.15,
  surrenderAfter: 3,
}

/** Shortest supply distance from the capital to every owned region reachable through owned territory. */
export function supplyDistances(s: GameState, map: WorldMap, nationId: NationId): Map<RegionId, number> {
  const n = s.nations[nationId]
  const mods = nationModifiers(n)
  const dist = new Map<RegionId, number>()
  if (!n.alive || s.regions[n.capital]?.owner !== nationId) return dist
  const seaCost = Math.max(0, SUPPLY.seaEdgeCost - mods.seaSupplyRange)
  dist.set(n.capital, 0)
  const frontier: RegionId[] = [n.capital]
  while (frontier.length) {
    frontier.sort((a, b) => dist.get(a)! - dist.get(b)! || (a < b ? -1 : 1))
    const cur = frontier.shift()!
    const d = dist.get(cur)!
    const curRegion = s.regions[cur]
    const edges: [RegionId, number, boolean][] = map.regions[cur].neighbors.map((x) => [x, 1, false])
    if (curRegion.buildings.port > 0) for (const x of map.regions[cur].seaLanes) edges.push([x, seaCost, true])
    for (const [next, cost, bySea] of edges) {
      const r = s.regions[next]
      if (!r || r.owner !== nationId) continue
      if (bySea && r.buildings.port <= 0) continue
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

export function isArmySupplied(
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
