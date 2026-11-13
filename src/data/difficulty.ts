import type { Difficulty } from '../engine/types'

export interface DifficultySpec {
  name: string
  description: string
  /** Bots attack a region only when their power exceeds its defense by this factor. */
  attackRatio: number
  /** Bots declare war only when they out-muscle the target by this factor. */
  warDeclarePowerRatio: number
  /** No bot declares war on the player before this turn. */
  playerGracePeriod: number
  /** How many bots may have declared war on the player at once. */
  maxWarsOnPlayer: number
  /** Extra tax and factory income for bots. */
  botIncomeBonus: number
  /** Chance per turn that a bot makes a noticeably poor decision. */
  mistakeRate: number
  aggression: number
  /** Scales how many units bots recruit each month, and across how many sites. */
  production: number
  /**
   * How much of the country a bot runs. 0 plays the basics. 1 also grows cities, sets budgets and laws,
   * and funds business. 2 also borrows, invests, sanctions, counters your units, and fights together with allies.
   */
  skill: 0 | 1 | 2
  /** Most alliances a bot keeps. */
  maxAlliances: number
  /** Whether neighbors band together against a runaway player. */
  coalitions: boolean
  /** Chance an opportunist drops a weak ally each month. */
  betrayal: number
}

export const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  easy: {
    name: 'Easy',
    description: 'Cautious rivals who play the basics, wait a long time before attacking you, and never band together against you.',
    attackRatio: 1.6,
    warDeclarePowerRatio: 2,
    playerGracePeriod: 30,
    maxWarsOnPlayer: 1,
    botIncomeBonus: 0,
    mistakeRate: 0.1,
    aggression: 0.6,
    production: 0.7,
    skill: 0,
    maxAlliances: 1,
    coalitions: false,
    betrayal: 0,
  },
  normal: {
    name: 'Medium',
    description: 'Rivals run their countries well: cities, budgets, laws and business. They form alliances and gang up on a runaway leader.',
    attackRatio: 1.3,
    warDeclarePowerRatio: 1.5,
    playerGracePeriod: 20,
    maxWarsOnPlayer: 2,
    botIncomeBonus: 0,
    mistakeRate: 0.05,
    aggression: 1,
    production: 1.2,
    skill: 1,
    maxAlliances: 2,
    coalitions: true,
    betrayal: 0.04,
  },
  hard: {
    name: 'Hard',
    description: 'Ruthless rivals with a richer economy. They borrow, invest, sanction, counter your army and fight side by side with allies.',
    attackRatio: 1.15,
    warDeclarePowerRatio: 1.3,
    playerGracePeriod: 10,
    maxWarsOnPlayer: 99,
    botIncomeBonus: 0.15,
    mistakeRate: 0.02,
    aggression: 1.25,
    production: 1.8,
    skill: 2,
    maxAlliances: 3,
    coalitions: true,
    betrayal: 0.08,
  },
}

export const difficultyOf = (d: Difficulty | undefined) => DIFFICULTY[d ?? 'normal']
