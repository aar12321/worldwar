import { difficultyOf } from '../data/difficulty'
import { PERSONALITIES } from '../data/personalities'
import { TERRAIN } from '../data/terrain'
import { TECHS } from '../data/techTree'
import { TRAINING, UNIT_SPECS, weaponCost } from '../data/unitTypes'
import { COMMITS, type Stance } from '../data/war'
import { nextWeaponLevel } from '../engine/arms'
import { recentlyProposed } from '../engine/diplomacy'
import { computeEconomy, lineMax, type EconomyReport } from '../engine/economy'
import { atWar, canUseUnit, clamp, hasCasusBelli, hasPact, isAllied, pairKey, partnerIndex, totalUnits } from '../engine/helpers'
import { militaryPower } from '../engine/militaryStats'
import { validateOrder } from '../engine/orders'
import { createRng, type Rng } from '../engine/rng'
import { marketPrices, stockOf, type MarketPrices } from '../engine/trade'
import type { BuildingType, GameState, NationId, Order, PeaceTerms, ProposalDraft, RegionId, TechBranch, TradeResource, UnitType, WorldMap } from '../engine/types'
import { TRADE_RESOURCES, UNIT_TYPES } from '../engine/types'
import { canAttackRegion, garrisonStrength } from '../engine/warfare'
import { MAX_REPARATIONS, netWarScore, regionValue } from '../engine/warscore'
import { evaluateProposal, perceivedPower, TRADE_RESERVE } from './diplomat'
import { coalitionActive, opinionOf } from './opinion'

export const BOT = {
  firstWarTurn: 3,
  minRecruitsPerTurn: 2,
  maxRecruitsPerTurn: 16,
  maxBuildsPerTurn: 3,
  /** Major decisions (research, construction, recruitment drives, diplomacy, war) a bot can make per month. */
  attention: [2, 4] as const,
  /** At most this many new proposals reach the player each month, and the inbox never holds more than `maxPlayerInbox`. */
  maxPlayerProposalsPerTurn: 1,
  maxPlayerInbox: 3,
  maxAlliances: 2,
  /** Months after a bot declares war on the player before its military may attack. */
  reactionTurns: 1,
  /** Chance a bot that could attack this turn actually does, before difficulty scaling. Keeps the world from collapsing in two years. */
  attackChance: 0.15,
  /** Turns a bot's military rests between attacks, so one nation cannot roll up a continent. */
  attackRestTurns: 1,
}

/** Shared per-turn facts every bot reads, computed once instead of once per bot. */
export interface TurnContext {
  power: Map<NationId, number>
  neighbors: Map<NationId, Set<NationId>>
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
    power.set(n.id, militaryPower(s, n.id))
  }
  const player = s.playerId
  const enemies = partnerIndex(s.wars)
  return {
    power,
    neighbors,
    regions,
    enemies,
    allies: partnerIndex(s.alliances),
    prices: marketPrices(s),
    coalition: coalitionActive(s, map),
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
  const owner = s.regions[regionId].owner
  return ((ctx.power.get(owner) ?? 0) + garrisonStrength(s, map, regionId) * UNIT_SPECS.infantry.defense) * TERRAIN[map.regions[regionId].terrain].defense
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
    if (v === undefined) perceivedCache.set(id, (v = perceivedPower(s, map, nationId, id)))
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

  if (!n.military.commanderId && n.generals.length > 0) tryAdd({ type: 'assignGeneral', nationId, generalId: n.generals[0].id })

  const reserve = 15
  let budget = Math.max(0, n.resources.capital - reserve)

  if ((n.foodShortage || econ.netFood < 0.4) && budget >= 25 && owned.length) {
    const place = owned.reduce((best, id) => (s.regions[id].buildings.farm < s.regions[best].buildings.farm ? id : best), owned[0])
    if (tryAdd({ type: 'build', nationId, regionId: place, building: 'farm' })) budget -= 25
  }

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
      const units = n.military.units
      let used = false
      // Drill what is least trained, unless a commander does it for free.
      const drill = UNIT_TYPES.filter((u) => units[u] >= 0.05 && n.military.drill[u] < TRAINING.max).sort((a, b) => n.military.drill[a] - n.military.drill[b])
      let drilled = 0
      for (const u of drill) {
        if (drilled >= 2) break
        if (tryAdd({ type: 'train', nationId, unit: u })) {
          drilled++
          used = true
        }
      }
      // Better weapons for the unit type it fields the most of.
      if (rng.chance(0.4)) {
        const mostly = [...UNIT_TYPES].filter((u) => units[u] >= 0.5).sort((a, b) => units[b] - units[a])
        for (const u of mostly) {
          if (nextWeaponLevel(s, nationId, u).error || budget < nextWeaponLevel(s, nationId, u).cost + 20) continue
          if (tryAdd({ type: 'upgradeWeapons', nationId, unit: u })) {
            budget -= weaponCost(n.military.weapons[u])
            used = true
            break
          }
        }
      }
      if (!wantsArmy || upkeepRoom <= 0) return used
      // Raise units, up to the queue limit, scaled by income and the difficulty.
      let room = upkeepRoom
      const maxRecruits = clamp(Math.round((income / 30) * diff.production), BOT.minRecruitsPerTurn, BOT.maxRecruitsPerTurn)
      let recruited = 0
      for (let i = 0; i < maxRecruits && budget > 10; i++) {
        const roll = rng.next()
        let unit: UnitType = 'infantry'
        if (roll < 0.3 && canUseUnit(n, 'armor')) unit = 'armor'
        else if (roll < 0.45 && canUseUnit(n, 'air')) unit = 'air'
        else if (roll < 0.5 && canUseUnit(n, 'naval')) unit = 'naval'
        const spec = UNIT_SPECS[unit]
        if (spec.upkeep > room || spec.capitalCost > budget) break
        if (n.foodShortage || n.resources.food <= 0) break
        if (econ.netFood < spec.food && n.resources.food < econ.foodConsumption * 2) break
        if (!tryAdd({ type: 'queueTrain', nationId, unit })) {
          if (unit === 'infantry') break
          continue
        }
        budget -= spec.capitalCost
        room -= spec.upkeep
        recruited++
      }
      if (recruited === 0 && budget > 40) {
        // No way to train: raise barracks in the biggest country.
        const place = owned.reduce((best, id) => (s.regions[id].population > s.regions[best].population ? id : best), owned[0])
        if (place && tryAdd({ type: 'build', nationId, regionId: place, building: 'barracks' })) {
          budget -= 30
          return true
        }
      }
      return used || recruited > 0
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
      return false
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
        const muchWeaker = perceived(id) < myPower * 0.55
        const bully = muchWeaker && n.personality !== 'honorable' && n.personality !== 'turtle'
        if (op > (bully ? 40 : 20)) continue
        if (n.personality === 'honorable' && op > 0) continue
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
      const odds = best.ratio >= diff.warDeclarePowerRatio * 1.2 ? 0.45 : 0.24
      if (!rng.chance(n.aggression * persona.aggression * diff.aggression * odds)) return false
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
  // A war declared on the player gives them a couple of months to raise a military before the first blow.
  const warTargets = new Set(enemies.filter((e) => e !== playerId || s.turn - (s.warStarted[pairKey(nationId, e)] ?? -99) > BOT.reactionTurns))
  for (const o of orders) if (o.type === 'declareWar' && o.target !== playerId) warTargets.add(o.target)
  // One attack a turn. A bot starts a campaign only now and then, but keeps pressing a front it has already cracked.
  if (mistake !== 'idle' && s.turn - n.military.lastAttackTurn >= BOT.attackRestTurns && n.military.exposed < 0.05) {
    const options = Object.values(s.regions)
      .filter((r) => warTargets.has(r.owner) && canAttackRegion(s, map, nationId, r.id).ok)
      .map((r) => {
        const max = lineMax(s, map, r.id)
        // A cracked line is cheaper to finish, so it counts as weaker.
        return { id: r.id, def: estimateDefense(s, map, ctx, r.id) * (0.6 + 0.4 * Math.min(1, r.line / max)), started: r.line < max - 0.01 }
      })
      .sort((x, y) => x.def - y.def || (x.id < y.id ? -1 : 1))
    const target = options[0]
    if (target && rng.chance(target.started ? 0.85 : BOT.attackChance * diff.aggression)) {
      // Send the smallest force that clears the bar, and keep some home when a strong neighbor is also at war with us.
      const needed = (target.def * attackRatio) / Math.max(0.1, myPower)
      const threatened = enemies.some((e) => e !== s.regions[target.id].owner && (ctx.power.get(e) ?? 0) > myPower * 0.6)
      const commit = needed <= COMMITS.probe.share ? 'probe' : needed <= COMMITS.main.share ? 'main' : !threatened || needed > 1 ? 'allin' : 'main'
      if (needed <= 1) {
        const armored = n.military.units.armor + n.military.units.air
        const total = totalUnits(n.military.units)
        const bigLine = lineMax(s, map, target.id) > 6
        const stance: Stance = total > 0 && armored / total > 0.45 && econ.netCapital > -10 ? 'blitz' : bigLine ? 'siege' : 'assault'
        tryAdd({ type: 'attack', nationId, target: target.id, commit, stance }) || tryAdd({ type: 'attack', nationId, target: target.id, commit, stance: 'assault' })
      }
    }
  }
  // Rebels in a country are fought every month with no order needed.

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
