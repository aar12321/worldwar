import type { ImmigrationPolicy, SchoolFocus, SchoolStage, SkillKey, Spending, SpendingKey } from '../engine/types'

export const SKILL_LABELS: Record<SkillKey, string> = {
  basic: 'Basic workers',
  skilled: 'Skilled workers',
  engineers: 'Engineers',
  doctors: 'Doctors',
  scientists: 'Scientists',
}

/** Standard spending: what every nation starts with and what the old balance assumed. */
export const STANDARD_SPENDING: Spending = { schools: 2, health: 2, works: 2, pensions: 1, jobless: 1, housing: 1 }

export interface SpendingSpec {
  name: string
  max: number
  /** Names of the levels, from 0. */
  levels: string[]
  blurb: string
}

export const SPENDING: Record<SpendingKey, SpendingSpec> = {
  schools: { name: 'Schools', max: 4, levels: ['None', 'Low', 'Standard', 'High', 'Lavish'], blurb: 'How fast the people learn, and how far.' },
  health: { name: 'Health care', max: 4, levels: ['None', 'Low', 'Standard', 'High', 'Lavish'], blurb: 'Longer, healthier lives, growing families, calmer streets.' },
  works: { name: 'Public works', max: 4, levels: ['None', 'Low', 'Standard', 'High', 'Lavish'], blurb: 'Roads, power and upkeep for every building. Low levels let factories, trade and projects slip.' },
  pensions: { name: 'Pensions', max: 2, levels: ['Off', 'Basic', 'Generous'], blurb: 'The old are cared for: stability, and an easier election.' },
  jobless: { name: 'Jobless support', max: 2, levels: ['Off', 'Basic', 'Generous'], blurb: 'Softens the anger of unemployment. Generous support also retrains people.' },
  housing: { name: 'Housing', max: 2, levels: ['Off', 'Basic', 'Generous'], blurb: 'Homes for families: health, growth and calm.' },
}

/** Money each level costs a month, for each unit of workforce. Public works is priced from building upkeep instead. */
export const SPENDING_COST = {
  schools: 0.05,
  health: 0.05,
  pensions: 0.035,
  /** Per unemployed worker, per level. */
  jobless: 0.6,
  housing: 0.03,
}

export const STAGES: Record<SchoolStage, { name: string; blurb: string; cap: number; speed: number; cost: number }> = {
  primary: { name: 'Primary', blurb: 'Reading, writing and numbers for everyone. Quick, but goes only so far.', cap: 0.55, speed: 1.2, cost: 0.8 },
  secondary: { name: 'Secondary', blurb: 'High schools and trade schools. The usual choice.', cap: 0.78, speed: 1, cost: 1 },
  university: { name: 'University', blurb: 'Degrees for many. Slow and dear, but it raises the most scientists and engineers.', cap: 0.96, speed: 0.8, cost: 1.3 },
}

export const FOCUSES: Record<SchoolFocus, { name: string; blurb: string; skill: SkillKey | null }> = {
  balanced: { name: 'Balanced', blurb: 'A little of everything. No specialization.', skill: null },
  trades: { name: 'Trades', blurb: 'Skilled workers for every factory and port. Productivity rises.', skill: 'skilled' },
  engineering: { name: 'Engineering', blurb: 'Engineers for factories, Frontier systems and national projects.', skill: 'engineers' },
  medicine: { name: 'Medicine', blurb: 'Doctors for hospitals, epidemics and the wounded.', skill: 'doctors' },
  science: { name: 'Science', blurb: 'Scientists for universities and research.', skill: 'scientists' },
  business: { name: 'Business', blurb: 'Managers and bankers: businesses grow faster and finance can grow bigger.', skill: 'skilled' },
}

export const IMMIGRATION: Record<ImmigrationPolicy, { name: string; blurb: string; inflow: number; professionals: number; stability: number }> = {
  closed: { name: 'Closed', blurb: 'Nobody comes in. People may still leave.', inflow: 0, professionals: 0, stability: 0 },
  normal: { name: 'Normal', blurb: 'People come and go as life pulls them.', inflow: 1, professionals: 0, stability: 0 },
  selective: { name: 'Selective', blurb: 'Fewer people, but engineers, doctors and scientists first.', inflow: 0.6, professionals: 1, stability: 0 },
  open: { name: 'Open', blurb: 'Everyone is welcome. More workers, but some unease.', inflow: 1.8, professionals: 0, stability: -2 },
}

export const PEOPLE = {
  /** Schooling closes this share of its gap to the target each month: about half in two years. */
  schoolingRate: 0.028,
  /** Schooling target as a share of the stage's cap, by spending level 0 to 4. */
  schoolingByLevel: [0.25, 0.55, 0.78, 0.9, 1],
  /** Skills move this share of the way to where the schools lead each month. */
  skillRate: 0.03,
  /** Specialization builds over this many months (twice as fast with a Science Park). */
  specializationMonths: 24,
  /** The focused skill works up to this much harder at full specialization. */
  specializationBoost: 0.25,
  /** Health target: a base, plus each level of health spending, hospitals staffed with doctors, housing and medicine. */
  healthBase: 0.32,
  healthPerLevel: 0.08,
  healthPerHospital: 0.012,
  healthHospitalCap: 0.12,
  healthPerHousing: 0.02,
  healthRate: 0.05,
  /** Life expectancy shown on screen: 48 years plus 36 for perfect health. */
  lifeBase: 48,
  lifeSpan: 36,
  /** Unemployment: a base, what pushes it up, and how fast it moves. */
  jobsBase: 0.05,
  jobsPerOccupied: 0.08,
  jobsPerUnrest: 0.002,
  jobsPerRate: 0.003,
  jobsPerBuilding: 0.012,
  jobsRetrain: 0.012,
  jobsRate: 0.25,
  jobsMin: 0.01,
  jobsMax: 0.45,
  /** Stability lost for each point of unemployment over 6%, before jobless support softens it. */
  joblessAnger: 0.5,
  /** Population growth a month: a base, plus health, housing and medicine; minus hunger. */
  growthBase: -0.0001,
  growthHealth: 0.0012,
  growthHousing: 0.00015,
  growthHunger: -0.003,
  /** Migration: people move toward a better life, at most this share of the population a month. */
  migrationRate: 0.0006,
  migrationCap: 0.001,
  /** Welfare effects per level. */
  pensionStability: 2,
  pensionElection: 2,
  housingStability: 1,
  housingElection: 1.5,
  /** Stability from health, from -6 to +6 around average health. */
  healthStability: 12,
}

/** Coverage multipliers: how well a building works with the specialists it needs. */
export const COVERAGE = {
  /** Factories run at 0.75 with no engineers, 1.0 at full staff, 1.10 well beyond it. */
  factory: { min: 0.75, max: 1.1 },
  /** Universities run at 0.70 to 1.15 with their scientists. */
  research: { min: 0.7, max: 1.15 },
  /** Below this short of full staff a shortfall is not felt yet. */
  slack: 0.05,
}

/** Specialists each kind of work needs, as a share of the workforce. */
export const DEMAND = {
  engineersBase: 0.02,
  engineersPerFactory: 0.012,
  engineersPerSystem: 0.003,
  engineersPerProject: 0.004,
  scientistsBase: 0.008,
  scientistsPerUniversity: 0.015,
  doctorsBase: 0.008,
  doctorsPerHealth: 0.003,
  doctorsPerHospital: 0.012,
  skilledBase: 0.22,
}

/** Where the schools lead each skill, from schooling 0 to 1: a floor plus a share. Focus multiplies the professional ones. */
export const SKILL_TARGETS: Record<Exclude<SkillKey, 'basic'>, { floor: number; perSchooling: number }> = {
  skilled: { floor: 0.14, perSchooling: 0.42 },
  engineers: { floor: 0.012, perSchooling: 0.06 },
  doctors: { floor: 0.006, perSchooling: 0.03 },
  scientists: { floor: 0.004, perSchooling: 0.035 },
}

/** Epidemics: how they start, spread, hurt and end. */
export const EPIDEMIC = {
  salt: 0x5e1d3,
  /** Monthly chance of an outbreak at average health, and how much poor health raises it. */
  baseChance: 0.0015,
  sickChance: 0.004,
  /** Chance an epidemic next door crosses the border each month. */
  spreadChance: 0.05,
  quarantineSpread: 0.3,
  startSeverity: 0.35,
  /** Severity falls this much each month, more with health, doctors, quarantine, a medical centre and vaccines. */
  recoveryBase: 0.1,
  recoveryHealth: 0.22,
  recoveryDoctors: 0.12,
  recoveryQuarantine: 0.1,
  recoveryCentre: 0.1,
  end: 0.03,
  /** What a full-strength epidemic does each month. */
  popLoss: 0.004,
  output: 0.15,
  stability: 10,
  recruits: 0.5,
  /** Quarantine: money per unit of workforce, and output lost. */
  quarantineCost: 0.02,
  quarantineOutput: 0.05,
}

/** What each medicine technology does. */
export const MEDICINE: Record<string, { health?: number; epidemicRisk?: number; recovery?: number; combatMedicine?: number; doctorReach?: number; growth?: number; pensionCost?: number }> = {
  med_sanitation: { health: 0.05, epidemicRisk: -0.3 },
  med_vaccines: { health: 0.03, recovery: 0.15 },
  med_surgery: { combatMedicine: 0.08, doctorReach: 0.2 },
  med_genomics: { health: 0.05, growth: 0.0002 },
  med_longevity: { health: 0.04, pensionCost: -0.3 },
}

/** Doctors return this share of infantry losses at full coverage (more with surgery), counted with nano-medicine and capped. */
export const COMBAT_MEDICINE = { perCoverage: 0.06, cap: 0.4 }
