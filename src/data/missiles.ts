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
  /** Missiles that must get through the shield to stop the factories (default one half: a single missile, even through a shield). Light ones need a few. */
  factoryNeed?: number
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
  // ---- The missile war (every kind hurts people and the line; these set how much, and the secondary harm) ----
  /** Extra casualties on a city-heavy target: people lost are multiplied by 1 + urban x (the country's urban share, 0 to 1). */
  urban: number
  /** Stability the struck nation loses for each 1% of its people killed, and infamy the attacker earns for each 1% (a war crime in the world's eyes). */
  stability: number
  crime: number
  /** Counterforce: share of the enemy's missiles in store destroyed by each, at most this much in a salvo, when aimed at a launch site. */
  site: number
  siteMax: number
  /** Share of the struck country's oil stock burned by each (fuel depots), and of its fighters and strike aircraft on the ground (airbases), at most this much. */
  fuel: number
  fuelMax: number
  air: number
  airMax: number
  /** Interceptor rounds a shield fires at each one that arrives. */
  drain: number
  /** World tension each one that gets through adds. */
  tension: number
  /** How much of the program's monthly capacity and the stores one takes up (decoys are cheap and small). */
  slots: number
}

export const MISSILES: Record<MissileType, MissileSpec> = {
  // Reading the table: `people` and `line` are what EVERY kind does (no kind is harmless); the rest is each kind's own character.
  // cruise: the cheapest damage per money for the line and the best at hitting oil and airbases; shot down easily, so it wants saturation.
  // tactical: the army killer and the best counterforce weapon (precise, hits launchers and airbases, spares the civilians most).
  // hypersonic: hard to stop and the best line-breaker per missile, but the army's own unit is expensive per shot.
  // ballistic: the heavy hitter, with the most dead, the most buildings and the most infamy; it soaks up two interceptors per warhead.
  // decoy: a rocket with a token warhead that costs a quarter of a cruise missile: its job is to burn the enemy's interceptor store.
  cruise: { name: 'Cruise missile', blurb: 'Cheap and plentiful. It flies low and slow, wears down a Defense Line, cripples factories for a month and burns fuel depots and airfields. A shield shoots many of them down, so fire many at once.', role: 'Cheap harassment', level: 1, money: 6, steel: 1, oil: 0, km: 3500, days: 2, line: 0.25, lineMax: 4, factoryTurns: 1, factoryNeed: 3, army: 0, armyMax: 0, perBuilding: 0, people: 0.0008, peopleMax: 0.012, intercept: 1.5, infamy: 0, opinion: 0, urban: 0.5, stability: 0.5, crime: 0.25, site: 0.03, siteMax: 0.3, fuel: 0.01, fuelMax: 0.08, air: 0.008, airMax: 0.08, drain: 1, tension: 0.4, slots: 1 },
  tactical: { name: 'Tactical missile', blurb: 'Aimed at the army, not the land. Each kills a slice of the defender\'s units wherever they stand, nicks the line, and is the best weapon against launch sites and airbases. It spares civilians the most.', role: 'Kills armies, hits launchers', level: 2, money: 9, steel: 2, oil: 0, km: 2500, days: 1, line: 0.12, lineMax: 1.5, factoryTurns: 0, army: 0.006, armyMax: 0.12, perBuilding: 0, people: 0.0005, peopleMax: 0.008, intercept: 1, infamy: 0, opinion: 0, urban: 0.2, stability: 0.3, crime: 0.2, site: 0.06, siteMax: 0.5, fuel: 0, fuelMax: 0, air: 0.015, airMax: 0.12, drain: 1, tension: 0.5, slots: 1 },
  hypersonic: { name: 'Hypersonic missile', blurb: 'Fast and hard to stop. It cuts the Defense Line, stops factories for two months and kills civilians in cities. It comes from technology and the training queue.', role: 'Cracks defenses', level: 0, money: 0, steel: 0, oil: 0, km: 6000, days: 1, line: 0.6, lineMax: 8, factoryTurns: 2, army: 0, armyMax: 0, perBuilding: 0, people: 0.0015, peopleMax: 0.02, intercept: 1, infamy: 0, opinion: 0, urban: 0.8, stability: 0.6, crime: 0.35, site: 0.05, siteMax: 0.45, fuel: 0.006, fuelMax: 0.06, air: 0.006, airMax: 0.06, drain: 1, tension: 1.2, slots: 1 },
  ballistic: { name: 'Ballistic missile', blurb: 'A heavy warhead from across a continent. It breaks the Defense Line, destroys buildings and kills the most people, and the world will not forgive it. It draws two interceptors a warhead.', role: 'Strategic damage', level: 3, money: 30, steel: 5, oil: 3, km: 9000, days: 3, line: 1, lineMax: 12, factoryTurns: 3, army: 0, armyMax: 0, perBuilding: 3, people: 0.004, peopleMax: 0.05, intercept: 0.8, infamy: 3, opinion: -12, urban: 1.5, stability: 1.2, crime: 0.6, site: 0.03, siteMax: 0.3, fuel: 0.02, fuelMax: 0.15, air: 0.01, airMax: 0.1, drain: 1.5, tension: 3, slots: 1 },
  decoy: { name: 'Decoy rocket', blurb: 'A cheap rocket with a token warhead. Radar cannot tell it from a real missile, so every one that arrives makes the shield spend a round. Fire a wave of them, then the real salvo.', role: 'Drains interceptors', level: 1, money: 1.5, steel: 0, oil: 0, km: 3000, days: 1, line: 0.02, lineMax: 0.3, factoryTurns: 0, army: 0, armyMax: 0, perBuilding: 0, people: 0.0001, peopleMax: 0.002, intercept: 1.3, infamy: 0, opinion: 0, urban: 0.5, stability: 0.2, crime: 0, site: 0, siteMax: 0, fuel: 0, fuelMax: 0, air: 0, airMax: 0, drain: 1, tension: 0.1, slots: 0.34 },
}

/** The numbers that changed when the missile war was added, as they were before: `withOldMissiles` puts them back to prove the goldens. */
export const LEGACY_MISSILES: Partial<Record<MissileType, Partial<MissileSpec>>> = {
  cruise: { people: 0, peopleMax: 0 },
  tactical: { line: 0, lineMax: 0, people: 0, peopleMax: 0 },
  hypersonic: { people: 0, peopleMax: 0 },
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
  /** Months of production the stores can hold: a nation can stockpile this many months of missiles, no more. */
  storageMonths: 6,
  names: ['No program', 'Level 1: cruise missiles', 'Level 2: tactical missiles', 'Level 3: ballistic missiles'],
}
