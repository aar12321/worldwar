import type { GameState } from './types'

/**
 * A state that nobody changes for a while: the rivals plan their month on it, and planning only reads. While a state is frozen,
 * pure reports on it (a nation's economy, its military power, the market's prices) are worked out once and handed back to every
 * later caller. The values are exactly what the function returns, so freezing changes no result, only how often it is computed.
 * The caches go when the state thaws, before anything can change it again.
 */
const frozen = new WeakMap<GameState, Map<string, Map<unknown, unknown>>>()

/** Off, nothing is ever frozen and every report is worked out each time it is asked for (the switch-off proof in tests). */
export const FREEZE = { on: true }

/** Runs `fn` with `s` frozen. `fn` must not change `s`. Nested calls on the same state share the outer freeze. */
export function whileFrozen<T>(s: GameState, fn: () => T): T {
  if (!FREEZE.on || frozen.has(s)) return fn()
  frozen.set(s, new Map())
  try {
    return fn()
  } finally {
    frozen.delete(s)
  }
}

/** The memo named `name` for `s` while it is frozen, or null when `s` may change. */
export function frozenMemo<K, V>(s: GameState, name: string): Map<K, V> | null {
  const scope = frozen.get(s)
  if (!scope) return null
  let m = scope.get(name)
  if (!m) scope.set(name, (m = new Map()))
  return m as Map<K, V>
}

/** `compute(key)`, once per key while `s` is frozen; every time otherwise. */
export function memoFrozen<K, V>(s: GameState, name: string, key: K, compute: () => V): V {
  const m = frozenMemo<K, V>(s, name)
  if (!m) return compute()
  if (m.has(key)) return m.get(key) as V
  const v = compute()
  m.set(key, v)
  return v
}
