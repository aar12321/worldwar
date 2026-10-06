import type { BuildingType, LawId, ProposalKind, TradeResource, UnitType } from '../engine/types'

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

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  infantry: { name: 'Infantry', attack: 1, defense: 1.2, capitalCost: 10, manpowerCost: 10, upkeep: 0.6, food: 0.3, requiresBuilding: 'barracks' },
  armor: { name: 'Armor', attack: 2.4, defense: 1.6, capitalCost: 25, manpowerCost: 5, upkeep: 1.4, food: 0.2, requiresBuilding: 'barracks' },
  air: { name: 'Air Wing', attack: 2.2, defense: 0.8, capitalCost: 30, manpowerCost: 3, upkeep: 1.5, food: 0.1, requiresBuilding: 'factory' },
  naval: { name: 'Fleet', attack: 1.6, defense: 1.4, capitalCost: 35, manpowerCost: 4, upkeep: 1.6, food: 0.15, requiresBuilding: 'port' },
}

export interface BuildingSpec {
  name: string
  cost: number
  description: string
  requiresCoast?: boolean
  /** Per-region cap, if lower than the global one. */
  max?: number
}

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  factory: { name: 'Factory', cost: 40, description: '+Capital each turn; lets you build air wings.' },
  farm: { name: 'Farm', cost: 25, description: '+Food each turn.' },
  university: { name: 'University', cost: 45, description: '+Tech Points each turn.' },
  barracks: { name: 'Barracks', cost: 30, description: 'Recruit infantry and armor; strengthens the garrison and keeps local troops supplied.' },
  port: { name: 'Port', cost: 35, description: 'Trade income, fleets, sea supply, and sea invasions. Supplies armies one step inland.', requiresCoast: true },
  depot: { name: 'Supply Depot', cost: 30, description: 'A forward logistics hub: armies within full supply range of it stay fed. Razed on capture.', max: 1 },
}

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
  capital: { name: 'Capital', short: 'Cap', base: 1, reference: 120 },
  food: { name: 'Food', short: 'Food', base: 1.3, reference: 60 },
  tp: { name: 'Tech Points', short: 'TP', base: 2.2, reference: 40 },
  manpower: { name: 'Manpower (k)', short: 'Men', base: 0.12, reference: 400 },
}

export const TRADE_LIMITS = { maxMonths: 12, maxAmount: 500 }

export const DRAFT_LIMITS = { min: 0.02, max: 0.2, maxWithConscription: 0.35 }
export const TAX_LIMITS = { min: 0.05, max: 0.6 }
