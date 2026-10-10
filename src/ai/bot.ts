import { difficultyOf } from '../data/difficulty'
import { PERSONALITIES } from '../data/personalities'
import { TERRAIN } from '../data/terrain'
import { TECHS } from '../data/techTree'
import { ARMS, TRAINING, UNIT_SPECS } from '../data/unitTypes'
import { combatMods } from '../engine/arms'
import { recentlyProposed } from '../engine/diplomacy'
import { computeEconomy, unitPower, type EconomyReport } from '../engine/economy'
import { armyIsHome, atWar, boundArmy, canUseUnit, clamp, factoryCount, hasCasusBelli, hasPact, isAllied, partnerIndex } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import { createRng, type Rng } from '../engine/rng'
import { marketPrices, stockOf, type MarketPrices } from '../engine/trade'
import type { Army, BuildingType, GameState, NationId, Order, PeaceTerms, ProposalDraft, RegionId, TechBranch, TradeResource, UnitType, WorldMap } from '../engine/types'
import { TRADE_RESOURCES } from '../engine/types'
import { visibleRegions } from '../engine/visibility'
import { canReach, garrisonStrength } from '../engine/warfare'
import { MAX_REPARATIONS, netWarScore, regionValue } from '../engine/warscore'
import { evaluateProposal, perceivedPower, TRADE_RESERVE } from './diplomat'
import { coalitionActive, opinionOf } from './opinion'

export const BOT = {
  firstWarTurn: 3,
  minRecruitsPerTurn: 2,
  maxRecruitsPerTurn: 8,
  maxBuildsPerTurn: 3,
  /** Major decisions (research, construction, recruitment drives, diplomacy, war) a bot can make per month. */
  attention: [2, 4] as const,
  /** At most this many new proposals reach the player each month, and the inbox never holds more than `maxPlayerInbox`. */
  maxPlayerProposalsPerTurn: 1,
  maxPlayerInbox: 3,
  maxAlliances: 2,
}

/** Shared per-turn facts every bot reads, computed once instead of once per bot. */
export interface TurnContext {
  power: Map<NationId, number>
  neighbors: Map<NationId, Set<NationId>>
  armies: Map<NationId, Army[]>
  regions: Map<NationId, RegionId[]>
  enemies: Map<NationId, NationId[]>
  allies: Map<NationId, NationId[]>
  prices: MarketPrices
  coalition: boolean
  playerProposals: number
  playerInbox: number
  warsOnPlayer: number
}

export function buildTurnContext(s: GameState, map: WorldMap): TurnContext {
  const armies = new Map<NationId, Army[]>()
  for (const a of Object.values(s.armies).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const list = armies.get(a.owner)
    if (list) list.push(a)
    else armies.set(a.owner, [a])
  }
  const regions = new Map<NationId, RegionId[]>()
  const neighbors = new Map<NationId, Set<NationId>>()
  const link = (a: NationId, b: NationId) => {
    let set = neighbors.get(a)
    if (!set) neighbors.set(a, (set = new Set()))
    set.add(b)
  }
  for (const r of Object.values(s.regions).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const list = regions.get(r.owner)
    if (list) list.push(r.id)
    else regions.set(r.owner, [r.id])
    const mr = map.regions[r.id]
    for (const nb of [...mr.neighbors, ...mr.seaLanes]) {
      const o = s.regions[nb]?.owner
      if (o && o !== r.owner) {
        link(r.owner, o)
        link(o, r.owner)
      }
    }
  }
  const power = new Map<NationId, number>()
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
    const mods = combatMods(n, s.turn)
    power.set(n.id, (armies.get(n.id) ?? []).reduce((sum, a) => sum + unitPower(a.units, mods, a.training ?? 0), 0))
  }
  const player = s.playerId
  const enemies = partnerIndex(s.wars)
  return {
    power,
    neighbors,
    armies,
    regions,
    enemies,
    allies: partnerIndex(s.alliances),
    prices: marketPrices(s),
    coalition: coalitionActive(s),
    playerProposals: 0,
    playerInbox: s.proposals.filter((p) => p.to === player).length,
    warsOnPlayer: (enemies.get(player) ?? []).filter((e) => !e.startsWith('free-')).length,
  }
}

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function estimateDefense(s: GameState, map: WorldMap, ctx: TurnContext, regionId: RegionId): number {
  const r = s.regions[regionId]
  const owner = s.nations[r.owner]
  const mods = owner ? combatMods(owner, s.turn) : null
  const armyPower = (ctx.armies.get(r.owner) ?? []).filter((a) => a.location === regionId).reduce((sum, a) => sum + unitPower(a.units, mods, a.training ?? 0), 0)
  return (armyPower + garrisonStrength(s, map, regionId) * UNIT_SPECS.infantry.defense) * TERRAIN[map.regions[regionId].terrain].defense
}

/** One step along the shortest path through owned territory toward any region in `goals`. */
function stepToward(s: GameState, map: WorldMap, nationId: NationId, from: RegionId, goals: Set<RegionId>): RegionId | null {
  if (goals.has(from)) return null
  const prev = new Map<RegionId, RegionId>([[from, from]])
  const queue = [from]
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
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

/** Stock above which a nation considers a resource spare. */
const SURPLUS: Record<TradeResource, number> = { capital: 80, food: 40, tp: 60, manpower: 180 }

type Agenda = 'peace' | 'allies' | 'research' | 'economy' | 'military' | 'trade' | 'diplomacy' | 'war'

export function generateBotOrders(s: GameState, map: WorldMap, nationId: NationId, allowPlayer = false, context?: TurnContext): Order[] {
  const n = s.nations[nationId]
  if (!n?.alive || (n.isPlayer && !allowPlayer)) return []
  const ctx = context ?? buildTurnContext(s, map)
  const diff = difficultyOf(s.settings.difficulty)
  const persona = PERSONALITIES[n.personality ?? 'honorable']
  const rng: Rng = createRng(s.seed, s.turn * 100003 + hashString(nationId))
  const econ = computeEconomy(s, map, nationId)
  const vis = visibleRegions(s, map, nationId)
  const myNeighbors = ctx.neighbors.get(nationId) ?? new Set<NationId>()
  const playerId = s.playerId
  const orders: Order[] = []
  const tryAdd = (o: Order) => {
    if (validateOrder(s, map, o, orders) === null) {
      orders.push(o)
      return true
    }
    return false
  }

  const perceivedCache = new Map<NationId, number>()
  const perceived = (id: NationId) => {
    let v = perceivedCache.get(id)
    if (v === undefined) perceivedCache.set(id, (v = perceivedPower(s, map, nationId, id, vis, ctx.armies.get(id) ?? [])))
    return v
  }
  const opinionCache = new Map<NationId, number>()
  const opinion = (id: NationId) => {
    let v = opinionCache.get(id)
    if (v === undefined) opinionCache.set(id, (v = opinionOf(s, map, nationId, id, { borders: myNeighbors.has(id), coalition: ctx.coalition, enemies: ctx.enemies })))
    return v
  }
  /** The player's inbox is rate limited so bots feel like busy rivals, not spam. */
  const canAsk = (target: NationId) =>
    target !== playerId || (ctx.playerProposals < BOT.maxPlayerProposalsPerTurn && ctx.playerInbox < BOT.maxPlayerInbox)
  const proposeTo = (target: NationId, proposal: ProposalDraft) => {
    if (!canAsk(target)) return false
    if (!tryAdd({ type: 'propose', nationId, target, proposal })) return false
    if (target === playerId) {
      ctx.playerProposals++
      ctx.playerInbox++
    }
    return true
  }

  const mistake = rng.chance(diff.mistakeRate) ? rng.pick(['research', 'overconfident', 'idle', 'hesitant'] as const) : null
  let attention = rng.int(BOT.attention[0], BOT.attention[1])
  const myPower = ctx.power.get(nationId) ?? 0
  const enemiesOf = (id: NationId) => ctx.enemies.get(id) ?? []
  const alliesOf = (id: NationId) => ctx.allies.get(id) ?? []
  const enemies = enemiesOf(nationId)
  const atWarNow = enemies.length > 0
  const owned = ctx.regions.get(nationId) ?? []
  const myArmies = ctx.armies.get(nationId) ?? []

  for (const p of s.proposals) {
    if (p.to !== nationId) continue
    const v = evaluateProposal(s, map, nationId, p, rng, ctx.prices)
    tryAdd({ type: 'respond', nationId, proposalId: p.id, accept: v.accept })
  }

  let tax = n.taxRate
  if (n.stability < 40) tax -= 0.05
  else if (econ.netCapital < 0 || n.resources.capital < 15) tax += 0.05
  else if (tax > 0.27) tax -= 0.02
  else if (tax < 0.23) tax += 0.02
  tax = clamp(Math.round(tax * 100) / 100, 0.1, 0.4)
  const draft = atWarNow ? (n.warWeariness > 30 ? 0.07 : 0.1) : 0.05
  if (Math.abs(tax - n.taxRate) > 1e-6 || Math.abs(draft - n.draftRate) > 1e-6) tryAdd({ type: 'setPolicy', nationId, taxRate: tax, draftRate: draft })

  const reserve = 15
  let budget = Math.max(0, n.resources.capital - reserve)

  const agenda: Record<Agenda, () => boolean> = {
    research() {
      const priorities = BRANCH_PRIORITY[n.aggression > 0.5 ? 'aggressive' : 'builder']
      const candidates = TECHS.filter((t) => !n.techs.includes(t.id) && t.requires.every((r) => n.techs.includes(r)) && t.cost <= n.resources.tp).sort(
        (a, b) => a.cost - b.cost || priorities.indexOf(a.branch) - priorities.indexOf(b.branch),
      )
      if (!candidates.length) return false
      const pick = mistake === 'research' ? rng.pick(candidates) : candidates[0]
      return tryAdd({ type: 'research', nationId, techId: pick.id })
    },

    economy() {
      let used = false
      const starving = myArmies.find((a) => a.outOfSupplyTurns > 0 && s.regions[a.location]?.owner === nationId && s.regions[a.location].buildings.depot === 0)
      if (starving && budget > 30 && tryAdd({ type: 'build', nationId, regionId: starving.location, building: 'depot' })) {
        budget -= 30
        used = true
      }
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
        const b = building
        const byFewest = (list: RegionId[]) => list.reduce((best, id) => (s.regions[id].buildings[b] < s.regions[best].buildings[b] ? id : best), list[0])
        const coastal = owned.filter((id) => map.regions[id].coastal)
        const place = b === 'port' ? (coastal.length ? byFewest(coastal) : undefined) : i === 0 ? mainRegion : byFewest(owned)
        if (place && tryAdd({ type: 'build', nationId, regionId: place, building: b })) {
          budget -= 40
          used = true
        }
      }
      return used
    },

    military() {
      const income = econ.taxIncome + econ.factoryIncome + econ.tradeIncome
      const upkeepRoom = income * 0.65 - econ.upkeep
      const wantsArmy = atWarNow || rng.chance(0.25 + n.aggression * persona.aggression * 0.2)
      const trainHome = () => {
        const ready = myArmies
          .filter((a) => armyIsHome(s, map, a) && (a.training ?? 0) < TRAINING.max)
          .sort((a, b) => (a.training ?? 0) - (b.training ?? 0) || (a.id < b.id ? -1 : 1))
        let trained = 0
        for (const a of ready) {
          if (trained >= 2) break
          if (tryAdd({ type: 'train', nationId, armyId: a.id })) trained++
        }
        return trained > 0
      }
      const signDomestic = () => {
        if (!rng.chance(0.35) || n.resources.capital < 120) return false
        const factories = factoryCount(s, nationId)
        if (factories < 1) return false
        const unit: UnitType = canUseUnit(n, 'armor') && rng.chance(0.4) ? 'armor' : 'infantry'
        if (!canUseUnit(n, unit)) return false
        const tier = factories >= 3 && n.resources.capital > 220 ? 2 : 1
        if ((n.contracts ?? []).some((c) => c.unit === unit && c.until >= s.turn && c.tier >= tier)) return false
        return tryAdd({ type: 'signContract', nationId, unit, tier })
      }
      if (!wantsArmy || upkeepRoom <= 0) return trainHome() || signDomestic()
      const frontline = owned.filter((id) => map.regions[id].neighbors.some((nb) => enemies.includes(s.regions[nb]?.owner)))
      const musterIds = (regionIds: RegionId[]) => {
        const ids: string[] = []
        for (const regionId of regionIds) {
          for (const tid of map.territoriesByRegion[regionId] ?? []) {
            const bound = boundArmy(s, tid, nationId)
            if (bound && bound.location !== map.territories[tid].regionId) continue
            ids.push(tid)
          }
        }
        return ids.sort()
      }
      let sites = musterIds(frontline.length ? frontline : owned)
      if (!sites.length) sites = musterIds(owned)
      const occupied = sites.filter((tid) => boundArmy(s, tid, nationId))
      const empty = sites.filter((tid) => !boundArmy(s, tid, nationId))
      const recruitTerritory = (empty.length && rng.chance(0.35) ? empty[0] : occupied[0]) ?? empty[0]
      if (!recruitTerritory) {
        const site = frontline[0] ?? owned[0]
        if (site && budget > 40 && tryAdd({ type: 'build', nationId, regionId: site, building: 'barracks' })) {
          budget -= 30
          return true
        }
        return trainHome()
      }
      const recruitRegion = map.territories[recruitTerritory].regionId
      let room = upkeepRoom
      let recruited = 0
      const maxRecruits = clamp(Math.round(income / 30), BOT.minRecruitsPerTurn, BOT.maxRecruitsPerTurn)
      for (let i = 0; i < maxRecruits && budget > 10; i++) {
        const roll = rng.next()
        let unit: UnitType = 'infantry'
        if (roll < 0.3 && canUseUnit(n, 'armor')) unit = 'armor'
        else if (roll < 0.45 && canUseUnit(n, 'air') && s.regions[recruitRegion].buildings.factory > 0) unit = 'air'
        else if (roll < 0.5 && canUseUnit(n, 'naval') && s.regions[recruitRegion].buildings.port > 0) unit = 'naval'
        const spec = UNIT_SPECS[unit]
        if (spec.upkeep > room || spec.capitalCost > budget) break
        if (!tryAdd({ type: 'recruit', nationId, territoryId: recruitTerritory, unit })) break
        budget -= spec.capitalCost
        room -= spec.upkeep
        recruited++
      }
      return recruited > 0
    },

    peace() {
      let used = false
      for (const e of enemies) {
        if (recentlyProposed(s, nationId, e, 'peace', 4) || s.proposals.some((p) => p.from === nationId && p.to === e)) continue
        const theirs = perceived(e)
        const net = netWarScore(s, nationId, e)
        const losing = myPower < theirs * 0.6
        const weary = n.warWeariness > 30
        const satisfied = net >= 25 && n.personality !== 'expansionist' && rng.chance(0.35)
        if (!(weary || losing || satisfied)) continue
        if (!proposeTo(e, { kind: 'peace', terms: peaceTerms(s, map, nationId, e, net, weary || losing) })) {
          if (!proposeTo(e, { kind: 'peace', terms: { cede: [], reparations: 0 } })) continue
        }
        used = true
      }
      return used
    },

    allies() {
      for (const e of enemies) {
        if (myPower > perceived(e) * 1.2) continue
        for (const ally of [...alliesOf(nationId)].sort()) {
          if (atWar(s, ally, e) || recentlyProposed(s, nationId, ally, 'callToArms', 6)) continue
          if (proposeTo(ally, { kind: 'callToArms', enemy: e })) return true
        }
      }
      return false
    },

    trade() {
      if (planTrade(s, ctx, nationId, econ, rng, persona.dealAppetite, opinion, proposeTo)) return true
      return planArms(s, ctx, nationId, rng, myPower, atWarNow, opinion, perceived, proposeTo)
    },

    diplomacy() {
      const allies = alliesOf(nationId)
      for (const a of [...allies].sort()) {
        if (n.personality !== 'honorable' && opinion(a) < -25 && rng.chance(0.3) && tryAdd({ type: 'leaveAlliance', nationId, target: a })) return true
      }
      if (n.personality === 'opportunist')
        for (const d of s.deals) {
          if (d.kind !== 'trade' || (d.from !== nationId && d.to !== nationId)) continue
          const partner = d.from === nationId ? d.to : d.from
          if (opinion(partner) < -30 && rng.chance(0.15) && tryAdd({ type: 'cancelDeal', nationId, dealId: d.id })) return true
        }

      if (allies.length < BOT.maxAlliances) {
        let threat: NationId | null = null
        let threatPower = 0
        for (const x of [...myNeighbors].sort()) {
          if (!s.nations[x]?.alive || isAllied(s, nationId, x)) continue
          const px = perceived(x) * (ctx.coalition && x === playerId ? 1.4 : 1)
          if (px > myPower * 1.35 && opinion(x) < 5 && px > threatPower) {
            threat = x
            threatPower = px
          }
        }
        if (threat) {
          const candidates = [...(ctx.neighbors.get(threat) ?? []), ...enemiesOf(threat)]
            .filter((y, i, arr) => arr.indexOf(y) === i && y !== nationId && y !== threat && s.nations[y]?.alive)
            .filter((y) => !isAllied(s, nationId, y) && !atWar(s, nationId, y) && opinion(y) >= 5 && !recentlyProposed(s, nationId, y, 'alliance', 8))
            .sort((a, b) => opinion(b) - opinion(a) || (a < b ? -1 : 1))
          for (const y of candidates.slice(0, 3)) if (proposeTo(y, { kind: 'alliance' })) return true
        }
      }

      if (rng.chance(persona.pactBias > 0 ? 0.1 : 0.03)) {
        const strong = [...myNeighbors]
          .filter((x) => s.nations[x]?.alive && !atWar(s, nationId, x) && !hasPact(s, nationId, x) && !isAllied(s, nationId, x) && !recentlyProposed(s, nationId, x, 'pact', 8))
          .sort((a, b) => perceived(b) - perceived(a) || (a < b ? -1 : 1))[0]
        if (strong && perceived(strong) > myPower * 1.3 && proposeTo(strong, { kind: 'pact' })) return true
      }
      return false
    },

    war() {
      const maxWars = n.personality === 'turtle' ? 1 : 2
      if (enemies.length >= maxWars || s.turn < BOT.firstWarTurn || mistake === 'hesitant') return false
      if (n.warWeariness > 25) return false
      const playerCap = diff.maxWarsOnPlayer + (ctx.coalition ? 1 : 0)
      let best: { id: NationId; ratio: number } | null = null
      for (const id of [...myNeighbors].sort()) {
        const t = s.nations[id]
        if (!t?.alive || atWar(s, nationId, id) || hasPact(s, nationId, id) || isAllied(s, nationId, id)) continue
        if (id === playerId && (s.turn < diff.playerGracePeriod || ctx.warsOnPlayer >= playerCap)) continue
        const op = opinion(id)
        if (op > 20 || (n.personality === 'honorable' && op > 0)) continue
        let defense = perceived(id)
        for (const ally of alliesOf(id)) if (myNeighbors.has(ally)) defense += perceived(ally) * 0.5
        let ratio = myPower / Math.max(0.5, defense)
        if (hasCasusBelli(s, nationId, id)) ratio *= 1.5
        if (op < -30) ratio *= 1.15
        if (enemiesOf(id).length > 0) ratio *= n.personality === 'opportunist' ? 1.4 : 1.15
        if (ctx.coalition && id === playerId) ratio *= 1.2
        if (!best || ratio > best.ratio) best = { id, ratio }
      }
      if (!best || best.ratio <= diff.warDeclarePowerRatio / persona.risk) return false
      if (!rng.chance(n.aggression * persona.aggression * diff.aggression * 0.12)) return false
      if (!tryAdd({ type: 'declareWar', nationId, target: best.id })) return false
      if (best.id === playerId) ctx.warsOnPlayer++
      return true
    },
  }

  const plan: Agenda[] = atWarNow
    ? ['peace', 'military', 'allies', ...shuffle<Agenda>(['research', 'economy', 'trade', 'diplomacy', 'war'], rng)]
    : shuffle<Agenda>(['research', 'economy', 'military', 'trade', 'diplomacy', 'war'], rng)
  for (const item of plan) {
    if (attention <= 0) break
    if (agenda[item]()) attention--
  }

  const attackRatio = (diff.attackRatio / persona.risk) * (mistake === 'overconfident' ? 0.75 : 1)
  const warTargets = new Set(enemies)
  const fronts = new Set(enemies)
  for (const o of orders) {
    if (o.type !== 'declareWar') continue
    fronts.add(o.target)
    // The player gets a month to react to a declaration before the first blow lands.
    if (o.target !== playerId) warTargets.add(o.target)
  }
  const borderGoals = new Set(owned.filter((id) => map.regions[id].neighbors.some((nb) => fronts.has(s.regions[nb]?.owner))))
  const committed = new Map<RegionId, number>()
  const mods = combatMods(n, s.turn)
  for (const a of myArmies) {
    if (s.regions[a.location].rebels > 0) {
      tryAdd({ type: 'attack', nationId, armyId: a.id, target: a.location })
      continue
    }
    const options = [...map.regions[a.location].neighbors, ...map.regions[a.location].seaLanes]
      .filter((id) => warTargets.has(s.regions[id]?.owner) && canReach(s, map, nationId, a.location, id, 'attack').ok)
      .map((id) => ({ id, def: estimateDefense(s, map, ctx, id) - (committed.get(id) ?? 0) }))
      .sort((x, y) => x.def - y.def || (x.id < y.id ? -1 : 1))
    const power = unitPower(a.units, mods, a.training ?? 0)
    const target = options[0]
    if (target && power > target.def * attackRatio) {
      if (tryAdd({ type: 'attack', nationId, armyId: a.id, target: target.id })) committed.set(target.id, (committed.get(target.id) ?? 0) + power)
      continue
    }
    if (mistake === 'idle' || a.outOfSupplyTurns > 0) continue
    if (borderGoals.size && !borderGoals.has(a.location)) {
      const step = stepToward(s, map, nationId, a.location, borderGoals)
      if (step) tryAdd({ type: 'move', nationId, armyId: a.id, to: step })
    }
  }

  return orders
}

/** What a bot asks for at the peace table: land if it is winning, a white peace or payment if it is losing. */
function peaceTerms(s: GameState, map: WorldMap, me: NationId, enemy: NationId, net: number, desperate: boolean): PeaceTerms {
  if (net >= 12) {
    let budget = Math.floor(net * 0.85)
    const enemyNation = s.nations[enemy]
    const border = Object.values(s.regions)
      .filter((r) => r.owner === enemy && r.id !== enemyNation.capital && map.regions[r.id].neighbors.some((nb) => s.regions[nb]?.owner === me))
      .map((r) => ({ id: r.id, value: regionValue(s, map, r.id) }))
      .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1))
    const cede: RegionId[] = []
    for (const r of border) {
      if (cede.length >= 2) break
      if (r.value <= budget) {
        cede.push(r.id)
        budget -= r.value
      }
    }
    const reparations = Math.min(MAX_REPARATIONS, Math.floor(budget / 1.2 / 2))
    return { cede, reparations: cede.length ? 0 : Math.max(0, reparations) }
  }
  if (net <= -10 && desperate) return { cede: [], reparations: -clamp(Math.round(-net * 0.4), 3, 20) }
  return { cede: [], reparations: 0 }
}

/** Traders offer weapons to neighbors under pressure. A nation at war asks a neighbor to sell. */
function planArms(
  s: GameState,
  ctx: TurnContext,
  nationId: NationId,
  rng: Rng,
  myPower: number,
  atWarNow: boolean,
  opinion: (id: NationId) => number,
  perceived: (id: NationId) => number,
  proposeTo: (target: NationId, p: ProposalDraft) => boolean,
): boolean {
  const n = s.nations[nationId]
  const factories = factoryCount(s, nationId)
  if (n.personality === 'trader' && factories >= 1 && canUseUnit(n, 'infantry') && rng.chance(0.4)) {
    const buyers = [...(ctx.neighbors.get(nationId) ?? [])]
      .filter((id) => s.nations[id]?.alive && !atWar(s, nationId, id) && opinion(id) > -5 && !recentlyProposed(s, nationId, id, 'arms', 8))
      .filter((id) => (ctx.enemies.get(id) ?? []).length > 0 || perceived(id) < myPower)
      .sort((a, b) => opinion(b) - opinion(a) || (a < b ? -1 : 1))
    for (const buyer of buyers.slice(0, 2)) {
      if (proposeTo(buyer, { kind: 'arms', terms: { unit: 'infantry', tier: 1, months: 6, payPerMonth: ARMS.foreignPay[0], seller: nationId } })) return true
    }
  }
  const needsGuns = atWarNow && !(n.contracts ?? []).some((c) => c.unit === 'infantry' && c.until >= s.turn)
  if (needsGuns && n.resources.capital > 60 && rng.chance(0.5)) {
    const sellers = [...new Set([...(ctx.neighbors.get(nationId) ?? []), ...(ctx.allies.get(nationId) ?? [])])]
      .filter((id) => s.nations[id]?.alive && !atWar(s, nationId, id) && opinion(id) > -5 && !recentlyProposed(s, nationId, id, 'arms', 8))
      .filter((id) => canUseUnit(s.nations[id], 'infantry') && factoryCount(s, id) >= 1)
      .sort((a, b) => Number(s.nations[b].personality === 'trader') - Number(s.nations[a].personality === 'trader') || (a < b ? -1 : 1))
    for (const seller of sellers.slice(0, 2)) {
      if (proposeTo(seller, { kind: 'arms', terms: { unit: 'infantry', tier: 1, months: 6, payPerMonth: ARMS.foreignPay[0], seller } })) return true
    }
  }
  return false
}

/** Bots buy what they lack with what they have spare, and pay a little over market when desperate. */
function planTrade(
  s: GameState,
  ctx: TurnContext,
  nationId: NationId,
  econ: EconomyReport,
  rng: Rng,
  appetite: number,
  opinion: (id: NationId) => number,
  proposeTo: (target: NationId, p: ProposalDraft) => boolean,
): boolean {
  const n = s.nations[nationId]
  const atWarNow = (ctx.enemies.get(nationId) ?? []).length > 0
  const needs: { r: TradeResource; amount: number; months: number }[] = []
  if (econ.netFood < 0 && !n.foodShortage) needs.push({ r: 'food', amount: Math.ceil(Math.max(2, -econ.netFood * 1.2)), months: 6 })
  else if (n.foodShortage) needs.push({ r: 'food', amount: Math.ceil(Math.max(10, -econ.netFood * 4)), months: 0 })
  if (n.resources.capital < 30 && econ.netCapital < 2) needs.push({ r: 'capital', amount: 40, months: 0 })
  if (atWarNow && n.militaryPool < 40) needs.push({ r: 'manpower', amount: 60, months: 0 })
  const spare = TRADE_RESOURCES.filter((r) => !needs.some((x) => x.r === r) && stockOf(n, r) > SURPLUS[r])
  if (!spare.length) return false
  const partners = new Set<NationId>([...(ctx.neighbors.get(nationId) ?? []), ...(ctx.allies.get(nationId) ?? [])])
  for (const d of s.deals) if (d.from === nationId || d.to === nationId) partners.add(d.from === nationId ? d.to : d.from)
  if (!needs.length) return rng.chance(0.35 * appetite) && sellSurplus(s, ctx, nationId, spare, partners, opinion, proposeTo)

  const need = needs[0]
  const total = need.amount * Math.max(1, need.months)
  const candidates = [...partners]
    .filter((id) => id !== nationId && s.nations[id]?.alive && !atWar(s, nationId, id) && opinion(id) > -15)
    .filter((id) => stockOf(s.nations[id], need.r) > SURPLUS[need.r] * 0.6 + total * (need.months ? 0.3 : 1))
    .filter((id) => !recentlyProposed(s, nationId, id, 'trade', 4))
    .sort((a, b) => opinion(b) - opinion(a) || (a < b ? -1 : 1))
  const desperation = n.foodShortage || n.resources.capital < 10 ? 1.12 : 1
  const premium = (1 + (appetite - 1) * 0.15 + 0.06) * desperation
  for (const partner of candidates.slice(0, 3)) {
    const pay = spare
      .map((r) => ({ r, amount: Math.ceil((need.amount * ctx.prices[need.r] * premium) / ctx.prices[r]) }))
      .filter((x) => stockOf(n, x.r) - x.amount * Math.max(1, need.months) >= TRADE_RESERVE[x.r] + 5)
    if (!pay.length) continue
    const offer = pay[Math.floor(rng.next() * pay.length)]
    if (proposeTo(partner, { kind: 'trade', terms: { give: { [offer.r]: offer.amount }, receive: { [need.r]: need.amount }, months: need.months } })) return true
  }
  return false
}

/** Signals a buyer would show without inspecting its books: hunger, an empty treasury, or a war short of men. */
function visiblyShort(s: GameState, ctx: TurnContext, id: NationId, r: TradeResource): boolean {
  const n = s.nations[id]
  switch (r) {
    case 'food':
      return n.foodShortage || n.resources.food < 12
    case 'capital':
      return n.resources.capital < 20
    case 'manpower':
      return (ctx.enemies.get(id) ?? []).length > 0 && n.militaryPool < 50
    case 'tp':
      return false
  }
}

/** A bot with plenty of something offers it to a partner who visibly needs it, for Capital at a small markup. */
function sellSurplus(
  s: GameState,
  ctx: TurnContext,
  nationId: NationId,
  spare: TradeResource[],
  partners: Set<NationId>,
  opinion: (id: NationId) => number,
  proposeTo: (target: NationId, p: ProposalDraft) => boolean,
): boolean {
  const n = s.nations[nationId]
  for (const r of spare) {
    if (r === 'capital') continue
    const amount = Math.floor(Math.min(stockOf(n, r) - SURPLUS[r] * 0.6, r === 'manpower' ? 80 : 40))
    if (amount < 8) continue
    const price = Math.ceil(amount * ctx.prices[r] * 1.1)
    const buyers = [...partners]
      .filter((id) => s.nations[id]?.alive && !atWar(s, nationId, id) && visiblyShort(s, ctx, id, r) && s.nations[id].resources.capital >= price + TRADE_RESERVE.capital)
      .filter((id) => opinion(id) > -10 && !recentlyProposed(s, nationId, id, 'trade', 6))
      .sort((a, b) => opinion(b) - opinion(a) || (a < b ? -1 : 1))
    for (const buyer of buyers.slice(0, 2)) if (proposeTo(buyer, { kind: 'trade', terms: { give: { [r]: amount }, receive: { capital: price }, months: 0 } })) return true
  }
  return false
}

export function generateAllBotOrders(s: GameState, map: WorldMap, includePlayer = false): Order[] {
  const ctx = buildTurnContext(s, map)
  const ids = shuffle(Object.keys(s.nations).sort(), createRng(s.seed, s.turn * 7919 + 17))
  return ids.flatMap((id) => generateBotOrders(s, map, id, includePlayer, ctx))
}
