import { geoInterpolate } from 'd3-geo'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import { TERRAIN } from '../data/terrain'
import { armiesIn, totalUnits } from '../engine/helpers'
import { supplyDistances, supplyRange } from '../engine/supply'
import type { Army, GameState, NationId, RegionId, UnitType } from '../engine/types'
import { visibleArmies, visibleRegions } from '../engine/visibility'
import { canReach } from '../engine/warfare'
import { getWorld, type CountryFeature } from '../map/world'
import { useGame } from '../store'
import { armyMarkerText } from './labels'
import { NEON, tint, withAlpha } from './colors'
import { globeBridge, useFx } from './globeBridge'

const { map, features } = getWorld()
const UP = new THREE.Vector3(0, 1, 0)
const OUTWARD = new THREE.Vector3()
const MARCH_MS = 1400
const REVEAL_MARCH_MS = 680
const EMPTY_REGIONS = new Set<RegionId>()

type MarchPath = { from: [number, number]; to: [number, number] }

type LayerDatum =
  | { kind: 'army'; key: string; signature: string; army: Army; lat: number; lng: number; color: string; hold: boolean; march: MarchPath | null; mine: boolean }
  | { kind: 'smoke'; key: string; signature: string; lat: number; lng: number; intensity: number }

interface Arc {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  color: string[]
  stroke: number | null
  dash: number
  gap: number
  speed: number
  label: string
}

interface MarchGate {
  held: boolean
  delayed: boolean
  start: number
}

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setSize({ w: window.innerWidth, h: window.innerHeight }))
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return size
}

/** three-globe disposes geometry, materials, and textures when a custom object is removed. Shared assets must survive that. */
function retain<T extends { dispose: () => void }>(resource: T): T {
  resource.dispose = () => {}
  return resource
}

function disableRaycast(obj: THREE.Object3D) {
  obj.raycast = () => {}
  for (const child of obj.children) disableRaycast(child)
}

let smokeTexture: THREE.Texture | null = null
function getSmokeTexture() {
  if (smokeTexture) return smokeTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.4, 'rgba(200,210,230,0.4)')
  g.addColorStop(1, 'rgba(160,170,190,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  smokeTexture = retain(new THREE.CanvasTexture(c))
  return smokeTexture
}

const unitGeometries: Record<UnitType, THREE.BufferGeometry> = {
  infantry: retain(new THREE.CylinderGeometry(0.28, 0.36, 1.1, 6)),
  armor: retain(new THREE.BoxGeometry(0.9, 0.5, 0.6)),
  air: retain(new THREE.ConeGeometry(0.35, 1, 4)),
  naval: retain(new THREE.BoxGeometry(1.1, 0.3, 0.4)),
}

const plateGeometry = retain(new THREE.CylinderGeometry(1, 1, 0.12, 16))
const plateMaterial = retain(new THREE.MeshBasicMaterial({ color: '#020617', transparent: true, opacity: 0.85 }))
const ringGeometry = retain(new THREE.RingGeometry(0.85, 1.05, 20))
const highlightMaterial = retain(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, side: THREE.DoubleSide }))

const unitMaterials = new Map<string, THREE.MeshLambertMaterial>()
const ringMaterials = new Map<string, THREE.MeshBasicMaterial>()

function unitMaterial(color: string) {
  let mat = unitMaterials.get(color)
  if (!mat) {
    const c = new THREE.Color(color)
    const light = c.clone().lerp(new THREE.Color('#ffffff'), 0.45)
    mat = retain(new THREE.MeshLambertMaterial({ color: light, emissive: c.clone().multiplyScalar(0.55) }))
    unitMaterials.set(color, mat)
  }
  return mat
}

function ringMaterial(color: string) {
  let mat = ringMaterials.get(color)
  if (!mat) {
    const light = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.45)
    mat = retain(new THREE.MeshBasicMaterial({ color: light, side: THREE.DoubleSide }))
    ringMaterials.set(color, mat)
  }
  return mat
}

function armyScale(total: number, mine: boolean) {
  const base = mine ? 2.45 : 1.6
  const grow = mine ? 0.46 : 0.38
  const cap = mine ? 5.2 : 4.2
  return Math.min(cap, base + Math.sqrt(Math.max(total, 1)) * grow)
}

function buildArmyObject(d: Extract<LayerDatum, { kind: 'army' }>): THREE.Object3D {
  const group = new THREE.Group()
  const mat = unitMaterial(d.color)
  group.add(new THREE.Mesh(plateGeometry, plateMaterial))
  const ring = new THREE.Mesh(ringGeometry, ringMaterial(d.color))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.08
  group.add(ring)
  const highlight = new THREE.Mesh(ringGeometry, highlightMaterial)
  highlight.rotation.x = -Math.PI / 2
  highlight.position.y = 0.12
  highlight.scale.setScalar(1.28)
  highlight.visible = false
  group.add(highlight)
  const present = (['infantry', 'armor', 'air', 'naval'] as UnitType[]).filter((k) => d.army.units[k] >= 0.5)
  present.forEach((k, i) => {
    const m = new THREE.Mesh(unitGeometries[k], mat)
    const offset = (i - (present.length - 1) / 2) * 0.48
    m.scale.setScalar(d.mine ? 0.84 : 0.62)
    m.position.set(offset, k === 'air' ? 1.2 : 0.4, (i % 2) * 0.25 - 0.1)
    if (k === 'air') m.rotation.z = Math.PI
    group.add(m)
  })
  const baseScale = armyScale(totalUnits(d.army.units), d.mine)
  group.scale.setScalar(baseScale)
  group.userData = { datum: d, phase: Math.random() * Math.PI * 2, highlight, baseScale, misses: 0 }
  disableRaycast(group)
  return group
}

function buildSmokeObject(d: Extract<LayerDatum, { kind: 'smoke' }>): THREE.Object3D {
  const group = new THREE.Group()
  const count = Math.min(3, 2 + Math.floor(d.intensity / 4))
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: getSmokeTexture(), transparent: true, depthWrite: false, opacity: 0 }))
    sprite.userData = { offset: i / count, drift: (i - (count - 1) / 2) * 0.35 }
    group.add(sprite)
  }
  group.userData = { datum: d, misses: 0, placedLat: Number.NaN, placedLng: Number.NaN }
  disableRaycast(group)
  return group
}

function placeOnGlobe(obj: THREE.Object3D, lat: number, lng: number, alt: number) {
  const api = globeBridge.api
  if (!api) return false
  const p = api.getCoords(lat, lng, alt)
  if (!p) return false
  obj.position.set(p.x, p.y, p.z)
  OUTWARD.copy(obj.position).normalize()
  obj.quaternion.setFromUnitVectors(UP, OUTWARD)
  return true
}

function placeDatum(obj: THREE.Object3D) {
  const d = obj.userData.datum as LayerDatum | undefined
  if (!d) return
  if (d.kind === 'army') {
    const fromMarch = d.march
    placeOnGlobe(obj, fromMarch ? fromMarch.from[1] : d.lat, fromMarch ? fromMarch.from[0] : d.lng, 0.012)
  } else if (placeOnGlobe(obj, d.lat, d.lng, 0.01)) {
    obj.userData.placedLat = d.lat
    obj.userData.placedLng = d.lng
  }
}

function regionColor(game: GameState | null, id: RegionId): string {
  if (!game) {
    const t = map.regions[id].terrain
    return { plains: '#1e3a5f', forest: '#1b4d4a', mountain: '#3b3355', desert: '#4a3f2a', urban: '#2f3f63' }[t]
  }
  return game.nations[game.regions[id].owner]?.color ?? '#334155'
}

const SIDE_COLOR = () => 'rgba(2, 6, 23, 0.75)'

interface Marker {
  key: string
  lat: number
  lng: number
  title: string
  detail?: string
  kind: 'army' | 'territory'
  tone: 'yours' | 'picked' | 'other'
}

function paintMarker(d: object): HTMLElement {
  const marker = d as Marker
  const el = document.createElement('div')
  el.style.pointerEvents = 'none'
  el.style.whiteSpace = 'nowrap'
  el.style.textAlign = 'center'
  el.style.fontFamily = 'Inter, ui-sans-serif, system-ui, sans-serif'
  el.style.letterSpacing = '-0.015em'
  const title = document.createElement('div')
  title.textContent = marker.title
  el.appendChild(title)
  if (marker.detail) {
    const sub = document.createElement('div')
    sub.textContent = marker.detail
    sub.style.fontWeight = '560'
    sub.style.opacity = '0.92'
    sub.style.fontSize = '11px'
    sub.style.marginTop = '1px'
    el.appendChild(sub)
  }
  if (marker.kind === 'army' && marker.tone !== 'other') {
    const picked = marker.tone === 'picked'
    el.style.color = picked ? '#0A84FF' : '#ffffff'
    el.style.fontSize = '14px'
    el.style.fontWeight = '700'
    el.style.background = picked ? '#ffffff' : '#0A84FF'
    el.style.border = '2px solid #ffffff'
    el.style.borderRadius = '16px'
    el.style.padding = '5px 12px'
    el.style.boxShadow = '0 8px 22px rgba(0,0,0,0.45)'
    el.style.transform = 'translate(-50%, 18px)'
  } else if (marker.kind === 'army') {
    el.style.color = '#f5f5f7'
    el.style.fontSize = '12px'
    el.style.fontWeight = '650'
    el.style.background = 'rgba(0,0,0,0.78)'
    el.style.border = '1px solid rgba(255,255,255,0.35)'
    el.style.borderRadius = '14px'
    el.style.padding = '4px 10px'
    el.style.transform = 'translate(-50%, 14px)'
  } else {
    el.style.color = '#f5f5f7'
    el.style.fontSize = '11px'
    el.style.fontWeight = '600'
    el.style.background = 'rgba(0,0,0,0.62)'
    el.style.border = '0.5px solid rgba(255,255,255,0.22)'
    el.style.borderRadius = '999px'
    el.style.padding = '2px 8px'
    el.style.transform = 'translate(-50%, -18px)'
  }
  return el
}
const datumCache = new Map<string, LayerDatum>()
const arcCache = new Map<string, Arc>()

export function WorldGlobe() {
  const game = useGame((s) => s.game)
  const orders = useGame((s) => s.orders)
  const selectedRegion = useGame((s) => s.selectedRegion)
  const selectedArmy = useGame((s) => s.selectedArmy)
  const targetMode = useGame((s) => s.targetMode)
  const marches = useGame((s) => s.marches)
  const marchStamp = useGame((s) => s.marchStamp)
  const reducedMotion = useGame((s) => s.settings.reducedMotion)
  const rings = useFx((s) => s.rings)
  const fxQueue = useGame((s) => s.fxQueue)
  const revealedBattleId = useFx((s) => s.revealedBattleId)
  const ref = useRef<GlobeMethods | undefined>(undefined)
  const [hover, setHover] = useState<RegionId | null>(null)
  const { w, h } = useWindowSize()
  const animated = useRef(new Set<THREE.Object3D>())
  const marchGate = useRef(new Map<string, MarchGate>())
  const marchGateStamp = useRef(0)
  const reducedRef = useRef(reducedMotion)
  const marchStampRef = useRef(marchStamp)
  useEffect(() => {
    reducedRef.current = reducedMotion
    marchStampRef.current = marchStamp
  }, [reducedMotion, marchStamp])

  const globeMaterial = useMemo(
    () => new THREE.MeshPhongMaterial({ color: new THREE.Color('#030916'), emissive: new THREE.Color('#041026'), shininess: 8, specular: new THREE.Color('#155e75') }),
    [],
  )

  const inGame = !!game
  const controlsTuned = useRef(false)
  useLayoutEffect(() => {
    const api = ref.current
    if (!api) return
    globeBridge.api = api
    for (const obj of animated.current) placeDatum(obj)
    const renderer = api.renderer()
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    if (renderer.getPixelRatio() !== ratio) {
      renderer.setPixelRatio(ratio)
      renderer.setSize(window.innerWidth, window.innerHeight, false)
    }
    const controls = api.controls()
    controls.autoRotate = !inGame
    controls.autoRotateSpeed = 0.22
    controls.dampingFactor = 0.16
    if (!controlsTuned.current) {
      controlsTuned.current = true
      const tune = () => {
        const pov = api.pointOfView()
        if (!pov) return
        controls.rotateSpeed = Math.min(1.25, 0.5 + pov.altitude * 0.2)
        controls.zoomSpeed = Math.min(1.5, 0.7 + pov.altitude * 0.12)
      }
      controls.addEventListener('change', tune)
      tune()
    }
  }, [inGame])

  const playerId = game?.playerId ?? null
  const gameStarted = !!game
  useEffect(() => {
    const api = ref.current
    if (!api || !gameStarted || !playerId) return
    const cap = map.regions[playerId]
    api.pointOfView({ lat: cap.lat, lng: cap.lng, altitude: 1.7 }, reducedRef.current ? 0 : 900)
  }, [gameStarted, playerId])

  const reachable = useMemo(() => {
    if (!game || !selectedArmy || !targetMode) return EMPTY_REGIONS
    const a = game.armies[selectedArmy]
    if (!a) return EMPTY_REGIONS
    const out = new Set<RegionId>()
    for (const id of [...map.regions[a.location].neighbors, ...map.regions[a.location].seaLanes, a.location]) {
      const owner = game.regions[id].owner
      const mine = owner === game.playerId
      if (targetMode === 'move' && mine && id !== a.location && canReach(game, map, game.playerId, a.location, id, 'move').ok) out.add(id)
      if (targetMode === 'attack' && canReach(game, map, game.playerId, a.location, id, 'attack').ok && (!mine || game.regions[id].rebels > 0)) out.add(id)
    }
    return out
  }, [game, selectedArmy, targetMode])

  const vision = useMemo(() => (game ? visibleRegions(game, map, game.playerId) : null), [game])

  const hiddenCaptures = useMemo(() => {
    const out = new Map<RegionId, string>()
    if (!game) return out
    for (const b of [...fxQueue].reverse()) {
      if (!b.captured || b.id === revealedBattleId) continue
      const prev = game.nations[b.defender.nationId]
      if (prev) out.set(b.regionId, prev.color)
    }
    return out
  }, [fxQueue, revealedBattleId, game])

  const displayOwners = useMemo(() => {
    const out = new Map<RegionId, NationId>()
    if (!game) return out
    for (const r of Object.values(game.regions)) out.set(r.id, r.owner)
    for (const b of fxQueue) if (b.captured && b.id !== revealedBattleId && hiddenCaptures.has(b.regionId)) out.set(b.regionId, b.defender.nationId)
    return out
  }, [game, fxQueue, revealedBattleId, hiddenCaptures])

  const [popped, setPopped] = useState<Set<RegionId>>(EMPTY_REGIONS)
  const shownOwners = useRef<{ session: string; turn: number; owners: Map<RegionId, NationId> } | null>(null)
  const popTimer = useRef(0)
  useEffect(() => {
    if (!game) {
      shownOwners.current = null
      return
    }
    const session = `${game.seed}|${game.playerId}`
    const prev = shownOwners.current
    shownOwners.current = { session, turn: game.turn, owners: displayOwners }
    if (!prev || prev.session !== session || game.turn < prev.turn) return
    const player = game.playerId
    const notable: RegionId[] = []
    for (const [id, owner] of displayOwners) {
      const before = prev.owners.get(id)
      if (before === undefined || before === owner) continue
      if (owner === player || before === player || vision === 'all' || vision?.has(id)) notable.push(id)
    }
    if (!notable.length) return
    const pulses = notable.slice(0, 6)
    if (!reducedRef.current)
      for (const id of pulses) {
        const r = map.regions[id]
        useFx.getState().addRing({ lat: r.lat, lng: r.lng, color: game.nations[displayOwners.get(id)!]?.color ?? NEON.cyan, maxRadius: 4.5 }, 1500)
      }
    requestAnimationFrame(() => setPopped(new Set(pulses)))
    window.clearTimeout(popTimer.current)
    popTimer.current = window.setTimeout(() => setPopped(EMPTY_REGIONS), 700)
  }, [game, displayOwners, vision])

  const polygonColor = useCallback(
    (f: object) => {
      const id = (f as CountryFeature).properties.regionId
      const base = hiddenCaptures.get(id) ?? regionColor(game, id)
      if (reachable.has(id)) return tint(targetMode === 'attack' ? NEON.magenta : NEON.cyan, hover === id ? 0.1 : -0.05)
      if (id === selectedRegion) return tint(base, 0.18, 0.1)
      if (id === hover) return tint(base, 0.1)
      return base
    },
    [game, hiddenCaptures, reachable, targetMode, selectedRegion, hover],
  )
  const polygonAltitude = useCallback(
    (f: object) => {
      const id = (f as CountryFeature).properties.regionId
      if (popped.has(id)) return 0.045
      if (id === selectedRegion) return 0.03
      if (reachable.has(id)) return 0.022
      if (game && game.regions[id].owner === game.playerId) return 0.012
      return 0.006
    },
    [game, selectedRegion, reachable, popped],
  )
  const polygonStroke = useCallback(
    (f: object) => {
      const id = (f as CountryFeature).properties.regionId
      if (id === selectedRegion) return '#ffffff'
      if (game && game.regions[id].owner === game.playerId) return '#0A84FF'
      return 'rgba(8, 12, 28, 0.9)'
    },
    [game, selectedRegion],
  )
  const polygonLabel = useCallback(
    (f: object) => {
      const id = (f as CountryFeature).properties.regionId
      const mr = map.regions[id]
      if (!game) return `<div class="globe-tip"><b>${mr.name}</b></div>`
      const owner = game.nations[game.regions[id].owner]
      const vis = vision ?? 'all'
      const armies = vis === 'all' || vis.has(id) ? armiesIn(game, id).reduce((s, a) => s + totalUnits(a.units), 0) : null
      const rebels = game.regions[id].rebels
      const yours = game.regions[id].owner === game.playerId
      return `<div class="globe-tip"><b>${mr.name}</b><div style="color:${owner.color}">${yours ? 'Your country' : owner.name}</div><div>${TERRAIN[mr.terrain].name} · ${game.regions[id].population.toFixed(1)} million people</div>${armies === null ? '<div class="dim">Armies hidden</div>' : `<div>${armies.toFixed(1)} divisions</div>`}${rebels > 0 ? `<div style="color:${NEON.red}">Rebels: ${rebels.toFixed(1)}</div>` : ''}</div>`
    },
    [game, vision],
  )

  const onPolygonClick = useCallback((f: object) => {
    useGame.getState().clickRegion((f as CountryFeature).properties.regionId)
  }, [])
  const onPolygonHover = useCallback((f: object | null) => {
    const id = f ? (f as CountryFeature).properties.regionId : null
    setHover((prev) => (prev === id ? prev : id))
  }, [])

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
      const attack = o.type === 'attack'
      const c = attack ? NEON.magenta : NEON.cyan
      out.push({ startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng, color: [withAlpha(c, 0.2), c], stroke: attack ? 0.55 : 0.4, dash: 0.4, gap: 0.18, speed: attack ? 700 : 1100, label: `${attack ? 'Attack' : 'Move'}: ${to.name}` })
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
        out.push({
          startLat: cap.lat,
          startLng: cap.lng,
          endLat: to.lat,
          endLng: to.lng,
          color: ok ? [withAlpha(NEON.green, 0.02), withAlpha(NEON.green, 0.45)] : [withAlpha(NEON.red, 0.15), NEON.red],
          stroke: null,
          dash: ok ? 1 : 0.2,
          gap: ok ? 0 : 0.15,
          speed: ok ? 0 : 1600,
          label: ok ? `${to.name} is supplied` : `${to.name} is cut off`,
        })
      }
    }
    for (const b of game.battles) {
      if (!b.fromRegionId) continue
      if (b.attacker.nationId !== game.playerId && b.defender.nationId !== game.playerId) continue
      const from = map.regions[b.fromRegionId]
      const to = map.regions[b.regionId]
      out.push({ startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng, color: [withAlpha(NEON.amber, 0.15), NEON.amber], stroke: null, dash: 1, gap: 0, speed: 0, label: `Battle of ${to.name}` })
    }
    if (selectedRegion && !targetMode) {
      const r = map.regions[selectedRegion]
      for (const id of r.seaLanes) {
        const to = map.regions[id]
        out.push({ startLat: r.lat, startLng: r.lng, endLat: to.lat, endLng: to.lng, color: [withAlpha('#93c5fd', 0.04), withAlpha('#93c5fd', 0.4)], stroke: null, dash: 1, gap: 0, speed: 0, label: `Sea lane: ${r.name} to ${to.name}` })
      }
    }
    // three-globe joins arcs by object identity: reusing unchanged arcs means only new ones play the draw-in transition.
    const cache = arcCache
    const next = new Map<string, Arc>()
    const stable = out.map((a) => {
      const key = `${a.startLat},${a.startLng},${a.endLat},${a.endLng},${a.color.join()},${a.stroke},${a.dash},${a.gap},${a.speed},${a.label}`
      const kept = next.get(key) ? a : (cache.get(key) ?? a)
      next.set(key, kept)
      return kept
    })
    cache.clear()
    for (const [k, v] of next) cache.set(k, v)
    return stable
  }, [game, orders, selectedRegion, targetMode])

  const arcDashTime = useCallback((a: object) => (reducedMotion ? 0 : (a as Arc).speed), [reducedMotion])
  const ringColor = useCallback((r: object) => (t: number) => withAlpha((r as { color: string }).color, Math.max(0, 1 - t)), [])

  const layerData = useMemo<LayerDatum[]>(() => {
    const cache = datumCache
    if (!game) {
      cache.clear()
      return []
    }
    const seen = new Set<string>()
    const out: LayerDatum[] = []
    const marchById = new Map(marches.map((m) => [m.armyId, m]))
    const visitors = new Map<RegionId, number>()
    for (const a of visibleArmies(game, map, game.playerId, vision ?? undefined)) {
      const home = map.territories[a.homeTerritoryId]
      const atHome = !!home && a.location === home.regionId
      let lat: number
      let lng: number
      if (atHome) {
        lat = home.lat
        lng = home.lng
      } else {
        const r = map.regions[a.location]
        const idx = visitors.get(a.location) ?? 0
        visitors.set(a.location, idx + 1)
        const angle = idx * 2.1
        lat = r.lat + (idx ? Math.sin(angle) * 1.6 : 0)
        lng = r.lng + (idx ? Math.cos(angle) * 1.6 : 0)
      }
      const m = marchById.get(a.id)
      const from = m ? map.regions[m.from] : null
      const fromHome = !!(home && m && m.from === home.regionId)
      const color = game.nations[a.owner]?.color ?? '#94a3b8'
      const mine = a.owner === game.playerId
      const present = (['infantry', 'armor', 'air', 'naval'] as UnitType[]).filter((k) => a.units[k] >= 0.5).join(',')
      const signature = `${a.owner}|${color}|${present}|${mine ? 1 : 0}|v2`
      const march = from ? { from: [fromHome ? home.lng : from.lng, fromHome ? home.lat : from.lat] as [number, number], to: [lng, lat] as [number, number] } : null
      const hold = !!(m && hiddenCaptures.has(m.to))
      const prev = cache.get(a.id)
      if (prev && prev.kind === 'army' && prev.signature === signature) {
        prev.army = a
        prev.lat = lat
        prev.lng = lng
        prev.color = color
        prev.hold = hold
        prev.march = march
        prev.mine = mine
        out.push(prev)
      } else {
        const created: LayerDatum = { kind: 'army', key: a.id, signature, army: a, lat, lng, color, hold, march, mine }
        cache.set(a.id, created)
        out.push(created)
      }
      seen.add(a.id)
    }
    const vis = vision ?? 'all'
    for (const r of Object.values(game.regions)) {
      const factories = r.buildings.factory
      if (factories < 2 || r.sabotaged > 0) continue
      if (vis !== 'all' && !vis.has(r.id) && r.owner !== game.playerId && factories < 6) continue
      const key = `smoke-${r.id}`
      const mr = map.regions[r.id]
      const signature = String(Math.min(3, 2 + Math.floor(factories / 4)))
      const prev = cache.get(key)
      if (prev && prev.kind === 'smoke' && prev.signature === signature) {
        prev.lat = mr.lat - 1.2
        prev.lng = mr.lng + 1.4
        prev.intensity = factories
        out.push(prev)
      } else {
        const created: LayerDatum = { kind: 'smoke', key, signature, lat: mr.lat - 1.2, lng: mr.lng + 1.4, intensity: factories }
        cache.set(key, created)
        out.push(created)
      }
      seen.add(key)
    }
    for (const key of [...cache.keys()]) if (!seen.has(key)) cache.delete(key)
    return out
  }, [game, marches, hiddenCaptures, vision])

  const markers = useMemo<Marker[]>(() => {
    const out: Marker[] = []
    if (game) {
      const marching = new Set(marches.map((m) => m.armyId))
      const visitors = new Map<RegionId, number>()
      const occupied = new Set<string>()
      for (const a of visibleArmies(game, map, game.playerId, vision ?? undefined)) {
        if (marching.has(a.id)) continue
        const inView = !!selectedRegion && a.location === selectedRegion
        const mine = a.owner === game.playerId
        const picked = a.id === selectedArmy
        if (!mine && !inView && !picked) continue
        const home = map.territories[a.homeTerritoryId]
        const atHome = !!home && a.location === home.regionId
        let lat: number
        let lng: number
        if (atHome) {
          lat = home.lat
          lng = home.lng
        } else {
          const r = map.regions[a.location]
          if (!r) continue
          const idx = visitors.get(a.location) ?? 0
          visitors.set(a.location, idx + 1)
          const angle = idx * 2.1
          lat = r.lat + (idx ? Math.sin(angle) * 1.6 : 0)
          lng = r.lng + (idx ? Math.cos(angle) * 1.6 : 0)
        }
        if (atHome && inView && home) occupied.add(home.id)
        const place = atHome && home ? home.name : map.regions[a.location]?.name ?? 'In the field'
        const label = armyMarkerText(a, place, !atHome)
        out.push({ key: `army-${a.id}`, lat, lng, title: label.title, detail: label.detail, kind: 'army', tone: picked ? 'picked' : mine ? 'yours' : 'other' })
      }
      if (selectedRegion) {
        for (const id of map.territoriesByRegion[selectedRegion] ?? []) {
          if (occupied.has(id)) continue
          const t = map.territories[id]
          out.push({ key: `pin-${id}`, lat: t.lat, lng: t.lng, title: t.name, kind: 'territory', tone: 'other' })
        }
      }
    } else if (selectedRegion) {
      for (const id of map.territoriesByRegion[selectedRegion] ?? []) {
        const t = map.territories[id]
        out.push({ key: `pin-${id}`, lat: t.lat, lng: t.lng, title: t.name, kind: 'territory', tone: 'other' })
      }
    }
    return out
  }, [game, marches, vision, selectedRegion, selectedArmy])

  const makeObject = useCallback((d: object) => {
    const datum = d as LayerDatum
    const obj = datum.kind === 'army' ? buildArmyObject(datum) : buildSmokeObject(datum)
    animated.current.add(obj)
    placeDatum(obj)
    return obj
  }, [])
  const updateObject = useCallback((obj: THREE.Object3D, d: object) => {
    const datum = d as LayerDatum
    obj.userData.datum = datum
    obj.userData.interpKey = ''
    obj.userData.misses = 0
    if (datum.kind === 'army') {
      const baseScale = armyScale(totalUnits(datum.army.units), datum.mine)
      obj.userData.baseScale = baseScale
      obj.scale.setScalar(baseScale)
    }
    animated.current.add(obj)
  }, [])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      const now = performance.now()
      const reduced = reducedRef.current
      const stamp = marchStampRef.current
      if (marchGateStamp.current !== stamp) {
        marchGateStamp.current = stamp
        marchGate.current.clear()
      }
      const selectedId = useGame.getState().selectedArmy
      for (const obj of animated.current) {
        if (!obj.parent) {
          obj.userData.misses = (obj.userData.misses ?? 0) + 1
          if (obj.userData.misses > 2) animated.current.delete(obj)
          continue
        }
        obj.userData.misses = 0
        const d = obj.userData.datum as LayerDatum
        if (d.kind === 'army') {
          let lat = d.lat
          let lng = d.lng
          let alt = d.mine ? 0.02 : 0.012
          if (d.march && d.hold) {
            const gate = marchGate.current.get(d.key)
            if (gate) gate.held = true
            else marchGate.current.set(d.key, { held: true, delayed: true, start: now })
            lng = d.march.from[0]
            lat = d.march.from[1]
          } else if (d.march && !reduced) {
            const gates = marchGate.current
            let gate = gates.get(d.key)
            if (!gate) {
              gate = { held: false, delayed: false, start: stamp }
              gates.set(d.key, gate)
            } else if (gate.held) {
              gate.held = false
              gate.delayed = true
              gate.start = now
            }
            const dur = gate.delayed ? REVEAL_MARCH_MS : MARCH_MS
            const t = Math.min(1, (now - gate.start) / dur)
            const e = gate.delayed ? 1 - (1 - t) ** 3 : t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
            const interpKey = `${d.march.from[0]},${d.march.from[1]},${d.march.to[0]},${d.march.to[1]}`
            if (obj.userData.interpKey !== interpKey) {
              obj.userData.interp = geoInterpolate(d.march.from, d.march.to)
              obj.userData.interpKey = interpKey
            }
            const [x, y] = (obj.userData.interp as (t: number) => [number, number])(e)
            lng = x
            lat = y
            alt += Math.sin(Math.PI * e) * 0.03
          } else if (!reduced) {
            alt += Math.sin(now / 1400 + obj.userData.phase) * 0.0011
          }
          if (placeOnGlobe(obj, lat, lng, alt) && !reduced) obj.rotateY(Math.sin(now / 1600 + obj.userData.phase) * 0.1)
          const hi = obj.userData.highlight as THREE.Object3D | undefined
          const selected = selectedId === d.army.id
          if (hi) hi.visible = selected
          const base = (obj.userData.baseScale as number) || 1
          obj.scale.setScalar(selected && !reduced ? base * (1 + Math.sin(now / 320) * 0.035) : base)
        } else {
          if (obj.userData.placedLat !== d.lat || obj.userData.placedLng !== d.lng) {
            if (placeOnGlobe(obj, d.lat, d.lng, 0.01)) {
              obj.userData.placedLat = d.lat
              obj.userData.placedLng = d.lng
            }
          }
          for (const child of obj.children) {
            const s = child as THREE.Sprite
            const { offset, drift } = s.userData as { offset: number; drift: number }
            const cycle = reduced ? 0.35 : (now / 4200 + offset) % 1
            s.position.set(drift * cycle * 2.2, 0.5 + cycle * 3.6, 0)
            s.scale.setScalar(0.8 + cycle * 2.1)
            ;(s.material as THREE.SpriteMaterial).opacity = Math.sin(Math.PI * cycle) * 0.5
          }
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <Globe
      ref={ref}
      width={w}
      height={h}
      backgroundColor="rgba(0,0,0,0)"
      globeMaterial={globeMaterial}
      showGraticules
      atmosphereColor="#9ec9ff"
      atmosphereAltitude={0.16}
      polygonCapCurvatureResolution={6}
      polygonsTransitionDuration={reducedMotion ? 0 : 160}
      polygonsData={features}
      polygonCapColor={polygonColor}
      polygonSideColor={SIDE_COLOR}
      polygonStrokeColor={polygonStroke}
      polygonAltitude={polygonAltitude}
      polygonLabel={polygonLabel}
      onPolygonClick={onPolygonClick}
      onPolygonHover={onPolygonHover}
      arcCurveResolution={24}
      arcCircularResolution={4}
      arcsTransitionDuration={reducedMotion ? 0 : 520}
      arcAltitudeAutoScale={0.22}
      arcsData={arcs}
      arcColor="color"
      arcStroke="stroke"
      arcDashLength="dash"
      arcDashGap="gap"
      arcDashAnimateTime={arcDashTime}
      arcLabel="label"
      customLayerData={layerData}
      customThreeObject={makeObject}
      customThreeObjectUpdate={updateObject}
      htmlElementsData={markers}
      htmlLat="lat"
      htmlLng="lng"
      htmlAltitude={(d: object) => ((d as Marker).kind === 'army' && (d as Marker).tone !== 'other' ? 0.05 : 0.02)}
      htmlElement={paintMarker}
      htmlTransitionDuration={reducedMotion ? 0 : 400}
      htmlElementVisibilityModifier={(el, isVisible) => {
        el.style.opacity = isVisible ? '1' : '0'
      }}
      ringsData={rings}
      ringColor={ringColor}
      ringMaxRadius="maxRadius"
      ringPropagationSpeed={3}
      ringRepeatPeriod={1400}
    />
  )
}
