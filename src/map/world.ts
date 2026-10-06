import { geoArea, geoCentroid, geoDistance } from 'd3-geo'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { feature, neighbors } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import worldTopology from 'world-atlas/countries-110m.json'
import { COUNTRY_STATS, EXCLUDED_COUNTRIES, STRATEGIC_SEA_LANES } from '../data/countries'
import type { MapRegion, RegionId, WorldMap } from '../engine/types'

export type CountryFeature = Feature<Polygon | MultiPolygon, { name: string; regionId: RegionId }>

const EARTH_RADIUS_KM = 6371
const SEA_LANE_RANGE_KM = 1400
const MIN_SEA_LANES = 2

export function slugify(name: string): RegionId {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function largestPolygonCentroid(f: Feature<Polygon | MultiPolygon>): [number, number] {
  if (f.geometry.type === 'Polygon') return geoCentroid(f)
  let best: Polygon | null = null
  let bestArea = -1
  for (const coordinates of f.geometry.coordinates) {
    const poly: Polygon = { type: 'Polygon', coordinates }
    const a = geoArea(poly)
    if (a > bestArea) {
      bestArea = a
      best = poly
    }
  }
  return geoCentroid(best!)
}

function collectArcs(arcs: unknown, out: number[]) {
  if (typeof arcs === 'number') out.push(arcs < 0 ? ~arcs : arcs)
  else if (Array.isArray(arcs)) for (const a of arcs) collectArcs(a, out)
}

export interface BuiltWorld {
  map: WorldMap
  features: CountryFeature[]
}

export function buildWorld(): BuiltWorld {
  const topology = worldTopology as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>
  const allGeoms = topology.objects.countries.geometries
  const keepIdx = allGeoms
    .map((g, i) => [g, i] as const)
    .filter(([g]) => !EXCLUDED_COUNTRIES.has((g.properties as { name: string }).name))
    .map(([, i]) => i)

  const fc = feature(topology, topology.objects.countries) as FeatureCollection<Polygon | MultiPolygon, { name: string }>
  const adjacency = neighbors(allGeoms as never)

  const arcUse = new Map<number, number>()
  const geomArcs = allGeoms.map((g) => {
    const list: number[] = []
    collectArcs((g as unknown as { arcs?: unknown }).arcs, list)
    for (const a of list) arcUse.set(a, (arcUse.get(a) ?? 0) + 1)
    return list
  })

  const ids = allGeoms.map((g) => slugify((g.properties as { name: string }).name))
  const keepSet = new Set(keepIdx)
  const totalArea = keepIdx.reduce((sum, i) => sum + geoArea(fc.features[i]), 0)

  const regions: Record<RegionId, MapRegion> = {}
  const features: CountryFeature[] = []
  for (const i of keepIdx) {
    const f = fc.features[i]
    const name = f.properties.name
    const [lng, lat] = largestPolygonCentroid(f)
    const stat = COUNTRY_STATS[name]
    const area = geoArea(f) / totalArea
    const id = ids[i]
    regions[id] = {
      id,
      name,
      lat,
      lng,
      area,
      terrain: stat?.[2] ?? 'plains',
      coastal: geomArcs[i].some((a) => arcUse.get(a) === 1),
      neighbors: adjacency[i].filter((j) => keepSet.has(j)).map((j) => ids[j]),
      seaLanes: [],
      basePopulation: stat?.[0] ?? Math.max(0.5, area * 8000),
      development: stat?.[1] ?? 0.3,
    }
    features.push({ ...f, properties: { name, regionId: id } })
  }

  const coastal = Object.values(regions).filter((r) => r.coastal)
  const distKm = (a: MapRegion, b: MapRegion) => geoDistance([a.lng, a.lat], [b.lng, b.lat]) * EARTH_RADIUS_KM
  const addLane = (a: RegionId, b: RegionId) => {
    if (a === b || !regions[a] || !regions[b]) return
    if (regions[a].neighbors.includes(b)) return
    if (!regions[a].seaLanes.includes(b)) regions[a].seaLanes.push(b)
    if (!regions[b].seaLanes.includes(a)) regions[b].seaLanes.push(a)
  }
  for (const r of coastal) {
    const others = coastal
      .filter((o) => o.id !== r.id && !r.neighbors.includes(o.id))
      .map((o) => ({ o, d: distKm(r, o) }))
      .sort((x, y) => x.d - y.d)
    others.forEach(({ o, d }, idx) => {
      if (d <= SEA_LANE_RANGE_KM || idx < MIN_SEA_LANES) addLane(r.id, o.id)
    })
  }
  for (const [a, b] of STRATEGIC_SEA_LANES) addLane(slugify(a), slugify(b))
  for (const r of Object.values(regions)) {
    r.seaLanes.sort()
    r.neighbors.sort()
  }

  const order = Object.keys(regions).sort()
  return { map: { regions, order }, features }
}

let cached: BuiltWorld | null = null
export function getWorld(): BuiltWorld {
  if (!cached) cached = buildWorld()
  return cached
}
