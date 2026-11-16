import type { NationId } from '../engine/types'

/**
 * The space program. Everything the rules need is data here: rockets, missions, the bodies of the solar system, mines, the labs'
 * discoveries and the private launch companies. The engine (`engine/space.ts`) only reads these tables.
 */

export type RocketId = 'sounding' | 'orbital' | 'heavy' | 'deep' | 'interplanetary'
export type SampleKind = 'regolith' | 'martian' | 'asteroid' | 'ice' | 'exotica'
export type BodyId = 'moon' | 'asteroids' | 'mars' | 'europa'
export type MineId = 'rareMetals' | 'helium3' | 'water' | 'metals' | 'volatiles'
export type SatKind = 'comms' | 'weather' | 'recon'
export type PhaseId = 'build' | 'launch' | 'transit' | 'arrival'
export type MissionId =
  | 'sounding_test' | 'sat_comms' | 'sat_weather' | 'sat_recon' | 'crew_orbit'
  | 'lunar_probe' | 'lunar_landing' | 'outpost_moon'
  | 'asteroid_survey' | 'asteroid_return' | 'outpost_asteroids'
  | 'mars_flyby' | 'mars_lander' | 'mars_crew' | 'outpost_mars'
  | 'outer_jupiter' | 'outer_saturn' | 'europa_lander' | 'outpost_europa'
export type NodeId =
  | 'reusable' | 'methalox' | 'avionics' | 'ion_drive' | 'deep_comms' | 'life_support' | 'closed_loop'
  | 'isru' | 'propellant' | 'regolith_build' | 'asteroid_metallurgy' | 'he3_reactors' | 'automation'
  | 'composites' | 'microgravity' | 'xenobiology' | 'quantum_comms' | 'exotic_matter'

// ---- State ----

/** One flight, from the day it is ordered to the day it is over. */
export interface Mission {
  id: string
  kind: MissionId
  mode: 'house' | 'outsource'
  /** The private company that flies it, if outsourced. */
  company?: string
  /** The rocket class that flies it. */
  rocket: RocketId
  crew: number
  /** Engineers tied up in an in-house flight until it is over. */
  engineers: number
  phase: PhaseId
  /** Months left in this phase. */
  left: number
  /** Months this phase lasts in all, for the progress bar. */
  of: number
  started: number
  /** Money still to be paid, month by month, while it is built (in-house payload). */
  owed: number
  /** The odds shown when it was ordered (launch, then arrival), kept so the report can say how lucky it was. */
  odds: [number, number]
  /** The company's name, for the report. */
  by?: string
}

export interface MineState {
  level: number
  /** Months of work done on the level being built. Absent when none is. */
  building?: { progress: number }
}

export interface OutpostState {
  /** 0 until the first cargo lands, then 1 to 3. */
  level: number
  building?: { progress: number }
  mines: Partial<Record<MineId, MineState>>
  /** Months in a row the treasury could not supply it. */
  unsupplied: number
}

export interface BodyState {
  surveyed?: boolean
  landed?: boolean
  outpost?: OutpostState
}

export interface SpaceEvent {
  turn: number
  text: string
  good: boolean
}

/** A nation's space agency. Absent until the first order. */
export interface SpaceState {
  engineers: number
  astronauts: number
  /** Experience from flights it flew itself. It unlocks harder missions and makes launches safer. */
  exp: number
  /** The nation's name in space, 0 to 100. Successes raise it, failures and dead crews cost it. */
  prestige: number
  /** Rocket classes flown and certified: development level 1 to 3. */
  rockets: Partial<Record<RocketId, number>>
  dev?: { rocket: RocketId; progress: number }
  hangar: Partial<Record<RocketId, number>>
  builds: { rocket: RocketId; progress: number }[]
  /** Launch site level, 0 to 3. */
  pads: number
  padBuild?: { progress: number }
  missions: Mission[]
  /** Missions finished, by kind. */
  done: Partial<Record<MissionId, number>>
  launches: number
  failures: number
  sats: { kind: SatKind; until: number }[]
  samples: Partial<Record<SampleKind, number>>
  labs: number
  labBuild?: { progress: number }
  research: { node: NodeId; progress: number }[]
  discoveries: NodeId[]
  bodies: Partial<Record<BodyId, BodyState>>
  /** Counter for mission ids. */
  seq: number
  /** The agency's last events, newest first. */
  events: SpaceEvent[]
}

/** What the whole world knows about space: who holds each body, and how many flights have flown. */
export interface SpaceWorld {
  claims: Partial<Record<BodyId, { owner: NationId; turn: number }>>
  launches: number
}

export type SpaceAction =
  | { kind: 'hire'; role: 'engineer' | 'astronaut'; count: number }
  | { kind: 'dismiss'; role: 'engineer' | 'astronaut'; count: number }
  | { kind: 'develop'; rocket: RocketId }
  | { kind: 'build'; rocket: RocketId }
  | { kind: 'pad' }
  | { kind: 'launch'; mission: MissionId; mode: 'house' | 'outsource'; company?: string }
  | { kind: 'lab' }
  | { kind: 'research'; node: NodeId }
  | { kind: 'claim'; body: BodyId }
  | { kind: 'outpost'; body: BodyId }
  | { kind: 'mine'; body: BodyId; mine: MineId }

// ---- Rules ----

export const SPACE = {
  /** Technology a nation needs before it can start a space program. */
  tech: 'air_jets',
  salaryEngineer: 0.6,
  salaryAstronaut: 1.4,
  hireEngineer: 4,
  hireAstronaut: 14,
  /** Specialists the people can spare: a share of the workforce, weighted by engineers and scientists. */
  talentPerWork: 30,
  /** Share of the staff that is drawn from the engineers factories need. */
  engineerDraw: 0.5,
  /** A flight's engineers and its crew are tied up until it is over. */
  satLife: 72,
  /** Flights cost this many times what the same flight costs in-house, before the company's own price. */
  premium: 2.1,
  /** Outsourced builds take this share of the time. */
  outsourceBuild: 0.6,
  /** In-house flights keep this share of the experience on a failure. */
  failExp: 0.25,
  /** Experience makes launches safer, up to this much. */
  expBonus: 0.1,
  expHalf: 250,
  maxOdds: 0.97,
  minOdds: 0.25,
  /** A crewed launch that fails loses this share of its crew. */
  launchCrewLoss: 0.5,
  /** Claiming a body costs influence. */
  claimCost: 30,
  /** A claim with no outpost on it lapses after this many months, so a nation cannot sit on worlds it never settles. */
  claimMonths: 60,
  /** Discoveries stack, but not past these ceilings (a share each). */
  discoveryCap: { mining: 0.5, output: 0.04 } as Record<string, number>,
  /** Months of lacking money before an outpost loses a level. */
  starveMonths: 4,
  /** The world's space industry: grows with time and every flight. It makes private companies better and cheaper. */
  industryPerMonth: 0.35,
  industryPerLaunch: 1.2,
  industryHalf: 80,
  salt: 0x5a9ce,
}

export interface RocketSpec {
  name: string
  blurb: string
  /** Order of the classes: 1 sounding to 5 interplanetary. */
  rank: number
  /** Money to develop level 1, and months. Levels 2 and 3 cost `levelCost` times as much and take `levelTime`. */
  dev: number
  devMonths: number
  /** Money to build one rocket and the months it takes, and steel. */
  cost: number
  months: number
  steel: number
  /** Launch odds at development level 1; each level after adds `perLevel`. */
  reliability: number
  /** Launch site level needed. */
  pad: number
  /** Engineers needed to develop it. */
  engineers: number
}

export const ROCKETS: Record<RocketId, RocketSpec> = {
  sounding: { name: 'Sounding rocket', blurb: 'A small suborbital rocket. It proves the engineers and the pad, and carries instruments past the sky.', rank: 1, dev: 60, devMonths: 4, cost: 8, months: 1, steel: 2, reliability: 0.84, pad: 1, engineers: 3 },
  orbital: { name: 'Orbital launcher', blurb: 'Puts satellites and crews into orbit.', rank: 2, dev: 220, devMonths: 8, cost: 30, months: 2, steel: 6, reliability: 0.76, pad: 1, engineers: 6 },
  heavy: { name: 'Heavy-lift rocket', blurb: 'Reaches the Moon with a lander and carries the first cargo to another world.', rank: 3, dev: 520, devMonths: 12, cost: 80, months: 3, steel: 15, reliability: 0.7, pad: 2, engineers: 12 },
  deep: { name: 'Deep-space rocket', blurb: 'Upper stages for months in the dark: asteroids, Mars flybys and the first heavy probes.', rank: 4, dev: 900, devMonths: 16, cost: 130, months: 4, steel: 25, reliability: 0.66, pad: 2, engineers: 20 },
  interplanetary: { name: 'Interplanetary rocket', blurb: 'The biggest thing a nation can build. Mars, the outer planets and the moons of Jupiter.', rank: 5, dev: 1500, devMonths: 20, cost: 220, months: 5, steel: 40, reliability: 0.62, pad: 3, engineers: 32 },
}
export const ROCKET_IDS = Object.keys(ROCKETS) as RocketId[]
export const ROCKET_RULES = {
  maxLevel: 3,
  perLevel: 0.04,
  /** Levels 2 and 3 cost and take this share of level 1. */
  levelCost: [0, 1, 0.7, 0.9],
  levelTime: [0, 1, 0.8, 0.9],
}

export const PAD = {
  max: 3,
  cost: [0, 90, 220, 480],
  months: [0, 6, 10, 14],
  upkeep: [0, 2, 4, 7],
  /** Pad level 3 needs the national space launch complex project. */
  complexLevel: 3,
}

export const LABS = {
  max: 3,
  cost: [0, 140, 300, 560],
  tp: [0, 12, 30, 60],
  months: [0, 6, 10, 14],
  upkeep: [0, 3, 6, 10],
  /** Research speed by lab level. */
  speed: [0, 1, 1.2, 1.4],
}

export interface CompanySpec {
  name: string
  blurb: string
  /** The nation it is based in. Money paid to it feeds that nation's technology business. */
  home: NationId | null
  /** Price against the usual premium, and launch reliability before the sector grows. */
  price: number
  reliability: number
  /** The heaviest rocket class it flies at first, how far it can grow, and the sector size that opens each step. */
  baseClass: number
  maxClass: number
  step: number
  /** Sector size needed before the company exists. */
  minIndustry: number
  /** Better than most at deep space: added to arrival odds there. */
  deep?: number
}

export const COMPANIES: Record<string, CompanySpec> = {
  meridian: { name: 'Meridian Launch', blurb: 'Cheap and quick, and a little careless. Good for small satellites.', home: 'united-states-of-america', price: 0.85, reliability: 0.72, baseClass: 2, maxClass: 3, step: 60, minIndustry: 0 },
  apex: { name: 'Apex Orbital', blurb: 'A steady all-rounder with a record of boring, successful launches.', home: 'france', price: 1, reliability: 0.8, baseClass: 2, maxClass: 4, step: 45, minIndustry: 0 },
  titan: { name: 'Titan Aerospace Group', blurb: 'Heavy lifters at a premium price. They have flown cargo to the Moon.', home: 'russia', price: 1.35, reliability: 0.86, baseClass: 3, maxClass: 5, step: 40, minIndustry: 20 },
  helios: { name: 'Helios Deep Space', blurb: 'Specialists in the long road out: asteroids, Mars and beyond. Dear, and worth it.', home: 'india', price: 1.55, reliability: 0.83, baseClass: 4, maxClass: 5, step: 50, minIndustry: 45, deep: 0.05 },
}
/** A nation with a technology sector of this size has a private space firm of its own. */
export const DOMESTIC = { id: 'domestic', sector: 1.2, price: 0.9, reliability: 0.78, baseClass: 2, maxClass: 4, step: 50, share: 0.15, abroadShare: 0.06 }

export interface MissionSpec {
  name: string
  blurb: string
  rocket: RocketId
  crew: number
  engineers: number
  /** Money for the payload, paid over the months it is built. */
  payload: number
  /** Months: build, launch, transit, arrival (the work out there, and the way home). */
  months: [number, number, number, number]
  /** Odds that the voyage ends well once it has launched. */
  arrival: number
  /** In-house experience needed, and gained. */
  exp: number
  gain: number
  /** Missions that must have been flown before (by anyone you hired). */
  requires: MissionId[]
  /** Samples brought home. */
  samples?: Partial<Record<SampleKind, number>>
  /** A satellite that joins the sky. */
  sat?: SatKind
  /** What the flight does to a body. */
  body?: BodyId
  stage?: 'survey' | 'landing' | 'outpost'
  /** One-off research and prestige. */
  tp?: number
  prestige: number
  /** Where it sits on the ladder, for the list. */
  group: 'Test' | 'Satellites' | 'Crews' | 'Moon' | 'Asteroids' | 'Mars' | 'Outer planets'
}

export const MISSIONS: Record<MissionId, MissionSpec> = {
  sounding_test: { name: 'Suborbital test flight', blurb: 'A sounding rocket past the sky and back. The first thing any agency flies.', rocket: 'sounding', crew: 0, engineers: 2, payload: 6, months: [1, 1, 0, 0], arrival: 0.96, exp: 0, gain: 10, requires: [], tp: 4, prestige: 1, group: 'Test' },
  sat_comms: { name: 'Communications satellite', blurb: 'Relays for every call and shipment. Trade and research grow.', rocket: 'orbital', crew: 0, engineers: 4, payload: 28, months: [3, 1, 1, 0], arrival: 0.93, exp: 10, gain: 20, requires: ['sounding_test'], sat: 'comms', prestige: 2, group: 'Satellites' },
  sat_weather: { name: 'Weather satellite', blurb: 'Storms and droughts seen coming. Calmer harvests and a steadier country.', rocket: 'orbital', crew: 0, engineers: 4, payload: 26, months: [3, 1, 1, 0], arrival: 0.93, exp: 15, gain: 20, requires: ['sounding_test'], sat: 'weather', prestige: 2, group: 'Satellites' },
  sat_recon: { name: 'Reconnaissance satellite', blurb: 'Eyes on your enemies. Intelligence on every country you fight, and influence from knowing.', rocket: 'orbital', crew: 0, engineers: 5, payload: 40, months: [4, 1, 1, 0], arrival: 0.92, exp: 20, gain: 25, requires: ['sounding_test'], sat: 'recon', prestige: 2, group: 'Satellites' },
  crew_orbit: { name: 'Crewed orbital flight', blurb: 'The first people in orbit. A nation holds its breath.', rocket: 'orbital', crew: 2, engineers: 8, payload: 70, months: [5, 1, 1, 2], arrival: 0.86, exp: 50, gain: 50, requires: ['sat_comms'], prestige: 10, tp: 6, group: 'Crews' },
  lunar_probe: { name: 'Lunar probe', blurb: 'A robot lander on the Moon that brings a handful of rock home.', rocket: 'heavy', crew: 0, engineers: 10, payload: 110, months: [5, 1, 3, 3], arrival: 0.84, exp: 80, gain: 45, requires: ['sat_comms'], samples: { regolith: 2 }, body: 'moon', stage: 'survey', prestige: 5, group: 'Moon' },
  lunar_landing: { name: 'Crewed lunar landing', blurb: 'People on the Moon, and back. The nation that does it first is remembered.', rocket: 'heavy', crew: 2, engineers: 14, payload: 220, months: [8, 1, 3, 4], arrival: 0.72, exp: 140, gain: 90, requires: ['lunar_probe', 'crew_orbit'], samples: { regolith: 5 }, body: 'moon', stage: 'landing', prestige: 18, tp: 10, group: 'Moon' },
  outpost_moon: { name: 'Lunar outpost cargo', blurb: 'Habitat modules and a power plant delivered to a claimed Moon. The first level of an outpost.', rocket: 'heavy', crew: 0, engineers: 14, payload: 300, months: [8, 1, 3, 3], arrival: 0.8, exp: 160, gain: 60, requires: ['lunar_landing'], body: 'moon', stage: 'outpost', prestige: 6, group: 'Moon' },
  asteroid_survey: { name: 'Asteroid survey', blurb: 'A probe that flies alongside a metal asteroid and takes a sample.', rocket: 'deep', crew: 0, engineers: 12, payload: 170, months: [7, 1, 8, 4], arrival: 0.78, exp: 120, gain: 55, requires: ['lunar_probe'], samples: { asteroid: 2 }, body: 'asteroids', stage: 'survey', prestige: 5, group: 'Asteroids' },
  asteroid_return: { name: 'Asteroid sample return', blurb: 'A lander that grips a tumbling rock and brings a piece back.', rocket: 'deep', crew: 0, engineers: 16, payload: 260, months: [10, 1, 10, 6], arrival: 0.7, exp: 200, gain: 90, requires: ['asteroid_survey'], samples: { asteroid: 6 }, body: 'asteroids', stage: 'landing', prestige: 9, group: 'Asteroids' },
  outpost_asteroids: { name: 'Asteroid outpost cargo', blurb: 'A mining base for a claimed asteroid.', rocket: 'deep', crew: 0, engineers: 18, payload: 380, months: [10, 1, 10, 3], arrival: 0.72, exp: 260, gain: 70, requires: ['asteroid_return'], body: 'asteroids', stage: 'outpost', prestige: 6, group: 'Asteroids' },
  mars_flyby: { name: 'Mars flyby', blurb: 'A probe that sweeps past the red planet and sends back every picture it can.', rocket: 'deep', crew: 0, engineers: 14, payload: 200, months: [8, 1, 9, 2], arrival: 0.8, exp: 180, gain: 70, requires: ['lunar_probe'], body: 'mars', stage: 'survey', prestige: 7, group: 'Mars' },
  mars_lander: { name: 'Mars lander', blurb: 'A robot on the surface: soil, ice and the first real answers.', rocket: 'interplanetary', crew: 0, engineers: 20, payload: 380, months: [10, 1, 9, 6], arrival: 0.66, exp: 280, gain: 120, requires: ['mars_flyby'], samples: { martian: 4, ice: 2 }, body: 'mars', stage: 'landing', prestige: 12, group: 'Mars' },
  mars_crew: { name: 'Crewed Mars landing', blurb: 'The longest journey anyone has made. They must come home.', rocket: 'interplanetary', crew: 4, engineers: 28, payload: 700, months: [14, 1, 9, 10], arrival: 0.6, exp: 420, gain: 220, requires: ['mars_lander', 'lunar_landing'], samples: { martian: 8, ice: 5 }, body: 'mars', stage: 'landing', prestige: 30, tp: 20, group: 'Mars' },
  outpost_mars: { name: 'Mars outpost cargo', blurb: 'Habitats, reactors and a mining rig for a claimed Mars.', rocket: 'interplanetary', crew: 0, engineers: 26, payload: 700, months: [12, 1, 9, 3], arrival: 0.68, exp: 380, gain: 120, requires: ['mars_lander'], body: 'mars', stage: 'outpost', prestige: 8, group: 'Mars' },
  outer_jupiter: { name: 'Jupiter probe', blurb: 'Years of flight to the giant planet and its icy moons.', rocket: 'interplanetary', crew: 0, engineers: 18, payload: 330, months: [10, 1, 18, 4], arrival: 0.68, exp: 330, gain: 110, requires: ['mars_flyby'], samples: { exotica: 2, ice: 2 }, body: 'europa', stage: 'survey', prestige: 10, group: 'Outer planets' },
  outer_saturn: { name: 'Saturn probe', blurb: 'A decade-long flight to the rings. What it finds has no name yet.', rocket: 'interplanetary', crew: 0, engineers: 22, payload: 420, months: [12, 1, 26, 4], arrival: 0.64, exp: 450, gain: 150, requires: ['outer_jupiter'], samples: { exotica: 4 }, prestige: 14, group: 'Outer planets' },
  europa_lander: { name: 'Europa lander', blurb: 'A machine that sets down on the ice over a hidden ocean.', rocket: 'interplanetary', crew: 0, engineers: 26, payload: 600, months: [14, 1, 22, 10], arrival: 0.55, exp: 520, gain: 200, requires: ['outer_jupiter', 'mars_lander'], samples: { exotica: 4, ice: 6 }, body: 'europa', stage: 'landing', prestige: 20, group: 'Outer planets' },
  outpost_europa: { name: 'Europa outpost cargo', blurb: 'A base on the ice, as far from home as a nation has ever built.', rocket: 'interplanetary', crew: 0, engineers: 30, payload: 1100, months: [16, 1, 22, 3], arrival: 0.58, exp: 600, gain: 160, requires: ['europa_lander'], body: 'europa', stage: 'outpost', prestige: 10, group: 'Outer planets' },
}
export const MISSION_IDS = Object.keys(MISSIONS) as MissionId[]

export interface BodySpec {
  name: string
  blurb: string
  /** How far and how hard: multiplies the price of outposts and mines. */
  distance: number
  /** How rich its ground is. */
  richness: number
  mines: MineId[]
  /** Research an outpost level brings in each month. */
  research: number
}

export const BODIES: Record<BodyId, BodySpec> = {
  moon: { name: 'The Moon', blurb: 'Three days away. Poles with ice, a surface full of helium-3, and nobody to argue with.', distance: 1, richness: 0.9, mines: ['rareMetals', 'helium3', 'water'], research: 0.5 },
  asteroids: { name: 'Asteroids', blurb: 'Flying mountains of iron and platinum, months from home and with almost no gravity to climb out of.', distance: 1.5, richness: 1.4, mines: ['metals', 'rareMetals'], research: 0.4 },
  mars: { name: 'Mars', blurb: 'Soil, ice, an old riverbed and a sky of dust. The only other world a settlement could grow on.', distance: 2, richness: 1.9, mines: ['metals', 'water', 'rareMetals'], research: 0.8 },
  europa: { name: 'Europa', blurb: 'An ocean under the ice of a moon of Jupiter. The farthest place anyone will build.', distance: 3, richness: 2.1, mines: ['water', 'volatiles'], research: 1.2 },
}
export const BODY_IDS = Object.keys(BODIES) as BodyId[]

/** Outposts: three levels, the first delivered by cargo and the others built with money. */
export const OUTPOST = {
  max: 3,
  names: ['Not founded', 'Outpost', 'Station', 'Colony'],
  /** Money and months to raise an outpost to level 2 and 3, before the body's distance. */
  cost: [0, 0, 260, 480],
  months: [0, 0, 14, 20],
  /** Upkeep a month for each level, before distance. */
  upkeep: 1.6,
  /** Stability a colony gives at home, and what it adds to growth. */
  colonyStability: 1.5,
  /** Space experience needed to raise it to level 2 and 3. */
  exp: [0, 0, 220, 450],
}

export interface MineSpec {
  name: string
  blurb: string
  /** Money for level 1 before the body's distance, and months. */
  cost: number
  months: number
  /** Space experience needed. */
  exp: number
  /** What level 1 gives each month, before the body's richness. */
  steel?: number
  oil?: number
  money?: number
  /** Helium-3: money, grid power, and (with a fusion plant) output. */
  he3?: number
  /** Share of every upkeep the nation pays that the water saves. */
  water?: number
}

export const MINES: Record<MineId, MineSpec> = {
  rareMetals: { name: 'Rare-metal mine', blurb: 'Platinum and rare earths, sold at home for hard money.', cost: 360, months: 24, exp: 160, money: 12 },
  helium3: { name: 'Helium-3 mine', blurb: 'Fuel for fusion. Feeds the grid, and a national fusion plant multiplies it.', cost: 420, months: 26, exp: 200, he3: 1, money: 14 },
  water: { name: 'Water-ice mine', blurb: 'Drinking water, air and rocket fuel. Cuts what the space program costs to keep, and makes some oil.', cost: 300, months: 20, exp: 120, water: 0.12, oil: 7 },
  metals: { name: 'Metal mine', blurb: 'Iron, nickel and cobalt in the quantities of a factory district. A substitute for steel.', cost: 340, months: 22, exp: 140, steel: 6.5 },
  volatiles: { name: 'Volatiles plant', blurb: 'Methane and ammonia from the ice. A substitute for oil.', cost: 380, months: 24, exp: 240, oil: 9, money: 3 },
}
export const MINE_IDS = Object.keys(MINES) as MineId[]
/** Mines can be raised to three levels, each costing and taking more and giving more, but not in proportion. */
export const MINE_LEVELS = { max: 3, cost: [0, 1, 1.6, 2.4], months: [0, 1, 1.2, 1.4], power: [0, 1, 1.6, 2] }
/** Upkeep of finished mines and outposts a month, as a share of all that has been put in. */
export const SPACE_UPKEEP = 0.009
/** Fusion plant bonus per unit of helium-3 power. */
export const HE3 = { power: 5, output: 0.008, factory: 0.012 }

/** What a discovery changes. Each is a share unless noted. */
export interface NodeEffect {
  /** More reliable launches (flat odds). */
  reliability?: number
  /** Rockets cost less (negative). */
  rocketCost?: number
  /** Rocket development and building go this much faster. */
  buildSpeed?: number
  /** Transit takes this much less time (negative). */
  transit?: number
  /** Upkeep of the agency, outposts and mines (negative). */
  upkeep?: number
  /** Mines give more. */
  mining?: number
  /** Outposts cost less to raise (negative). */
  outpostCost?: number
  /** The people can spare more staff. */
  talent?: number
  /** Crews survive the arrival more often (flat odds). */
  crew?: number
  /** Spillovers at home. */
  output?: number
  research?: number
  stability?: number
  factory?: number
  trade?: number
  growth?: number
  foodUse?: number
  influence?: number
  health?: number
  /** A technology the nation learns, if it does not know it. */
  grantsTech?: string
}

export interface NodeSpec {
  name: string
  blurb: string
  group: 'Rockets' | 'Life support' | 'Mining' | 'Spillover'
  /** Lab level needed. */
  lab: number
  months: number
  /** Money (over the months), research (at once) and samples (at once). */
  money: number
  tp: number
  samples?: Partial<Record<SampleKind, number>>
  requires: NodeId[]
  effect: NodeEffect
  /** One line that says what it does. */
  says: string
}

export const NODES: Record<NodeId, NodeSpec> = {
  reusable: { name: 'Reusable boosters', blurb: 'Stages that land themselves and fly again.', group: 'Rockets', lab: 1, months: 8, money: 90, tp: 10, requires: [], effect: { rocketCost: -0.12 }, says: 'Rockets cost 12% less to build.' },
  avionics: { name: 'Flight computers', blurb: 'Redundant avionics and a lot of testing.', group: 'Rockets', lab: 1, months: 6, money: 70, tp: 8, requires: [], effect: { reliability: 0.03 }, says: 'Launches 3 points more reliable.' },
  methalox: { name: 'Methalox engines', blurb: 'Cleaner, cheaper engines that restart in space.', group: 'Rockets', lab: 2, months: 10, money: 150, tp: 20, requires: ['reusable'], effect: { reliability: 0.02, buildSpeed: 0.15, rocketCost: -0.08 }, says: 'Launches 2 points more reliable, rockets 8% cheaper and built 15% faster.' },
  ion_drive: { name: 'Ion drives', blurb: 'Thrust for months instead of minutes.', group: 'Rockets', lab: 2, months: 12, money: 190, tp: 26, samples: { asteroid: 1 }, requires: ['avionics'], effect: { transit: -0.2 }, says: 'Voyages take 20% less time.' },
  deep_comms: { name: 'Deep space network', blurb: 'Dishes on three continents to hear a spacecraft a billion kilometres away.', group: 'Rockets', lab: 2, months: 10, money: 160, tp: 24, requires: ['avionics'], effect: { reliability: 0.03 }, says: 'Launches 3 points more reliable, and the odds of arrival a little better.' },
  life_support: { name: 'Closed-loop life support', blurb: 'Recycle every drop of water and breath.', group: 'Life support', lab: 1, months: 9, money: 110, tp: 14, samples: { regolith: 1 }, requires: [], effect: { upkeep: -0.12, crew: 0.04 }, says: 'Agency and outpost upkeep 12% less, crews 4 points safer.' },
  closed_loop: { name: 'Bioregenerative habitats', blurb: 'Gardens that feed a colony and clean its air.', group: 'Life support', lab: 3, months: 14, money: 260, tp: 40, samples: { martian: 2, ice: 1 }, requires: ['life_support'], effect: { upkeep: -0.15, outpostCost: -0.15, crew: 0.04, stability: 0.5 }, says: 'Upkeep 15% less, outposts 15% cheaper, crews 4 points safer, calmer at home.' },
  isru: { name: 'In-situ resource use', blurb: 'Make bricks, air and fuel from the ground you stand on.', group: 'Mining', lab: 1, months: 10, money: 130, tp: 16, samples: { regolith: 2 }, requires: [], effect: { mining: 0.15, outpostCost: -0.1 }, says: 'Opens mining. Mines give 15% more and outposts cost 10% less.' },
  propellant: { name: 'Propellant from ice', blurb: 'Split water into fuel on the way, so rockets need not carry it.', group: 'Mining', lab: 2, months: 12, money: 180, tp: 24, samples: { ice: 2 }, requires: ['isru'], effect: { rocketCost: -0.1, mining: 0.1, buildSpeed: 0.1 }, says: 'Rockets 10% cheaper and built 10% faster, mines 10% richer.' },
  regolith_build: { name: 'Regolith construction', blurb: 'Printers that build with dust.', group: 'Mining', lab: 2, months: 12, money: 170, tp: 22, samples: { regolith: 3 }, requires: ['isru'], effect: { outpostCost: -0.15, factory: 0.02 }, says: 'Outposts 15% cheaper and factories 2% better from the new methods.' },
  asteroid_metallurgy: { name: 'Asteroid metallurgy', blurb: 'Refine a mountain of metal in vacuum.', group: 'Mining', lab: 2, months: 14, money: 220, tp: 30, samples: { asteroid: 3 }, requires: ['isru'], effect: { mining: 0.2, factory: 0.03 }, says: 'Mines give 20% more, factories 3% better.' },
  he3_reactors: { name: 'Helium-3 reactors', blurb: 'Reactors that burn what the Moon can give.', group: 'Mining', lab: 3, months: 16, money: 300, tp: 44, samples: { regolith: 3, exotica: 1 }, requires: ['isru'], effect: { mining: 0.1, output: 0.01 }, says: 'Mines 10% richer and the whole economy a point better.' },
  automation: { name: 'Remote mining', blurb: 'Machines that work through the dark without a crew.', group: 'Mining', lab: 3, months: 14, money: 260, tp: 36, samples: { asteroid: 2, martian: 2 }, requires: ['asteroid_metallurgy'], effect: { upkeep: -0.1, mining: 0.15 }, says: 'Upkeep 10% less, mines 15% richer.' },
  composites: { name: 'Advanced composites', blurb: 'Fibres and alloys born of the rocket programs, now in every factory.', group: 'Spillover', lab: 1, months: 9, money: 100, tp: 14, samples: { regolith: 1 }, requires: [], effect: { output: 0.015, factory: 0.02 }, says: 'Whole economy +1.5%, factories +2%.' },
  microgravity: { name: 'Microgravity medicine', blurb: 'What crews learn about bones, blood and ageing.', group: 'Spillover', lab: 2, months: 12, money: 170, tp: 26, requires: ['life_support'], effect: { health: 0.025, grantsTech: 'med_surgery' }, says: 'Health +0.025, and you learn Modern Surgery if you did not know it.' },
  xenobiology: { name: 'Xenobiology', blurb: 'Soil and ice from another world, and whatever lives in them.', group: 'Spillover', lab: 3, months: 14, money: 240, tp: 38, samples: { martian: 3, ice: 2 }, requires: ['microgravity'], effect: { foodUse: -0.04, health: 0.02, growth: 0.04 }, says: 'People waste 4% less food, health +0.02, business grows faster.' },
  quantum_comms: { name: 'Quantum communications', blurb: 'Messages that cannot be read, to ships that cannot be reached.', group: 'Spillover', lab: 3, months: 14, money: 280, tp: 42, samples: { exotica: 2 }, requires: ['deep_comms'], effect: { research: 0.06, trade: 0.1 }, says: 'Research +6%, trade capacity +10%.' },
  exotic_matter: { name: 'Exotic matter', blurb: 'A substance the textbooks do not list. It rewrites what a material can be.', group: 'Spillover', lab: 3, months: 18, money: 400, tp: 60, samples: { exotica: 4 }, requires: ['composites', 'quantum_comms'], effect: { output: 0.02, stability: 1, influence: 0.3, grantsTech: 'frontier_nano' }, says: 'Output +2%, stability +1, influence, and you learn Nanotechnology if you did not know it.' },
}
export const NODE_IDS = Object.keys(NODES) as NodeId[]

export const SAMPLE_NAMES: Record<SampleKind, string> = { regolith: 'Lunar regolith', martian: 'Martian soil', asteroid: 'Asteroid metal', ice: 'Ice cores', exotica: 'Exotica' }
export const SAT_NAMES: Record<SatKind, string> = { comms: 'Communications', weather: 'Weather', recon: 'Reconnaissance' }
export const SAT_EFFECT: Record<SatKind, { trade?: number; research?: number; stability?: number; foodUse?: number; influence?: number; says: string }> = {
  comms: { trade: 0.05, research: 0.015, says: 'Trade capacity +5%, research +1.5%' },
  weather: { stability: 0.8, foodUse: -0.015, says: 'Stability +0.8, people waste 1.5% less food' },
  recon: { influence: 0.12, says: 'Sees every enemy you fight, influence +0.12 a month' },
}
/** A second satellite of a kind adds this much of the first. A level of Orbital Network adds this much to what satellites do. */
export const SAT_RULES = { second: 0.6, perOrbitalLevel: 0.25, orbitalOdds: 0.02 }
