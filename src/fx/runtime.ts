import { FxEngine } from './engine'
import { AdaptiveQuality, resolveTier, type Tier } from './quality'
import * as sequences from './sequences'
import { useFxPrefs } from './settings'
import { Painter } from './sprites'
import { ThreeView, type CameraLike } from './view'

/**
 * The one animation loop. It runs only while there is something to animate (effects, particles, or flights and armies while the game
 * clock runs), draws a single still frame when the camera moves or the state changes, does nothing otherwise, and stops while the tab is
 * hidden. It measures real frame times and lets Auto step the quality tier.
 */
export const fxEngine = new FxEngine()

export interface LoopHost {
  canvas: HTMLCanvasElement
  camera(): CameraLike | null
  /** Absolute game time for flights and armies, and whether the clock is running. */
  clock(): { t: number; running: boolean }
}

class Runtime {
  host: LoopHost | null = null
  private raf = 0
  private last = 0
  private painter: Painter | null = null
  private readonly view = new ThreeView()
  private adaptive = new AdaptiveQuality('high')
  private lastStamp = -1
  private dpr = 1
  private cssW = 0
  private cssH = 0
  private drawnLast = false
  reduced = false
  /** Dev and tests: hold the effect clock still; `step` then advances it by hand, so frames can be captured at exact moments. */
  freeze = false
  step(ms: number) {
    for (let t = 0; t < ms; t += 16) fxEngine.update(Math.min(16, ms - t))
    fxEngine.touch()
  }
  /** Frame times measured while animating, for the dev panel and the harness. */
  frameMs = 16.7
  running = 0

  constructor() {
    fxEngine.wake = () => this.wake()
  }

  attach(host: LoopHost) {
    this.host = host
    const ctx = host.canvas.getContext('2d', { alpha: true })
    this.painter = ctx ? new Painter(ctx) : null
    this.applyQuality()
    this.resize()
    this.wake()
  }

  detach() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.host = null
    this.painter = null
  }

  /** Re-resolves the tier from the player's setting, Auto's pick and reduced motion. */
  applyQuality() {
    const prefs = useFxPrefs.getState()
    const tier = resolveTier(prefs.quality, this.adaptive.tier)
    if (tier !== fxEngine.tier || this.reduced !== fxEngine.reduced) {
      fxEngine.setQuality(tier, this.reduced)
      this.resize()
    }
    this.wake()
  }

  setReduced(r: boolean) {
    this.reduced = r
    this.applyQuality()
  }

  resize() {
    const host = this.host
    if (!host) return
    const dpr = Math.min(window.devicePixelRatio || 1, fxEngine.caps.dpr)
    const w = window.innerWidth
    const h = window.innerHeight
    if (dpr === this.dpr && w === this.cssW && h === this.cssH && host.canvas.width) return
    this.dpr = dpr
    this.cssW = w
    this.cssH = h
    host.canvas.width = Math.round(w * dpr)
    host.canvas.height = Math.round(h * dpr)
    host.canvas.style.width = `${w}px`
    host.canvas.style.height = `${h}px`
    fxEngine.touch()
  }

  wake() {
    if (this.raf || !this.host || typeof document === 'undefined' || document.hidden) return
    this.last = 0
    this.raf = requestAnimationFrame(this.frame)
  }

  /** The tab came back: the first frame must not count the time it was away. */
  visibility() {
    if (document.hidden) {
      if (this.raf) cancelAnimationFrame(this.raf)
      this.raf = 0
    } else this.wake()
  }

  private needsLoop(clock: { running: boolean }) {
    const e = fxEngine
    if (!e.enabled) return false
    return e.animating || (clock.running && (e.flights.size > 0 || e.armies.size > 0))
  }

  private frame = (now: number) => {
    this.raf = 0
    const host = this.host
    const painter = this.painter
    if (!host || !painter) return
    const e = fxEngine
    const dtRaw = this.last ? now - this.last : 16.7
    this.last = now
    const cam = host.camera()
    const clock = host.clock()
    if (cam) {
      this.resize()
      this.view.update(cam, this.cssW, this.cssH)
    }
    e.clockT = clock.t
    const loop = this.needsLoop(clock)
    // Effects advance on wall time; flights and armies on the game clock (read above).
    if (!this.freeze && (loop || e.animating)) e.update(dtRaw)
    const moved = this.view.stamp !== this.lastStamp
    if (cam && e.enabled && (loop || e.dirty || moved)) {
      painter.begin(this.dpr)
      painter.ctx.clearRect(0, 0, this.cssW, this.cssH)
      e.draw(painter, this.view)
      this.lastStamp = this.view.stamp
      this.drawnLast = true
    } else if (this.drawnLast && !e.enabled) {
      painter.ctx.setTransform(1, 0, 0, 1, 0, 0)
      painter.ctx.clearRect(0, 0, host.canvas.width, host.canvas.height)
      this.drawnLast = false
    }
    if (loop) {
      // Frame time is only meaningful while we are the ones keeping the loop running.
      this.frameMs += (dtRaw - this.frameMs) * 0.1
      if (useFxPrefs.getState().quality === 'auto' && !this.reduced) {
        const step = this.adaptive.sample(dtRaw)
        if (step) {
          useFxPrefs.getState().setAutoTier(step)
          this.applyQuality()
        }
      }
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  /** Dev/test: run with a given tier right now. */
  get tier(): Tier {
    return fxEngine.tier
  }
}

export const fxRuntime = new Runtime()

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __fxEngine: FxEngine; __fxRuntime: Runtime }).__fxEngine = fxEngine
  ;(window as unknown as { __fxRuntime: Runtime }).__fxRuntime = fxRuntime
  ;(window as unknown as { __fxSeq: typeof sequences }).__fxSeq = sequences
}
