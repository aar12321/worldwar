import { geoCentroid, geoContains } from 'd3-geo'
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
      const closed = close(ring)
      if (closed.length < 4 || !localRing(closed)) return
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
      if (buckets.has(site.id)) continue
      const d = 0.45
      push(site.id, [
        [site.lng, site.lat],
        [site.lng + d, site.lat + d * 0.55],
        [site.lng, site.lat + d],
        [site.lng - d, site.lat + d * 0.55],
      ])
    }
    for (const site of sites) {
      const rings = buckets.get(site.id)
      if (rings?.length) out.push(featureFor(site, regionId, rings))
    }
  }
  return out
}
