import { geoEquirectangular, geoPath } from 'd3-geo'
import type { Position } from 'geojson'
import type { CanvasTexture, MeshLambertMaterial } from 'three'
import { mapColor } from '../data/mapColors'
import { territoryOwner } from '../engine/territory'
import type { GameState } from '../engine/types'
import { territoryMesh } from '../map/landIndex'
import type { LandFeature } from '../map/territoryMesh'
import { getWorld, type CountryFeature } from '../map/world'
import { wash } from './colors'

const { map } = getWorld()

/** Equirectangular plate. 2048 is enough once borders are drawn as lines on top. */
export const POLITICAL_WIDTH = 2048
export const POLITICAL_HEIGHT = 1024

const projection = geoEquirectangular()
  .scale(POLITICAL_WIDTH / (2 * Math.PI))
  .translate([POLITICAL_WIDTH / 2, POLITICAL_HEIGHT / 2])
  .precision(0.5)

type Shape = CountryFeature | LandFeature

const areas = new WeakMap<Shape, number>()

function areaOf(feature: Shape): number {
  const cached = areas.get(feature)
  if (cached !== undefined) return cached
  const rings = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates[0]] : feature.geometry.coordinates.map((poly) => poly[0])
  let area = 0
  for (const ring of rings) {
    if (!ring) continue
    let sum = 0
    for (let i = 0; i < ring.length; i++) {
      const next = ring[(i + 1) % ring.length]
      sum += ring[i][0] * next[1] - next[0] * ring[i][1]
    }
    area += Math.abs(sum / 2)
  }
  areas.set(feature, area)
  return area
}

function menuColor(regionId: string): string {
  const index = map.order.indexOf(regionId)
  return mapColor(index < 0 ? 0 : index)
}

/** The flat color baked into the globe texture. Selection and attack tints stay on the live overlay. */
export function landFill(game: GameState | null, feature: Shape, concealed: ReadonlyMap<string, string>, hiddenRegions: ReadonlyMap<string, string>): string {
  const id = feature.properties.regionId
  const terrain = map.regions[id]?.terrain ?? 'plains'
  if (!game) return wash(menuColor(id), terrain)
  const territoryId = 'territoryId' in feature.properties ? feature.properties.territoryId : undefined
  const hidden = territoryId ? concealed.get(territoryId) : undefined
  if (hidden) return wash(hidden, terrain)
  if (territoryId) {
    const owner = game.nations[territoryOwner(game, map, territoryId)]?.color
    if (owner) return wash(owner, terrain)
  }
  return wash(hiddenRegions.get(id) ?? game.nations[game.regions[id]?.owner]?.color ?? '#8d6b4a', terrain)
}

/** Changes only when the baked colors change. Army movement does not repaint the map. */
export function politicalKey(game: GameState | null, concealed: ReadonlyMap<string, string>, hiddenRegions: ReadonlyMap<string, string>): string {
  if (!game) return 'menu'
  let out = ''
  for (const id of Object.keys(game.regions).sort()) out += `${id}:${game.regions[id].owner};`
  const held = game.territoryOwners
  if (held) for (const id of Object.keys(held).sort()) out += `${id}=${held[id]},`
  const extra: string[] = []
  for (const [id, color] of concealed) extra.push(`${id}:${color}`)
  for (const [id, color] of hiddenRegions) extra.push(`${id}!${color}`)
  extra.sort()
  return `${out}#${extra.join(';')}`
}

function polygonsOf(feature: Shape): Position[][][] {
  return feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
}

function crossesFrame(ring: Position[], shift: number): boolean {
  let min = Infinity
  let max = -Infinity
  for (const [lng] of ring) {
    const x = lng + shift
    if (x < min) min = x
    if (x > max) max = x
  }
  return max >= -180 && min <= 180
}

/** Draws every territory onto one equirectangular plate. Copies shifted by 360 degrees cover the date line. */
export function paintPoliticalMap(canvas: HTMLCanvasElement, features: Shape[], colorOf: (feature: Shape) => string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const path = geoPath(projection, ctx)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#16375f'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const ordered = [...features].sort((a, b) => areaOf(b) - areaOf(a))
  for (const feature of ordered) {
    ctx.fillStyle = colorOf(feature)
    for (const poly of polygonsOf(feature)) {
      const ring = poly[0]
      if (!ring || ring.length < 4) continue
      for (const shift of [0, -360, 360]) {
        if (!crossesFrame(ring, shift)) continue
        const moved = poly.map((part) => part.map(([lng, lat]) => [lng + shift, lat] as Position))
        ctx.beginPath()
        path({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: moved } })
        ctx.fill()
      }
    }
  }
}

export interface PoliticalSlot {
  canvas: HTMLCanvasElement
  texture: CanvasTexture
  key: string
}

/** Repaints the shared plate when ownership changes and points the globe material at it. */
export function syncPoliticalTexture(material: MeshLambertMaterial, slot: PoliticalSlot, key: string, game: GameState | null, concealed: ReadonlyMap<string, string>, hiddenRegions: ReadonlyMap<string, string>) {
  if (slot.key === key) return
  slot.key = key
  paintPoliticalMap(slot.canvas, territoryMesh, (feature) => landFill(game, feature, concealed, hiddenRegions))
  slot.texture.needsUpdate = true
  if (material.map !== slot.texture) {
    material.map = slot.texture
    material.color.set('#ffffff')
    material.emissive.set('#000000')
    material.needsUpdate = true
  }
}
