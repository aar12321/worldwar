import type { FactionCharter, PoolResource } from '../engine/types'

/** The rules of factions in one place. */
export const FACTION = {
  maxMembers: 8,
  nameMin: 3,
  nameMax: 28,
  /** Influence it takes to found a faction. */
  foundInfluence: 15,
  /** Influence a faction contract proposal costs. */
  contractInfluence: 3,
  /** Months an invitation stays open. */
  inviteMonths: 3,
  /** Influence it costs to ask a faction to take you in. */
  requestInfluence: 5,
  /** Months a request stays open with the players in a faction. */
  requestMonths: 3,
  /** Months a proposal can be voted on, counted from the month it was put forward (the first vote month is the next one). */
  voteMonths: 2,
  /** Months what you put in stays locked after your last contribution. */
  lockMonths: 2,
  /** Share of the money and materials a leaver gives up when the charter refunds. It stays in the pool. */
  exitFee: 0.1,
  /** Proposals open at once in one faction. */
  maxOpen: 3,
  /** Half of the weight must vote for a proposal to be decided when its time runs out. */
  quorum: 0.5,
  maxContractMonths: 12,
  maxStartMonths: 6,
  maxContractAmount: 200,
  maxCollateral: 500,
  /** The pooled army can attack this many times a month at most, when the faction is big enough for two fronts. */
  attacksPerMonth: 2,
  /** Members needed for the second attack. */
  secondAttackMembers: 3,
  /** Most of the pooled army that deserts in a month when its upkeep cannot be paid. */
  desertCap: 0.5,
  /** The pool buys the oil and food its army needs on the world market at this markup when its stores run out. */
  marketMarkup: 1.15,
  /** Good will between the members of one faction. */
  opinionBonus: 12,
  /** How the other members feel about one who breaks a contract with the pool. */
  breachOpinion: -25,
  /** How many lines of news a faction keeps. */
  history: 40,
  /** Fixed values of what goes into the pool, so a share cannot be moved by the swings of the market. Soldiers count at what they cost to raise. */
  price: { money: 1, oil: 2, steel: 1.8, goods: 1.1, food: 1.3 } as Record<PoolResource, number>,
}

export const DEFAULT_CHARTER: FactionCharter = { vote: 'majority', spoils: 'share', exit: 'refund' }

export const POOL_NAMES: Record<PoolResource, string> = { money: 'Money', oil: 'Oil', steel: 'Steel', goods: 'Goods', food: 'Food' }

export const CHARTER_TEXT = {
  vote: { majority: 'One member, one vote', weighted: 'Votes weighted by ownership share' },
  spoils: { share: 'Conquered land is split by share', proposer: 'Conquered land goes to who proposed the war' },
  exit: { refund: 'Leavers take back what is left, less 10%', forfeit: 'Leavers leave everything behind' },
} as const

/** Names the AI gives a faction it founds. */
export const FACTION_WORDS = ['Concord', 'League', 'Compact', 'Syndicate', 'Consortium', 'Accord', 'Venture', 'Front', 'Pact', 'Union']
