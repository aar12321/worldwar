import type { RelateAct } from '../engine/types'

/**
 * Relationships (docs/RELATIONS_STATUS.md): the ways to win a nation over and to keep it. Every number lives here.
 * `on` is the switch the golden tests use to show what this layer moved.
 */
export const RELATIONS = {
  on: true,
  /** Warmth earned by actions fades by this share each month; the next action is worth less the more there is. */
  softFade: 0.08,
  /** Warmth at which an action is worth its minimum. */
  softCap: 55,
  softMin: 0.2,
  /** Most opinion that actions can have given one nation at any one time, however many they are. */
  earnedCap: 45,
  /** Months a favour owed can be called in, and most favours one nation will owe another. */
  favourMonths: 36,
  favourMax: 3,
  /** A partner with a pact, alliance, trade deal or embassy that has not heard from you in this many months starts to cool. */
  neglectAfter: 12,
  neglectStep: 0.8,
  neglectCap: 10,
  /** A friend of this many months standing and still at peace: slow steady goodwill. */
  steadfastAfter: 12,
  steadfastStep: 0.4,
  steadfastCap: 10,
  anniversary: { boost: 6, decay: 0.5, every: 12 },
  /** What an open embassy is worth at first, what it adds each month, and the ceiling. An attaché is a second line on top of it. */
  embassyBase: 4,
  embassyStep: 0.35,
  embassyCap: 10,
  attacheBase: 2,
  attacheStep: 0.35,
  attacheCap: 6,
  /** Months of intelligence each month of an embassy renews. */
  embassyIntel: 3,
  /** Requests from rivals: months to answer, and what ignoring or refusing costs. */
  requestMonths: 4,
  ignoreCost: -4,
  refuseCost: -1.5,
  maxRequests: 2,
  /** A joint war plan: months, the cap of simultaneous plans, what a combined strike adds and what a fought-together bond is worth. */
  plan: { months: 12, minMonths: 3, maxMonths: 24, perNation: 2, combinedPush: 0.9, windowDays: 3, bond: 10, abandon: -10, base: 3, step: 0.8, cap: 12 },
  /** Opinion needed for a rival to receive or accept, by act. Easy rivals are this much gentler, Hard ones this much stricter. */
  gentle: -10,
  strict: 5,
  /** Most entries in a partner log. */
  logCap: 160,
}

export type ActGroup = 'goodwill' | 'presence' | 'economy' | 'aid' | 'military' | 'plans' | 'repair' | 'favours'

export const ACT_GROUPS: { id: ActGroup; name: string; blurb: string }[] = [
  { id: 'goodwill', name: 'Goodwill', blurb: 'Visits, culture and gestures. One of each a year or so; the more you do, the less each is worth.' },
  { id: 'presence', name: 'Presence', blurb: 'Embassies and attachés: a monthly bill for slow, steady warmth and a window onto them.' },
  { id: 'economy', name: 'Trade and science', blurb: 'Missions, routes, joint research and ventures: shared costs, shared gains.' },
  { id: 'aid', name: 'Aid and gifts', blurb: 'Help in kind is worth most when they are in need.' },
  { id: 'military', name: 'Military cooperation', blurb: 'Exercises, arms, training, intelligence, basing and shared sanctions.' },
  { id: 'plans', name: 'Joint war plans', blurb: 'A short alliance against one named enemy: strike together, share the spoils.' },
  { id: 'repair', name: 'Repair', blurb: 'Apologies, recognition and mediation mend what went wrong.' },
  { id: 'favours', name: 'Favours', blurb: 'A favour owed is a currency: call it in when you need help.' },
]

export interface ActSpec {
  name: string
  group: ActGroup
  /** One sentence on what it is. */
  blurb: string
  money: number
  pp: number
  tp?: number
  steel?: number
  /** Opinion it gives the partner (before the soft cap and any bonus), and how fast that fades each month. */
  boost: number
  decay: number
  /** The opinion line it shows under in the partner's list of reasons. */
  label: string
  /** Months before the same partner can be given this again. */
  cooldown: number
  /** Months a running program lasts, and its monthly bill. */
  months?: number
  upkeep?: number
  /** Their opinion of you must be at least this for them to take it (rivals; before the difficulty adjustment). */
  minOpinion: number
  /** True for what a real person does: it needs an embassy first. */
  embassy?: 'embassy' | 'attache'
}

const spec = (s: ActSpec): ActSpec => s

/** Actions that do not appear here (callFavour, ask, answer, closeEmbassy, endProgram, endPlan, strikeWindow) are bookkeeping, not gifts. */
export const ACTS: Partial<Record<RelateAct, ActSpec>> = {
  visit: spec({ name: 'State visit', group: 'goodwill', blurb: 'Your leader goes to their capital. A big one-time boost; there is a risk if they dislike you.', money: 10, pp: 5, boost: 14, decay: 0.9, label: 'State visit', cooldown: 12, minOpinion: -25 }),
  culture: spec({ name: 'Cultural exchange', group: 'goodwill', blurb: 'Concerts, museums and exhibitions. Worth more between similar governments.', money: 12, pp: 1, boost: 9, decay: 0.45, label: 'Cultural exchange', cooldown: 9, minOpinion: -30 }),
  festival: spec({ name: 'Sports and arts festival', group: 'goodwill', blurb: 'Host a festival with them as guest of honour. Warm, but it fades fast.', money: 20, pp: 2, boost: 11, decay: 1.1, label: 'Festival guest', cooldown: 12, minOpinion: -20 }),
  recognise: spec({ name: 'Recognise their claims', group: 'repair', blurb: 'Accept their borders and government. If they hold a grievance against you, it is withdrawn.', money: 0, pp: 5, boost: 6, decay: 0.4, label: 'Recognised our claims', cooldown: 24, minOpinion: -40 }),
  apology: spec({ name: 'Apologise', group: 'repair', blurb: 'Say sorry for an incident. Softens their worst grudges; money makes it count for more.', money: 0, pp: 3, boost: 0, decay: 0, label: 'Apology', cooldown: 12, minOpinion: -80 }),
  support: spec({ name: 'Diplomatic support', group: 'goodwill', blurb: 'Back them publicly in the World Council while they are in a dispute. They owe you one.', money: 0, pp: 3, boost: 7, decay: 0.5, label: 'Backed us at the Council', cooldown: 6, minOpinion: -20 }),
  mediate: spec({ name: 'Mediate', group: 'repair', blurb: 'Broker talks between them and a rival they are at odds with. Both think better of you.', money: 0, pp: 5, boost: 8, decay: 0.5, label: 'Mediated for us', cooldown: 10, minOpinion: -20 }),
  embassy: spec({ name: 'Open an embassy', group: 'presence', blurb: 'A standing mission. Opens joint programs, shows you their real numbers, and slowly warms them.', money: 15, pp: 3, boost: 0, decay: 0.5, label: 'Embassy', cooldown: 12, upkeep: 0.8, minOpinion: -15 }),
  attache: spec({ name: 'Send a military attaché', group: 'presence', blurb: 'An officer with their staff: faster warmth, and military cooperation opens up.', money: 12, pp: 2, boost: 0, decay: 0.5, label: 'Military attaché', cooldown: 12, upkeep: 1.2, minOpinion: -5, embassy: 'embassy' }),
  students: spec({ name: 'Student exchange', group: 'economy', blurb: 'Students study abroad for a year. Both gain a little research, and warmth builds each month.', money: 14, pp: 2, boost: 4, decay: 0.4, label: 'Student exchange', cooldown: 12, months: 12, minOpinion: -5, embassy: 'embassy' }),
  science: spec({ name: 'Joint research', group: 'economy', blurb: 'Share a laboratory for a year: both of you gain research points every month.', money: 22, pp: 3, boost: 5, decay: 0.4, label: 'Joint research', cooldown: 18, months: 12, minOpinion: 5, embassy: 'embassy' }),
  tradeMission: spec({ name: 'Trade mission', group: 'economy', blurb: 'Open routes for a year: a little more money for both of you, and goodwill from traders.', money: 10, pp: 2, boost: 7, decay: 0.6, label: 'Trade mission', cooldown: 12, months: 12, minOpinion: -10 }),
  tariff: spec({ name: 'Preferential tariffs', group: 'economy', blurb: 'Lower duties on each other for two years. Needs a running trade deal.', money: 5, pp: 4, boost: 4, decay: 0.3, label: 'Preferential tariffs', cooldown: 24, months: 24, minOpinion: 5, embassy: 'embassy' }),
  venture: spec({ name: 'Joint venture', group: 'economy', blurb: 'Co-invest in one of their business sectors: both pay half, both share the yield. Walking away costs goodwill.', money: 0, pp: 3, boost: 6, decay: 0.3, label: 'Joint venture', cooldown: 6, minOpinion: 15, embassy: 'embassy' }),
  aid: spec({ name: 'Aid in kind', group: 'aid', blurb: 'Food, oil or steel. Worth far more when they are short of it, and then they owe you a favour.', money: 0, pp: 1, boost: 0, decay: 0.35, label: 'Aid in kind', cooldown: 3, minOpinion: -50 }),
  forgive: spec({ name: 'Forgive a debt', group: 'aid', blurb: 'Write off a loan or reparations they owe you. They owe you a favour.', money: 0, pp: 0, boost: 0, decay: 0.3, label: 'Forgave our debt', cooldown: 3, minOpinion: -100 }),
  techShare: spec({ name: 'Share a technology', group: 'aid', blurb: 'Hand them one of your technologies. A great gift, and it makes them stronger.', money: 0, pp: 4, tp: 6, boost: 16, decay: 0.6, label: 'Shared technology', cooldown: 18, minOpinion: 15 }),
  cede: spec({ name: 'Cede a border country', group: 'aid', blurb: 'Give them a country on your border. The grandest gift there is, and it cannot be taken back.', money: 0, pp: 12, boost: 24, decay: 0.5, label: 'Ceded us land', cooldown: 36, minOpinion: 25 }),
  exercise: spec({ name: 'Joint exercises', group: 'military', blurb: 'Your forces train beside theirs. Needs an attaché.', money: 12, pp: 2, boost: 8, decay: 0.6, label: 'Joint exercises', cooldown: 10, minOpinion: 10, embassy: 'attache' }),
  armsSale: spec({ name: 'Arms sale', group: 'military', blurb: 'Sell them weapons: you earn money, they feel better armed. Needs arms exports on.', money: 0, pp: 1, steel: 4, boost: 3, decay: 0.4, label: 'Arms sale', cooldown: 6, minOpinion: 10 }),
  training: spec({ name: 'Training mission', group: 'military', blurb: 'Send instructors. Warm, and it shows you their forces for six months. Needs an attaché.', money: 10, pp: 2, boost: 9, decay: 0.7, label: 'Training mission', cooldown: 12, minOpinion: 10, embassy: 'attache' }),
  intelShare: spec({ name: 'Share intelligence', group: 'military', blurb: 'Both services open their files to each other for a year. For friends only.', money: 0, pp: 2, boost: 6, decay: 0.5, label: 'Shared intelligence', cooldown: 12, minOpinion: 25, embassy: 'embassy' }),
  basing: spec({ name: 'Basing rights', group: 'military', blurb: 'Let their forces use your ports and airfields for two years. A mark of real trust.', money: 0, pp: 4, boost: 10, decay: 0.3, label: 'Basing rights', cooldown: 24, months: 24, minOpinion: 30, embassy: 'attache' }),
  sanction: spec({ name: 'Join their sanctions', group: 'military', blurb: 'Cut trade with the nation they are sanctioning.', money: 0, pp: 8, boost: 10, decay: 0.5, label: 'Joined our sanctions', cooldown: 12, minOpinion: 5 }),
  warPlan: spec({ name: 'Joint war plan', group: 'plans', blurb: 'A short operational alliance against an enemy you are both fighting. Strike the same country together; the one who does not take it is paid a share.', money: 0, pp: 5, boost: 4, decay: 0.3, label: 'Joint war plan', cooldown: 12, minOpinion: 10 }),
}

/** Favours: what calling one in asks of them. */
export const FAVOUR_ASKS = {
  money: { name: 'A loan of money', text: 'They hand over money', amount: 25, keep: 70 },
  influence: { name: 'Diplomatic backing', text: 'They spend their name on your behalf', amount: 4, keep: 15 },
  research: { name: 'Research notes', text: 'They share research', amount: 6, keep: 10 },
} as const

/** What a nation in need is worth helping with: price of a unit of aid in opinion, and how much need multiplies it. */
export const AID = {
  perMoney: 0.25,
  min: 3,
  max: 16,
  needMult: { dire: 2.2, short: 1.4, ok: 1, flush: 0.4 },
  amounts: [8, 16, 32] as const,
}

/** Gentleness of a venture and of other programs, and what they pay. */
export const PROGRAMS = {
  /** Research each partner gains each month while a program runs. */
  researchPerMonth: { students: 0.4, science: 1.0 } as Record<string, number>,
  /** Money a trade route or tariff deal adds each month to each partner. */
  routeMoney: 1.2,
  tariffMoney: 1.6,
  /** Opinion each month while a program runs, and the ceiling of it. */
  steady: { students: [0.5, 8], science: [0.6, 10], route: [0.3, 6], tariff: [0.3, 6], basing: [0.3, 8], venture: [0.5, 10] } as Record<string, [number, number]>,
  /** Venture: each side pays this much (min, max) and gets this share of it back each month as yield. */
  venture: { min: 30, max: 200, yield: 0.012, walkOutOpinion: -6, walkOutRefund: 0.5, mine: 0.5 },
  /** Walking out of a running program costs this much goodwill. */
  walkOutOpinion: -4,
}

/** Visit risk: below this opinion a state visit may go wrong; above the good line it may go very well. */
export const VISIT = { riskBelow: -5, incident: 0.3, incidentCost: -8, warmAbove: 25, warm: 0.25, warmBonus: 4 }

export const PARTNER_PINS_KEY = 'ww.relations.pins'
