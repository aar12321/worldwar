import { BLOC, GOALS, PERKS, ROLES, type PerkId } from '../data/blocs'
import { LIVE } from '../data/live'
import { UNIT_SPECS } from '../data/unitTypes'
import { addOpinion } from '../ai/opinion'
import { planTrip, tripSchedule } from './armies'
import { shareBack } from './blocCombat'
import { isLive, clockOf } from './calendar'
import { resolveBattle } from './combat'
import { cleanUnits, SENDABLE } from './deploy'
import { freeUnits } from './deployment'
import { declareWar } from './diplomacy'
import { factionById, factionOf } from './factions'
import { addLog, atWar, emptyUnits, enemiesOf, hasPact, isAllied, maxWars, newId, pairKey, regionsOf, totalUnits } from './helpers'
import { militaryPower } from './militaryStats'
import { createRng, type Rng } from './rng'
import type { Army, BlocCall, BlocFeedKind, BlocGoal, BlocGoalKind, BlocOp, BlocOpResult, BlocState, Faction, GameState, NationId, Order, UnitCounts, WorldMap } from './types'
import { UNIT_TYPES } from './types'
import { canAttackRegion, prepareAttack, resolveAttack, transferRegion } from './warfare'

/**
 * Blocs: a faction played as an alliance (docs/BLOC_STATUS.md). The members share one objective a season, earn prestige that unlocks
 * perks, take roles, answer calls to arms with one click, and plan joint operations: each member pledges divisions from its own army,
 * they fight as one force on D-Day with a combined-arms bonus, and what comes back goes home to whoever sent it.
 * Everything here is skipped with `BLOC.on` off, and a faction gets its `bloc` field only when these rules first run for it.
 */

export type BlocOrder = Extract<Order, { type: 'blocRole' | 'blocGoal' | 'blocCall' | 'blocAnswer' | 'blocPlan' | 'blocCommit' | 'blocCancel' | 'blocChat' }>
export const BLOC_ORDERS = new Set<Order['type']>(['blocRole', 'blocGoal', 'blocCall', 'blocAnswer', 'blocPlan', 'blocCommit', 'blocCancel', 'blocChat'])
export const isBlocOrder = (o: Order): o is BlocOrder => BLOC_ORDERS.has(o.type)

const nm = (s: GameState, id: NationId) => s.nations[id]?.name ?? id
const EPS = 1e-9
const SALT = 0x0b10c5

// ---- the bloc's state ----

export const newBloc = (): BlocState => ({ xp: 0, roles: {}, done: 0, failed: 0, calls: [], ops: [], record: {} })
const EMPTY: BlocState = newBloc()

/** The bloc layer of a faction, for reading. A faction the rules have not reached yet reads as a new bloc. */
export const blocOf = (f: Faction | null | undefined): BlocState => f?.bloc ?? EMPTY
function ensure(f: Faction): BlocState {
  return (f.bloc ??= newBloc())
}

export function levelOf(xp: number): number {
  let lv = 1
  for (let i = 0; i < BLOC.levels.length; i++) if (xp >= BLOC.levels[i]) lv = i + 1
  return lv
}

/** Prestige toward the next level: what it has, and what the next level asks (null at the top). */
export function levelProgress(xp: number): { level: number; from: number; to: number | null } {
  const level = levelOf(xp)
  return { level, from: BLOC.levels[level - 1], to: BLOC.levels[level] ?? null }
}

export const hasPerk = (f: Faction | null | undefined, id: PerkId): boolean => !!f && BLOC.on && levelOf(blocOf(f).xp) >= (PERKS.find((p) => p.id === id)?.level ?? 99)

/** The bloc's leader: it plans alone, calls the bloc to arms and picks the objective. */
export const leaderOf = (f: Faction): NationId => f.founder

/** Members with a vote and a seat (a territory sits in its master's bloc without either). */
const seated = (s: GameState, f: Faction) => f.members.filter((m) => s.nations[m]?.alive && !s.nations[m].territoryOf)

/** A line in the bloc's feed (its history), and in the members' news. */
export function feed(s: GameState, f: Faction, text: string, kind: BlocFeedKind, by?: NationId, log = true) {
  f.history.push({ turn: s.turn, text, ...(by ? { by } : {}), kind })
  const max = Math.max(BLOC.feedMax, 40)
  if (f.history.length > max) f.history.splice(0, f.history.length - max)
  if (log) addLog(s, kind === 'op' || kind === 'call' ? 'war' : 'diplomacy', text, [...f.members])
}

function gainXp(s: GameState, f: Faction, xp: number, why: string) {
  const b = ensure(f)
  const before = levelOf(b.xp)
  b.xp += xp
  const after = levelOf(b.xp)
  if (after > before) {
    const perk = PERKS.find((p) => p.level === after)
    feed(s, f, `${f.name} reached level ${after}${perk ? `: ${perk.name} unlocked. ${perk.text}` : ''} (${why}).`, 'level')
  }
}

// ---- strength and the objective ----

/** What a bloc's members can bring to bear: their military strength together. */
export const blocPower = (s: GameState, f: Faction): number => f.members.reduce((a, m) => a + (s.nations[m]?.alive ? militaryPower(s, m) : 0), 0)
const countries = (s: GameState, members: NationId[]) => members.reduce((a, m) => a + (s.nations[m]?.alive ? regionsOf(s, m).length : 0), 0)

/** The strongest other bloc, to measure yourself against. */
export function rivalBloc(s: GameState, f: Faction): Faction | null {
  let best: Faction | null = null
  let bp = 0
  for (const g of [...(s.factions ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (g.id === f.id) continue
    const p = blocPower(s, g)
    if (p > bp) {
      bp = p
      best = g
    }
  }
  return best
}

/** The member most in need of defending: at war with the most enemies, the weakest breaking a tie. */
function memberToDefend(s: GameState, f: Faction): NationId | null {
  const at = seated(s, f).filter((m) => enemiesOf(s, m).length > 0)
  return at.sort((a, b) => enemiesOf(s, b).length - enemiesOf(s, a).length || militaryPower(s, a) - militaryPower(s, b) || (a < b ? -1 : 1))[0] ?? null
}

export interface GoalChoice {
  kind: BlocGoalKind
  target?: NationId
}

/** The objectives a bloc can choose from now, best fit first: war aims for a bloc at war, building and growing for one at peace. */
export function goalChoices(s: GameState, f: Faction): GoalChoice[] {
  const atWarNow = f.members.some((m) => enemiesOf(s, m).some((e) => !f.members.includes(e)))
  const out: GoalChoice[] = []
  const defend = memberToDefend(s, f)
  if (atWarNow) {
    out.push({ kind: 'conquer' }, { kind: 'strike' })
    if (defend) out.push({ kind: 'defend', target: defend })
    out.push({ kind: 'hold' })
  } else {
    out.push({ kind: 'arsenal' })
    if (seated(s, f).length < 8) out.push({ kind: 'grow' })
  }
  const rival = rivalBloc(s, f)
  if (rival) out.push({ kind: 'outmatch', target: rival.founder })
  if (!atWarNow) out.push({ kind: 'hold' })
  return out.slice(0, 3)
}

function goalBase(s: GameState, f: Faction, kind: BlocGoalKind, target?: NationId): number {
  switch (kind) {
    case 'conquer':
    case 'hold':
      return countries(s, f.members)
    case 'defend':
      return target ? regionsOf(s, target).length : 0
    case 'arsenal':
      return blocPower(s, f)
    case 'grow':
      return seated(s, f).length
    default:
      return 0
  }
}

function startGoal(s: GameState, f: Faction, kind: BlocGoalKind, target?: NationId, since = s.turn) {
  const b = ensure(f)
  b.goal = { kind, ...(target ? { target } : {}), since, until: since + BLOC.seasonMonths - 1, base: goalBase(s, f, kind, target), members: [...f.members].sort() }
  feed(s, f, `New objective for ${f.name}: ${goalTitle(s, b.goal)}. ${GOALS[kind].text}`, 'goal')
}

export function goalTitle(s: GameState, g: Pick<BlocGoal, 'kind' | 'target'>): string {
  if (g.kind === 'defend' && g.target) return `Defend ${nm(s, g.target)}`
  if (g.kind === 'outmatch' && g.target) return `Outmatch ${factionOf(s, g.target)?.name ?? nm(s, g.target)}`
  return GOALS[g.kind].name
}

/** How far the objective has come, 0 to 1, with a line that says it; `met` once it is achieved (hold and defend only at the season's end). */
export function goalProgress(s: GameState, f: Faction, g: BlocGoal): { value: number; text: string; met: boolean } {
  const months = Math.min(BLOC.seasonMonths, Math.max(0, s.turn - g.since))
  switch (g.kind) {
    case 'conquer': {
      const got = Math.max(0, countries(s, g.members) - g.base)
      return { value: Math.min(1, got / BLOC.conquer), text: `${got} of ${BLOC.conquer} countries taken`, met: got >= BLOC.conquer }
    }
    case 'hold':
    case 'defend': {
      const who = g.kind === 'defend' && g.target ? [g.target] : g.members
      const lost = g.broken || countries(s, who) < g.base
      return { value: lost ? 0 : months / BLOC.seasonMonths, text: lost ? 'A country was lost' : `${months} of ${BLOC.seasonMonths} months held`, met: !lost && s.turn >= g.until }
    }
    case 'arsenal': {
      const need = g.base * BLOC.arsenalGrowth
      const got = blocPower(s, f) - g.base
      return { value: need > 0 ? Math.max(0, Math.min(1, got / need)) : 1, text: `strength ${Math.round(blocPower(s, f))} of ${Math.round(g.base * (1 + BLOC.arsenalGrowth))}`, met: got >= need - EPS }
    }
    case 'strike': {
      const hits = g.hits ?? 0
      return { value: Math.min(1, hits), text: hits ? 'An operation won' : 'No operation won yet', met: hits >= 1 }
    }
    case 'grow': {
      const now = seated(s, f).length
      return { value: now > g.base ? 1 : 0, text: now > g.base ? 'A new member joined' : 'No new member yet', met: now > g.base }
    }
    case 'outmatch': {
      const rival = g.target ? factionOf(s, g.target) : null
      const theirs = rival && rival.id !== f.id ? blocPower(s, rival) : 0
      const ratio = blocPower(s, f) / Math.max(1, theirs * BLOC.outmatchRatio)
      return { value: Math.min(1, ratio), text: rival ? `${Math.round(blocPower(s, f))} against ${Math.round(theirs)}` : 'The rival bloc is gone', met: s.turn >= g.until && ratio >= 1 }
    }
  }
}

// ---- operations ----

/** Strength of a force, roughly: attack and defense of its divisions. */
export function forceValue(u: Partial<UnitCounts>): number {
  let v = 0
  for (const k of UNIT_TYPES) v += (u[k] ?? 0) * (UNIT_SPECS[k].attack + UNIT_SPECS[k].defense) * 0.5
  return v
}

/** Combined arms: the bonus a force of `fighters` members gets in this bloc. */
export function opBonus(f: Faction, fighters: number): number {
  const extra = Math.min(BLOC.maxExtra, Math.max(0, fighters - 1))
  return extra * BLOC.perMember + (hasPerk(f, 'production') ? BLOC.level5Bonus : 0)
}

const activeOps = (b: BlocState) => b.ops.filter((o) => o.status === 'planned' || o.status === 'marching')

/** What a member can send to an operation now: its free divisions (a live army leaves a home guard behind). */
export function sendable(s: GameState, id: NationId): UnitCounts {
  const free = freeUnits(s, id)
  const n = s.nations[id]
  const out = emptyUnits()
  if (!n?.alive) return out
  const keep = isLive(s) ? 1 - LIVE.homeGuard : 1
  for (const k of SENDABLE) out[k] = Math.max(0, (free[k] - (n.military.sent?.[k] ?? 0)) * keep)
  return out
}

/** Who would fight in an operation now, with what (pledges capped by what each can send), and who leads it over its border. */
export function opForce(s: GameState, map: WorldMap, f: Faction, op: BlocOp): { from: Record<NationId, UnitCounts>; lead: NationId | null; owner: NationId; dropped: Record<NationId, string> } {
  const owner = s.regions[op.target]?.owner
  const from: Record<NationId, UnitCounts> = {}
  const dropped: Record<NationId, string> = {}
  for (const m of Object.keys(op.pledges).sort()) {
    if (!f.members.includes(m) || !s.nations[m]?.alive) continue
    if (!owner || !atWar(s, m, owner)) {
      dropped[m] = `not at war with ${nm(s, owner ?? op.enemy)}`
      continue
    }
    const can = sendable(s, m)
    const want = cleanUnits(op.pledges[m])
    const u = emptyUnits()
    for (const k of SENDABLE) u[k] = Math.min(want[k], can[k])
    if (totalUnits(u) < 0.05) {
      dropped[m] = 'nothing free to send'
      continue
    }
    from[m] = u
  }
  // The member that can reach the target and brings the most leads the force over its border.
  const lead = Object.keys(from).filter((m) => canAttackRegion(s, map, m, op.target).ok).sort((a, b) => forceValue(from[b]) - forceValue(from[a]) || (a < b ? -1 : 1))[0] ?? null
  return { from, lead, owner: owner ?? op.enemy, dropped }
}

const sumUnits = (from: Record<NationId, UnitCounts>): UnitCounts => {
  const u = emptyUnits()
  for (const m of Object.keys(from)) for (const k of UNIT_TYPES) u[k] += from[m][k]
  return u
}

function syntheticArmy(s: GameState, map: WorldMap, op: BlocOp, f: Faction, lead: NationId, from: Record<NationId, UnitCounts>): Army {
  const reach = canAttackRegion(s, map, lead, op.target)
  const units = sumUnits(from)
  return {
    id: `op-${op.id}`,
    nationId: lead,
    units,
    commit: 'main',
    stance: 'assault',
    share: 1,
    via: reach.via ?? 'land',
    bySea: reach.bySea,
    home: op.target,
    target: op.target,
    phase: 'fighting',
    from: { lat: map.regions[op.target].lat, lng: map.regions[op.target].lng },
    to: { lat: map.regions[op.target].lat, lng: map.regions[op.target].lng },
    start: 0,
    end: 0,
    launched: s.turn,
    op: { id: op.id, bloc: f.id, from, bonus: opBonus(f, Object.keys(from).length) },
  }
}

export interface OpForecast {
  winChance: number
  fighters: NationId[]
  lead: NationId | null
  bonus: number
  divisions: number
  dropped: Record<NationId, string>
}

/** The odds of an operation if it fought today with what is pledged: the battle played on fixed seeds, the state left alone. */
export function forecastOp(s: GameState, map: WorldMap, f: Faction, op: BlocOp, runs = 12): OpForecast {
  const { from, lead, dropped } = opForce(s, map, f, op)
  const fighters = Object.keys(from)
  const divisions = totalUnits(sumUnits(from))
  const bonus = opBonus(f, fighters.length)
  if (!lead || !map.regions[op.target]) return { winChance: 0, fighters, lead, bonus, divisions, dropped }
  const army = syntheticArmy(s, map, op, f, lead, from)
  const setup = prepareAttack(s, map, lead, op.target, 'main', 'assault', undefined, army)
  if (!setup) return { winChance: 0, fighters, lead, bonus, divisions, dropped }
  const mr = map.regions[op.target]
  let wins = 0
  for (let i = 0; i < runs; i++) if (resolveBattle({ attacker: setup.attacker, defender: setup.defender, terrain: mr.terrain, coastal: mr.coastal }, createRng(s.seed, 77003 + i)).winner === 'attacker') wins++
  return { winChance: wins / runs, fighters, lead, bonus, divisions, dropped }
}

/** Takes each member's divisions out of its military for the operation. */
function muster(s: GameState, from: Record<NationId, UnitCounts>) {
  for (const m of Object.keys(from)) for (const k of UNIT_TYPES) s.nations[m].military.units[k] = Math.max(0, s.nations[m].military.units[k] - from[m][k])
}

/** After the battle: the report, the spoils split by what each sent, prestige, the objective, and the news. */
function settleOp(s: GameState, map: WorldMap, f: Faction, op: BlocOp, army: Army, report: { id: string; winner: 'attacker' | 'defender'; captured: boolean; modifiers: string[] }, moneyBefore: number, back: Record<NationId, UnitCounts> | null) {
  const from = army.op!.from
  const lead = army.nationId
  const fighters = Object.keys(from).sort()
  const total = fighters.reduce((a, m) => a + forceValue(from[m]), 0)
  const members: BlocOpResult['members'] = {}
  for (const m of fighters) {
    const sent = totalUnits(from[m])
    members[m] = { sent, lost: back ? Math.max(0, sent - totalUnits(back[m])) : totalUnits(army.units) < 0.05 ? sent : 0, share: total > EPS ? forceValue(from[m]) / total : 1 / fighters.length }
  }
  const result: BlocOpResult = { won: report.winner === 'attacker', captured: report.captured, battleId: report.id, turn: s.turn, ...(isLive(s) ? { day: s.day ?? 0 } : {}), lead, bonus: army.op!.bonus, members }
  // The country goes to the member who sent the most; the treasure that came with it is split by what each sent.
  const ln = s.nations[lead]
  const spoils = ln ? Math.max(0, ln.resources.capital - moneyBefore) : 0
  if (spoils > EPS && ln) {
    ln.resources.capital -= spoils
    result.spoils = {}
    for (const m of fighters) {
      const part = spoils * members[m].share
      if (s.nations[m]?.alive) s.nations[m].resources.capital += part
      else ln.resources.capital += part
      result.spoils[m] = part
    }
  }
  if (report.captured && s.regions[op.target]?.owner === lead) {
    const owner = [...fighters].filter((m) => s.nations[m]?.alive).sort((a, b) => members[b].share - members[a].share || (a < b ? -1 : 1))[0] ?? lead
    if (owner !== lead) transferRegion(s, map, op.target, owner, false)
    result.owner = owner
  }
  report.modifiers.push(`Bloc operation of ${f.name}: ${fighters.map((m) => `${nm(s, m)} ${members[m].sent.toFixed(1)} div.`).join(', ')}; led over the border by ${nm(s, lead)}`)
  op.result = result
  op.status = 'done'
  const b = ensure(f)
  for (const m of fighters) {
    const r = (b.record[m] ??= { ops: 0, sent: 0, joined: 0 })
    r.ops++
    r.sent += members[m].sent
  }
  if (result.won) {
    if (b.goal?.kind === 'strike') b.goal.hits = (b.goal.hits ?? 0) + 1
    gainXp(s, f, result.captured ? BLOC.opCapturePrestige : BLOC.opWinPrestige, 'an operation won')
    // Fighting side by side warms the members to one another.
    for (const a of fighters) for (const c of fighters) if (a !== c && !s.humans.includes(a)) addOpinion(s, a, c, 'Fought beside us in the bloc', 3, 0.5)
  }
  const place = map.regions[op.target]?.name ?? op.target
  feed(s, f, `OPERATION ${result.captured ? 'CAPTURED' : result.won ? 'WON AT' : 'REPULSED AT'} ${place.toUpperCase()}: ${fighters.map((m) => nm(s, m)).join(', ')} attacked together (+${Math.round(result.bonus * 100)}% combined arms).${result.owner ? ` ${place} goes to ${nm(s, result.owner)}.` : ''}`, 'op')
}

function failOp(s: GameState, f: Faction, op: BlocOp, why: string) {
  op.status = 'done'
  op.result = { won: false, captured: false, turn: s.turn, ...(isLive(s) ? { day: s.day ?? 0 } : {}), lead: op.by, bonus: 0, members: {}, failed: why }
  feed(s, f, `The operation on ${nm(s, op.enemy)} did not go ahead: ${why}.`, 'op')
}

/** Why an operation can no longer happen at all, or null. */
function opGone(s: GameState, f: Faction, op: BlocOp): string | null {
  const owner = s.regions[op.target]?.owner
  if (!owner || !s.nations[owner]?.alive) return 'the target is gone'
  if (f.members.includes(owner)) return 'a member already holds it'
  return null
}

/** A turn game: operations whose D-Day is this month fight now, all members' divisions as one force. */
export function runBlocOpsTurn(s: GameState, map: WorldMap) {
  if (!BLOC.on || !s.factions?.length || isLive(s)) return
  for (const f of [...s.factions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!f.bloc) continue
    for (const op of f.bloc.ops.filter((o) => o.status === 'planned' && o.dday <= s.turn)) {
      const rng = createRng((s.seed ^ SALT) >>> 0, s.turn * 1009 + Number(op.id.replace(/\D/g, '') || 0))
      fightNow(s, map, f, op, rng)
    }
  }
}

function fightNow(s: GameState, map: WorldMap, f: Faction, op: BlocOp, rng: Rng) {
  const gone = opGone(s, f, op)
  if (gone) return failOp(s, f, op, gone)
  const { from, lead } = opForce(s, map, f, op)
  if (!Object.keys(from).length) return failOp(s, f, op, 'nobody sent any forces')
  if (!lead) return failOp(s, f, op, 'no member that sent forces can reach it')
  const army = syntheticArmy(s, map, op, f, lead, from)
  muster(s, from)
  const moneyBefore = s.nations[lead].resources.capital
  const result = resolveAttack(s, map, lead, op.target, rng, 'main', 'assault', undefined, army)
  // The force goes home at once in a turn game: what survived returns to the members who sent it.
  const back = shareBack(s, from, army.units)
  if (!result) return failOp(s, f, op, 'the attack could not be made')
  delete result.report.armyId
  settleOp(s, map, f, op, army, result.report, moneyBefore, back)
}

/** A live game: the day an operation must set out to arrive on D-Day, with who leads it; null when nobody can reach it. */
export function launchDay(s: GameState, map: WorldMap, f: Faction, op: BlocOp): { day: number; lead: NationId } | null {
  const { lead } = opForce(s, map, f, op)
  if (!lead) return null
  const trip = planTrip(s, map, lead, op.target)
  if (!trip) return null
  return { day: op.dday - trip.days - LIVE.musterDays, lead }
}

/** Live: whether an operation is due to set out (or to be dropped) today. */
export function blocOpsDue(s: GameState, today: number): boolean {
  if (!BLOC.on || !s.factions?.length) return false
  // Cheap: any planned operation whose D-Day is within the longest march.
  return s.factions.some((f) => f.bloc?.ops.some((o) => o.status === 'planned' && o.dday - today <= LIVE.travel.fleet.max + LIVE.musterDays + 1))
}

/**
 * Live: operations set out so that they arrive on D-Day: the members' pledged divisions march as one army over the leader's border.
 * One that can no longer go ahead, or whose D-Day has come with nobody able to march, is called off. Returns the armies launched.
 */
export function launchBlocOps(s: GameState, map: WorldMap, today: number): Army[] {
  const out: Army[] = []
  if (!BLOC.on || !s.factions?.length || !isLive(s)) return out
  for (const f of [...s.factions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!f.bloc) continue
    for (const op of f.bloc.ops.filter((o) => o.status === 'planned')) {
      const gone = opGone(s, f, op)
      if (gone) {
        failOp(s, f, op, gone)
        continue
      }
      const when = launchDay(s, map, f, op)
      if (!when) {
        if (today >= op.dday) failOp(s, f, op, Object.keys(op.pledges).length ? 'no member that pledged forces could reach it' : 'nobody pledged any forces')
        continue
      }
      if (today < when.day) continue
      const { from, lead } = opForce(s, map, f, op)
      const trip = lead ? planTrip(s, map, lead, op.target) : null
      if (!lead || !trip) continue
      muster(s, from)
      const { leaves, arrives } = tripSchedule(trip, today)
      const units = sumUnits(from)
      const army: Army = {
        id: newId(s, 'a'),
        nationId: lead,
        units,
        commit: 'main',
        stance: 'assault',
        share: 1,
        chosen: true,
        via: trip.via,
        bySea: trip.bySea,
        home: trip.from,
        target: op.target,
        phase: 'outbound',
        from: { lat: map.regions[trip.from].lat, lng: map.regions[trip.from].lng },
        to: { lat: map.regions[op.target].lat, lng: map.regions[op.target].lng },
        start: leaves,
        end: arrives,
        launched: today,
        foe: s.regions[op.target]?.owner,
        op: { id: op.id, bloc: f.id, from, bonus: opBonus(f, Object.keys(from).length) },
      }
      ;(s.armies ??= []).push(army)
      op.status = 'marching'
      op.armyId = army.id
      feed(s, f, `The bloc's operation sets out: ${Object.keys(from).map((m) => nm(s, m)).join(', ')} march on ${map.regions[op.target].name} together, ${arrives - today} days away.`, 'op')
      out.push(army)
    }
  }
  return out
}

/** Live: an operation's army arrived and fights. Returns the attack's result, like `resolveAttack`. */
export function fightBlocArmy(s: GameState, map: WorldMap, army: Army, rng: Rng) {
  const f = factionById(s, army.op?.bloc ?? '')
  const op = f?.bloc?.ops.find((o) => o.id === army.op!.id)
  const lead = s.nations[army.nationId]
  if (!lead?.alive) return null
  const moneyBefore = lead.resources.capital
  const result = resolveAttack(s, map, army.nationId, army.target, rng, 'main', 'assault', undefined, army)
  if (!result) return null
  if (f && op) settleOp(s, map, f, op, army, result.report, moneyBefore, null)
  return result
}

// ---- calls to arms ----

/** Why `m` cannot join a war on `target`, or null. */
export function joinProblem(s: GameState, m: NationId, target: NationId): string | null {
  const n = s.nations[m]
  const t = s.nations[target]
  if (!n?.alive || !t?.alive) return 'They are gone'
  if (atWar(s, m, target)) return 'Already at war with them'
  if (n.overlord) return 'A puppet cannot go to war'
  if (n.territoryOf) return 'A territory follows its master'
  if (t.overlord === m || t.territoryOf === m) return 'They are yours'
  if (isAllied(s, m, target)) return 'You are allied with them'
  if (hasPact(s, m, target)) return 'You have a pact with them'
  if (enemiesOf(s, m).length >= maxWars(s, m)) return 'You are fighting too many wars'
  return null
}

function openCall(s: GameState, map: WorldMap, f: Faction, by: NationId, target: NationId, auto: boolean) {
  const b = ensure(f)
  if (b.calls.some((c) => c.target === target && c.expires >= s.turn)) return
  const call: BlocCall = { id: newId(s, 'bc'), by, target, created: s.turn, expires: s.turn + BLOC.callMonths, answers: {}, ...(auto ? { auto: true } : {}) }
  b.calls.push(call)
  feed(s, f, `CALL TO ARMS: ${nm(s, by)} asks ${f.name} to join its war on ${nm(s, target)}.`, 'call')
  // Mutual Defence: rival members join at once if they can.
  if (hasPerk(f, 'defence')) for (const m of seated(s, f)) if (m !== by && !s.humans.includes(m) && !joinProblem(s, m, target)) answer(s, map, f, call, m, true, createRng((s.seed ^ SALT) >>> 0, s.turn))
}

function answer(s: GameState, map: WorldMap, f: Faction, call: BlocCall, m: NationId, join: boolean, rng: Rng) {
  call.answers[m] = join ? 'join' : 'decline'
  if (!join) {
    feed(s, f, `${nm(s, m)} stays out of the war on ${nm(s, call.target)}.`, 'call', m, false)
    return
  }
  // Joining a member's war is not aggression: no allies are called in and no reason is needed.
  declareWar(s, map, m, call.target, rng, false)
  if (!atWar(s, m, call.target)) return
  const b = ensure(f)
  ;(b.record[m] ??= { ops: 0, sent: 0, joined: 0 }).joined++
  gainXp(s, f, BLOC.joinPrestige, 'a call to arms answered')
  if (!s.humans.includes(call.by)) addOpinion(s, call.by, m, 'Answered our call to arms', 6, 0.5)
  feed(s, f, `${nm(s, m)} answers the call and goes to war with ${nm(s, call.target)}.`, 'call', m)
}

// ---- orders ----

const ROLE_IDS = ROLES.map((r) => r.id)

/** The rule checks for the bloc orders. `pending` are this player's orders already queued this month. */
export function blocProblem(s: GameState, map: WorldMap, o: BlocOrder, pending: Order[] = []): string | null {
  if (!BLOC.on) return 'Blocs are switched off'
  const f = factionOf(s, o.nationId)
  if (!f) return 'You are not in a bloc'
  const n = s.nations[o.nationId]
  if (n?.territoryOf) return 'A territory follows its master'
  const b = blocOf(f)
  const leader = leaderOf(f) === o.nationId
  switch (o.type) {
    case 'blocRole': {
      if (o.role !== null && !ROLE_IDS.includes(o.role)) return 'Unknown role'
      if (o.role === null) return b.roles[o.nationId] ? null : 'You have no role'
      if (b.roles[o.nationId] === o.role) return 'That is already your role'
      const holder = Object.entries(b.roles).find(([m, r]) => r === o.role && m !== o.nationId && f.members.includes(m))
      if (holder) return `${nm(s, holder[0])} is already the ${ROLES.find((r) => r.id === o.role)!.name}`
      if (pending.some((p) => p.type === 'blocRole' && p.nationId === o.nationId && p !== o)) return 'Already queued'
      return null
    }
    case 'blocGoal': {
      if (!leader) return `Only the leader, ${nm(s, leaderOf(f))}, picks the objective`
      if (!GOALS[o.goal]) return 'Unknown objective'
      if (b.goal && s.turn > b.goal.since) return 'The season is under way: the next objective is chosen when it ends'
      if (b.goal?.kind === o.goal && b.goal.target === o.target) return 'That is already the objective'
      if (!goalChoices(s, f).some((c) => c.kind === o.goal && (c.target ?? undefined) === (o.target ?? undefined))) return 'That objective is not on offer this season'
      return null
    }
    case 'blocCall': {
      if (!leader) return `Only the leader, ${nm(s, leaderOf(f))}, calls the bloc to arms`
      const t = s.nations[o.target]
      if (!t?.alive) return 'Choose a country'
      if (f.members.includes(o.target)) return 'They are in the bloc'
      if (!atWar(s, o.nationId, o.target)) return `Declare war on ${t.name} first, then call the bloc to arms`
      if (b.calls.some((c) => c.target === o.target && c.expires >= s.turn) || pending.some((p) => p.type === 'blocCall' && p.target === o.target)) return 'The bloc has already been called against them'
      if (f.members.every((m) => m === o.nationId || atWar(s, m, o.target) || s.nations[m]?.territoryOf)) return 'Every member is already at war with them'
      return null
    }
    case 'blocAnswer': {
      const call = b.calls.find((c) => c.id === o.callId)
      if (!call || call.expires < s.turn) return 'That call to arms is over'
      if (call.by === o.nationId) return 'It is your own call'
      if (call.answers[o.nationId] === 'join') return 'You already answered'
      return o.join ? joinProblem(s, o.nationId, call.target) : null
    }
    case 'blocPlan': {
      const r = s.regions[o.target]
      if (!r || !map.regions[o.target]) return 'Choose a country to attack'
      const owner = r.owner
      if (f.members.includes(owner)) return 'A member holds it'
      if (!f.members.some((m) => atWar(s, m, owner))) return `No member is at war with ${nm(s, owner)}`
      if (!f.members.some((m) => atWar(s, m, owner) && canAttackRegion(s, map, m, o.target).ok)) return 'No member at war with them can reach it'
      const [lo, hi] = isLive(s) ? BLOC.liveWhen : BLOC.turnWhen
      if (!Number.isInteger(o.when) || o.when < lo || o.when > hi) return isLive(s) ? `D-Day is ${lo} to ${hi} days away` : `D-Day is ${lo} to ${hi} months away`
      if (activeOps(b).length + pending.filter((p) => p.type === 'blocPlan').length >= BLOC.maxOps) return `A bloc runs ${BLOC.maxOps} operations at a time`
      if (activeOps(b).some((x) => x.target === o.target) || pending.some((p) => p.type === 'blocPlan' && p.target === o.target)) return 'An operation already targets it'
      return null
    }
    case 'blocCommit': {
      const op = b.ops.find((x) => x.id === o.opId)
      if (!op) return 'No such operation'
      if (op.status !== 'planned') return op.status === 'marching' ? 'The force has already set out' : 'The operation is over'
      if (!o.units || typeof o.units !== 'object') return 'Choose divisions'
      for (const [k, v] of Object.entries(o.units)) {
        if (!SENDABLE.includes(k as never)) return 'Unknown divisions'
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e5) return 'Invalid amount'
      }
      const want = cleanUnits(o.units)
      const can = s.nations[o.nationId].military.units
      for (const k of SENDABLE) if (want[k] > can[k] + 0.05) return `You have ${Math.floor(can[k] * 10) / 10} ${UNIT_SPECS[k].name.toLowerCase()}`
      if (totalUnits(want) < 0.05 && !op.pledges[o.nationId]) return 'Choose divisions to pledge'
      return null
    }
    case 'blocCancel': {
      const op = b.ops.find((x) => x.id === o.opId)
      if (!op || op.status !== 'planned') return 'Only a planned operation can be called off'
      if (op.by !== o.nationId && !leader) return 'Only who planned it, or the leader, can call it off'
      return null
    }
    case 'blocChat': {
      const text = typeof o.text === 'string' ? o.text.replace(/\s+/g, ' ').trim() : ''
      if (!text) return 'Write something'
      if (text.length > BLOC.chatMax) return `Keep it under ${BLOC.chatMax} letters`
      return null
    }
  }
}

export function blocOrderCost(o: Order): { pp: number } {
  if (o.type === 'blocPlan') return { pp: BLOC.planInfluence }
  if (o.type === 'blocCall') return { pp: BLOC.callInfluence }
  return { pp: 0 }
}

/** Carries out a validated bloc order. */
export function executeBlocOrder(s: GameState, map: WorldMap, o: BlocOrder, rng: Rng) {
  const f = factionOf(s, o.nationId)
  if (!f) return
  const b = ensure(f)
  switch (o.type) {
    case 'blocRole':
      if (o.role === null) {
        delete b.roles[o.nationId]
        feed(s, f, `${nm(s, o.nationId)} gave up its role.`, 'member', o.nationId, false)
      } else {
        b.roles[o.nationId] = o.role
        feed(s, f, `${nm(s, o.nationId)} is now the bloc's ${ROLES.find((r) => r.id === o.role)!.name}.`, 'member', o.nationId, false)
      }
      break
    case 'blocGoal':
      startGoal(s, f, o.goal, o.target)
      break
    case 'blocCall':
      openCall(s, map, f, o.nationId, o.target, false)
      break
    case 'blocAnswer': {
      const call = b.calls.find((c) => c.id === o.callId)
      if (call) answer(s, map, f, call, o.nationId, o.join, rng)
      break
    }
    case 'blocPlan': {
      const owner = s.regions[o.target].owner
      const dday = isLive(s) ? clockOf(s) + o.when : s.turn + o.when
      const op: BlocOp = { id: newId(s, 'op'), by: o.nationId, target: o.target, enemy: owner, created: s.turn, dday, pledges: {}, status: 'planned' }
      b.ops.push(op)
      feed(s, f, `${nm(s, o.nationId)} plans an operation on ${map.regions[o.target].name} (${nm(s, owner)}): D-Day ${isLive(s) ? `in ${o.when} days` : `at the end of ${o.when === 1 ? 'next month' : `${o.when} months from now`}`}. Pledge divisions on the Operations tab.`, 'op', o.nationId)
      break
    }
    case 'blocCommit': {
      const op = b.ops.find((x) => x.id === o.opId)!
      const want = cleanUnits(o.units)
      const tidy: Partial<UnitCounts> = {}
      for (const k of SENDABLE) if (want[k] > 0) tidy[k] = want[k]
      const had = !!op.pledges[o.nationId]
      if (Object.keys(tidy).length) op.pledges[o.nationId] = tidy
      else delete op.pledges[o.nationId]
      const total = totalUnits(want)
      feed(s, f, total > 0 ? `${nm(s, o.nationId)} pledges ${total.toFixed(1)} divisions to the operation on ${map.regions[op.target]?.name ?? op.target}.` : `${nm(s, o.nationId)} withdraws its pledge${had ? '' : ''} from the operation on ${map.regions[op.target]?.name ?? op.target}.`, 'op', o.nationId, false)
      break
    }
    case 'blocCancel': {
      const op = b.ops.find((x) => x.id === o.opId)!
      op.status = 'cancelled'
      feed(s, f, `${nm(s, o.nationId)} called off the operation on ${map.regions[op.target]?.name ?? op.target}.`, 'op', o.nationId, false)
      break
    }
    case 'blocChat': {
      const text = o.text.replace(/\s+/g, ' ').trim().slice(0, BLOC.chatMax)
      feed(s, f, text, 'chat', o.nationId, false)
      break
    }
  }
}

// ---- the month ----

/**
 * The bloc's month, after the economy: perks and roles pay, members at war call the others to arms, calls that ran out close, the
 * season's objective is checked (met, failed, or a new one chosen), and finished operations are tidied away.
 */
export function runBlocMonth(s: GameState, map: WorldMap) {
  if (!BLOC.on || !s.factions?.length) return
  for (const f of [...s.factions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const b = ensure(f)
    const members = seated(s, f)
    // Roles of members that left go with them.
    for (const m of Object.keys(b.roles)) if (!f.members.includes(m)) delete b.roles[m]
    // Perks and roles pay.
    const others = Math.max(0, members.length - 1)
    for (const m of members) {
      const n = s.nations[m]
      if (hasPerk(f, 'market')) n.resources.capital += Math.min(BLOC.market.max, BLOC.market.per * others)
      if (hasPerk(f, 'research')) n.resources.tp += Math.min(BLOC.research.max, BLOC.research.per * others)
      if (hasPerk(f, 'production')) n.resources.steel += Math.min(BLOC.production.max, BLOC.production.per * others)
      const role = b.roles[m]
      const pay = role ? BLOC.roleIncome[role] : null
      if (pay?.steel) n.resources.steel += pay.steel
      if (pay?.food) n.resources.food += pay.food
      if (pay?.tp) n.resources.tp += pay.tp
      if (m === leaderOf(f)) n.resources.pp += BLOC.leaderInfluence
    }
    // A member that went to war this month calls the others in.
    if (members.length > 1) {
      for (const m of members) {
        for (const e of enemiesOf(s, m).sort()) {
          if (f.members.includes(e) || s.warStarted[pairKey(m, e)] !== s.turn) continue
          if (members.every((x) => x === m || atWar(s, x, e))) continue
          openCall(s, map, f, m, e, true)
        }
      }
    }
    b.calls = b.calls.filter((c) => c.expires >= s.turn + 1 && s.nations[c.target]?.alive && f.members.includes(c.by))
    // The objective.
    if (b.goal) {
      const p = goalProgress(s, f, b.goal)
      if ((b.goal.kind === 'hold' || b.goal.kind === 'defend') && countries(s, b.goal.kind === 'defend' && b.goal.target ? [b.goal.target] : b.goal.members) < b.goal.base) b.goal.broken = true
      if (p.met) {
        b.done++
        for (const m of members) s.nations[m].resources.pp += BLOC.goalInfluence
        feed(s, f, `OBJECTIVE MET: ${goalTitle(s, b.goal)}. +${BLOC.goalPrestige} prestige, +${BLOC.goalInfluence} influence for every member.`, 'goal')
        gainXp(s, f, BLOC.goalPrestige, 'an objective met')
        delete b.goal
      } else if (s.turn >= b.goal.until || b.goal.broken) {
        b.failed++
        feed(s, f, `Objective missed: ${goalTitle(s, b.goal)} (${p.text}).`, 'goal')
        delete b.goal
      }
    }
    // A bloc without an objective takes the best fit for the new season (the leader can change it in the season's first month).
    if (!b.goal && members.length > 0) {
      const c = goalChoices(s, f)[0]
      // The season starts with the next month; the leader may change it in that month.
      if (c) startGoal(s, f, c.kind, c.target, s.turn + 1)
    }
    // An operation's army lost on the road (nowhere left to come home to) is over.
    for (const op of b.ops) if (op.status === 'marching' && !s.armies?.some((a) => a.op?.id === op.id)) {
      op.status = 'done'
      op.result ??= { won: false, captured: false, turn: s.turn, lead: op.by, bonus: 0, members: {}, failed: 'its army was lost' }
    }
    // Finished operations: the newest few are kept for their reports.
    const done = b.ops.filter((o) => o.status === 'done' || o.status === 'cancelled')
    const keep = new Set(done.slice(-BLOC.keepDone).map((o) => o.id))
    b.ops = b.ops.filter((o) => o.status === 'planned' || o.status === 'marching' || keep.has(o.id))
    // Pledges of members who left go with them.
    for (const op of b.ops) for (const m of Object.keys(op.pledges)) if (!f.members.includes(m)) delete op.pledges[m]
  }
}

// ---- old saves ----

/**
 * A save from before blocs: the common pool is shared back to the members by what each put in (the ledger), so nothing is lost;
 * contracts with the pool end and return their collateral; open votes are dropped; a pooled army on the march is dissolved (its
 * soldiers were the pool's copies, refunded above). Runs on load; a faction that has its `bloc` already is left alone.
 */
export function migrateBlocs(game: GameState) {
  if (!BLOC.on || !game.factions?.length) return
  for (const f of game.factions) {
    if (f.bloc) continue
    const alive = f.members.filter((m) => game.nations[m]?.alive)
    const refunded: string[] = []
    if (alive.length && f.pool && f.ledger) {
      const res = { money: 'capital', oil: 'oil', steel: 'steel', goods: 'goods', food: 'food' } as const
      for (const r of Object.keys(res) as (keyof typeof res)[]) {
        const have = f.pool.stock?.[r] ?? 0
        if (!(have > EPS)) continue
        const claims = alive.map((m) => Math.max(0, f.ledger[m]?.stock?.[r] ?? 0))
        const total = claims.reduce((a, c) => a + c, 0)
        alive.forEach((m, i) => (game.nations[m].resources[res[r]] += have * (total > EPS ? claims[i] / total : 1 / alive.length)))
        f.pool.stock[r] = 0
        refunded.push(r)
      }
      for (const k of UNIT_TYPES) {
        const have = f.pool.units?.[k] ?? 0
        if (!(have > EPS)) continue
        const claims = alive.map((m) => Math.max(0, f.ledger[m]?.units?.[k] ?? 0))
        const total = claims.reduce((a, c) => a + c, 0)
        alive.forEach((m, i) => (game.nations[m].military.units[k] += have * (total > EPS ? claims[i] / total : 1 / alive.length)))
        f.pool.units[k] = 0
        refunded.push(k)
      }
      for (const c of f.contracts ?? []) if (game.nations[c.member]?.alive) game.nations[c.member].resources.capital += c.held ?? 0
    }
    f.contracts = []
    f.proposals = []
    delete f.short
    for (const m of Object.keys(f.ledger ?? {})) {
      const l = f.ledger[m]
      for (const r of Object.keys(l.stock)) l.stock[r as keyof typeof l.stock] = 0
      for (const k of UNIT_TYPES) l.units[k] = 0
    }
    f.bloc = newBloc()
    f.history.push({ turn: game.turn, text: `${f.name} is now a bloc: the common pool was shared back to the members by what each put in${refunded.length ? '' : ' (it was empty)'}. Plan joint operations, take roles and chase the season's objective together.`, kind: 'member' })
  }
  // A pooled army on the march belonged to the pool, which has been shared out: it is dissolved.
  if (game.armies?.some((a) => a.faction)) game.armies = game.armies.filter((a) => !a.faction)
}

// ---- for the screen ----

/** Calls to arms a member still has to answer, and operations it could pledge to, for badges and the advisor. */
export function blocDue(s: GameState, id: NationId, pending: Order[] = []): number {
  if (!BLOC.on) return 0
  const f = factionOf(s, id)
  if (!f?.bloc) return 0
  const calls = f.bloc.calls.filter((c) => c.by !== id && !c.answers[id] && c.expires >= s.turn && !joinProblem(s, id, c.target) && !pending.some((o) => o.type === 'blocAnswer' && o.callId === c.id)).length
  const ops = f.bloc.ops.filter((o) => o.status === 'planned' && !o.pledges[id] && atWar(s, id, s.regions[o.target]?.owner ?? '') && !pending.some((p) => p.type === 'blocCommit' && p.opId === o.id)).length
  return calls + ops
}

/** What changed in the player's bloc since the month (or day) before, for toasts. */
export function blocNews(before: GameState | null, next: GameState, player: NationId): string[] {
  if (!BLOC.on) return []
  const out: string[] = []
  const f = factionOf(next, player)
  if (!f?.bloc) return out
  const was = before ? factionOf(before, player) : null
  const wb = was?.id === f.id ? was.bloc : undefined
  for (const c of f.bloc.calls) if (c.by !== player && !c.answers[player] && !wb?.calls.some((x) => x.id === c.id)) out.push(`Call to arms: ${next.nations[c.by]?.name ?? 'a member'} asks ${f.name} to join its war on ${next.nations[c.target]?.name ?? 'a country'}. Join or decline on the Bloc desk.`)
  for (const o of f.bloc.ops) {
    const old = wb?.ops.find((x) => x.id === o.id)
    if (!old && o.status === 'planned' && o.by !== player) out.push(`${next.nations[o.by]?.name ?? 'A member'} plans a bloc operation. Pledge divisions on the Bloc desk.`)
    if (o.result && !old?.result && !o.result.failed) out.push(`Bloc operation: ${o.result.captured ? 'country captured' : o.result.won ? 'battle won' : 'repulsed'}. See the report on the Bloc desk.`)
  }
  if (wb && levelOf(f.bloc.xp) > levelOf(wb.xp)) out.push(`${f.name} reached level ${levelOf(f.bloc.xp)}: a new perk is unlocked.`)
  if (wb && f.bloc.done > wb.done) out.push(`${f.name} met its objective.`)
  return out
}

/** A bloc order as a line of words, for the order tray and the log. */
export function describeBlocOrder(s: GameState, map: WorldMap, o: BlocOrder): string {
  const f = factionOf(s, o.nationId)
  switch (o.type) {
    case 'blocRole':
      return o.role ? `Become the bloc's ${ROLES.find((r) => r.id === o.role)?.name ?? o.role}` : 'Give up your bloc role'
    case 'blocGoal':
      return `Set the bloc's objective: ${goalTitle(s, { kind: o.goal, target: o.target })}`
    case 'blocCall':
      return `Call the bloc to arms against ${nm(s, o.target)}`
    case 'blocAnswer': {
      const c = blocOf(f).calls.find((x) => x.id === o.callId)
      return `${o.join ? 'Join' : 'Decline'} the call to arms${c ? ` against ${nm(s, c.target)}` : ''}`
    }
    case 'blocPlan':
      return `Plan a bloc operation on ${map.regions[o.target]?.name ?? o.target}`
    case 'blocCommit': {
      const op = blocOf(f).ops.find((x) => x.id === o.opId)
      const n = totalUnits(cleanUnits(o.units))
      return n > 0 ? `Pledge ${n.toFixed(1)} divisions to the operation${op ? ` on ${map.regions[op.target]?.name ?? op.target}` : ''}` : 'Withdraw your pledge'
    }
    case 'blocCancel':
      return 'Call off a bloc operation'
    case 'blocChat':
      return 'Write to the bloc'
  }
}
