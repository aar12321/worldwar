import type { GameState } from '../engine/types'

/** Used by the online tests only: the app itself never needs it. */
export function fingerprint(state: GameState): string {
  let h = 2166136261
  const text = `${state.turn}|${state.seed}|${state.log.length}|${state.nextId}|${Object.values(state.nations).map((n) => `${n.id}${n.alive ? 1 : 0}${Math.round(n.resources.capital)}`).join(',')}`
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
