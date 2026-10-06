import { geoInterpolate } from 'd3-geo'
import { useEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import { TERRAIN } from '../data/terrain'
import { armiesIn, totalUnits } from '../engine/helpers'
import { supplyDistances, supplyRange } from '../engine/supply'
import type { Army, GameState, RegionId, UnitType } from '../engine/types'
import { visibleArmies, visibleRegions } from '../engine/visibility'
import { canReach } from '../engine/warfare'
import { getWorld, type CountryFeature } from '../map/world'
import { useGame } from '../store'
import { NEON, tint, withAlpha } from './colors'
import { globeBridge, useFx } from './globeBridge'

const { map, features } = getWorld()
const UP = new THREE.Vector3(0, 1, 0)
const MARCH_MS = 1600

type LayerDatum =
  | { kind: 'army'; key: string; army: Army; lat: number; lng: number; color: string; march: { from: [number, number]; to: [number, number] } | null }
  | { kind: 'smoke'; key: string; lat: number; lng: number; intensity: number }

interface Arc {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  color: string[]
  stroke: number
  dash: number
  gap: number
  speed: number
  label: string
}

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

let smokeTexture: THREE.Texture | null = null
function getSmokeTexture() {
  if (smokeTexture) return smokeTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.4, 'rgba(200,210,230,0.45)')
  g.addColorStop(1, 'rgba(160,170,190,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  smokeTexture = new THREE.CanvasTexture(c)
  return smokeTexture
}

const unitGeometries: Record<UnitType, THREE.BufferGeometry> = {
  infantry: new THREE.CylinderGeometry(0.28, 0.36, 1.1, 8),
  armor: new THREE.BoxGeometry(0.9, 0.5, 0.6),
  air: new THREE.ConeGeometry(0.35, 1, 4),
  naval: new THREE.BoxGeometry(1.1, 0.3, 0.4),
}

function buildArmyObject(d: Extract<LayerDatum, { kind: 'army' }>): THREE.Object3D {
  const group = new THREE.Group()
  const color = new THREE.Color().setStyle(d.color)
  const mat = new THREE.MeshLambertMaterial({ color, emissive: color.clone().multiplyScalar(0.55) })
  const total = totalUnits(d.army.units)
  const scale = Math.min(2.4, 0.7 + Math.sqrt(total) * 0.22)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }))
  group.add(base)
  const present = (['infantry', 'armor', 'air', 'naval'] as UnitType[]).filter((k) => d.army.units[k] >= 0.5)
  present.forEach((k, i) => {
    const m = new THREE.Mesh(unitGeometries[k], mat)
    const offset = (i - (present.length - 1) / 2) * 0.75
    m.position.set(offset, k === 'air' ? 1.5 : 0.5, 0)
    if (k === 'air') m.rotation.z = Math.PI
    group.add(m)
  })
  group.scale.setScalar(scale)
  group.userData = { datum: d, phase: Math.random() * Math.PI * 2 }
  return group
}

function buildSmokeObject(d: Extract<LayerDatum, { kind: 'smoke' }>): THREE.Object3D {
  const group = new THREE.Group()
  const count = Math.min(5, 2 + Math.floor(d.intensity / 3))
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: getSmokeTexture(), transparent: true, depthWrite: false, opacity: 0 }))
    sprite.userData = { offset: i / count, drift: (Math.random() - 0.5) * 0.6 }
    group.add(sprite)
  }
  group.userData = { datum: d }
  return group
}

function placeOnGlobe(obj: THREE.Object3D, lat: number, lng: number, alt: number) {
  const api = globeBridge.api
  if (!api) return
  const p = api.getCoords(lat, lng, alt)
  obj.position.set(p.x, p.y, p.z)
  obj.quaternion.setFromUnitVectors(UP, obj.position.clone().normalize())
}

function regionColor(game: GameState | null, id: RegionId): string {
  if (!game) {
    const t = map.regions[id].terrain
    const base = { plains: '#1e3a5f', forest: '#1b4d4a', mountain: '#3b3355', desert: '#4a3f2a', urban: '#2f3f63' }[t]
    return base
  }
  return game.nations[game.regions[id].owner]?.color ?? '#334155'
}

export function WorldGlobe() {
  const game = useGame((s) => s.game)
  const orders = useGame((s) => s.orders)
  const selectedRegion = useGame((s) => s.selectedRegion)
  const selectedArmy = useGame((s) => s.selectedArmy)
  const targetMode = useGame((s) => s.targetMode)
  const marches = useGame((s) => s.marches)
  const marchStamp = useGame((s) => s.marchStamp)
  const reducedMotion = useGame((s) => s.settings.reducedMotion)
  const clickRegion = useGame((s) => s.clickRegion)
  const rings = useFx((s) => s.rings)
  const ref = useRef<GlobeMethods | undefined>(undefined)
  const [hover, setHover] = useState<RegionId | null>(null)
  const { w, h } = useWindowSize()
  const animated = useRef(new Set<THREE.Object3D>())

  const globeMaterial = useMemo(
    () => new THREE.MeshPhongMaterial({ color: new THREE.Color('#030916'), emissive: new THREE.Color('#041026'), shininess: 12, specular: new THREE.Color('#0e7490') }),
    [],
  )

  useEffect(() => {
    const api = ref.current
    if (!api) return
    globeBridge.api = api
    const controls = api.controls()
    controls.autoRotate = !game
    controls.autoRotateSpeed = 0.35
  }, [game])

  const playerId = game?.playerId ?? null
  const gameStarted = !!game
  useEffect(() => {
    const api = ref.current
    if (!api || !gameStarted || !playerId) return
    const cap = map.regions[playerId]
    api.pointOfView({ lat: cap.lat, lng: cap.lng, altitude: 1.9 }, 1500)
  }, [gameStarted, playerId])

  const reachable = useMemo(() => {
    const out = new Set<RegionId>()
    if (!game || !selectedArmy || !targetMode) return out
    const a = game.armies[selectedArmy]
    if (!a) return out
    for (const id of [...map.regions[a.location].neighbors, ...map.regions[a.location].seaLanes, a.location]) {
      const owner = game.regions[id].owner
      const mine = owner === game.playerId
      if (targetMode === 'move' && mine && id !== a.location && canReach(game, map, game.playerId, a.location, id, 'move').ok) out.add(id)
      if (targetMode === 'attack' && canReach(game, map, game.playerId, a.location, id, 'attack').ok && (!mine || game.regions[id].rebels > 0)) out.add(id)
    }
    return out
  }, [game, selectedArmy, targetMode])

  const polygonColor = (f: object) => {
    const id = (f as CountryFeature).properties.regionId
    const base = regionColor(game, id)
    if (reachable.has(id)) return tint(targetMode === 'attack' ? NEON.magenta : NEON.cyan, hover === id ? 0.1 : -0.05)
    if (id === selectedRegion) return tint(base, 0.18, 0.1)
    if (id === hover) return tint(base, 0.1)
    return base
  }
  const polygonAltitude = (f: object) => {
    const id = (f as CountryFeature).properties.regionId
    if (id === selectedRegion) return 0.035
    if (reachable.has(id)) return 0.025
    if (id === hover) return 0.018
    if (game && game.regions[id].owner === game.playerId) return 0.012
    return 0.007
  }
  const polygonStroke = (f: object) => {
    const id = (f as CountryFeature).properties.regionId
    if (id === selectedRegion) return '#ffffff'
    if (game && game.regions[id].owner === game.playerId) return withAlpha(NEON.cyan, 0.9)
    return 'rgba(8, 12, 28, 0.9)'
  }
  const polygonLabel = (f: object) => {
    const id = (f as CountryFeature).properties.regionId
    const mr = map.regions[id]
    if (!game) return `<div class="globe-tip"><b>${mr.name}</b></div>`
    const owner = game.nations[game.regions[id].owner]
    const vis = visibleRegions(game, map, game.playerId)
    const armies = vis === 'all' || vis.has(id) ? armiesIn(game, id).reduce((s, a) => s + totalUnits(a.units), 0) : null
    const rebels = game.regions[id].rebels
    return `<div class="globe-tip"><b>${mr.name}</b><div style="color:${owner.color}">${owner.name}</div><div>${TERRAIN[mr.terrain].name} · ${game.regions[id].population.toFixed(1)}M</div>${armies === null ? '<div class="dim">Armies: unknown</div>' : `<div>Divisions: ${armies.toFixed(1)}</div>`}${rebels > 0 ? `<div style="color:${NEON.red}">Rebels: ${rebels.toFixed(1)}</div>` : ''}</div>`
  }

  const arcs = useMemo<Arc[]>(() => {
    if (!game) return []
    const out: Arc[] = []
    for (const o of orders) {
      if (o.type !== 'move' && o.type !== 'attack') continue
      const a = game.armies[o.armyId]
      if (!a) continue
      const from = map.regions[a.location]
      const to = map.regions[o.type === 'move' ? o.to : o.target]
      if (from.id === to.id) continue
      const c = o.type === 'attack' ? NEON.magenta : NEON.cyan
      out.push({ startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng, color: [withAlpha(c, 0.25), c], stroke: o.type === 'attack' ? 0.9 : 0.6, dash: 0.35, gap: 0.12, speed: 900, label: `${o.type === 'attack' ? 'Attack' : 'Move'}: ${to.name}` })
    }
    const p = game.nations[game.playerId]
    if (p.alive) {
      const dist = supplyDistances(game, map, p.id)
      const range = supplyRange(game, p.id)
      const cap = map.regions[p.capital]
      const seen = new Set<RegionId>()
      for (const a of Object.values(game.armies)) {
        if (a.owner !== p.id || a.location === p.capital || seen.has(a.location)) continue
        seen.add(a.location)
        const d = dist.get(a.location)
        const ok = d !== undefined && d <= range
        const to = map.regions[a.location]
        out.push({ startLat: cap.lat, startLng: cap.lng, endLat: to.lat, endLng: to.lng, color: ok ? [withAlpha(NEON.green, 0.05), withAlpha(NEON.green, 0.5)] : [withAlpha(NEON.red, 0.1), NEON.red], stroke: 0.25, dash: 0.08, gap: 0.04, speed: 4000, label: ok ? `Supply line to ${to.name} (${d}/${range})` : `${to.name}: OUT OF SUPPLY` })
      }
    }
    for (const b of game.battles) {
      if (!b.fromRegionId) continue
      if (b.attacker.nationId !== game.playerId && b.defender.nationId !== game.playerId) continue
      const from = map.regions[b.fromRegionId]
      const to = map.regions[b.regionId]
      out.push({ startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng, color: [withAlpha(NEON.amber, 0.1), NEON.amber], stroke: 0.5, dash: 1, gap: 0, speed: 0, label: `Battle of ${to.name}` })
    }
    if (selectedRegion && !targetMode) {
      const r = map.regions[selectedRegion]
      for (const id of r.seaLanes) {
        const to = map.regions[id]
        out.push({ startLat: r.lat, startLng: r.lng, endLat: to.lat, endLng: to.lng, color: [withAlpha('#93c5fd', 0.05), withAlpha('#93c5fd', 0.35)], stroke: 0.15, dash: 0.02, gap: 0.02, speed: 6000, label: `Sea lane: ${r.name} to ${to.name}` })
      }
    }
    return out
  }, [game, orders, selectedRegion, targetMode])

  const layerData = useMemo<LayerDatum[]>(() => {
    if (!game) return []
    const out: LayerDatum[] = []
    const marchById = new Map(marches.map((m) => [m.armyId, m]))
    const perRegion = new Map<RegionId, number>()
    for (const a of visibleArmies(game, map, game.playerId)) {
      const idx = perRegion.get(a.location) ?? 0
      perRegion.set(a.location, idx + 1)
      const r = map.regions[a.location]
      const angle = idx * 2.1
      const lat = r.lat + (idx ? Math.sin(angle) * 1.6 : 0)
      const lng = r.lng + (idx ? Math.cos(angle) * 1.6 : 0)
      const m = marchById.get(a.id)
      const from = m ? map.regions[m.from] : null
      out.push({ kind: 'army', key: a.id, army: a, lat, lng, color: game.nations[a.owner]?.color ?? '#94a3b8', march: from ? { from: [from.lng, from.lat], to: [lng, lat] } : null })
    }
    const vis = visibleRegions(game, map, game.playerId)
    for (const r of Object.values(game.regions)) {
      const f = r.buildings.factory
      if (f < 2 || r.sabotaged > 0) continue
      if (vis !== 'all' && !vis.has(r.id) && r.owner !== game.playerId && f < 6) continue
      const mr = map.regions[r.id]
      out.push({ kind: 'smoke', key: `smoke-${r.id}`, lat: mr.lat - 1.2, lng: mr.lng + 1.4, intensity: f })
    }
    return out
  }, [game, marches])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const now = performance.now()
      for (const obj of animated.current) {
        if (!obj.parent) {
          animated.current.delete(obj)
          continue
        }
        const d = obj.userData.datum as LayerDatum
        if (d.kind === 'army') {
          let lat = d.lat
          let lng = d.lng
          let alt = 0.012
          if (d.march && !reducedMotion) {
            const t = Math.min(1, (now - marchStamp) / MARCH_MS)
            const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
            const [x, y] = geoInterpolate(d.march.from, d.march.to)(e)
            lng = x
            lat = y
            alt += Math.sin(Math.PI * e) * 0.04
          }
          placeOnGlobe(obj, lat, lng, alt)
          if (!reducedMotion) obj.rotateY(Math.sin(now / 900 + obj.userData.phase) * 0.15)
        } else if (d.kind === 'smoke') {
          placeOnGlobe(obj, d.lat, d.lng, 0.01)
          for (const child of obj.children) {
            const s = child as THREE.Sprite
            const { offset, drift } = s.userData
            const cycle = reducedMotion ? 0.5 : ((now / 3200 + offset) % 1)
            s.position.set(drift * cycle * 2, 0.4 + cycle * 3.2, 0)
            s.scale.setScalar(0.5 + cycle * 1.8)
            ;(s.material as THREE.SpriteMaterial).opacity = Math.sin(Math.PI * cycle) * 0.45
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [marchStamp, reducedMotion])

  return (
    <Globe
      ref={ref}
      width={w}
      height={h}
      backgroundColor="rgba(0,0,0,0)"
      globeMaterial={globeMaterial}
      showGraticules
      atmosphereColor={NEON.cyan}
      atmosphereAltitude={0.2}
      polygonsData={features}
      polygonCapColor={polygonColor}
      polygonSideColor={() => 'rgba(2, 6, 23, 0.75)'}
      polygonStrokeColor={polygonStroke}
      polygonAltitude={polygonAltitude}
      polygonLabel={polygonLabel}
      polygonsTransitionDuration={reducedMotion ? 0 : 250}
      onPolygonClick={(f) => clickRegion((f as CountryFeature).properties.regionId)}
      onPolygonHover={(f) => setHover(f ? (f as CountryFeature).properties.regionId : null)}
      arcsData={arcs}
      arcColor="color"
      arcStroke="stroke"
      arcDashLength="dash"
      arcDashGap="gap"
      arcDashAnimateTime={(a: object) => (reducedMotion ? 0 : (a as Arc).speed)}
      arcAltitudeAutoScale={0.35}
      arcLabel="label"
      arcsTransitionDuration={0}
      customLayerData={layerData}
      customThreeObject={(d: object) => {
        const datum = d as LayerDatum
        const obj = datum.kind === 'army' ? buildArmyObject(datum) : buildSmokeObject(datum)
        animated.current.add(obj)
        return obj
      }}
      customThreeObjectUpdate={(obj: THREE.Object3D, d: object) => {
        obj.userData.datum = d
        animated.current.add(obj)
      }}
      ringsData={rings}
      ringColor={(r: object) => (t: number) => withAlpha((r as { color: string }).color, 1 - t)}
      ringMaxRadius="maxRadius"
      ringPropagationSpeed={6}
      ringRepeatPeriod={350}
    />
  )
}
