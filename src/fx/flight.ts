import { GLOBE_R, llToXYZ } from './view'

/**
 * Missile flights as maths: where a missile is at a point of its flight, and what each kind looks like. A flight keeps the unit vectors of
 * its two ends (once), and every frame finds any point of its path with a couple of sines, so a trail of a dozen points costs no allocation
 * and almost no time.
 */
export type FlightKindId = 'cruise' | 'tactical' | 'hypersonic' | 'ballistic' | 'decoy' | 'nuke' | 'interceptor'

export interface FlightStyle {
  /** Trail strip in the art pack. */
  trail: string
  color: string
  /** Color-blind palette variant. */
  cb: string
  /** Trail length as an angle on the globe (radians) and thickness (world units, at the head). */
  length: number
  width: number
  /** How high the path climbs, as a share of the globe radius (for a flight of about 40 degrees), and how sharply (exponent of the sine). */
  peak: number
  sharp: number
  /** Head glow size in world units. */
  head: number
  /** 0 flies at an even speed; above 0 it accelerates (a rocket climbing out), below 0 it decelerates. */
  accel: number
  /** Terrain-hugging wobble (world units of altitude). */
  hug: number
  /** Extra looks. */
  cone: boolean
  shimmer: boolean
  sparkle: boolean
  sparks: boolean
  braid: boolean
  /** Importance when the frame budget is short. */
  prio: number
}

export const FLIGHT_STYLES: Record<FlightKindId, FlightStyle> = {
  ballistic: { trail: 'trail.ballistic', color: '#d56bff', cb: '#cc79a7', length: 0.3, width: 0.9, peak: 0.34, sharp: 0.7, head: 3.6, accel: 0.7, hug: 0, cone: false, shimmer: false, sparkle: false, sparks: true, braid: false, prio: 6 },
  cruise: { trail: 'trail.cruise', color: '#4dc3ff', cb: '#56b4e9', length: 0.16, width: 0.38, peak: 0.012, sharp: 1, head: 2.2, accel: 0, hug: 0.01, cone: false, shimmer: false, sparkle: false, sparks: false, braid: false, prio: 4 },
  tactical: { trail: 'trail.tactical', color: '#30d158', cb: '#009e73', length: 0.12, width: 0.6, peak: 0.07, sharp: 1.1, head: 2.6, accel: -0.25, hug: 0, cone: false, shimmer: false, sparkle: false, sparks: false, braid: false, prio: 4 },
  hypersonic: { trail: 'trail.contrail', color: '#ffd60a', cb: '#e69f00', length: 0.34, width: 0.7, peak: 0.13, sharp: 0.9, head: 3, accel: 0.25, hug: 0, cone: true, shimmer: true, sparkle: false, sparks: false, braid: false, prio: 5 },
  decoy: { trail: 'trail.flare', color: '#9fa0b8', cb: '#b8b8b8', length: 0.12, width: 0.3, peak: 0.05, sharp: 1, head: 2, accel: 0, hug: 0, cone: false, shimmer: false, sparkle: true, sparks: false, braid: false, prio: 1 },
  nuke: { trail: 'trail.nuke', color: '#ff2d95', cb: '#ff9f0a', length: 0.42, width: 1.5, peak: 0.55, sharp: 0.8, head: 5, accel: 0.55, hug: 0, cone: false, shimmer: false, sparkle: false, sparks: true, braid: true, prio: 10 },
  interceptor: { trail: 'trail.interceptor', color: '#64d2ff', cb: '#56b4e9', length: 0.14, width: 0.4, peak: 0.02, sharp: 1, head: 1.8, accel: 0.9, hug: 0, cone: false, shimmer: false, sparkle: false, sparks: false, braid: false, prio: 3 },
}

export class FlightRt {
  id = ''
  style: FlightStyle = FLIGHT_STYLES.cruise
  kind: FlightKindId = 'cruise'
  ax = 1
  ay = 0
  az = 0
  bx = 0
  by = 1
  bz = 0
  omega = 0
  sinO = 1
  /** Absolute days (state flights) or unused. */
  launched = 0
  lands = 1
  count = 1
  /** Whether it matters to the player (theirs, or aimed at them), and whether it is aimed at them. */
  mine = false
  incoming = false
  /** Per flight random phase and lateral spread seed. */
  seed = 0
  emit = 0
  separated = false
  alive = false
  /** Endpoints in degrees, for spawning effects. */
  lat0 = 0
  lng0 = 0
  lat1 = 0
  lng1 = 0
  sx = 0
  sy = 0
  sz = 0
  hx = 0
  hy = 0
  hz = 0

  set(id: string, kind: FlightKindId, lat0: number, lng0: number, lat1: number, lng1: number) {
    this.id = id
    this.kind = kind
    this.style = FLIGHT_STYLES[kind]
    this.lat0 = lat0
    this.lng0 = lng0
    this.lat1 = lat1
    this.lng1 = lng1
    const t = tmpA
    llToXYZ(lat0, lng0, 1, t, 0)
    llToXYZ(lat1, lng1, 1, t, 3)
    this.ax = t[0]
    this.ay = t[1]
    this.az = t[2]
    this.bx = t[3]
    this.by = t[4]
    this.bz = t[5]
    const dot = Math.max(-1, Math.min(1, this.ax * this.bx + this.ay * this.by + this.az * this.bz))
    this.omega = Math.max(0.02, Math.acos(dot))
    this.sinO = Math.sin(this.omega)
    this.seed = hash01(id)
    this.emit = 0
    this.separated = false
    this.alive = true
    this.mine = false
    this.incoming = false
    this.count = 1
  }
}
const tmpA = new Float64Array(6)

export function hash01(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/** Shapes even progress into the kind's speed: a rocket climbs slowly and comes down fast. */
export function shape(style: FlightStyle, p: number): number {
  const a = Math.max(-0.95, Math.min(0.95, style.accel))
  if (a === 0) return p
  // Speed runs from (1 - a) to (1 + a) over the flight: monotonic, and both ends stay fixed at 0 and 1.
  return (1 - a) * p + a * p * p
}

/** The altitude (as a fraction of the globe radius) at shaped progress q, for a flight of angle omega. */
export function altitudeAt(f: FlightRt, q: number): number {
  const s = f.style
  const scale = Math.min(1.1, f.omega / 0.7)
  const arc = s.peak * scale * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, q))), s.sharp)
  const hug = s.hug > 0 ? s.hug * (0.6 + 0.4 * Math.sin(q * 38 + f.seed * 6.28)) : 0
  return 0.004 + arc + hug
}

/** World position (globe radius 100) at raw progress p (0 to 1). Writes into `out` at offset `o`. Returns the altitude used. */
export function posAt(f: FlightRt, p: number, out: Float64Array, o: number, lateral = 0): number {
  const pp = p < 0 ? 0 : p > 1 ? 1 : p
  const q = shape(f.style, pp)
  const w1 = Math.sin((1 - q) * f.omega) / f.sinO
  const w2 = Math.sin(q * f.omega) / f.sinO
  let x = w1 * f.ax + w2 * f.bx
  let y = w1 * f.ay + w2 * f.by
  let z = w1 * f.az + w2 * f.bz
  const alt = altitudeAt(f, q)
  if (lateral !== 0) {
    // Sideways spread for the bodies of a salvo: across the path, fading to nothing at both ends.
    const cx = f.ay * f.bz - f.az * f.by
    const cy = f.az * f.bx - f.ax * f.bz
    const cz = f.ax * f.by - f.ay * f.bx
    const cl = Math.hypot(cx, cy, cz) || 1
    const k = (lateral * Math.sin(Math.PI * pp)) / cl
    x += cx * k
    y += cy * k
    z += cz * k
  }
  const l = Math.hypot(x, y, z) || 1
  const r = (GLOBE_R * (1 + alt)) / l
  out[o] = x * r
  out[o + 1] = y * r
  out[o + 2] = z * r
  return alt
}

/** Latitude and longitude of a world position, for spawning ground effects under a flying missile. */
export function xyzToLL(x: number, y: number, z: number, out: { lat: number; lng: number }) {
  const r = Math.hypot(x, y, z) || 1
  out.lat = 90 - (Math.acos(Math.max(-1, Math.min(1, y / r))) * 180) / Math.PI
  out.lng = 90 - (Math.atan2(z, x) * 180) / Math.PI
  if (out.lng < -180) out.lng += 360
}
