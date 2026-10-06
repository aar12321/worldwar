import { TERRAIN } from '../data/terrain'
import { TECHS } from '../data/techTree'
import { UNIT_SPECS } from '../data/unitTypes'
import { computeEconomy, militaryPower, unitPower } from '../engine/economy'
import { armiesIn, armiesOf, atWar, canUseUnit, clamp, enemiesOf, hasCasusBelli, hasPact, regionsOf } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import { createRng, type Rng } from '../engine/rng'
import type { BuildingType, GameState, NationId, Order, RegionId, TechBranch, UnitType, WorldMap } from '../engine/types'
import { canReach, garrisonStrength } from '../engine/warfare'

export const BOT = {
  playerGracePeriod: 10,
  firstWarTurn: 3,
  minRecruitsPerTurn: 2,
  maxRecruitsPerTurn: 8,
  maxBuildsPerTurn: 3,
  attackRatio: 1.3,
  warDeclarePowerRatio: 1.5,
}

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

export function estimateDefense(s: GameState, map: WorldMap, regionId: RegionId): number {
  const r = s.regions[regionId]
  const armies = armiesIn(s, regionId, r.owner)
  const armyPower = armies.reduce((sum, a) => sum + unitPower(a.units), 0)
  return (armyPower + garrisonStrength(s, map, regionId) * UNIT_SPECS.infantry.defense) * TERRAIN[map.regions[regionId].terrain].defense
}

function neighborNations(s: GameState, map: WorldMap, nationId: NationId): NationId[] {
  const out = new Set<NationId>()
  for (const id of regionsOf(s, nationId))
    for (const nb of map.regions[id].neighbors) {
      const owner = s.regions[nb]?.owner
      if (owner && owner !== nationId && s.nations[owner]?.alive) out.add(owner)
    }
  return [...out].sort()
}

/** One step along the shortest path through owned territory toward any region in `goals`. */
function stepToward(s: GameState, map: WorldMap, nationId: NationId, from: RegionId, goals: Set<RegionId>): RegionId | null {
  if (goals.has(from)) return null
  const prev = new Map<RegionId, RegionId>([[from, from]])
  const queue = [from]
  while (queue.length) {
    const cur = queue.shift()!
    if (goals.has(cur)) {
      let step = cur
      while (prev.get(step) !== from) step = prev.get(step)!
      return step
    }
    for (const nb of map.regions[cur].neighbors) {
      if (prev.has(nb) || s.regions[nb]?.owner !== nationId) continue
      prev.set(nb, cur)
      queue.push(nb)
    }
  }
  return null
}

const BRANCH_PRIORITY: Record<'aggressive' | 'builder', TechBranch[]> = {
  aggressive: ['land', 'air', 'infra', 'naval'],
  builder: ['infra', 'land', 'air', 'naval'],
}

export function generateBotOrders(s: GameState, map: WorldMap, nationId: NationId, allowPlayer = false): Order[] {
  const n = s.nations[nationId]
  if (!n.alive || (n.isPlayer && !allowPlayer)) return []
  const rng: Rng = createRng(s.seed, s.turn * 100003 + hashString(nationId))
  const econ = computeEconomy(s, map, nationId)
  const orders: Order[] = []
  const tryAdd = (o: Order) => {
    if (validateOrder(s, map, o, orders) === null) {
      orders.push(o)
      return true
    }
    return false
  }
  const enemies = enemiesOf(s, nationId)
  const atWarNow = enemies.length > 0
  const owned = regionsOf(s, nationId)

  let tax = n.taxRate
  if (n.stability < 40) tax -= 0.05
  else if (econ.netCapital < 0 || n.resources.capital < 15) tax += 0.05
  else if (tax > 0.27) tax -= 0.02
  else if (tax < 0.23) tax += 0.02
  tax = clamp(Math.round(tax * 100) / 100, 0.1, 0.4)
  const draft = atWarNow ? (n.warWeariness > 30 ? 0.07 : 0.1) : 0.05
  if (Math.abs(tax - n.taxRate) > 1e-6 || Math.abs(draft - n.draftRate) > 1e-6)
    tryAdd({ type: 'setPolicy', nationId, taxRate: tax, draftRate: draft })

  const priorities = BRANCH_PRIORITY[n.aggression > 0.5 ? 'aggressive' : 'builder']
  const candidates = TECHS.filter((t) => !n.techs.includes(t.id) && t.requires.every((r) => n.techs.includes(r))).sort(
    (a, b) => a.cost - b.cost || priorities.indexOf(a.branch) - priorities.indexOf(b.branch),
  )
  if (candidates[0]) tryAdd({ type: 'research', nationId, techId: candidates[0].id })

  const reserve = 15
  let budget = Math.max(0, n.resources.capital - reserve)
  const mainRegion = owned.reduce((best, id) => (s.regions[id].population > s.regions[best].population ? id : best), owned[0])
  const builds = Math.min(BOT.maxBuildsPerTurn, 1 + Math.floor(budget / 150))
  for (let i = 0; i < builds && mainRegion; i++) {
    let building: BuildingType | null = null
    if (i === 0 && (econ.netFood < 0.5 || n.foodShortage)) building = 'farm'
    else if (econ.laborRatio > 0.9 && budget > 60) {
      const roll = rng.next()
      building = roll < 0.5 ? 'factory' : roll < 0.75 ? 'university' : roll < 0.85 ? 'farm' : roll < 0.93 ? 'barracks' : 'port'
    }
    if (!building) break
    const byFewest = (list: RegionId[]) => list.reduce((best, id) => (s.regions[id].buildings[building] < s.regions[best].buildings[building] ? id : best), list[0])
    const coastal = owned.filter((id) => map.regions[id].coastal)
    const place = building === 'port' ? (coastal.length ? byFewest(coastal) : undefined) : i === 0 ? mainRegion : byFewest(owned)
    if (place && tryAdd({ type: 'build', nationId, regionId: place, building })) budget -= 40
  }

  const income = econ.taxIncome + econ.factoryIncome + econ.tradeIncome
  const upkeepRoom = income * 0.65 - econ.upkeep
  const wantsArmy = atWarNow || rng.chance(0.25 + n.aggression * 0.2)
  if (wantsArmy && upkeepRoom > 0) {
    const frontline = owned.filter((id) => map.regions[id].neighbors.some((nb) => enemies.includes(s.regions[nb]?.owner)))
    const recruitRegion =
      frontline.find((id) => s.regions[id].buildings.barracks > 0) ?? owned.find((id) => s.regions[id].buildings.barracks > 0)
    let room = upkeepRoom
    const maxRecruits = clamp(Math.round(income / 30), BOT.minRecruitsPerTurn, BOT.maxRecruitsPerTurn)
    for (let i = 0; i < maxRecruits && recruitRegion && budget > 10; i++) {
      const roll = rng.next()
      let unit: UnitType = 'infantry'
      if (roll < 0.3 && canUseUnit(n, 'armor')) unit = 'armor'
      else if (roll < 0.45 && canUseUnit(n, 'air') && s.regions[recruitRegion].buildings.factory > 0) unit = 'air'
      else if (roll < 0.5 && canUseUnit(n, 'naval') && s.regions[recruitRegion].buildings.port > 0) unit = 'naval'
      const spec = UNIT_SPECS[unit]
      if (spec.upkeep > room || spec.capitalCost > budget) break
      if (!tryAdd({ type: 'recruit', nationId, regionId: recruitRegion, unit })) break
      budget -= spec.capitalCost
      room -= spec.upkeep
    }
  }

  const myPower = militaryPower(s, nationId)
  for (const e of enemies) {
    const theirPower = militaryPower(s, e)
    if (n.warWeariness > 30 || myPower < theirPower * 0.6) tryAdd({ type: 'offerPeace', nationId, target: e })
  }
  if (enemies.length < 2 && s.turn >= BOT.firstWarTurn) {
    const targets = neighborNations(s, map, nationId).filter(
      (id) => !atWar(s, nationId, id) && !hasPact(s, nationId, id) && !(s.nations[id].isPlayer && s.turn < BOT.playerGracePeriod),
    )
    let best: { id: NationId; ratio: number } | null = null
    for (const id of targets) {
      const ratio = myPower / Math.max(0.5, militaryPower(s, id))
      const bonus = hasCasusBelli(s, nationId, id) ? 1.5 : 1
      if (!best || ratio * bonus > best.ratio) best = { id, ratio: ratio * bonus }
    }
    if (best && best.ratio > BOT.warDeclarePowerRatio && rng.chance(n.aggression * 0.12)) tryAdd({ type: 'declareWar', nationId, target: best.id })
    else if (targets.length && rng.chance(0.02)) {
      const strongest = targets.reduce((a, b) => (militaryPower(s, a) > militaryPower(s, b) ? a : b))
      if (militaryPower(s, strongest) > myPower * 1.5) tryAdd({ type: 'offerPact', nationId, target: strongest })
    }
  }

  const warTargets = new Set(enemies)
  for (const o of orders) if (o.type === 'declareWar') warTargets.add(o.target)
  const borderGoals = new Set(owned.filter((id) => map.regions[id].neighbors.some((nb) => warTargets.has(s.regions[nb]?.owner))))
  const committed = new Map<RegionId, number>()
  for (const a of armiesOf(s, nationId)) {
    const rebelHere = s.regions[a.location].rebels > 0
    if (rebelHere) {
      tryAdd({ type: 'attack', nationId, armyId: a.id, target: a.location })
      continue
    }
    const options = [...map.regions[a.location].neighbors, ...map.regions[a.location].seaLanes]
      .filter((id) => warTargets.has(s.regions[id]?.owner) && canReach(s, map, nationId, a.location, id, 'attack').ok)
      .map((id) => ({ id, def: estimateDefense(s, map, id) - (committed.get(id) ?? 0) }))
      .sort((x, y) => x.def - y.def || (x.id < y.id ? -1 : 1))
    const power = unitPower(a.units)
    const target = options[0]
    if (target && power > target.def * BOT.attackRatio) {
      if (tryAdd({ type: 'attack', nationId, armyId: a.id, target: target.id })) committed.set(target.id, (committed.get(target.id) ?? 0) + power)
      continue
    }
    if (borderGoals.size && !borderGoals.has(a.location)) {
      const step = stepToward(s, map, nationId, a.location, borderGoals)
      if (step) tryAdd({ type: 'move', nationId, armyId: a.id, to: step })
    }
  }

  return orders
}

export function generateAllBotOrders(s: GameState, map: WorldMap, includePlayer = false): Order[] {
  return Object.keys(s.nations)
    .sort()
    .flatMap((id) => generateBotOrders(s, map, id, includePlayer))
}
