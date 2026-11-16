import type { UnitCounts } from '../engine/types'
import { SQUAD_ICON, formationOf, totalOf, type Squad } from './formation'
import { Painter } from './sprites'
import { EASE, TIMING, clamp01, damp, lerp } from './timing'

/**
 * The battle scene as a small stage on a canvas: two formations face each other, and each round of the report plays as muzzle flashes,
 * tracers, artillery arcs, aircraft strafing runs and tank recoil, while squads fall as the losses tick up. A momentum bar swings with the
 * damage dealt, and the end is a flag raised over the winner (and a collapse for the loser). It reads the battle report only; everything
 * it draws comes from preallocated pools, so a long battle allocates nothing per frame.
 */

export interface StageSide {
  units: Partial<UnitCounts>
  color: string
  name: string
}

export interface StageRound {
  /** Damage dealt by the attacker and by the defender this round, and what each side lost (divisions). */
  attDamage: number
  defDamage: number
  attLoss: number
  defLoss: number
}

export interface StageInit {
  att: StageSide
  def: StageSide
  rounds: StageRound[]
  attackerWon: boolean
  captured: boolean
}

interface Body {
  squad: Squad
  /** Homes on the stage, in px relative to the side's centre. */
  hx: number
  hy: number
  alive: boolean
  deadAt: number
  recoil: number
  seed: number
}

interface Particle {
  live: boolean
  kind: 0 | 1 | 2 | 3 | 4 | 5
  x: number
  y: number
  vx: number
  vy: number
  x1: number
  y1: number
  age: number
  life: number
  size: number
  color: string
  frame: number
  text: string
}

const POOL = 160
const MAX_SQUADS = 10

export class BattleStage {
  readonly init: StageInit
  w = 600
  h = 200
  /** How many rounds have started (0 before the first); rounds + 1 means the verdict. */
  visible = 0
  /** Milliseconds since the latest round began, and the total playing time. */
  roundT = 0
  time = 0
  speed = 1
  private bodies: [Body[], Body[]] = [[], []]
  private lossShown = [0, 0]
  private lossTarget = [0, 0]
  private startUnits = [1, 1]
  momentum = 0.5
  private momentumTarget = 0.5
  private pool: Particle[] = []
  private cursor = 0
  private fireAcc = [0, 0]
  private shellAcc = [0, 0]
  private seedState = 12345
  shake = 0
  /** The flag over the winner, 0 to 1. */
  flag = 0
  private jumped = false
  /** Rounds whose popups have been shown. */
  private popped = 0
  private strafed = -1

  constructor(init: StageInit) {
    this.init = init
    for (let i = 0; i < POOL; i++) this.pool.push({ live: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, x1: 0, y1: 0, age: 0, life: 1, size: 1, color: '#fff', frame: 0, text: '' })
    this.startUnits = [Math.max(0.1, totalOf(init.att.units)), Math.max(0.1, totalOf(init.def.units))]
    this.layout(600, 200)
  }

  private rand() {
    let x = this.seedState
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.seedState = x >>> 0
    return this.seedState / 4294967296
  }

  get rounds() {
    return this.init.rounds.length
  }

  get done() {
    return this.visible > this.rounds
  }

  /** Size of a squad in px for this stage height. */
  get sq() {
    return Math.max(18, Math.min(40, this.h / 5.2))
  }

  layout(w: number, h: number) {
    this.w = w
    this.h = h
    const sq = this.sq
    const sides: StageSide[] = [this.init.att, this.init.def]
    for (let s = 0; s < 2; s++) {
      const squads = formationOf(sides[s].units, MAX_SQUADS)
      const dir = s === 0 ? 1 : -1
      const old = this.bodies[s]
      this.bodies[s] = squads.map((q, i) => ({
        squad: q,
        // Depth runs from the front (toward the enemy) to the rear; across spreads vertically.
        hx: dir * -q.y * sq * 1.15,
        hy: q.x * sq * 1.05,
        alive: old[i] ? old[i].alive : true,
        deadAt: old[i] ? old[i].deadAt : 0,
        recoil: 0,
        seed: i * 0.37 + s,
      }))
    }
  }

  private centre(s: number) {
    return { x: this.w * (s === 0 ? 0.27 : 0.73), y: this.h * 0.62 }
  }

  private spawn(kind: Particle['kind'], x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, frame = 0, text = ''): Particle {
    // Ring: the oldest slot is reused when the pool is full.
    const p = this.pool[this.cursor]
    this.cursor = (this.cursor + 1) % POOL
    p.live = true
    p.kind = kind
    p.x = x
    p.y = y
    p.x1 = x
    p.y1 = y
    p.vx = vx
    p.vy = vy
    p.age = 0
    p.life = life
    p.size = size
    p.color = color
    p.frame = frame
    p.text = text
    return p
  }

  /** Shows rounds up to `n` (the number that have started). Jumping more than one round skips straight to their totals. */
  setVisible(n: number) {
    if (n === this.visible) return
    const jump = n - this.visible > 1
    this.visible = n
    this.roundT = 0
    this.recomputeTargets()
    if (jump) {
      this.jumped = true
      this.lossShown[0] = this.lossTarget[0]
      this.lossShown[1] = this.lossTarget[1]
      this.applyCasualties(true)
      this.momentum = this.momentumTarget
      this.popped = Math.min(n, this.rounds)
    }
    if (this.done) this.flag = this.jumped ? 1 : 0
  }

  private recomputeTargets() {
    let a = 0
    let d = 0
    let ad = 0
    let dd = 0
    const upto = Math.min(this.visible, this.rounds)
    for (let i = 0; i < upto; i++) {
      const r = this.init.rounds[i]
      a += r.attLoss
      d += r.defLoss
      ad += r.attDamage
      dd += r.defDamage
    }
    this.lossTarget[0] = a
    this.lossTarget[1] = d
    this.momentumTarget = ad + dd > 0 ? clamp01(0.5 + 0.5 * ((ad - dd) / (ad + dd))) : 0.5
    // The latest round tilts the bar the most, so it swings visibly each round.
    if (upto > 0) {
      const r = this.init.rounds[upto - 1]
      const tot = r.attDamage + r.defDamage
      if (tot > 0) this.momentumTarget = clamp01(0.5 * this.momentumTarget + 0.5 * (0.5 + 0.5 * ((r.attDamage - r.defDamage) / tot)))
    }
  }

  /** Squads still standing for the casualties shown so far: losses fall on the front rows first. */
  private applyCasualties(instant: boolean) {
    for (let s = 0; s < 2; s++) {
      const bodies = this.bodies[s]
      const frac = clamp01(this.lossShown[s] / this.startUnits[s])
      const standing = Math.max(this.done && s === (this.init.attackerWon ? 0 : 1) ? 1 : 0, Math.ceil(bodies.length * (1 - frac) - 1e-6))
      // Front-most first: sort index by how far forward they are.
      const order = bodies.map((_, i) => i).sort((i, j) => bodies[i].squad.y - bodies[j].squad.y)
      const kill = bodies.length - standing
      for (let k = 0; k < order.length; k++) {
        const b = bodies[order[k]]
        const dead = k < kill
        if (dead && b.alive) {
          b.alive = false
          b.deadAt = instant ? -1e9 : this.time
          if (!instant) {
            const c = this.centre(s)
            this.spawn(1, c.x + b.hx, c.y + b.hy, (this.rand() - 0.5) * 12, -18, 900, this.sq * 1.1, '#9a928a')
            this.spawn(0, c.x + b.hx, c.y + b.hy, (this.rand() - 0.5) * 60, -40 - this.rand() * 30, 380, 5, '#ffcf70')
          }
        }
      }
    }
  }

  private alive(s: number): Body[] {
    return this.bodies[s].filter((b) => b.alive)
  }

  update(dtMs: number) {
    const dt = Math.min(dtMs, 80) * this.speed
    this.time += dt
    this.roundT += dt
    const inRound = this.visible >= 1 && this.visible <= this.rounds
    if (inRound) {
      const i = this.visible - 1
      const r = this.init.rounds[i]
      const roundMs = TIMING.round
      const phase = clamp01(this.roundT / roundMs)
      const power = Math.min(1, (r.attDamage + r.defDamage) / 8)
      if (this.popped < this.visible) {
        this.popped = this.visible
        // Casualty numbers float up over each side as the round opens.
        for (let s = 0; s < 2; s++) {
          const loss = s === 0 ? r.attLoss : r.defLoss
          if (loss >= 0.05) {
            const c = this.centre(s)
            this.spawn(3, c.x, c.y - this.h * 0.38, 0, -26, 1300, 15, s === 0 ? this.init.att.color : this.init.def.color, 0, `-${loss.toFixed(1)}`)
          }
        }
      }
      if (this.strafed < i && phase > 0.05) {
        this.strafed = i
        this.strafeRun(i)
      }
      // Fire: tracers both ways, scaled by what each side can do, over the middle of the round.
      const active = phase > 0.04 && phase < 0.88
      for (let s = 0; s < 2; s++) {
        if (!active) continue
        const dmg = s === 0 ? r.attDamage : r.defDamage
        const rate = 14 + 70 * Math.min(1, dmg / 5) + 30 * power
        this.fireAcc[s] += (dt / 1000) * rate
        while (this.fireAcc[s] >= 1) {
          this.fireAcc[s] -= 1
          this.tracer(s)
        }
        const guns = this.bodies[s].filter((b) => b.alive && b.squad.kind === 'artillery').length
        if (guns > 0) {
          this.shellAcc[s] += (dt / 1000) * (1.6 + guns * 0.9)
          while (this.shellAcc[s] >= 1) {
            this.shellAcc[s] -= 1
            this.shell(s)
          }
        }
      }
      this.shake = Math.max(this.shake, 0)
    }
    // Numbers tick toward their targets; squads fall as they cross each squad's share.
    const before0 = this.lossShown[0]
    const before1 = this.lossShown[1]
    this.lossShown[0] = damp(this.lossShown[0], this.lossTarget[0], 3.2, dt / this.speed)
    this.lossShown[1] = damp(this.lossShown[1], this.lossTarget[1], 3.2, dt / this.speed)
    if (Math.abs(this.lossTarget[0] - this.lossShown[0]) < 0.01) this.lossShown[0] = this.lossTarget[0]
    if (Math.abs(this.lossTarget[1] - this.lossShown[1]) < 0.01) this.lossShown[1] = this.lossTarget[1]
    if (before0 !== this.lossShown[0] || before1 !== this.lossShown[1]) this.applyCasualties(false)
    this.momentum = damp(this.momentum, this.momentumTarget, 4, dt / this.speed)
    this.shake = damp(this.shake, 0, 7, dt / this.speed)
    for (const b of this.bodies[0]) b.recoil = damp(b.recoil, 0, 9, dt / this.speed)
    for (const b of this.bodies[1]) b.recoil = damp(b.recoil, 0, 9, dt / this.speed)
    if (this.done) {
      this.flag = Math.min(1, this.flag + dt / 1400)
      // Celebration: a few sparks and ribbons drift above the winner, once the flag is up.
      if (this.flag > 0.6 && this.rand() < 0.35 * Math.min(1, dt / 16)) {
        const s = this.init.attackerWon ? 0 : 1
        const c = this.centre(s)
        this.spawn(2, c.x + (this.rand() - 0.5) * this.w * 0.2, c.y - this.h * 0.5, (this.rand() - 0.5) * 40, 30 + this.rand() * 30, 1700, 4, this.rand() < 0.5 ? this.init[s === 0 ? 'att' : 'def'].color : '#ffd60a', 0)
      }
    }
    for (const p of this.pool) {
      if (!p.live) continue
      p.age += dt
      if (p.age >= p.life) {
        p.live = false
        continue
      }
      if (p.kind === 4) continue
      p.x += (p.vx * dt) / 1000
      p.y += (p.vy * dt) / 1000
      if (p.kind === 2) p.vy += (60 * dt) / 1000
    }
  }

  private pick(s: number, prefer?: Squad['kind']): Body | null {
    const al = this.bodies[s]
    let n = 0
    for (const b of al) if (b.alive && (!prefer || b.squad.kind === prefer)) n++
    if (n === 0) return prefer ? this.pick(s) : null
    let k = Math.floor(this.rand() * n)
    for (const b of al) if (b.alive && (!prefer || b.squad.kind === prefer) && k-- === 0) return b
    return null
  }

  private tracer(s: number) {
    const from = this.pick(s)
    const to = this.pick(1 - s)
    if (!from || !to) return
    const cf = this.centre(s)
    const ct = this.centre(1 - s)
    const x0 = cf.x + from.hx + (s === 0 ? 8 : -8)
    const y0 = cf.y + from.hy
    const x1 = ct.x + to.hx + (this.rand() - 0.5) * 10
    const y1 = ct.y + to.hy + (this.rand() - 0.5) * 10
    const t = this.spawn(4, x0, y0, 0, 0, 170 + this.rand() * 90, 1, s === 0 ? '#ffe8a0' : '#ffb8a0', Math.floor(this.rand() * 6))
    t.x1 = x1
    t.y1 = y1
    from.recoil = from.squad.kind === 'armor' ? 1 : 0.35
    // The muzzle flash at the barrel.
    this.spawn(5, x0, y0, 0, 0, 110, this.sq * 0.9, '#fff', Math.floor(this.rand() * 8))
  }

  private shell(s: number) {
    const from = this.pick(s, 'artillery')
    const to = this.pick(1 - s)
    if (!from || !to) return
    const cf = this.centre(s)
    const ct = this.centre(1 - s)
    // A lobbed arc: carried as two points; the draw interpolates and lifts it.
    const t = this.spawn(4, cf.x + from.hx, cf.y + from.hy, 1, 0, 620, 2, '#ffd9a0', 0)
    t.x1 = ct.x + to.hx + (this.rand() - 0.5) * 24
    t.y1 = ct.y + to.hy + (this.rand() - 0.5) * 24
    from.recoil = 1
    this.shake = Math.min(1, this.shake + 0.25)
  }

  /** An aircraft run: one silhouette crosses from the stronger air arm's side, strafing the other line. */
  private strafeRun(round: number) {
    const air = (u: Partial<UnitCounts>) => (u.air ?? 0) + (u.fighter ?? 0)
    const s = air(this.init.att.units) >= air(this.init.def.units) ? 0 : 1
    if (air(s === 0 ? this.init.att.units : this.init.def.units) < 0.05) return
    const c = this.centre(s)
    const e = this.centre(1 - s)
    const y = this.h * (0.18 + 0.06 * (round % 3))
    const t = this.spawn(4, c.x - (s === 0 ? 40 : -40), y, 2, 0, 1000, 1, s === 0 ? this.init.att.color : this.init.def.color, 0)
    t.x1 = e.x + (s === 0 ? 70 : -70)
    t.y1 = y
  }

  // ---- drawing -----------------------------------------------------------------------------------------------

  draw(p: Painter) {
    const ctx = p.ctx
    const w = this.w
    const h = this.h
    const shx = (this.rand() - 0.5) * 5 * this.shake
    const shy = (this.rand() - 0.5) * 5 * this.shake
    p.setMode(false)
    p.setAlpha(1)
    ctx.clearRect(0, 0, w, h)
    // Ground and sky.
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#10151d')
    g.addColorStop(0.55, '#1b2230')
    g.addColorStop(0.56, '#262d24')
    g.addColorStop(1, '#171b16')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    p.sprite('ui.hexscan', 0, w / 2, h / 2, Math.max(w, h) * 1.1, 0, 0.1, null, true)
    ctx.save()
    ctx.translate(shx, shy)
    // Squads, back to front.
    for (let s = 0; s < 2; s++) this.drawSide(p, s)
    // Projectiles and effects.
    for (const q of this.pool) if (q.live) this.drawParticle(p, q)
    ctx.restore()
    this.drawBars(p)
    this.drawFlag(p)
  }

  private drawSide(p: Painter, s: number) {
    const side = s === 0 ? this.init.att : this.init.def
    const dir = s === 0 ? 1 : -1
    const c = this.centre(s)
    const sq = this.sq
    const done = this.done
    const winner = this.init.attackerWon ? 0 : 1
    for (const b of this.bodies[s]) {
      const since = this.time - b.deadAt
      if (!b.alive && since > 900) continue
      const fall = b.alive ? 0 : clamp01(since / 700)
      const bob = b.alive ? Math.sin(this.time / 380 + b.seed * 5) * 0.8 : 0
      const x = c.x + b.hx - dir * b.recoil * 5
      const y = c.y + b.hy + bob + fall * 8
      const alpha = (1 - fall) * (done && s !== winner ? 0.75 : 1)
      p.glow(x, y, sq * 1.5, 0.7 * alpha, '#0a0c12', false)
      p.glow(x, y, sq * 1.05, 0.8 * alpha, side.color, false)
      const rot = b.alive ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.PI * 0.9 * fall
      if (b.squad.kind === 'infantry' || b.squad.kind === 'drone') p.sprite('army.march', b.alive && this.roundT < TIMING.round ? Math.floor(this.time / 140 + b.seed * 9) : 0, x, y, sq * 1.05, rot, alpha, null, false)
      else p.sprite(SQUAD_ICON[b.squad.kind], 0, x, y, sq, 0, alpha, '#ffffff', false)
    }
  }

  private drawParticle(p: Painter, q: Particle) {
    const ctx = p.ctx
    const t = q.age / q.life
    switch (q.kind) {
      case 0:
        p.sprite('army.sparks', Math.min(7, Math.floor(t * 8)), q.x, q.y, q.size * 5, 0, 1 - t, null, true)
        break
      case 1:
        p.sprite('particle.smoke', 1, q.x, q.y, q.size * (1 + t), 0, 0.5 * (1 - t), '#a39a92', false)
        break
      case 2:
        p.setMode(false)
        p.setAlpha(1 - t * 0.6)
        ctx.fillStyle = q.color
        ctx.fillRect(q.x, q.y, q.size, q.size * 0.6)
        break
      case 3: {
        p.setMode(false)
        p.setAlpha(Math.min(1, (1 - t) * 2))
        ctx.font = `700 ${q.size}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(10,12,18,0.9)'
        ctx.strokeText(q.text, q.x, q.y)
        ctx.fillStyle = '#ff8a84'
        ctx.fillText(q.text, q.x, q.y)
        break
      }
      case 4: {
        // Tracers fly straight; shells (vx = 1) lob in an arc; aircraft (vx = 2) cross high.
        const e = q.vx === 1 ? EASE.inQuad(t * 0.5 + 0.5 * t) : t
        const sx = q.vx === 2 ? lerp(q.x, q.x1, t) : q.vx === 1 ? lerp(q.x, q.x1, t) : lerp(q.x, q.x1, e)
        const sy = q.vx === 1 ? lerp(q.y, q.y1, t) - Math.sin(Math.PI * t) * this.h * 0.45 : lerp(q.y, q.y1, e)
        if (q.vx === 2) {
          const dir = q.x1 > q.x ? 1 : -1
          p.sprite('sil.fighter', 0, sx, sy, this.sq * 1.25, (dir * Math.PI) / 2, Math.min(1, (1 - t) * 3), q.color, false)
          p.strip('trail.contrail', sx - dir * this.sq * 2.6, sy, sx - dir * this.sq * 0.5, sy, this.sq * 0.5, 0.6 * (1 - t), this.time / 600, '#ffffff', true)
          // Strafing: bright dashes falling from the aircraft onto the line below.
          if (t > 0.15 && t < 0.85) {
            p.setMode(true)
            p.setAlpha(0.9)
            ctx.strokeStyle = '#ffe8a0'
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(sx, sy + 6)
            ctx.lineTo(sx + dir * 10 + (this.rand() - 0.5) * 8, this.h * 0.62 + (this.rand() - 0.5) * 30)
            ctx.stroke()
            if (this.rand() < 0.3) p.sprite('army.sparks', Math.floor(this.rand() * 4), sx + dir * 12, this.h * 0.62 + (this.rand() - 0.5) * 30, this.sq * 1.2, 0, 0.9, null, true)
          }
          break
        }
        p.setMode(true)
        if (q.vx === 1) {
          p.sprite('glow.fire', 0, sx, sy, 9, 0, 1, '#ffd9a0', true)
          // Landing: a blast where the shell falls.
          if (t > 0.94) p.sprite('blast.conventional', Math.floor((t - 0.94) * 80), q.x1, q.y1, this.sq * 2.2, 0, 1, null, true)
        } else {
          p.setAlpha(1 - t * 0.5)
          ctx.strokeStyle = q.color
          ctx.lineWidth = 1.7
          ctx.beginPath()
          const lag = Math.max(0, e - 0.22)
          ctx.moveTo(lerp(q.x, q.x1, lag), lerp(q.y, q.y1, lag))
          ctx.lineTo(sx, sy)
          ctx.stroke()
          if (t > 0.9) p.sprite('army.sparks', Math.floor((t - 0.9) * 60), q.x1, q.y1, this.sq * 1.1, 0, 1, null, true)
        }
        break
      }
      case 5:
        p.sprite('army.muzzle', Math.min(7, Math.floor(t * 8)), q.x, q.y, q.size, 0, 1 - t * 0.5, null, true)
        break
    }
  }

  /** The momentum bar along the top: the attacker's colour from the left, the defender's from the right, a marker where they meet. */
  private drawBars(p: Painter) {
    const ctx = p.ctx
    const w = this.w
    const bx = 14
    const by = 12
    const bw = w - 28
    p.setMode(false)
    p.setAlpha(1)
    ctx.fillStyle = 'rgba(10,12,18,0.7)'
    ctx.fillRect(bx - 2, by - 2, bw + 4, 12)
    ctx.fillStyle = this.init.att.color
    ctx.fillRect(bx, by, bw * this.momentum, 8)
    ctx.fillStyle = this.init.def.color
    ctx.fillRect(bx + bw * this.momentum, by, bw * (1 - this.momentum), 8)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(bx + bw * this.momentum - 1.5, by - 3, 3, 14)
    ctx.font = '600 10px Inter, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fillText('MOMENTUM', bx, by + 22)
  }

  private drawFlag(p: Painter) {
    if (!this.done) return
    const ctx = p.ctx
    const s = this.init.attackerWon ? 0 : 1
    const side = s === 0 ? this.init.att : this.init.def
    const c = this.centre(s)
    const k = EASE.outCubic(this.flag)
    const px = c.x
    const base = this.h * 0.86
    const top = lerp(base, this.h * 0.25, k)
    p.setMode(false)
    p.setAlpha(1)
    ctx.strokeStyle = '#dfe4ea'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(px, base)
    ctx.lineTo(px, this.h * 0.2)
    ctx.stroke()
    const wave = Math.sin(this.time / 160) * 3
    ctx.fillStyle = side.color
    ctx.strokeStyle = 'rgba(10,12,18,0.85)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(px, top)
    ctx.quadraticCurveTo(px + 24, top - 3 + wave, px + 50, top + wave * 0.5)
    ctx.lineTo(px + 46, top + 14)
    ctx.lineTo(px + 50, top + 28 + wave * 0.3)
    ctx.quadraticCurveTo(px + 24, top + 26 - wave, px, top + 28)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // The emblem: a diamond for a captured country, a circle for a held line.
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    if (this.init.captured) {
      ctx.moveTo(px + 22, top + 7)
      ctx.lineTo(px + 29, top + 14)
      ctx.lineTo(px + 22, top + 21)
      ctx.lineTo(px + 15, top + 14)
    } else ctx.arc(px + 22, top + 14, 6, 0, Math.PI * 2)
    ctx.closePath()
    ctx.fill()
  }

  /** The numbers the page shows next to the scene: casualties so far, as they tick. */
  get shownLoss() {
    return [this.lossShown[0], this.lossShown[1]] as const
  }
  get startDivisions() {
    return [this.startUnits[0], this.startUnits[1]] as const
  }
  get squadsLeft() {
    return [this.alive(0).length, this.alive(1).length] as const
  }
  get liveParticles() {
    let n = 0
    for (const q of this.pool) if (q.live) n++
    return n
  }
}
