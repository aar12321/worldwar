import { generateAllBotOrders } from '../ai/bot'
import { UPGRADE_SPECS, upgradeCost } from '../data/development'
import { BUILDING_SPECS, UNIT_SPECS } from '../data/unitTypes'
import { ensureTerritoryDev } from './development'
import { addLog, atWar } from './helpers'
import { orderCost, validateOrder } from './orders'
import { BUILD_SECONDS, MILITARY_PULSE_SECONDS, MONTH_SECONDS, TRAIN_SECONDS, UPGRADE_SECONDS, travelSeconds } from './pace'
import { applyResolvedOrder, resolveTurn } from './resolveTurn'
import { createRng } from './rng'
import { closestEnemyTerritory, territoryOwner } from './territory'
import { addUnitAtTerritory } from './training'
import type { Army, GameState, Order, TrainingJob, WorldMap } from './types'
import { checkOutcome } from './victory'
import { canReach, resolveAttacks } from './warfare'

const LIVE = new Set<Order['type']>(['move', 'attack', 'queueTrain', 'build', 'develop', 'recruit'])

/** Orders that still wait for the economy month: diplomacy, research, and paid drill. */
export const QUEUED_ORDERS = new Set<Order['type']>(['setPolicy', 'propose', 'respond', 'research', 'spy', 'cancelDeal', 'leaveAlliance', 'train'])

export interface SimNotice {
  type: 'capture' | 'loss' | 'trained' | 'war' | 'built'
  text: string
  territoryId?: string
  pause: boolean
  playerInvolved: boolean
}

export interface AdvanceResult {
  state: GameState
  notices: SimNotice[]
  flushOrders: boolean
}

function armyPoint(map: WorldMap, army: Army): { lat: number; lng: number } {
  const home = map.territories[army.homeTerritoryId]
  if (home && army.location === home.regionId) return { lat: home.lat, lng: home.lng }
  const region = map.regions[army.location]
  return { lat: region?.lat ?? 0, lng: region?.lng ?? 0 }
}

function pay(s: GameState, order: Order) {
  const n = s.nations[order.nationId]
  const cost = orderCost(s, order)
  n.resources.capital -= cost.capital
  n.resources.pp -= cost.pp
  n.militaryPool -= cost.manpower
}

/** Starts a march, a training job, or a construction timer. Mutates `s`. */
export function startLive(s: GameState, map: WorldMap, order: Order): string | null {
  if (!LIVE.has(order.type)) return 'Not a live order'
  const nation = s.nations[order.nationId]
  if (!nation?.alive) return 'Your nation has fallen.'
  if ((order.type === 'move' || order.type === 'attack') && s.armies[order.armyId]?.march) return 'That army is already on the move.'
  const err = validateOrder(s, map, order)
  if (err) return err

  if (order.type === 'attack') {
    const army = s.armies[order.armyId]
    let territoryId: string | null | undefined =
      order.territoryId ?? closestEnemyTerritory(s, map, order.nationId, army.location, order.target, undefined, (owner) => atWar(s, order.nationId, owner))
    // Rebels in your own country have no enemy territory; march at the country itself.
    if (!territoryId && s.regions[order.target]?.owner === order.nationId) territoryId = map.territoriesByRegion[order.target]?.[0]
    if (!territoryId) return 'No border territory to attack.'
    army.entrenched = 0
    const from = armyPoint(map, army)
    const to = map.territories[territoryId]
    pay(s, order)
    army.march = {
      kind: 'attack',
      to: order.target,
      territoryId,
      fromLat: from.lat,
      fromLng: from.lng,
      toLat: to.lat,
      toLng: to.lng,
      progress: 0,
      duration: travelSeconds(from.lat, from.lng, to.lat, to.lng, 'attack'),
    }
    return null
  }

  if (order.type === 'move') {
    const army = s.armies[order.armyId]
    const from = armyPoint(map, army)
    const to = map.regions[order.to]
    pay(s, order)
    army.entrenched = 0
    army.march = {
      kind: 'move',
      to: order.to,
      territoryId: map.territoriesByRegion[order.to]?.[0] ?? '',
      fromLat: from.lat,
      fromLng: from.lng,
      toLat: to.lat,
      toLng: to.lng,
      progress: 0,
      duration: travelSeconds(from.lat, from.lng, to.lat, to.lng, 'move'),
    }
    return null
  }

  pay(s, order)
  s.projects ??= []
  s.trainingQueue ??= []
  if (order.type === 'queueTrain' || order.type === 'recruit') {
    const total = TRAIN_SECONDS[order.unit]
    const job: TrainingJob = {
      id: `q${s.nextId++}`,
      nationId: order.nationId,
      territoryId: order.territoryId,
      unit: order.unit,
      remaining: total,
      total,
      orderedTurn: s.turn,
      clock: 'time',
    }
    s.trainingQueue.push(job)
    return null
  }
  if (order.type === 'build') {
    const total = BUILD_SECONDS[order.building]
    s.projects.push({
      id: `p${s.nextId++}`,
      nationId: order.nationId,
      kind: 'build',
      remaining: total,
      total,
      regionId: order.regionId,
      building: order.building,
    })
    return null
  }
  if (order.type !== 'develop') return 'Not a live order'
  const total = UPGRADE_SECONDS[order.upgrade]
  s.projects.push({
    id: `p${s.nextId++}`,
    nationId: order.nationId,
    kind: 'develop',
    remaining: total,
    total,
    territoryId: order.territoryId,
    upgrade: order.upgrade,
  })
  return null
}

function refundProject(s: GameState, project: GameState['projects'][number], fraction: number) {
  const nation = s.nations[project.nationId]
  if (!nation?.alive) return
  if (project.kind === 'build' && project.building) nation.resources.capital += BUILDING_SPECS[project.building].cost * fraction
  if (project.kind === 'develop' && project.upgrade && project.territoryId) {
    const level = s.territoryDev?.[project.territoryId]?.[project.upgrade] ?? 0
    nation.resources.capital += upgradeCost(project.upgrade, level) * fraction
  }
}

function advanceProjects(s: GameState, map: WorldMap, dt: number) {
  const left = []
  for (const project of s.projects ?? []) {
    const nation = s.nations[project.nationId]
    if (!nation?.alive) continue
    if (project.kind === 'develop' && project.territoryId && territoryOwner(s, map, project.territoryId) !== project.nationId) {
      refundProject(s, project, 0.5)
      if (nation.isPlayer) addLog(s, 'info', 'Construction stopped because the territory was lost. Half the cost was refunded.', [project.nationId])
      continue
    }
    if (project.kind === 'build' && project.regionId && s.regions[project.regionId]?.owner !== project.nationId) {
      refundProject(s, project, 0.5)
      continue
    }
    const remaining = project.remaining - dt
    if (remaining > 0.05) {
      left.push({ ...project, remaining })
      continue
    }
    if (project.kind === 'build' && project.building && project.regionId && s.regions[project.regionId]) {
      s.regions[project.regionId].buildings[project.building]++
      if (nation.isPlayer) addLog(s, 'economy', `Construction complete: ${BUILDING_SPECS[project.building].name} in ${map.regions[project.regionId].name}.`, [project.nationId])
    }
    if (project.kind === 'develop' && project.upgrade && project.territoryId) {
      const dev = ensureTerritoryDev(s, project.territoryId)
      const spec = UPGRADE_SPECS[project.upgrade]
      if (dev[project.upgrade] < spec.max) dev[project.upgrade] += 1
      if (nation.isPlayer) addLog(s, 'economy', `${spec.name} finished in ${map.territories[project.territoryId]?.name ?? 'the territory'}.`, [project.nationId])
    }
  }
  s.projects = left
}

function advanceTraining(s: GameState, map: WorldMap, dt: number) {
  const queue = s.trainingQueue ?? []
  const next: TrainingJob[] = []
  const advanced = new Set<string>()
  for (const job of queue) {
    if (job.clock !== 'time') {
      next.push(job)
      continue
    }
    const territory = map.territories[job.territoryId]
    const owner = territory ? territoryOwner(s, map, job.territoryId) : null
    const nation = s.nations[job.nationId]
    if (!territory || owner !== job.nationId || !nation?.alive) {
      if (nation?.alive) {
        const spec = UNIT_SPECS[job.unit]
        const fraction = job.remaining === job.total ? 1 : 0.5
        nation.resources.capital += spec.capitalCost * fraction
        nation.militaryPool += spec.manpowerCost * fraction
        if (nation.isPlayer) addLog(s, 'info', `Training of ${spec.name} stopped because the territory was lost.`, [job.nationId])
      }
      continue
    }
    if (advanced.has(job.territoryId)) {
      next.push(job)
      continue
    }
    advanced.add(job.territoryId)
    const remaining = job.remaining - dt
    if (remaining > 0.05) {
      next.push({ ...job, remaining })
      continue
    }
    const army = addUnitAtTerritory(s, map, job.nationId, job.territoryId, job.unit)
    if (nation.isPlayer && army) {
      const where = army.location === territory.regionId ? territory.name : map.regions[army.location]?.name ?? territory.name
      addLog(s, 'info', `${UNIT_SPECS[job.unit].name} finished training at ${territory.name} and joined the army in ${where}.`, [job.nationId])
    }
  }
  s.trainingQueue = next
}

function progressMarches(s: GameState, map: WorldMap, dt: number) {
  const rng = createRng(s.seed, s.turn * 1000 + Math.floor(s.simTime * 10))
  const armies = Object.values(s.armies).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const army of armies) {
    const march = army.march
    if (!march || !s.armies[army.id]) continue
    march.progress = Math.min(1, march.progress + dt / Math.max(0.25, march.duration))
    if (march.progress < 1) continue
    army.march = null
    if (march.kind === 'move') {
      if (s.regions[march.to]?.owner === army.owner && canReach(s, map, army.owner, army.location, march.to, 'move').ok) army.location = march.to
      army.entrenched = 0
      continue
    }
    resolveAttacks(
      s,
      map,
      [{ type: 'attack', nationId: army.owner, armyId: army.id, target: march.to, territoryId: march.territoryId }],
      rng,
      new Set(),
    )
  }
}

function collectLogs(s: GameState, from: number): SimNotice[] {
  const notices: SimNotice[] = []
  const player = s.playerId
  for (const entry of s.log.slice(from)) {
    const involved = entry.nations.includes(player)
    if (!involved) continue
    // Only a war declared on you stops the clock. One you declare, or an ally joining, is a toast.
    if (entry.kind === 'war' && entry.text.includes('declared war')) notices.push({ type: 'war', text: entry.text, pause: entry.nations[1] === player, playerInvolved: true })
    else if (entry.kind === 'info' && entry.text.includes('finished training')) notices.push({ type: 'trained', text: entry.text, pause: false, playerInvolved: true })
    else if ((entry.kind === 'economy' || entry.kind === 'info') && /finished|Construction complete/i.test(entry.text))
      notices.push({ type: 'built', text: entry.text, pause: false, playerInvolved: true })
  }
  return notices
}

function collectCaptures(s: GameState, map: WorldMap, from: number): SimNotice[] {
  const notices: SimNotice[] = []
  const player = s.playerId
  for (const battle of s.battles.slice(from)) {
    if (!battle.captured) continue
    const involved = battle.attacker.nationId === player || battle.defender.nationId === player
    if (!involved) continue
    const name = (battle.territoryId && map.territories[battle.territoryId]?.name) || map.regions[battle.regionId]?.name || 'territory'
    const loss = battle.defender.nationId === player
    const who = s.nations[battle.attacker.nationId]?.name ?? 'An enemy'
    notices.push({
      type: loss ? 'loss' : 'capture',
      text: loss ? `${who} took ${name}` : `You captured ${name}`,
      territoryId: battle.territoryId ?? undefined,
      // Winning is a toast and a ring on the map. Losing land stops the clock.
      pause: loss,
      playerInvolved: true,
    })
  }
  return notices
}

/**
 * Moves the world forward by `dt` sim-seconds.
 * Training, construction, and marches advance continuously. Economy, supply, and diplomacy settle once per month.
 */
export function advance(prev: GameState, map: WorldMap, dt: number, queued: Order[] = []): AdvanceResult {
  if (dt <= 0 || prev.outcome !== 'playing' || prev.pendingEvent) return { state: prev, notices: [], flushOrders: false }
  let s = structuredClone(prev)
  s.simTime = (s.simTime ?? 0) + dt
  s.monthElapsed = (s.monthElapsed ?? 0) + dt
  s.militaryElapsed = (s.militaryElapsed ?? 0) - dt
  const notices: SimNotice[] = []
  let flushOrders = false

  if (s.monthElapsed >= MONTH_SECONDS) {
    s.monthElapsed -= MONTH_SECONDS
    const bot = generateAllBotOrders(s, map)
    const diplomatic = [...queued.filter((o) => !LIVE.has(o.type)), ...bot.filter((o) => !LIVE.has(o.type))]
    const logAt = s.log.length
    s = resolveTurn(s, map, diplomatic)
    flushOrders = true
    notices.push(...collectLogs(s, logAt), ...collectCaptures(s, map, 0))
    for (const order of bot) if (LIVE.has(order.type)) startLive(s, map, order)
    s.militaryElapsed = MILITARY_PULSE_SECONDS
  } else if (s.militaryElapsed <= 0) {
    s.militaryElapsed = MILITARY_PULSE_SECONDS
    const bot = generateAllBotOrders(s, map)
    for (const order of bot) if (order.type === 'move' || order.type === 'attack') startLive(s, map, order)
  }

  const logAt = s.log.length
  const battleAt = s.battles.length
  advanceTraining(s, map, dt)
  advanceProjects(s, map, dt)
  progressMarches(s, map, dt)
  notices.push(...collectLogs(s, logAt), ...collectCaptures(s, map, battleAt))
  if (s.battles.length > 16) s.battles.splice(0, s.battles.length - 16)
  s.outcome = checkOutcome(s, map)
  return { state: s, notices, flushOrders }
}

/** Applies one player decision without waiting for the month. Queued kinds are rejected. */
export function applyImmediate(prev: GameState, map: WorldMap, order: Order): { state: GameState; error: string | null; notices: SimNotice[] } {
  if (QUEUED_ORDERS.has(order.type)) return { state: prev, error: null, notices: [] }
  const s = structuredClone(prev)
  const logAt = s.log.length
  const battleAt = s.battles.length
  const error = LIVE.has(order.type) ? startLive(s, map, order) : applyResolvedOrder(s, map, order)
  if (error) return { state: prev, error, notices: [] }
  return { state: s, error: null, notices: [...collectLogs(s, logAt), ...collectCaptures(s, map, battleAt)] }
}

export function cancelProject(prev: GameState, projectId: string): GameState {
  const s = structuredClone(prev)
  const index = (s.projects ?? []).findIndex((p) => p.id === projectId && p.nationId === s.playerId)
  if (index < 0) return prev
  const project = s.projects[index]
  const fraction = project.remaining / project.total > 0.85 ? 1 : 0.5
  refundProject(s, project, fraction)
  s.projects.splice(index, 1)
  return s
}

export function cancelMarch(prev: GameState, armyId: string): GameState {
  const s = structuredClone(prev)
  const army = s.armies[armyId]
  if (!army || army.owner !== s.playerId) return prev
  army.march = null
  return s
}
