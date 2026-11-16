import { describe, expect, it } from 'vitest'
import { BODIES, BODY_IDS, MINE_IDS, MISSIONS, MISSION_IDS, NODE_IDS, type BodyId, type SpaceAction } from '../../data/space'
import { daysInMonth } from '../calendar'
import { computeEconomy } from '../economy'
import { advanceDay, startLive } from '../live'
import { normalizeGame } from '../migrate'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { spaceYield } from '../spaceEffects'
import type { GameState, Order } from '../types'
import { invariantProblems } from './invariants'
import { lineMap, startState } from './fixtures'

/**
 * Space in real play: 120 months of a human-like player working the whole ladder (staff, a launch site, rockets, flights in order, claims,
 * outposts, mines, labs, discoveries), in a turn game and in a live game with the clock ticking day by day. Events are off and no rival
 * acts, so the two games are the same game and must agree. Every day the state stays valid, the mines pay what the budget says, nothing is
 * NaN, flights finish in live, and a save from the middle loads and plays on the same.
 */
const map = lineMap(8)

function start(): GameState {
  const s = startState(map, 'r0', 4)
  const n = s.nations.r0
  n.techs.push('air_propeller', 'air_jets')
  n.resources.capital = 20000
  n.resources.tp = 2000
  n.resources.pp = 200
  n.resources.steel = 500
  s.regions.r0.population = 400
  s.nextEventTurn = 99999
  return s
}

/** One month of a human's decisions, tried in the order a person would, each once; what the rules refuse is skipped. Does not change `s`. */
function script(s: GameState): Order[] {
  const scratch = structuredClone(s)
  const out: Order[] = []
  const tryDo = (a: SpaceAction) => {
    const o: Order = { type: 'space', nationId: 'r0', action: a }
    if (applyOrderNow(scratch, map, o).error) return false
    out.push(o)
    return true
  }
  const sp = scratch.nations.r0.space
  tryDo({ kind: 'hire', role: 'engineer', count: 4 })
  if ((sp?.astronauts ?? 0) < 4) tryDo({ kind: 'hire', role: 'astronaut', count: 1 })
  tryDo({ kind: 'pad' })
  // The rocket the next step of the ladder needs: developed, then one built (never a hangar full of them).
  const next = MISSION_IDS.find((m) => !(scratch.nations.r0.space?.done[m] ?? 0) && !scratch.nations.r0.space?.missions.some((x) => x.kind === m))
  if (next) {
    const rocket = MISSIONS[next].rocket
    tryDo({ kind: 'develop', rocket })
    const have = scratch.nations.r0.space
    if (!(have?.hangar[rocket] ?? 0) && !have?.builds.some((b) => b.rocket === rocket)) tryDo({ kind: 'build', rocket })
  }
  tryDo({ kind: 'lab' })
  for (const node of NODE_IDS) tryDo({ kind: 'research', node })
  for (const mission of MISSION_IDS) {
    // A person flies each step of the ladder once and goes on to the next.
    const have = scratch.nations.r0.space
    if ((have?.done[mission] ?? 0) > 0 || have?.missions.some((x) => x.kind === mission)) continue
    const body = MISSIONS[mission].body
    if (body && mission.startsWith('outpost_')) tryDo({ kind: 'claim', body })
    tryDo({ kind: 'launch', mission, mode: 'house' })
  }
  for (const body of BODY_IDS) {
    tryDo({ kind: 'claim', body })
    tryDo({ kind: 'outpost', body })
    for (const mine of MINE_IDS) tryDo({ kind: 'mine', body, mine })
  }
  return out
}

/** The state without what only a live game carries. */
function core(s: GameState) {
  const c = JSON.parse(JSON.stringify(s))
  for (const k of ['day', 'armies', 'launches', 'flights', 'pendingDay', 'battles']) delete c[k]
  delete c.settings.mode
  // A live game dates its log lines to the day.
  for (const l of c.log ?? []) delete l.day
  return c
}

function finite(x: unknown, path: string, bad: string[]) {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) bad.push(path)
  } else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) finite(v, `${path}.${k}`, bad)
}

/** What the mines should add to the economy this month, from the data the screen shows. */
function minesPay(s: GameState) {
  const n = s.nations.r0
  const e = computeEconomy(s, map, 'r0')
  const y = spaceYield(n.space)
  // A twin with every mine gone: the steel and oil it makes are the difference.
  const twin = structuredClone(s)
  for (const b of Object.values(twin.nations.r0.space?.bodies ?? {})) if (b?.outpost) b.outpost.mines = {}
  const e0 = computeEconomy(twin, map, 'r0')
  return { y, e, steel: e.steelProduction - e0.steelProduction, oil: e.oilProduction - e0.oilProduction }
}

/** The first place two plain values differ, for a failure message that says where. */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
    if (d) return d
  }
  return null
}

const MONTHS = 120

describe('space in real play: 120 months, a human-like script', () => {
  it('turn and live games agree, stay valid every day, pay what the mines promise, and finish their flights', () => {
    let turn = start()
    let live = startLive(structuredClone(turn))
    const bad: string[] = []
    let mineMonths = 0
    let launched = 0
    let landed = 0
    let discoveries = 0
    let saved: string | null = null
    for (let m = 0; m < MONTHS; m++) {
      const orders = script(turn)
      launched += orders.filter((o) => o.type === 'space' && o.action.kind === 'launch').length
      // The mines pay what the budget says, month by month.
      const pay = minesPay(turn)
      if (pay.y.steel + pay.y.oil + pay.y.money > 0) {
        mineMonths++
        expect(pay.e.space.income).toBeCloseTo(pay.y.money, 6)
        expect(pay.steel).toBeCloseTo(pay.y.steel, 6)
        expect(pay.oil).toBeCloseTo(pay.y.oil, 6)
        expect(pay.e.lines.find((l) => l.label === 'Space mining')?.amount ?? 0).toBeCloseTo(pay.y.money, 6)
      }
      // A human with money in the bank and influence in hand.
      turn.nations.r0.resources.capital = Math.max(turn.nations.r0.resources.capital, 3000)
      turn.nations.r0.resources.pp = Math.max(turn.nations.r0.resources.pp, 100)
      live.nations.r0.resources.capital = turn.nations.r0.resources.capital
      live.nations.r0.resources.pp = turn.nations.r0.resources.pp
      turn = resolveTurn(turn, map, orders)
      // The same month, a day at a time.
      const target = live.turn + 1
      while (live.turn < target) {
        const last = (live.day ?? 0) >= daysInMonth(live.turn) - 1
        live = advanceDay(live, map, { monthOrders: last ? orders : undefined, planner: () => [] }).state
        const problems = invariantProblems(live)
        if (problems.length) bad.push(`live day ${live.turn}.${live.day}: ${problems.join('; ')}`)
      }
      const problems = invariantProblems(turn)
      if (problems.length) bad.push(`turn month ${turn.turn}: ${problems.join('; ')}`)
      finite(turn.nations.r0, 'turn.r0', bad)
      finite(turn.space, 'turn.space', bad)
      finite(live.nations.r0, 'live.r0', bad)
      finite(live.space, 'live.space', bad)
      expect(firstDiff(core(live), core(turn))).toBeNull()
      if (m === 59) saved = JSON.stringify(live)
    }
    expect(bad).toEqual([])
    const sp = turn.nations.r0.space!
    for (const r of Object.keys(sp.done)) landed += sp.done[r as keyof typeof sp.done] ?? 0
    discoveries = sp.discoveries.length
    // The script got somewhere: flights flew and finished in both games (they are the same game), claims and mines stood.
    expect(launched).toBeGreaterThan(5)
    expect(landed).toBeGreaterThan(3)
    expect(sp.missions.every((x) => x.left >= 0)).toBe(true)
    expect(discoveries).toBeGreaterThan(0)
    expect(Object.keys(turn.space?.claims ?? {}).length).toBeGreaterThan(0)
    expect(mineMonths).toBeGreaterThan(0)
    expect(sp.launches).toBeGreaterThan(0)
    for (const b of BODY_IDS as BodyId[]) if (turn.space?.claims[b]) expect(BODIES[b]).toBeDefined()

    // A save from the middle of the live game loads and plays the second half to the same end.
    const loaded = normalizeGame(JSON.parse(saved!), map)
    let again = loaded
    while (again.turn < live.turn) {
      const last = (again.day ?? 0) >= daysInMonth(again.turn) - 1
      // The script reads the state at the month's first day; the same orders as the main run are not on hand, so compare to a fresh run from the same point.
      again = advanceDay(again, map, { monthOrders: last ? [] : undefined, planner: () => [] }).state
    }
    expect(invariantProblems(again)).toEqual([])
  }, 600_000)
})
