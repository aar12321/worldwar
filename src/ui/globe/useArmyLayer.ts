import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import type { GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import { LIVE } from '../../data/live'
import { armyAt, greatCircle } from '../../engine/armies'
import { clockOf } from '../../engine/calendar'
import { formatDivisions, totalUnits } from '../../engine/helpers'
import type { Army, MissileFlight } from '../../engine/types'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { armyStatus } from '../armyText'
import { liveClock } from '../liveClock'
import { badge, glyphOf, type Glyph, type Variant } from './badges'

const { map } = getWorld()

/** One army as the globe draws it. The object is kept for the army's whole life, so the globe never rebuilds its badge. */
export interface ArmyDatum {
  id: string
  /** The latest state of the army. The movement loop reads it every frame. */
  army: Army
  color: string
  glyph: Glyph
  variant: Variant
  /** Everything that changes how the badge looks. */
  key: string
  /** How big the badge is, growing with the size of the army. */
  size: number
}

interface PathDatum {
  id: string
  points: [number, number, number][]
  color: string
  dash: number
  gap: number
  animate: number
  key: string
}

interface ArcDatum {
  id: string
  startLat: number
  startLng: number
  endLat: number
  endLng: number
}

export interface ThreatRing {
  lat: number
  lng: number
  color: string
  maxRadius: number
  repeat: number
}

// Accessors are module-level so the globe is not told they changed on every render.
const pathPoints = (d: object) => (d as PathDatum).points
const pathPointLat = (p: unknown) => (p as number[])[0]
const pathPointLng = (p: unknown) => (p as number[])[1]
const pathPointAlt = (p: unknown) => (p as number[])[2]
const pathColor = (d: object) => (d as PathDatum).color
const pathDashLength = (d: object) => (d as PathDatum).dash
const pathDashGap = (d: object) => (d as PathDatum).gap
const pathDashAnimateTime = (d: object) => (d as PathDatum).animate
/** How high above the countries badges and routes ride, clear of the raised countries you can attack or have selected. */
const ARMY_ALT = 0.05
const pathStroke = () => 3.2
const arcColor = () => ['rgba(255,214,10,0.95)', 'rgba(255,69,58,0.95)']

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** What the layer remembers between renders, so unchanged armies keep the same objects and the globe does not rebuild them. */
class LayerCache {
  datums = new Map<string, ArmyDatum>()
  objects = new Map<string, THREE.Sprite>()
  private list: ArmyDatum[] = []
  private paths = new Map<string, PathDatum>()
  private pathList: PathDatum[] = []
  private arcs = new Map<string, ArcDatum>()
  private arcList: ArcDatum[] = []
  reduced: boolean

  constructor(reduced: boolean) {
    this.reduced = reduced
  }

  setReduced(reduced: boolean) {
    this.reduced = reduced
  }

  /** One datum per army, the same object for the army's whole life. A new list only when an army came, went, or changed how it looks. */
  syncArmies(armies: Army[] | undefined, playerId: string | undefined): ArmyDatum[] {
    const game = useGame.getState().game
    const next = new Map<string, ArmyDatum>()
    let changed = false
    for (const a of armies ?? []) {
      const owner = game?.nations[a.nationId]
      const color = owner?.color ?? '#888888'
      const glyph = glyphOf(a)
      const variant: Variant = a.nationId === playerId ? 'mine' : a.phase === 'outbound' && game?.regions[a.target]?.owner === playerId ? 'threat' : 'other'
      const key = `${color}|${glyph}|${variant}|${a.phase}`
      const size = Math.min(4, Math.max(1, Math.sqrt(totalUnits(a.units))))
      const old = this.datums.get(a.id)
      if (old) {
        old.army = a
        old.size = size
        if (old.key !== key) {
          Object.assign(old, { color, glyph, variant, key })
          changed = true
        }
        next.set(a.id, old)
      } else {
        next.set(a.id, { id: a.id, army: a, color, glyph, variant, key, size })
        changed = true
      }
    }
    if (next.size !== this.datums.size) changed = true
    this.datums = next
    if (!changed) return this.list
    this.list = [...next.values()]
    return this.list
  }

  /** Routes: yours, the ones marching on you, the selected one, and everyone's in Fronts mode. */
  syncPaths(armies: Army[] | undefined, playerId: string | undefined, selected: string | null, mapMode: string, reduced: boolean): PathDatum[] {
    const game = useGame.getState().game
    const next = new Map<string, PathDatum>()
    let changed = false
    for (const a of armies ?? []) {
      if (a.phase === 'fighting') continue
      const mine = a.nationId === playerId
      const threat = !mine && a.phase === 'outbound' && game?.regions[a.target]?.owner === playerId
      const picked = a.id === selected
      if (!mine && !threat && !picked && !(mapMode === 'fronts' && a.phase === 'outbound')) continue
      const color = picked ? '#ffffff' : threat ? '#ff453a' : mine ? (a.phase === 'returning' ? 'rgba(77,163,255,0.4)' : '#4da3ff') : 'rgba(255,255,255,0.45)'
      const returning = a.phase === 'returning'
      const key = `${a.id}|${a.phase}|${a.start}|${a.end}|${color}|${reduced}`
      const old = this.paths.get(a.id)
      if (old && old.key === key) {
        next.set(a.id, old)
        continue
      }
      changed = true
      next.set(a.id, { id: a.id, points: legPoints(a), color, dash: returning ? 0.02 : 0.05, gap: returning ? 0.035 : 0.03, animate: returning || reduced ? 0 : 2400, key })
    }
    if (next.size !== this.paths.size) changed = true
    this.paths = next
    if (!changed) return this.pathList
    this.pathList = [...next.values()]
    return this.pathList
  }

  /** Missiles in the air, one arc each. */
  syncArcs(flights: MissileFlight[] | undefined): ArcDatum[] {
    const next = new Map<string, ArcDatum>()
    let changed = false
    for (const f of flights ?? []) {
      const from = map.regions[f.from]
      const to = map.regions[f.target]
      if (!from || !to) continue
      const old = this.arcs.get(f.id)
      if (old) {
        next.set(f.id, old)
        continue
      }
      changed = true
      next.set(f.id, { id: f.id, startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng })
    }
    if (next.size !== this.arcs.size) changed = true
    this.arcs = next
    if (!changed) return this.arcList
    this.arcList = [...next.values()]
    return this.arcList
  }
}

/** Samples along an army's current leg, arcing above the globe the way the badge travels. */
function legPoints(a: Army): [number, number, number][] {
  const out: [number, number, number][] = []
  const n = 28
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = greatCircle(a.from, a.to, t)
    out.push([p.lat, p.lng, ARMY_ALT + LIVE.arcHeight[a.via] * Math.sin(Math.PI * t)])
  }
  return out
}

/**
 * Everything the globe draws for a live game's armies: a badge for each, the route it is marching, the missiles in the air,
 * and a warning ring over a country an enemy army is marching on. Badges move from the live clock, not from React, so a
 * running game re-renders nothing for them.
 */
export function useArmyLayer(globe: MutableRefObject<GlobeMethods | undefined>, reduced: boolean) {
  const armies = useGame((s) => s.game?.armies)
  const flights = useGame((s) => s.game?.flights)
  const playerId = useGame((s) => s.game?.playerId)
  const selected = useGame((s) => s.selectedArmy)
  const mapMode = useGame((s) => s.mapMode)
  const speed = useGame((s) => s.settings.liveSpeed)
  const [cache] = useState(() => new LayerCache(reduced))
  useEffect(() => {
    cache.setReduced(reduced)
  }, [cache, reduced])

  const customLayerData = useMemo(() => cache.syncArmies(armies, playerId), [cache, armies, playerId])

  const place = useCallback((sprite: THREE.Sprite, d: ArmyDatum, t: number, dist: number, now: number) => {
    const api = globe.current
    if (!api) return
    const at = armyAt(d.army, t)
    const c = api.getCoords(at.lat, at.lng, ARMY_ALT + at.alt)
    sprite.position.set(c.x, c.y, c.z)
    const busy = d.army.phase === 'fighting' || t < d.army.start
    const pulse = busy && !cache.reduced ? 1 + 0.12 * Math.sin(now / 140) : 1
    // Badges keep the same size on screen at any zoom: they scale with how far the camera is from the ground, not from the centre.
    const w = Math.max(2, dist - 100) * (0.034 + 0.01 * d.size) * pulse
    sprite.scale.set(w, w, 1)
  }, [globe, cache])

  // A stable function: the globe throws away every badge when this changes.
  const customThreeObject = useCallback(
    (d: object) => {
      const m = d as ArmyDatum
      const material = new THREE.SpriteMaterial({ map: badge(m.color, m.glyph, m.variant), transparent: true, depthWrite: false })
      material.opacity = m.army.phase === 'returning' ? 0.72 : 1
      const sprite = new THREE.Sprite(material)
      sprite.renderOrder = 10
      cache.objects.set(m.id, sprite)
      const cam = globe.current?.camera()
      place(sprite, m, liveClock.t, cam ? cam.position.length() : 300, performance.now())
      return sprite
    },
    [globe, place, cache],
  )

  const customThreeObjectUpdate = useCallback((obj: THREE.Object3D, d: object) => {
    const m = d as ArmyDatum
    const material = (obj as THREE.Sprite).material
    material.map = badge(m.color, m.glyph, m.variant)
    material.opacity = m.army.phase === 'returning' ? 0.72 : 1
    material.needsUpdate = true
  }, [])

  // Every frame, each badge goes where its army is by the live clock.
  useEffect(() => {
    const tick = (t: number) => {
      const api = globe.current
      if (!api || cache.objects.size === 0) return
      const dist = api.camera().position.length()
      const now = performance.now()
      for (const [id, sprite] of cache.objects) {
        const d = cache.datums.get(id)
        if (!d) {
          cache.objects.delete(id)
          continue
        }
        place(sprite, d, t, dist, now)
      }
    }
    return liveClock.subscribe(tick)
  }, [globe, place, cache])

  const customLayerLabel = useCallback((d: object) => {
    const m = d as ArmyDatum
    const game = useGame.getState().game
    const owner = game?.nations[m.army.nationId]
    const place = map.regions[m.army.target]?.name ?? m.army.target
    const now = game ? clockOf(game) : 0
    return `<div class="globe-tip"><b style="color:${escapeHtml(owner?.color ?? '#fff')}">${escapeHtml(owner?.name ?? 'An army')}</b><div>${formatDivisions(totalUnits(m.army.units))} divisions to ${escapeHtml(place)}</div><div>${escapeHtml(armyStatus(m.army, now))}</div></div>`
  }, [])

  const onCustomLayerClick = useCallback((d: object) => {
    useGame.getState().selectArmy((d as ArmyDatum).id)
  }, [])

  const pathsData = useMemo(() => cache.syncPaths(armies, playerId, selected, mapMode, reduced), [cache, armies, playerId, selected, mapMode, reduced])
  const arcsData = useMemo(() => cache.syncArcs(flights), [cache, flights])

  // A warning ring over each of your countries an enemy army is marching on.
  const threatKey = useMemo(() => {
    const game = useGame.getState().game
    if (!game) return ''
    const out = new Set<string>()
    for (const a of armies ?? []) if (a.nationId !== playerId && a.phase === 'outbound' && game.regions[a.target]?.owner === playerId) out.add(a.target)
    return [...out].sort().join(',')
  }, [armies, playerId])
  const threatRings = useMemo<ThreatRing[]>(
    () =>
      threatKey
        ? threatKey.split(',').map((id) => ({ lat: map.regions[id].lat, lng: map.regions[id].lng, color: '#ff453a', maxRadius: 4.2, repeat: 1000 }))
        : [],
    [threatKey],
  )

  const flightMs = LIVE.msPerDay / speed
  return {
    threatRings,
    props: {
      customLayerData,
      customThreeObject,
      customThreeObjectUpdate,
      customLayerLabel,
      onCustomLayerClick,
      pathsData,
      pathPoints,
      pathPointLat,
      pathPointLng,
      pathPointAlt,
      pathColor,
      pathDashLength,
      pathDashGap,
      pathDashAnimateTime,
      pathStroke,
      pathTransitionDuration: 0,
      arcsData,
      arcColor,
      arcStroke: 0.5,
      arcAltitudeAutoScale: 0.4,
      arcDashLength: 0.35,
      arcDashGap: 1.6,
      arcDashAnimateTime: reduced ? 0 : flightMs,
    },
  }
}
