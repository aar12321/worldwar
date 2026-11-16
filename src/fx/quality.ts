/**
 * Effects quality: what the animation layer is allowed to spend. A player picks Auto, High, Medium, Low or Off; Auto measures how long
 * frames take and steps between the three real tiers by itself. Reduced motion always wins and gives the plain alternative (one flash and
 * one ring, no particles, no shake).
 */
export type FxSetting = 'auto' | 'high' | 'medium' | 'low' | 'off'
export type Tier = 'high' | 'medium' | 'low' | 'off'

export const FX_SETTINGS: readonly FxSetting[] = ['auto', 'high', 'medium', 'low', 'off']
export const FX_SETTING_LABELS: Record<FxSetting, string> = { auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low', off: 'Off' }

export interface Caps {
  /** Live particles (hard cap, 300 at most). */
  particles: number
  /** Live timeline effects: flashes, bursts, blasts, rings, flights played from reports. */
  effects: number
  /** State-driven flights drawn with a full trail; the rest are drawn as a dot. */
  fullFlights: number
  /** Trail segments across all flights in a frame. */
  trailSegments: number
  /** Trails stamped with the atlas strip texture (the rest are plain strokes). */
  stripTrails: number
  /** Marching armies drawn as formations. */
  armies: number
  /** Scorch and glow decals drawn. */
  decals: number
  /** Missiles drawn per salvo (a salvo of 12 shows this many bodies). */
  bodiesPerSalvo: number
  /** Resolution of the shock ring polyline. */
  ringSteps: number
  /** Device pixel ratio cap for the overlay canvas. */
  dpr: number
  /** Whether sprites may use the additive glow pass. */
  glow: boolean
}

export const CAPS: Record<Tier, Caps> = {
  high: { particles: 300, effects: 24, fullFlights: 40, trailSegments: 480, stripTrails: 24, armies: 40, decals: 24, bodiesPerSalvo: 12, ringSteps: 72, dpr: 1.5, glow: true },
  medium: { particles: 160, effects: 16, fullFlights: 20, trailSegments: 240, stripTrails: 8, armies: 20, decals: 16, bodiesPerSalvo: 6, ringSteps: 48, dpr: 1.25, glow: true },
  low: { particles: 60, effects: 8, fullFlights: 8, trailSegments: 100, stripTrails: 0, armies: 8, decals: 8, bodiesPerSalvo: 3, ringSteps: 28, dpr: 1, glow: false },
  off: { particles: 0, effects: 0, fullFlights: 0, trailSegments: 0, stripTrails: 0, armies: 0, decals: 0, bodiesPerSalvo: 0, ringSteps: 0, dpr: 1, glow: false },
}

/** Reduced motion: one flash and one ring, nothing that moves. */
export const REDUCED_CAPS: Caps = { ...CAPS.low, particles: 0, effects: 6, fullFlights: 0, trailSegments: 0, armies: 0, bodiesPerSalvo: 1, ringSteps: 36, glow: false }

export const TIER_ORDER: readonly Tier[] = ['low', 'medium', 'high']

/** The tier in force: the player's pick, or the automatic one for Auto. */
export const resolveTier = (setting: FxSetting, auto: Tier): Tier => (setting === 'auto' ? auto : setting)

/** Reduced motion never turns the layer fully off (the clean flash and ring are the alternative) but caps replace the tier's. */
export const capsFor = (tier: Tier, reduced: boolean): Caps => (tier === 'off' ? CAPS.off : reduced ? REDUCED_CAPS : CAPS[tier])

export const sanitizeFxSetting = (x: unknown): FxSetting => (FX_SETTINGS.includes(x as FxSetting) ? (x as FxSetting) : 'auto')

export interface AdaptiveOptions {
  /** Average frame time (ms) at or above which the tier steps down, and at or below which it may step up. */
  slowMs: number
  fastMs: number
  /** Seconds of consistently slow / fast frames before a step. Stepping up is slower than down, so it does not flap. */
  downAfter: number
  upAfter: number
  /** Minimum seconds between any two steps. */
  cooldown: number
}

export const ADAPTIVE_DEFAULTS: AdaptiveOptions = { slowMs: 26, fastMs: 18.5, downAfter: 1.2, upAfter: 8, cooldown: 3 }

/**
 * Watches frame times and steps the tier. Feed it one frame time per animation frame while effects run. A slow stretch (average over
 * `slowMs`) steps down one tier; a long fast stretch steps back up one. Pure: time comes in as arguments.
 */
export class AdaptiveQuality {
  tier: Tier
  private slowFor = 0
  private fastFor = 0
  private sinceStep = 99
  private ema = 16.7
  steps = 0

  readonly opts: AdaptiveOptions

  constructor(start: Tier = 'high', opts: AdaptiveOptions = ADAPTIVE_DEFAULTS) {
    this.opts = opts
    this.tier = start === 'off' ? 'low' : start
  }

  get averageMs() {
    return this.ema
  }

  /** `frameMs` is the time since the previous frame. Stalls (a hidden tab, over 250 ms) are ignored. Returns the new tier on a step. */
  sample(frameMs: number): Tier | null {
    if (frameMs <= 0 || frameMs > 250) return null
    const dt = frameMs / 1000
    this.ema += (frameMs - this.ema) * 0.1
    this.sinceStep += dt
    if (this.ema >= this.opts.slowMs) {
      this.slowFor += dt
      this.fastFor = 0
    } else if (this.ema <= this.opts.fastMs) {
      this.fastFor += dt
      this.slowFor = 0
    } else {
      this.slowFor = Math.max(0, this.slowFor - dt)
      this.fastFor = Math.max(0, this.fastFor - dt)
    }
    const i = TIER_ORDER.indexOf(this.tier)
    if (this.sinceStep >= this.opts.cooldown) {
      if (this.slowFor >= this.opts.downAfter && i > 0) return this.move(i - 1)
      if (this.fastFor >= this.opts.upAfter && i < TIER_ORDER.length - 1) return this.move(i + 1)
    }
    return null
  }

  private move(i: number): Tier {
    this.tier = TIER_ORDER[i]
    this.slowFor = 0
    this.fastFor = 0
    this.sinceStep = 0
    // Start from a neutral average so the old tier's frames do not count against the new one.
    this.ema = (this.opts.slowMs + this.opts.fastMs) / 2
    this.steps++
    return this.tier
  }
}
