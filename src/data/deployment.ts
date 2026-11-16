import type { MissileType, UnitType, Via } from '../engine/types'

/** The kinds of force a posture splits: ground troops hold borders, warships patrol and screen, fighters and drones watch the air. */
export const GROUND_UNITS: UnitType[] = ['infantry', 'armor', 'artillery', 'robot']
export const NAVAL_UNITS: UnitType[] = ['naval']
export const AIR_UNITS: UnitType[] = ['fighter', 'drone']

/** The numbers behind Active Military: what a force on station does, and what it gives up. */
export const STATION = {
  /** A garrison on its own border defends this much harder than the same troops in reserve. */
  postBonus: 0.35,
  /** Ground troops posted on some other border fight at this share of their strength. */
  elsewhere: 0.5,
  /** Patrols and the air screen defend this much harder against a landing from the sea or air. */
  seaPostBonus: 0.35,
  /** Divisions of ground troops on a border for each of your countries along it, for a border to count as fully guarded. */
  fullPerRegion: 0.8,
  /** Defense Line points each division of garrison adds to a country on its border (divided over the countries along that border), and the most it adds in all. */
  linePerDivision: 0.7,
  lineCap: 3,
  /** A first strike on a border nobody guards makes the attacker this much stronger, in the first months of a war. */
  surpriseMax: 0.25,
  surpriseMonths: 1,
  /** A border garrison turns away this share of the provocations on a border it fully guards. */
  provocationStop: 0.6,
  /** Patrol divisions that count as watching the waters. */
  minPatrol: 0.25,
  /** How strongly each kind of patrol meets each kind of landing. A sea lane is a short crossing, the open ocean a long one. */
  patrolWeight: {
    land: { coastal: 0, subs: 0, air: 0 },
    lane: { coastal: 1, subs: 0.8, air: 0.5 },
    fleet: { coastal: 0.7, subs: 1.5, air: 0.6 },
    air: { coastal: 0.1, subs: 0, air: 1.5 },
  } as Record<Via, { coastal: number; subs: number; air: number }>,
  /** A landing is met by patrols: this share of the landing force is lost for each division of patrol per division landed, at most `interceptMax`. */
  interceptPerRatio: 0.2,
  interceptMax: 0.3,
  /** Air patrols shoot down this share of a missile salvo for each division on patrol, at most `missileStopMax`, scaled by the missile. */
  missileStopPer: 0.06,
  missileStopMax: 0.3,
  missileCatch: { cruise: 1, tactical: 0.7, hypersonic: 0.25, ballistic: 0 } as Record<MissileType, number>,
  /** Influence it costs to close a border. Reopening is free. */
  closeCost: 3,
}

/** Borders: how tense a pair of neighbors is, and what that does. */
export const BORDER = {
  baseLand: 10,
  baseSea: 5,
  war: 60,
  /** Tension an incident adds, and how much of it fades each month. */
  incidentHeat: 24,
  heatFade: 4,
  heatCap: 60,
  /** Troop buildup: tension for each division of garrison on either side of a land border, and the most it adds. */
  buildupPerDivision: 2.5,
  buildupCap: 18,
  /** The same for warships on patrol, along a sea border. */
  seaBuildupPerDivision: 1.5,
  seaBuildupCap: 12,
  closed: 10,
  grievance: 8,
  pact: -20,
  alliance: -35,
  puppet: -30,
  trade: -8,
  /** From this tension a border is disputed. */
  disputed: 60,
  /** A border where either side guards at least this much of it counts as fortified. */
  fortified: 0.75,
  /** Closing a border halves the provocations and adds this much to a garrison's cover. */
  closedIncidents: 0.5,
  closedCover: 0.25,
  /** How the neighbor feels about a closed border. */
  closedOpinion: -6,
  /** The most a border can multiply the chance of an incident. */
  incidentMax: 3,
  /** Pressure from posted troops and past incidents at which neighbors that do not dislike each other can still clash. */
  pressureEligible: 12,
}

export const BORDER_LABEL = { open: 'Open', fortified: 'Fortified', closed: 'Closed', disputed: 'Disputed' } as const
