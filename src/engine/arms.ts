import { UNIT_SPECS, WEAPONS, weaponCost } from '../data/unitTypes'
import { canUseUnit, nationModifiers, type AggregatedModifiers } from './helpers'
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

/** The highest factory level in any one country the nation holds. */
export function bestFactory(s: GameState, nationId: NationId): number {
  let best = 0
  for (const r of Object.values(s.regions)) if (r.owner === nationId && r.buildings.factory > best) best = r.buildings.factory
  return best
}

/** The weapon level that comes next, its price, and why it cannot be bought yet. */
export function nextWeaponLevel(s: GameState, nationId: NationId, unit: UnitType): { level: number; cost: number; error: string | null } {
  const n = s.nations[nationId]
  const level = n.military.weapons[unit] ?? 0
  const cost = weaponCost(level)
  if (level >= WEAPONS.maxLevel) return { level, cost, error: 'Weapons are at their best' }
  if (!canUseUnit(n, unit)) return { level, cost, error: 'Technology required' }
  // The best single factory sets the ceiling: many small workshops do not make a weapons plant.
  const factories = bestFactory(s, nationId)
  if (factories < level + 1) return { level, cost, error: factories === 0 ? 'Requires a Factory' : `Needs a factory of level ${level + 1} in one country (your best is ${factories})` }
  return { level, cost, error: null }
}
