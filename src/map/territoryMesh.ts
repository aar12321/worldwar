import { geoArea, geoCentroid, geoContains } from 'd3-geo'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import type { Territory, WorldMap } from '../engine/types'
import type { CountryFeature } from './world'

export interface LandFeature extends Feature<Polygon | MultiPolygon, { name: string; regionId: string; territoryId: string }> {}

const INNER = 0.42

function ringArea(ring: Position[]): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return Math.abs(sum / 2)
}

function polygonsOf(feature: CountryFeature): Position[][][] {
  return feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
}

function unwrap(ring: Position[], centerLng: number): Position[] {
  return ring.map(([lng, lat]) => {
    let x = lng
    while (x - centerLng > 180) x -= 360
    while (centerLng - x > 180) x += 360
    return [x, lat]
  })
}

function lerp(a: Position, b: Position, t: number): Position {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function dist2(lng: number, lat: number, site: Territory): number {
  let dx = site.lng - lng
  if (dx > 180) dx -= 360
  if (dx < -180) dx += 360
  const dy = site.lat - lat
  return dx * dx + dy * dy
}

function localRing(ring: Position[]): boolean {
  let min = Infinity
  let max = -Infinity
  for (const point of ring) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false
    if (point[0] < min) min = point[0]
    if (point[0] > max) max = point[0]
  }
  return max - min < 180
}

function close(ring: Position[]): Position[] {
  if (ring.length < 3) return ring
  const a = ring[0]
  const b = ring[ring.length - 1]
  if (a[0] === b[0] && a[1] === b[1]) return ring
  return [...ring, [a[0], a[1]]]
}

/**
 * A backwards ring is the rest of the planet. three-globe then paints that
 * territory across the ocean and every other country.
 */
function smallRing(ring: Position[]): Position[] | null {
  const closed = close(ring)
  if (closed.length < 4 || !localRing(closed)) return null
  const reversed = close(closed.slice(0, -1).reverse())
  const areaOf = (coords: Position[]) => geoArea({ type: 'Polygon', coordinates: [coords] })
  const forward = areaOf(closed)
  const back = areaOf(reversed)
  const chosen = forward <= back ? closed : reversed
  if (Math.min(forward, back) > 2) return null
  return chosen
}

/** Even samples so a fjord does not become thousands of separate meshes. */
function simplify(ring: Position[], max = 72): Position[] {
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice()
  if (open.length <= max) return close(open)
  const step = open.length / max
  const out: Position[] = []
  for (let i = 0; i < max; i++) out.push(open[Math.floor(i * step)])
  return close(out)
}

function nearestSite(sites: Territory[], lng: number, lat: number): Territory {
  let best = sites[0]
  let bestD = dist2(lng, lat, best)
  for (let i = 1; i < sites.length; i++) {
    const d = dist2(lng, lat, sites[i])
    if (d < bestD) {
      bestD = d
      best = sites[i]
    }
  }
  return best
}

function wrapLng(lng: number): number {
  let x = lng
  while (x > 180) x -= 360
  while (x < -180) x += 360
  return x
}

function ringsArea(rings: Position[][]): number {
  if (!rings.length) return 0
  if (rings.length === 1) return geoArea({ type: 'Polygon', coordinates: [rings[0]] })
  return geoArea({ type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) })
}

/** A three-point fallback is a speck. It cannot be clicked on the globe. */
function isSpeck(rings: Position[][]): boolean {
  return rings.length === 1 && rings[0].length <= 5 && ringsArea(rings) < 0.001
}

function pair(point: Position): [number, number] {
  return [point[0], point[1]]
}

function ringFits(feature: CountryFeature, ring: Position[]): boolean {
  const open = ring.slice(0, -1)
  if (open.length < 3 || !open.every((point) => geoContains(feature, pair(point)))) return false
  for (let i = 0; i < open.length; i++) {
    const a = open[i]
    const b = open[(i + 1) % open.length]
    for (const t of [0.25, 0.5, 0.75]) if (!geoContains(feature, pair(lerp(a, b, t)))) return false
  }
  const mid = lerp(lerp(open[0], open[1], 0.5), open[2], 0.45)
  return geoContains(feature, pair(mid))
}

/** Largest triangle around a missed district that still sits inside the country. */
function patchInside(feature: CountryFeature, site: Territory): Position[] | null {
  for (const d of [5, 3.6, 2.6, 1.8, 1.2, 0.8]) {
    const ring = close([
      [wrapLng(site.lng - d), site.lat - d * 0.62],
      [wrapLng(site.lng + d), site.lat - d * 0.62],
      [wrapLng(site.lng), Math.max(-85, Math.min(85, site.lat + d * 0.95))],
    ])
    const chosen = smallRing(ring)
    if (chosen && ringFits(feature, chosen)) return chosen
  }
  return null
}

function featureFor(site: Territory, regionId: string, rings: Position[][]): LandFeature {
  return {
    type: 'Feature',
    properties: { name: site.name, regionId, territoryId: site.id },
    geometry: rings.length === 1 ? { type: 'Polygon', coordinates: [rings[0]] } : { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) },
  }
}

/** Cuts each country into one shape per territory so ownership can recolor the map. */
export function buildTerritoryMesh(features: CountryFeature[], map: Pick<WorldMap, 'territories' | 'territoriesByRegion'>): LandFeature[] {
  const out: LandFeature[] = []
  for (const feature of features) {
    const regionId = feature.properties.regionId
    const sites = (map.territoriesByRegion[regionId] ?? []).map((id) => map.territories[id]).filter(Boolean)
    if (!sites.length) continue
    const heart = sites.find((site) => site.index === 0) ?? sites[0]
    const outer = sites.filter((site) => site.id !== heart.id)
    if (!outer.length) {
      out.push({ type: 'Feature', properties: { name: heart.name, regionId, territoryId: heart.id }, geometry: feature.geometry })
      continue
    }
    const parts = polygonsOf(feature)
      .map((coords) => coords[0])
      .filter((ring) => ring && ring.length >= 4)
      .sort((a, b) => ringArea(b) - ringArea(a))
    if (!parts.length) continue
    const buckets = new Map<string, Position[][]>()
    const push = (id: string, ring: Position[]) => {
      const closed = smallRing(ring)
      if (!closed) return
      const list = buckets.get(id) ?? []
      list.push(closed)
      buckets.set(id, list)
    }
    parts.forEach((raw, index) => {
      const centerLng = raw.reduce((sum, p) => sum + p[0], 0) / raw.length
      const ring = simplify(unwrap(close(raw), centerLng))
      if (index > 0) {
        const mid = ring[Math.floor(ring.length / 2)]
        push(nearestSite(sites, mid[0], mid[1]).id, ring)
        return
      }
      const poly = { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } }
      let [clng, clat] = geoCentroid(poly)
      if (!Number.isFinite(clng) || !geoContains(poly, [clng, clat])) {
        clng = ring.reduce((sum, p) => sum + p[0], 0) / ring.length
        clat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length
      }
      const center: Position = [clng, clat]
      const n = ring.length - 1
      const inner = ring.slice(0, n).map((point) => lerp(center, point, INNER))
      push(heart.id, close(inner))
      const owners = ring.slice(0, n).map((point, i) => {
        const next = ring[(i + 1) % n]
        const probe = lerp(center, lerp(point, next, 0.5), (1 + INNER) / 2)
        return nearestSite(outer, probe[0], probe[1])
      })
      const band = (from: number, len: number) => {
        const outerPts: Position[] = []
        const innerPts: Position[] = []
        for (let j = 0; j <= len; j++) {
          const idx = (from + j) % n
          outerPts.push(ring[idx])
          innerPts.push(inner[idx])
        }
        return close([...outerPts, ...innerPts.reverse()])
      }
      const same = owners.every((site) => site.id === owners[0].id)
      if (same) {
        push(owners[0].id, band(0, n - 1))
        return
      }
      let start = 0
      const prevId = owners[n - 1].id
      while (start < n && owners[start].id === prevId) start++
      let cursor = start
      for (let seen = 0; seen < n; ) {
        const id = owners[cursor].id
        let len = 1
        while (len < n - seen && owners[(cursor + len) % n].id === id) len++
        push(id, band(cursor, len))
        cursor = (cursor + len) % n
        seen += len
      }
    })
    for (const site of sites) {
      const existing = buckets.get(site.id)
      if (existing && !isSpeck(existing)) continue
      if (!geoContains(feature, [site.lng, site.lat])) continue
      const patch = patchInside(feature, site)
      if (patch) buckets.set(site.id, [patch])
      else if (!existing) {
        const d = 0.35
        push(site.id, [
          [site.lng - d, site.lat],
          [site.lng, site.lat + d],
          [site.lng + d, site.lat],
        ])
      }
    }
    for (const site of sites) {
      const rings = buckets.get(site.id)
      if (rings?.length) out.push(featureFor(site, regionId, rings))
    }
  }
  return out
}
