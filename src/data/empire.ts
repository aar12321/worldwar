import type { LawId, OccupationPolicy, ResolutionKind, Tier } from '../engine/types'
import type { PolicyEffects } from './government'

/** An empire tier: what a nation of this size may do. A feature that exists from the start is limited at first and opens up as it grows. */
export interface TierSpec {
  id: Tier
  name: string
  /** Countries needed (owned, plus half of each puppet's). */
  countries: number
  /** Interest rate range the central bank may set. `null` means the world rate, fixed. */
  rate: [number, number] | null
  /** Most money that may be printed in a month, as a share of a month's income. */
  printCap: number
  /** How much printing stirs inflation: lower is more trusted. */
  credibility: number
  /** Bond terms on offer, in months. */
  bondTerms: number[]
  /** War bonds a nation may sell per war, in months of income. */
  warBondCap: number
  directedCredit: boolean
  wealthFund: boolean
  projectSlots: number
  enterpriseSlots: number
  lawSlots: number
  /** How far the schools can specialize the people. */
  specializationCap: number
  selectiveImmigration: boolean
  occupation: OccupationPolicy[]
  academyMax: number
  armsToAnyone: boolean
  /** Administration capacity before any civic halls, skilled officials or capitals. */
  adminBase: number
  moveCapital: boolean
  regionalCapitals: number
  /** World Bank loans this nation can make: the largest, and the longest. */
  loanMax: number
  loanMonths: number
  /** A superpower's loans can carry a pact. */
  loanPact: boolean
  /** World Council: 0 none, 2/3 or 1/2 of the vote needed to pass. */
  council: number
  /** Whether it can hold the reserve currency: 'largest' only as the largest economy. */
  reserve: 'no' | 'largest'
  /** Multiplier on how far bonuses from many countries can add up. */
  traitCap: number
}

export const TIERS: TierSpec[] = [
  { id: 1, name: 'Nation', countries: 1, rate: null, printCap: 0.05, credibility: 1.5, bondTerms: [12, 36], warBondCap: 1, directedCredit: false, wealthFund: false, projectSlots: 1, enterpriseSlots: 1, lawSlots: 3, specializationCap: 0.5, selectiveImmigration: false, occupation: ['standard'], academyMax: 1, armsToAnyone: false, adminBase: 5, moveCapital: false, regionalCapitals: 0, loanMax: 400, loanMonths: 24, loanPact: false, council: 0, reserve: 'no', traitCap: 1 },
  { id: 2, name: 'Regional power', countries: 4, rate: [1, 10], printCap: 0.1, credibility: 1, bondTerms: [12, 36], warBondCap: 1.5, directedCredit: true, wealthFund: false, projectSlots: 2, enterpriseSlots: 2, lawSlots: 4, specializationCap: 0.75, selectiveImmigration: true, occupation: ['standard', 'autonomy'], academyMax: 2, armsToAnyone: true, adminBase: 8, moveCapital: false, regionalCapitals: 0, loanMax: 400, loanMonths: 24, loanPact: false, council: 0, reserve: 'no', traitCap: 1.1 },
  { id: 3, name: 'Great power', countries: 10, rate: [0, 15], printCap: 0.25, credibility: 0.85, bondTerms: [12, 36, 60], warBondCap: 2, directedCredit: true, wealthFund: true, projectSlots: 3, enterpriseSlots: 3, lawSlots: 5, specializationCap: 1, selectiveImmigration: true, occupation: ['standard', 'autonomy', 'assimilate'], academyMax: 3, armsToAnyone: true, adminBase: 13, moveCapital: true, regionalCapitals: 0, loanMax: 600, loanMonths: 36, loanPact: false, council: 0, reserve: 'no', traitCap: 1.2 },
  { id: 4, name: 'Superpower', countries: 25, rate: [0, 20], printCap: 0.4, credibility: 0.6, bondTerms: [12, 36, 60], warBondCap: 2, directedCredit: true, wealthFund: true, projectSlots: 4, enterpriseSlots: 4, lawSlots: 6, specializationCap: 1, selectiveImmigration: true, occupation: ['standard', 'autonomy', 'assimilate', 'settle'], academyMax: 3, armsToAnyone: true, adminBase: 22, moveCapital: true, regionalCapitals: 2, loanMax: 1000, loanMonths: 48, loanPact: true, council: 2 / 3, reserve: 'largest', traitCap: 1.3 },
  { id: 5, name: 'Hegemon', countries: 60, rate: [0, 20], printCap: 0.6, credibility: 0.45, bondTerms: [12, 36, 60], warBondCap: 2, directedCredit: true, wealthFund: true, projectSlots: 5, enterpriseSlots: 6, lawSlots: 7, specializationCap: 1, selectiveImmigration: true, occupation: ['standard', 'autonomy', 'assimilate', 'settle'], academyMax: 3, armsToAnyone: true, adminBase: 34, moveCapital: true, regionalCapitals: 4, loanMax: 2000, loanMonths: 60, loanPact: true, council: 1 / 2, reserve: 'largest', traitCap: 1.4 },
]

export const tierSpec = (t: number): TierSpec => TIERS[Math.max(1, Math.min(5, Math.round(t))) - 1]

export const EMPIRE_RULES = {
  /** A nation drops a tier only once it falls this share below the line, so one lost battle does not take powers away. */
  demoteSlack: 0.1,
  /** Administration: what each country weighs on the officials, and what eases it. */
  adminSettled: 0.5,
  adminUnsettled: 0.9,
  adminGovernor: 0.8,
  /** Distance to the nearest capital adds up to this much to a country's weight. */
  adminDistanceMax: 0.6,
  adminDistanceKm: 8000,
  adminPerCivic: 0.4,
  adminPerSkilled: 10,
  adminDigitalGov: 4,
  adminRegionalCapital: 3,
  /** Each country over capacity costs this much stability and output, up to the caps. */
  overStability: 2,
  overStabilityCap: 30,
  overOutput: 0.015,
  overOutputCap: 0.2,
  governorSalary: 1.2,
  /** Capitals: how often one can move, what it costs, and how they help nearby countries settle. */
  capitalMoveCooldown: 60,
  capitalMoveStability: 6,
  capitalMoveInfluence: 40,
  regionalCapitalInfluence: 25,
  capitalSettleKm: 2500,
  capitalSettleSpeed: 1.5,
  regionalCapitalLine: 1,
  /** Law upkeep in influence each month, the share of a law's stability that counts, and what repealing costs. */
  lawUpkeep: 0.3,
  lawStabilityShare: 0.7,
  repealCost: 10,
}

/** Laws that cannot stand together. */
export const LAW_CONFLICTS: [LawId, LawId][] = [
  ['free_trade', 'rationing'],
  ['free_trade', 'war_economy'],
  ['austerity', 'research_grants'],
  ['austerity', 'industrial_policy'],
  ['martial_law', 'free_trade'],
]

export interface OccupationSpec {
  name: string
  blurb: string
  /** Multipliers on how fast conquered land settles and how often it rebels. */
  speed: number
  rebels: number
  /** Share of a country's output that counts before it has settled. */
  floor: number
  /** Stability lost for each unsettled country, and money each costs a month. */
  stability: number
  cost: number
}

export const OCCUPATION: Record<OccupationPolicy, OccupationSpec> = {
  standard: { name: 'Standard', blurb: 'Garrisons and governors. Settles in about six months.', speed: 1, rebels: 1, floor: 0.4, stability: 0, cost: 0 },
  autonomy: { name: 'Autonomy', blurb: 'Local rulers keep their posts. Settles slowly, but rarely rebels and keeps more of its output.', speed: 0.6, rebels: 0.3, floor: 0.55, stability: 0, cost: 0 },
  assimilate: { name: 'Assimilate', blurb: 'Your language, your schools, your laws, at once. Settles fast, but rebels more and unsettles your people.', speed: 1.6, rebels: 1.8, floor: 0.4, stability: 0.4, cost: 0 },
  settle: { name: 'Settle', blurb: 'Pay families to move there. Costs money every month, settles quickly with little unrest.', speed: 1.4, rebels: 0.8, floor: 0.4, stability: 0, cost: 2 },
}

export interface ResolutionSpec {
  name: string
  blurb: string
  /** Influence to put it to the vote. */
  cost: number
  needsTarget: boolean
  needsSecond: boolean
}

export const RESOLUTIONS: Record<ResolutionKind, ResolutionSpec> = {
  sanctions: { name: 'World sanctions', blurb: 'Every nation that votes yes cuts off trade with the target for a year.', cost: 40, needsTarget: true, needsSecond: false },
  ceasefire: { name: 'Ceasefire', blurb: 'Two other nations at war must make peace at once.', cost: 40, needsTarget: true, needsSecond: true },
  recognition: { name: 'Recognition', blurb: 'The world accepts your borders: your reputation (infamy) falls by 25.', cost: 50, needsTarget: false, needsSecond: false },
  accord: { name: 'Trade accord', blurb: 'For two years, every nation that votes yes trades 15% more through its ports and the market.', cost: 40, needsTarget: false, needsSecond: false },
}

export const COUNCIL = {
  /** Months between resolutions a nation may put forward. */
  cooldown: 12,
  /** A nation votes for a resolution put forward by one it thinks this well of, and against one it thinks this badly of. */
  yesOpinion: 10,
  noOpinion: -10,
  sanctionsMonths: 12,
  accordMonths: 24,
  accordTrade: 0.15,
  recognitionInfamy: 25,
}

/**
 * How far bonuses from many countries add up for each effect: up to the strongest one in full, then flattening toward this much more.
 * A nation of one country is unchanged; a vast empire no longer grows its bonuses with the square of its size.
 */
export const TRAIT_CAPS: Partial<Record<keyof PolicyEffects, number>> = {
  stability: 8,
  output: 0.15,
  factory: 0.25,
  research: 0.3,
  upkeep: 0.2,
  influence: 1.5,
  money: 0.06,
  foodUse: 0.2,
  goodsUse: 0.2,
  growth: 0.3,
  trade: 0.4,
  taxSensitivity: 0.3,
  weariness: 0.3,
}

/** City credit is capped, however many banking cities a nation holds. */
export const CITY_CREDIT_CAP = 14
