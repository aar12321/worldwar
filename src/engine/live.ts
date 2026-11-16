import { armiesToRecall, holdsBackLaunch } from '../ai/liveBot'
import { LIVE } from '../data/live'
import { bringHome, calledOff, sendHome, turnBack, launchArmy } from './armies'
import { absDay, clockOf, daysInMonth, isLive } from './calendar'
import { atWar, newId, totalUnits } from './helpers'
import { orderCost, validateOrder } from './orders'
import { runMonth } from './resolveTurn'
import { createRng } from './rng'
import { interception } from './deployment'
import { strikeHits } from './systems'
import type { Army, ArmyOutcome, AttackOrder, BattleReport, GameState, MissileFlight, NationId, Order, RegionId, TrainingJob, Via, WorldMap } from './types'
import { checkOutcome } from './victory'
import { resolveAttack } from './warfare'

/** Plans the AI's orders for the month about to begin. The live clock calls it once a month, on the last day. */
export type BotPlanner = (s: GameState, map: WorldMap) => Order[]

export interface LiveInput {
  /** Orders that were waiting for the 1st. Only used when the month ends. */
  monthOrders?: Order[]
  planner?: BotPlanner
}

/** What happened on a day, for the screen to show. The state itself already holds the result. */
export type LiveEvent =
  | { kind: 'launched'; army: Army }
  | { kind: 'battle'; report: BattleReport; armyId: string; destroyed: boolean }
  | { kind: 'turnedBack'; army: Army; why: ArmyOutcome }
  | { kind: 'home'; army: Army }
  /** `why` says what happened to a salvo that did not land on an enemy: the country was already its own, changed hands, or the war ended. */
  | { kind: 'missile'; flight: MissileFlight; landed: boolean; why?: 'taken' | 'changed' | 'peace' }
  | { kind: 'trained'; jobs: TrainingJob[] }
  /** The defender's patrols sighted a landing force setting out for its coast: early warning, with the share they expect to sink. */
  | { kind: 'contact'; army: Army; watcher: NationId; expected: number }
  /** The defender's patrols met a landing at sea and sank part of it. The battle that follows is in `battle`. */
  | { kind: 'intercept'; battleId: string; by: NationId; against: NationId; place: RegionId; sunk: number; via: Via }

export interface LiveStep {
  state: GameState
  events: LiveEvent[]
  /** True on the day the month turned over. */
  monthEnded: boolean
}

/** Turns a game into a live game, starting on the first of its month. */
export function startLive(s: GameState): GameState {
  s.settings.mode = 'live'
  s.day = 0
  s.armies = []
  s.launches = []
  s.flights = []
  return s
}

const byDue = (a: { id: string }, b: { id: string }, x: number, y: number) => x - y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The AI's attacks for the new month leave on days of its first two weeks, the same days on every screen. */
function planLaunches(s: GameState, attacks: AttackOrder[]) {
  if (attacks.length === 0) return
  const rng = createRng((s.seed ^ LIVE.salt) >>> 0, -s.turn)
  const list = (s.launches ??= [])
  for (const order of attacks) list.push({ id: newId(s, 'l'), at: absDay(s.turn, rng.int(LIVE.launchWindow[0], LIVE.launchWindow[1])), order })
}

/** Whether anything needs doing on this day. A quiet day only moves the date. */
function dueToday(s: GameState, map: WorldMap, today: number): boolean {
  if (s.launches?.some((l) => l.at <= today)) return true
  if (s.flights?.some((f) => f.lands <= today)) return true
  for (const a of s.armies ?? []) {
    if (a.end <= today) return true
    if (a.phase === 'outbound' && calledOff(s, a)) return true
  }
  // A rival that sees an army marching on it, even one the player sent between ticks, acts today.
  return armiesToRecall(s, map, today).length > 0
}

/** Everything that comes due on a day, in a fixed order. Mutates `s`, which the caller owns. */
function processDay(s: GameState, map: WorldMap, today: number, events: LiveEvent[]) {
  const rng = createRng((s.seed ^ LIVE.salt) >>> 0, today)
  const snapshot = (a: Army): Army => structuredClone(a)
  let fought = false

  // 1. Attacks the AI planned leave today, if they still make sense.
  if (s.launches?.some((l) => l.at <= today)) {
    const due = s.launches.filter((l) => l.at <= today).sort((a, b) => byDue(a, b, a.at, b.at))
    s.launches = s.launches.filter((l) => l.at > today)
    for (const l of due) {
      if (!s.nations[l.order.nationId]?.alive || validateOrder(s, map, l.order)) continue
      // A rival that is about to be attacked keeps its army at home.
      if (holdsBackLaunch(s, map, l.order.nationId)) continue
      // The AI pays for its stance, as the player does.
      const cost = orderCost(s, l.order).capital
      const army = launchArmy(s, map, l.order, today)
      if (!army) continue
      s.nations[l.order.nationId].resources.capital -= cost
      events.push({ kind: 'launched', army: snapshot(army) })
      // A nation whose patrols watch its waters sights a landing force the day it sets out.
      const watcher = s.regions[army.target]?.owner
      if (army.bySea && watcher && s.nations[watcher]?.military.deployment) {
        const expected = interception(s, watcher, army.via, army.units).share
        if (expected > 0) events.push({ kind: 'contact', army: snapshot(army), watcher, expected })
      }
    }
  }

  // 2. An army whose reason has gone turns back: the war ended, the country is already its own, or someone else took it.
  for (const a of [...(s.armies ?? [])].sort((x, y) => byDue(x, y, 0, 0))) {
    if (a.phase !== 'outbound') continue
    const why = calledOff(s, a)
    if (!why) continue
    const before = snapshot(a)
    turnBack(s, map, a, today, why)
    events.push({ kind: 'turnedBack', army: { ...before, outcome: why }, why })
  }

  // 2b. A rival whose country is about to be overrun calls its strongest army home.
  for (const id of armiesToRecall(s, map, today)) {
    const a = s.armies?.find((x) => x.id === id)
    if (!a || a.phase !== 'outbound') continue
    const before = snapshot(a)
    turnBack(s, map, a, today, 'recalled')
    events.push({ kind: 'turnedBack', army: { ...before, outcome: 'recalled' }, why: 'recalled' })
  }

  // 3. Armies that have marched all the way fight.
  const arriving = (s.armies ?? []).filter((a) => a.phase === 'outbound' && a.end <= today).sort((x, y) => byDue(x, y, x.end, y.end))
  for (const a of arriving) {
    // An earlier fight today may have ended this army's nation.
    if (!s.armies?.some((x) => x.id === a.id)) continue
    // An earlier army may have taken the country today, or the country it set out from may have fallen while it marched.
    const why: ArmyOutcome | null = calledOff(s, a) ?? (s.regions[a.home]?.owner !== a.nationId ? 'cut' : null)
    const result = why ? null : resolveAttack(s, map, a.nationId, a.target, rng, a.commit, a.stance, undefined, a)
    if (!result) {
      // It cannot fight after all: it marches back from where it stands.
      const reason = why ?? 'peace'
      const before = snapshot(a)
      a.outcome = reason
      sendHome(s, map, a, today)
      events.push({ kind: 'turnedBack', army: { ...before, outcome: reason }, why: reason })
      continue
    }
    fought = true
    const report = result.report
    a.battleId = report.id
    a.outcome = report.captured ? 'captured' : report.winner === 'attacker' ? 'won' : 'repulsed'
    const destroyed = totalUnits(a.units) < 0.05
    events.push({ kind: 'battle', report, armyId: a.id, destroyed })
    if (report.intercept) events.push({ kind: 'intercept', battleId: report.id, by: report.intercept.by, against: a.nationId, place: a.target, sunk: report.intercept.sunk, via: report.intercept.via })
    if (destroyed) {
      s.armies = (s.armies ?? []).filter((x) => x.id !== a.id)
    } else {
      a.phase = 'fighting'
      a.from = { ...a.to }
      a.start = today
      a.end = today + LIVE.battleDays
    }
  }

  // 4. Armies that have finished fighting set out for home.
  for (const a of (s.armies ?? []).filter((x) => x.phase === 'fighting' && x.end <= today).sort((x, y) => byDue(x, y, x.end, y.end))) sendHome(s, map, a, today)

  // 5. Armies that have reached home rejoin the military.
  for (const a of (s.armies ?? []).filter((x) => x.phase === 'returning' && x.end <= today).sort((x, y) => byDue(x, y, x.end, y.end))) {
    const before = snapshot(a)
    bringHome(s, a)
    events.push({ kind: 'home', army: before })
  }

  // 6. Missiles land.
  if (s.flights?.some((f) => f.lands <= today)) {
    const landing = s.flights.filter((f) => f.lands <= today).sort((a, b) => byDue(a, b, a.lands, b.lands))
    s.flights = s.flights.filter((f) => f.lands > today)
    for (const f of landing) {
      const owner = s.regions[f.target]?.owner
      const hits = !!s.nations[f.nationId]?.alive && !!owner && owner !== f.nationId && !!s.nations[owner]?.alive && atWar(s, f.nationId, owner)
      if (hits) {
        strikeHits(s, map, f.nationId, f.target, f.count, f.kind ?? 'hypersonic')
        fought = true
        events.push({ kind: 'missile', flight: { ...f }, landed: true })
      } else {
        const why = owner === f.nationId ? 'taken' : !owner || !s.nations[owner]?.alive || (f.foe && owner !== f.foe) ? 'changed' : 'peace'
        events.push({ kind: 'missile', flight: { ...f }, landed: false, why })
      }
    }
  }

  if (fought) s.outcome = checkOutcome(s, map)
}

/**
 * Moves a live game on by one day. Pure: `prev` is never changed.
 *
 * On the last day of a month the month turns over exactly as a turn game's does: orders waiting for the 1st apply, the AI plans,
 * the economy and politics run, and the AI's attacks are set to leave on days of the new month. On any other day nothing but
 * armies, missiles and planned launches moves, and a day with none of those due only changes the date.
 */
export function advanceDay(prev: GameState, map: WorldMap, input: LiveInput = {}): LiveStep {
  if (!isLive(prev) || prev.outcome !== 'playing' || prev.pendingEvent) return { state: prev, events: [], monthEnded: false }
  const day = prev.day ?? 0
  const events: LiveEvent[] = []

  // The 1st of the month waited for a decision. Now that it is made, the day's business runs before the clock moves on.
  if (prev.pendingDay !== undefined) {
    const s = structuredClone(prev)
    const at = s.pendingDay!
    delete s.pendingDay
    s.battles = []
    processDay(s, map, at, events)
    return { state: s, events, monthEnded: false }
  }

  if (day >= daysInMonth(prev.turn) - 1) {
    const s = structuredClone(prev)
    // For the month's work the clock already reads the 1st of the next month, so missiles fired by the AI count from then.
    s.day = daysInMonth(s.turn)
    const bots = input.planner ? input.planner(s, map) : []
    const { attacks, trained } = runMonth(s, map, [...(input.monthOrders ?? []), ...bots])
    s.day = 0
    planLaunches(s, attacks)
    if (trained.length) events.push({ kind: 'trained', jobs: trained })
    // A game won or lost at the month's end stays that way, and a decision that came with the month is answered first.
    if (s.outcome !== 'playing') return { state: s, events, monthEnded: true }
    if (s.pendingEvent) {
      s.pendingDay = clockOf(s)
      return { state: s, events, monthEnded: true }
    }
    processDay(s, map, clockOf(s), events)
    return { state: s, events, monthEnded: true }
  }

  const today = absDay(prev.turn, day + 1)
  if (!dueToday(prev, map, today)) return { state: { ...prev, day: day + 1, ...(prev.battles.length ? { battles: [] } : {}) }, events, monthEnded: false }
  const s = structuredClone(prev)
  s.day = day + 1
  s.battles = []
  processDay(s, map, today, events)
  return { state: s, events, monthEnded: false }
}
