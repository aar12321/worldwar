import { clamp } from '../engine/helpers'
import type { MapRegion, RegionId, Territory, WorldMap } from '../engine/types'

const COMPASS = ['Heartland', 'Northern', 'Southern', 'Eastern', 'Western', 'Central', 'Upland', 'Frontier']

/** Real district names for the largest countries. Index 0 is the heartland. */
const NAMED: Record<string, string[]> = {
  'United States of America': ['The Heartland', 'The Eastern Seaboard', 'The West', 'The South', 'The Great Lakes', 'The Plains', 'The Southwest', 'The Pacific Northwest'],
  Russia: ['Muscovy', 'Siberia', 'The Urals', 'The Far East', 'The Caucasus', 'The Volga', 'The Arctic', 'Central Asia'],
  China: ['The North China Plain', 'The South', 'The West', 'Manchuria', 'The Coast', 'The Southwest', 'The Northwest', 'The Yangtze'],
  India: ['The Gangetic Plain', 'The Deccan', 'The South', 'The West', 'The Northeast', 'The Coast', 'The Himalayas', 'Central India'],
  Brazil: ['The Southeast', 'The Amazon', 'The Northeast', 'The South', 'The Center-West', 'The Coast', 'The Interior', 'The North'],
  Canada: ['The Heartland', 'The West', 'The Maritimes', 'The Prairies', 'The North', 'The Pacific', 'Quebec', 'The Arctic'],
  Australia: ['The Southeast', 'The East Coast', 'The West', 'The North', 'The Interior', 'The South', 'Tasmania', 'The Center'],
}

/** Offsets from the country centroid, in spread-units. The heartland stays put. */
const OFFSETS: [number, number][] = [
  [0, 0],
  [0.92, 0.12],
  [-0.78, 0.48],
  [0.28, -0.9],
  [-0.62, -0.55],
  [0.7, 0.78],
  [-0.18, 0.98],
  [1.05, -0.42],
]

export const MAX_TERRITORIES = 8

/**
 * Large countries are split into more districts, up to 8.
 * Population and land area both count; the larger of the two wins. The floor is 1.
 */
export function territoryCount(population: number, area: number): number {
  const fromPop = population < 3 ? 1 : population < 10 ? 2 : population < 25 ? 3 : population < 50 ? 4 : population < 90 ? 5 : population < 160 ? 6 : population < 280 ? 7 : 8
  const fromArea = area < 0.0015 ? 1 : area < 0.004 ? 2 : area < 0.01 ? 3 : area < 0.02 ? 4 : area < 0.035 ? 5 : area < 0.055 ? 6 : area < 0.08 ? 7 : 8
  return Math.max(1, Math.min(MAX_TERRITORIES, Math.max(fromPop, fromArea)))
}

export function territorySpread(area: number): number {
  return clamp(Math.sqrt(Math.max(area, 0)) * 90, 0.4, 28)
}

function wrapLng(lng: number): number {
  let x = lng
  while (x > 180) x -= 360
  while (x < -180) x += 360
  return x
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
  const n = Math.max(1, Math.min(MAX_TERRITORIES, count))
  const spread = territorySpread(region.area)
  const out: Territory[] = []
  for (let i = 0; i < n; i++) {
    const [dLat, dLng] = OFFSETS[i] ?? [0, 0]
    out.push({
      id: territoryId(region.id, i),
      regionId: region.id,
      name: territoryName(region.name, i),
      lat: clamp(region.lat + dLat * spread, -85, 85),
      lng: wrapLng(region.lng + dLng * spread),
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
