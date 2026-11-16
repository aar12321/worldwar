/**
 * Timing tokens and easing curves for every animation, in one place. Components and effects read these, so the whole game moves with the
 * same rhythm and a speed change is one edit. Times are milliseconds. Nothing here touches the game: animation reads state only.
 */
export const TIMING = {
  /** Button hover and press, small state changes. */
  micro: 120,
  quick: 200,
  base: 320,
  slow: 560,
  /** Animated number tickers (casualties, damage). */
  ticker: 650,
  /** One round of a battle scene and the intro before the first. */
  round: 1400,
  intro: 700,
  /** A flash of white at the moment of a blast. */
  flash: 140,
  /** The screen wash of a nuclear blast, the sweep of its shockwave, and the whole sequence. */
  nukeFlash: 2600,
  nukeShock: 6500,
  nukeSequence: 11000,
  /** Camera ease to the action. */
  camera: 900,
  /** A missile salvo played from a report (turn games): launch, flight, terminal phase. */
  launch: 700,
  flight: 2600,
  terminal: 1500,
  /** Distance between impacts in a salvo. */
  impactStagger: 150,
  /** Delay before the camera follows again, so it does not twitch on every ring. */
  followCooldown: 5000,
} as const

export type Ease = (t: number) => number

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const EASE = {
  linear: ((t) => t) as Ease,
  inQuad: ((t) => t * t) as Ease,
  outQuad: ((t) => 1 - (1 - t) * (1 - t)) as Ease,
  inCubic: ((t) => t * t * t) as Ease,
  outCubic: ((t) => 1 - Math.pow(1 - t, 3)) as Ease,
  inOutCubic: ((t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)) as Ease,
  outExpo: ((t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))) as Ease,
  outBack: ((t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  }) as Ease,
  /** Rises, then settles back to 0: a pulse that peaks in the middle. */
  pulse: ((t) => Math.sin(Math.PI * clamp01(t))) as Ease,
} as const

/** CSS equivalents, so stylesheets and canvas code agree. */
export const CSS_EASE = {
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const

/** Frame-rate independent smoothing toward a target (camera, bars): `rate` per second. */
export const damp = (current: number, target: number, rate: number, dtMs: number) => lerp(current, target, 1 - Math.exp((-rate * dtMs) / 1000))
