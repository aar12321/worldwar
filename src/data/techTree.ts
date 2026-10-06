import type { TechBranch, UnitType } from '../engine/types'

export interface TechModifiers {
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
  supplyRange?: number
  seaSupplyRange?: number
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
  globalVision?: boolean
  modifiers: TechModifiers
}

export const BRANCH_LABELS: Record<TechBranch, string> = {
  land: 'Infantry & Armor',
  air: 'Aerospace',
  naval: 'Naval',
  infra: 'Infrastructure',
}

export const TIER_COSTS = [0, 25, 70, 150, 260, 400, 580]

const t = (tech: Omit<Tech, 'cost'>): Tech => ({ ...tech, cost: TIER_COSTS[tech.tier] })

export const TECHS: Tech[] = [
  t({ id: 'land_rifles', name: 'Rifle Infantry', branch: 'land', tier: 1, requires: [], unlocksUnit: 'infantry', description: 'Standardized bolt-action rifles. Unlocks infantry divisions.', modifiers: {} }),
  t({ id: 'land_light_tanks', name: 'Light Tanks', branch: 'land', tier: 2, requires: ['land_rifles'], unlocksUnit: 'armor', description: 'Fast tracked vehicles. Unlocks armor divisions.', modifiers: {} }),
  t({ id: 'land_mechanized', name: 'Mechanized Infantry', branch: 'land', tier: 3, requires: ['land_light_tanks'], description: 'Trucks and half-tracks. Infantry +25%, armor +10%.', modifiers: { unitAttack: { infantry: 0.25, armor: 0.1 }, unitDefense: { infantry: 0.2 } } }),
  t({ id: 'land_heavy_tanks', name: 'Heavy Tanks', branch: 'land', tier: 4, requires: ['land_mechanized'], description: 'Thick armor, big guns. Armor attack +35%.', modifiers: { unitAttack: { armor: 0.35 }, unitDefense: { armor: 0.2 } } }),
  t({ id: 'land_doctrine', name: 'Combined Arms Doctrine', branch: 'land', tier: 5, requires: ['land_heavy_tanks'], description: 'Coordinated air-land operations. Combined-arms bonus +15%.', modifiers: { combinedArms: 0.15, unitAttack: { infantry: 0.1, armor: 0.1 } } }),
  t({ id: 'land_exosuits', name: 'Exosuits', branch: 'land', tier: 6, requires: ['land_doctrine'], description: 'Powered armor for every soldier. Infantry +60% and no mountain penalty.', modifiers: { unitAttack: { infantry: 0.6 }, unitDefense: { infantry: 0.5 }, ignoreMountainPenalty: true } }),

  t({ id: 'air_propeller', name: 'Propeller Planes', branch: 'air', tier: 1, requires: [], unlocksUnit: 'air', description: 'Monoplane fighters and bombers. Unlocks air wings.', modifiers: {} }),
  t({ id: 'air_jets', name: 'Jet Fighters', branch: 'air', tier: 2, requires: ['air_propeller'], description: 'Turbojet engines. Air attack +30%.', modifiers: { unitAttack: { air: 0.3 } } }),
  t({ id: 'air_radar', name: 'Radar Networks', branch: 'air', tier: 3, requires: ['air_jets'], description: 'Early warning grids. Air defense +25%, infantry defense +10%.', modifiers: { unitDefense: { air: 0.25, infantry: 0.1 } } }),
  t({ id: 'air_stealth', name: 'Stealth Bombers', branch: 'air', tier: 4, requires: ['air_radar'], description: 'Radar-evading strike craft. Air attack +40%.', modifiers: { unitAttack: { air: 0.4 } } }),
  t({ id: 'air_missiles', name: 'Guided Missiles', branch: 'air', tier: 5, requires: ['air_stealth'], description: 'Precision munitions. Air +20%, armor +10%.', modifiers: { unitAttack: { air: 0.2, armor: 0.1 } } }),
  t({ id: 'air_satellites', name: 'Orbital Satellites', branch: 'air', tier: 6, requires: ['air_missiles'], globalVision: true, description: 'Eyes in orbit. Reveals every army on the map; all defense +10%.', modifiers: { unitDefense: { infantry: 0.1, armor: 0.1, air: 0.1, naval: 0.1 } } }),

  t({ id: 'naval_gunboats', name: 'Coastal Gunboats', branch: 'naval', tier: 1, requires: [], unlocksUnit: 'naval', description: 'Brown-water patrol craft. Unlocks naval fleets.', modifiers: {} }),
  t({ id: 'naval_destroyers', name: 'Destroyers', branch: 'naval', tier: 2, requires: ['naval_gunboats'], enablesSeaInvasion: true, description: 'Ocean escorts. Naval +30% and enables attacks across sea lanes from ports.', modifiers: { unitAttack: { naval: 0.3 } } }),
  t({ id: 'naval_submarines', name: 'Submarines', branch: 'naval', tier: 3, requires: ['naval_destroyers'], description: 'Silent hunters. Naval attack +25%.', modifiers: { unitAttack: { naval: 0.25 } } }),
  t({ id: 'naval_amphibious', name: 'Amphibious Doctrine', branch: 'naval', tier: 4, requires: ['naval_submarines'], description: 'Landing craft. Sea invasion penalty halved.', modifiers: { amphibiousPenaltyReduction: 0.5 } }),
  t({ id: 'naval_carriers', name: 'Aircraft Carriers', branch: 'naval', tier: 5, requires: ['naval_amphibious'], description: 'Floating airfields. Naval +40%, air +10%.', modifiers: { unitAttack: { naval: 0.4, air: 0.1 } } }),
  t({ id: 'naval_bluewater', name: 'Blue-Water Navy', branch: 'naval', tier: 6, requires: ['naval_carriers'], description: 'Global power projection. Sea supply range +2.', modifiers: { seaSupplyRange: 2, unitDefense: { naval: 0.3 } } }),

  t({ id: 'infra_farming', name: 'Mechanized Farming', branch: 'infra', tier: 1, requires: [], description: 'Tractors and fertilizer. Food output +25%.', modifiers: { foodOutput: 0.25 } }),
  t({ id: 'infra_railways', name: 'Railway Networks', branch: 'infra', tier: 2, requires: ['infra_farming'], description: 'Rapid rail logistics. Supply range +1.', modifiers: { supplyRange: 1 } }),
  t({ id: 'infra_automation', name: 'Factory Automation', branch: 'infra', tier: 3, requires: ['infra_railways'], description: 'Assembly lines. Factory output +30%, jobs needed -25%.', modifiers: { factoryOutput: 0.3, jobsReduction: 0.25 } }),
  t({ id: 'infra_universities', name: 'Research Universities', branch: 'infra', tier: 4, requires: ['infra_automation'], description: 'National research grants. Tech output +40%.', modifiers: { researchOutput: 0.4 } }),
  t({ id: 'infra_propaganda', name: 'Propaganda Networks', branch: 'infra', tier: 5, requires: ['infra_universities'], description: 'Control the narrative. Stability +10, +1 PP per turn.', modifiers: { stability: 10, ppPerTurn: 1 } }),
  t({ id: 'infra_fusion', name: 'Fusion Grid', branch: 'infra', tier: 6, requires: ['infra_propaganda'], description: 'Limitless energy. All economic output +25%.', modifiers: { allOutput: 0.25 } }),
]

export const TECH_BY_ID: Record<string, Tech> = Object.fromEntries(TECHS.map((x) => [x.id, x]))
