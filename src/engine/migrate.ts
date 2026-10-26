import { EVENT_BY_ID } from '../data/events'
import { EVENT_GAP_TURNS, FIRST_EVENT_TURN } from './events'
import type { GameState, WorldMap } from './types'

/** Checks a loaded save and fills a few fields, so a damaged or slightly older game can still load. */
export function normalizeGame(game: GameState, _map: WorldMap): GameState {
  if (!game?.nations?.[game.playerId] || !game.regions) throw new Error('Save is not a valid game')
  for (const n of Object.values(game.nations)) if (!n.military) throw new Error('Save is from an older version')
  game.trainingQueue = Array.isArray(game.trainingQueue) ? game.trainingQueue.filter((job) => job && game.nations[job.nationId] && job.remaining > 0 && job.total > 0) : []

  if (game.turn < FIRST_EVENT_TURN) {
    game.pendingEvent = null
    const scheduled = Number.isFinite(game.nextEventTurn) ? game.nextEventTurn : FIRST_EVENT_TURN
    game.nextEventTurn = Math.max(scheduled, FIRST_EVENT_TURN)
  } else if (!Number.isFinite(game.nextEventTurn)) {
    game.nextEventTurn = game.turn + EVENT_GAP_TURNS
  }
  if (game.pendingEvent && !EVENT_BY_ID[game.pendingEvent.eventId]) game.pendingEvent = null
  return game
}
