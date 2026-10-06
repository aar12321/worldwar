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
}

export const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  easy: {
    name: 'Easy',
    description: 'Cautious rivals who rarely gang up on you.',
    attackRatio: 1.6,
    warDeclarePowerRatio: 2,
    playerGracePeriod: 18,
    maxWarsOnPlayer: 1,
    botIncomeBonus: 0,
    mistakeRate: 0.1,
    aggression: 0.6,
  },
  normal: {
    name: 'Normal',
    description: 'Rivals play like seasoned humans.',
    attackRatio: 1.3,
    warDeclarePowerRatio: 1.5,
    playerGracePeriod: 10,
    maxWarsOnPlayer: 2,
    botIncomeBonus: 0,
    mistakeRate: 0.05,
    aggression: 1,
  },
  hard: {
    name: 'Hard',
    description: 'Ruthless rivals with a richer economy.',
    attackRatio: 1.15,
    warDeclarePowerRatio: 1.3,
    playerGracePeriod: 6,
    maxWarsOnPlayer: 99,
    botIncomeBonus: 0.15,
    mistakeRate: 0.02,
    aggression: 1.25,
  },
}

export const difficultyOf = (d: Difficulty | undefined) => DIFFICULTY[d ?? 'normal']
