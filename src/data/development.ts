import type { TerritoryUpgrade } from '../engine/types'

export interface UpgradeSpec {
  name: string
  max: number
  /** Capital cost of level 0. Each further level costs more. */
  base: number
  /** What one level adds each month, before upkeep. */
  capital: number
  food: number
  pp: number
  tp: number
  blurb: string
}

/** Local investment on a territory. Levels are 0..max. */
export const UPGRADE_SPECS: Record<TerritoryUpgrade, UpgradeSpec> = {
  housing: {
    name: 'Housing',
    max: 3,
    base: 24,
    capital: 0,
    food: 0,
    pp: 0,
    tp: 0,
    blurb: 'More people settle here. This country grows faster as more of its territories build housing.',
  },
  works: {
    name: 'Works',
    max: 3,
    base: 32,
    capital: 3.5,
    food: 0,
    pp: 0,
    tp: 0,
    blurb: 'Mills and workshops. Adds money every month.',
  },
  granary: {
    name: 'Granary',
    max: 3,
    base: 26,
    capital: 0,
    food: 1.8,
    pp: 0,
    tp: 0,
    blurb: 'Stores grain and feeds the country.',
  },
  roads: {
    name: 'Roads',
    max: 3,
    base: 28,
    capital: 0.8,
    food: 0.35,
    pp: 0,
    tp: 0,
    blurb: 'Infrastructure. A little income, and every 4 road levels extend supply by 1, up to +2.',
  },
  civic: {
    name: 'Civic Hall',
    max: 3,
    base: 30,
    capital: 0,
    food: 0,
    pp: 0.35,
    tp: 0.25,
    blurb: 'Offices and schools. Adds influence and research every month.',
  },
}

export const UPGRADE_UPKEEP = 0.3

/** Extra monthly growth once every territory in the country has full housing. */
export const HOUSING_GROWTH_CAP = 0.0012

export function upgradeCost(upgrade: TerritoryUpgrade, level: number): number {
  const spec = UPGRADE_SPECS[upgrade]
  const step = Math.max(0, Math.min(spec.max, Math.floor(level)))
  return Math.round(spec.base * (1 + step * 0.7))
}

export function emptyTerritoryDev(): Record<TerritoryUpgrade, number> {
  return { housing: 0, works: 0, granary: 0, roads: 0, civic: 0 }
}
