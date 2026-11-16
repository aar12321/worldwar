import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import { greatCircle } from '../../engine/armies'
import { clockOf } from '../../engine/calendar'
import { radarLevel } from '../../engine/missileWar'
import type { MissileType, SalvoReport } from '../../engine/types'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { useFx } from '../globeBridge'
import { useFxPrefs } from '../../fx/settings'
import { DEFENSE_COLOR, FX_CAPS, LOOK, decalsFrom, lookColor, planFx, radarRing, type Decal, type Palette, type Pt } from '../missileFx'

const { map } = getWorld()

interface ArcLike {
  kind: MissileType
  nuke?: boolean
}

const hex = (c: string, a: number) => {
  const n = parseInt(c.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** A white aircraft seen from above, for the sprites that fly sorties. */
function planeTexture(color: string): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.translate(32, 32)
  g.fillStyle = color
  g.strokeStyle = 'rgba(0,0,0,0.65)'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(0, -26)
  g.lineTo(5, -8)
  g.lineTo(26, 6)
  g.lineTo(26, 12)
  g.lineTo(5, 7)
  g.lineTo(4, 20)
  g.lineTo(11, 25)
  g.lineTo(11, 28)
  g.lineTo(0, 25)
  g.lineTo(-11, 28)
  g.lineTo(-11, 25)
  g.lineTo(-4, 20)
  g.lineTo(-5, 7)
  g.lineTo(-26, 12)
  g.lineTo(-26, 6)
  g.lineTo(-5, -8)
  g.closePath()
  g.stroke()
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface Sortie {
  id: string
  from: Pt
  to: Pt
  start: number
  sprite: THREE.Sprite
  /** A bomber leaves its base; a fighter climbs from the defended country. */
  kind: 'bomber' | 'fighter'
}

const SORTIE_MS = 2600

const pointOf = (id: string | undefined): Pt | undefined => (id ? map.regions[id] : undefined)

/** The aircraft sprites in flight. Plain code, not a hook: it reads the globe every frame while something flies, and stops when nothing does. */
class SortieLayer {
  private list: Sortie[] = []
  private raf = 0
  private textures: Record<string, THREE.Texture> = {}
  reduced = false
  private globe: MutableRefObject<GlobeMethods | undefined>

  constructor(globe: MutableRefObject<GlobeMethods | undefined>) {
    this.globe = globe
  }

  setReduced(reduced: boolean) {
    this.reduced = reduced
  }

  fly(id: string, from: Pt, to: Pt, kind: 'bomber' | 'fighter') {
    const api = this.globe.current
    if (!api || this.reduced || this.list.length >= FX_CAPS.sprites) return
    const color = kind === 'bomber' ? '#ffffff' : DEFENSE_COLOR.air
    const tex = (this.textures[color] ??= planeTexture(color))
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }))
    sprite.renderOrder = 12
    api.scene().add(sprite)
    this.list.push({ id, from, to, start: performance.now(), sprite, kind })
    if (!this.raf) this.raf = requestAnimationFrame(this.tick)
  }

  private tick = () => {
    this.raf = 0
    const api = this.globe.current
    const now = performance.now()
    const dist = api ? api.camera().position.length() : 300
    const keep: Sortie[] = []
    for (const s of this.list) {
      const t = (now - s.start) / SORTIE_MS
      if (t >= 1 || !api) {
        api?.scene().remove(s.sprite)
        s.sprite.material.dispose()
        continue
      }
      const p = greatCircle(s.from, s.to, Math.max(0, t))
      const c = api.getCoords(p.lat, p.lng, 0.04 + 0.05 * Math.sin(Math.PI * t))
      s.sprite.position.set(c.x, c.y, c.z)
      const w = Math.max(2, dist - 100) * 0.03
      s.sprite.scale.set(w, w, 1)
      s.sprite.material.rotation = -Math.atan2(s.to.lat - s.from.lat, (s.to.lng - s.from.lng) * Math.cos((s.from.lat * Math.PI) / 180)) + Math.PI / 2
      keep.push(s)
    }
    this.list = keep
    if (keep.length) this.raf = requestAnimationFrame(this.tick)
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    const api = this.globe.current
    for (const s of this.list) {
      api?.scene().remove(s.sprite)
      s.sprite.material.dispose()
    }
    this.list = []
  }
}

export function useMissileFx(globe: MutableRefObject<GlobeMethods | undefined>, reduced: boolean) {
  const salvos = useGame((s) => s.game?.salvos)
  const flights = useGame((s) => s.game?.flights)
  const playerId = useGame((s) => s.game?.playerId)
  const palette: Palette = useGame((s) => (s.settings.ui.palette === 'colorblind' ? 'colorblind' : 'standard'))
  const today = useGame((s) => (s.game ? clockOf(s.game) : 0))
  const radar = useGame((s) => (s.game ? radarLevel(s.game.nations[s.game.playerId]) : 0))
  const capital = useGame((s) => (s.game ? s.game.nations[s.game.playerId]?.capital : undefined))
  const seenSalvos = useRef<Set<string> | null>(null)
  const seenFlights = useRef<Set<string>>(new Set())
  const seenScramble = useRef<Set<string>>(new Set())
  const timers = useRef<number[]>([])
  const [layer] = useState(() => new SortieLayer(globe))
  useEffect(() => {
    layer.setReduced(reduced)
  }, [layer, reduced])

  const later = useCallback((ms: number, fn: () => void) => {
    if (ms <= 0) return fn()
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  // New salvo reports: the burst, the rings, the shake, the sortie. The first look at a game only remembers what is already there.
  useEffect(() => {
    if (seenSalvos.current === null) {
      seenSalvos.current = new Set((salvos ?? []).map((r) => r.id))
      return
    }
    if (!salvos) return
    const fresh: SalvoReport[] = salvos.filter((r) => !seenSalvos.current!.has(r.id))
    for (const r of fresh) seenSalvos.current.add(r.id)
    const fx = useFx.getState()
    // The effects overlay plays the salvo itself; these rings are the look when it is off.
    if (useFxPrefs.getState().quality !== 'off') return
    for (const r of fresh.slice(-6)) {
      const to = pointOf(r.region)
      if (!to) continue
      const from = pointOf(r.origin)
      const plan = planFx(r, from, to, { palette, mine: r.from === playerId || r.to === playerId, reduced })
      for (const ring of plan.rings) {
        later(ring.delay, () => {
          if (useFx.getState().rings.length >= FX_CAPS.ringsAlive) return
          useFx.getState().addRing({ lat: ring.lat, lng: ring.lng, color: ring.color, maxRadius: ring.maxRadius }, ring.ttl)
        })
      }
      if (plan.shake > 0 && !reduced) later(900, () => fx.shake(plan.shake))
      if (plan.sortie && from) layer.fly(`${r.id}b`, from, to, 'bomber')
    }
  }, [salvos, palette, playerId, reduced, later, layer])

  // A new flight in the air: the flash and plume at its launch site. A scrambled wing climbs from the defended country.
  useEffect(() => {
    const live = flights ?? []
    for (const f of live) {
      if (!seenFlights.current.has(f.id)) {
        seenFlights.current.add(f.id)
        const from = pointOf(f.from)
        if (from && useFxPrefs.getState().quality === 'off' && useFx.getState().rings.length < FX_CAPS.ringsAlive) useFx.getState().addRing({ lat: from.lat, lng: from.lng, color: lookColor(f.kind ?? 'hypersonic', palette), maxRadius: reduced ? 1.2 : 2 }, reduced ? 900 : 1300)
      }
      if (f.scrambled && !seenScramble.current.has(f.id)) {
        seenScramble.current.add(f.id)
        const target = pointOf(f.target)
        const from = pointOf(f.from)
        if (target && from) layer.fly(`${f.id}s`, target, greatCircle(from, target, 0.7), 'fighter')
      }
    }
    // Keep the seen sets from growing for ever.
    if (seenFlights.current.size > 200) seenFlights.current = new Set(live.map((f) => f.id))
  }, [flights, palette, reduced, layer])

  useEffect(
    () => () => {
      for (const id of timers.current) clearTimeout(id)
      timers.current = []
      layer.dispose()
    },
    [layer],
  )

  const decals = useMemo<Decal[]>(() => decalsFrom(salvos, today, map.regions), [salvos, today])
  const radarRings = useMemo(() => {
    const r = radarRing(radar, pointOf(capital), palette)
    return r ? [r] : []
  }, [radar, capital, palette])

  const arcColor = useCallback((d: object): [string, string] => {
    const a = d as ArcLike
    if (a.nuke) return ['rgba(255,255,255,1)', 'rgba(255,45,149,1)']
    const c = lookColor(a.kind, palette)
    return [hex(c, 0.55), hex(c, 1)]
  }, [palette])
  const arcStroke = useCallback((d: object) => ((d as ArcLike).nuke ? 1.5 : LOOK[(d as ArcLike).kind].stroke), [])
  const arcAltitude = useCallback((d: object) => ((d as ArcLike).nuke ? 0.55 : LOOK[(d as ArcLike).kind].altitude), [])
  const arcDashLength = useCallback((d: object) => ((d as ArcLike).nuke ? 0.3 : LOOK[(d as ArcLike).kind].dash), [])
  const arcDashGap = useCallback((d: object) => 1 - ((d as ArcLike).nuke ? 0.3 : LOOK[(d as ArcLike).kind].dash), [])

  const pointLat = useCallback((d: object) => (d as Decal).lat, [])
  const pointLng = useCallback((d: object) => (d as Decal).lng, [])
  const pointAltitude = useCallback((d: object) => (d as Decal).altitude, [])
  const pointRadius = useCallback((d: object) => (d as Decal).radius, [])
  const pointColor = useCallback((d: object) => {
    const p = d as Decal
    if (p.kind === 'scorch') return `rgba(20,12,8,${p.alpha.toFixed(3)})`
    if (p.kind === 'ember') return `rgba(255,140,30,${p.alpha.toFixed(3)})`
    return `rgba(190,184,178,${p.alpha.toFixed(3)})`
  }, [])

  return {
    rings: radarRings,
    props: {
      arcColor,
      arcStroke,
      arcAltitude,
      arcDashLength,
      arcDashGap,
      pointsData: decals,
      pointLat,
      pointLng,
      pointAltitude,
      pointRadius,
      pointColor,
      pointResolution: 10,
      pointsMerge: false,
      pointsTransitionDuration: 0,
    },
  }
}
