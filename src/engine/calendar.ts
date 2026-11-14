import { START_YEAR } from './helpers'
import type { GameState } from './types'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_MS = 86_400_000
const EPOCH = Date.UTC(START_YEAR, 0, 1)

/** Month 1 is January of the first year, as in `turnDate`. */
const monthStart = (turn: number) => Date.UTC(START_YEAR + Math.floor((turn - 1) / 12), (turn - 1) % 12, 1)

/** Days in the month of a turn, with real month lengths. */
export function daysInMonth(turn: number): number {
  return Math.round((monthStart(turn + 1) - monthStart(turn)) / DAY_MS)
}

/** Days since the first of January of the first year, for a day of a month (the first day is 0). */
export function absDay(turn: number, day: number): number {
  return Math.round((monthStart(turn) - EPOCH) / DAY_MS) + day
}

/** The month and day of an absolute day. */
export function fromAbsDay(n: number): { turn: number; day: number } {
  const d = new Date(EPOCH + n * DAY_MS)
  const turn = (d.getUTCFullYear() - START_YEAR) * 12 + d.getUTCMonth() + 1
  return { turn, day: d.getUTCDate() - 1 }
}

/** "14 March 2026". */
export function dayDate(turn: number, day: number): string {
  const d = new Date(monthStart(turn) + day * DAY_MS)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** The date of an absolute day. */
export function absDate(n: number): string {
  const { turn, day } = fromAbsDay(n)
  return dayDate(turn, day)
}

/** Whether this game runs on a live clock. */
export const isLive = (s: Pick<GameState, 'settings'>) => s.settings.mode === 'live'

/**
 * The month the clock reads. It is the turn, except at the instant a live month turns over, when the AI plans the month about
 * to begin and the clock already reads its first day.
 */
export const clockMonth = (s: Pick<GameState, 'turn' | 'day'>) => s.turn + ((s.day ?? 0) >= daysInMonth(s.turn) ? 1 : 0)

/** The game's clock, in absolute days. */
export const clockOf = (s: Pick<GameState, 'turn' | 'day'>) => absDay(s.turn, s.day ?? 0)
