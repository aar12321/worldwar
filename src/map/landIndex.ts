import { geoContains } from 'd3-geo'
import type { Position } from 'geojson'
import { buildTerritoryMesh, type LandFeature } from './territoryMesh'
import { getWorld, type CountryFeature } from './world'

type Shape = CountryFeature | LandFeature

interface Entry {
  feature: Shape
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
  area: number
}

const CELL = 12

function outers(feature: Shape): Position[][] {
  return feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates[0]] : feature.geometry.coordinates.map((poly) => poly[0])
}

function measure(feature: Shape): Entry {
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  let area = 0
  for (const ring of outers(feature)) {
    if (!ring) continue
    let sum = 0
    for (let i = 0; i < ring.length; i++) {
      const [lng, lat] = ring[i]
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      const next = ring[(i + 1) % ring.length]
      sum += lng * next[1] - next[0] * lat
    }
    area += Math.abs(sum / 2)
  }
  return { feature, minLng, maxLng, minLat, maxLat, area }
}

/** Grid lookup so a click does not walk every country. */
export function buildLocator(features: Shape[]) {
  const grid = new Map<string, Entry[]>()
  for (const feature of features) {
    const entry = measure(feature)
    if (!Number.isFinite(entry.minLng)) continue
    const x0 = Math.floor(entry.minLng / CELL)
    const x1 = Math.floor(entry.maxLng / CELL)
    const y0 = Math.floor(entry.minLat / CELL)
    const y1 = Math.floor(entry.maxLat / CELL)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x}:${y}`
        const bucket = grid.get(key)
        if (bucket) bucket.push(entry)
        else grid.set(key, [entry])
      }
    }
  }
  return (lng: number, lat: number): Shape | null => {
    let best: Entry | null = null
    for (const shift of [0, 360, -360]) {
      const x = lng + shift
      const bucket = grid.get(`${Math.floor(x / CELL)}:${Math.floor(lat / CELL)}`)
      if (!bucket) continue
      for (const entry of bucket) {
        if (lat < entry.minLat || lat > entry.maxLat || x < entry.minLng || x > entry.maxLng) continue
        if (best && entry.area >= best.area) continue
        if (geoContains(entry.feature, [x, lat])) best = entry
      }
    }
    return best?.feature ?? null
  }
}

const world = getWorld()
export const countryFeatures = world.features
export const territoryMesh = buildTerritoryMesh(world.features, world.map)
export const locateCountry = buildLocator(countryFeatures)
export const locateTerritory = buildLocator(territoryMesh)
