import { TRAINING } from '../data/unitTypes'
import type { GameState, WorldMap } from './types'

/** Fills fields added after a save was written, so an older game can still load. */
export function normalizeGame(game: GameState, map: WorldMap): GameState {
  for (const n of Object.values(game.nations)) {
    n.contracts = Array.isArray(n.contracts) ? n.contracts.filter((c) => c && typeof c.until === 'number' && c.until >= game.turn) : []
  }
  const used = new Set<string>()
  const armies = Object.values(game.armies).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const a of armies) {
    a.training = Math.max(0, Math.min(TRAINING.max, Math.floor(Number.isFinite(a.training) ? a.training : 0)))
    const known = !!map.territories[a.homeTerritoryId] && !used.has(a.homeTerritoryId)
    if (!known) {
      const regionList = map.territoriesByRegion[a.location] ?? []
      a.homeTerritoryId = regionList.find((id) => !used.has(id)) ?? ''
    }
    if (a.homeTerritoryId) used.add(a.homeTerritoryId)
  }
  return game
}
