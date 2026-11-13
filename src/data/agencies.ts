export type AgencyId = 'foreign' | 'domestic'
export type ForeignOp = 'intel' | 'case' | 'sabotage' | 'rebels' | 'aid' | 'steal' | 'coup' | 'cyber'
export type DomesticOp = 'counter' | 'calm' | 'crackdown' | 'corruption'

export const AGENCY = {
  maxLevel: 5,
  /** Money to raise an agency one level, and what each level costs every month. */
  levelCost: 40,
  upkeepPerLevel: 1.5,
  /** Each success adds experience; each point adds this much to the odds, up to the cap. */
  expBonus: 0.01,
  expCap: 0.1,
  /** Techs known, as odds. */
  techBonus: 0.004,
  techCap: 0.08,
  /** Each partner (ally) adds this much, up to the cap. */
  partnerBonus: 0.03,
  partnerCap: 0.12,
  /** A target's own security takes this much per level of its domestic agency. */
  securityPerLevel: 0.05,
  counterBonus: 0.2,
  counterMonths: 12,
  /** How likely a failed operation is to be noticed, and what that costs. */
  caughtChance: 0.6,
  intelMonths: 12,
}

export interface OpSpec {
  name: string
  /** One line saying what success does. */
  effect: string
  money: number
  pp: number
  /** Agency level needed. */
  level: number
  /** How much harder it is than a plain operation. */
  hard: number
  /** A technology it needs. */
  tech?: string
  /** Only against a nation that is shaky. */
  needsShaky?: boolean
  /** A friendly act: failure costs nothing and nobody is angry. */
  friendly?: boolean
}

export const FOREIGN_OPS: Record<ForeignOp, OpSpec> = {
  intel: { name: 'Gather intelligence', effect: 'See their real strength, money and mood for a year.', money: 10, pp: 0, level: 1, hard: 0, friendly: true },
  case: { name: 'Build a case', effect: 'Dig up evidence of plotting. Gives you a reason for war with them.', money: 25, pp: 0, level: 1, hard: 0.1 },
  sabotage: { name: 'Sabotage industry', effect: 'Their factories in one country stop for 3 months.', money: 30, pp: 0, level: 2, hard: 0.15 },
  rebels: { name: 'Arm rebels', effect: 'Stirs a revolt in one of their countries and shakes their stability.', money: 35, pp: 5, level: 2, hard: 0.2 },
  aid: { name: 'Help them keep order', effect: 'Calms their unrest. They will remember it fondly.', money: 25, pp: 0, level: 1, hard: 0, friendly: true },
  steal: { name: 'Steal technology', effect: 'Copy a technology they have that you can use.', money: 40, pp: 0, level: 3, hard: 0.2 },
  coup: { name: 'Back a coup', effect: 'Install a friendly government. They become your puppet.', money: 80, pp: 20, level: 4, hard: 0.35, needsShaky: true },
  cyber: { name: 'Cyber attack', effect: 'Cripple their economy and drain their treasury for a few months.', money: 45, pp: 0, level: 3, hard: 0.2, tech: 'cyber_warfare' },
}

export const DOMESTIC_OPS: Record<DomesticOp, OpSpec> = {
  counter: { name: 'Hunt foreign agents', effect: 'For a year, foreign operations against you are much harder.', money: 15, pp: 0, level: 1, hard: 0 },
  calm: { name: 'Calm unrest', effect: 'Community policing and quiet talks. Stability +6.', money: 20, pp: 0, level: 1, hard: 0 },
  crackdown: { name: 'Break up rebels', effect: 'Dismantle the rebels in one of your countries.', money: 15, pp: 0, level: 2, hard: 0 },
  corruption: { name: 'Root out corruption', effect: 'Recover stolen money and win back public trust.', money: 10, pp: 0, level: 2, hard: 0 },
}

/** The agencies' names. The United States has the ones people know. */
export function agencyName(nationName: string, id: AgencyId): string {
  if (nationName === 'United States of America' || nationName === 'United States') return id === 'foreign' ? 'CIA' : 'FBI'
  return id === 'foreign' ? 'Intelligence Service' : 'Security Service'
}

export const AGENCY_ROLE: Record<AgencyId, string> = {
  foreign: 'Works abroad. Gathers intelligence, builds cases for war, sabotages, backs rebels and coups, steals technology.',
  domestic: 'Works at home. Hunts foreign agents, calms unrest, breaks up rebels and fights corruption.',
}

export function levelCost(level: number): number {
  return AGENCY.levelCost * (level + 1)
}
