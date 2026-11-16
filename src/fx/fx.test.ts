import { describe, expect, it } from 'vitest'
import { FxEngine, K, PRIO } from './engine'
import { fakeArt, noopContext, runPerf } from './harness'
import { ADAPTIVE_DEFAULTS, AdaptiveQuality, CAPS, REDUCED_CAPS, capsFor, resolveTier, sanitizeFxSetting } from './quality'
import { clusterImpacts, lodOf, particlesFor, segmentsPerFlight, worthDrawing } from './lod'
import { ParticleStore, Pool } from './pool'
import { formationOf, squadCount } from './formation'
import { FLIGHT_STYLES, FlightRt, posAt, shape } from './flight'
import { playNuke, playSalvo } from './sequences'
import { Painter, setArtProvider } from './sprites'
import { EASE } from './timing'
import { OrthoView } from './view'

describe('pools', () => {
  it('reuses objects and never exceeds capacity', () => {
    const pool = new Pool(() => ({ n: 0 }), 3)
    const a = pool.acquire()!
    const b = pool.acquire()!
    pool.acquire()
    expect(pool.acquire()).toBeNull()
    pool.release(a)
    expect(pool.acquire()).toBe(a)
    expect(pool.reused).toBe(1)
    expect(pool.live).toBe(3)
    pool.release(b)
    expect(pool.live).toBe(2)
  })

  it('particle store overwrites the oldest when full and honours its limit', () => {
    const ps = new ParticleStore(10)
    ps.setLimit(4)
    for (let i = 0; i < 9; i++) ps.spawn(0, 0, 0, 0, 0, 5, 1, 1, 1, 0, 0, 0, false, i)
    expect(ps.count).toBe(4)
    expect(ps.dropped).toBe(5)
    // The newest four survive: rotation values 5..8 (the oldest were overwritten).
    expect([...ps.rot.slice(0, 4)].sort()).toEqual([5, 6, 7, 8])
    ps.update(10)
    expect(ps.count).toBe(0)
    ps.setLimit(0)
    expect(ps.spawn(0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, false)).toBe(-1)
  })
})

describe('quality', () => {
  it('caps shrink with the tier and obey the hard limits', () => {
    expect(CAPS.high.particles).toBeLessThanOrEqual(300)
    expect(CAPS.high.effects).toBeLessThanOrEqual(24)
    for (const k of ['particles', 'effects', 'fullFlights', 'trailSegments', 'armies'] as const) {
      expect(CAPS.high[k]).toBeGreaterThanOrEqual(CAPS.medium[k])
      expect(CAPS.medium[k]).toBeGreaterThanOrEqual(CAPS.low[k])
      expect(CAPS.low[k]).toBeGreaterThanOrEqual(CAPS.off[k])
    }
    expect(capsFor('high', true)).toBe(REDUCED_CAPS)
    expect(REDUCED_CAPS.particles).toBe(0)
    expect(capsFor('off', true).effects).toBe(0)
    expect(resolveTier('auto', 'medium')).toBe('medium')
    expect(resolveTier('low', 'high')).toBe('low')
    expect(sanitizeFxSetting('weird')).toBe('auto')
  })

  it('steps down on slow frames, up after a long calm, and not too often', () => {
    const a = new AdaptiveQuality('high')
    let stepped = 0
    for (let i = 0; i < 200; i++) if (a.sample(40)) stepped++
    expect(a.tier).toBe('low')
    expect(stepped).toBe(2)
    for (let i = 0; i < 100; i++) a.sample(8)
    expect(a.tier).not.toBe('high')
    const before = a.steps
    for (let i = 0; i < 2000; i++) a.sample(8)
    expect(a.tier).toBe('high')
    expect(a.steps).toBeGreaterThan(before)
    expect(a.sample(900)).toBeNull()
    expect(ADAPTIVE_DEFAULTS.fastMs).toBeLessThan(ADAPTIVE_DEFAULTS.slowMs)
  })

  it('does not flap on frames in the dead band', () => {
    const a = new AdaptiveQuality('medium')
    for (let i = 0; i < 2000; i++) a.sample(22)
    expect(a.steps).toBe(0)
  })
})

describe('lod', () => {
  it('culls and clusters by zoom and slots', () => {
    expect(lodOf(0.5)).toBe('far')
    expect(lodOf(2)).toBe('mid')
    expect(lodOf(5)).toBe('near')
    expect(worthDrawing(0.2, 4)).toBe(false)
    expect(particlesFor(10, 'far')).toBe(0)
    expect(particlesFor(10, 'mid')).toBe(5)
    expect(clusterImpacts(12, 24, 'near').blasts).toBe(12)
    const c = clusterImpacts(12, 8, 'near')
    expect(c.blasts).toBeLessThan(12)
    expect(c.scale).toBeGreaterThan(1)
    expect(clusterImpacts(12, 24, 'far').blasts).toBe(1)
    expect(segmentsPerFlight(480, 120)).toBe(4)
    expect(segmentsPerFlight(480, 10)).toBe(12)
  })
})

describe('engine caps and budget', () => {
  it('never holds more effects than the cap and drops the least important first', () => {
    const e = new FxEngine()
    for (let i = 0; i < 40; i++) e.add(K.RING, { dur: 5000, prio: PRIO.ring, lat: 0, lng: 0, a: 3 })
    expect(e.liveEffects).toBe(CAPS.high.effects)
    const nuke = e.add(K.SCREEN, { dur: 3000, prio: PRIO.nuke })
    expect(nuke).not.toBeNull()
    expect(e.liveEffects).toBe(CAPS.high.effects)
    // Something less important than everything alive is turned away.
    expect(e.add(K.RING, { dur: 100, prio: 1 })).toBeNull()
    e.setQuality('low', false)
    expect(e.liveEffects).toBeLessThanOrEqual(CAPS.low.effects)
    e.setQuality('off', false)
    expect(e.add(K.RING, { dur: 100, prio: 99 })).toBeNull()
  })

  it('releases effects when they end and reuses their objects', () => {
    const e = new FxEngine()
    for (let round = 0; round < 60; round++) {
      e.add(K.BURST, { dur: 200, prio: PRIO.burst, lat: 1, lng: 1, b: 3 })
      for (let k = 0; k < 4; k++) e.update(60)
    }
    expect(e.liveEffects).toBe(0)
    expect(e.fxPool.live).toBe(0)
    expect(e.fxPool.reused).toBeGreaterThan(40)
  })

  it('keeps particles under the cap through a nuclear strike and a salvo of twelve', () => {
    fakeArt()
    const e = new FxEngine()
    playNuke(e, { lat: 10, lng: 10 })
    playSalvo(e, { id: 'a', kind: 'ballistic', raid: false, from: { lat: 0, lng: 0 }, to: { lat: 30, lng: 40 }, fired: 12, hit: 12, stopped: 0, air: false, live: false, mine: true, factories: true, dead: 2, colorblind: false })
    let maxP = 0
    let maxE = 0
    for (let i = 0; i < 1800; i++) {
      e.update(16)
      maxP = Math.max(maxP, e.particles.count)
      maxE = Math.max(maxE, e.liveEffects)
    }
    expect(maxP).toBeLessThanOrEqual(300)
    expect(maxE).toBeLessThanOrEqual(24)
    expect(e.liveEffects).toBe(0)
    setArtProvider(null)
  })

  it('reduced motion plays a flash and a ring, no particles', () => {
    const e = new FxEngine()
    e.setQuality('high', true)
    playNuke(e, { lat: 0, lng: 0 })
    expect(e.liveEffects).toBe(2)
    for (let i = 0; i < 100; i++) e.update(16)
    expect(e.particles.count).toBe(0)
    playSalvo(e, { id: 'r', kind: 'cruise', raid: false, from: { lat: 0, lng: 0 }, to: { lat: 5, lng: 5 }, fired: 4, hit: 2, stopped: 0.5, air: false, live: false, mine: true, factories: false, dead: 0, colorblind: false })
    expect(e.particles.count).toBe(0)
  })

  it('clusters a big salvo into fewer blasts when slots are short', () => {
    const e = new FxEngine()
    e.setQuality('low', false)
    playSalvo(e, { id: 'b', kind: 'cruise', raid: false, from: { lat: 0, lng: 0 }, to: { lat: 10, lng: 10 }, fired: 12, hit: 12, stopped: 0, air: false, live: true, mine: false, factories: false, dead: 0, colorblind: false })
    expect(e.liveEffects).toBeLessThanOrEqual(CAPS.low.effects)
  })
})

describe('flight maths', () => {
  it('starts and ends at the endpoints and climbs by kind', () => {
    const f = new FlightRt()
    f.set('x', 'ballistic', 10, 10, 40, 80)
    const out = new Float64Array(3)
    const a0 = posAt(f, 0, out, 0)
    const mid = posAt(f, 0.5, out, 0)
    expect(mid).toBeGreaterThan(a0 + 0.1)
    const c = new FlightRt()
    c.set('y', 'cruise', 10, 10, 40, 80)
    expect(posAt(c, 0.5, out, 0)).toBeLessThan(0.06)
    for (const st of Object.values(FLIGHT_STYLES)) {
      let last = -1
      for (let i = 0; i <= 20; i++) {
        const q = shape(st, i / 20)
        expect(q).toBeGreaterThanOrEqual(last)
        last = q
      }
      expect(shape(st, 1)).toBeCloseTo(1)
    }
  })

  it('has distinct trail patterns per kind (a shape cue)', () => {
    const trails = Object.values(FLIGHT_STYLES).map((s) => s.trail)
    expect(new Set(trails).size).toBe(trails.length)
  })
})

describe('formation', () => {
  it('grows with the force and keeps the mix', () => {
    let last = 0
    for (const n of [0.1, 0.5, 1, 2, 4, 9, 20]) {
      const k = squadCount(n)
      expect(k).toBeGreaterThanOrEqual(last)
      last = k
    }
    expect(squadCount(0)).toBe(0)
    expect(squadCount(500)).toBe(12)
    const f = formationOf({ infantry: 4, armor: 1, artillery: 1 })
    expect(f.length).toBe(squadCount(6))
    expect(f.some((s) => s.kind === 'armor')).toBe(true)
    // Armour leads (front rows have the most negative y).
    const armorY = Math.min(...f.filter((s) => s.kind === 'armor').map((s) => s.y))
    expect(armorY).toBeLessThanOrEqual(Math.min(...f.filter((s) => s.kind === 'artillery').map((s) => s.y)))
  })
})

describe('easing and drawing', () => {
  it('easing curves hit their ends', () => {
    for (const fn of Object.values(EASE)) {
      expect(fn(0)).toBeCloseTo(0, 5)
    }
    expect(EASE.outCubic(1)).toBeCloseTo(1)
  })

  it('draws a busy frame without art (procedural fallback) and without throwing', () => {
    setArtProvider(null)
    const e = new FxEngine()
    const view = new OrthoView(800, 600, 10, 20, 4)
    const painter = new Painter(noopContext())
    playNuke(e, { lat: 10, lng: 20 })
    for (let i = 0; i < 30; i++) {
      e.update(16)
      painter.begin(1)
      expect(() => e.draw(painter, view)).not.toThrow()
    }
  })
})

describe('perf harness', () => {
  it('stays inside the JS budget with 0, 20 and 120 flights', () => {
    const rows = [0, 20, 120].map((n) => runPerf(n, 200, { effects: true }))
    console.log('FX harness (JS only, no-op canvas):', JSON.stringify(rows.map((r) => ({ flights: r.flights, avgMs: +r.avgMs.toFixed(3), p95Ms: +r.p95Ms.toFixed(3), maxMs: +r.maxMs.toFixed(3), particles: r.particles, effects: r.effects, blits: r.blits }))))
    // Generous CI bound; the real target (about 2 ms with 120 flights) is checked in the report.
    expect(rows[2].avgMs).toBeLessThan(8)
    expect(rows[0].avgMs).toBeLessThan(rows[2].avgMs + 1)
    expect(rows[2].particles).toBeLessThanOrEqual(300)
  })
})
