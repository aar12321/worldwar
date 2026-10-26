import type { BuildingType, LawId, ProposalKind, TradeResource, UnitCounts, UnitType } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'

export interface UnitSpec {
  name: string
  attack: number
  defense: number
  capitalCost: number
  manpowerCost: number
  upkeep: number
  food: number
  requiresBuilding: BuildingType
}

/** Months after the order resolves before the unit joins the military. */
export const TRAIN_MONTHS: Record<UnitType, number> = {
  infantry: 1,
  armor: 2,
  air: 2,
  naval: 3,
}

/** Jobs a nation may have waiting beyond its training slots. */
export const TRAIN_QUEUE_LIMIT = 4

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  infantry: { name: 'Infantry', attack: 1, defense: 1.2, capitalCost: 10, manpowerCost: 10, upkeep: 0.6, food: 0.3, requiresBuilding: 'barracks' },
  armor: { name: 'Armor', attack: 2.4, defense: 1.6, capitalCost: 25, manpowerCost: 5, upkeep: 1.4, food: 0.2, requiresBuilding: 'barracks' },
  air: { name: 'Air Wing', attack: 2.2, defense: 0.8, capitalCost: 30, manpowerCost: 3, upkeep: 1.5, food: 0.1, requiresBuilding: 'factory' },
  naval: { name: 'Fleet', attack: 1.6, defense: 1.4, capitalCost: 35, manpowerCost: 4, upkeep: 1.6, food: 0.15, requiresBuilding: 'port' },
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
  factory: { name: 'Factory', cost: 40, max: 5, effect: '+6 money a month per level. Level N lets you buy weapon level N.', description: 'Heavy industry. It pays for the war, and air wings need one.' },
  farm: { name: 'Farm', cost: 25, max: 5, effect: '+3 food a month per level.', description: 'Feeds your people and your soldiers.' },
  university: { name: 'University', cost: 45, max: 5, effect: '+2.5 research a month per level.', description: 'Turns money into new technology.' },
  barracks: { name: 'Barracks', cost: 30, max: 5, effect: '+1 training slot and +0.75 defenders per level.', description: 'Trains infantry and armor, and holds the border.' },
  port: { name: 'Port', cost: 35, max: 3, effect: '+3 money from trade per level. Fleets and sea attacks need one.', description: 'Trade, fleets, and invasions by sea. Coastal countries only.', requiresCoast: true },
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
}

export const LAW_SPECS: Record<LawId, LawSpec> = {
  martial_law: { name: 'Martial Law', cost: 20, description: 'Stability +15, but all economic output -15%.' },
  war_economy: { name: 'War Economy', cost: 25, description: 'Factory output +25%, stability -10.' },
  conscription_act: { name: 'Conscription Act', cost: 20, description: 'Raises the maximum draft rate from 20% to 35%.' },
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
}

export const PROPOSAL_LABELS: Record<ProposalKind, string> = {
  peace: 'Peace treaty',
  pact: 'Non-aggression pact',
  alliance: 'Defensive alliance',
  trade: 'Trade deal',
  callToArms: 'Call to arms',
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
  return { infantry: 0, armor: 0, air: 0, naval: 0 }
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
}

export const TRADE_LIMITS = { maxMonths: 12, maxAmount: 500 }

export const DRAFT_LIMITS = { min: 0.02, max: 0.2, maxWithConscription: 0.35 }
export const TAX_LIMITS = { min: 0.05, max: 0.6 }
