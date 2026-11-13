/** Where in the world a place is, for headlines like "unrest in the Middle East". */
export type AreaId = 'middle_east' | 'east_asia' | 'south_asia' | 'central_asia' | 'europe' | 'africa' | 'north_america' | 'latin_america' | 'oceania'

export const AREA_NAMES: Record<AreaId, string> = {
  middle_east: 'the Middle East',
  east_asia: 'East Asia',
  south_asia: 'South Asia',
  central_asia: 'Central Asia',
  europe: 'Europe',
  africa: 'Africa',
  north_america: 'North America',
  latin_america: 'Latin America',
  oceania: 'the Pacific',
}

/** The nearest area by coordinates. Coarse on purpose: it only has to read naturally in a headline. */
export function areaOf(lat: number, lng: number): AreaId {
  if (lng < -30) return lat > 14 && lng < -50 ? 'north_america' : lat > 14 ? 'north_america' : 'latin_america'
  if (lat < -10 && lng > 100) return 'oceania'
  if (lng > 110 && lat < 25 && lat > -12) return 'east_asia'
  if (lat < 30 && lng > 25 && lng < 62 && lat > 12) return 'middle_east'
  if (lat < 37 && lng > -20 && lng < 52 && lat > -36 && !(lat > 25 && lng > 25 && lng < 62)) return 'africa'
  if (lat >= 25 && lat < 42 && lng >= 34 && lng < 62) return 'middle_east'
  if (lat > 36 && lng < 50 && lng > -25) return 'europe'
  if (lng >= 62 && lng < 92 && lat < 38) return 'south_asia'
  if (lng >= 46 && lng < 90 && lat >= 38) return 'central_asia'
  if (lng >= 90) return lat < -9 ? 'oceania' : 'east_asia'
  if (lng >= 62 && lat < 38) return 'south_asia'
  return lat > 36 ? 'europe' : 'africa'
}
