import { CITY_RULES, FOCUS, cityDefs } from '../data/cities'
import type { City, MapRegion, RegionState } from './types'

/** The cities a country starts with: its capital, grown a little, and any other big cities. */
export function startingCities(mr: MapRegion): City[] {
  return cityDefs(mr.id, mr.name).map((def, i) => ({
    id: `${mr.id}:${i}`,
    name: def.name,
    level: i === 0 ? 2 : 1,
    focus: 'balanced',
    port: i === 0 ? mr.coastal : def.port,
    lat: def.lat,
    lng: def.lng,
  }))
}

/** Highest level a city can reach, which depends on how big the country's workforce is. */
export const cityLevelCap = (workforce: number) => Math.min(CITY_RULES.maxLevel, 2 + Math.floor(workforce / 6))

export const cityDevelopCost = (city: City) => CITY_RULES.developCost * city.level

/** Extra workforce from big cities, as a share of the country's base. */
export function cityWorkforceBonus(region: Pick<RegionState, 'cities'>): number {
  let levels = 0
  for (const c of region.cities ?? []) levels += c.level - 1
  return Math.min(CITY_RULES.workforceCap, levels * CITY_RULES.workforcePerLevel)
}

export interface CityEffects {
  food: number
  money: number
  research: number
  factory: number
  steel: number
  tradeCapacity: number
  /** Added to the country's Defense Line. */
  line: number
  credit: number
  /** Defenders added to the garrison. */
  garrison: number
}

export const NO_CITY_EFFECTS: CityEffects = { food: 0, money: 0, research: 0, factory: 0, steel: 0, tradeCapacity: 0, line: 0, credit: 0, garrison: 0 }

/** What a country's cities do for it, each city by its level and focus. */
export function cityEffects(region: Pick<RegionState, 'cities'>): CityEffects {
  const out = { ...NO_CITY_EFFECTS }
  for (const c of region.cities ?? []) {
    const f = FOCUS[c.focus] ?? FOCUS.balanced
    out.food += f.food * c.level
    out.money += f.money * c.level
    out.research += f.research * c.level
    out.factory += f.factory * c.level
    out.steel += f.steel * c.level
    out.tradeCapacity += f.tradeCapacity * c.level
    out.line += f.line * c.level
    out.credit += f.credit * c.level
    if (c.focus === 'fortress') out.garrison += 0.3 * c.level
  }
  return out
}

/** A conquered city loses a level and its old focus. */
export function razeCities(region: Pick<RegionState, 'cities'>) {
  for (const c of region.cities ?? []) {
    c.level = Math.max(1, c.level - 1)
    c.focus = 'balanced'
  }
}
