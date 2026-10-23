import { TERRITORY_UPGRADES, type GameState, type NationId, type RegionId, type TerritoryDev, type WorldMap } from './types'

/** Who holds a territory. Unlisted territories belong to the country that owns the region. */
export function territoryOwner(s: GameState, map: WorldMap, territoryId: string): NationId {
  const listed = s.territoryOwners?.[territoryId]
  if (listed) return listed
  const territory = map.territories[territoryId]
  if (!territory) return ''
  return s.regions[territory.regionId]?.owner ?? ''
}

export function territoriesOf(s: GameState, map: WorldMap, nationId: NationId): string[] {
  const ids: string[] = []
  for (const id of Object.keys(map.territories)) if (territoryOwner(s, map, id) === nationId) ids.push(id)
  ids.sort()
  return ids
}

/** Chip one level off every upgrade. Captured land keeps what is left. */
export function damageTerritory(dev: TerritoryDev): void {
  for (const upgrade of TERRITORY_UPGRADES) if (dev[upgrade] > 0) dev[upgrade] -= 1
}

function dist2(lat: number, lng: number, lat2: number, lng2: number): number {
  const dLat = lat - lat2
  let dLng = lng - lng2
  if (dLng > 180) dLng -= 360
  if (dLng < -180) dLng += 360
  return dLat * dLat + dLng * dLng
}

/**
 * Enemy territories on the border an army can reach from `fromRegion`.
 * The closest third of a country's territories face each neighbor; the rest open as the border is taken.
 */
export function attackableTerritoryIds(s: GameState, map: WorldMap, nationId: NationId, fromRegion: RegionId, atWarWith: (owner: NationId) => boolean): string[] {
  const origin = map.regions[fromRegion]
  if (!origin) return []
  const out: string[] = []
  const seen = new Set<string>()
  const regions = [fromRegion, ...origin.neighbors, ...origin.seaLanes]
  for (const regionId of regions) {
    const ids = map.territoriesByRegion[regionId] ?? []
    const enemy = ids.filter((id) => {
      const owner = territoryOwner(s, map, id)
      return owner !== nationId && atWarWith(owner)
    })
    if (!enemy.length) continue
    const ranked = enemy
      .map((id) => ({ id, d: dist2(map.territories[id].lat, map.territories[id].lng, origin.lat, origin.lng) }))
      .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))
    const slots = Math.max(1, Math.ceil(ids.length / 3))
    for (const item of ranked.slice(0, slots)) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item.id)
    }
  }
  return out
}

/** Closest enemy territory in a region to the attacker's country. */
export function closestEnemyTerritory(s: GameState, map: WorldMap, nationId: NationId, fromRegion: RegionId, toRegion: RegionId, prefer?: string): string | null {
  const ids = map.territoriesByRegion[toRegion] ?? []
  const enemy = ids.filter((id) => territoryOwner(s, map, id) !== nationId)
  if (!enemy.length) return null
  if (prefer && enemy.includes(prefer)) return prefer
  const origin = map.regions[fromRegion]
  let best = enemy[0]
  let bestD = Infinity
  for (const id of enemy) {
    const territory = map.territories[id]
    const d = dist2(territory.lat, territory.lng, origin.lat, origin.lng)
    if (d < bestD || (d === bestD && id < best)) {
      bestD = d
      best = id
    }
  }
  return best
}
