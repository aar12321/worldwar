import type { BuildingType, TerritoryUpgrade } from './types'

/** Months of work. A project ordered now finishes after this many End month presses. */
export const BUILD_MONTHS: Record<BuildingType, number> = {
  factory: 2,
  farm: 1,
  university: 2,
  barracks: 1,
  port: 2,
  depot: 1,
}

export const UPGRADE_MONTHS: Record<TerritoryUpgrade, number> = {
  housing: 1,
  works: 2,
  granary: 1,
  roads: 2,
  civic: 2,
}

export function formatMonths(months: number): string {
  const n = Math.max(0, Math.ceil(months))
  if (n <= 1) return '1 month'
  return `${n} months`
}
