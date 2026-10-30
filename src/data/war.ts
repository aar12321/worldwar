import type { UnitType } from '../engine/types'

/** A country can be in at most this many wars at once. */
export const MAX_WARS = 3

export type Commit = 'probe' | 'main' | 'allin'
export type Stance = 'assault' | 'blitz' | 'siege'

export const COMMITS: Record<Commit, { name: string; share: number; blurb: string }> = {
  probe: { name: 'Probe', share: 0.33, blurb: 'A third of your military. Keeps your home safe.' },
  main: { name: 'Main force', share: 0.66, blurb: 'Two thirds of your military.' },
  allin: { name: 'All in', share: 1, blurb: 'Everything. Hits hardest, leaves home thin.' },
}

export interface StanceSpec {
  name: string
  /** How far a win pushes the Defense Line. */
  advance: number
  /** Multiplier on the losses the attacker takes. */
  ownLosses: number
  /** One-off money cost to launch. */
  cost: number
  /** Multipliers on each unit type's attack. */
  boost: Partial<Record<UnitType, number>>
  /** Turns the target country's factories stop producing. */
  siegeTurns: number
  blurb: string
}

export const STANCES: Record<Stance, StanceSpec> = {
  assault: { name: 'Assault', advance: 1, ownLosses: 1, cost: 0, boost: {}, siegeTurns: 0, blurb: 'Balanced. No surprises.' },
  blitz: {
    name: 'Blitz',
    advance: 1.4,
    ownLosses: 1.3,
    cost: 8,
    boost: { armor: 1.3, air: 1.3 },
    siegeTurns: 0,
    blurb: 'Armor and air lead. Breaks the line faster, costs more units and money.',
  },
  siege: {
    name: 'Siege',
    advance: 0.7,
    ownLosses: 0.7,
    cost: 0,
    boost: { infantry: 1.15, naval: 1.15 },
    siegeTurns: 2,
    blurb: 'Slow and cheap in lives. Their factories stop for 2 months.',
  },
}

export const WAR = {
  /** Defense Line points: base + workforce + barracks + capital. */
  lineBase: 2,
  linePerWorkforce: 0.45,
  linePerBarracks: 0.5,
  lineCapital: 2,
  /** Line points a country heals each month it is not attacked. */
  healPerTurn: 0.8,
  healPerBarracks: 0.15,
  /** Line points pushed by a win at even power. */
  advanceBase: 2.2,
  minPowerRatio: 0.5,
  maxPowerRatio: 3,
  maxAttacksPerTurn: 3,
  /** Share of strength committed units lose as defenders until the turn ends. */
  exposedDefenseLoss: 0.5,
  /** Monthly bill per war. */
  billBase: 4,
  billPerUnit: 0.08,
  billPerEnemyWorkforce: 0.2,
  /** Where a freshly conquered country's line starts, as a share of its maximum. */
  capturedLine: 0.4,
  /** Months for conquered land to be fully yours. */
  integrationTurns: 12,
  integrationFloor: 0.4,
  /** Conquered countries beyond this many each cost stability. */
  overextendFree: 2,
  overextendPenalty: 3,
  /** Weariness each month, per war, plus a little more the longer it lasts. */
  weariness: 0.4,
  wearinessPerMonth: 0.03,
  wearinessPerMonthCap: 1.2,
}
