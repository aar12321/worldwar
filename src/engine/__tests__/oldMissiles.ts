import { MW } from '../../data/missileWar'

/**
 * The missile rules as they were before the missile war (docs/MISSILE_WAR_STATUS.md): light missiles hurt no people, a tactical missile no
 * line, the shield never runs out of rounds, batteries, radar, reports, tension, doctrine and the AI's missile-war play do not exist.
 * With these in force the old golden hashes return (turnGolden.test.ts), the proof that the missile war moves only games that use it.
 */
export function withOldMissiles<T>(fn: () => T): T {
  const was = MW.enabled
  MW.enabled = false
  try {
    return fn()
  } finally {
    MW.enabled = was
  }
}
