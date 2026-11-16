import type { GameState } from '../engine/types'

/** Used by the online tests only: the app itself never needs it. */
export function fingerprint(state: GameState): string {
  let h = 2166136261
  const text = `${state.turn}|${state.seed}|${state.log.length}|${state.nextId}|${Object.values(state.nations).map((n) => `${n.id}${n.alive ? 1 : 0}${Math.round(n.resources.capital)}`).join(',')}`
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/**
 * A checksum of a whole shared live game, for screens to compare. The two fields each screen keeps for itself (whose screen it is,
 * and the report's starting point) are left out; everything else the game holds is in.
 */
export function liveFingerprint(state: GameState): string {
  const { playerId: _playerId, monthStart: _monthStart, ...rest } = state
  const text = JSON.stringify(rest)
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`
}
