import { UNIT_SPECS, WEAPONS, weaponCost } from '../data/unitTypes'
import { canUseUnit, factoryCount, nationModifiers, type AggregatedModifiers } from './helpers'
import type { GameState, Nation, NationId, UnitType } from './types'

/** Technology modifiers plus the permanent weapon levels. A weapon level helps attack and defense alike. */
export function combatMods(n: Nation): AggregatedModifiers {
  const mods = nationModifiers(n)
  for (const k of Object.keys(UNIT_SPECS) as UnitType[]) {
    const bonus = (n.military?.weapons?.[k] ?? 0) * WEAPONS.bonusPerLevel
    mods.unitAttack[k] += bonus
    mods.unitDefense[k] += bonus
  }
  return mods
}

/** The weapon level that comes next, its price, and why it cannot be bought yet. */
export function nextWeaponLevel(s: GameState, nationId: NationId, unit: UnitType): { level: number; cost: number; error: string | null } {
  const n = s.nations[nationId]
  const level = n.military.weapons[unit] ?? 0
  const cost = weaponCost(level)
  if (level >= WEAPONS.maxLevel) return { level, cost, error: 'Weapons are at their best' }
  if (!canUseUnit(n, unit)) return { level, cost, error: 'Technology required' }
  const factories = factoryCount(s, nationId)
  if (factories < level + 1) return { level, cost, error: factories === 0 ? 'Requires a Factory' : `Needs factory level ${level + 1}` }
  return { level, cost, error: null }
}
