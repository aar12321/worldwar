import { geoContains, geoCentroid } from 'd3-geo'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
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

function exteriorRings(feature: Feature<Polygon | MultiPolygon>): Position[][] {
  if (feature.geometry.type === 'Polygon') return [feature.geometry.coordinates[0]].filter((ring) => ring && ring.length >= 4)
  return feature.geometry.coordinates.map((polygon) => polygon[0]).filter((ring) => ring && ring.length >= 4)
}

function ringSpan(ring: Position[]): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return Math.abs(sum / 2)
}

/** A point that is actually on the land. A country's centroid can fall in a bay. */
function interiorPoint(feature: Feature<Polygon | MultiPolygon>, fallbackLat: number, fallbackLng: number): { lat: number; lng: number } {
  const centroid = geoCentroid(feature)
  if (Number.isFinite(centroid[0]) && Number.isFinite(centroid[1]) && geoContains(feature, centroid)) return { lat: centroid[1], lng: centroid[0] }
  const rings = exteriorRings(feature).sort((a, b) => ringSpan(b) - ringSpan(a))
  for (const ring of rings) {
    const finite = ring.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    if (finite.length < 3) continue
    const midLng = finite.reduce((sum, point) => sum + point[0], 0) / finite.length
    const midLat = finite.reduce((sum, point) => sum + point[1], 0) / finite.length
    const step = Math.max(1, Math.floor(finite.length / 28))
    for (let i = 0; i < finite.length; i += step) {
      const point = finite[i]
      for (const t of [0.25, 0.5, 0.75]) {
        const lng = point[0] + (midLng - point[0]) * t
        const lat = point[1] + (midLat - point[1]) * t
        if (geoContains(feature, [lng, lat])) return { lat, lng: wrapLng(lng) }
      }
    }
  }
  return { lat: fallbackLat, lng: fallbackLng }
}

function lngDelta(a: number, b: number): number {
  let d = a - b
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

/** Walk from the heart toward a compass point and stop before the border. */
function placeSpread(
  feature: Feature<Polygon | MultiPolygon>,
  heartLat: number,
  heartLng: number,
  dLat: number,
  dLng: number,
  used: { lat: number; lng: number }[],
): { lat: number; lng: number } {
  const desired = Math.hypot(dLat, dLng) || 1
  let best = { lat: heartLat, lng: heartLng, score: -1 }
  for (const deg of [0, 18, -18, 36, -36, 60, -60, 90, -90, 130, -130, 180]) {
    const rad = (deg * Math.PI) / 180
    const oLat = dLat * Math.cos(rad) - dLng * Math.sin(rad)
    const oLng = dLat * Math.sin(rad) + dLng * Math.cos(rad)
    const targetLat = clamp(heartLat + oLat, -85, 85)
    const targetLng = heartLng + oLng
    const at = (t: number) => ({
      lat: heartLat + (targetLat - heartLat) * t,
      lng: wrapLng(heartLng + (targetLng - heartLng) * t),
    })
    let bestT = 0
    for (let step = 1; step <= 16; step++) {
      const t = step / 16
      const sample = at(t)
      if (geoContains(feature, [sample.lng, sample.lat])) bestT = t
    }
    const pulled = at(bestT * 0.9)
    const point = geoContains(feature, [pulled.lng, pulled.lat]) ? pulled : at(bestT)
    const lat = point.lat
    const lng = point.lng
    const dist = Math.hypot(lat - heartLat, lngDelta(lng, heartLng))
    const separated = used.every((point) => Math.hypot(point.lat - lat, lngDelta(point.lng, lng)) > 0.3)
    const score = dist + (deg === 0 ? desired * 0.08 : 0) + (separated ? desired * 0.12 : 0)
    if (score > best.score) best = { lat, lng, score }
  }
  return { lat: best.lat, lng: best.lng }
}

export function musterTerritories(
  region: MapRegion,
  count = territoryCount(region.basePopulation, region.area),
  feature?: Feature<Polygon | MultiPolygon>,
): Territory[] {
  const n = Math.max(1, Math.min(MAX_TERRITORIES, count))
  const spread = territorySpread(region.area)
  const heart = feature ? interiorPoint(feature, region.lat, region.lng) : { lat: region.lat, lng: region.lng }
  const used: { lat: number; lng: number }[] = []
  const out: Territory[] = []
  for (let i = 0; i < n; i++) {
    const [dLat, dLng] = OFFSETS[i] ?? [0, 0]
    const point =
      i === 0
        ? heart
        : feature
          ? placeSpread(feature, heart.lat, heart.lng, dLat * spread, dLng * spread, used)
          : { lat: clamp(heart.lat + dLat * spread, -85, 85), lng: wrapLng(heart.lng + dLng * spread) }
    used.push(point)
    out.push({
      id: territoryId(region.id, i),
      regionId: region.id,
      name: territoryName(region.name, i),
      lat: point.lat,
      lng: point.lng,
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
