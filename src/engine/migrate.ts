import { asTraining } from '../data/unitTypes'
import { FIRST_EVENT_TURN } from './events'
import { LONG_WAR_MONTHS, warMonths } from './helpers'
import type { GameState, WorldMap } from './types'

/** Fills fields added after a save was written, so an older game can still load. */
export function normalizeGame(game: GameState, map: WorldMap): GameState {
  for (const n of Object.values(game.nations)) {
    n.contracts = Array.isArray(n.contracts) ? n.contracts.filter((c) => c && typeof c.until === 'number' && c.until >= game.turn) : []
    if (n.alive && warMonths(game, n.id) < LONG_WAR_MONTHS) {
      if (n.stability < 90) n.stability = 90
      n.warWeariness = 0
    }
  }
  const used = new Set<string>()
  const armies = Object.values(game.armies).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const a of armies) {
    a.training = asTraining(a.training, a.units)
    const known = !!map.territories[a.homeTerritoryId] && !used.has(a.homeTerritoryId)
    if (!known) {
      const regionList = map.territoriesByRegion[a.location] ?? []
      a.homeTerritoryId = regionList.find((id) => !used.has(id)) ?? ''
    }
    if (a.homeTerritoryId) used.add(a.homeTerritoryId)
  }
  if (game.turn < FIRST_EVENT_TURN) {
    game.pendingEvent = null
    const scheduled = Number.isFinite(game.nextEventTurn) ? game.nextEventTurn : FIRST_EVENT_TURN
    game.nextEventTurn = Math.max(scheduled, FIRST_EVENT_TURN)
  }
  return game
}
