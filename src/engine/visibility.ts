import { alliesOf, nationModifiers } from './helpers'
import type { Army, GameState, NationId, RegionId, WorldMap } from './types'

/**
 * Regions where `viewer` can see armies: its own and its allies' territory plus their borders,
 * and nations it has spied on or covers with satellites.
 */
export function visibleRegions(s: GameState, map: WorldMap, viewer: NationId): Set<RegionId> | 'all' {
  const n = s.nations[viewer]
  if (nationModifiers(n).globalVision) return 'all'
  const friends = new Set<NationId>([viewer, ...alliesOf(s, viewer)])
  const out = new Set<RegionId>()
  for (const r of Object.values(s.regions)) {
    if (friends.has(r.owner)) {
      out.add(r.id)
      for (const nb of map.regions[r.id].neighbors) out.add(nb)
      if (r.buildings.port > 0) for (const nb of map.regions[r.id].seaLanes) out.add(nb)
    } else if ((n.vision[r.owner] ?? -1) >= s.turn) {
      out.add(r.id)
    }
  }
  return out
}

export function visibleArmies(s: GameState, map: WorldMap, viewer: NationId, vis?: Set<RegionId> | 'all'): Army[] {
  const seen = vis ?? visibleRegions(s, map, viewer)
  return Object.values(s.armies)
    .filter((a) => a.owner === viewer || seen === 'all' || seen.has(a.location))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}
