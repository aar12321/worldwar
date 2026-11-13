import type { UnitType } from '../engine/types'

/** A country can be in at most this many wars at once. */
/** Wars a small country can fight at once. Larger empires can fight more: see maxWars. */
export const MAX_WARS = 3

/** What it takes to hold the world. */
export const EMPIRE = {
  /** One more war allowed for every this many countries you control, up to the cap. */
  warsPerRegions: 12,
  maxWarsCap: 8,
  /** Unsettled countries you can hold before stability suffers, plus one for every this many you control. */
  settleRegions: 4,
  /** A defeated nation whose capital has fallen gives up entirely when its army is under this many divisions. */
  surrenderUnits: 3,
  /** Or when its army is under this share of a player conqueror's. */
  surrenderShare: 0.2,
  /** Months a puppet must serve before it can be annexed, and the influence that costs per country. */
  annexMonths: 3,
  annexCost: 20,
  /** One more attack a month for every this many countries you control, up to the cap. */
  attacksPerRegions: 6,
  /** One more training slot for every this many countries you control. */
  slotsPerRegions: 3,
  /** Influence each country adds every month, for the officials who run it. */
  influencePerRegion: 0.15,
  maxAttacksCap: 9,
  /** Most war score a puppet can cost, however big the nation. A broken giant still bows. */
  puppetCap: 80,
  annexInfamy: 2,
  /** Share of a fallen nation's treasury its conqueror takes. */
  spoilsShare: 0.4,
  /** Money a governor leaves untouched. */
  governorReserve: 80,
}

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
    boost: { armor: 1.3, air: 1.3, fighter: 1.15 },
    siegeTurns: 0,
    blurb: 'Tanks and planes lead. Breaks the line faster, costs more units and money.',
  },
  siege: {
    name: 'Siege',
    advance: 0.7,
    ownLosses: 0.7,
    cost: 0,
    boost: { infantry: 1.15, naval: 1.15, artillery: 1.25 },
    siegeTurns: 2,
    blurb: 'Infantry and warships grind it out. Slow, cheap in lives, and their factories stop for 2 months.',
  },
}

export const WAR = {
  /** Artillery: the share of the attacking force that counts, and how much each share adds to the push. */
  artilleryCap: 0.35,
  artilleryAssault: 1.2,
  artillerySiege: 2.4,
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
  integrationTurns: 6,
  integrationFloor: 0.4,
  /** Conquered countries beyond this many each cost stability. */
  overextendFree: 2,
  overextendPenalty: 3,
  /** Weariness each month, per war, plus a little more the longer it lasts. */
  weariness: 0.4,
  wearinessPerMonth: 0.03,
  wearinessPerMonthCap: 1.2,
}

/** What it takes to start a war, and what starting one costs your standing. */
export const JUSTIFY = {
  /** Influence to open a case against a country. */
  caseCost: 20,
  /** Months until a case is ready. */
  caseMonths: 3,
  /** How long a reason for war stays usable. */
  reasonTurns: 12,
  /** Influence for a war with no reason. */
  noReasonCost: 60,
  noReasonStability: 10,
  /** Reputation (infamy) gained. Taking land also adds some. */
  infamyNoReason: 25,
  infamyWithReason: 4,
  infamyCapture: 5,
  infamyCaught: 10,
  /** Infamy fades by this share each month, and by this much more. */
  infamyFade: 0.04,
  infamyFadeFlat: 0.3,
  /** Monthly chance of a border incident between two neighbors that dislike each other. */
  incidentChance: 0.05,
  incidentOpinion: -15,
}
