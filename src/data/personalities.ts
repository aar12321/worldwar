import type { Personality } from '../engine/types'

export interface PersonalitySpec {
  name: string
  description: string
  /** Multiplies the nation's base aggression when deciding to declare war. */
  aggression: number
  /** Willingness to trade: lowers the price a deal must reach to be accepted. */
  dealAppetite: number
  /** Willingness to honour alliances and calls to arms. */
  loyalty: number
  /** Above 1 attacks at worse odds; below 1 waits for safer ones. */
  risk: number
  /** Baseline opinion of everyone. */
  temperament: number
  /** Bonus to accepting non-aggression pacts. */
  pactBias: number
}

export const PERSONALITIES: Record<Personality, PersonalitySpec> = {
  expansionist: {
    name: 'Expansionist',
    description: 'Hungry for land. Distrusts neighbors and dislikes treaties that tie its hands.',
    aggression: 1.4,
    dealAppetite: 0.85,
    loyalty: 0.7,
    risk: 1.15,
    temperament: -6,
    pactBias: -15,
  },
  trader: {
    name: 'Merchant',
    description: 'Prefers profit to war. Trades readily and pays a premium for what it needs.',
    aggression: 0.6,
    dealAppetite: 1.4,
    loyalty: 0.9,
    risk: 0.85,
    temperament: 6,
    pactBias: 10,
  },
  turtle: {
    name: 'Isolationist',
    description: 'Fortifies its borders and signs pacts, but rarely marches to war.',
    aggression: 0.45,
    dealAppetite: 1,
    loyalty: 0.8,
    risk: 0.7,
    temperament: 0,
    pactBias: 15,
  },
  opportunist: {
    name: 'Opportunist',
    description: 'Strikes the distracted and the weak. Loyal only while it pays.',
    aggression: 1.05,
    dealAppetite: 1,
    loyalty: 0.45,
    risk: 1.05,
    temperament: -2,
    pactBias: -5,
  },
  honorable: {
    name: 'Honorable',
    description: 'Keeps its word, defends its allies, and never betrays a friend.',
    aggression: 0.8,
    dealAppetite: 1.1,
    loyalty: 1.4,
    risk: 0.9,
    temperament: 5,
    pactBias: 5,
  },
}
