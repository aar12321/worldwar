import type { BuildingType, LawId, UnitType } from '../engine/types'

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
}

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  factory: { name: 'Factory', cost: 40, description: '+Capital each turn; lets you build air wings.' },
  farm: { name: 'Farm', cost: 25, description: '+Food each turn.' },
  university: { name: 'University', cost: 45, description: '+Tech Points each turn.' },
  barracks: { name: 'Barracks', cost: 30, description: 'Recruit infantry and armor; strengthens the local garrison.' },
  port: { name: 'Port', cost: 35, description: 'Trade income, fleets, sea supply, and sea invasions.', requiresCoast: true },
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
  offerPeace: 5,
  offerPact: 15,
  suppressRebels: 10,
  spy: 30,
}

export const DRAFT_LIMITS = { min: 0.02, max: 0.2, maxWithConscription: 0.35 }
export const TAX_LIMITS = { min: 0.05, max: 0.6 }
