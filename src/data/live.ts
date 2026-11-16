import type { Via } from '../engine/types'

/** Numbers for the live mode, where time flows and armies march. */
export const LIVE = {
  /** Real time one game day takes at normal speed. A month is about a minute. */
  msPerDay: 2000,
  /** The most days the clock may run to catch up in one frame, so a stalled tab never races ahead. */
  maxCatchUpDays: 3,
  /** Days an army musters before it sets out. */
  musterDays: 1,
  /** Days an army stays at the battle after it arrives, for the show. */
  battleDays: 1,
  /** Share of the military that stays at home whatever is sent, so an all-in attack does not leave the land empty for weeks. */
  homeGuard: 0.1,
  /** The AI's attacks for the month leave on a day in this range (inclusive), counted from the 1st. */
  launchWindow: [0, 14] as const,
  /** Mixed into the live clock's random numbers so they never repeat the turn mode's. */
  salt: 0x1d4c3a5,
  /** How fast each kind of march goes. The days are `ceil(km / kmPerDay) + extra`, kept between `min` and `max`. */
  travel: {
    land: { kmPerDay: 400, extra: 0, min: 2, max: 8 },
    lane: { kmPerDay: 650, extra: 1, min: 2, max: 8 },
    fleet: { kmPerDay: 900, extra: 1, min: 3, max: 18 },
    air: { kmPerDay: 2500, extra: 0, min: 1, max: 4 },
  } as Record<Via, { kmPerDay: number; extra: number; min: number; max: number }>,
  /** How high above the globe each kind of march arcs, as a share of the globe's radius. */
  arcHeight: { land: 0.004, lane: 0.012, fleet: 0.015, air: 0.06 } as Record<Via, number>,
}
