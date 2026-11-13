import type { MapRegion, WorldMap } from '../engine/types'

/** How strong a country starts, for ordering lists and naming its tier. */
export const nationScore = (r: MapRegion) => Math.pow(r.basePopulation, 0.6) * (0.3 + 0.7 * r.development)

export function rankNations(map: WorldMap): { r: MapRegion; score: number }[] {
  return Object.values(map.regions)
    .map((r) => ({ r, score: nationScore(r) }))
    .sort((a, b) => b.score - a.score)
}

export const nationTier = (score: number) => (score > 25 ? 'Great Power' : score > 10 ? 'Major Power' : score > 4 ? 'Regional Power' : 'Minor Nation')
