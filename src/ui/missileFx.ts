import { absDay } from '../engine/calendar'
import { greatCircle } from '../engine/armies'
import type { GameState, MissileType, NationId, SalvoReport } from '../engine/types'

/**
 * What the missile war looks like on the globe, as plain data. Every function here is pure (no three.js, no store), so the looks, the
 * particle caps and the fading of scorch marks can be tested. The globe hook (globe/useMissileFx.ts) only turns these into rings, points
 * and sprites.
 */

export type Palette = 'standard' | 'colorblind'

export interface KindLook {
  /** The trail's color in the standard palette and in the color-blind one (blue, orange and pink apart, so a trail reads without red and green). */
  color: string
  cb: string
  /** Trail thickness, how high the flight arcs above the ground (in globe radii), and the length of the bright stretch (share of the arc). Cruise skims, ballistic climbs. */
  stroke: number
  altitude: number
  dash: number
  /** How big its impact ring gets (degrees of arc) and how hard it shakes the screen. */
  blast: number
  shake: number
}

export const LOOK: Record<MissileType, KindLook> = {
  cruise: { color: '#4dc3ff', cb: '#56b4e9', stroke: 0.3, altitude: 0.05, dash: 0.1, blast: 3.2, shake: 0.2 },
  tactical: { color: '#30d158', cb: '#009e73', stroke: 0.45, altitude: 0.14, dash: 0.16, blast: 3.6, shake: 0.28 },
  hypersonic: { color: '#ffd60a', cb: '#e69f00', stroke: 0.6, altitude: 0.3, dash: 0.14, blast: 4.4, shake: 0.5 },
  ballistic: { color: '#d56bff', cb: '#cc79a7', stroke: 0.95, altitude: 0.52, dash: 0.34, blast: 6, shake: 0.85 },
  decoy: { color: '#9a9aa8', cb: '#b8b8b8', stroke: 0.2, altitude: 0.09, dash: 0.07, blast: 1.8, shake: 0.05 },
}

export const lookColor = (kind: MissileType, palette: Palette) => (palette === 'colorblind' ? LOOK[kind].cb : LOOK[kind].color)

/** The shield's color and the air force's: two defences that look different even without color (rings against bursts of debris). */
export const DEFENSE_COLOR = { shield: '#64d2ff', air: '#5e9bff' }
export const ALERT_COLOR: Record<Palette, string> = { standard: '#ff453a', colorblind: '#ff9f0a' }

export interface RingPlan {
  lat: number
  lng: number
  color: string
  maxRadius: number
  /** Milliseconds after the report appears, and how long the ring lives. */
  delay: number
  ttl: number
}

export interface FxPlan {
  rings: RingPlan[]
  /** Screen shake strength, 0 for none. */
  shake: number
  /** Whether to fly bomber sprites from the base to the target. */
  sortie: boolean
}

/** The most rings one salvo may draw, and the most fx plans alive at once. A busy day cannot flood the globe. */
export const FX_CAPS = { ringsPerReport: 8, ringsAlive: 36, decals: 24, sprites: 10 }

export interface Pt {
  lat: number
  lng: number
}

const hash = (text: string) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/**
 * The effects of one salvo or raid: a flash at the launch site, bursts where the defences killed missiles (rings and debris, in the
 * shield's color or the air force's), an impact ring scaled by the kind and by how much got through, a shake, and for a raid the sortie.
 * `reduced` keeps one ring and no shake, no debris and no delay.
 */
export function planFx(r: SalvoReport, from: Pt | undefined, to: Pt, opts: { palette?: Palette; mine?: boolean; reduced?: boolean } = {}): FxPlan {
  const palette = opts.palette ?? 'standard'
  const reduced = !!opts.reduced
  const rings: RingPlan[] = []
  const raid = r.weapon === 'raid'
  const color = raid ? '#ffb340' : lookColor(r.kind ?? 'cruise', palette)
  const look = LOOK[r.kind ?? 'cruise']
  const stopped = r.shield + r.batteries + r.fighters + r.patrol
  const hitShare = r.fired > 0 ? Math.max(0, Math.min(1, r.hit / r.fired)) : 0
  const add = (p: Pt, c: string, maxRadius: number, delay: number, ttl: number) => {
    if (rings.length < FX_CAPS.ringsPerReport) rings.push({ lat: p.lat, lng: p.lng, color: c, maxRadius, delay: reduced ? 0 : delay, ttl })
  }
  if (reduced) {
    // One ring, where it matters: the impact, or the defence if nothing got through.
    add(to, r.hit > 0 ? color : DEFENSE_COLOR.shield, r.hit > 0 ? look.blast * (0.6 + 0.4 * hitShare) : 1.6, 0, 1600)
    return { rings, shake: 0, sortie: false }
  }
  // A live game showed the launch when the salvo left, and the flight has already played out: the burst and the impact follow at once.
  const live = r.day !== undefined
  const pace = live ? 0.3 : 1
  if (from && !raid && !live) add(from, color, 1.6, 0, 1100)
  if (stopped > 0.08 && from) {
    // The kill point: three quarters of the way along the flight, where the defence caught it.
    const p = greatCircle(from, to, 0.78)
    const air = r.fighters + r.patrol > r.shield + r.batteries
    const c = air ? DEFENSE_COLOR.air : DEFENSE_COLOR.shield
    add(p, c, 1.2 + 2.2 * Math.min(1, stopped), 520 * pace, 1500)
    // Debris: small bursts scattered round the kill point, one per few missiles stopped, never more than four.
    const bits = Math.min(4, Math.max(1, Math.round(stopped * r.fired * 0.35)))
    for (let i = 0; i < bits; i++) {
      const a = hash(`${r.id}|${i}`) * Math.PI * 2
      const d = 0.5 + hash(`${r.id}|d${i}`) * 1.4
      add({ lat: p.lat + Math.sin(a) * d, lng: p.lng + Math.cos(a) * d }, c, 0.7, (600 + i * 140) * pace, 900)
    }
  }
  if (r.hit > 0) {
    const size = look.blast * (0.55 + 0.45 * hitShare) * (raid ? 0.8 : 1)
    add(to, color, size, 900 * pace, 1700)
    if ((r.kind === 'ballistic' || r.kind === 'hypersonic') && r.hit >= 3) add(to, '#ffffff', size * 1.5, 1050 * pace, 2000)
    if (r.site) add(to, '#ff9f0a', size * 0.6, 1000 * pace, 1500)
  }
  if (raid) for (let i = 0; i < Math.min(3, Math.round(r.aircraftLost * 3) + 1); i++) add({ lat: to.lat + (hash(`${r.id}|p${i}`) - 0.5) * 2.2, lng: to.lng + (hash(`${r.id}|q${i}`) - 0.5) * 2.2 }, '#e5e5ea', 0.8, 1300 + i * 200, 900)
  const shake = opts.mine && r.hit > 0 ? Math.min(1.6, look.shake * (0.5 + hitShare) + Math.min(0.5, r.dead * 0.05)) : 0
  return { rings, shake, sortie: raid }
}

export interface Decal {
  id: string
  lat: number
  lng: number
  /** `scorch` is a dark mark that lasts weeks, `ember` a hot glow that dies in days, `smoke` a pale column that thins in days. */
  kind: 'scorch' | 'ember' | 'smoke'
  radius: number
  altitude: number
  /** 0 to 1, fading with the days since the strike. */
  alpha: number
}

export const DECAL_LIFE = { scorch: 28, ember: 3, smoke: 9 }

/** The day a report happened, absolute. */
export const reportDay = (r: Pick<SalvoReport, 'turn' | 'day'>) => absDay(r.turn, r.day ?? 0)

/**
 * Craters and smoke on the places hit lately, from the salvo reports alone (so they are the same for every player, survive a save and
 * need no state of their own). A mark fades with the days since the strike; the newest `FX_CAPS.decals` are kept.
 */
export function decalsFrom(salvos: readonly SalvoReport[] | undefined, now: number, regions: Record<string, Pt | undefined>): Decal[] {
  const out: Decal[] = []
  for (const r of salvos ?? []) {
    if (r.hit <= 0) continue
    const at = regions[r.region]
    if (!at) continue
    const age = Math.max(0, now - reportDay(r))
    const size = 0.5 + Math.min(1.6, Math.sqrt(r.hit) * 0.16 + r.dead * 0.05 + r.line * 0.04)
    const scorch = 1 - age / DECAL_LIFE.scorch
    const ember = 1 - age / DECAL_LIFE.ember
    const smoke = 1 - age / DECAL_LIFE.smoke
    if (scorch > 0.02) out.push({ id: `${r.id}s`, lat: at.lat, lng: at.lng, kind: 'scorch', radius: size, altitude: 0.012, alpha: Math.min(1, scorch) * 0.85 })
    if (ember > 0.02) out.push({ id: `${r.id}e`, lat: at.lat, lng: at.lng, kind: 'ember', radius: size * 0.55, altitude: 0.015, alpha: Math.min(1, ember) * 0.9 })
    if (smoke > 0.02) out.push({ id: `${r.id}m`, lat: at.lat, lng: at.lng, kind: 'smoke', radius: size * 1.5, altitude: 0.022 + 0.04 * (1 - smoke), alpha: Math.min(1, smoke) * 0.5 })
  }
  return out.sort((a, b) => b.alpha - a.alpha).slice(0, FX_CAPS.decals)
}

export interface RadarRing {
  lat: number
  lng: number
  color: string
  maxRadius: number
  repeat: number
}

/** The early-warning sweep over a capital: slower and wider with each level of radar. Nothing without radar. */
export function radarRing(level: number, at: Pt | undefined, palette: Palette = 'standard'): RadarRing | null {
  if (level < 1 || !at) return null
  return { lat: at.lat, lng: at.lng, color: palette === 'colorblind' ? '#56b4e9' : '#40e0d0', maxRadius: 4 + level * 2.5, repeat: 2600 }
}

export interface Incoming {
  id: string
  from: NationId
  kind: MissileType
  count: number
  launched: number
  lands: number
  target: string
  scrambled: boolean
}

/** Missiles in the air toward `nationId`'s countries (outgoing: pass `by`). */
export function flightsFor(game: Pick<GameState, 'flights' | 'regions'>, nationId: NationId, side: 'incoming' | 'outgoing'): Incoming[] {
  return (game.flights ?? [])
    .filter((f) => (side === 'incoming' ? f.nationId !== nationId && game.regions[f.target]?.owner === nationId : f.nationId === nationId))
    .map((f) => ({ id: f.id, from: f.nationId, kind: f.kind ?? 'hypersonic', count: f.count, launched: f.launched, lands: f.lands, target: f.target, scrambled: !!f.scrambled }))
    .sort((a, b) => a.lands - b.lands || (a.id < b.id ? -1 : 1))
}

export interface Stage {
  /** `launch` on the day it left, `flight` while it is in the air, `impact` on the day it lands. */
  stage: 'launch' | 'flight' | 'impact'
  /** 0 to 1 along the flight. */
  progress: number
  /** Days left, rounded up, at least 0. */
  left: number
}

export function stageOf(f: Pick<Incoming, 'launched' | 'lands'>, now: number): Stage {
  const total = Math.max(1, f.lands - f.launched)
  const progress = Math.max(0, Math.min(1, (now - f.launched) / total))
  return { stage: now >= f.lands ? 'impact' : now <= f.launched ? 'launch' : 'flight', progress, left: Math.max(0, Math.ceil(f.lands - now)) }
}
