import { atWar, isAllied } from './helpers'
import { militaryPower } from './militaryStats'
import type { GameState, NationId } from './types'

/** True when `viewer` can see `target`'s real forces: their own, a friend's, an enemy at the front, or one spied on or watched from orbit. */
export function hasIntel(game: GameState, viewer: NationId, target: NationId): boolean {
  if (viewer === target) return true
  const v = game.nations[viewer]
  const t = game.nations[target]
  if (!t) return false
  if (t.overlord === viewer || v?.overlord === target) return true
  if (isAllied(game, viewer, target) || atWar(game, viewer, target)) return true
  return (game.intel?.[`${viewer}|${target}`] ?? -1) >= game.turn
}

export interface PowerView {
  /** The number to show: the real one with intel, otherwise a rough guess. */
  value: number
  exact: boolean
}

/** A number in [0, 1) that is the same for the same text, so a guess does not jump about between screens. */
function steady(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/**
 * Another nation's military strength as the viewer knows it. Without intelligence it is a rounded guess that can be off by a fifth
 * and holds the same error for a year, so it moves with the real thing but never gives it away. Nothing here uses the random streams.
 */
export function powerView(game: GameState, viewer: NationId, target: NationId, actual: number = militaryPower(game, target)): PowerView {
  if (hasIntel(game, viewer, target)) return { value: actual, exact: true }
  const guess = actual * (0.8 + 0.4 * steady(`${viewer}|${target}|${Math.floor(game.turn / 12)}`))
  const step = guess < 40 ? 5 : guess < 200 ? 10 : 50
  return { value: Math.max(0, Math.round(guess / step) * step), exact: false }
}

/** "120" with intel, "~120" without. */
export const showPower = (v: PowerView): string => (v.exact ? v.value.toFixed(0) : `~${v.value.toFixed(0)}`)
