import { WARSCORE } from '../warscore'

/**
 * War score as it was before docs/WARSCORE_STATUS.md: a tally that only grows (battle wins, kills, a flat bonus for a capture), no fade,
 * no memory of who holds the land. With this in force the earlier golden hashes return (turnGolden.test.ts).
 */
export function withOldWarScore<T>(fn: () => T): T {
  const was = WARSCORE.live
  WARSCORE.live = false
  try {
    return fn()
  } finally {
    WARSCORE.live = was
  }
}
