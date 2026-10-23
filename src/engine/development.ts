import { HOUSING_GROWTH_CAP, UPGRADE_SPECS, UPGRADE_UPKEEP } from '../data/development'
import { territoryOwner } from './territory'
import { TERRITORY_UPGRADES, type GameState, type RegionId, type TerritoryDev, type TerritoryUpgrade, type WorldMap } from './types'

export interface DevelopmentBonus {
  capital: number
  food: number
  pp: number
  tp: number
  upkeep: number
  roads: number
  housing: number
  levels: number
}

const EMPTY_BONUS: DevelopmentBonus = { capital: 0, food: 0, pp: 0, tp: 0, upkeep: 0, roads: 0, housing: 0, levels: 0 }

export function territoryDevOf(s: GameState, territoryId: string): TerritoryDev {
  return s.territoryDev?.[territoryId] ?? { housing: 0, works: 0, granary: 0, roads: 0, civic: 0 }
}

export function ensureTerritoryDev(s: GameState, territoryId: string): TerritoryDev {
  s.territoryDev ??= {}
  const existing = s.territoryDev[territoryId]
  if (existing) return existing
  const created: TerritoryDev = { housing: 0, works: 0, granary: 0, roads: 0, civic: 0 }
  s.territoryDev[territoryId] = created
  return created
}

export function housingInRegion(s: GameState, map: WorldMap, regionId: RegionId): number {
  let housing = 0
  const owner = s.regions[regionId]?.owner
  for (const id of map.territoriesByRegion[regionId] ?? []) {
    if (territoryOwner(s, map, id) !== owner) continue
    housing += territoryDevOf(s, id).housing
  }
  return housing
}

/** Monthly population multiplier. Unimproved land matches the original 0.08% growth. */
export function populationGrowth(foodShortage: boolean, housing: number, territoryCount: number): number {
  if (foodShortage) return 0.997
  const cap = Math.max(1, territoryCount) * UPGRADE_SPECS.housing.max
  const share = Math.min(1, Math.max(0, housing) / cap)
  return 1.0008 + share * HOUSING_GROWTH_CAP
}

export function developmentBonus(s: GameState, map: WorldMap, nationId: string): DevelopmentBonus {
  if (!s.territoryDev) return { ...EMPTY_BONUS }
  const out: DevelopmentBonus = { ...EMPTY_BONUS }
  for (const id of Object.keys(map.territories)) {
    if (territoryOwner(s, map, id) !== nationId) continue
    const dev = s.territoryDev[id]
    if (!dev) continue
    let levels = 0
    for (const upgrade of TERRITORY_UPGRADES) {
      const level = dev[upgrade] || 0
      const spec = UPGRADE_SPECS[upgrade]
      out.capital += level * spec.capital
      out.food += level * spec.food
      out.pp += level * spec.pp
      out.tp += level * spec.tp
      levels += level
    }
    out.roads += dev.roads
    out.housing += dev.housing
    out.levels += levels
    out.upkeep += levels * UPGRADE_UPKEEP
  }
  return out
}

/** Every 4 road levels stretch supply by 1, and the bonus stops at +2. */
export function roadSupplyBonus(s: GameState, map: WorldMap, nationId: string): number {
  return Math.min(2, Math.floor(developmentBonus(s, map, nationId).roads / 4))
}

/** Share of a country's people living in one territory. Housing pulls population toward it. */
export function territoryPopulation(s: GameState, map: WorldMap, regionId: RegionId, territoryId: string): number {
  const region = s.regions[regionId]
  const ids = map.territoriesByRegion[regionId] ?? []
  if (!region || ids.length === 0) return 0
  const weights = ids.map((id) => 1 + territoryDevOf(s, id).housing * 0.45)
  const sum = weights.reduce((total, w) => total + w, 0)
  const index = ids.indexOf(territoryId)
  if (index < 0 || sum <= 0) return region.population / ids.length
  return (region.population * weights[index]) / sum
}

export function territoryYield(dev: TerritoryDev): { capital: number; food: number; pp: number; tp: number } {
  const yieldOf = { capital: 0, food: 0, pp: 0, tp: 0 }
  for (const upgrade of TERRITORY_UPGRADES) {
    const level = dev[upgrade] || 0
    const spec = UPGRADE_SPECS[upgrade]
    yieldOf.capital += level * spec.capital
    yieldOf.food += level * spec.food
    yieldOf.pp += level * spec.pp
    yieldOf.tp += level * spec.tp
  }
  return yieldOf
}

export function devLevel(dev: TerritoryDev, upgrade: TerritoryUpgrade): number {
  return Math.max(0, Math.floor(dev[upgrade] || 0))
}
