import type { TechBranch, UnitType } from '../engine/types'
import type { PolicyEffects } from './government'

export interface TechModifiers {
  /** Changes to how the economy runs: business growth, trade, research, and so on. */
  policy?: Partial<PolicyEffects>
  unitAttack?: Partial<Record<UnitType, number>>
  unitDefense?: Partial<Record<UnitType, number>>
  combinedArms?: number
  ignoreMountainPenalty?: boolean
  foodOutput?: number
  factoryOutput?: number
  jobsReduction?: number
  researchOutput?: number
  stability?: number
  ppPerTurn?: number
  allOutput?: number
  amphibiousPenaltyReduction?: number
}

export interface Tech {
  id: string
  name: string
  branch: TechBranch
  tier: number
  cost: number
  requires: string[]
  description: string
  unlocksUnit?: UnitType
  enablesSeaInvasion?: boolean
  modifiers: TechModifiers
}

export const BRANCH_LABELS: Record<TechBranch, string> = {
  land: 'Infantry & Armor',
  air: 'Aerospace',
  naval: 'Naval',
  infra: 'Infrastructure',
  economy: 'Economy',
}

export const TIER_COSTS = [0, 25, 70, 150, 260, 400, 580]

const t = (tech: Omit<Tech, 'cost'>): Tech => ({ ...tech, cost: TIER_COSTS[tech.tier] })

export const TECHS: Tech[] = [
  t({ id: 'land_rifles', name: 'Modern Infantry', branch: 'land', tier: 1, requires: [], unlocksUnit: 'infantry', description: 'Body armor, night vision and networked radios. Unlocks infantry divisions.', modifiers: {} }),
  t({ id: 'land_light_tanks', name: 'Armored Brigades', branch: 'land', tier: 2, requires: ['land_rifles'], unlocksUnit: 'armor', description: 'Main battle tanks and infantry fighting vehicles. Unlocks tanks.', modifiers: {} }),
  t({ id: 'land_artillery', name: 'Precision Artillery', branch: 'land', tier: 2, requires: ['land_rifles'], unlocksUnit: 'artillery', description: 'Guided shells and rocket launchers. Unlocks artillery, which grinds down Defense Lines.', modifiers: {} }),
  t({ id: 'land_mechanized', name: 'Mechanized Brigades', branch: 'land', tier: 3, requires: ['land_light_tanks'], description: 'Armored carriers for every battalion. Infantry +25%, tanks +10%.', modifiers: { unitAttack: { infantry: 0.25, armor: 0.1 }, unitDefense: { infantry: 0.2 } } }),
  t({ id: 'land_heavy_tanks', name: 'Active-Protection Tanks', branch: 'land', tier: 4, requires: ['land_mechanized'], description: 'Tanks that shoot down incoming missiles. Tank attack +35%.', modifiers: { unitAttack: { armor: 0.35 }, unitDefense: { armor: 0.2 } } }),
  t({ id: 'land_doctrine', name: 'Joint Operations Doctrine', branch: 'land', tier: 5, requires: ['land_heavy_tanks'], description: 'Land, air, sea and cyber fight as one. Combined-arms bonus +15%.', modifiers: { combinedArms: 0.15, unitAttack: { infantry: 0.1, armor: 0.1 } } }),
  t({ id: 'land_exosuits', name: 'Exosuits', branch: 'land', tier: 6, requires: ['land_doctrine'], description: 'Powered armor for every soldier. Infantry +60% and no mountain penalty.', modifiers: { unitAttack: { infantry: 0.6 }, unitDefense: { infantry: 0.5 }, ignoreMountainPenalty: true } }),

  t({ id: 'air_propeller', name: 'Multirole Fighters', branch: 'air', tier: 1, requires: [], unlocksUnit: 'fighter', description: 'Fourth-generation jets. Unlocks fighters, which win the air.', modifiers: {} }),
  t({ id: 'air_bombers', name: 'Strike Aircraft', branch: 'air', tier: 2, requires: ['air_propeller'], unlocksUnit: 'air', description: 'Long-range strike jets. Unlocks strike aircraft (bombers), which strike hard if you hold the air.', modifiers: {} }),
  t({ id: 'air_jets', name: 'Fifth-Generation Fighters', branch: 'air', tier: 2, requires: ['air_propeller'], description: 'Stealthy, networked jets. Fighter and bomber attack +30%.', modifiers: { unitAttack: { air: 0.3, fighter: 0.3 } } }),
  t({ id: 'air_radar', name: 'Integrated Air Defense', branch: 'air', tier: 3, requires: ['air_jets'], description: 'Radar and missile batteries. Fighter and bomber defense +25%, infantry defense +10%.', modifiers: { unitDefense: { air: 0.25, fighter: 0.25, infantry: 0.1 } } }),
  t({ id: 'air_stealth', name: 'Stealth Strike Aircraft', branch: 'air', tier: 4, requires: ['air_radar'], description: 'Nearly invisible deep strike. Bomber attack +40%.', modifiers: { unitAttack: { air: 0.4 } } }),
  t({ id: 'air_missiles', name: 'Precision Missiles', branch: 'air', tier: 5, requires: ['air_stealth'], description: 'Precision munitions. Planes +20%, tanks and artillery +10%.', modifiers: { unitAttack: { air: 0.2, fighter: 0.2, armor: 0.1, artillery: 0.1 } } }),
  t({ id: 'air_satellites', name: 'Orbital Satellites', branch: 'air', tier: 6, requires: ['air_missiles'], description: 'Eyes in orbit. All defense +10%.', modifiers: { unitDefense: { infantry: 0.1, armor: 0.1, artillery: 0.1, fighter: 0.1, air: 0.1, naval: 0.1 } } }),

  t({ id: 'naval_gunboats', name: 'Patrol Vessels', branch: 'naval', tier: 1, requires: [], unlocksUnit: 'naval', description: 'Coastal patrol and missile boats. Unlocks warships.', modifiers: {} }),
  t({ id: 'naval_destroyers', name: 'Guided-Missile Destroyers', branch: 'naval', tier: 2, requires: ['naval_gunboats'], enablesSeaInvasion: true, description: 'Ocean escorts. Naval attack +30%, and landings launched from your ports lose less strength.', modifiers: { unitAttack: { naval: 0.3 }, amphibiousPenaltyReduction: 0.25 } }),
  t({ id: 'naval_submarines', name: 'Attack Submarines', branch: 'naval', tier: 3, requires: ['naval_destroyers'], description: 'Silent hunters. Naval attack +25%.', modifiers: { unitAttack: { naval: 0.25 } } }),
  t({ id: 'naval_amphibious', name: 'Amphibious Doctrine', branch: 'naval', tier: 4, requires: ['naval_submarines'], description: 'Landing craft. Sea invasion penalty halved.', modifiers: { amphibiousPenaltyReduction: 0.5 } }),
  t({ id: 'naval_carriers', name: 'Aircraft Carriers', branch: 'naval', tier: 5, requires: ['naval_amphibious'], description: 'Floating airfields. Warships +40%, planes +10%.', modifiers: { unitAttack: { naval: 0.4, air: 0.1, fighter: 0.1 } } }),
  t({ id: 'naval_bluewater', name: 'Blue-Water Navy', branch: 'naval', tier: 6, requires: ['naval_carriers'], description: 'Global power projection. Naval defense +30%, sea landings lose far less strength.', modifiers: { amphibiousPenaltyReduction: 0.25, unitDefense: { naval: 0.3 } } }),

  t({ id: 'eco_banking', name: 'Modern Banking', branch: 'economy', tier: 1, requires: [], description: 'Credit for new firms. Business grows 10% faster.', modifiers: { policy: { growth: 0.1 } } }),
  t({ id: 'eco_exchanges', name: 'Commodity Exchanges', branch: 'economy', tier: 2, requires: ['eco_banking'], description: 'Organized markets. 25% more room to trade each month.', modifiers: { policy: { trade: 0.25 } } }),
  t({ id: 'eco_mass_production', name: 'Mass Production', branch: 'economy', tier: 3, requires: ['eco_exchanges'], description: 'Assembly-line standards. Factory output +10%.', modifiers: { policy: { factory: 0.1 } } }),
  t({ id: 'eco_schools', name: 'Public Schools', branch: 'economy', tier: 4, requires: ['eco_mass_production'], description: 'Educated workers. Research +12% and stability +3.', modifiers: { policy: { research: 0.12, stability: 3 } } }),
  t({ id: 'eco_central_bank', name: 'Central Banking', branch: 'economy', tier: 5, requires: ['eco_schools'], description: 'Steady money. Business grows 15% faster and income +3%.', modifiers: { policy: { growth: 0.15, money: 0.03 } } }),
  t({ id: 'eco_global_trade', name: 'Global Trade Networks', branch: 'economy', tier: 6, requires: ['eco_central_bank'], description: 'Shipping lanes everywhere. 50% more room to trade and all output +8%.', modifiers: { policy: { trade: 0.5, output: 0.08 } } }),

  t({ id: 'infra_farming', name: 'Mechanized Farming', branch: 'infra', tier: 1, requires: [], description: 'Tractors and fertilizer. Food output +25%.', modifiers: { foodOutput: 0.25 } }),
  t({ id: 'infra_railways', name: 'Railway Networks', branch: 'infra', tier: 2, requires: ['infra_farming'], description: 'Rapid rail logistics. Factory output +10%, food +10%.', modifiers: { factoryOutput: 0.1, foodOutput: 0.1 } }),
  t({ id: 'infra_automation', name: 'Factory Automation', branch: 'infra', tier: 3, requires: ['infra_railways'], description: 'Assembly lines. Factory output +30%, jobs needed -25%.', modifiers: { factoryOutput: 0.3, jobsReduction: 0.25 } }),
  t({ id: 'infra_universities', name: 'Research Universities', branch: 'infra', tier: 4, requires: ['infra_automation'], description: 'National research grants. Tech output +40%.', modifiers: { researchOutput: 0.4 } }),
  t({ id: 'infra_propaganda', name: 'Propaganda Networks', branch: 'infra', tier: 5, requires: ['infra_universities'], description: 'Control the narrative. Stability +10, +1 PP per turn.', modifiers: { stability: 10, ppPerTurn: 1 } }),
  t({ id: 'infra_fusion', name: 'Fusion Grid', branch: 'infra', tier: 6, requires: ['infra_propaganda'], description: 'Limitless energy. All economic output +25%.', modifiers: { allOutput: 0.25 } }),
]

export const TECH_BY_ID: Record<string, Tech> = Object.fromEntries(TECHS.map((x) => [x.id, x]))
