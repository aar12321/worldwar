import type { MissileType, Tier } from '../engine/types'

/**
 * Aircraft development. Fighters and strike aircraft (bombers) get better one development at a time. Each development is a node in a
 * tree of four branches; it costs research on the day it starts and money every month it is worked on, takes months, needs earlier
 * nodes, a technology, and an empire big enough. Everything a node does is written here as data (`effects`), and the engine reads the
 * same numbers for the stat sheet, for battles, for strikes and for the AI.
 */
export type AircraftBranch = 'interceptors' | 'stealth' | 'range' | 'drones'

export type AircraftNodeId =
  | 'radar' | 'aam' | 'hunters' | 'iads'
  | 'coatings' | 'stealthBombers' | 'ew' | 'blackout'
  | 'dropTanks' | 'refuel' | 'payload' | 'strategic'
  | 'wingmen' | 'swarm' | 'loyal' | 'autonomous'

/** Everything a development can change. All are shares (0.1 is 10%) unless a comment says otherwise. Missing means none. */
export interface AircraftEffects {
  /** Added to the attack and defense of fighters, bombers and drone swarms, like a technology's bonus. */
  fighterAttack: number
  fighterDefense: number
  bomberAttack: number
  bomberDefense: number
  droneAttack: number
  droneDefense: number
  /** Share of incoming missiles and drones that a full wing of your fighters at home shoots down (a smaller wing, less). */
  hunt: number
  /** Share of an enemy shield's and enemy hunters' stopping power that does not work against your missiles, drones and bombers. */
  pierce: number
  /** Added to the 40% strength your bombers keep when the enemy rules the air (stealthy bombers survive). */
  bomberFloor: number
  /** Cut in the enemy's hunters and in the edge their fighters give them in the air war. */
  jam: number
  /** Kilometres added to the 7000 km reach of fighters and bombers from an airbase. */
  airRange: number
  /** Cut in the landing penalty when your attack comes by air. */
  landing: number
  /** Extra Defense Line pushed back by an attack, when bombers are a quarter or more of the force sent. */
  bomberLine: number
  /** Share of the penalty drones suffer against enemy fighters that is removed. */
  droneEvade: number
  /** Faster development of everything else. */
  speed: number
}

export type AircraftEffectKey = keyof AircraftEffects

export interface AircraftNode {
  name: string
  branch: AircraftBranch
  /** One sentence on what it is. */
  blurb: string
  /** The empire tier that opens it (1 Nation, 2 Regional power, 3 Great power, 4 Superpower). */
  tier: Tier
  requires: AircraftNodeId[]
  /** The technology that unlocks the aircraft it improves. */
  tech: string
  /** Money in all, paid in months as the work goes on. */
  money: number
  /** Research, paid the day it starts. */
  tp: number
  /** Months of work at a normal pace. */
  months: number
  effects: Partial<AircraftEffects>
}

export const AIRCRAFT_BRANCHES: Record<AircraftBranch, { name: string; role: string; color: string }> = {
  interceptors: { name: 'Interceptors', role: 'Radar and fighters that shoot down what flies at you: missiles and drones.', color: '#6cb4ff' },
  stealth: { name: 'Stealth and electronic war', role: 'Bombers that survive, shields that stop less, and enemy interceptors that go blind.', color: '#bf5af2' },
  range: { name: 'Range and payload', role: 'Reach beyond 7000 km, easier landings, and bombers that crack a Defense Line.', color: '#ffd60a' },
  drones: { name: 'Unmanned wingmen', role: 'Drone swarms and robot partners for the pilots.', color: '#6eeb8a' },
}

export const AIRCRAFT_BRANCH_IDS: AircraftBranch[] = ['interceptors', 'stealth', 'range', 'drones']

export const AIRCRAFT_NODES: Record<AircraftNodeId, AircraftNode> = {
  // ---- Interceptors ----
  radar: { name: 'Radar network', branch: 'interceptors', blurb: 'Early warning radar on every coast, linked to your fighter bases.', tier: 1, requires: [], tech: 'air_propeller', money: 60, tp: 8, months: 3, effects: { fighterDefense: 0.1, hunt: 0.08 } },
  aam: { name: 'Long-range air-to-air missiles', branch: 'interceptors', blurb: 'Fighters that hit what they see long before it sees them. The test range speeds up later work.', tier: 2, requires: ['radar'], tech: 'air_propeller', money: 90, tp: 12, months: 4, effects: { fighterAttack: 0.15, speed: 0.1 } },
  hunters: { name: 'Missile-hunter fighters', branch: 'interceptors', blurb: 'Fighters built to chase down cruise and ballistic missiles and drones in flight.', tier: 2, requires: ['radar'], tech: 'air_jets', money: 160, tp: 22, months: 6, effects: { hunt: 0.25, fighterDefense: 0.05 } },
  iads: { name: 'Integrated air shield', branch: 'interceptors', blurb: 'Radar, batteries and fighters run as one net. The best answer to a missile salvo.', tier: 3, requires: ['hunters', 'aam'], tech: 'air_radar', money: 320, tp: 40, months: 9, effects: { hunt: 0.25, fighterAttack: 0.1, fighterDefense: 0.1 } },

  // ---- Stealth and electronic war ----
  coatings: { name: 'Radar-absorbing coatings', branch: 'stealth', blurb: 'Bombers that show up late on enemy radar.', tier: 1, requires: [], tech: 'air_bombers', money: 70, tp: 10, months: 4, effects: { bomberFloor: 0.1, bomberDefense: 0.1 } },
  stealthBombers: { name: 'Stealth bombers', branch: 'stealth', blurb: 'Flying wings that slip past shields and hunters to hit hard.', tier: 2, requires: ['coatings'], tech: 'air_jets', money: 180, tp: 25, months: 7, effects: { bomberAttack: 0.12, pierce: 0.15, bomberFloor: 0.1 } },
  ew: { name: 'Electronic warfare pods', branch: 'stealth', blurb: 'Jamming that blinds the radar of the enemy\'s interceptors and fighters.', tier: 2, requires: ['coatings'], tech: 'air_jets', money: 140, tp: 20, months: 6, effects: { jam: 0.2, fighterDefense: 0.05 } },
  blackout: { name: 'Blackout doctrine', branch: 'stealth', blurb: 'Jam, spoof and strike together: enemy radar sees nothing until it is too late.', tier: 3, requires: ['stealthBombers', 'ew'], tech: 'cyber_warfare', money: 520, tp: 60, months: 11, effects: { jam: 0.25, pierce: 0.2, bomberFloor: 0.1 } },

  // ---- Range and payload ----
  dropTanks: { name: 'Drop tanks and ground crews', branch: 'range', blurb: 'Fuel and spares that follow the squadrons, so a landing is less of a gamble.', tier: 1, requires: [], tech: 'air_propeller', money: 50, tp: 6, months: 3, effects: { landing: 0.15 } },
  refuel: { name: 'Aerial refuelling', branch: 'range', blurb: 'Tankers in the air. Airbases reach much farther.', tier: 2, requires: ['dropTanks'], tech: 'air_propeller', money: 130, tp: 15, months: 6, effects: { airRange: 2500, landing: 0.05 } },
  payload: { name: 'Heavy payload bays', branch: 'range', blurb: 'Bombers that carry far more, and flatten a Defense Line faster.', tier: 2, requires: ['dropTanks'], tech: 'air_bombers', money: 150, tp: 18, months: 6, effects: { bomberLine: 0.25, bomberAttack: 0.08 } },
  strategic: { name: 'Strategic bomber wing', branch: 'range', blurb: 'Long-range heavy bombers that reach across a continent and break a line.', tier: 3, requires: ['refuel', 'payload'], tech: 'air_bombers', money: 420, tp: 50, months: 10, effects: { airRange: 3500, bomberLine: 0.35, landing: 0.1, bomberAttack: 0.1 } },

  // ---- Unmanned wingmen ----
  wingmen: { name: 'Unmanned wingmen', branch: 'drones', blurb: 'Drone swarms flown alongside the pilots: stronger and tougher.', tier: 1, requires: [], tech: 'frontier_drones', money: 100, tp: 14, months: 4, effects: { droneAttack: 0.12, droneDefense: 0.1 } },
  swarm: { name: 'Swarm autonomy', branch: 'drones', blurb: 'Drones that dodge on their own, so enemy fighters hurt them less.', tier: 2, requires: ['wingmen'], tech: 'frontier_drones', money: 180, tp: 24, months: 6, effects: { droneAttack: 0.1, droneEvade: 0.35 } },
  loyal: { name: 'Loyal wingman fighters', branch: 'drones', blurb: 'Robot partners for every fighter wing. They also help hunt incoming missiles.', tier: 3, requires: ['wingmen', 'radar'], tech: 'frontier_drones', money: 300, tp: 36, months: 8, effects: { fighterAttack: 0.12, fighterDefense: 0.12, hunt: 0.08 } },
  autonomous: { name: 'Autonomous air force', branch: 'drones', blurb: 'The whole air arm networked and half unmanned. Everything gets better, and later work is faster.', tier: 4, requires: ['swarm', 'loyal'], tech: 'frontier_drones', money: 650, tp: 70, months: 12, effects: { droneAttack: 0.2, bomberAttack: 0.1, fighterAttack: 0.1, speed: 0.2 } },
}

export const AIRCRAFT_IDS = Object.keys(AIRCRAFT_NODES) as AircraftNodeId[]

/** The most a nation's developments can add up to, for the effects that could otherwise be piled up without end. */
export const AIRCRAFT_CAPS: Partial<Record<AircraftEffectKey, number>> = {
  hunt: 0.6,
  pierce: 0.5,
  jam: 0.6,
  bomberFloor: 0.4,
  airRange: 8000,
  landing: 0.6,
  bomberLine: 0.75,
  droneEvade: 0.6,
  speed: 0.5,
}

export const AIRCRAFT_RULES = {
  /** Developments in hand at once, by empire tier (Nation, Regional power, Great power, Superpower, Hegemon). */
  slots: [1, 1, 2, 2, 2],
  /** Fighters at home (in divisions) for the hunters to cover everything. A smaller wing covers a share. */
  huntWing: 3,
  /** The most that hunters can ever stop of one salvo. */
  huntMax: 0.95,
  /** How well fighters catch each kind of missile: slow low flyers most, ballistic warheads least. */
  huntVs: { cruise: 1.3, tactical: 1, hypersonic: 0.5, ballistic: 0.25, decoy: 1.3 } as Record<MissileType, number>,
  /** Bombers are this share of the force for the payload bonus to be in full. */
  bomberShareFull: 0.25,
}

/** What each effect says in plain words, for the screen. `v` is the value in the data. */
export const AIRCRAFT_EFFECT_TEXT: Record<AircraftEffectKey, (v: number) => string> = {
  fighterAttack: (v) => `Fighters attack +${Math.round(v * 100)}%`,
  fighterDefense: (v) => `Fighters defense +${Math.round(v * 100)}%`,
  bomberAttack: (v) => `Bombers attack +${Math.round(v * 100)}%`,
  bomberDefense: (v) => `Bombers defense +${Math.round(v * 100)}%`,
  droneAttack: (v) => `Drone swarms attack +${Math.round(v * 100)}%`,
  droneDefense: (v) => `Drone swarms defense +${Math.round(v * 100)}%`,
  hunt: (v) => `Fighters at home shoot down up to ${Math.round(v * 100)}% more of incoming missiles and drones`,
  pierce: (v) => `Enemy shields and hunters stop ${Math.round(v * 100)}% less of your missiles, drones and bombers`,
  bomberFloor: (v) => `Bombers keep ${Math.round(v * 100)} points more strength when the enemy rules the air`,
  jam: (v) => `Enemy interceptors and fighters ${Math.round(v * 100)}% blinded`,
  airRange: (v) => `Airbase reach +${v} km`,
  landing: (v) => `Landings by air lose ${Math.round(v * 100)}% less of their penalty`,
  bomberLine: (v) => `Attacks with many bombers push the Defense Line back ${Math.round(v * 100)}% more`,
  droneEvade: (v) => `Drones lose ${Math.round(v * 100)}% less of their strength to enemy fighters`,
  speed: (v) => `All other developments ${Math.round(v * 100)}% faster`,
}

/** The plain-words lines for a node, in the order its effects are written. */
export function aircraftLines(effects: Partial<AircraftEffects>): string[] {
  return (Object.keys(effects) as AircraftEffectKey[]).filter((k) => (effects[k] ?? 0) !== 0).map((k) => AIRCRAFT_EFFECT_TEXT[k](effects[k]!))
}
