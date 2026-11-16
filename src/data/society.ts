import type { CampaignId, SocialId } from '../engine/types'
import type { PolicyEffects } from './government'

/**
 * Social policies: standing programs a government runs for its people, each a monthly cost per worker that buys stability, health,
 * learning, jobs, calm or growth. A policy is set to Off, Pilot, National or Universal. Its effect phases in over a few months and
 * fades out the same way, so it is an investment, not a switch.
 */

/** What a policy or campaign can change in how the people live, beyond what laws and governments already change (`PolicyEffects`). */
export interface SocialEffects {
  /** Added to the health the nation is heading for (0.01 is one point). */
  health: number
  /** Added to the schooling the nation is heading for. */
  schooling: number
  /** Added to the unemployment the nation is heading for. Negative means more jobs. */
  jobs: number
  /** Added to monthly population growth. */
  births: number
  /** Added to the stability needed to win an election. Negative makes it easier. */
  election: number
  /** Share by which rebels are less likely to rise. */
  order: number
  /** Share by which conquered land settles faster. */
  settle: number
  /** Share by which epidemics are rarer, and ease sooner. */
  epidemic: number
  /** Share by which food and goods shortages hurt stability less. */
  famine: number
  /** Added to how many countries the officials can run. */
  admin: number
}

export const NO_SOCIAL: SocialEffects = { health: 0, schooling: 0, jobs: 0, births: 0, election: 0, order: 0, settle: 0, epidemic: 0, famine: 0, admin: 0 }
export const SOCIAL_FIELDS = Object.keys(NO_SOCIAL) as (keyof SocialEffects)[]

/** Everything one policy or campaign can do: the stability, output and money of `PolicyEffects`, and the people's own `SocialEffects`. */
export type SocialEffect = Partial<PolicyEffects & SocialEffects>

export type SocialGroup = 'health' | 'learning' | 'work' | 'family' | 'safety'

export const SOCIAL_GROUPS: Record<SocialGroup, { name: string; blurb: string }> = {
  health: { name: 'Health and care', blurb: 'Clinics, clean water and care for the old and the troubled. Healthy people live longer, work more and riot less.' },
  learning: { name: 'Learning', blurb: 'Meals, scholarships, apprenticeships and libraries. Learning feeds the schools and the labs.' },
  work: { name: 'Work', blurb: 'Wages, jobs, loans and the rights of workers. Each helps some people and costs others, so choose.' },
  family: { name: 'Family and homes', blurb: 'Child benefit, parental leave, food aid and transport. Families grow, and a hungry month hurts less.' },
  safety: { name: 'Safety and unity', blurb: 'Police, courts, festivals and the airwaves. The calm that holds a country, and a big one, together.' },
}

export interface SocialSpec {
  name: string
  blurb: string
  group: SocialGroup
  /** Money a month per worker, for each level in force. */
  cost: number
  /** Influence to raise it to level 1, 2 and 3, one step at a time. */
  enact: [number, number, number]
  /** What one unit of strength does. A higher level multiplies it (see `LEVEL_POWER`). */
  effects: SocialEffect
}

export const LEVEL_NAMES = ['Off', 'Pilot', 'National', 'Universal'] as const
/** How much each level is worth. A bigger program costs in proportion and helps less than in proportion, so the first steps pay best. */
export const LEVEL_POWER = [0, 1, 1.8, 2.4] as const
export const MAX_LEVEL = 3

export const SOCIAL_RULES = {
  /** How far strength moves toward the level each month. */
  phaseIn: 0.25,
  /** Stability lost, at once, for each level a program is cut. People do not forgive losing what they were given. */
  cutStability: 2,
  /** The most stability all programs and projects can add together: 18 at the very most, approached but never reached. */
  stabilityCap: 18,
  /** The most that programs, projects and campaigns together can take off hunger, plague and rebellion: a share of the trouble, never all of it. */
  shareCap: 0.9,
}

/** Strength 0 to 3 (it moves between levels) as a multiple of one unit of effect. */
export function powerOf(strength: number): number {
  const s = Math.max(0, Math.min(MAX_LEVEL, strength))
  const lo = Math.floor(s)
  if (lo >= MAX_LEVEL) return LEVEL_POWER[MAX_LEVEL]
  return LEVEL_POWER[lo] + (LEVEL_POWER[lo + 1] - LEVEL_POWER[lo]) * (s - lo)
}

export const SOCIAL: Record<SocialId, SocialSpec> = {
  // ---- Health and care ----
  clinics: { name: 'Community clinics', blurb: 'A doctor in every district: checkups, vaccines and care close to home.', group: 'health', cost: 0.16, enact: [4, 6, 9], effects: { health: 0.025, stability: 0.6, epidemic: 0.1 } },
  cleanWater: { name: 'Clean water and sanitation', blurb: 'Pipes, wells and sewers. The cheapest way to stop a plague.', group: 'health', cost: 0.14, enact: [4, 6, 9], effects: { health: 0.02, epidemic: 0.15, births: 0.00005 } },
  mentalHealth: { name: 'Mental health services', blurb: 'Counselors and hotlines. Calmer people work better.', group: 'health', cost: 0.12, enact: [4, 6, 9], effects: { stability: 1.2, output: 0.012, jobs: -0.002 } },
  elderCare: { name: 'Elder care', blurb: 'Homes and nurses for the old. Their families, and their votes, remember it.', group: 'health', cost: 0.15, enact: [4, 6, 9], effects: { stability: 0.8, election: -1.2 } },

  // ---- Learning ----
  schoolMeals: { name: 'Free school meals', blurb: 'A hot lunch for every child. They learn better, and grow stronger.', group: 'learning', cost: 0.14, enact: [4, 6, 9], effects: { schooling: 0.012, health: 0.008, stability: 0.4, famine: 0.05 } },
  scholarships: { name: 'Scholarships', blurb: 'Clever children of poor families go to university.', group: 'learning', cost: 0.18, enact: [5, 7, 10], effects: { schooling: 0.02, research: 0.045 } },
  apprenticeships: { name: 'Apprenticeships', blurb: 'Paid training in the factories. A skilled hand from the first day.', group: 'learning', cost: 0.16, enact: [4, 6, 9], effects: { jobs: -0.004, factory: 0.05, schooling: 0.005 } },
  libraries: { name: 'Libraries and the arts', blurb: 'Books, theaters and museums in every town. A proud, curious people.', group: 'learning', cost: 0.12, enact: [4, 6, 9], effects: { stability: 0.9, research: 0.012, influence: 0.04 } },

  // ---- Work ----
  minimumWage: { name: 'Minimum wage', blurb: 'A floor under pay. Workers are content; some employers hire fewer.', group: 'work', cost: 0.1, enact: [4, 6, 9], effects: { stability: 1.4, jobs: 0.004, growth: -0.01 } },
  jobsGuarantee: { name: 'Public jobs guarantee', blurb: 'The state hires anyone who wants work. It costs a great deal, and nobody is idle.', group: 'work', cost: 0.3, enact: [5, 8, 11], effects: { jobs: -0.012, stability: 0.5 } },
  smallLoans: { name: 'Small-business loans', blurb: 'Cheap credit for shops and workshops. They grow and hire.', group: 'work', cost: 0.13, enact: [4, 6, 9], effects: { growth: 0.13, jobs: -0.003, output: 0.016 } },
  workerRights: { name: "Workers' rights", blurb: 'Unions, safe workplaces and fair hours. Workers are loyal; factories lose some speed.', group: 'work', cost: 0.08, enact: [4, 6, 9], effects: { stability: 1.3, factory: -0.012, election: -1.5 } },

  // ---- Family and homes ----
  childBenefit: { name: 'Child benefit', blurb: 'Money for every child. More families have more children.', group: 'family', cost: 0.2, enact: [4, 6, 9], effects: { births: 0.0004, stability: 0.7 } },
  parentalLeave: { name: 'Paid parental leave', blurb: 'Time at home with a new baby. Fewer hours at work, more babies.', group: 'family', cost: 0.17, enact: [4, 6, 9], effects: { births: 0.00012, stability: 0.6, output: -0.004 } },
  foodAid: { name: 'Food assistance', blurb: 'Vouchers and kitchens for the hungry. A bad harvest hurts far less.', group: 'family', cost: 0.15, enact: [4, 6, 9], effects: { famine: 0.35, stability: 0.5 } },
  transit: { name: 'Public transport', blurb: 'Buses, trams and cheap trains. People reach work, and goods reach markets.', group: 'family', cost: 0.15, enact: [4, 6, 9], effects: { output: 0.026, trade: 0.05, stability: 0.4 } },

  // ---- Safety and unity ----
  policing: { name: 'Community policing', blurb: 'Officers who know the streets. Trouble is stopped before it spreads.', group: 'safety', cost: 0.16, enact: [4, 6, 9], effects: { order: 0.12, stability: 0.8 } },
  courts: { name: 'Courts and anti-corruption', blurb: 'Honest judges and open books. Money stays where it was meant to go.', group: 'safety', cost: 0.18, enact: [5, 7, 10], effects: { output: 0.018, stability: 0.7, money: 0.016, admin: 0.5 } },
  integration: { name: 'Integration programs', blurb: 'Language classes, jobs and a voice for newcomers and conquered provinces.', group: 'safety', cost: 0.14, enact: [4, 6, 9], effects: { settle: 0.18, stability: 0.6 } },
  festivals: { name: 'Festivals and sport', blurb: 'Fireworks, leagues and a national day. Bread and circuses, and they work.', group: 'safety', cost: 0.11, enact: [4, 6, 9], effects: { stability: 1.1, weariness: -0.06, health: 0.004 } },
  broadcasting: { name: 'Public broadcasting', blurb: 'The state tells its story on every screen. Cheap, calming and a little suspect.', group: 'safety', cost: 0.09, enact: [4, 6, 9], effects: { stability: 0.5, influence: 0.06, election: -0.8, taxSensitivity: -0.05 } },
  surveillance: { name: 'State surveillance', blurb: 'Cameras, informants and files. Order, bought at the price of freedom: scientists leave, and democracies punish it.', group: 'safety', cost: 0.12, enact: [4, 6, 9], effects: { stability: 1.8, order: 0.15, research: -0.012, election: 2, influence: -0.04 } },
}

export const SOCIAL_IDS = Object.keys(SOCIAL) as SocialId[]
export const SOCIAL_BY_GROUP = (g: SocialGroup) => SOCIAL_IDS.filter((id) => SOCIAL[id].group === g)

/**
 * Campaigns: a one-off bill for a burst of effect that fades, with a long wait before the next. The price grows with the size of
 * the country. A campaign also does something at once (`instant`).
 */
export interface CampaignSpec {
  name: string
  blurb: string
  /** Money: this plus `perSize` for each unit of the nation's size (about its workforce). */
  base: number
  perSize: number
  /** Months it lasts, and months before it can be run again (counted from the start). */
  months: number
  cooldown: number
  effects: SocialEffect
  /** At once: stability gained, and the share of a running epidemic that is cleared. */
  instant?: { stability?: number; epidemic?: number }
}

export const CAMPAIGNS: Record<CampaignId, CampaignSpec> = {
  celebration: { name: 'National celebration', blurb: 'A holiday, a parade and a feast. The whole country feels it, for a while.', base: 20, perSize: 1.2, months: 6, cooldown: 18, effects: { stability: 4 }, instant: { stability: 3 } },
  vaccination: { name: 'Vaccination drive', blurb: 'Every child, every village. Plagues find little to feed on.', base: 25, perSize: 1.5, months: 8, cooldown: 24, effects: { health: 0.03, epidemic: 0.5 }, instant: { epidemic: 0.4 } },
  literacy: { name: 'Literacy campaign', blurb: 'Night schools and traveling teachers. The countryside learns to read.', base: 20, perSize: 1.2, months: 12, cooldown: 30, effects: { schooling: 0.04 } },
  jobFair: { name: 'Job fair and retraining', blurb: 'Employers and the jobless in one hall, with courses on the side.', base: 15, perSize: 1, months: 6, cooldown: 18, effects: { jobs: -0.02 } },
  unityTour: { name: 'Unity tour of the provinces', blurb: 'The leader visits every province. Conquered land starts to feel like home.', base: 18, perSize: 1, months: 8, cooldown: 24, effects: { order: 0.3, settle: 0.4, stability: 1.5 } },
  foodBank: { name: 'Food bank drive', blurb: 'Warehouses opened and grain handed out. Nobody goes to bed hungry this season.', base: 15, perSize: 0.8, months: 4, cooldown: 12, effects: { famine: 0.6, stability: 1 } },
  babyBonus: { name: 'Baby bonus', blurb: 'A cash gift for every new family. A year of cradles.', base: 30, perSize: 2, months: 12, cooldown: 36, effects: { births: 0.0006 } },
}
export const CAMPAIGN_IDS = Object.keys(CAMPAIGNS) as CampaignId[]

/** The price of a campaign for a nation of this size (see `nationSize`). */
export const campaignCost = (id: CampaignId, size: number) => Math.round(CAMPAIGNS[id].base + CAMPAIGNS[id].perSize * size)

// ---- Plain words for what an effect does, for the screens ----

const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '')
const pts = (v: number, digits = 1) => `${sign(v)}${Math.abs(v * 100).toFixed(digits)}`

/** One line for each effect, scaled by `power`. Good first, then bad, as the screens want them. */
export function describeEffect(e: SocialEffect, power = 1): { text: string; good: boolean }[] {
  const out: { text: string; good: boolean }[] = []
  const add = (v: number | undefined, good: (v: number) => boolean, text: (v: number) => string) => {
    if (!v) return
    const x = v * power
    out.push({ text: text(x), good: good(x) })
  }
  add(e.stability, (v) => v > 0, (v) => `Stability ${sign(v)}${Math.abs(v).toFixed(1)}`)
  add(e.health, (v) => v > 0, (v) => `Health ${pts(v)} points`)
  add(e.schooling, (v) => v > 0, (v) => `Schooling ${pts(v)} points`)
  add(e.jobs, (v) => v < 0, (v) => `Unemployment ${pts(v)} points`)
  add(e.births, (v) => v > 0, (v) => `Births ${pts(v, 3)}% a month`)
  add(e.output, (v) => v > 0, (v) => `Output ${pts(v)}%`)
  add(e.factory, (v) => v > 0, (v) => `Factories ${pts(v)}%`)
  add(e.research, (v) => v > 0, (v) => `Research ${pts(v)}%`)
  add(e.growth, (v) => v > 0, (v) => `Business growth ${pts(v)}%`)
  add(e.trade, (v) => v > 0, (v) => `Trade capacity ${pts(v)}%`)
  add(e.money, (v) => v > 0, (v) => `Income ${pts(v)}%`)
  add(e.influence, (v) => v > 0, (v) => `Influence ${sign(v)}${Math.abs(v).toFixed(2)} a month`)
  add(e.election, (v) => v < 0, (v) => `Election bar ${sign(v)}${Math.abs(v).toFixed(1)}`)
  add(e.order, (v) => v > 0, (v) => `Rebels ${Math.round(v * 100)}% less likely`)
  add(e.settle, (v) => v > 0, (v) => `Conquered land settles ${Math.round(v * 100)}% faster`)
  add(e.epidemic, (v) => v > 0, (v) => `Epidemics ${Math.round(v * 100)}% weaker`)
  add(e.famine, (v) => v > 0, (v) => `Shortages hurt ${Math.round(v * 100)}% less`)
  add(e.weariness, (v) => v < 0, (v) => `War weariness hurts ${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'less' : 'more'}`)
  add(e.taxSensitivity, (v) => v < 0, (v) => `High taxes anger ${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'less' : 'more'}`)
  add(e.admin, (v) => v > 0, (v) => `Officials can run ${Math.abs(v).toFixed(1)} more countries`)
  return out.sort((a, b) => Number(b.good) - Number(a.good))
}
