import { ART_CLIPS } from '../art/MANIFEST'
import { FxEngine, type FlightSpec } from './engine'
import { playNuke, playSalvo } from './sequences'
import { Painter, setArtProvider } from './sprites'
import { OrthoView } from './view'

/**
 * Headless performance harness: runs the engine for a number of frames against a no-op 2D context and reports the JS time per frame.
 * It measures the animation layer's own work (maths, projection, building the draw calls). It cannot measure rasterising or the GPU:
 * software GL and a no-op context resolve neither, so a browser run (see docs/FX_STATUS.md) adds the real canvas cost.
 */
export function noopContext(): CanvasRenderingContext2D {
  const fn = () => {}
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : k === 'createRadialGradient' ? () => ({ addColorStop: fn }) : fn),
    set: (t, k, v) => {
      t[k as string] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

export function fakeArt() {
  const byId = new Map(ART_CLIPS.map((c) => [c.id, c]))
  setArtProvider((id) => {
    const clip = byId.get(id)
    return clip ? { clip, image: { width: 1024, height: 1024 } } : null
  })
}

export function makeFlights(n: number): FlightSpec[] {
  const kinds = ['cruise', 'tactical', 'hypersonic', 'ballistic', 'decoy'] as const
  const out: FlightSpec[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: `f${i}`,
      kind: kinds[i % kinds.length],
      from: { lat: -40 + ((i * 17) % 80), lng: -120 + ((i * 29) % 240) },
      to: { lat: -40 + ((i * 31) % 80), lng: -120 + ((i * 13 + 70) % 240) },
      launched: 0,
      lands: 10,
      count: 1 + (i % 12),
      mine: i % 5 === 0,
      incoming: i % 7 === 0,
    })
  }
  return out
}

export interface PerfResult {
  flights: number
  frames: number
  avgMs: number
  p95Ms: number
  maxMs: number
  particles: number
  effects: number
  blits: number
}

export function runPerf(flights: number, frames = 300, opts: { effects?: boolean; tier?: 'high' | 'medium' | 'low' } = {}): PerfResult {
  fakeArt()
  const e = new FxEngine()
  e.setQuality(opts.tier ?? 'high', false)
  const view = new OrthoView(1440, 900, 10, 20, 4.8)
  const painter = new Painter(noopContext())
  e.syncFlights(makeFlights(flights))
  const times: number[] = []
  let particles = 0
  let effects = 0
  let blits = 0
  for (let i = 0; i < frames; i++) {
    e.clockT = 0.5 + (i / frames) * 8
    if (opts.effects && i % 40 === 0) {
      playSalvo(e, { id: `s${i}`, kind: 'ballistic', raid: false, from: { lat: 10, lng: -20 }, to: { lat: 20, lng: 30 }, fired: 12, hit: 8, stopped: 0.33, air: false, live: false, mine: true, factories: true, dead: 1, colorblind: false })
      if (i % 120 === 0) playNuke(e, { lat: 15, lng: 20 })
    }
    const t0 = performance.now()
    e.update(16.7)
    painter.begin(1)
    e.draw(painter, view)
    times.push(performance.now() - t0)
    particles = Math.max(particles, e.particles.count)
    effects = Math.max(effects, e.liveEffects)
    blits = Math.max(blits, painter.blits)
  }
  setArtProvider(null)
  times.sort((a, b) => a - b)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  return { flights, frames, avgMs: avg, p95Ms: times[Math.floor(times.length * 0.95)], maxMs: times[times.length - 1], particles, effects, blits }
}
