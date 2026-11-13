import type { Terrain, UnitType } from '../engine/types'

export interface TerrainSpec {
  name: string
  /** Attack effectiveness of each unit type when fighting here. */
  unit: Record<UnitType, number>
  /** Defender bonus multiplier. */
  defense: number
  food: number
}

export const TERRAIN: Record<Terrain, TerrainSpec> = {
  plains: { name: 'Plains', unit: { infantry: 1, armor: 1.3, artillery: 1, fighter: 1, air: 1.1, naval: 0.6 }, defense: 1, food: 1.1 },
  forest: { name: 'Forest', unit: { infantry: 1.15, armor: 0.7, artillery: 0.8, fighter: 0.9, air: 0.8, naval: 0.6 }, defense: 1.15, food: 0.95 },
  mountain: { name: 'Mountain', unit: { infantry: 1.1, armor: 0.4, artillery: 0.6, fighter: 0.9, air: 0.7, naval: 0.5 }, defense: 1.4, food: 0.8 },
  desert: { name: 'Desert', unit: { infantry: 0.9, armor: 1.2, artillery: 0.9, fighter: 1.1, air: 1.2, naval: 0.6 }, defense: 1, food: 0.7 },
  urban: { name: 'Urban', unit: { infantry: 1.3, armor: 0.6, artillery: 0.9, fighter: 0.95, air: 0.9, naval: 0.7 }, defense: 1.25, food: 0.9 },
}
