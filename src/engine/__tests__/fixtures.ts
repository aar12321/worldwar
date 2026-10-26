import { createInitialState } from '../../data/startingNations'
import type { GameState, MapRegion, Terrain, WorldMap } from '../types'

/** A straight chain of regions r0 - r1 - ... - r{n-1}, all plains unless overridden. */
export function lineMap(n: number, terrain: Partial<Record<number, Terrain>> = {}): WorldMap {
  const regions: Record<string, MapRegion> = {}
  for (let i = 0; i < n; i++) {
    const id = `r${i}`
    regions[id] = {
      id,
      name: `Region ${i}`,
      lat: 0,
      lng: i * 5,
      area: 1 / n,
      terrain: terrain[i] ?? 'plains',
      coastal: false,
      neighbors: [i > 0 ? `r${i - 1}` : null, i < n - 1 ? `r${i + 1}` : null].filter((x): x is string => !!x),
      seaLanes: [],
      basePopulation: 20,
      development: 0.6,
    }
  }
  const order = Object.keys(regions).sort()
  return { regions, order }
}

export function startState(map: WorldMap, player = 'r0', seed = 1): GameState {
  // Above 1 so a one-nation test map is not an instant population victory.
  const s = createInitialState(map, { playerRegionId: player, seed, victoryShare: 2 })
  s.nextEventTurn = 9999
  return s
}

/** Hand every listed region to `owner`, razing military buildings like a conquest would. */
export function giveRegions(s: GameState, owner: string, ids: string[]) {
  for (const id of ids) {
    s.regions[id].owner = owner
    s.regions[id].buildings.barracks = 0
  }
  for (const id of ids) {
    if (id !== owner && s.nations[id]) {
      s.nations[id].alive = false
    }
  }
}

/** Sets a nation's whole military. */
export function setMilitary(s: GameState, nationId: string, units: Partial<Record<'infantry' | 'armor' | 'air' | 'naval', number>>) {
  s.nations[nationId].military.units = { infantry: 0, armor: 0, air: 0, naval: 0, ...units }
}
