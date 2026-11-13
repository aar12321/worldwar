import { EVENT_BY_ID } from '../data/events'
import { startingCities } from './cities'
import { lineMax } from './economy'
import { UNIT_TYPES } from './types'
import { EVENT_GAP_TURNS, FIRST_EVENT_TURN } from './events'
import type { GameState, WorldMap } from './types'

/** Checks a loaded save and fills a few fields, so a damaged or slightly older game can still load. */
export function normalizeGame(game: GameState, map: WorldMap): GameState {
  if (!game?.nations?.[game.playerId] || !game.regions) throw new Error('Save is not a valid game')
  for (const n of Object.values(game.nations)) if (!n.military) throw new Error('Save is from an older version')
  // Games saved before campaigns have no Defense Lines yet.
  for (const n of Object.values(game.nations)) {
    for (const k of UNIT_TYPES) {
      n.military.units[k] ??= 0
      n.military.drill[k] ??= 0
      n.military.weapons[k] ??= 0
    }
    n.overlord ??= null
    n.sectors ??= { farming: 2, energy: 1, manufacturing: 2, arms: 0.5, technology: 0.5, finance: 0.5 }
    n.subsidies ??= []
    n.debt ??= 0
    n.redMonths ??= 0
    n.defaultedUntil ??= 0
    n.government ??= 'monarchy'
    n.budget ??= { military: 0.25, education: 0.25, health: 0.25, infrastructure: 0.25 }
    n.corporateTax ??= 0.15
    n.nextElection ??= 0
    n.lastReform ??= 0
    n.resources.oil ??= 6
    n.resources.steel ??= 6
    n.resources.goods ??= 10
    n.oilShortage ??= false
    n.goodsShortage ??= false
    n.tradeUsed ??= 0
    n.autoBuy ??= ['food', 'oil', 'goods']
    n.military.attacksThisTurn ??= 0
    n.military.exposed ??= 0
  }
  for (const r of Object.values(game.regions)) {
    r.cities ??= startingCities(map.regions[r.id])
    r.integration ??= 1
    r.attackedTurn ??= -1
    if (!Number.isFinite(r.line)) r.line = lineMax(game, map, r.id)
  }
  game.humans ??= [game.playerId]
  game.winner ??= null
  game.eliminated ??= []
  game.worldGross ??= 0
  game.investments ??= []
  game.settings.goal ??= 'classic'
  game.reasons ??= {}
  game.infamy ??= {}
  game.cases ??= []
  game.crises ??= []
  game.sanctions ??= []
  game.guarantees ??= []
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
