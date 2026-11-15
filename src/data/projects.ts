import type { ProjectId, ResearchTrack, SectorId, Tier } from '../engine/types'

export interface ProjectSpec {
  name: string
  blurb: string
  /** One line: what it does once built. */
  effect: string
  tier: Tier
  months: number
  /** Total money, paid month by month while it is built. */
  cost: number
  coastal?: boolean
}

export const PROJECTS: Record<ProjectId, ProjectSpec> = {
  rail: { name: 'Rail network', blurb: 'High-speed lines between every city.', effect: 'Factories +6%, food +5%, trade +10%, Defense Lines heal faster.', tier: 1, months: 8, cost: 320 },
  grid: { name: 'Power grid', blurb: 'A national grid and new plants.', effect: 'Power for big industry, output +3%, Frontier system upkeep -25%.', tier: 1, months: 10, cost: 400 },
  ports: { name: 'Deep-water ports', blurb: 'Container terminals for the largest ships.', effect: 'Trade capacity +30%, port income +25%, warships cost 15% less to keep.', tier: 2, months: 10, cost: 450, coastal: true },
  sciencePark: { name: 'Science park', blurb: 'Labs, startups and universities side by side.', effect: 'Research +12%, schools specialize twice as fast.', tier: 2, months: 12, cost: 500 },
  medCentre: { name: 'Medical research centre', blurb: 'A great teaching hospital and its labs.', effect: 'Health +0.05, faster recovery from epidemics, unlocks the last medicine research.', tier: 2, months: 12, cost: 480 },
  digitalGov: { name: 'Digital government', blurb: 'Every service online, every record in one place.', effect: 'Administration capacity +4, taxes +3%.', tier: 3, months: 10, cost: 600 },
  spaceComplex: { name: 'Space launch complex', blurb: 'A spaceport and its factories.', effect: 'Orbital Network costs 30% less, orbital strikes recharge 3 months sooner, research +5%.', tier: 3, months: 16, cost: 900 },
}

export const PROJECT_IDS = Object.keys(PROJECTS) as ProjectId[]

export const PROJECT_RULES = {
  /** A finished project costs this share of its price each month to keep up. */
  maintenance: 0.01,
  /** Public works speed projects up or slow them down this much per level from standard. */
  worksSpeed: 0.1,
}

/** Public works, per level above or below standard: building upkeep scales with the level. */
export const WORKS = {
  trade: 0.05,
  factory: 0.03,
  heal: 0.1,
  buildCost: 0.03,
}

/** State enterprises: buying, seizing and selling a business sector. */
export const ENTERPRISE = {
  buyPerSize: 10,
  sellPerSize: 7,
  seizeStability: 8,
  seizeMonths: 24,
  /** Business distrust after a seizure: how much slower everything grows. */
  seizeClimate: 0.15,
  /** Share of the sector's profit the state keeps (a little more for command economies), and how fast a state sector grows. */
  efficiency: 0.65,
  commandEfficiency: 0.8,
  growth: 0.5,
}

/** How big a sector can grow depends on the people: which skill it needs most, and the share that counts as normal. */
export const INDUSTRY_SKILLS: Partial<Record<SectorId, { skill: 'engineers' | 'scientists' | 'skilled'; reference: number }>> = {
  technology: { skill: 'scientists', reference: 0.02 },
  arms: { skill: 'engineers', reference: 0.035 },
  finance: { skill: 'skilled', reference: 0.3 },
  manufacturing: { skill: 'engineers', reference: 0.035 },
}

export const INDUSTRY = {
  /** The sector cap moves between these multiples with the people's skills. */
  min: 0.7,
  max: 1.3,
  /** Factories need power past this many: energy, oil and the grid supply it. */
  powerFree: 20,
  powerPerFactory: 0.5,
  powerPerEnergy: 3,
  powerPerOil: 0.5,
  powerGrid: 20,
  powerFloor: 0.8,
}

export const ACADEMY = {
  /** Money to raise the academy one level, and its upkeep each month per level. */
  cost: [150, 300, 500],
  upkeep: 3,
  /** Schooling needed for each level. */
  schooling: [0.35, 0.5, 0.65],
  /** Paid drill costs less, and the combined arms bonus grows, with each level. */
  drillDiscount: 0.15,
  combinedArms: 0.03,
}

export const ARMS_EXPORTS = {
  /** Income per size of the arms sector a month, to friends or to anyone, capped at a share of gross. */
  perSize: 3,
  anyone: 1.6,
  cap: 0.1,
  /** Selling to anyone costs reputation; selling to friends wins goodwill. */
  infamy: 0.3,
  opinion: 1,
  growth: 0.006,
}

export const RESEARCH_PROGRAMS: Record<ResearchTrack, { name: string; blurb: string; perLevel: string }> = {
  productivity: { name: 'Productivity', blurb: 'Automation and better management everywhere.', perLevel: 'Output +1.5% a level' },
  medicine: { name: 'Medicine', blurb: 'Longer lives and healthier families.', perLevel: 'Health +0.01 and faster population growth a level' },
  weapons: { name: 'Weapons', blurb: 'Better guns, armor and electronics for every unit.', perLevel: 'Attack and defense +2% a level' },
}

export const PROGRAM_RULES = {
  maxLevel: 10,
  baseCost: 300,
  growth: 1.4,
  output: 0.015,
  health: 0.01,
  growthPop: 0.00005,
  weapons: 0.02,
}

/** Research points for the next level of a program. */
export const programCost = (level: number) => Math.round(PROGRAM_RULES.baseCost * Math.pow(PROGRAM_RULES.growth, level))

/** What a commander's trait does in battle and on the march. */
export const GENERAL_TRAITS = {
  mountaineer: { name: 'Mountain fighter', blurb: 'Attacks in the mountains without the usual penalty, and 10% harder.', mountain: 0.1 },
  logistician: { name: 'Logistics', blurb: 'Armies march 20% faster and cost 5% less to keep.', march: 0.8, upkeep: -0.05 },
  blitz: { name: 'Blitz', blurb: 'A Blitz pushes the Defense Line 15% further.', blitz: 0.15 },
  air_marshal: { name: 'Air marshal', blurb: 'Fighters and strike aircraft hit 10% harder.', air: 0.1 },
  stalwart: { name: 'Stalwart', blurb: 'Your armies defend 8% better.', defense: 0.08 },
}
