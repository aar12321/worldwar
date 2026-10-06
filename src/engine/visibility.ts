import { nationModifiers } from './helpers'
import type { Army, GameState, NationId, RegionId, WorldMap } from './types'

/** Regions where `viewer` can see armies: own territory, bordering regions, and spied or satellite-covered nations. */
export function visibleRegions(s: GameState, map: WorldMap, viewer: NationId): Set<RegionId> | 'all' {
  const n = s.nations[viewer]
  if (nationModifiers(n).globalVision) return 'all'
  const out = new Set<RegionId>()
  for (const r of Object.values(s.regions)) {
    if (r.owner === viewer) {
      out.add(r.id)
      for (const nb of map.regions[r.id].neighbors) out.add(nb)
      if (r.buildings.port > 0) for (const nb of map.regions[r.id].seaLanes) out.add(nb)
    } else if ((n.vision[r.owner] ?? -1) >= s.turn) {
      out.add(r.id)
    }
  }
  return out
}

export function visibleArmies(s: GameState, map: WorldMap, viewer: NationId): Army[] {
  const vis = visibleRegions(s, map, viewer)
  return Object.values(s.armies)
    .filter((a) => a.owner === viewer || vis === 'all' || vis.has(a.location))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}
