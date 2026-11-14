import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import { mapColor } from '../data/mapColors'
import { TERRAIN } from '../data/terrain'
import { militaryPower } from '../engine/militaryStats'
import { lineMax } from '../engine/economy'
import { atWar, hasPact, isAllied } from '../engine/helpers'
import type { GameState, RegionId } from '../engine/types'
import { attackableRegions } from '../engine/warfare'
import { getWorld, type CountryFeature } from '../map/world'
import { useGame } from '../store'
import { useSlowGame } from './hooks'
import { paintSignature } from './globe/paint'
import { useArmyLayer } from './globe/useArmyLayer'
import { FRONT_COLORS, NEON, RELATION_COLORS, mix, tint, wash, withAlpha } from './colors'
import { globeBridge, useFx, type BattleOverlay } from './globeBridge'

const { map, features } = getWorld()
const EMPTY_REGIONS = new Set<RegionId>()

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

function regionOf(f: object): RegionId {
  return (f as CountryFeature).properties.regionId
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

function regionColor(game: GameState | null, id: RegionId): string {
  const terrain = map.regions[id].terrain
  if (!game) {
    const index = map.order.indexOf(id)
    return wash(mapColor(index < 0 ? 0 : index), terrain)
  }
  return wash(game.nations[game.regions[id].owner]?.color ?? '#8d6b4a', terrain)
}

/** What a country's color means in a map mode other than Political. */
function modeColor(game: GameState, mode: 'relations' | 'fronts', id: RegionId): string {
  const r = game.regions[id]
  const me = game.playerId
  const mine = r.owner === me
  if (mode === 'relations') {
    if (mine) return RELATION_COLORS.yours
    if (atWar(game, me, r.owner)) return RELATION_COLORS.war
    if (isAllied(game, me, r.owner)) return RELATION_COLORS.ally
    if (hasPact(game, me, r.owner)) return RELATION_COLORS.pact
    return RELATION_COLORS.other
  }
  const enemy = !mine && atWar(game, me, r.owner)
  if (!mine && !enemy) return FRONT_COLORS.other
  const left = Math.max(0, Math.min(1, r.line / lineMax(game, map, id)))
  return mix(FRONT_COLORS.weak, mine ? FRONT_COLORS.yours : FRONT_COLORS.enemy, 0.25 + 0.75 * left)
}

interface Marker {
  key: string
  lat: number
  lng: number
  title: string
  yours: boolean
  city?: boolean
  /** A live battle's pin, with its Defense Line bar. */
  battle?: BattleOverlay
}

/** The pin for a live battle: its name, a Defense Line bar that drains from before to after, and who won. */
function paintBattle(b: BattleOverlay, reduced: boolean): HTMLElement {
  const el = document.createElement('div')
  el.className = 'battle-pin'
  const title = document.createElement('div')
  title.className = 'battle-pin-title'
  title.textContent = `Battle · ${b.place}`
  const bar = document.createElement('div')
  bar.className = 'battle-pin-bar'
  const fill = document.createElement('div')
  fill.className = 'battle-pin-fill'
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(0.01, b.max)) * 100))}%`
  fill.style.width = pct(reduced ? b.after : b.before)
  bar.appendChild(fill)
  const result = document.createElement('div')
  result.className = 'battle-pin-result'
  const verdict = b.captured ? 'Captured' : b.attackerWon ? 'Pushed back' : 'Held'
  if (reduced) result.textContent = verdict
  else {
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = pct(b.after))))
    setTimeout(() => (result.textContent = verdict), 1300)
  }
  el.append(title, bar, result)
  return el
}

function paintMarker(d: object): HTMLElement {
  const m = d as Marker
  if (m.battle) return paintBattle(m.battle, useGame.getState().settings.reducedMotion)
  const el = document.createElement('div')
  el.style.pointerEvents = 'none'
  el.style.whiteSpace = 'nowrap'
  el.style.fontFamily = 'Inter, system-ui, sans-serif'
  el.style.fontSize = '12px'
  el.style.fontWeight = '600'
  el.style.color = '#fff'
  el.style.padding = '2px 8px'
  el.style.borderRadius = '999px'
  el.style.background = m.yours ? 'rgba(196,71,74,0.92)' : 'rgba(21,23,28,0.85)'
  if (m.city) {
    el.style.fontSize = '11px'
    el.style.padding = '1px 6px'
    el.style.background = 'rgba(10,132,255,0.85)'
  }
  el.style.transform = 'translate(-50%, -50%)'
  el.textContent = m.title
  return el
}

/** How often a ring pulses. Warning rings repeat faster than the fireworks of a battle. */
const ringPeriod = (r: object) => (r as { repeat?: number }).repeat ?? 1400

export function WorldGlobe() {
  const game = useSlowGame()
  const gameRef = useRef(game)
  gameRef.current = game
  const selectedRegion = useGame((s) => s.selectedRegion)
  const reducedMotion = useGame((s) => s.settings.reducedMotion)
  const mapMode = useGame((s) => s.mapMode)
  const fxQueue = useGame((s) => s.fxQueue)
  const rings = useFx((s) => s.rings)
  const battles = useFx((s) => s.battles)
  const revealedBattleId = useFx((s) => s.revealedBattleId)
  const ref = useRef<GlobeMethods | undefined>(undefined)
  const [hover, setHover] = useState<RegionId | null>(null)
  const { w, h } = useWindowSize()
  const reducedRef = useRef(reducedMotion)
  useEffect(() => {
    reducedRef.current = reducedMotion
  }, [reducedMotion])

  const globeMaterial = useMemo(
    () => new THREE.MeshPhongMaterial({ color: new THREE.Color('#16375f'), emissive: new THREE.Color('#0c2342'), shininess: 22, specular: new THREE.Color('#c5d8ee') }),
    [],
  )

  const inGame = !!game
  const controlsTuned = useRef(false)
  useLayoutEffect(() => {
    const api = ref.current
    if (!api) return
    globeBridge.api = api
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
  useEffect(() => {
    const api = ref.current
    if (!api || !playerId) return
    const cap = map.regions[playerId]
    api.pointOfView({ lat: cap.lat, lng: cap.lng, altitude: 2.0 }, reducedRef.current ? 0 : 900)
  }, [playerId])

  // A captured country keeps its old color until its battle window has played.
  const heldColors = useFx((s) => s.held)
  const hiddenCaptures = useMemo(() => {
    const out = new Map<RegionId, string>()
    if (!game) return out
    for (const b of [...fxQueue].reverse()) {
      if (!b.captured || b.id === revealedBattleId) continue
      const prev = game.nations[b.defender.nationId]
      if (prev) out.set(b.regionId, prev.color)
    }
    for (const [id, color] of Object.entries(heldColors)) if (!out.has(id)) out.set(id, color)
    return out
  }, [fxQueue, revealedBattleId, game, heldColors])

  // The set of countries you can attack keeps the same identity until it really changes, so the map is not repainted for nothing.
  const targetsRef = useRef<{ key: string; set: Set<RegionId> }>({ key: '', set: EMPTY_REGIONS })
  const targets = useMemo(() => {
    if (!game || game.outcome !== 'playing' || game.nations[game.playerId].military.exposed >= 0.95) {
      targetsRef.current = { key: '', set: EMPTY_REGIONS }
      return EMPTY_REGIONS
    }
    const list = attackableRegions(game, map, game.playerId)
    const key = list.join(',')
    if (key === targetsRef.current.key) return targetsRef.current.set
    targetsRef.current = { key, set: new Set(list) }
    return targetsRef.current.set
  }, [game])
  // What the colors depend on. The accessors below read the game from a ref and change only when this does.
  const paintKey = useMemo(() => paintSignature(game, mapMode), [game, mapMode])

  const polygonColor = useCallback(
    (f: object) => {
      const id = regionOf(f)
      const game = gameRef.current
      const hidden = hiddenCaptures.get(id)
      if (game && mapMode !== 'political') {
        const base = modeColor(game, mapMode, id)
        return id === selectedRegion ? tint(base, 0.14) : id === hover ? tint(base, 0.08) : base
      }
      const base = hidden ? wash(hidden, map.regions[id].terrain) : regionColor(game, id)
      if (targets.has(id)) return tint(NEON.magenta, hover === id ? 0.14 : 0)
      if (id === selectedRegion) return tint(base, 0.2, 0.1)
      if (id === hover) return tint(base, 0.1)
      return base
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paintKey, hiddenCaptures, targets, selectedRegion, hover, mapMode],
  )
  const polygonSideColor = useCallback((f: object) => tint(polygonColor(f), -0.2), [polygonColor])
  const polygonAltitude = useCallback(
    (f: object) => {
      const id = regionOf(f)
      const game = gameRef.current
      if (targets.has(id)) return 0.03
      if (id === selectedRegion) return 0.03
      if (game && game.regions[id].owner === game.playerId) return 0.014
      return 0.006
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paintKey, selectedRegion, targets],
  )
  const polygonStroke = useCallback(
    (f: object) => {
      const id = regionOf(f)
      if (targets.has(id)) return '#ffd6ff'
      if (id === selectedRegion) return '#f6f1e6'
      return 'rgba(16, 18, 24, 0.55)'
    },
    [selectedRegion, targets],
  )
  const polygonLabel = useCallback(
    (f: object) => {
      const id = regionOf(f)
      const mr = map.regions[id]
      const game = gameRef.current
      if (!game) return `<div class="globe-tip"><b>${escapeHtml(mr.name)}</b></div>`
      const owner = game.nations[game.regions[id].owner]
      const yours = owner?.id === game.playerId
      const rebels = game.regions[id].rebels
      const war = !yours && owner && atWar(game, game.playerId, owner.id)
      const power = owner ? militaryPower(game, owner.id).toFixed(0) : '0'
      return `<div class="globe-tip"><b>${escapeHtml(mr.name)}</b><div style="color:${escapeHtml(owner?.color ?? '#fff')}">${yours ? 'Your country' : escapeHtml(owner?.name ?? 'Unknown')}${war ? ' · at war' : ''}</div><div>${TERRAIN[mr.terrain].name}</div><div>Military strength ${power}</div><div>Defense Line ${Math.min(game.regions[id].line, lineMax(game, map, id)).toFixed(1)} of ${lineMax(game, map, id).toFixed(1)}</div>${rebels > 0 ? `<div style="color:${NEON.red}">Rebels: ${rebels.toFixed(1)}</div>` : ''}</div>`
    },
    [],
  )

  const onPolygonClick = useCallback((f: object) => {
    useGame.getState().selectRegion(regionOf(f))
  }, [])
  const onPolygonHover = useCallback((f: object | null) => {
    const id = f ? regionOf(f) : null
    setHover((prev) => (prev === id ? prev : id))
  }, [])

  // The name pins keep the same identity until a country or city really changes, so the pins are not rebuilt for nothing.
  const pinsRef = useRef<{ key: string; list: Marker[] }>({ key: '', list: [] })
  const pins = useMemo<Marker[]>(() => {
    if (!game) return []
    const out: Marker[] = []
    for (const r of Object.values(game.regions)) {
      if (r.owner !== game.playerId) continue
      const mr = map.regions[r.id]
      out.push({ key: r.id, lat: mr.lat, lng: mr.lng, title: mr.name, yours: true })
      // Your other big cities show as small dots, so you can see where your country lives.
      for (const c of r.cities) if (c.lat !== undefined && c.lng !== undefined) out.push({ key: c.id, lat: c.lat, lng: c.lng, title: c.name, yours: false, city: true })
    }
    const key = out.map((m) => `${m.key}:${m.title}`).join(';')
    if (key === pinsRef.current.key) return pinsRef.current.list
    pinsRef.current = { key, list: out }
    return out
  }, [game])
  const battlePins = useRef(new Map<string, Marker>())
  const markers = useMemo<Marker[]>(() => {
    const kept = new Map<string, Marker>()
    for (const b of battles) kept.set(b.id, battlePins.current.get(b.id) ?? { key: `battle:${b.id}`, lat: b.lat, lng: b.lng, title: b.place, yours: true, battle: b })
    battlePins.current = kept
    return kept.size ? [...pins, ...kept.values()] : pins
  }, [pins, battles])

  const army = useArmyLayer(ref, reducedMotion)
  const allRings = useMemo(() => (army.threatRings.length ? [...rings, ...army.threatRings] : rings), [rings, army.threatRings])

  const ringColor = useCallback((r: object) => (t: number) => withAlpha((r as { color: string }).color, Math.max(0, 1 - t)), [])

  return (
    <Globe
      ref={ref}
      width={w}
      height={h}
      backgroundColor="rgba(0,0,0,0)"
      globeMaterial={globeMaterial}
      showGraticules={false}
      atmosphereColor="#d7e3f2"
      atmosphereAltitude={0.08}
      polygonCapCurvatureResolution={6}
      polygonsTransitionDuration={reducedMotion ? 0 : 160}
      polygonsData={features}
      polygonCapColor={polygonColor}
      polygonSideColor={polygonSideColor}
      polygonStrokeColor={polygonStroke}
      polygonAltitude={polygonAltitude}
      polygonLabel={polygonLabel}
      onPolygonClick={onPolygonClick}
      onPolygonHover={onPolygonHover}
      htmlElementsData={markers}
      htmlLat="lat"
      htmlLng="lng"
      htmlAltitude={0.03}
      htmlElement={paintMarker}
      htmlTransitionDuration={reducedMotion ? 0 : 400}
      htmlElementVisibilityModifier={(el, isVisible) => {
        el.style.opacity = isVisible ? '1' : '0'
      }}
      ringsData={allRings}
      ringColor={ringColor}
      ringMaxRadius="maxRadius"
      ringPropagationSpeed={3}
      ringRepeatPeriod={ringPeriod}
      {...army.props}
    />
  )
}
