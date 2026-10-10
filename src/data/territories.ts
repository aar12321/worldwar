import { clamp } from '../engine/helpers'
import type { MapRegion, RegionId, Territory, WorldMap } from '../engine/types'

const COMPASS = ['Heartland', 'Northern', 'Southern', 'Eastern', 'Western']

/** Real district names for the largest countries. Index 0 is the heartland muster. */
const NAMED: Record<string, string[]> = {
  'United States of America': ['The Heartland', 'The Eastern Seaboard', 'The West', 'The South', 'The Great Lakes'],
  Russia: ['Muscovy', 'Siberia', 'The Urals', 'The Far East', 'The Caucasus'],
  China: ['The North China Plain', 'The South', 'The West', 'Manchuria', 'The Coast'],
  India: ['The Gangetic Plain', 'The Deccan', 'The South', 'The West', 'The Northeast'],
  Brazil: ['The Southeast', 'The Amazon', 'The Northeast', 'The South', 'The Center-West'],
  Canada: ['The Heartland', 'The West', 'The Maritimes', 'The Prairies', 'The North'],
  Australia: ['The Southeast', 'The East Coast', 'The West', 'The North', 'The Interior'],
}

/** Offsets from the country centroid, in spread-units. The heartland stays put. */
const OFFSETS: [number, number][] = [
  [0, 0],
  [0.72, 0.18],
  [-0.55, 0.42],
  [0.22, -0.68],
  [-0.48, -0.36],
]

export function territoryCount(population: number, area: number): number {
  const fromPop = population < 8 ? 1 : population < 30 ? 2 : population < 80 ? 3 : population < 180 ? 4 : 5
  const fromArea = area < 0.004 ? 1 : area < 0.012 ? 2 : area < 0.03 ? 3 : area < 0.06 ? 4 : 5
  return Math.max(fromPop, fromArea)
}

export function territorySpread(area: number): number {
  return clamp(Math.sqrt(Math.max(area, 0)) * 80, 0.35, 14)
}

export function territoryName(country: string, index: number): string {
  const curated = NAMED[country]
  if (curated && index < curated.length) return curated[index]
  if (index === 0) return `${country} Heartland`
  return `${COMPASS[index] ?? `District ${index + 1}`} ${country}`
}

export function territoryId(regionId: RegionId, index: number): string {
  return `${regionId}:${index}`
}

export function heartland(region: MapRegion): Territory {
  return {
    id: territoryId(region.id, 0),
    regionId: region.id,
    name: territoryName(region.name, 0),
    lat: region.lat,
    lng: region.lng,
    index: 0,
  }
}

export function musterTerritories(region: MapRegion, count = territoryCount(region.basePopulation, region.area)): Territory[] {
  const n = Math.max(1, Math.min(5, count))
  const spread = territorySpread(region.area)
  const out: Territory[] = []
  for (let i = 0; i < n; i++) {
    const [dLat, dLng] = OFFSETS[i] ?? [0, 0]
    out.push({
      id: territoryId(region.id, i),
      regionId: region.id,
      name: territoryName(region.name, i),
      lat: clamp(region.lat + dLat * spread, -85, 85),
      lng: region.lng + dLng * spread,
      index: i,
    })
  }
  return out
}

export function indexTerritories(list: Territory[]): Pick<WorldMap, 'territories' | 'territoriesByRegion'> {
  const territories: Record<string, Territory> = {}
  const territoriesByRegion: Record<RegionId, string[]> = {}
  for (const t of list) {
    territories[t.id] = t
    const bucket = territoriesByRegion[t.regionId]
    if (bucket) bucket.push(t.id)
    else territoriesByRegion[t.regionId] = [t.id]
  }
  for (const ids of Object.values(territoriesByRegion)) ids.sort((a, b) => territories[a].index - territories[b].index)
  return { territories, territoriesByRegion }
}
