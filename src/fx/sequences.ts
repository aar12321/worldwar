import type { MissileType } from '../engine/types'
import { BLAST_KIND, K, PRIO, type FxEngine } from './engine'
import { FLIGHT_STYLES, posAt, xyzToLL } from './flight'
import { TIMING } from './timing'

/**
 * Scripts: what a missile salvo, a launch or a nuclear strike looks like as a timeline of effects. They only add effects to the engine,
 * which owns the budget: if the caps are short, the engine drops the least important and the script clusters its impacts.
 */

export interface Pt {
  lat: number
  lng: number
}

export interface SalvoInput {
  id: string
  kind: MissileType
  raid: boolean
  from?: Pt
  to: Pt
  fired: number
  hit: number
  /** Share of the salvo the defences stopped, 0 to 1, and whether the air force (not the shield) did most of it. */
  stopped: number
  air: boolean
  /** The flight was already shown by the game clock, so only the end of it is played. */
  live: boolean
  /** It touches the player: bigger shake. */
  mine: boolean
  factories: boolean
  dead: number
  colorblind: boolean
}

/** How long each kind takes to cross the screen when a report is played from the start (turn games). */
export const FLIGHT_MS: Record<MissileType, number> = { ballistic: 3600, cruise: 3000, tactical: 1700, hypersonic: 1900, decoy: 2400 }

/** World units (globe radius 100) across of a blast, and its screen shake. */
const BLAST_SIZE: Record<MissileType, number> = { ballistic: 12, hypersonic: 9.5, tactical: 7.5, cruise: 6.2, decoy: 3 }
const SHAKE: Record<MissileType, number> = { ballistic: 0.85, hypersonic: 0.5, tactical: 0.3, cruise: 0.22, decoy: 0.05 }
const LAUNCH_SIZE: Record<string, number> = { ballistic: 7, hypersonic: 5, tactical: 4.5, cruise: 3.6, decoy: 3, nuke: 9, interceptor: 3 }

const KILL = 0.78

export function playLaunch(e: FxEngine, kind: string, at: Pt) {
  const size = LAUNCH_SIZE[kind] ?? 4
  const style = FLIGHT_STYLES[(kind as keyof typeof FLIGHT_STYLES) in FLIGHT_STYLES ? (kind as keyof typeof FLIGHT_STYLES) : 'cruise']
  e.add(K.FLASH, { dur: 1600, prio: PRIO.flash, lat: at.lat, lng: at.lng, b: size, color: e.colorblind ? style.cb : style.color })
  // A ground ring where the missile left.
  e.add(K.RING, { dur: 1200, prio: PRIO.ring, lat: at.lat, lng: at.lng, a: size * 0.45, b: 1.6, color: e.colorblind ? style.cb : style.color })
}

/** The whole life of a salvo from a report: launch, flight, defence, impacts. In live games only its end is played. */
export function playSalvo(e: FxEngine, s: SalvoInput): void {
  if (!e.enabled) return
  const kind = s.kind
  const style = FLIGHT_STYLES[kind]
  const color = e.colorblind ? style.cb : style.color
  const hitShare = s.fired > 0 ? Math.min(1, s.hit / s.fired) : 0
  const stopped = s.stopped > 0.08 && !!s.from
  const total = FLIGHT_MS[kind]
  const t0 = s.live ? 0 : 380
  const flightEnd = s.live ? 520 : t0 + total
  const bodies = Math.max(1, Math.min(s.fired, e.caps.bodiesPerSalvo))
  const stoppedBodies = stopped ? Math.max(1, Math.round(bodies * Math.min(1, s.stopped))) : 0
  const hitBodies = Math.max(0, bodies - stoppedBodies)
  const reduced = e.reduced

  if (reduced) {
    // One ring and one flash where it matters, no motion.
    const size = BLAST_SIZE[kind] * (0.6 + 0.4 * hitShare)
    if (s.hit > 0) {
      e.add(K.BLAST, { dur: 1200, prio: PRIO.blast, lat: s.to.lat, lng: s.to.lng, a: BLAST_KIND[kind] ?? 0, b: size })
      e.add(K.RING, { dur: 1500, prio: PRIO.ring, lat: s.to.lat, lng: s.to.lng, a: size * 0.5, b: 2, color })
    } else e.add(K.RING, { dur: 1500, prio: PRIO.ring, lat: s.to.lat, lng: s.to.lng, a: 2.6, b: 2, color: '#64d2ff' })
    return
  }

  if (!s.live && s.from && !s.raid) playLaunch(e, kind, s.from)

  // Kill point: three quarters of the way along (a terminal stretch in live games).
  const killP = s.live ? 0.9 : KILL
  if (s.from && !s.raid) {
    if (!s.live) {
      if (hitBodies > 0) e.addFlight(kind, s.from, s.to, { delay: t0, dur: total, count: hitBodies, mine: s.mine, id: `${s.id}h` })
      if (stoppedBodies > 0) {
        // A flight that stops short flies at the same speed: its time is the part of the path it covers.
        e.addFlight(kind, s.from, s.to, { delay: t0, dur: total * killP, p0: 0, p1: killP, count: stoppedBodies, mine: s.mine, id: `${s.id}s` })
      }
    }
    if (stopped) {
      // Where the missile is when caught, found from the same path the flight draws.
      const probe = e.probe
      probe.set('probe', kind, s.from.lat, s.from.lng, s.to.lat, s.to.lng)
      const pos = e.scratch
      const alt = posAt(probe, killP, pos, 0)
      xyzToLL(pos[0], pos[1], pos[2], e.llTmp)
      const kl = { lat: e.llTmp.lat, lng: e.llTmp.lng }
      const tKill = t0 + (s.live ? 0 : total * killP)
      const lead = s.live ? 600 : 900
      const count = Math.min(3, Math.max(1, Math.round(stoppedBodies / 3)))
      const dc = s.air ? '#5e9bff' : '#64d2ff'
      for (let i = 0; i < count; i++) {
        e.addFlight('interceptor', s.to, kl, { delay: Math.max(0, tKill - lead + i * 90), dur: lead, count: 1, id: `${s.id}i${i}`, prio: PRIO.flight - 5, link: kl })
      }
      const size = 4.5 + 5 * Math.min(1, s.stopped)
      e.add(K.BURST, { delay: tKill + 20, dur: 1100, prio: PRIO.burst, lat: kl.lat, lng: kl.lng, a: alt, b: size, color: dc })
      // A second, smaller burst for a big salvo: more than one missile died.
      if (stoppedBodies > 2) e.add(K.BURST, { delay: tKill + 160, dur: 900, prio: PRIO.burst - 5, lat: kl.lat + 0.5, lng: kl.lng + 0.6, a: alt, b: size * 0.7, color: dc })
    }
  }

  if (s.hit > 0) {
    const plan = e.impactPlan(Math.ceil(s.hit))
    const base = BLAST_SIZE[kind] * (0.65 + 0.4 * hitShare) * plan.scale * (s.raid ? 0.8 : 1)
    const spread = 0.5 + 0.12 * Math.min(8, s.hit)
    const shake = s.mine ? Math.min(1.6, SHAKE[kind] * (0.5 + hitShare) + Math.min(0.5, s.dead * 0.05)) : 0
    for (let i = 0; i < plan.blasts; i++) {
      const a = (i * 2.399 + (hash(s.id) * 6.28)) % 6.283
      const r = i === 0 ? 0 : spread * Math.sqrt(i / Math.max(1, plan.blasts))
      const at = { lat: s.to.lat + Math.sin(a) * r, lng: s.to.lng + (Math.cos(a) * r) / Math.max(0.3, Math.cos((s.to.lat * Math.PI) / 180)) }
      const delay = flightEnd + i * TIMING.impactStagger + (i % 2) * 40
      // Only the first and the last blast of a salvo shake the screen, so a salvo of twelve is a rolling thunder, not a seizure.
      const sh = i === 0 ? shake : i === plan.blasts - 1 ? shake * 0.6 : 0
      e.add(K.BLAST, { delay, dur: 1700, prio: PRIO.blast - (i > 3 ? 5 : 0), lat: at.lat, lng: at.lng, a: BLAST_KIND[kind] ?? 0, b: base * (0.85 + 0.3 * hash(`${s.id}${i}`)), c: sh })
      if ((kind === 'ballistic' || kind === 'hypersonic') && i === 0) e.add(K.RING, { delay, dur: 1900, prio: PRIO.ring, lat: at.lat, lng: at.lng, a: base * 0.6, b: 2.2, d: 1, color })
      else if (i === 0) e.add(K.RING, { delay, dur: 1500, prio: PRIO.ring, lat: at.lat, lng: at.lng, a: base * 0.35, b: 1.6, color })
    }
    if (s.factories || s.raid) e.add(K.GLOW, { delay: flightEnd + 500, dur: 9000, prio: PRIO.glow, lat: s.to.lat, lng: s.to.lng, b: base * 1.1 })
  }
}

/** The nuclear strike: alert, flash that washes the screen then settles, fireball, rising cloud, shockwave sweeping the globe, ash, glow. */
export function playNuke(e: FxEngine, at: Pt, opts: { mine?: boolean } = {}): void {
  if (!e.enabled) return
  if (e.reduced) {
    // The plain alternative: a clean flash and one ring.
    e.add(K.SCREEN, { dur: 800, prio: PRIO.nuke, a: 1, b: 0.55 })
    e.add(K.RING, { dur: 2200, prio: PRIO.nuke - 1, lat: at.lat, lng: at.lng, a: 22, b: 2.5, color: '#ffffff' })
    return
  }
  const shake = opts.mine ? 1.5 : 0.9
  e.add(K.SCREEN, { dur: TIMING.nukeFlash, prio: PRIO.nuke, a: 0, b: 1, c: shake })
  e.add(K.FIREBALL, { dur: 2200, prio: PRIO.nuke - 1, lat: at.lat, lng: at.lng, b: 26 })
  e.add(K.RING, { delay: 120, dur: TIMING.nukeShock, prio: PRIO.nuke - 2, lat: at.lat, lng: at.lng, a: 80, b: 3.2, d: 2, color: '#ffe9b8' })
  e.add(K.RING, { delay: 700, dur: TIMING.nukeShock * 0.7, prio: PRIO.nuke - 3, lat: at.lat, lng: at.lng, a: 38, b: 2, color: '#ff8a3a' })
  e.add(K.MUSHROOM, { delay: 500, dur: 9500, prio: PRIO.nuke - 4, lat: at.lat, lng: at.lng, b: 34 })
  e.add(K.ASH, { delay: 900, dur: 9000, prio: PRIO.nuke - 5, lat: at.lat, lng: at.lng, b: 70 })
  e.add(K.GLOW, { delay: 1200, dur: 24000, prio: PRIO.glow, lat: at.lat, lng: at.lng, b: 20 })
}

/** A red pulse for a launch that is coming for the player. */
export function playAlert(e: FxEngine, at: Pt) {
  if (!e.enabled || e.reduced) return
  e.add(K.ALERT, { dur: 4200, prio: PRIO.ring + 5, lat: at.lat, lng: at.lng, b: 14, color: e.alertColor })
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}
