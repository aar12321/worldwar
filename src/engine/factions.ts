import { botAcceptsInvite } from '../ai/factions'
import { addOpinion } from '../ai/opinion'
import { DEFAULT_CHARTER, FACTION, FACTION_WORDS, POOL_NAMES } from '../data/factions'
import { COSTS, UNIT_SPECS } from '../data/unitTypes'
import { JUSTIFY, REACH } from '../data/war'
import { declareWar } from './diplomacy'
import { addLog, atWar, distanceKm, emptyUnits, enemiesOf, hasCasusBelli, hasPact, isAllied, maxWars, newId, regionsOf, totalUnits } from './helpers'
import { militaryPower } from './militaryStats'
import type { Rng } from './rng'
import { marketPrices } from './trade'
import type {
  Faction,
  FactionCharter,
  FactionContract,
  FactionContractTerms,
  FactionGift,
  FactionLedger,
  FactionProposal,
  FactionProposalDraft,
  FactionWar,
  GameState,
  NationId,
  Order,
  PoolResource,
  PoolStock,
  RegionId,
  UnitCounts,
  UnitType,
  Via,
  WorldMap,
  Army,
} from './types'
import { POOL_RESOURCES, UNIT_TYPES } from './types'
import { launchFactionArmy, settleFactionArmy } from './armies'
import { isLive } from './calendar'
import { canAttackRegion, carryNeeded, resolveAttack, transferRegion } from './warfare'

type FactionOrder = Extract<Order, { type: 'factionFound' | 'factionJoin' | 'factionInvite' | 'factionLeave' | 'factionContribute' | 'factionWithdraw' | 'factionPropose' | 'factionVote' }>

export const FACTION_ORDERS = new Set<Order['type']>(['factionFound', 'factionJoin', 'factionInvite', 'factionLeave', 'factionContribute', 'factionWithdraw', 'factionPropose', 'factionVote'])
export const isFactionOrder = (o: Order): o is FactionOrder => FACTION_ORDERS.has(o.type)

const nm = (s: GameState, id: NationId) => s.nations[id]?.name ?? id
const EPS = 1e-9
/** The nation's own store that each pool resource comes from. */
const STORE: Record<PoolResource, 'capital' | 'oil' | 'steel' | 'goods' | 'food'> = { money: 'capital', oil: 'oil', steel: 'steel', goods: 'goods', food: 'food' }

export const emptyStock = (): PoolStock => ({ money: 0, oil: 0, steel: 0, goods: 0, food: 0 })
const newLedger = (turn: number): FactionLedger => ({ stock: emptyStock(), units: emptyUnits(), last: turn, joined: turn })

// ---- looking factions up ----

export const factionOf = (s: Pick<GameState, 'factions'>, id: NationId): Faction | null => s.factions?.find((f) => f.members.includes(id)) ?? null
export const sameFaction = (s: Pick<GameState, 'factions'>, a: NationId, b: NationId) => !!s.factions?.length && a !== b && !!s.factions.find((f) => f.members.includes(a) && f.members.includes(b))
export const factionById = (s: Pick<GameState, 'factions'>, id: string): Faction | null => s.factions?.find((f) => f.id === id) ?? null

// ---- the pool, the ledger and the shares ----

/** What a member's claim on one resource is worth in kind: the pool may hold less than all the claims, and then every claim shrinks alike. */
export function stockRatio(f: Faction, r: PoolResource): number {
  let total = 0
  for (const m of f.members) total += f.ledger[m]?.stock[r] ?? 0
  return total <= EPS ? 1 : Math.min(1, Math.max(0, f.pool.stock[r]) / total)
}

export function unitRatio(f: Faction, k: UnitType): number {
  let total = 0
  for (const m of f.members) total += f.ledger[m]?.units[k] ?? 0
  return total <= EPS ? 1 : Math.min(1, Math.max(0, f.pool.units[k]) / total)
}

/** What a member's claim is worth, at the fixed values, after what the pool has lost. */
export function claimValue(f: Faction, id: NationId): number {
  const l = f.ledger[id]
  if (!l) return 0
  let v = 0
  for (const r of POOL_RESOURCES) v += l.stock[r] * stockRatio(f, r) * FACTION.price[r]
  for (const k of UNIT_TYPES) v += l.units[k] * unitRatio(f, k) * UNIT_SPECS[k].capitalCost
  return v
}

/** Each member's ownership share, from 0 to 1. With nothing in the pool the members own it equally. */
export function sharesOf(f: Faction): Record<NationId, number> {
  const out: Record<NationId, number> = {}
  const values = f.members.map((m) => [m, claimValue(f, m)] as const)
  const total = values.reduce((a, [, v]) => a + v, 0)
  for (const [m, v] of values) out[m] = total > EPS ? v / total : 1 / Math.max(1, f.members.length)
  return out
}

/** Votes: a member's share under a weighted charter, one each otherwise. */
export function voteWeights(f: Faction): Record<NationId, number> {
  if (f.charter.vote === 'weighted') return sharesOf(f)
  const out: Record<NationId, number> = {}
  for (const m of f.members) out[m] = 1
  return out
}

/** What the whole pool is worth at the fixed values. */
export function poolValue(f: Faction): number {
  let v = 0
  for (const r of POOL_RESOURCES) v += f.pool.stock[r] * FACTION.price[r]
  for (const k of UNIT_TYPES) v += f.pool.units[k] * UNIT_SPECS[k].capitalCost
  return v
}

/** Units in the pool in divisions. */
export const poolUnits = (f: Faction) => totalUnits(f.pool.units)

/** Strength of the pooled army alone, as if it were a nation's military with this member's drill and weapons. */
export function poolPower(s: GameState, f: Faction): number {
  let p = 0
  const lead = bestLead(s, f.members) ?? f.members[0]
  const n = s.nations[lead]
  if (!n) return 0
  for (const k of UNIT_TYPES) p += f.pool.units[k] * (UNIT_SPECS[k].attack + UNIT_SPECS[k].defense) * 0.5 * (1 + 0.08 * (n.military.drill[k] ?? 0))
  return p
}

/** The most a member can take out of the pool now of a resource, in kind. */
export function withdrawable(f: Faction, id: NationId, r: PoolResource): number {
  const l = f.ledger[id]
  return l ? Math.max(0, Math.min(f.pool.stock[r], l.stock[r] * stockRatio(f, r))) : 0
}

export function withdrawableUnits(f: Faction, id: NationId, k: UnitType): number {
  const l = f.ledger[id]
  return l ? Math.max(0, Math.min(f.pool.units[k], l.units[k] * unitRatio(f, k))) : 0
}

/** Months left before a member can take anything out. */
export function lockLeft(s: GameState, f: Faction, id: NationId): number {
  const l = f.ledger[id]
  return l ? Math.max(0, FACTION.lockMonths - (s.turn - l.last)) : 0
}

const giftStock = (g: FactionGift) => POOL_RESOURCES.filter((r) => (g.stock?.[r] ?? 0) > 0).map((r) => [r, g.stock![r] as number] as const)
const giftUnits = (g: FactionGift) => UNIT_TYPES.filter((k) => (g.units?.[k] ?? 0) > 0).map((k) => [k, g.units![k] as number] as const)
/** A gift as a short line of words. */
export function describeGift(g: FactionGift): string {
  const parts = [...giftStock(g).map(([r, v]) => `${Math.round(v * 10) / 10} ${POOL_NAMES[r].toLowerCase()}`), ...giftUnits(g).map(([k, v]) => `${Math.round(v * 10) / 10} ${UNIT_SPECS[k].name.toLowerCase()}`)]
  return parts.length ? parts.join(', ') : 'nothing'
}

function badGift(g: FactionGift | undefined): string | null {
  if (!g || typeof g !== 'object') return 'Choose what to put in'
  let any = false
  for (const [, v] of Object.entries(g.stock ?? {})) {
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e7) return 'Invalid amount'
    if (v > 0) any = true
  }
  for (const [, v] of Object.entries(g.units ?? {})) {
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e6) return 'Invalid amount'
    if (v > 0) any = true
  }
  for (const k of Object.keys(g.stock ?? {})) if (!POOL_RESOURCES.includes(k as PoolResource)) return 'The pool cannot hold that'
  for (const k of Object.keys(g.units ?? {})) if (!UNIT_TYPES.includes(k as UnitType)) return 'Unknown soldiers'
  return any ? null : 'Choose an amount'
}

/** What an order costs from the nation's own treasury: gifts of money and steel go through the usual checks. */
export function factionOrderCost(s: GameState, o: Order): { capital: number; pp: number; steel: number } {
  const c = { capital: 0, pp: 0, steel: 0 }
  switch (o.type) {
    case 'factionFound':
      c.pp = FACTION.foundInfluence
      break
    case 'factionContribute':
      if (!badGift(o.gift)) {
        c.capital = o.gift.stock?.money ?? 0
        c.steel = o.gift.stock?.steel ?? 0
      }
      break
    case 'factionPropose':
      c.pp = o.proposal?.kind === 'war' ? warInfluence(s, o.nationId, o.proposal.target) : FACTION.contractInfluence
      break
    default:
      break
  }
  return c
}

/** The influence a war on `target` costs `by`, the same as declaring it alone. */
export const warInfluence = (s: GameState, by: NationId, target: NationId) => (hasCasusBelli(s, by, target) ? COSTS.declareWarWithCasusBelli : JUSTIFY.noReasonCost)

// ---- wars: who can go to war, and reaching the target ----

/** Why `m` cannot go to war with `target` right now, or null. */
function cannotFight(s: GameState, m: NationId, target: NationId): string | null {
  const n = s.nations[m]
  const t = s.nations[target]
  if (!n?.alive || !t?.alive || m === target) return 'Not a nation'
  if (n.overlord) return 'a puppet'
  if (t.overlord === m) return 'their overlord'
  if (isAllied(s, m, target)) return 'allied with them'
  if (hasPact(s, m, target)) return 'under a pact with them'
  return null
}

/** Members who could take up arms against `target`: the ones allowed, not already at war with it, with a free front. */
function ableToJoin(s: GameState, f: Faction, target: NationId): NationId[] {
  return f.members.filter((m) => !cannotFight(s, m, target) && !atWar(s, m, target) && enemiesOf(s, m).length < maxWars(s, m))
}

export interface Reach {
  ok: boolean
  bySea: boolean
  via?: Via
  from?: RegionId
}

/** How the pooled army would get to a country: across a border or sea lane of any member, or by the pool's own ships and planes from any member's port or airbase. */
export function factionReach(s: GameState, map: WorldMap, f: Faction, target: RegionId): Reach {
  const t = map.regions[target]
  if (!t) return { ok: false, bySea: false }
  const mine = (id: RegionId) => !!s.regions[id] && f.members.includes(s.regions[id].owner)
  for (const id of [...t.neighbors].sort()) if (mine(id)) return { ok: true, bySea: false, via: 'land', from: id }
  for (const id of [...t.seaLanes].sort()) if (mine(id) && s.regions[id].buildings.port > 0) return { ok: true, bySea: true, via: 'lane', from: id }
  const u = f.pool.units
  const lift = carryNeeded(u)
  const fleet = t.coastal && u.naval >= Math.max(REACH.navalUnits, lift)
  const air = u.fighter + u.air >= Math.max(REACH.airUnits, lift)
  if (!fleet && !air) return { ok: false, bySea: false }
  let by: Reach | null = null
  for (const r of Object.values(s.regions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!f.members.includes(r.owner) || !map.regions[r.id]) continue
    const km = distanceKm(map.regions[r.id], t)
    if (fleet && r.buildings.port > 0 && km <= REACH.seaKm) return { ok: true, bySea: true, via: 'fleet', from: r.id }
    if (air && !by && r.buildings.factory > 0 && km <= REACH.airKm) by = { ok: true, bySea: true, via: 'air', from: r.id }
  }
  return by ?? { ok: false, bySea: false }
}

/** The target's countries the pooled army can reach, the weakest line first. */
export function reachableTargets(s: GameState, map: WorldMap, f: Faction, target: NationId): { region: RegionId; reach: Reach }[] {
  const out: { region: RegionId; reach: Reach }[] = []
  for (const id of regionsOf(s, target)) {
    const reach = factionReach(s, map, f, id)
    if (reach.ok) out.push({ region: id, reach })
  }
  return out.sort((a, b) => s.regions[a.region].line - s.regions[b.region].line || (a.region < b.region ? -1 : 1))
}

/** Whether any member's own forces could reach the target, for a war the pool cannot yet reach by itself. */
function membersCanReach(s: GameState, map: WorldMap, f: Faction, target: NationId): boolean {
  for (const id of regionsOf(s, target)) for (const m of f.members) if (canAttackRegion(s, map, m, id).ok) return true
  return false
}

/** Why a faction cannot go to war with this country, or null. */
export function warTargetProblem(s: GameState, map: WorldMap, f: Faction, by: NationId, target: NationId, pending: Order[] = []): string | null {
  const t = s.nations[target]
  if (!t?.alive) return 'Choose a country'
  if (f.members.includes(target)) return 'They are in the faction'
  if (f.wars.some((w) => w.target === target)) return 'The faction is already fighting them'
  if (f.proposals.some((p) => p.kind === 'war' && p.target === target) || pending.some((p) => p.type === 'factionPropose' && p.nationId !== by && p.proposal.kind === 'war' && p.proposal.target === target && factionOf(s, p.nationId)?.id === f.id)) return 'The faction is already voting on them'
  if (f.members.some((m) => t.overlord === m)) return 'They are a puppet of a member'
  if (f.members.every((m) => atWar(s, m, target))) return 'Every member is already at war with them'
  const can = ableToJoin(s, f, target)
  const already = f.members.filter((m) => atWar(s, m, target))
  if (can.length === 0 && already.length === 0) {
    const why = f.members.map((m) => cannotFight(s, m, target)).find((x) => x)
    return why ? `No member can attack them (${nm(s, f.members[0])} is ${why})` : 'Every member is stretched across too many wars'
  }
  if (already.length === 0 && enemiesOf(s, target).length >= maxWars(s, target)) return `${t.name} is already fighting ${maxWars(s, target)} wars`
  if (reachableTargets(s, map, f, target).length === 0 && !membersCanReach(s, map, f, target)) return 'Out of reach: the pool has no ships or planes for it, and no member borders them'
  return null
}

// ---- founding, joining and leaving ----

function sanitizeName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : ''
}

const CHARTER_OPTIONS = { vote: ['majority', 'weighted'], spoils: ['share', 'proposer'], exit: ['refund', 'forfeit'] } as const

function charterProblem(c: Partial<FactionCharter> | undefined): string | null {
  if (!c) return null
  for (const k of Object.keys(CHARTER_OPTIONS) as (keyof FactionCharter)[]) {
    const v = c[k]
    if (v !== undefined && !(CHARTER_OPTIONS[k] as readonly string[]).includes(v)) return 'Unknown charter rule'
  }
  return null
}

/** Whether `a` and `b` are in the way of each other: members cannot fight each other, and a faction does not take in an enemy of a member. */
function atWarWithAny(s: GameState, id: NationId, f: Faction) {
  return f.members.some((m) => atWar(s, id, m))
}

function newFactionName(s: GameState, founder: NationId): string {
  const base = nm(s, founder)
  const word = FACTION_WORDS[(s.nextId + base.length) % FACTION_WORDS.length]
  return `${base} ${word}`.slice(0, FACTION.nameMax)
}

export function factionName(s: GameState, founder: NationId): string {
  return newFactionName(s, founder)
}

/** The rule checks for every faction order. `pending` are this player's orders already queued this month. */
export function factionProblem(s: GameState, map: WorldMap, o: FactionOrder, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const mine = factionOf(s, o.nationId)
  switch (o.type) {
    case 'factionFound': {
      if (mine) return `You are already in ${mine.name}`
      if (n.overlord) return 'A puppet cannot found a faction'
      const name = sanitizeName(o.name)
      if (name.length < FACTION.nameMin || name.length > FACTION.nameMax) return `Name it with ${FACTION.nameMin} to ${FACTION.nameMax} letters`
      if (pending.some((p) => p.type === 'factionFound')) return 'Already queued'
      return charterProblem(o.charter)
    }
    case 'factionJoin': {
      if (mine) return `You are already in ${mine.name}`
      const f = factionById(s, o.factionId)
      if (!f) return 'No such faction'
      if (n.overlord) return 'A puppet cannot join a faction'
      if (!f.invites.some((i) => i.nation === o.nationId && i.expires >= s.turn)) return 'You have not been invited'
      if (f.members.length >= FACTION.maxMembers) return 'The faction is full'
      if (atWarWithAny(s, o.nationId, f)) return 'You are at war with a member'
      if (pending.some((p) => p.type === 'factionJoin')) return 'Already queued'
      return null
    }
    case 'factionInvite': {
      if (!mine) return 'You are not in a faction'
      const t = s.nations[o.target]
      if (!t?.alive || o.target === o.nationId) return 'Choose another nation'
      if (factionOf(s, o.target)) return `${t.name} is already in a faction`
      if (t.overlord) return `${t.name} is a puppet`
      if (mine.members.length >= FACTION.maxMembers) return 'The faction is full'
      if (atWarWithAny(s, o.target, mine)) return `${t.name} is at war with a member`
      if (mine.invites.some((i) => i.nation === o.target && i.expires >= s.turn) || pending.some((p) => p.type === 'factionInvite' && p.target === o.target)) return 'Already invited'
      return null
    }
    case 'factionLeave': {
      if (!mine) return 'You are not in a faction'
      if (pending.some((p) => p.type === 'factionLeave')) return 'Already queued'
      return null
    }
    case 'factionContribute': {
      if (!mine) return 'You are not in a faction'
      const bad = badGift(o.gift)
      if (bad) return bad
      const queued = pending.filter((p): p is Extract<Order, { type: 'factionContribute' }> => p.type === 'factionContribute' && p.nationId === o.nationId)
      // Money and steel are checked with the rest of the treasury; the other stores are checked here, counting what is queued.
      for (const [r, v] of giftStock(o.gift)) {
        if (r === 'money' || r === 'steel') continue
        const left = n.resources[STORE[r] as 'oil'] - queued.reduce((a, q) => a + (q.gift.stock?.[r] ?? 0), 0)
        if (v > left + EPS) return `You do not have that much ${POOL_NAMES[r].toLowerCase()}`
      }
      // Soldiers in the pool do not defend their own country: a member fighting a war the faction is not in keeps them home.
      if (giftUnits(o.gift).length && enemiesOf(s, o.nationId).some((e) => !mine.wars.some((w) => w.target === e))) return 'You are at war on your own: keep your soldiers at home to defend your land'
      for (const [k, v] of giftUnits(o.gift)) {
        const left = n.military.units[k] - queued.reduce((a, q) => a + (q.gift.units?.[k] ?? 0), 0)
        if (v > left + EPS) return `You do not have that many ${UNIT_SPECS[k].name.toLowerCase()} at home`
      }
      return null
    }
    case 'factionWithdraw': {
      if (!mine) return 'You are not in a faction'
      const bad = badGift(o.gift)
      if (bad) return bad
      const wait = lockLeft(s, mine, o.nationId)
      if (wait > 0) return `What you put in is locked for ${wait} more month${wait === 1 ? '' : 's'}`
      const queued = pending.filter((p): p is Extract<Order, { type: 'factionWithdraw' }> => p.type === 'factionWithdraw' && p.nationId === o.nationId)
      for (const [r, v] of giftStock(o.gift)) {
        const left = withdrawable(mine, o.nationId, r) - queued.reduce((a, q) => a + (q.gift.stock?.[r] ?? 0), 0)
        if (v > left + EPS) return left < 0.005 ? `You have no ${POOL_NAMES[r].toLowerCase()} in the pool to take back` : `You can take back ${Math.floor(left * 100) / 100} ${POOL_NAMES[r].toLowerCase()}`
      }
      const units = giftUnits(o.gift)
      if (units.length && mine.wars.length) return 'The army is at war: soldiers stay until it is over'
      for (const [k, v] of units) {
        const left = withdrawableUnits(mine, o.nationId, k) - queued.reduce((a, q) => a + (q.gift.units?.[k] ?? 0), 0)
        if (v > left + EPS) return left < 0.005 ? `You have no ${UNIT_SPECS[k].name.toLowerCase()} in the pool` : `You can take back ${Math.floor(left * 100) / 100} ${UNIT_SPECS[k].name.toLowerCase()}`
      }
      return null
    }
    case 'factionPropose': {
      if (!mine) return 'You are not in a faction'
      const p = o.proposal
      if (!p || (p.kind !== 'war' && p.kind !== 'contract')) return 'Unknown proposal'
      if (mine.proposals.length + pending.filter((q) => q.type === 'factionPropose' && factionOf(s, q.nationId)?.id === mine.id).length >= FACTION.maxOpen) return `The faction can vote on ${FACTION.maxOpen} things at a time`
      if (p.kind === 'war') {
        if (pending.some((q) => q.type === 'factionPropose' && q.proposal.kind === 'war' && q.proposal.target === p.target)) return 'Already queued'
        return warTargetProblem(s, map, mine, o.nationId, p.target, pending)
      }
      return contractProblem(mine, o.nationId, p.terms)
    }
    case 'factionVote': {
      if (!mine) return 'You are not in a faction'
      const p = mine.proposals.find((x) => x.id === o.proposalId)
      if (!p) return 'No such proposal'
      if (o.vote !== 'yes' && o.vote !== 'no') return 'Vote yes or no'
      if (p.expires < s.turn) return 'Voting has closed'
      return null
    }
  }
}

function contractProblem(f: Faction, by: NationId, t: FactionContractTerms | undefined): string | null {
  if (!t || typeof t !== 'object') return 'Describe the contract'
  if (t.member !== by) return 'You can only put forward a contract for yourself'
  if (!Number.isInteger(t.months) || t.months < 1 || t.months > FACTION.maxContractMonths) return `A contract runs 1 to ${FACTION.maxContractMonths} months`
  if (!Number.isInteger(t.start) || t.start < 0 || t.start > FACTION.maxStartMonths) return `It can start up to ${FACTION.maxStartMonths} months from now`
  if (!Number.isFinite(t.collateral) || t.collateral < 0 || t.collateral > FACTION.maxCollateral) return `Collateral goes up to ${FACTION.maxCollateral} money`
  let any = false
  for (const b of [t.supply, t.pay]) {
    for (const [k, v] of Object.entries(b ?? {})) {
      if (v === undefined) continue
      if (!POOL_RESOURCES.includes(k as PoolResource)) return 'The pool cannot hold that'
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > FACTION.maxContractAmount) return 'Invalid amount'
      if (v > 0) any = true
    }
  }
  if (!any) return 'The contract is empty'
  if (!f.members.includes(by)) return 'Not a member'
  return null
}

/** Records a line in the faction's own news and in the world's. */
function say(s: GameState, f: Faction, text: string, kind: 'diplomacy' | 'war' = 'diplomacy', extra: NationId[] = []) {
  f.history.push({ turn: s.turn, text })
  if (f.history.length > FACTION.history) f.history.splice(0, f.history.length - FACTION.history)
  addLog(s, kind, text, [...new Set([...f.members, ...extra])])
}

function pickName(raw: unknown) {
  return sanitizeName(raw).slice(0, FACTION.nameMax)
}

// ---- carrying out the orders ----

/** Carries out a validated faction order. The caller has already taken any money, steel and influence it costs. */
export function executeFactionOrder(s: GameState, map: WorldMap, o: FactionOrder, rng: Rng) {
  const n = s.nations[o.nationId]
  switch (o.type) {
    case 'factionFound': {
      const f: Faction = {
        id: newId(s, 'F'),
        name: pickName(o.name),
        founder: o.nationId,
        founded: s.turn,
        charter: { ...DEFAULT_CHARTER, ...(o.charter ?? {}) },
        members: [o.nationId],
        pool: { stock: emptyStock(), units: emptyUnits() },
        ledger: { [o.nationId]: newLedger(s.turn) },
        proposals: [],
        contracts: [],
        invites: [],
        wars: [],
        history: [],
      }
      ;(s.factions ??= []).push(f)
      say(s, f, `${n.name} founded ${f.name}.`)
      break
    }
    case 'factionJoin': {
      const f = factionById(s, o.factionId)!
      join(s, f, o.nationId)
      break
    }
    case 'factionInvite': {
      const f = factionOf(s, o.nationId)!
      const t = s.nations[o.target]
      // A rival answers at once; a player finds the invitation waiting and answers with a join order.
      if (!s.humans.includes(o.target) && !t.isPlayer) {
        if (botAcceptsInvite(s, map, o.target, f, rng)) {
          join(s, f, o.target)
        } else {
          addOpinion(s, o.nationId, o.target, 'Turned down our faction', -2, 0.5)
          f.history.push({ turn: s.turn, text: `${t.name} turned down the invitation to ${f.name}.` })
        }
        break
      }
      f.invites.push({ nation: o.target, by: o.nationId, expires: s.turn + FACTION.inviteMonths })
      say(s, f, `${n.name} invited ${t.name} to ${f.name}.`, 'diplomacy', [o.target])
      break
    }
    case 'factionLeave':
      leave(s, factionOf(s, o.nationId)!, o.nationId, 'left')
      break
    case 'factionContribute': {
      const f = factionOf(s, o.nationId)!
      const l = f.ledger[o.nationId] ?? (f.ledger[o.nationId] = newLedger(s.turn))
      for (const [r, v] of giftStock(o.gift)) {
        // Money and steel were taken as the order's cost; the rest leaves the store now.
        if (r !== 'money' && r !== 'steel') n.resources[STORE[r] as 'oil'] -= v
        f.pool.stock[r] += v
        l.stock[r] += v
      }
      for (const [k, v] of giftUnits(o.gift)) {
        n.military.units[k] -= v
        f.pool.units[k] += v
        l.units[k] += v
      }
      l.last = s.turn
      f.history.push({ turn: s.turn, text: `${n.name} put ${describeGift(o.gift)} into the pool.` })
      break
    }
    case 'factionWithdraw': {
      const f = factionOf(s, o.nationId)!
      const l = f.ledger[o.nationId]
      if (!l) break
      for (const [r, v] of giftStock(o.gift)) {
        const ratio = stockRatio(f, r)
        const take = Math.min(v, f.pool.stock[r])
        f.pool.stock[r] -= take
        l.stock[r] = Math.max(0, l.stock[r] - (ratio > EPS ? take / ratio : l.stock[r]))
        n.resources[STORE[r]] += take
      }
      for (const [k, v] of giftUnits(o.gift)) {
        const ratio = unitRatio(f, k)
        const take = Math.min(v, f.pool.units[k])
        f.pool.units[k] -= take
        l.units[k] = Math.max(0, l.units[k] - (ratio > EPS ? take / ratio : l.units[k]))
        n.military.units[k] += take
      }
      f.history.push({ turn: s.turn, text: `${n.name} took ${describeGift(o.gift)} back out of the pool.` })
      break
    }
    case 'factionPropose': {
      const f = factionOf(s, o.nationId)!
      const d: FactionProposalDraft = o.proposal
      const p: FactionProposal = {
        id: newId(s, 'fp'),
        kind: d.kind,
        by: o.nationId,
        created: s.turn,
        expires: s.turn + FACTION.voteMonths,
        votes: { [o.nationId]: 'yes' },
        ...(f.charter.vote === 'weighted' ? { weights: sharesOf(f) } : {}),
        ...(d.kind === 'war' ? { target: d.target } : { terms: d.terms }),
      }
      f.proposals.push(p)
      say(s, f, d.kind === 'war' ? `${n.name} put a war on ${nm(s, d.target)} to the vote in ${f.name}.` : `${n.name} put a supply contract to the vote in ${f.name}.`, 'diplomacy')
      break
    }
    case 'factionVote': {
      const f = factionOf(s, o.nationId)!
      const p = f.proposals.find((x) => x.id === o.proposalId)
      if (p) p.votes[o.nationId] = o.vote
      break
    }
  }
}

function join(s: GameState, f: Faction, id: NationId) {
  f.members.push(id)
  f.ledger[id] = newLedger(s.turn)
  f.invites = f.invites.filter((i) => i.nation !== id)
  say(s, f, `${nm(s, id)} joined ${f.name}.`)
}

/** A member goes. Under a refunding charter it takes back what is left of its claim, less a fee; soldiers do not leave in the middle of a war. */
export function leave(s: GameState, f: Faction, id: NationId, how: 'left' | 'fell') {
  const n = s.nations[id]
  const l = f.ledger[id]
  const last = f.members.length === 1
  const refund = how === 'left' && !!n?.alive && (f.charter.exit === 'refund' || last)
  const got: FactionGift = { stock: {}, units: {} }
  if (l && refund) {
    for (const r of POOL_RESOURCES) {
      const take = last ? f.pool.stock[r] : Math.min(f.pool.stock[r], l.stock[r] * stockRatio(f, r) * (1 - FACTION.exitFee))
      if (take > EPS) {
        f.pool.stock[r] -= take
        n.resources[STORE[r]] += take
        got.stock![r] = take
      }
    }
    // Soldiers go home with a leaver unless the army is at war, when they stay: leaving does not take the army out of the fight.
    if (!f.wars.length || last) {
      for (const k of UNIT_TYPES) {
        const take = last ? f.pool.units[k] : Math.min(f.pool.units[k], l.units[k] * unitRatio(f, k))
        if (take > EPS) {
          f.pool.units[k] -= take
          n.military.units[k] += take
          got.units![k] = take
        }
      }
    }
  }
  // Contracts the member had with the pool end, and its guarantee stays behind.
  for (const c of f.contracts.filter((x) => x.member === id)) {
    f.pool.stock.money += c.held
    f.history.push({ turn: s.turn, text: `${nm(s, id)}'s contract with the pool ended with its leaving. The collateral stays in the pool.` })
  }
  f.contracts = f.contracts.filter((c) => c.member !== id)
  // What stays: the leaver's claim is gone, and what it left behind belongs to the others.
  delete f.ledger[id]
  f.members = f.members.filter((m) => m !== id)
  f.invites = f.invites.filter((i) => i.by !== id && i.nation !== id)
  f.proposals = f.proposals.filter((p) => p.by !== id)
  for (const p of f.proposals) delete p.votes[id]
  for (const w of f.wars) if (w.lead === id) w.lead = bestLead(s, f.members.filter((m) => atWar(s, m, w.target))) ?? f.members[0]
  const took = giftStock(got).length > 0 || giftUnits(got).length > 0
  const text = how === 'fell' ? `${nm(s, id)} fell and is no longer in ${f.name}.` : `${nm(s, id)} left ${f.name}${took ? `, taking back ${describeGift(got)}` : ''}.`
  if (f.members.length === 0) {
    s.factions = (s.factions ?? []).filter((x) => x.id !== f.id)
    if (!s.factions.length) delete s.factions
    addLog(s, 'diplomacy', `${f.name} was dissolved.`, [id])
    return
  }
  if (f.founder === id) {
    const sh = sharesOf(f)
    f.founder = [...f.members].sort((a, b) => sh[b] - sh[a] || (a < b ? -1 : 1))[0]
  }
  if (how === 'left') {
    for (const m of f.members) if (!s.humans.includes(m)) addOpinion(s, m, id, 'Left our faction', -6, 0.4)
  }
  say(s, f, text, 'diplomacy', [id])
}

// ---- votes ----

export interface Tally {
  yes: number
  no: number
  /** Everyone's weight, voted or not. */
  total: number
  /** The members who have not voted. */
  waiting: NationId[]
  /** What the proposal would do if it were decided now: `open` when it would keep waiting. */
  outcome: 'pass' | 'fail' | 'open'
}

/** The count of a proposal, and what would happen to it at the end of the month. */
export function tallyOf(s: GameState, f: Faction, p: FactionProposal): Tally {
  const w = f.charter.vote === 'weighted' && p.weights ? p.weights : voteWeights(f)
  let yes = 0
  let no = 0
  let total = 0
  const waiting: NationId[] = []
  for (const m of f.members) {
    total += w[m] ?? 0
    const v = p.votes[m]
    if (v === 'yes') yes += w[m] ?? 0
    else if (v === 'no') no += w[m] ?? 0
    else waiting.push(m)
  }
  let outcome: Tally['outcome'] = 'open'
  if (yes * 2 > total + EPS) outcome = 'pass'
  else if (no * 2 >= total - EPS) outcome = 'fail'
  else if (p.expires <= s.turn) outcome = yes > no + EPS && (yes + no) >= total * FACTION.quorum - EPS ? 'pass' : 'fail'
  return { yes, no, total, waiting, outcome }
}

const describeTarget = (s: GameState, p: FactionProposal) => (p.kind === 'war' ? `the war on ${nm(s, p.target!)}` : `${nm(s, p.terms!.member)}'s supply contract`)

/** Decides every proposal whose voting has settled. Proposals put forward this month wait for the next. */
export function resolveFactionVotes(s: GameState, map: WorldMap, rng: Rng) {
  if (!s.factions?.length) return
  pruneFactions(s)
  for (const f of [...s.factions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const p of [...f.proposals]) {
      if (p.created >= s.turn) continue
      const t = tallyOf(s, f, p)
      if (t.outcome === 'open') continue
      f.proposals = f.proposals.filter((x) => x.id !== p.id)
      const round = (v: number) => Math.round(v * 100) / 100
      const score = f.charter.vote === 'weighted' ? `${Math.round((t.yes / Math.max(EPS, t.total)) * 100)}% for, ${Math.round((t.no / Math.max(EPS, t.total)) * 100)}% against` : `${round(t.yes)} for, ${round(t.no)} against`
      if (t.outcome === 'fail') {
        say(s, f, `${f.name} voted down ${describeTarget(s, p)} (${score}).`)
        continue
      }
      say(s, f, `${f.name} passed ${describeTarget(s, p)} (${score}).`)
      const err = p.kind === 'war' ? startFactionWar(s, map, f, p, rng) : startContract(s, f, p)
      if (err) say(s, f, `${describeTarget(s, p)} fell through: ${err}.`)
    }
  }
}

// ---- the joint war ----

function bestLead(s: GameState, ids: NationId[]): NationId | null {
  return [...ids].filter((m) => s.nations[m]?.alive).sort((a, b) => militaryPower(s, b) - militaryPower(s, a) || (a < b ? -1 : 1))[0] ?? null
}

/** The faction goes to war. The member with a reason (the proposer first) declares it; every other member that can joins. */
function startFactionWar(s: GameState, map: WorldMap, f: Faction, p: FactionProposal, rng: Rng): string | null {
  const target = p.target!
  const t = s.nations[target]
  if (!t?.alive) return 'they no longer exist'
  if (f.members.includes(target)) return 'they are a member'
  const can = ableToJoin(s, f, target)
  const already = f.members.filter((m) => atWar(s, m, target))
  if (!can.length && !already.length) return 'no member is able to go to war with them'
  // Whoever has a reason for war declares it, the proposer first. Without one the proposer pays the price of aggression.
  const order = [...(can.includes(p.by) ? [p.by] : []), ...can.filter((m) => m !== p.by)]
  const declarer = order.find((m) => hasCasusBelli(s, m, target)) ?? order[0]
  const joined: NationId[] = [...already]
  if (declarer) {
    declareWar(s, map, declarer, target, rng, true)
    if (atWar(s, declarer, target)) joined.push(declarer)
  }
  for (const m of can) {
    if (m === declarer || atWar(s, m, target)) continue
    declareWar(s, map, m, target, rng, false)
    if (atWar(s, m, target)) joined.push(m)
  }
  const warriors = [...new Set(joined)].filter((m) => atWar(s, m, target))
  if (!warriors.length) return 'the war could not be declared'
  const war: FactionWar = { id: newId(s, 'fw'), target, lead: bestLead(s, warriors)!, proposer: p.by, since: s.turn, given: {}, captured: [] }
  f.wars.push(war)
  const left = f.members.filter((m) => !warriors.includes(m))
  say(s, f, `${f.name} is at war with ${t.name}! ${warriors.map((m) => nm(s, m)).join(', ')} take up arms${left.length ? `; ${left.map((m) => nm(s, m)).join(', ')} cannot` : ''}. ${nm(s, war.lead)} commands the joint army.`, 'war', [target])
  for (const m of f.members) if (!s.humans.includes(m) && !warriors.includes(m)) addOpinion(s, m, p.by, 'Dragged us into a faction war', -2, 0.5)
  return null
}

function startContract(s: GameState, f: Faction, p: FactionProposal): string | null {
  const t = p.terms!
  const n = s.nations[t.member]
  if (!f.members.includes(t.member) || !n?.alive) return 'the member is gone'
  if (n.resources.capital < t.collateral) return `${n.name} cannot put up the collateral`
  n.resources.capital -= t.collateral
  const c: FactionContract = { ...t, id: newId(s, 'fc'), from: s.turn + t.start, until: s.turn + t.start + t.months - 1, held: t.collateral }
  f.contracts.push(c)
  say(s, f, `A contract between ${f.name} and ${n.name} begins${t.start > 0 ? ` in ${t.start} month${t.start === 1 ? '' : 's'}` : ' now'}: ${describeContract(c, n.name)}.`)
  return null
}

/** A contract as a line of words. */
export function describeContract(c: FactionContractTerms, who = 'the member'): string {
  const both = (b: Partial<PoolStock>) => {
    const parts = POOL_RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `${Math.round((b[r] as number) * 10) / 10} ${POOL_NAMES[r].toLowerCase()}`)
    return parts.length ? parts.join(' + ') : ''
  }
  const give = both(c.supply)
  const get = both(c.pay)
  const span = `a month for ${c.months} month${c.months === 1 ? '' : 's'}`
  const body = give && get ? `supplies ${give} for ${get}, ${span}` : give ? `supplies ${give} to the pool ${span}` : `is paid ${get} by the pool ${span}`
  return `${who} ${body}${c.collateral > 0 ? `, with ${Math.round(c.collateral)} money in collateral` : ''}`
}

// ---- the pooled army fights ----

function oilNeed(u: UnitCounts): number {
  return UNIT_TYPES.reduce((a, k) => a + u[k] * UNIT_SPECS[k].oil, 0)
}
function foodNeed(u: UnitCounts): number {
  return UNIT_TYPES.reduce((a, k) => a + u[k] * UNIT_SPECS[k].food, 0)
}
function upkeepNeed(u: UnitCounts): number {
  return UNIT_TYPES.reduce((a, k) => a + u[k] * UNIT_SPECS[k].upkeep, 0)
}

/** Whether a war of the faction is still on, with who is fighting it; a war that is over is dropped (and said so). Returns the members at war, or null. */
function liveWar(s: GameState, f: Faction, war: FactionWar): NationId[] | null {
  const target = s.nations[war.target]
  const fighting = f.members.filter((m) => s.nations[m]?.alive && atWar(s, m, war.target))
  if (!target?.alive || !fighting.length) {
    f.wars = f.wars.filter((w) => w.id !== war.id)
    say(s, f, target?.alive ? `${f.name}'s war on ${target.name} is over.` : `${f.name}'s war ended with the fall of ${nm(s, war.target)}${war.captured.length ? ` (${war.captured.length} countr${war.captured.length === 1 ? 'y' : 'ies'} taken)` : ''}.`, 'war')
    return null
  }
  if (!fighting.includes(war.lead)) war.lead = bestLead(s, fighting)!
  return fighting
}

/**
 * The pooled army's month on campaign: it attacks the weakest reachable country of each enemy, as one army, with the lead member's
 * training, weapons and technology. In a turn game the attacks are fought here, at once. In a live game they are not: the army
 * sets out on the 1st and marches (`launchFactionArmies`), so only the housekeeping of the wars is done here.
 */
export function runFactionCampaigns(s: GameState, map: WorldMap, rng: Rng) {
  if (!s.factions?.length) return
  const live = isLive(s)
  for (const f of [...s.factions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const war of [...f.wars].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!liveWar(s, f, war)) continue
      if (live) continue
      const attacks = f.members.length >= FACTION.secondAttackMembers ? FACTION.attacksPerMonth : 1
      const hit = new Set<RegionId>()
      for (let i = 0; i < attacks; i++) {
        if (poolUnits(f) < 0.1 || !s.nations[war.target]?.alive) break
        const goals = reachableTargets(s, map, f, war.target).filter((g) => !hit.has(g.region))
        if (!goals.length) break
        hit.add(goals[0].region)
        if (!fight(s, map, f, war, goals[0].region, goals[0].reach, rng)) break
      }
    }
  }
}

/**
 * Live games: on the 1st (the day a vote that declared the war passed, and every month after) each faction at war that has its army
 * at home sends it, whole, against the weakest country of the first enemy it can reach. It is a real army: it marches, fights on
 * arrival through the same code the turn game uses, and comes home. One army a faction at a time (a turn game's second attack of the
 * month is not made in a live one). Returns the armies launched.
 */
export function launchFactionArmies(s: GameState, map: WorldMap, today: number): Army[] {
  const out: Army[] = []
  if (!s.factions?.length) return out
  for (const f of [...s.factions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (s.armies?.some((a) => a.faction?.id === f.id) || poolUnits(f) < 0.1) continue
    for (const war of [...f.wars].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!s.nations[war.target]?.alive || !s.nations[war.lead]?.alive) continue
      const goal = reachableTargets(s, map, f, war.target)[0]
      if (!goal) continue
      const army = launchFactionArmy(s, map, f, war, goal.region, goal.reach, today)
      f.history.push({ turn: s.turn, text: `The joint army marches on ${map.regions[goal.region].name}, ${army.end - army.start} day${army.end - army.start === 1 ? '' : 's'} away.` })
      out.push(army)
      break
    }
  }
  return out
}

/** One attack by the pooled army, at once (turn games). Returns whether it was fought. */
function fight(s: GameState, map: WorldMap, f: Faction, war: FactionWar, region: RegionId, reach: Reach, rng: Rng): boolean {
  const from = reach.from ?? region
  const army: Army = {
    id: `${f.id}-${s.turn}`,
    nationId: war.lead,
    units: { ...f.pool.units },
    commit: 'main',
    stance: 'assault',
    share: 1,
    via: reach.via ?? 'land',
    bySea: reach.bySea,
    home: from,
    target: region,
    phase: 'fighting',
    from: { lat: map.regions[from]?.lat ?? 0, lng: map.regions[from]?.lng ?? 0 },
    to: { lat: map.regions[region].lat, lng: map.regions[region].lng },
    start: 0,
    end: 0,
    launched: s.turn,
    faction: { id: f.id, war: war.id, base: { ...f.pool.units } },
  }
  const result = fightFactionArmy(s, map, army, rng, true)
  if (!result) return false
  delete result.report.armyId
  return true
}

/**
 * A joint army fights: the attack itself, then what follows from it (the pool's losses, the report, the spoils shared out, the
 * captured land given to members). `exact`: the army was made this very turn from the whole pool, so the pool simply becomes what is left.
 */
export function fightFactionArmy(s: GameState, map: WorldMap, army: Army, rng: Rng, exact = false) {
  const f = factionById(s, army.faction?.id ?? '')
  const war = f?.wars.find((w) => w.id === army.faction!.war)
  const lead = s.nations[army.nationId]
  if (!f || !war || !lead?.alive) return null
  const region = army.target
  // A pool that could not feed or fuel its army fights as a nation without oil or food does.
  const was = { oil: lead.oilShortage, food: lead.foodShortage }
  if (f.short?.oil) lead.oilShortage = true
  if (f.short?.food) lead.foodShortage = true
  const heldBefore = new Set(regionsOf(s, war.lead))
  const moneyBefore = lead.resources.capital
  const result = resolveAttack(s, map, army.nationId, region, rng, 'main', 'assault', undefined, army)
  lead.oilShortage = was.oil
  lead.foodShortage = was.food
  if (!result) return null
  if (exact) for (const k of UNIT_TYPES) f.pool.units[k] = army.units[k] < 1e-6 ? 0 : army.units[k]
  else {
    settleFactionArmy(s, army)
    for (const k of UNIT_TYPES) if (f.pool.units[k] < 1e-6) f.pool.units[k] = 0
  }
  const report = result.report
  report.modifiers.push(`Joint army of ${f.name}: ${f.members.length} members, ${poolUnits(f).toFixed(1)} divisions left, led by ${lead.name}`)
  f.history.push({ turn: s.turn, text: `The joint army ${report.captured ? 'captured' : report.winner === 'attacker' ? 'pushed back the defense of' : 'was repulsed attacking'} ${map.regions[region].name}.` })
  // Land that fell to the lead is shared out, and so is the treasure that came with it.
  const taken = regionsOf(s, war.lead).filter((id) => !heldBefore.has(id))
  const spoils = Math.max(0, lead.resources.capital - moneyBefore)
  if (spoils > 1e-9) {
    lead.resources.capital -= spoils
    const sh = sharesOf(f)
    for (const m of f.members) if (s.nations[m]?.alive) s.nations[m].resources.capital += spoils * sh[m]
  }
  if (taken.length) shareOutLand(s, map, f, war, taken)
  return result
}

/** Hands each captured country to a member: by ownership share (the member furthest behind its share gets the next), or to the proposer by charter. */
function shareOutLand(s: GameState, map: WorldMap, f: Faction, war: FactionWar, regions: RegionId[]) {
  const sh = sharesOf(f)
  for (const id of [...regions].sort()) {
    let owner: NationId
    if (f.charter.spoils === 'proposer' && s.nations[war.proposer]?.alive && f.members.includes(war.proposer)) owner = war.proposer
    else {
      const total = Object.values(war.given).reduce((a, b) => a + b, 0) + 1
      owner = [...f.members].filter((m) => s.nations[m]?.alive).sort((a, b) => sh[b] * total - (war.given[b] ?? 0) - (sh[a] * total - (war.given[a] ?? 0)) || (a < b ? -1 : 1))[0]
    }
    if (owner !== war.lead && s.regions[id].owner === war.lead) transferRegion(s, map, id, owner, false)
    war.given[owner] = (war.given[owner] ?? 0) + 1
    war.captured.push(id)
    say(s, f, `${map.regions[id].name} goes to ${nm(s, owner)}.`, 'war')
  }
}

// ---- the faction's month: members, contracts, upkeep ----

/** Drops members whose nations have fallen, and factions with nobody left. */
export function pruneFactions(s: GameState) {
  if (!s.factions?.length) return
  for (const f of [...s.factions]) {
    for (const m of [...f.members]) if (!s.nations[m]?.alive) leave(s, f, m, 'fell')
  }
}

/** The month's housekeeping, after the economy: contracts deliver, the army is paid and supplied, old invitations lapse. */
export function runFactionMonth(s: GameState) {
  if (!s.factions?.length) return
  pruneFactions(s)
  for (const f of [...(s.factions ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    runContracts(s, f)
    runUpkeep(s, f)
    f.invites = f.invites.filter((i) => i.expires >= s.turn && s.nations[i.nation]?.alive && !factionOf(s, i.nation))
    // A war proposal against a country that no longer exists, or whose war is already on, is dropped.
    f.proposals = f.proposals.filter((p) => p.kind !== 'war' || (s.nations[p.target!]?.alive && !f.wars.some((w) => w.target === p.target)))
  }
}

function runContracts(s: GameState, f: Faction) {
  const kept: FactionContract[] = []
  for (const c of [...f.contracts].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const n = s.nations[c.member]
    if (!n?.alive || !f.members.includes(c.member)) continue
    if (s.turn < c.from) {
      kept.push(c)
      continue
    }
    const short = POOL_RESOURCES.find((r) => (c.supply[r] ?? 0) > n.resources[STORE[r]] + EPS)
    const poolShort = POOL_RESOURCES.find((r) => (c.pay[r] ?? 0) > f.pool.stock[r] + (c.supply[r] ?? 0) + EPS)
    if (short) {
      // The member breaks the contract: the collateral goes to the pool, and the others remember.
      f.pool.stock.money += c.held
      say(s, f, `${n.name} could not deliver its ${POOL_NAMES[short].toLowerCase()} and broke its contract with ${f.name}${c.held > 0 ? `. The ${Math.round(c.held)} money in collateral goes to the pool` : ''}.`)
      for (const m of f.members) if (m !== c.member && !s.humans.includes(m)) addOpinion(s, m, c.member, 'Broke a faction contract', FACTION.breachOpinion, 0.3)
      continue
    }
    if (poolShort) {
      n.resources.capital += c.held
      say(s, f, `${f.name} could not pay its ${POOL_NAMES[poolShort].toLowerCase()} to ${n.name}. The contract is over and the collateral is returned.`)
      continue
    }
    for (const r of POOL_RESOURCES) {
      const give = c.supply[r] ?? 0
      const get = c.pay[r] ?? 0
      if (give > 0) {
        n.resources[STORE[r]] -= give
        f.pool.stock[r] += give
        // A supply that is paid for is a sale; a supply with nothing paid back is a contribution.
        if (!POOL_RESOURCES.some((q) => (c.pay[q] ?? 0) > 0)) {
          f.ledger[c.member].stock[r] += give
          f.ledger[c.member].last = s.turn
        }
      }
      if (get > 0) {
        f.pool.stock[r] -= get
        n.resources[STORE[r]] += get
      }
    }
    if (s.turn >= c.until) {
      n.resources.capital += c.held
      say(s, f, `The contract between ${f.name} and ${n.name} has been fulfilled.`)
      continue
    }
    kept.push(c)
  }
  f.contracts = kept
}

/** The pooled army costs what the same soldiers would cost a nation. The pool pays; if it cannot, the members pay by share; what cannot be paid, deserts. */
function runUpkeep(s: GameState, f: Faction) {
  const u = f.pool.units
  if (poolUnits(f) < 1e-6) {
    f.short = undefined
    return
  }
  const need = upkeepNeed(u)
  const fromPool = Math.min(f.pool.stock.money, need)
  f.pool.stock.money -= fromPool
  const shortfall = need - fromPool
  let owed = shortfall
  if (shortfall > EPS) {
    const sh = sharesOf(f)
    for (const m of [...f.members].sort()) {
      const n = s.nations[m]
      if (!n?.alive) continue
      const pay = Math.min(Math.max(0, n.resources.capital), shortfall * sh[m])
      n.resources.capital -= pay
      owed -= pay
    }
  }
  if (owed > 0.01 && need > 0) {
    const lost = Math.min(FACTION.desertCap, owed / need)
    for (const k of UNIT_TYPES) u[k] *= 1 - lost
    say(s, f, `${f.name} could not pay its army. ${Math.round(lost * 100)}% of the pooled soldiers deserted.`, 'war')
  }
  // Fuel and rations: the pool's own stores first, then the world market with the pool's money.
  const prices = marketPrices(s)
  const short: { oil?: boolean; food?: boolean } = {}
  for (const [r, need2] of [['oil', oilNeed(u)], ['food', foodNeed(u)]] as const) {
    const have = Math.min(f.pool.stock[r], need2)
    f.pool.stock[r] -= have
    const lack = need2 - have
    if (lack > EPS) {
      const cost = lack * prices[r] * FACTION.marketMarkup
      if (f.pool.stock.money >= cost) f.pool.stock.money -= cost
      else short[r] = true
    }
  }
  f.short = short.oil || short.food ? short : undefined
}

/** Tells a player what changed in their faction since the month before, for notifications. */
export function factionNews(before: GameState | null, next: GameState, player: NationId): string[] {
  const out: string[] = []
  const f = factionOf(next, player)
  const was = before ? factionOf(before, player) : null
  // An invitation that arrived.
  for (const g of next.factions ?? []) {
    const inv = g.invites.find((i) => i.nation === player && i.expires >= next.turn)
    const had = before?.factions?.find((x) => x.id === g.id)?.invites.some((i) => i.nation === player)
    if (inv && !had && !f) out.push(`${next.nations[inv.by]?.name ?? 'A nation'} invited you to join ${g.name}. See the Faction desk.`)
  }
  if (!f) return out
  for (const p of f.proposals) {
    if (p.by === player || p.votes[player]) continue
    if (!was?.proposals.some((x) => x.id === p.id)) out.push(p.kind === 'war' ? `${f.name}: a vote on war with ${next.nations[p.target!]?.name ?? 'a country'} needs you.` : `${f.name}: a contract vote needs you.`)
  }
  for (const w of f.wars) if (!was?.wars.some((x) => x.id === w.id)) out.push(`${f.name} is at war with ${next.nations[w.target]?.name ?? 'a country'}.`)
  for (const c of f.contracts) if (!was?.contracts.some((x) => x.id === c.id)) out.push(`${f.name}: a contract began with ${next.nations[c.member]?.name ?? 'a member'}.`)
  for (const c of was?.contracts ?? []) if (!f.contracts.some((x) => x.id === c.id)) out.push(`${f.name}: the contract with ${next.nations[c.member]?.name ?? 'a member'} has ended.`)
  return out
}

/** The votes a nation still owes, for the advisor. */
export function votesWaiting(s: GameState, id: NationId, pending: Order[] = []): { faction: Faction; proposal: FactionProposal }[] {
  const f = factionOf(s, id)
  if (!f) return []
  return f.proposals
    .filter((p) => !p.votes[id] && !pending.some((o) => o.type === 'factionVote' && o.proposalId === p.id))
    .map((proposal) => ({ faction: f, proposal }))
}
