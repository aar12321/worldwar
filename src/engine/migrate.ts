import { UPGRADE_SPECS } from '../data/development'
import { TRAIN_MONTHS, asTraining } from '../data/unitTypes'
import { BUILD_MONTHS, UPGRADE_MONTHS } from './pace'
import { FIRST_EVENT_TURN } from './events'
import { TERRITORY_UPGRADES, type GameState, type TerritoryDev, type TrainingJob, type WorldMap } from './types'

/** Fills fields added after a save was written, so an older game can still load. */
export function normalizeGame(game: GameState, map: WorldMap): GameState {
  for (const n of Object.values(game.nations)) {
    n.contracts = []
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
  if (!game.territoryOwners || typeof game.territoryOwners !== 'object') game.territoryOwners = {}
  for (const id of Object.keys(game.territoryOwners)) if (!map.territories[id]) delete game.territoryOwners[id]
  game.projects = Array.isArray(game.projects) ? game.projects.filter((p) => p && p.remaining > 0 && p.total > 0 && game.nations[p.nationId]) : []
  for (const project of game.projects) {
    const months = project.kind === 'build' && project.building ? BUILD_MONTHS[project.building] : project.kind === 'develop' && project.upgrade ? UPGRADE_MONTHS[project.upgrade] : 1
    if (project.total > months) {
      const left = project.remaining / project.total
      project.total = months
      project.remaining = Math.max(1, Math.ceil(left * months))
    }
  }
  if (!Number.isFinite(game.simTime)) game.simTime = 0
  if (!Number.isFinite(game.monthElapsed)) game.monthElapsed = 0
  if (!Number.isFinite(game.militaryElapsed)) game.militaryElapsed = 0
  for (const a of Object.values(game.armies)) {
    if (!a.march) a.march = null
    else if (a.march.duration > 1) {
      a.march.duration = 1
      a.march.progress = Math.min(0.99, a.march.progress)
    }
  }

  const queue = Array.isArray(game.trainingQueue) ? game.trainingQueue : []
  game.trainingQueue = queue.filter((job): job is TrainingJob => {
    if (!job || typeof job.id !== 'string' || !map.territories[job.territoryId]) return false
    if (!(job.remaining > 0 && job.total > 0 && !!game.nations[job.nationId])) return false
    const months = TRAIN_MONTHS[job.unit] ?? 1
    if (job.total > months || job.clock === 'time') {
      const left = Math.min(1, job.remaining / job.total)
      job.total = months
      job.remaining = Math.max(1, Math.ceil(left * months))
      job.clock = 'time'
    }
    return true
  })

  if (game.turn < FIRST_EVENT_TURN) {
    game.pendingEvent = null
    const scheduled = Number.isFinite(game.nextEventTurn) ? game.nextEventTurn : FIRST_EVENT_TURN
    game.nextEventTurn = Math.max(scheduled, FIRST_EVENT_TURN)
  }
  return game
}
