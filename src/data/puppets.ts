import type { LawId, SpendingKey, TributeForm } from '../engine/types'

/**
 * Puppet states: every number the rules in `engine/puppets.ts` use.
 *
 * A puppet has a LOYALTY from 0 to 100. Each month it moves by the master's PRESSURE (taxes, draft, laws, the tribute taken, against
 * aid, investment, a garrison and decent spending) and is pulled back toward `neutral`, so a high loyalty must be paid for again
 * every month and the pressure alone decides where it settles: `neutral + pressure / settle`. Nothing here grows without limit.
 */
export const PUPPET = {
  /** Loyalty of a new puppet. */
  start: 60,
  neutral: 60,
  /** The share of the gap to `neutral` closed each month. */
  settle: 0.03,
  /** Tribute is reduced to `compliance` times its due: a restive puppet hides money, a loyal one pays in full and more. */
  complianceLow: 0.7,
  complianceHigh: 1.2,
  /** Below this loyalty a puppet will not follow its master into a war. */
  warLoyalty: 25,
  /** Below this the puppet is shaky (unrest, rebels); above `high` it is loyal (counts more, pays more). */
  restive: 35,
  high: 75,
  /** Rebels, and the chance of breaking free, start here. */
  rebelBelow: 25,
  freeBelow: 15,
  rebelChance: 0.15,
  freeChance: 0.04,
  freeStep: 0.012,
  /** The stability a restive puppet loses each month, per point of loyalty below `restive`. */
  unrestPerPoint: 0.04,
  /** Tier counting: a loyal puppet counts this share of its countries, a restive one that share, others half. */
  countHigh: 0.6,
  countLow: 0.35,
  /** Annexing: the cost multiplier is `annexBase - loyalty / 100` (from 0.5 at loyalty 100 to 1.5 at 0). Land annexed from a restive puppet settles slower. */
  annexBase: 1.5,
  annexMinCost: 0.5,
  /** Total tribute of one master, in money, never counts for more than this share of its own gross; what is above it is paid at `capRate`. */
  extractionCap: 0.25,
  capRate: 0.5,
  /** The master's limits on the puppet's rules. */
  maxTax: 0.45,
  maxDraft: 0.25,
  /** The master may keep at most this many laws on a puppet. */
  maxLaws: 3,
  /** Laws a master may put on a puppet, with the loyalty each costs every month it stands and the shock when it is passed. */
  laws: {
    martial_law: { held: -2.5, shock: -8, blurb: 'Soldiers keep order: stability +15, output -15%.' },
    conscription_act: { held: -1.5, shock: -3, blurb: 'A draft up to 25%.' },
    free_trade: { held: -0.4, shock: -2, blurb: 'Open markets: more trade, a little unease.' },
    austerity: { held: -1.5, shock: -4, blurb: 'Income +4%, upkeep -12%, stability -8.' },
    rationing: { held: -1.5, shock: -4, blurb: 'People eat and buy less. Stability -6.' },
    press_control: { held: -1, shock: -4, blurb: 'Influence +0.8 a month, stability +4, research -8%.' },
  } as Partial<Record<LawId, { held: number; shock: number; blurb: string }>>,
  /** Taxes: the pressure per point above `neutral`, and the relief per point below it (capped). */
  tax: { neutral: 0.25, over: 12, under: 8, relief: 1, shock: 20 },
  draft: { neutral: 0.05, over: 20, shock: 15 },
  /** Spending lines a master may set, with the pressure per level above the standard level (and below it, negative). */
  spending: {
    schools: { weight: 0.12, standard: 2 },
    health: { weight: 0.15, standard: 2 },
    pensions: { weight: 0.2, standard: 1 },
    jobless: { weight: 0.25, standard: 1 },
    housing: { weight: 0.25, standard: 1 },
  } as Partial<Record<SpendingKey, { weight: number; standard: number }>>,
  /** Most the spending can add or take. */
  spendingCap: 1.5,
  /** A puppet whose treasury is in the red: unrest. */
  redPressure: -0.8,
  /** A puppet stronger than its master. */
  strongPressure: -1,
  strongShare: 0.8,
  /** Stability under this takes loyalty with it. */
  stabilityBelow: 40,
  stabilityPerPoint: 0.03,
  /** A garrison of the master's divisions in the puppet: the pressure at full cover (one division for every 1.5 countries). */
  garrison: { pressure: 0.8, perCountry: 1.5, freeHalved: true },
  /** Investment of the master in the puppet's businesses, against 6 months of its income. */
  invest: { pressure: 1.2, months: 6 },
  /** Aid: money in, loyalty out, with a diminishing return against the puppet's size, and half the money reaches its treasury. */
  aid: { min: 10, max: 600, gain: 8, scale: 20, perGross: 1.5, reaches: 0.5, ceiling: 95 },
  /** The master's influence for each kind of change. */
  cost: { tax: 3, draft: 3, lawOn: 6, lawOff: 3, spending: 2, tributeForm: 4, tributeShare: 3, aid: 0 },
  /** Calling the world to its help: a puppet this loyal or less asks, and nations that are neighbors of either side, or already at war with the master, may free it. */
  liberate: { below: 20, reasonMonths: 12, again: 12, free: 0.2 },
}

export interface TributeSpec {
  name: string
  /** What the share is a share of. */
  of: string
  min: number
  max: number
  /** The share that costs no loyalty. */
  easy: number
  /** The loyalty lost each month for each whole point (1.0) of share above `easy`. Below it the puppet is relieved, up to `relief`. */
  burden: number
  relief: number
  /** Worth of one unit when tribute forms are weighed against the master's gross (money). */
  value: number
}

/** The four forms of tribute. Money is the old 12% of income; oil and steel are shares of what the puppet pulls out of the ground and its mills; a levy is soldiers. */
export const TRIBUTE: Record<TributeForm, TributeSpec> = {
  money: { name: 'Money', of: 'its income', min: 0.05, max: 0.3, easy: 0.12, burden: 10, relief: 0.6, value: 1 },
  oil: { name: 'Oil', of: 'the oil it produces', min: 0.1, max: 0.6, easy: 0.25, burden: 7, relief: 0.4, value: 2 },
  steel: { name: 'Steel', of: 'the steel it makes', min: 0.1, max: 0.6, easy: 0.25, burden: 7, relief: 0.4, value: 1.8 },
  levy: { name: 'Soldiers', of: 'its recruits', min: 0.02, max: 0.25, easy: 0.06, burden: 22, relief: 0.4, value: 0.12 },
}
export const TRIBUTE_FORMS = Object.keys(TRIBUTE) as TributeForm[]

/** The default tribute: the old 12% of income. */
export const DEFAULT_TRIBUTE: { form: TributeForm; share: number } = { form: 'money', share: 0.12 }

/** Soldiers taken by a levy each month, in thousands: this fraction of the puppet's pool, times the share. */
export const LEVY_POOL = 0.2

export const PUPPET_LAW_IDS = Object.keys(PUPPET.laws) as LawId[]
export const PUPPET_SPENDING_KEYS = Object.keys(PUPPET.spending) as SpendingKey[]
