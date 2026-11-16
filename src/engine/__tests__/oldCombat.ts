import { UNIT_SPECS } from '../../data/unitTypes'
import { STANCES } from '../../data/war'
import { COMBAT } from '../combat'
import { UNIT_TYPES } from '../types'

/**
 * The combat rules as they were before the War Room work (docs/WAR_STATUS.md): no fortune of the day, every division soaks up the same
 * damage, robots attack at 1.6, Siege loses 30% fewer and Blitz 30% more. Every one of those is a number in a data table, so putting
 * them back is the proof that the tuning is the only thing that moved the pinned games: with these in force the old golden hashes
 * return (turnGolden.test.ts), and the combat sweep prints its "before" tables from them (combatMatrix.sweep.ts).
 */
export function withOldCombat<T>(fn: () => T): T {
  const luck = COMBAT.luck
  const tough = UNIT_TYPES.map((k) => UNIT_SPECS[k].toughness)
  const robot = UNIT_SPECS.robot.attack
  const siege = { ...STANCES.siege, boost: { ...STANCES.siege.boost } }
  const blitz = { ...STANCES.blitz }
  COMBAT.luck = 0
  for (const k of UNIT_TYPES) UNIT_SPECS[k].toughness = 1
  UNIT_SPECS.robot.attack = 1.6
  Object.assign(STANCES.siege, { advance: 0.7, ownLosses: 0.7, boost: { infantry: 1.15, naval: 1.15, artillery: 1.25 } })
  Object.assign(STANCES.blitz, { ownLosses: 1.3 })
  try {
    return fn()
  } finally {
    COMBAT.luck = luck
    UNIT_TYPES.forEach((k, i) => (UNIT_SPECS[k].toughness = tough[i]))
    UNIT_SPECS.robot.attack = robot
    Object.assign(STANCES.siege, siege)
    Object.assign(STANCES.blitz, blitz)
  }
}
