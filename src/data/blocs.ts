import type { BlocGoalKind, BlocRole } from '../engine/types'

/**
 * The bloc rules in one place (docs/BLOC_STATUS.md). A faction plays as an alliance bloc: a season's shared objective, prestige that
 * unlocks perks, roles for the members, calls to arms answered with one click, and joint operations that members pledge their own
 * divisions to. `on` switches the whole layer: off, factions play exactly as before (the turn goldens prove it).
 */
export const BLOC = {
  on: true,
  /** Prestige needed for each level, from level 1. */
  levels: [0, 30, 80, 150, 250],
  /** Months in a season: one objective at a time. */
  seasonMonths: 3,
  goalPrestige: 40,
  /** Influence each member gets when an objective is met. */
  goalInfluence: 3,
  opWinPrestige: 15,
  opCapturePrestige: 25,
  joinPrestige: 5,
  /** Operations open at once in one bloc, and finished ones kept for their reports. */
  maxOps: 2,
  keepDone: 3,
  /** Turn games: D-Day is 1 to 3 months away. Live games: 5 to 45 days. */
  turnWhen: [1, 3] as const,
  liveWhen: [5, 45] as const,
  /** Influence a member pays to plan an operation, and the leader to call the bloc to arms. */
  planInfluence: 2,
  callInfluence: 2,
  /** Combined arms: every member beyond the first that fights in an operation adds this to its attack, up to `maxExtra` of them. */
  perMember: 0.08,
  maxExtra: 3,
  /** Joint Production (level 5) adds this to every operation. */
  level5Bonus: 0.1,
  /** Shield: the role's countries defend this much harder. */
  shieldDefense: 0.1,
  /** Months a call to arms stays open (the month it was made, and this many more). */
  callMonths: 1,
  chatMax: 140,
  feedMax: 60,
  /** What a perk pays each member every month, per other member, with a ceiling. */
  market: { per: 1.5, max: 6 },
  research: { per: 0.4, max: 2 },
  production: { per: 1, max: 4 },
  /** What a role pays its member every month. */
  roleIncome: { arsenal: { steel: 2 }, breadbasket: { food: 3 }, spymaster: { tp: 1 }, shield: {} } as Record<BlocRole, { steel?: number; food?: number; tp?: number }>,
  leaderInfluence: 1,
  /** Objectives: how much is asked. */
  conquer: 2,
  arsenalGrowth: 0.25,
  outmatchRatio: 1.1,
  /**
   * Rival blocs choose a war (docs/BLOC_STATUS.md, "Rival operations"): a bloc at peace picks a weak neighbour it can beat together,
   * builds its case, declares, calls the members in and plans an operation on it. Off: rival blocs fight only wars a member started.
   */
  aiWars: true,
  /** The war of choice: its odds with every member that could join pledging, the most the target may weigh against the bloc, the monthly chance. */
  warOdds: 0.7,
  warPowerShare: 0.5,
  /** The leader's opinion of the target must be below this: a neighbour it is cool to, not a friend. */
  warOpinion: 10,
  /** Wars of choice only while at least this many nations are alive (the real world starts with 175), so a thinned world is not finished off. */
  warMinNations: 100,
  warChance: { normal: 0.2, hard: 0.3 },
  /** Operations a rival bloc plans with `aiWars` on: the least odds of the pledged force (Normal, Hard). */
  opFloor: { normal: 0.6, hard: 0.55 },
  /**
   * Live games: rival members answer a call to arms and pledge to an operation on the next day of the clock, not only when the month
   * turns, so a seven-day operation a player plans does not set out before they can answer. Off: they answer at the month's turn.
   */
  liveAnswers: true,
}

export const PERKS = [
  { level: 1, id: 'combined', name: 'Combined Arms', text: `Operations hit ${Math.round(BLOC.perMember * 100)}% harder for each member beyond the first that fights in them (up to +${Math.round(BLOC.perMember * BLOC.maxExtra * 100)}%).` },
  { level: 2, id: 'market', name: 'Common Market', text: `Every member earns ${BLOC.market.per} money a month for each other member (up to ${BLOC.market.max}).` },
  { level: 3, id: 'research', name: 'Shared Research', text: `Every member gains ${BLOC.research.per} research a month for each other member (up to ${BLOC.research.max}).` },
  { level: 4, id: 'defence', name: 'Mutual Defence', text: 'When a member goes to war, rival members join the call to arms at once, if they can.' },
  { level: 5, id: 'production', name: 'Joint Production', text: `Every member gains ${BLOC.production.per} steel a month for each other member (up to ${BLOC.production.max}), and operations hit ${Math.round(BLOC.level5Bonus * 100)}% harder.` },
] as const

export type PerkId = (typeof PERKS)[number]['id']

export const ROLES: { id: BlocRole; name: string; text: string; duty: string }[] = [
  { id: 'arsenal', name: 'Arsenal', text: `+${BLOC.roleIncome.arsenal.steel} steel a month.`, duty: 'Pledge armor and artillery to every operation.' },
  { id: 'shield', name: 'Shield', text: `Your countries defend ${Math.round(BLOC.shieldDefense * 100)}% harder.`, duty: 'Hold the front line; answer every defensive call.' },
  { id: 'breadbasket', name: 'Breadbasket', text: `+${BLOC.roleIncome.breadbasket.food} food a month.`, duty: 'Keep the bloc fed; trade food to members short of it.' },
  { id: 'spymaster', name: 'Spymaster', text: `+${BLOC.roleIncome.spymaster.tp} research a month, and you see the operations rival blocs are planning.`, duty: 'Watch rival blocs and warn the members.' },
]

export const GOALS: Record<BlocGoalKind, { name: string; text: string }> = {
  conquer: { name: 'Take new ground', text: `Members take ${BLOC.conquer} countries between them this season.` },
  hold: { name: 'Hold the line', text: 'No member loses a country this season.' },
  arsenal: { name: 'Arm the bloc', text: `The members' combined strength grows by ${Math.round(BLOC.arsenalGrowth * 100)}%.` },
  strike: { name: 'Win an operation', text: 'A joint operation wins its battle this season.' },
  grow: { name: 'Grow the bloc', text: 'A new member joins this season.' },
  defend: { name: 'Defend a member', text: 'A member at war keeps every country this season.' },
  outmatch: { name: 'Outmatch the rival bloc', text: `End the season ${Math.round((BLOC.outmatchRatio - 1) * 100)}% stronger than the strongest rival bloc.` },
}
