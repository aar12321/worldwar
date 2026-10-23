import type { BuildingType, TerritoryUpgrade, UnitType } from './types'

/** How long one economy month lasts at 1×, in seconds. */
export const MONTH_SECONDS = 20

/** How often idle armies look for a new march, in sim-seconds. */
export const MILITARY_PULSE_SECONDS = 4

/** Training time at 1×. */
export const TRAIN_SECONDS: Record<UnitType, number> = {
  infantry: 10,
  armor: 30,
  air: 45,
  naval: 40,
}

/** Construction time at 1×. All of these finish in under a minute. */
export const BUILD_SECONDS: Record<BuildingType, number> = {
  factory: 50,
  farm: 16,
  university: 45,
  barracks: 30,
  port: 40,
  depot: 25,
}

export const UPGRADE_SECONDS: Record<TerritoryUpgrade, number> = {
  housing: 18,
  works: 35,
  granary: 22,
  roads: 28,
  civic: 42,
}

export function travelSeconds(fromLat: number, fromLng: number, toLat: number, toLng: number, kind: 'move' | 'attack'): number {
  const dLat = fromLat - toLat
  let dLng = fromLng - toLng
  if (dLng > 180) dLng -= 360
  if (dLng < -180) dLng += 360
  const dist = Math.hypot(dLat, dLng)
  const base = kind === 'attack' ? 5.5 : 6.5
  return Math.round(Math.max(4, Math.min(16, base + dist * 0.12)) * 10) / 10
}

export function formatSeconds(seconds: number): string {
  const t = Math.max(0, Math.ceil(seconds))
  if (t < 60) return `${t}s`
  const m = Math.floor(t / 60)
  const s = t % 60
  return s ? `${m}m ${s}s` : `${m}m`
}
