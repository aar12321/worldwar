import type { PolicyEffects } from './government'
import type { BuildingType, LawId, ProposalKind, TradeResource, UnitCounts, UnitType } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'

export interface UnitSpec {
  name: string
  /** What the unit is for, in one line. */
  role: string
  attack: number
  defense: number
  capitalCost: number
  manpowerCost: number
  upkeep: number
  food: number
  /** Steel to build one. */
  steel: number
  /** Oil it burns each month. */
  oil: number
  requiresBuilding: BuildingType
}

/** Months after the order resolves before the unit joins the military. */
export const TRAIN_MONTHS: Record<UnitType, number> = {
  infantry: 1,
  armor: 2,
  artillery: 2,
  fighter: 2,
  air: 2,
  naval: 3,
  drone: 1,
  robot: 2,
  missile: 3,
}

/** Jobs a nation may have waiting beyond its training slots. */
export const TRAIN_QUEUE_LIMIT = 4

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  infantry: { name: 'Infantry', role: 'Cheap and steady. Best in cities, forests and mountains.', attack: 1, defense: 1.2, capitalCost: 10, manpowerCost: 10, upkeep: 0.6, food: 0.3, steel: 0, oil: 0, requiresBuilding: 'barracks' },
  armor: { name: 'Tanks', role: 'Hits hardest on plains and desert. Poor in mountains and cities.', attack: 2.4, defense: 1.6, capitalCost: 25, manpowerCost: 5, upkeep: 1.4, food: 0.2, steel: 3, oil: 0.15, requiresBuilding: 'barracks' },
  artillery: { name: 'Artillery', role: 'Big guns. Grinds down a Defense Line, best with a Siege. Weak if caught alone.', attack: 2, defense: 0.7, capitalCost: 28, manpowerCost: 4, upkeep: 1.3, food: 0.2, steel: 2, oil: 0.06, requiresBuilding: 'barracks' },
  fighter: { name: 'Fighters', role: 'Wins the air. The side with more fighters makes the other side\'s bombers far weaker.', attack: 1.2, defense: 1.4, capitalCost: 26, manpowerCost: 2, upkeep: 1.3, food: 0.1, steel: 2, oil: 0.1, requiresBuilding: 'factory' },
  air: { name: 'Strike Aircraft', role: 'Strikes first and hard. Useless if the enemy rules the air.', attack: 2.4, defense: 0.5, capitalCost: 32, manpowerCost: 3, upkeep: 1.5, food: 0.1, steel: 3, oil: 0.12, requiresBuilding: 'factory' },
  naval: { name: 'Warships', role: 'Fights only on coasts. A port lets you attack across the sea.', attack: 1.6, defense: 1.4, capitalCost: 35, manpowerCost: 4, upkeep: 1.6, food: 0.15, steel: 5, oil: 0.2, requiresBuilding: 'port' },
  drone: { name: 'Drone Swarms', role: 'Cheap and expendable, they take the first losses so your soldiers live. Deadly to tanks and guns. Interceptor shields and enemy fighters shoot them down; Cyber Command can jam them.', attack: 1.8, defense: 0.6, capitalCost: 12, manpowerCost: 0, upkeep: 0.4, food: 0, steel: 1, oil: 0.05, requiresBuilding: 'factory' },
  robot: { name: 'Robot Infantry', role: 'A line unit that needs no soldiers, strong in cities and mountains, and its losses never tire your people. Stronger Cyber Command on the other side can hack it.', attack: 1.6, defense: 2.2, capitalCost: 30, manpowerCost: 0, upkeep: 1.2, food: 0, steel: 4, oil: 0.1, requiresBuilding: 'factory' },
  missile: { name: 'Hypersonic Batteries', role: 'Strikes first, before the air war, and cracks the Defense Line directly. Can also hit a country far away. An Interceptor Shield stops a share of every salvo.', attack: 3, defense: 0.4, capitalCost: 45, manpowerCost: 0, upkeep: 1.8, food: 0, steel: 6, oil: 0.05, requiresBuilding: 'factory' },
}

export interface BuildingSpec {
  name: string
  /** Cost of the first level. Each further level costs more. */
  cost: number
  /** Highest level this country can reach. */
  max: number
  /** What each level does, in one line. */
  effect: string
  description: string
  requiresCoast?: boolean
}

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  factory: { name: 'Factory', cost: 40, max: 5, effect: '+6 money a month per level. Level N lets you buy weapon level N.', description: 'Heavy industry. It pays for everything else, and planes need one.' },
  farm: { name: 'Farm', cost: 25, max: 5, effect: '+3 food a month per level.', description: 'Feeds your people and your soldiers.' },
  university: { name: 'University', cost: 45, max: 5, effect: '+2.5 research a month per level.', description: 'Turns money into new technology.' },
  barracks: { name: 'Barracks', cost: 30, max: 5, effect: '+1 training slot and +0.75 defenders per level.', description: 'Trains infantry and tanks, and holds the border.' },
  port: { name: 'Port', cost: 35, max: 3, effect: '+3 money from trade per level. Warships and sea attacks need one.', description: 'Trade, warships, and attacks across the sea. Coastal countries only.', requiresCoast: true },
  civic: { name: 'Civic Hall', cost: 30, max: 3, effect: '+0.6 influence and +0.3 research a month per level.', description: 'Offices and schools.' },
}

/** Money for the next level of a building. Level 0 costs the base price. */
export function buildingCost(building: BuildingType, level: number): number {
  const step = Math.max(0, Math.floor(level))
  return Math.round(BUILDING_SPECS[building].cost * (1 + step * 0.6))
}

/** Training slots every nation has before any barracks. */
export const BASE_TRAIN_SLOTS = 2

export interface LawSpec {
  name: string
  cost: number
  description: string
  effects: Partial<PolicyEffects>
}

export const LAW_SPECS: Record<LawId, LawSpec> = {
  martial_law: { name: 'Martial Law', cost: 20, description: 'Stability +15, but all economic output -15%.', effects: { stability: 15, output: -0.15 } },
  war_economy: { name: 'War Economy', cost: 25, description: 'Factory output +25%, stability -10.', effects: { factory: 0.25, stability: -10 } },
  conscription_act: { name: 'Conscription Act', cost: 20, description: 'Raises the maximum draft rate from 20% to 35%.', effects: {} },
  free_trade: { name: 'Free Trade', cost: 25, description: 'The market keeps 3% instead of 8%, ports move 25% more, and businesses grow faster. Stability -2.', effects: { trade: 0.25, growth: 0.15, stability: -2 } },
  rationing: { name: 'Rationing', cost: 15, description: 'People eat 15% less and use 20% fewer goods. Stability -6.', effects: { foodUse: -0.15, goodsUse: -0.2, stability: -6 } },
  universal_healthcare: { name: 'Universal Healthcare', cost: 30, description: 'Stability +8. Costs 6% of your income.', effects: { stability: 8, money: -0.06 } },
  industrial_policy: { name: 'Industrial Policy', cost: 25, description: 'Factory output +12% and businesses grow faster. Costs 4% of your income.', effects: { factory: 0.12, growth: 0.1, money: -0.04 } },
  press_control: { name: 'Press Control', cost: 20, description: 'Influence +0.8 a month and stability +4, but research -8%.', effects: { influence: 0.8, stability: 4, research: -0.08 } },
  austerity: { name: 'Austerity', cost: 20, description: 'Upkeep -12% and 4% more income. Stability -8.', effects: { upkeep: -0.12, money: 0.04, stability: -8 } },
  research_grants: { name: 'Research Grants', cost: 25, description: 'Research +20%. Costs 5% of your income.', effects: { research: 0.2, money: -0.05 } },
}

export const DIPLOMACY = {
  loan: { min: 30, max: 400, minMonths: 3, maxMonths: 24, interest: 0.007 },
  sanctions: { cost: 15, months: 12, tradeCut: 0.2, minFloor: 0.2 },
  guarantee: { months: 36 },
  puppet: { tribute: 0.12, breakChance: 0.05, valueShare: 0.6, minValue: 20 },
}

export const COSTS = {
  declareWar: 25,
  declareWarWithCasusBelli: 10,
  leaveAlliance: 10,
  suppressRebels: 10,
  spy: 30,
}

export const PROPOSAL_COSTS: Record<ProposalKind, number> = {
  peace: 5,
  pact: 15,
  alliance: 25,
  trade: 5,
  callToArms: 10,
  loan: 5,
  guarantee: 10,
}

export const PROPOSAL_LABELS: Record<ProposalKind, string> = {
  peace: 'Peace treaty',
  pact: 'Non-aggression pact',
  alliance: 'Defensive alliance',
  trade: 'Trade deal',
  callToArms: 'Call to arms',
  loan: 'Loan',
  guarantee: 'Guarantee of independence',
}

/** Repeatable drilling. Rank 0 is Green; rank 5 is Guard. */
export const TRAINING = {
  max: 5,
  bonusPerLevel: 0.08,
  ranks: ['Green', 'Trained', 'Regular', 'Veteran', 'Elite', 'Guard'] as const,
}

export function trainingCost(level: number): number {
  return 12 * (Math.max(0, Math.min(TRAINING.max, Math.floor(level))) + 1)
}

export function trainingRank(level: number): string {
  const i = Math.max(0, Math.min(TRAINING.max, Math.floor(level)))
  return TRAINING.ranks[i]
}

/** Drill rank for each unit type. The army still fights as one force. */
export type UnitTraining = Record<UnitType, number>

export function emptyTraining(): UnitTraining {
  return { infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }
}

export function clampTraining(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.max(0, Math.min(TRAINING.max, Math.floor(level)))
}

/**
 * Older saves stored one rank for the whole army. That rank is copied onto
 * every unit type that still has troops.
 */
export function asTraining(raw: unknown, units?: UnitCounts): UnitTraining {
  if (raw && typeof raw === 'object') {
    const source = raw as Partial<UnitTraining>
    const out = emptyTraining()
    for (const k of UNIT_TYPES) out[k] = clampTraining(Number(source[k] ?? 0))
    return out
  }
  const rank = clampTraining(typeof raw === 'number' ? raw : 0)
  const out = emptyTraining()
  for (const k of UNIT_TYPES) {
    if (!units || units[k] > 0) out[k] = rank
  }
  return out
}

/** Permanent weapon levels. Each level raises one unit type's attack and defense. */
export const WEAPONS = {
  maxLevel: 5,
  bonusPerLevel: 0.06,
}

/** Money for the next weapon level. Level 0 costs 40. */
export function weaponCost(level: number): number {
  return Math.round(40 * (1 + 0.8 * Math.max(0, Math.floor(level))))
}

export interface MarketSpec {
  name: string
  short: string
  /** Value of one unit in Capital when the resource is at its reference abundance. */
  base: number
  /** Median per-nation stock at which the price equals `base`. */
  reference: number
}

/** World market. Prices rise when the median nation is short of a resource and fall when it is plentiful. */
export const MARKET: Record<TradeResource, MarketSpec> = {
  capital: { name: 'Money', short: 'Money', base: 1, reference: 120 },
  food: { name: 'Food', short: 'Food', base: 1.3, reference: 60 },
  tp: { name: 'Research', short: 'Research', base: 2.2, reference: 40 },
  manpower: { name: 'Soldiers', short: 'Soldiers', base: 0.12, reference: 400 },
  oil: { name: 'Oil', short: 'Oil', base: 2, reference: 14 },
  steel: { name: 'Steel', short: 'Steel', base: 1.8, reference: 12 },
  goods: { name: 'Goods', short: 'Goods', base: 1.1, reference: 20 },
}

export const TRADE_LIMITS = { maxMonths: 12, maxAmount: 500 }

export const DRAFT_LIMITS = { min: 0.02, max: 0.2, maxWithConscription: 0.35 }
export const TAX_LIMITS = { min: 0.05, max: 0.6 }
