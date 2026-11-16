import type { GovernmentType } from '../engine/types'

/** Everything a government, a law or a budget can change about how a country runs. Missing means no change. */
export interface PolicyEffects {
  /** Added to where stability is heading. */
  stability: number
  /** Added to every output multiplier. */
  output: number
  /** Added to factory output. */
  factory: number
  /** Added to research output. */
  research: number
  /** Added to unit and building upkeep. Negative is cheaper. */
  upkeep: number
  /** Influence each month. */
  influence: number
  /** Share of gross income gained (positive) or spent (negative) each month. */
  money: number
  /** Added to what people eat. */
  foodUse: number
  /** Added to the goods people use. */
  goodsUse: number
  /** Added to how fast private businesses grow. */
  growth: number
  /** Added to market trade capacity. */
  trade: number
  /** Added to how badly high taxes anger people. */
  taxSensitivity: number
  /** Added to how much war weariness hurts. */
  weariness: number
}

export const NO_EFFECTS: PolicyEffects = { stability: 0, output: 0, factory: 0, research: 0, upkeep: 0, influence: 0, money: 0, foodUse: 0, goodsUse: 0, growth: 0, trade: 0, taxSensitivity: 0, weariness: 0 }

export interface GovernmentSpec {
  name: string
  blurb: string
  effects: Partial<PolicyEffects>
  /** Months between elections, or 0 for none. */
  election: number
  /** True when a weak junta can be overthrown. */
  coups: boolean
}

export const GOVERNMENTS: Record<GovernmentType, GovernmentSpec> = {
  democracy: {
    name: 'Democracy',
    blurb: 'Open and inventive: research and business grow faster. Voters punish high taxes and long wars, and hold an election every 3 years.',
    effects: { research: 0.1, growth: 0.15, taxSensitivity: 0.3, weariness: 0.4 },
    election: 36,
    coups: false,
  },
  monarchy: {
    name: 'Monarchy',
    blurb: 'Steady and traditional. A little more stability and influence, and no elections to lose.',
    effects: { stability: 4, influence: 0.3, taxSensitivity: -0.1 },
    election: 0,
    coups: false,
  },
  junta: {
    name: 'Military junta',
    blurb: 'The army rules. Cheaper forces and people who tolerate taxes and war, but less research and business, and a weak junta can be overthrown.',
    effects: { stability: -4, upkeep: -0.12, taxSensitivity: -0.4, weariness: -0.4, research: -0.05, growth: -0.1 },
    election: 0,
    coups: true,
  },
  one_party: {
    name: 'One-party state',
    blurb: 'Command economy. More stability, influence and factory output, but slower research and business.',
    effects: { stability: 6, influence: 0.8, factory: 0.06, research: -0.1, weariness: -0.2, growth: -0.05 },
    election: 0,
    coups: false,
  },
}

export const GOVERNMENT_TYPES = Object.keys(GOVERNMENTS) as GovernmentType[]

export const REFORM = {
  /** Influence to change the form of government. */
  cost: 40,
  /** Stability lost in the turmoil. */
  turmoil: 10,
  /** Months before the government can be changed again. */
  cooldown: 24,
}

/** Shares each go from the minimum to the maximum; an even split is the neutral point. */
export const BUDGET_LIMITS = { min: 0.05, max: 0.6, even: 0.25 }

export const CORPORATE_TAX = { min: 0, max: 0.4, default: 0.15 }

export const ELECTION = {
  /** Stability needed to win. */
  needed: 45,
  win: { stability: 5, influence: 10 },
  lose: { stability: -12, influenceLoss: 0.5, tax: 0.2 },
}

export const COUP = { below: 25, perPoint: 0.012, stabilityAfter: 30 }
