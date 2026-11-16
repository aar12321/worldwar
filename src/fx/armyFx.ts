import type { UnitCounts } from '../engine/types'
import type { FxEngine } from './engine'
import { FlightRt } from './flight'
import { SQUAD_ICON, formationOf, mixIcons, squadCount, totalOf, type Squad, type SquadKind } from './formation'
import type { Painter } from './sprites'
import { clamp01, lerp } from './timing'
import { GLOBE_R, newPt, type View } from './view'

/**
 * Armies on the globe as animated formations: squads sized by strength, a banner in the nation's colour, footsteps and dust, facing the
 * way they march. Sea invasions are fleets that load at their port and land on the far shore; air forces are sorties with contrails.
 * It reads the army list and the game clock, never the game.
 */

export interface ArmySpec {
  id: string
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  /** Absolute days of the current leg. */
  start: number
  end: number
  via: 'land' | 'lane' | 'fleet' | 'air'
  color: string
  mine: boolean
  threat: boolean
  fighting: boolean
  returning: boolean
  units: Partial<UnitCounts>
  /** Height of the path above the ground (globe radii), as the badges ride. */
  alt: number
  arc: number
}

class ArmyRt {
  spec: ArmySpec
  key = ''
  squads: Squad[] = []
  icons: SquadKind[] = []
  total = 0
  path = new FlightRt()
  seed = 0
  hx = 1
  hy = 0
  stepAcc = 0
  lat = 0
  lng = 0
  marching = false
  constructor(spec: ArmySpec) {
    this.spec = spec
  }
}

const hash = (text: string) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

const STEP_MS = 560

export class ArmyLayer {
  private armies = new Map<string, ArmyRt>()
  private order: ArmyRt[] = []
  /** Ids drawn as formations in the last frame; the globe hides their plain badges. */
  readonly drawn = new Set<string>()
  private readonly pos = new Float64Array(6)
  private readonly pt = newPt()
  private readonly pt2 = newPt()
  private readonly ll = { lat: 0, lng: 0 }

  get size() {
    return this.armies.size
  }

  sync(specs: readonly ArmySpec[]) {
    const keep = new Set<string>()
    for (const s of specs) {
      keep.add(s.id)
      let a = this.armies.get(s.id)
      if (!a) {
        a = new ArmyRt(s)
        a.seed = hash(s.id)
        a.path.set(s.id, 'cruise', s.from.lat, s.from.lng, s.to.lat, s.to.lng)
        this.armies.set(s.id, a)
      }
      const key = `${s.from.lat},${s.from.lng},${s.to.lat},${s.to.lng},${s.start},${s.end}`
      if (key !== a.key) {
        a.key = key
        a.path.set(s.id, 'cruise', s.from.lat, s.from.lng, s.to.lat, s.to.lng)
      }
      a.spec = s
      const ukey = JSON.stringify(s.units)
      if (ukey !== (a as unknown as { ukey?: string }).ukey) {
        ;(a as unknown as { ukey?: string }).ukey = ukey
        a.total = totalOf(s.units)
        a.squads = formationOf(s.units, 9)
        a.icons = mixIcons(s.units, 3)
      }
    }
    for (const id of [...this.armies.keys()]) if (!keep.has(id)) this.armies.delete(id)
    this.order = [...this.armies.values()].sort((a, b) => (b.spec.mine ? 2 : 0) + (b.spec.threat ? 1 : 0) - ((a.spec.mine ? 2 : 0) + (a.spec.threat ? 1 : 0)) || b.total - a.total || (a.spec.id < b.spec.id ? -1 : 1))
  }

  /** World position of an army at absolute day t. */
  private place(a: ArmyRt, t: number, out: Float64Array, o: number, dp = 0): number {
    const s = a.spec
    const p = clamp01((t - s.start) / Math.max(1e-6, s.end - s.start) + dp)
    const f = a.path
    const w1 = Math.sin((1 - p) * f.omega) / f.sinO
    const w2 = Math.sin(p * f.omega) / f.sinO
    const x = w1 * f.ax + w2 * f.bx
    const y = w1 * f.ay + w2 * f.by
    const z = w1 * f.az + w2 * f.bz
    const alt = s.alt + s.arc * Math.sin(Math.PI * p)
    const l = Math.hypot(x, y, z) || 1
    const r = (GLOBE_R * (1 + alt)) / l
    out[o] = x * r
    out[o + 1] = y * r
    out[o + 2] = z * r
    return p
  }

  /** Footsteps: a puff of dust behind each marching army on the beat. */
  update(e: FxEngine, dtMs: number) {
    if (e.reduced || e.lodLevel === 'far' || this.order.length === 0) return
    let n = 0
    for (const a of this.order) {
      if (n >= Math.min(6, e.caps.armies)) break
      n++
      if (!a.marching) continue
      a.stepAcc += dtMs
      if (a.stepAcc >= STEP_MS) {
        a.stepAcc -= STEP_MS
        const via = a.spec.via
        if (via === 'land') e.dust(a.lat, a.lng, 1, 1.6 + Math.min(1.6, a.total * 0.2), 1.7, '#b9a78a')
        else if (via === 'lane' || via === 'fleet') e.dust(a.lat, a.lng, 1, 1.6, 1.4, '#cfe8f5')
      }
    }
  }

  draw(e: FxEngine, p: Painter, v: View): void {
    this.drawn.clear()
    const cap = e.caps.armies
    if (cap <= 0 || e.reduced || this.order.length === 0 || v.pxPerUnit < 2.4) return
    const now = e.now
    const t = e.clockT
    const pt = this.pt
    const pt2 = this.pt2
    let drawnCount = 0
    for (const a of this.order) {
      if (drawnCount >= cap) break
      const s = a.spec
      if (a.total < 0.05) continue
      const prog = this.place(a, t, this.pos, 0)
      v.projectXYZ(this.pos[0], this.pos[1], this.pos[2], pt)
      if (!pt.vis) continue
      // Heading on screen: toward where it will be a moment later.
      this.place(a, t, this.pos, 3, 0.004)
      v.projectXYZ(this.pos[3], this.pos[4], this.pos[5], pt2)
      const dx = pt2.x - pt.x
      const dy = pt2.y - pt.y
      const dl = Math.hypot(dx, dy)
      if (dl > 0.15) {
        // Smoothed, so a squad does not spin when the camera moves.
        a.hx += (dx / dl - a.hx) * 0.25
        a.hy += (dy / dl - a.hy) * 0.25
        const hl = Math.hypot(a.hx, a.hy) || 1
        a.hx /= hl
        a.hy /= hl
      }
      // Ground position for the dust.
      const r = Math.hypot(this.pos[0], this.pos[1], this.pos[2]) || 1
      this.ll.lat = 90 - (Math.acos(Math.max(-1, Math.min(1, this.pos[1] / r))) * 180) / Math.PI
      this.ll.lng = 90 - (Math.atan2(this.pos[2], this.pos[0]) * 180) / Math.PI
      a.lat = this.ll.lat
      a.lng = this.ll.lng
      const moving = t >= s.start && prog < 1 && !s.fighting
      a.marching = moving
      this.drawn.add(s.id)
      drawnCount++
      const sq = Math.max(10, Math.min(30, v.pxPerUnit * 3.1))
      const alpha = s.returning ? 0.72 : 1
      const ang = Math.atan2(a.hy, a.hx)
      const bob = moving ? now / 170 + a.seed * 20 : 0
      if (s.via === 'air') this.drawAir(e, p, a, pt.x, pt.y, sq, ang, alpha, now)
      else if (s.via === 'lane' || s.via === 'fleet') this.drawFleet(e, p, a, pt.x, pt.y, sq, ang, alpha, prog, now)
      else this.drawLand(e, p, a, pt.x, pt.y, sq, ang, alpha, bob, now, s.fighting)
      this.drawBanner(p, a, pt.x, pt.y, sq, alpha, now)
    }
  }

  private drawLand(e: FxEngine, p: Painter, a: ArmyRt, x: number, y: number, sq: number, ang: number, alpha: number, bob: number, now: number, fighting: boolean) {
    const s = a.spec
    const spacing = sq * 0.98
    const ux = a.hx
    const uy = a.hy
    const ax = -uy
    const ay = ux
    const n = a.squads.length
    for (let i = 0; i < n; i++) {
      const q = a.squads[i]
      // y runs front (negative) to back (positive); the front leads along the heading.
      const along = -q.y * spacing * 1.05
      const across = q.x * spacing
      let sx = x + ux * along + ax * across
      let sy = y + uy * along + ay * across
      const step = Math.sin(bob + i * 1.3)
      if (a.marching) {
        sx += ux * step * 0.8
        sy += uy * step * 0.8 - Math.abs(step) * 1.1
      } else if (fighting) {
        sx += Math.sin(now / 55 + i * 2.1) * 0.9
        sy += Math.cos(now / 61 + i * 1.7) * 0.9
      }
      // A disc in the nation's colour under the squad, so every force reads whose it is.
      p.glow(sx, sy, sq * 1.45, 0.7 * alpha, '#0a0c12', false)
      p.glow(sx, sy, sq * 1.05, 0.8 * alpha, s.color, false)
      if (q.kind === 'infantry' || q.kind === 'drone') {
        const f = a.marching ? Math.floor(now / 125 + i * 3) : 0
        p.sprite('army.march', f, sx, sy, sq * 1.05, ang + Math.PI / 2, alpha, null, false)
      } else {
        // Tanks, guns, aircraft and the rest: the unit's own icon (its outline shape is the cue for colour-blind readers).
        p.sprite(SQUAD_ICON[q.kind], 0, sx, sy, sq * 1.0, a.marching && q.kind !== 'air' ? ang + Math.PI / 2 : 0, alpha, '#ffffff', false)
        if (fighting && q.kind === 'armor') {
          // Recoil: the barrel's flash and a small kick back.
          const k = Math.floor(now / 140 + i) % 3
          if (k === 0) p.sprite('army.muzzle', Math.floor((now / 33) % 4), sx + ux * sq * 0.5, sy + uy * sq * 0.5, sq * 1.2, 0, 0.95, null, true)
        }
      }
      if (fighting && i % 2 === 0 && !e.reduced) {
        const k = Math.floor(now / 90 + i * 7 + a.seed * 50)
        if (k % 3 !== 0) p.sprite('army.muzzle', k % 6, sx + ux * sq * 0.6, sy + uy * sq * 0.6, sq * 0.9, 0, 0.9, null, true)
        if (k % 4 === 0) p.sprite('army.sparks', k % 5, sx + ux * sq, sy + uy * sq, sq * 1.2, 0, 0.9, null, true)
      }
    }
    // The dust the march kicks up trails behind the rear squads.
    if (a.marching) {
      for (let k = 0; k < 3; k++) {
        const ph = ((now / 700 + k / 3 + a.seed) % 1)
        const behind = sq * (1.2 + 2.2 * ph) + (n > 4 ? sq * 0.8 : 0)
        p.sprite('army.dust', Math.min(7, Math.floor(ph * 8)), x - ux * behind + ax * (k - 1) * sq * 0.5, y - uy * behind + ay * (k - 1) * sq * 0.5, sq * (1.2 + ph), 0, (1 - ph) * 0.7 * alpha, '#c8b896', false)
      }
    }
    if (s.threat) p.sprite('ui.ring.dashed', 0, x, y, sq * (3 + n * 0.15), now / 1500, 0.7 + 0.3 * Math.sin(now / 200), '#ff453a', true)
    this.drawIcons(p, a, x, y - sq * 0.4 - (n > 3 ? sq * 0.5 : 0), sq, alpha)
  }

  private drawIcons(p: Painter, a: ArmyRt, x: number, y: number, sq: number, alpha: number) {
    const n = a.icons.length
    if (n === 0 || sq < 9) return
    for (let i = 0; i < n; i++) p.sprite(SQUAD_ICON[a.icons[i]], 0, x + (i - (n - 1) / 2) * sq * 0.7, y - sq * 1.55, sq * 0.7, 0, 0.9 * alpha, '#ffffff', false)
  }

  private drawFleet(e: FxEngine, p: Painter, a: ArmyRt, x: number, y: number, sq: number, ang: number, alpha: number, prog: number, now: number) {
    const s = a.spec
    const ships = Math.max(1, Math.min(4, Math.round(Math.sqrt(a.total) * 1.1)))
    const ux = a.hx
    const uy = a.hy
    const ax = -uy
    const ay = ux
    const sz = sq * 1.7
    // Loading at the port in the first stretch, landing on the shore in the last.
    const load = clamp01(prog / 0.1)
    const land = clamp01((prog - 0.9) / 0.1)
    const sway = Math.sin(now / 600 + a.seed * 6) * 0.8
    for (let i = 0; i < ships; i++) {
      const across = (i - (ships - 1) / 2) * sz * 0.7
      const lag = (i % 2) * sz * 0.5
      const sx = x - ux * lag + ax * across + ay * sway * 0.3
      const sy = y - uy * lag + ay * across - ax * sway * 0.3
      // Wake: foam trailing behind, longer when moving.
      if (a.marching) p.strip('trail.wake', sx - ux * sz * 0.4, sy - uy * sz * 0.4, sx - ux * sz * 1.9, sy - uy * sz * 1.9, sz * 0.5, 0.6 * alpha * load, now / 500, '#ffffff', true)
      p.glow(sx, sy, sz * 1.3, 0.45 * alpha, '#0a0c12', false)
      p.sprite(i === 0 && ships > 1 ? 'sil.destroyer' : 'sil.patrolBoat', 0, sx, sy, sz, ang + Math.PI / 2, alpha * (0.55 + 0.45 * load) * (1 - 0.55 * land), s.color, false)
    }
    if (prog < 0.1 && !e.reduced) {
      // Embarking: squads stream from the shore into the ships.
      for (let i = 0; i < Math.min(5, a.squads.length); i++) {
        const k = clamp01(load * 1.4 - i * 0.12)
        const fx = lerp(x - ux * sz * 1.8 + ax * (i - 2) * sq * 0.4, x, k)
        const fy = lerp(y - uy * sz * 1.8 + ay * (i - 2) * sq * 0.4, y, k)
        p.sprite('army.march', Math.floor(now / 125 + i * 3), fx, fy, sq * 0.8, ang + Math.PI / 2, alpha * (1 - clamp01((k - 0.8) / 0.2)), null, false)
      }
    }
    if (prog > 0.9) {
      // Landing craft run for the beach and the squads wade ashore, throwing up spray.
      const run = EASE_OUT(land)
      for (let i = 0; i < Math.min(6, Math.max(2, a.squads.length)); i++) {
        const across = (i - 2.5) * sq * 0.75
        const bx = x + ux * run * sz * 2.2 + ax * across
        const by = y + uy * run * sz * 2.2 + ay * across
        p.sprite('sil.patrolBoat', 0, bx, by, sq * 0.9, ang + Math.PI / 2, alpha * (1 - clamp01((land - 0.6) / 0.4)), s.color, false)
        if (land > 0.55) p.sprite('army.march', Math.floor(now / 125 + i * 3), bx + ux * sq * 0.9 * (land - 0.5) * 2, by + uy * sq * 0.9 * (land - 0.5) * 2, sq * 0.85, ang + Math.PI / 2, alpha * clamp01((land - 0.55) / 0.3), null, false)
        p.sprite('army.dust', Math.min(7, Math.floor(land * 7)), bx + ux * sq, by + uy * sq, sq * 1.4, 0, (1 - land) * 0.6, '#e6f4ff', false)
      }
    }
    if (s.threat) p.sprite('ui.ring.dashed', 0, x, y, sq * 4, now / 1500, 0.7 + 0.3 * Math.sin(now / 200), '#ff453a', true)
    this.drawIcons(p, a, x, y - sq * 0.4, sq, alpha)
  }

  private drawAir(e: FxEngine, p: Painter, a: ArmyRt, x: number, y: number, sq: number, ang: number, alpha: number, now: number) {
    const s = a.spec
    const n = Math.max(1, Math.min(5, Math.round(Math.sqrt(a.total) * 1.1)))
    const ux = a.hx
    const uy = a.hy
    const ax = -uy
    const ay = ux
    const bombers = (a.spec.units.air ?? 0) >= (a.spec.units.fighter ?? 0)
    const sz = sq * 1.7
    for (let i = 0; i < n; i++) {
      // A V: the leader in front, the rest stepped back to each side.
      const rank = Math.ceil(i / 2)
      const side = i === 0 ? 0 : i % 2 === 1 ? -1 : 1
      const sx = x - ux * rank * sz * 0.7 + ax * side * rank * sz * 0.65
      const sy = y - uy * rank * sz * 0.7 + ay * side * rank * sz * 0.65
      if (!e.reduced) p.strip('trail.contrail', sx - ux * sz * 0.5, sy - uy * sz * 0.5, sx - ux * sz * 3.2, sy - uy * sz * 3.2, sz * 0.28, 0.5 * alpha, now / 900, '#ffffff', true)
      p.glow(sx, sy, sz * 1.5, 0.55 * alpha, '#0a0c12', false)
      p.sprite(bombers ? 'sil.bomber' : 'sil.fighter', 0, sx, sy, sz, ang + Math.PI / 2, alpha, s.color, false)
    }
    this.drawIcons(p, a, x, y - sq * 0.8, sq, alpha)
  }

  /** The banner on its pole above the formation: nation colour, a waving edge, and an emblem whose shape says friend or foe. */
  private drawBanner(p: Painter, a: ArmyRt, x: number, y: number, sq: number, alpha: number, now: number) {
    const s = a.spec
    if (sq < 8) return
    const ctx = p.ctx
    const bx = x
    const top = y - sq * (a.squads.length > 3 ? 1.9 : 1.4)
    const poleH = sq * 1.1
    const w = sq * 1.1
    const h = sq * 0.62
    const wave = a.marching ? Math.sin(now / 160 + a.seed * 9) * 1.6 : Math.sin(now / 420 + a.seed * 9) * 0.8
    p.setMode(false)
    p.setAlpha(alpha)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(10,12,18,0.85)'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(bx, top)
    ctx.lineTo(bx, top - poleH)
    ctx.stroke()
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.moveTo(bx, top - poleH)
    ctx.quadraticCurveTo(bx + w * 0.5, top - poleH - wave, bx + w, top - poleH + wave * 0.5)
    ctx.lineTo(bx + w * 0.9, top - poleH + h * 0.5 + wave * 0.4)
    ctx.lineTo(bx + w, top - poleH + h + wave * 0.3)
    ctx.quadraticCurveTo(bx + w * 0.5, top - poleH + h - wave, bx, top - poleH + h)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // Emblem: a diamond for yours, a square for others, a triangle for a force marching on you.
    const ex = bx + w * 0.42
    const ey = top - poleH + h * 0.5
    const r = h * 0.28
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    if (s.threat) {
      ctx.moveTo(ex, ey - r)
      ctx.lineTo(ex + r, ey + r * 0.8)
      ctx.lineTo(ex - r, ey + r * 0.8)
    } else if (s.mine) {
      ctx.moveTo(ex, ey - r)
      ctx.lineTo(ex + r, ey)
      ctx.lineTo(ex, ey + r)
      ctx.lineTo(ex - r, ey)
    } else ctx.rect(ex - r * 0.8, ey - r * 0.8, r * 1.6, r * 1.6)
    ctx.closePath()
    ctx.fill()
  }
}

const EASE_OUT = (t: number) => 1 - (1 - t) * (1 - t)

export { squadCount }
