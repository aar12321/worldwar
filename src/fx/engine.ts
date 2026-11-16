import { ArmyLayer } from './armyFx'
import { CAPS, capsFor, type Caps, type Tier } from './quality'
import { FlightRt, posAt, xyzToLL, type FlightKindId } from './flight'
import { clusterImpacts, lodOf, particlesFor, segmentsPerFlight, type Lod } from './lod'
import { PARTICLE_CAPACITY, ParticleStore, Pool } from './pool'
import { COLORS, Painter, SPRITE_IDS, colorId, spriteId } from './sprites'
import { EASE, TIMING, clamp01, lerp } from './timing'
import { GLOBE_R, newPt, project, type View } from './view'

/**
 * The effects engine: one clock, pooled effects, pooled particles, one draw pass. It knows nothing about the game or the browser: it is
 * fed positions and events, advanced with `update(dtMs)` and painted with `draw`. Everything it owns is preallocated, so a frame
 * allocates nothing, and every limit (effects, particles, trail segments, flights drawn in full) comes from the quality tier.
 */

export const K = { FLASH: 1, BURST: 2, BLAST: 3, RING: 4, FLIGHT: 5, SCREEN: 6, ALERT: 7, FIREBALL: 8, MUSHROOM: 9, ASH: 10, GLOW: 11, SPARKS: 12 } as const
export type FxKind = (typeof K)[keyof typeof K]

/** Priorities: what survives when slots run out. */
export const PRIO = { glow: 5, ring: 10, flash: 20, flight: 40, burst: 50, blast: 60, nuke: 100 } as const

export const FX_CAPACITY = 48

export class Fx {
  kind = 0
  live = false
  started = false
  t0 = 0
  dur = 0
  prio = 0
  lat = 0
  lng = 0
  lat2 = 0
  lng2 = 0
  a = 0
  b = 0
  c = 0
  d = 0
  col = 0
  col2 = 0
  seed = 0
  acc = 0
  rt = new FlightRt()
}

export interface FxInit {
  delay?: number
  dur: number
  prio: number
  lat?: number
  lng?: number
  lat2?: number
  lng2?: number
  a?: number
  b?: number
  c?: number
  d?: number
  color?: string
  color2?: string
  seed?: number
}

export interface FlightSpec {
  id: string
  kind: FlightKindId
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  launched: number
  lands: number
  count: number
  mine: boolean
  incoming: boolean
}

export interface DecalSpec {
  id: string
  lat: number
  lng: number
  /** Degrees of arc. */
  radius: number
  kind: 'scorch' | 'crater' | 'ember' | 'smoke' | 'fire' | 'nuke'
  alpha: number
}

export interface EngineStats {
  frames: number
  /** Milliseconds spent in update and draw, smoothed. */
  jsMs: number
  particles: number
  effects: number
  flights: number
  blits: number
  spawned: number
  dropped: number
  rejected: number
  evicted: number
  reused: number
  tier: Tier
}

export interface PaletteLike {
  alert: string
  colorblind: boolean
}

const BLAST_CLIPS = ['blast.conventional', 'blast.ballistic', 'blast.cruise', 'blast.tactical'] as const
const BLAST_FPS = [18, 16, 20, 20]
export const BLAST_KIND: Record<string, number> = { conventional: 0, ballistic: 1, cruise: 2, tactical: 3, hypersonic: 1, decoy: 0 }

const S = {
  smoke: spriteId('particle.smoke'),
  dust: spriteId('particle.dust'),
  embers: spriteId('particle.embers'),
  debris: spriteId('particle.debris'),
  glow: spriteId('glow.fire'),
  sparks: spriteId('army.sparks'),
  spark: spriteId('missile.flareSparkle'),
}

const MAX_TRAIL = 16

export class FxEngine {
  caps: Caps = CAPS.high
  tier: Tier = 'high'
  reduced = false
  now = 0
  /** Absolute game days, for flights driven by the game clock. */
  clockT = 0
  view: View | null = null
  readonly particles = new ParticleStore(PARTICLE_CAPACITY)
  readonly fxPool = new Pool<Fx>(() => new Fx(), FX_CAPACITY)
  private live: Fx[] = []
  readonly flightPool = new Pool<FlightRt>(() => new FlightRt(), 220)
  readonly flights = new Map<string, FlightRt>()
  private ordered: FlightRt[] = []
  decals: DecalSpec[] = []
  readonly armies = new ArmyLayer()
  /** Called with a strength (0..1.6) when something big lands. */
  onShake: ((strength: number) => void) | null = null
  /** Called when the camera should look at the action: lat, lng, importance (0..1). */
  onAction: ((lat: number, lng: number, importance: number) => void) | null = null
  stats: EngineStats = { frames: 0, jsMs: 0, particles: 0, effects: 0, flights: 0, blits: 0, spawned: 0, dropped: 0, rejected: 0, evicted: 0, reused: 0, tier: 'high' }
  alertColor = '#ff453a'
  colorblind = false
  /** Set when anything changes that a still frame must show, so an idle engine redraws once. */
  dirty = true
  /** Wakes the loop when something changed while it was idle. */
  wake: (() => void) | null = null
  touch() {
    this.dirty = true
    this.wake?.()
  }
  private seedState = 0x9e3779b9
  private screenAlpha = 0
  private screenCol = '#ffffff'
  private vignette = 0

  // scratch, reused every frame
  private readonly pt = newPt()
  private readonly pt2 = newPt()
  private readonly pos = new Float64Array(3 * (MAX_TRAIL + 2))
  private readonly tx = new Float32Array(MAX_TRAIL + 2)
  private readonly ty = new Float32Array(MAX_TRAIL + 2)
  private readonly tv = new Uint8Array(MAX_TRAIL + 2)
  private readonly ll = { lat: 0, lng: 0 }
  /** Scratch objects for the scripts, so they allocate nothing either. */
  readonly probe = new FlightRt()
  readonly scratch = new Float64Array(6)
  readonly llTmp = { lat: 0, lng: 0 }
  private stripBudget = 0
  private lod: Lod = 'near'

  constructor() {
    this.setQuality('high', false)
  }

  /** Deterministic random numbers: the same events look the same, and tests are repeatable. */
  rand(): number {
    let x = this.seedState
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.seedState = x >>> 0
    return (this.seedState >>> 0) / 4294967296
  }

  setQuality(tier: Tier, reduced: boolean) {
    this.tier = tier
    this.reduced = reduced
    this.caps = capsFor(tier, reduced)
    this.particles.setLimit(this.caps.particles)
    // Trim effects that no longer fit.
    while (this.live.length > this.caps.effects) {
      const v = this.weakest()
      if (!v) break
      this.release(v)
      this.stats.evicted++
    }
    this.touch()
  }

  /** True when the layer will draw anything at all. */
  get enabled() {
    return this.tier !== 'off'
  }

  // ---- effects -----------------------------------------------------------------------------------------------

  private weakest(): Fx | null {
    let w: Fx | null = null
    for (const f of this.live) if (!w || f.prio < w.prio || (f.prio === w.prio && f.t0 < w.t0)) w = f
    return w
  }

  private release(f: Fx) {
    const i = this.live.indexOf(f)
    if (i >= 0) {
      this.live[i] = this.live[this.live.length - 1]
      this.live.pop()
    }
    f.live = false
    f.rt.alive = false
    this.fxPool.release(f)
  }

  get freeSlots() {
    return Math.max(0, this.caps.effects - this.live.length)
  }

  get liveEffects() {
    return this.live.length
  }

  add(kind: FxKind, init: FxInit): Fx | null {
    if (this.caps.effects <= 0) return null
    if (this.live.length >= this.caps.effects) {
      const w = this.weakest()
      // The oldest, least important effect gives way, but never to something less important than itself.
      if (!w || w.prio > init.prio) {
        this.stats.rejected++
        return null
      }
      this.release(w)
      this.stats.evicted++
    }
    const f = this.fxPool.acquire()
    if (!f) {
      this.stats.rejected++
      return null
    }
    f.kind = kind
    f.live = true
    f.started = false
    f.t0 = this.now + (init.delay ?? 0)
    f.dur = init.dur
    f.prio = init.prio
    f.lat = init.lat ?? 0
    f.lng = init.lng ?? 0
    f.lat2 = init.lat2 ?? 0
    f.lng2 = init.lng2 ?? 0
    f.a = init.a ?? 0
    f.b = init.b ?? 0
    f.c = init.c ?? 0
    f.d = init.d ?? 0
    f.col = colorId(init.color ?? '#ffffff')
    f.col2 = colorId(init.color2 ?? init.color ?? '#ffffff')
    f.seed = init.seed ?? this.rand()
    f.acc = 0
    this.live.push(f)
    this.touch()
    return f
  }

  /** A timeline flight: from one point to another, `dur` ms, drawing the path between progress p0 and p1. */
  addFlight(kind: FlightKindId, from: { lat: number; lng: number }, to: { lat: number; lng: number }, init: { delay?: number; dur: number; p0?: number; p1?: number; count?: number; id?: string; prio?: number; mine?: boolean; link?: { lat: number; lng: number } }): Fx | null {
    const f = this.add(K.FLIGHT, { delay: init.delay, dur: init.dur, prio: init.prio ?? PRIO.flight, a: init.p0 ?? 0, b: init.p1 ?? 1, c: Math.min(init.count ?? 1, this.caps.bodiesPerSalvo || 1), lat2: init.link?.lat ?? 0, lng2: init.link?.lng ?? 0, d: init.link ? 1 : 0 })
    if (!f) return null
    // The trail lingers a moment after the head arrives, then fades: `acc` holds the flying time.
    f.acc = init.dur
    f.dur = init.dur + 380
    f.rt.set(init.id ?? `t${this.stats.spawned++}`, kind, from.lat, from.lng, to.lat, to.lng)
    f.rt.mine = !!init.mine
    f.rt.count = f.c
    return f
  }

  clearEffects() {
    for (const f of [...this.live]) this.release(f)
    this.particles.clear()
    this.touch()
  }

  // ---- state driven flights ----------------------------------------------------------------------------------

  /** Brings the missiles in the air up to date with the game's. Existing flights keep their objects; new ones start; gone ones leave. */
  syncFlights(specs: readonly FlightSpec[]) {
    const keep = new Set<string>()
    for (const s of specs) {
      keep.add(s.id)
      let rt = this.flights.get(s.id)
      if (!rt) {
        if (this.flights.size >= 160) continue
        const fresh = this.flightPool.acquire()
        if (!fresh) continue
        rt = fresh
        rt.set(s.id, s.kind, s.from.lat, s.from.lng, s.to.lat, s.to.lng)
        this.flights.set(s.id, rt)
        // The launch itself: flash, plume and ground smoke at the site.
        this.onLaunch?.(rt, s)
      }
      rt.launched = s.launched
      rt.lands = s.lands
      rt.count = s.count
      rt.mine = s.mine
      rt.incoming = s.incoming
    }
    for (const [id, rt] of this.flights) {
      if (!keep.has(id)) {
        this.flights.delete(id)
        rt.alive = false
        this.flightPool.release(rt)
      }
    }
    this.ordered.length = 0
    for (const rt of this.flights.values()) this.ordered.push(rt)
    this.ordered.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || b.style.prio - a.style.prio || (a.id < b.id ? -1 : 1))
    this.touch()
  }

  /** Set by the sequence module: what happens when a new flight is seen. */
  onLaunch: ((rt: FlightRt, s: FlightSpec) => void) | null = null

  setDecals(list: readonly DecalSpec[]) {
    this.decals = list.slice(0, this.caps.decals)
    this.touch()
  }

  // ---- particles ---------------------------------------------------------------------------------------------

  /** How many particles to actually spawn for `n` wished for, given zoom. */
  spawnCount(n: number): number {
    return particlesFor(n, this.lod)
  }

  smoke(lat: number, lng: number, n: number, size: number, life: number, color: string, rise = 1.2, alpha = 0.5) {
    const c = colorId(color)
    const k = this.spawnCount(n)
    for (let i = 0; i < k; i++) {
      this.particles.spawn(lat, lng, 0.012, (this.rand() - 0.5) * 1.6, -rise * (0.5 + this.rand()), life * (0.7 + 0.6 * this.rand()), size * 0.5, size * (1.1 + this.rand() * 0.6), alpha, S.smoke, c, Math.floor(this.rand() * 4), false, this.rand() * 6.28, (this.rand() - 0.5) * 0.8)
    }
  }

  dust(lat: number, lng: number, n: number, size: number, life: number, color: string) {
    const c = colorId(color)
    const k = this.spawnCount(n)
    for (let i = 0; i < k; i++) this.particles.spawn(lat, lng, 0.008, (this.rand() - 0.5) * 2.4, -0.2 - this.rand() * 0.5, life * (0.7 + 0.5 * this.rand()), size * 0.4, size, 0.45, S.dust, c, Math.floor(this.rand() * 4), false, this.rand() * 6.28, (this.rand() - 0.5))
  }

  debris(lat: number, lng: number, n: number, size: number, speed: number) {
    const k = this.spawnCount(n)
    for (let i = 0; i < k; i++) {
      const a = this.rand() * 6.283
      const v = speed * (0.4 + this.rand())
      this.particles.spawn(lat, lng, 0.02, Math.cos(a) * v, Math.sin(a) * v - speed * 0.4, 0.7 + this.rand() * 0.8, size, size * 0.6, 0.95, S.debris, 0, Math.floor(this.rand() * 4), false, this.rand() * 6.28, (this.rand() - 0.5) * 12)
    }
  }

  embers(lat: number, lng: number, n: number, size: number, speed: number, life = 1.4) {
    const k = this.spawnCount(n)
    for (let i = 0; i < k; i++) {
      const a = this.rand() * 6.283
      const v = speed * (0.3 + this.rand())
      this.particles.spawn(lat, lng, 0.02, Math.cos(a) * v, Math.sin(a) * v - speed * 0.6, life * (0.6 + 0.8 * this.rand()), size, size * 0.3, 1, S.embers, 0, Math.floor(this.rand() * 4), true, 0, 0)
    }
  }

  sparks(lat: number, lng: number, n: number, size: number, speed: number, color: string) {
    const c = colorId(color)
    const k = this.spawnCount(n)
    for (let i = 0; i < k; i++) {
      const a = this.rand() * 6.283
      const v = speed * (0.4 + this.rand())
      this.particles.spawn(lat, lng, 0.03, Math.cos(a) * v, Math.sin(a) * v, 0.35 + this.rand() * 0.45, size, size * 0.2, 1, S.glow, c, 0, true, 0, 0)
    }
  }

  // ---- time --------------------------------------------------------------------------------------------------

  /** True while something animates by itself: effects, particles. (Flights and armies also need the game clock; the loop knows that.) */
  get animating() {
    return this.live.length > 0 || this.particles.count > 0
  }

  update(dtMs: number) {
    const dt = Math.min(dtMs, 100)
    this.now += dt
    const now = this.now
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i]
      if (now < f.t0) continue
      if (!f.started) {
        f.started = true
        this.start(f)
      }
      const t = now - f.t0
      if (t >= f.dur) {
        this.release(f)
        continue
      }
      this.emit(f, t, dt)
    }
    this.particles.update(dt / 1000)
    this.armies.update(this, dt)
    // Stage separation of flights driven by the game clock.
    for (const rt of this.ordered) {
      if (rt.separated || !rt.style.sparks || rt.kind === 'nuke') continue
      const span = Math.max(1e-6, rt.lands - rt.launched)
      const p = (this.clockT - rt.launched) / span
      if (p > 0.17 && p < 0.9) {
        rt.separated = true
        posAt(rt, p, this.pos, 0)
        xyzToLL(this.pos[0], this.pos[1], this.pos[2], this.ll)
        if (this.lod !== 'far') this.sparks(this.ll.lat, this.ll.lng, 10, 0.9, 5, '#ffe9a8')
      }
    }
  }

  private start(f: Fx) {
    switch (f.kind) {
      case K.BLAST:
        if (this.onShake && f.c > 0 && !this.reduced) this.onShake(f.c)
        if (this.lod !== 'far' && !this.reduced) {
          const big = f.b > 9
          this.smoke(f.lat, f.lng, big ? 5 : 3, f.b * 0.7, 3.2, '#a39a92', 2.2, 0.32)
          this.embers(f.lat, f.lng, big ? 12 : 6, 0.5, 5)
          this.debris(f.lat, f.lng, big ? 6 : 3, 0.55, 5)
        }
        this.onAction?.(f.lat, f.lng, clamp01(f.b / 16))
        break
      case K.BURST:
        if (!this.reduced) this.debris(f.lat, f.lng, 8, 0.45, 4.5)
        if (!this.reduced) this.sparks(f.lat, f.lng, 8, 0.7, 6, COLORS[f.col] ?? '#ffffff')
        break
      case K.SCREEN:
        if (this.onShake && f.c > 0 && !this.reduced) this.onShake(f.c)
        break
      case K.FIREBALL:
        this.onAction?.(f.lat, f.lng, 1)
        break
      default:
        break
    }
  }

  /** Per frame spawning of long effects (launch smoke, the nuclear ash veil, flickering fires). */
  private emit(f: Fx, t: number, dt: number) {
    if (this.reduced) return
    switch (f.kind) {
      case K.FLASH: {
        if (t > 1100) break
        f.acc += dt
        if (f.acc > 55) {
          f.acc = 0
          this.dust(f.lat, f.lng, 1, f.b * 0.55, 2.2, '#b7ada0')
          if (t < 600) this.smoke(f.lat, f.lng, 1, f.b * 0.7, 2.6, '#8e8a86', 0.9, 0.5)
        }
        break
      }
      case K.ASH: {
        f.acc += dt
        if (f.acc > 150 && t < f.dur * 0.6) {
          f.acc = 0
          const a = this.rand() * 6.283
          const r = this.rand() * f.b
          const dlat = (Math.sin(a) * r) / 111
          const dlng = (Math.cos(a) * r) / 111 / Math.max(0.2, Math.cos((f.lat * Math.PI) / 180))
          this.smoke(f.lat + dlat, f.lng + dlng, 1, 6 + this.rand() * 4, 7, '#5a524c', 0.45, 0.28)
          if (this.rand() < 0.5) this.embers(f.lat + dlat, f.lng + dlng, 1, 0.5, 1.5, 3)
        }
        break
      }
      case K.GLOW:
        break
      case K.FLIGHT: {
        // A flight leaves smoke where it flies, a little for the big ones.
        break
      }
      default:
        break
    }
  }

  // ---- drawing -----------------------------------------------------------------------------------------------

  /** Everything the screen shows right now, for a view. Returns whether it drew anything (a still frame can then be left alone). */
  draw(p: Painter, v: View): boolean {
    this.view = v
    this.lod = lodOf(v.pxPerUnit)
    this.screenAlpha = 0
    this.vignette = 0
    this.stripBudget = this.caps.stripTrails
    if (!this.enabled) return false
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    this.drawDecals(p, v)
    this.armies.draw(this, p, v)
    this.drawFlights(p, v)
    for (const f of this.live) if (this.now >= f.t0) this.drawFx(p, v, f)
    this.drawParticles(p, v)
    this.drawScreen(p, v)
    this.stats.frames++
    const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0
    this.stats.jsMs += (ms - this.stats.jsMs) * 0.1
    this.stats.particles = this.particles.count
    this.stats.effects = this.live.length
    this.stats.flights = this.flights.size
    this.stats.blits = p.blits
    this.stats.spawned = this.particles.spawned
    this.stats.dropped = this.particles.dropped
    this.stats.reused = this.fxPool.reused
    this.stats.tier = this.tier
    this.dirty = false
    return true
  }

  private drawDecals(p: Painter, v: View) {
    const list = this.decals
    if (!list.length) return
    const pt = this.pt
    const ppu = v.pxPerUnit
    const rpx = GLOBE_R * ppu
    for (let i = 0; i < list.length && i < this.caps.decals; i++) {
      const d = list[i]
      project(v, d.lat, d.lng, 0.006, pt)
      if (!pt.vis) continue
      const dx = pt.x - v.cx
      const dy = pt.y - v.cy
      const dist = Math.hypot(dx, dy)
      const ndist = Math.min(0.97, dist / rpx)
      const squash = Math.max(0.22, Math.sqrt(1 - ndist * ndist))
      const rot = Math.atan2(dy, dx) + Math.PI / 2
      const size = ((d.radius * Math.PI) / 180) * GLOBE_R * 2.2 * ppu
      if (size < 3) continue
      const flick = 0.82 + 0.18 * Math.sin(this.now / 130 + i * 1.7) * (this.reduced ? 0 : 1)
      switch (d.kind) {
        case 'scorch':
          p.sprite('decal.scorch', i % 2, pt.x, pt.y, size, rot, d.alpha, null, false, squash)
          break
        case 'crater':
          p.sprite('decal.crater', i % 2, pt.x, pt.y, size * 0.8, rot, d.alpha, null, false, squash)
          break
        case 'ember':
        case 'fire':
          p.sprite('glow.fire', 0, pt.x, pt.y, size * (d.kind === 'fire' ? 0.9 : 0.75), rot, d.alpha * flick, d.kind === 'fire' ? '#ff7a1a' : '#ff9d3a', true, squash)
          break
        case 'nuke':
          p.sprite('decal.scorch', 1, pt.x, pt.y, size, rot, d.alpha * 0.9, null, false, squash)
          p.sprite('glow.fire', 0, pt.x, pt.y, size * 0.85, rot, d.alpha * flick * 0.9, '#ff5a1f', true, squash)
          break
        case 'smoke': {
          // A pale column that sways and thins; it stands up from the ground.
          const sway = this.reduced ? 0 : Math.sin(this.now / 1700 + i) * size * 0.06
          p.sprite('particle.smoke', i % 4, pt.x + sway, pt.y - size * 0.42, size * 0.95, 0, d.alpha * 0.8, '#9a948d', false)
          break
        }
      }
    }
  }

  private drawFlights(p: Painter, v: View) {
    const list = this.ordered
    if (!list.length || this.reduced) return
    const full = Math.min(list.length, this.caps.fullFlights)
    const segs = segmentsPerFlight(this.caps.trailSegments, full, MAX_TRAIL - 2)
    for (let i = 0; i < list.length; i++) {
      const rt = list[i]
      const span = Math.max(1e-6, rt.lands - rt.launched)
      const pr = (this.clockT - rt.launched) / span
      if (pr <= 0 || pr >= 1.02) continue
      this.drawFlight(p, v, rt, Math.min(1, pr), rt.count > 1 ? Math.min(rt.count, this.caps.bodiesPerSalvo) : 1, 1, i < full ? segs : 0, i)
    }
  }

  /** One flight (or the bodies of a salvo flying together): tapered glow trail, hot core, head, and what the kind adds. */
  drawFlight(p: Painter, v: View, rt: FlightRt, prog: number, bodies: number, alpha: number, segs: number, order: number) {
    const st = rt.style
    const ppu = v.pxPerUnit
    const color = this.colorblind ? st.cb : st.color
    const lenP = Math.min(0.55, st.length / rt.omega)
    const pos = this.pos
    const pt = this.pt
    const ctx = p.ctx
    const widthPx = Math.max(1.1, Math.min(7, st.width * ppu))
    // Bodies fly in a loose bundle: sideways spread, a little apart in time.
    for (let b = 0; b < bodies; b++) {
      const lateral = bodies > 1 ? ((b - (bodies - 1) / 2) * 0.55 + (((rt.seed * 97 + b * 31) % 1) - 0.5) * 0.3) * 0.012 : 0
      const lag = bodies > 1 ? b * 0.006 : 0
      const head = Math.max(0, prog - lag)
      if (head <= 0.001) continue
      const n = segs > 0 ? segs : 2
      let any = false
      for (let i = 0; i <= n; i++) {
        const q = Math.max(0, head - (i / n) * lenP * (segs > 0 ? 1 : 0.5))
        posAt(rt, q, pos, 3 * i, lateral)
        v.projectXYZ(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], pt)
        this.tx[i] = pt.x
        this.ty[i] = pt.y
        this.tv[i] = pt.vis ? 1 : 0
        if (pt.vis) any = true
      }
      if (!any) continue
      // index 0 is the head, n the tail.
      const hx = this.tx[0]
      const hy = this.ty[0]
      const hot = head > 0.86 ? clamp01((head - 0.86) / 0.1) : 0
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (segs > 0) {
        p.setMode(true)
        // Glow: one wide stroke along the whole trail.
        if (this.caps.glow) {
          p.setAlpha(0.2 * alpha)
          ctx.strokeStyle = color
          ctx.lineWidth = widthPx * 3.4
          ctx.beginPath()
          let pen = false
          for (let i = n; i >= 0; i--) {
            if (!this.tv[i]) {
              pen = false
              continue
            }
            if (!pen) ctx.moveTo(this.tx[i], this.ty[i])
            else ctx.lineTo(this.tx[i], this.ty[i])
            pen = true
          }
          ctx.stroke()
        }
        // Core: tapered, brighter toward the head.
        for (let i = n; i > 0; i--) {
          if (!this.tv[i] || !this.tv[i - 1]) continue
          const f = 1 - i / n
          p.setAlpha((0.15 + 0.85 * f) * alpha)
          ctx.strokeStyle = f > 0.7 ? '#ffffff' : color
          ctx.lineWidth = Math.max(0.6, widthPx * (0.15 + 0.85 * f))
          let x0 = this.tx[i]
          let y0 = this.ty[i]
          let x1 = this.tx[i - 1]
          let y1 = this.ty[i - 1]
          if (st.braid || rt.kind === 'interceptor') {
            // Braided or zigzag trails: sideways wobble that differs by kind, so kinds read without colour.
            const w = (rt.kind === 'interceptor' ? 3.2 : 2.2) * f
            const s0 = Math.sin(i * 1.7 + this.now / 90) * w
            const s1 = Math.sin((i - 1) * 1.7 + this.now / 90) * w
            x0 += s0
            x1 += s1
            y0 -= s0 * 0.5
            y1 -= s1 * 0.5
          }
          ctx.beginPath()
          ctx.moveTo(x0, y0)
          ctx.lineTo(x1, y1)
          ctx.stroke()
        }
        if (st.shimmer) {
          // Hypersonic heat shimmer: two faint, wavering copies of the trail beside it.
          p.setAlpha(0.18 * alpha)
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = widthPx * 0.8
          for (const side of [-1, 1]) {
            ctx.beginPath()
            let pen = false
            for (let i = n; i >= 0; i--) {
              if (!this.tv[i]) continue
              const w = Math.sin(i * 1.4 + this.now / 70 + side) * 2.4 * (1 - i / n) + side * widthPx * 1.3 * (1 - i / n)
              if (!pen) ctx.moveTo(this.tx[i] + w, this.ty[i] - w * 0.6)
              else ctx.lineTo(this.tx[i] + w, this.ty[i] - w * 0.6)
              pen = true
            }
            ctx.stroke()
          }
        }
        // The art pack's trail strip, stamped over the nearest trails: its pattern is what tells kinds apart without colour.
        if (b === 0 && this.stripBudget > 0 && n >= 3) {
          const tailI = Math.min(n, 4)
          if (this.tv[0] && this.tv[tailI]) {
            this.stripBudget--
            p.strip(st.trail, this.tx[tailI], this.ty[tailI], hx, hy, Math.max(4, widthPx * 2.6), 0.85 * alpha, this.now / 400, rt.kind === 'hypersonic' ? color : null, true)
          }
        }
        if (st.cone && this.tv[0] && this.tv[2]) {
          // Shock cone: a faint V opening behind the head.
          const dx = this.tx[2] - hx
          const dy = this.ty[2] - hy
          const l = Math.hypot(dx, dy) || 1
          const nx = -dy / l
          const ny = dx / l
          const L = 10 + widthPx * 5
          p.setAlpha(0.45 * alpha)
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.1
          ctx.beginPath()
          ctx.moveTo(hx + (dx / l) * L + nx * L * 0.5, hy + (dy / l) * L + ny * L * 0.5)
          ctx.lineTo(hx, hy)
          ctx.lineTo(hx + (dx / l) * L - nx * L * 0.5, hy + (dy / l) * L - ny * L * 0.5)
          ctx.stroke()
        }
      } else {
        // A far-away or crowded flight: a short bright streak and a dot.
        if (this.tv[0] && this.tv[n]) {
          p.setMode(true)
          p.setAlpha(0.8 * alpha)
          ctx.strokeStyle = color
          ctx.lineWidth = Math.max(1, widthPx * 0.6)
          ctx.beginPath()
          ctx.moveTo(this.tx[n], this.ty[n])
          ctx.lineTo(hx, hy)
          ctx.stroke()
        }
      }
      if (this.tv[0]) {
        const hsz = Math.max(5, st.head * ppu * (1 + hot * 0.9))
        if (segs > 0 || order < this.caps.fullFlights) {
          p.sprite('glow.fire', 0, hx, hy, hsz * (1.2 + 0.12 * Math.sin(this.now / 60 + b)), 0, (0.85 + 0.15 * hot) * alpha, hot > 0 ? '#ffd9a0' : color, true)
          if (hot > 0) p.sprite('glow.fire', 0, hx, hy, hsz * 1.7, 0, 0.5 * hot * alpha, '#ff6a2a', true)
          p.sprite('glow.fire', 0, hx, hy, hsz * 0.45, 0, alpha, '#ffffff', true)
          if (st.sparkle) p.sprite('missile.flareSparkle', Math.floor(this.now / 120), hx, hy, hsz * 2, 0, 0.9 * alpha, '#ffffff', true)
        } else p.glow(hx, hy, hsz, 0.9 * alpha, color)
      }
    }
    // Incoming threats show where they will land.
    if (rt.incoming && order < 6 && !this.reduced) this.drawReticle(p, v, rt, prog)
    // The path's end stays marked for the player's own strikes, faintly.
  }

  private drawReticle(p: Painter, v: View, rt: FlightRt, prog: number) {
    project(v, rt.lat1, rt.lng1, 0.012, this.pt2)
    if (!this.pt2.vis) return
    const pulse = 0.55 + 0.45 * Math.sin(this.now / 160)
    const size = (7 + 3 * prog) * v.pxPerUnit * 0.5 * (rt.kind === 'nuke' ? 1.9 : 1)
    const dx = this.pt2.x - v.cx
    const dy = this.pt2.y - v.cy
    const ndist = Math.min(0.97, Math.hypot(dx, dy) / (GLOBE_R * v.pxPerUnit))
    const squash = Math.max(0.25, Math.sqrt(1 - ndist * ndist))
    const rot = Math.atan2(dy, dx) + Math.PI / 2
    p.sprite('ui.ring.dashed', 0, this.pt2.x, this.pt2.y, size, this.now / 900, 0.55 + 0.4 * pulse, this.alertColor, true, squash)
    p.sprite('ui.ring.thin', 0, this.pt2.x, this.pt2.y, size * (1.1 + 0.9 * ((this.now / 900) % 1)), rot, 0.6 * (1 - ((this.now / 900) % 1)), this.alertColor, true, squash)
  }

  private drawFx(p: Painter, v: View, f: Fx) {
    const t = this.now - f.t0
    const u = clamp01(t / f.dur)
    const ppu = v.pxPerUnit
    const pt = this.pt
    switch (f.kind) {
      case K.FLASH: {
        project(v, f.lat, f.lng, 0.01, pt)
        if (!pt.vis) return
        const size = f.b * ppu * 1.7
        const flashT = t / 1000
        // Hot flash, then a plume that stands up above the site while the smoke thickens.
        p.sprite('missile.launchFlash', Math.floor(flashT * 20), pt.x, pt.y, size * 1.6, 0, clamp01(1 - t / 320), null, true)
        p.glow(pt.x, pt.y, size * 3, 0.55 * clamp01(1 - t / 420), '#ffd9a0')
        if (!this.reduced && t < f.dur * 0.9) {
          const rise = EASE.outCubic(clamp01(t / 900)) * size * 0.9
          p.sprite('missile.launchPlume', Math.floor(flashT * 12), pt.x, pt.y - rise * 0.15, size * (0.9 + 0.8 * clamp01(t / 700)), 0, clamp01(1 - (t - 250) / (f.dur - 250)) * 0.9, null, true)
        }
        break
      }
      case K.BURST: {
        project(v, f.lat, f.lng, f.a, pt)
        if (!pt.vis) return
        const size = f.b * ppu
        const burstEnd = 4 / 16
        const sec = t / 1000
        const hold = sec > burstEnd ? clamp01(1 - (sec - burstEnd) / ((f.dur / 1000) - burstEnd)) : 1
        p.sprite('missile.interceptBurst', Math.floor(sec * 16), pt.x, pt.y, size * 1.7, 0, hold, null, true)
        p.glow(pt.x, pt.y, size * 1.6, 0.35 * clamp01(1 - t / 260), COLORS[f.col] ?? '#64d2ff')
        const e = EASE.outCubic(u)
        p.sprite('ui.ring.thin', 0, pt.x, pt.y, size * (0.5 + 2.8 * e), 0, (1 - u) * 0.9, COLORS[f.col] ?? '#64d2ff', true)
        break
      }
      case K.BLAST: {
        project(v, f.lat, f.lng, 0.014, pt)
        if (!pt.vis) return
        const kind = f.a | 0
        const clip = BLAST_CLIPS[kind] ?? BLAST_CLIPS[0]
        const fps = BLAST_FPS[kind] ?? 18
        const size = f.b * ppu
        const sec = t / 1000
        const playEnd = 8 / fps
        const fade = sec > playEnd ? clamp01(1 - (sec - playEnd) / Math.max(0.1, f.dur / 1000 - playEnd)) : 1
        const grow = 0.8 + 0.35 * EASE.outCubic(clamp01(sec / playEnd))
        p.glow(pt.x, pt.y, size * 2.6, 0.5 * clamp01(1 - t / 700), kind === 2 ? '#8ad4ff' : '#ff9a3c')
        p.sprite(clip, Math.floor(sec * fps), pt.x, pt.y - size * 0.1, size * grow, 0, fade, null, false)
        if (t < TIMING.flash * 1.5) p.glow(pt.x, pt.y, size * 2.2, 1 - t / (TIMING.flash * 1.5), '#ffffff')
        break
      }
      case K.RING: {
        // A ring on the ground that sweeps outward along the globe, drawn as a polyline of true great-circle points.
        const e = EASE.outCubic(u)
        const theta = (f.a * e * Math.PI) / 180
        if (theta < 0.002) return
        this.drawGroundRing(p, v, f, theta, (1 - u) * (f.d > 0 ? 0.9 : 0.8))
        if (f.d > 1) this.drawGroundRing(p, v, f, theta * 0.72, (1 - u) * 0.45)
        break
      }
      case K.FLIGHT: {
        const flying = Math.max(1, f.acc)
        const prog = lerp(f.a, f.b, clamp01(t / flying))
        const lingering = t > flying
        this.drawFlight(p, v, f.rt, prog, f.c | 0 || 1, lingering ? clamp01(1 - (t - flying) / 380) : 1, this.caps.trailSegments > 0 ? 12 : 0, 0)
        if (f.d > 0 && this.caps.glow && !lingering) {
          // Interceptor's lock line: a fine dashed line from the interceptor to what it is chasing.
          posAt(f.rt, prog, this.pos, 0)
          v.projectXYZ(this.pos[0], this.pos[1], this.pos[2], pt)
          project(v, f.lat2, f.lng2, 0.06, this.pt2)
          if (pt.vis && this.pt2.vis) {
            const ctx = p.ctx
            p.setMode(true)
            p.setAlpha(0.75 * (0.6 + 0.4 * Math.sin(this.now / 50)))
            ctx.strokeStyle = '#9be7ff'
            ctx.lineWidth = 1
            ctx.setLineDash([3, 4])
            ctx.beginPath()
            ctx.moveTo(pt.x, pt.y)
            ctx.lineTo(this.pt2.x, this.pt2.y)
            ctx.stroke()
            ctx.setLineDash([])
            p.sprite('ui.ring.thin', 0, this.pt2.x, this.pt2.y, 12 + 6 * (1 - t / flying), this.now / 200, 0.9, '#9be7ff', true)
          }
        }
        break
      }
      case K.SCREEN: {
        // a: profile (0 nuclear wash, 1 plain flash), b: peak, c: shake (applied at start)
        const ms = t
        let a = 0
        if (f.a === 0) {
          a = ms < 150 ? EASE.outQuad(ms / 150) : ms < 450 ? 1 : ms < 1600 ? lerp(1, 0.2, EASE.outCubic((ms - 450) / 1150)) : lerp(0.2, 0, (ms - 1600) / Math.max(1, f.dur - 1600))
          this.vignette = Math.max(this.vignette, clamp01(ms / 400) * (1 - clamp01((ms - 1800) / Math.max(1, f.dur - 1800))) * 0.32)
        } else a = ms < 90 ? ms / 90 : 1 - EASE.outQuad((ms - 90) / Math.max(1, f.dur - 90))
        a *= f.b
        if (a > this.screenAlpha) {
          this.screenAlpha = a
          this.screenCol = ms < 450 ? '#ffffff' : '#fff1dc'
        }
        break
      }
      case K.FIREBALL: {
        project(v, f.lat, f.lng, 0.02, pt)
        if (!pt.vis) return
        const size = f.b * ppu
        const sec = t / 1000
        const fade = clamp01(1 - (sec - 0.6) / (f.dur / 1000 - 0.6))
        p.glow(pt.x, pt.y, size * 3, 0.6 * fade, '#ff7a1a')
        p.sprite('nuke.fireball', Math.floor(sec * 12), pt.x, pt.y, size * (0.9 + 0.4 * EASE.outCubic(clamp01(sec / 0.7))), 0, fade, null, true)
        break
      }
      case K.MUSHROOM: {
        project(v, f.lat, f.lng, 0.02, pt)
        if (!pt.vis) return
        const size = f.b * ppu
        const sec = t / 1000
        const rise = EASE.outCubic(clamp01(sec / 4))
        const fade = clamp01(1 - (sec - f.dur / 1000 + 2.5) / 2.5)
        // Rises and widens: scale from the foot of the stem.
        p.sprite(sec < 0.8 ? 'nuke.mushroom' : 'nuke.plume', sec < 0.8 ? Math.floor(sec * 10) : Math.floor((sec - 0.8) * 6), pt.x, pt.y, size * (0.35 + 0.75 * rise), 0, Math.min(1, fade) * clamp01(sec * 2), null, false)
        break
      }
      case K.GLOW: {
        project(v, f.lat, f.lng, 0.014, pt)
        if (!pt.vis) return
        const size = f.b * ppu
        const flick = 0.75 + 0.25 * Math.sin(this.now / 140 + f.seed * 9)
        const fade = clamp01(Math.min(t / 600, (f.dur - t) / 3000))
        p.sprite('glow.fire', 0, pt.x, pt.y, size * (0.9 + 0.1 * flick), 0, 0.8 * fade * flick, '#ff6a1f', true)
        break
      }
      case K.ALERT: {
        project(v, f.lat, f.lng, 0.012, pt)
        if (!pt.vis) return
        const size = f.b * ppu
        const ph = (t / 900) % 1
        const dx = pt.x - v.cx
        const dy = pt.y - v.cy
        const ndist = Math.min(0.97, Math.hypot(dx, dy) / (GLOBE_R * ppu))
        const squash = Math.max(0.25, Math.sqrt(1 - ndist * ndist))
        const rot = Math.atan2(dy, dx) + Math.PI / 2
        p.sprite('ui.ring.dashed', 0, pt.x, pt.y, size, t / 1200, 0.8, this.alertColor, true, squash)
        p.sprite('ui.ring.thin', 0, pt.x, pt.y, size * (0.8 + 1.8 * ph), rot, (1 - ph) * 0.9, this.alertColor, true, squash)
        break
      }
      default:
        break
    }
  }

  /** A ring at angular distance `theta` (radians) around the effect's centre, as a polyline over the globe. */
  private drawGroundRing(p: Painter, v: View, f: Fx, theta: number, alpha: number) {
    const steps = this.caps.ringSteps
    if (steps <= 0 || alpha <= 0.01) return
    const ctx = p.ctx
    const pt = this.pt
    const ct = Math.cos(theta)
    const st = Math.sin(theta)
    const c = this.basis(f.lat, f.lng)
    const colr = COLORS[f.col] ?? '#ffffff'
    const wpx = Math.max(1.5, f.b)
    p.setMode(true)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let pass = 0; pass < 2; pass++) {
      p.setAlpha(pass === 0 ? alpha * 0.28 : alpha)
      ctx.strokeStyle = pass === 0 ? colr : '#ffffff'
      ctx.lineWidth = pass === 0 ? wpx * 4 : wpx
      ctx.beginPath()
      let pen = false
      for (let i = 0; i <= steps; i++) {
        const b = (i / steps) * Math.PI * 2
        const cb = Math.cos(b)
        const sb = Math.sin(b)
        const x = (c[0] * ct + (c[3] * cb + c[6] * sb) * st) * GLOBE_R * 1.004
        const y = (c[1] * ct + (c[4] * cb + c[7] * sb) * st) * GLOBE_R * 1.004
        const z = (c[2] * ct + (c[5] * cb + c[8] * sb) * st) * GLOBE_R * 1.004
        v.projectXYZ(x, y, z, pt)
        if (!pt.vis) {
          pen = false
          continue
        }
        if (!pen) ctx.moveTo(pt.x, pt.y)
        else ctx.lineTo(pt.x, pt.y)
        pen = true
      }
      ctx.stroke()
    }
  }

  private readonly basisBuf = new Float64Array(9)
  /** Centre, north and east unit vectors at a place, in the globe's own coordinates. */
  private basis(lat: number, lng: number): Float64Array {
    const b = this.basisBuf
    const e = 0.01
    llToXYZOut(lat, lng, b, 0)
    llToXYZOut(Math.min(89.9, lat + e), lng, b, 3)
    // north = d(centre)/d(lat), normalised and made orthogonal to the centre.
    let nx = b[3] - b[0]
    let ny = b[4] - b[1]
    let nz = b[5] - b[2]
    const dn = nx * b[0] + ny * b[1] + nz * b[2]
    nx -= dn * b[0]
    ny -= dn * b[1]
    nz -= dn * b[2]
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    // east = north x centre (or centre x north; handedness is irrelevant for a full circle).
    const ex = ny * b[2] - nz * b[1]
    const ey = nz * b[0] - nx * b[2]
    const ez = nx * b[1] - ny * b[0]
    b[3] = nx
    b[4] = ny
    b[5] = nz
    b[6] = ex
    b[7] = ey
    b[8] = ez
    return b
  }

  private drawParticles(p: Painter, v: View) {
    const ps = this.particles
    if (ps.count === 0) return
    const ppu = v.pxPerUnit
    const pt = this.pt
    for (let i = 0; i < ps.limit; i++) {
      if (!ps.alive[i]) continue
      project(v, ps.lat[i], ps.lng[i], ps.alt[i], pt)
      if (!pt.vis) continue
      const t = ps.age[i] / ps.life[i]
      const size = lerp(ps.size0[i], ps.size1[i], t) * ppu
      if (size < 1.2) continue
      const a = ps.alpha[i] * Math.min(1, t * 14) * Math.pow(1 - t, 1.3)
      const name = SPRITE_IDS[ps.sprite[i]]
      p.sprite(name, ps.frame[i], pt.x + ps.ox[i] * ppu, pt.y + ps.oy[i] * ppu, size, ps.rot[i], a, ps.color[i] ? (COLORS[ps.color[i]] ?? null) : null, ps.additive[i] === 1)
    }
  }

  private drawScreen(p: Painter, v: View) {
    const ctx = p.ctx
    if (this.vignette > 0.01) {
      p.setMode(false)
      p.setAlpha(1)
      const g = ctx.createRadialGradient(v.w / 2, v.h / 2, Math.min(v.w, v.h) * 0.3, v.w / 2, v.h / 2, Math.hypot(v.w, v.h) * 0.62)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, `rgba(20,6,0,${Math.min(0.35, this.vignette).toFixed(3)})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, v.w, v.h)
    }
    if (this.screenAlpha > 0.003) {
      p.setMode(false)
      p.setAlpha(Math.min(1, this.screenAlpha))
      ctx.fillStyle = this.screenCol
      ctx.fillRect(0, 0, v.w, v.h)
    }
  }

  /** Clustering helper exposed for sequences: how many impacts to play now. */
  impactPlan(hits: number) {
    return clusterImpacts(hits, this.freeSlots, this.lod)
  }

  get lodLevel(): Lod {
    return this.lod
  }
  setLod(l: Lod) {
    this.lod = l
  }

  /** Looks up where a missile flight (state driven) is right now, for effects that follow it. */
  headOf(rt: FlightRt, out: { lat: number; lng: number }) {
    const span = Math.max(1e-6, rt.lands - rt.launched)
    posAt(rt, (this.clockT - rt.launched) / span, this.pos, 0)
    xyzToLL(this.pos[0], this.pos[1], this.pos[2], out)
  }
}

function llToXYZOut(lat: number, lng: number, out: Float64Array, o: number) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((90 - lng) * Math.PI) / 180
  const s = Math.sin(phi)
  out[o] = s * Math.cos(theta)
  out[o + 1] = Math.cos(phi)
  out[o + 2] = s * Math.sin(theta)
}
