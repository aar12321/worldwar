import { trainingRank } from '../data/unitTypes'
import { formatDivisions } from '../engine/helpers'
import type { Army, UnitType } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'

const UNIT_GLYPH: Record<UnitType, string> = { infantry: 'INF', armor: 'ARM', air: 'AIR', naval: 'NAV' }

export function armyCaption(army: Army): string {
  const bits = UNIT_TYPES.filter((k) => army.units[k] >= 0.05).map((k) => `${UNIT_GLYPH[k]} ${formatDivisions(army.units[k])}`)
  return `${bits.join(' · ') || 'Empty'} · ${trainingRank(army.training ?? 0)}`
}

export { UNIT_GLYPH }
