import type { MissileType } from '../engine/types'

/**
 * Missiles. Each kind hurts a country in its own way, from far away and with no army. Hypersonic missiles are the older weapon (they
 * come from technology and the training queue); the others come from the missile program, which a nation raises one level at a time.
 */
export interface MissileSpec {
  name: string
  blurb: string
  /** What it is for, in a few words. */
  role: string
  /** Program level needed to build it. 0 means it comes from technology, not the program. */
  level: number
  /** What one costs to build. */
  money: number
  steel: number
  oil: number
  /** Range from a country with a factory, in km, and days in the air in a live game. */
  km: number
  days: number
  /** Defense Line cut by one, at most this much in a salvo, before the shield. */
  line: number
  lineMax: number
  /** Months the factories of the struck country stop. */
  factoryTurns: number
  /** Share of the defender's army killed by each, at most this much in a salvo. */
  army: number
  armyMax: number
  /** One building destroyed for this many missiles. 0 means none. */
  perBuilding: number
  /** Share of the struck country's people lost by each, at most this much in a salvo. */
  people: number
  peopleMax: number
  /** How easily a shield stops it: 1 is the shield's own rating, above 1 stops more, below 1 stops less. */
  intercept: number
  /** Fame and ill will each salvo earns. */
  infamy: number
  opinion: number
}

export const MISSILES: Record<MissileType, MissileSpec> = {
  cruise: { name: 'Cruise missile', blurb: 'Cheap and plentiful. It flies low and slow, wears down a Defense Line and cripples factories for a month, and a shield shoots many of them down.', role: 'Cheap harassment', level: 1, money: 6, steel: 1, oil: 0, km: 3500, days: 2, line: 0.25, lineMax: 4, factoryTurns: 1, army: 0, armyMax: 0, perBuilding: 0, people: 0, peopleMax: 0, intercept: 1.5, infamy: 0, opinion: 0 },
  tactical: { name: 'Tactical missile', blurb: 'Aimed at the army, not the land. Each kills a slice of the defender\'s units wherever they stand, and does nothing to the Defense Line.', role: 'Kills armies', level: 2, money: 9, steel: 2, oil: 0, km: 2500, days: 1, line: 0, lineMax: 0, factoryTurns: 0, army: 0.006, armyMax: 0.12, perBuilding: 0, people: 0, peopleMax: 0, intercept: 1, infamy: 0, opinion: 0 },
  hypersonic: { name: 'Hypersonic missile', blurb: 'Fast and hard to stop. It cuts the Defense Line and stops factories for two months. It comes from technology and the training queue.', role: 'Cracks defenses', level: 0, money: 0, steel: 0, oil: 0, km: 6000, days: 1, line: 0.6, lineMax: 8, factoryTurns: 2, army: 0, armyMax: 0, perBuilding: 0, people: 0, peopleMax: 0, intercept: 1, infamy: 0, opinion: 0 },
  ballistic: { name: 'Ballistic missile', blurb: 'A heavy warhead from across a continent. It breaks the Defense Line, destroys buildings and kills people, and the world will not forgive it.', role: 'Strategic damage', level: 3, money: 30, steel: 5, oil: 3, km: 9000, days: 3, line: 1, lineMax: 12, factoryTurns: 3, army: 0, armyMax: 0, perBuilding: 3, people: 0.004, peopleMax: 0.05, intercept: 0.8, infamy: 3, opinion: -12 },
}

export const MISSILE_TYPES = Object.keys(MISSILES) as MissileType[]
/** The kinds the missile program builds. */
export const PROGRAM_MISSILES = MISSILE_TYPES.filter((k) => MISSILES[k].level > 0)

export const MISSILE_PROGRAM = {
  maxLevel: 3,
  /** Money and research to raise the program to level 1, 2 and 3: the talent hired, the labs and the test ranges. */
  money: [120, 260, 480],
  research: [10, 25, 50],
  /** Missiles the program can build in a month, at each level. */
  capacity: [0, 5, 10, 18],
  names: ['No program', 'Level 1: cruise missiles', 'Level 2: tactical missiles', 'Level 3: ballistic missiles'],
}
