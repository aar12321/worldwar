import { TECH_BY_ID } from '../data/techTree'
import { TRAINING, UNIT_SPECS, WEAPONS, trainingRank } from '../data/unitTypes'
import { combatMods } from './arms'
import { COMBAT, hasCombinedArms } from './combat'
import { nationModifiers, totalUnits } from './helpers'
import { BASE_TRAIN_SLOTS } from '../data/unitTypes'
import type { GameState, NationId, UnitType } from './types'
import { UNIT_TYPES } from './types'

/** One thing that changes a unit's stats, so the player can see where a number comes from. */
export interface BonusSource {
  kind: 'tech' | 'weapons' | 'drill'
  label: string
  attack: number
  defense: number
}

export interface UnitStatLine {
  unit: UnitType
  name: string
  count: number
  baseAttack: number
  baseDefense: number
  /** After technology, weapons and drill. */
  attack: number
  defense: number
  weaponLevel: number
  drillRank: number
  drillName: string
  drillBonus: number
  /** What this unit adds to the nation's strength. */
  power: number
  sources: BonusSource[]
}

export interface MilitarySheet {
  units: UnitStatLine[]
  totalPower: number
  totalUnits: number
  upkeep: number
  foodUse: number
  combinedArms: boolean
  combinedArmsBonus: number
  trainingSlots: number
  trainingUsed: number
}

/** The numbers battle uses, laid out unit by unit with the source of each bonus. */
export function militarySheet(s: GameState, nationId: NationId): MilitarySheet {
  const n = s.nations[nationId]
  const mods = combatMods(n)
  const base = nationModifiers(n)
  const lines: UnitStatLine[] = UNIT_TYPES.map((unit) => {
    const spec = UNIT_SPECS[unit]
    const weaponLevel = n.military.weapons[unit] ?? 0
    const drillRank = n.military.drill[unit] ?? 0
    const drillBonus = drillRank * TRAINING.bonusPerLevel
    const count = n.military.units[unit]
    const attack = spec.attack * (1 + mods.unitAttack[unit]) * (1 + drillBonus)
    const defense = spec.defense * (1 + mods.unitDefense[unit]) * (1 + drillBonus)
    const sources: BonusSource[] = []
    for (const id of n.techs) {
      const mod = TECH_BY_ID[id]?.modifiers
      const a = mod?.unitAttack?.[unit] ?? 0
      const d = mod?.unitDefense?.[unit] ?? 0
      if (a || d) sources.push({ kind: 'tech', label: TECH_BY_ID[id].name, attack: a, defense: d })
    }
    if (weaponLevel > 0) sources.push({ kind: 'weapons', label: `Weapons level ${weaponLevel}`, attack: weaponLevel * WEAPONS.bonusPerLevel, defense: weaponLevel * WEAPONS.bonusPerLevel })
    if (drillRank > 0) sources.push({ kind: 'drill', label: `${trainingRank(drillRank)} drill`, attack: drillBonus, defense: drillBonus })
    return {
      unit,
      name: spec.name,
      count,
      baseAttack: spec.attack,
      baseDefense: spec.defense,
      attack,
      defense,
      weaponLevel,
      drillRank,
      drillName: trainingRank(drillRank),
      drillBonus,
      power: count * (attack + defense) * 0.5,
      sources,
    }
  })
  const barracks = Object.values(s.regions).reduce((sum, r) => (r.owner === nationId ? sum + r.buildings.barracks : sum), 0)
  const units = n.military.units
  return {
    units: lines,
    totalPower: lines.reduce((sum, l) => sum + l.power, 0),
    totalUnits: totalUnits(units),
    upkeep: UNIT_TYPES.reduce((sum, k) => sum + units[k] * UNIT_SPECS[k].upkeep, 0),
    foodUse: UNIT_TYPES.reduce((sum, k) => sum + units[k] * UNIT_SPECS[k].food, 0),
    combinedArms: hasCombinedArms(units),
    combinedArmsBonus: COMBAT.combinedArmsBonus + base.combinedArms,
    trainingSlots: BASE_TRAIN_SLOTS + barracks,
    trainingUsed: (s.trainingQueue ?? []).filter((j) => j.nationId === nationId).length,
  }
}

/** Strength of a nation's whole military. Battles, the AI and the screens all read this. */
export function militaryPower(s: GameState, nationId: NationId): number {
  if (!s.nations[nationId]) return 0
  return militarySheet(s, nationId).totalPower
}
