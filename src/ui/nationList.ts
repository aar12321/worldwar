import type { MapRegion, WorldMap } from '../engine/types'

/** How strong a country starts, for ordering lists and naming its tier. */
export const nationScore = (r: MapRegion) => Math.pow(r.basePopulation, 0.6) * (0.3 + 0.7 * r.development)

export function rankNations(map: WorldMap): { r: MapRegion; score: number }[] {
  return Object.values(map.regions)
    .map((r) => ({ r, score: nationScore(r) }))
    .sort((a, b) => b.score - a.score)
}

/** How strong a nation starts. These are not the empire tiers, which you earn by holding countries. */
export const nationTier = (score: number) => (score > 25 ? 'Powerhouse' : score > 10 ? 'Strong start' : score > 4 ? 'Modest start' : 'Small start')
