import { UPGRADE_SPECS } from '../data/development'
import { asTraining } from '../data/unitTypes'
import { FIRST_EVENT_TURN } from './events'
import { TERRITORY_UPGRADES, type GameState, type TerritoryDev, type TrainingJob, type WorldMap } from './types'

/** Fills fields added after a save was written, so an older game can still load. */
export function normalizeGame(game: GameState, map: WorldMap): GameState {
  for (const n of Object.values(game.nations)) {
    n.contracts = Array.isArray(n.contracts) ? n.contracts.filter((c) => c && typeof c.until === 'number' && c.until >= game.turn) : []
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
  const devSource = game.territoryDev && typeof game.territoryDev === 'object' ? game.territoryDev : {}
  const territoryDev: Record<string, TerritoryDev> = {}
  for (const [id, raw] of Object.entries(devSource)) {
    if (!map.territories[id] || !raw) continue
    const dev = { housing: 0, works: 0, granary: 0, roads: 0, civic: 0 }
    for (const upgrade of TERRITORY_UPGRADES) {
      const level = Math.floor(Number((raw as Partial<TerritoryDev>)[upgrade] ?? 0))
      dev[upgrade] = Number.isFinite(level) ? Math.max(0, Math.min(UPGRADE_SPECS[upgrade].max, level)) : 0
    }
    territoryDev[id] = dev
  }
  game.territoryDev = territoryDev

  const queue = Array.isArray(game.trainingQueue) ? game.trainingQueue : []
  game.trainingQueue = queue.filter((job): job is TrainingJob => {
    if (!job || typeof job.id !== 'string' || !map.territories[job.territoryId]) return false
    return job.remaining > 0 && job.total > 0 && !!game.nations[job.nationId]
  })

  if (game.turn < FIRST_EVENT_TURN) {
    game.pendingEvent = null
    const scheduled = Number.isFinite(game.nextEventTurn) ? game.nextEventTurn : FIRST_EVENT_TURN
    game.nextEventTurn = Math.max(scheduled, FIRST_EVENT_TURN)
  }
  return game
}
