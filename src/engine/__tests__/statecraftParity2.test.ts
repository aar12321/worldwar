import { describe, expect, it } from 'vitest'
import { daysInMonth } from '../calendar'
import { advanceDay, startLive } from '../live'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { checkInvariants } from './invariants'
import { giveRegions, lineMap, startState } from './fixtures'

const map = lineMap(10, { 3: 'mountain' })
map.regions.r5.coastal = true

const stripped = (s: GameState) => {
  const copy = JSON.parse(JSON.stringify(s))
  for (const k of ['day', 'armies', 'launches', 'flights', 'pendingDay']) delete copy[k]
  delete copy.settings.mode
  // A live log entry also says which day of the month it happened.
  for (const e of copy.log) delete e.day
  return copy
}

function liveMonths(s: GameState, months: number, monthOrders: (turn: number) => Order[]) {
  const target = s.turn + months
  while (s.turn < target) {
    const last = (s.day ?? 0) >= daysInMonth(s.turn) - 1
    s = advanceDay(s, map, { monthOrders: last ? monthOrders(s.turn) : undefined, planner: () => [] }).state
  }
  return s
}

/** The programs, campaigns, projects (national and in a country), rushes and the missile program, as one nation's orders. */
const O = 'r0'
const prepare = (s: GameState) => {
  const orders: Order[] = [
    { type: 'setSocial', nationId: O, policy: 'courts', level: 1 },
    { type: 'setSocial', nationId: O, policy: 'transit', level: 2 },
    { type: 'setSocial', nationId: O, policy: 'festivals', level: 1 },
    { type: 'campaign', nationId: O, campaign: 'celebration' },
    { type: 'campaign', nationId: O, campaign: 'literacy' },
    { type: 'startProject', nationId: O, project: 'rail' },
    { type: 'startProject', nationId: O, project: 'culturalCentre', regionId: 'r1' },
    { type: 'startProject', nationId: O, project: 'irrigation', regionId: 'r2' },
    { type: 'rushProject', nationId: O, project: 'rail' },
    { type: 'rushProject', nationId: O, project: 'irrigation', regionId: 'r2' },
    { type: 'fundMissiles', nationId: O },
    { type: 'fundMissiles', nationId: O },
    { type: 'buildMissiles', nationId: O, kind: 'cruise', count: 4 },
    { type: 'buildMissiles', nationId: O, kind: 'tactical', count: 3 },
  ]
  for (const o of orders) expect(applyOrderNow(s, map, o).error, JSON.stringify(o)).toBeNull()
  return s
}

describe('turn and live months agree for programs, projects, rushes and missiles', () => {
  it('ten months with the same orders give the same game, and every number stays in range', () => {
    const base = startState(map, O, 6)
    giveRegions(base, O, ['r1', 'r2'])
    const n = base.nations[O]
    n.resources.capital = 6000
    n.resources.pp = 300
    n.resources.tp = 300
    n.resources.steel = 300
    // Month-end orders (none of these are) would apply on the 1st in both modes; a rush each of the next months is a plain order.
    const monthly = (turn: number): Order[] => (turn === 2 ? [{ type: 'setSocial', nationId: O, policy: 'courts', level: 0 }] : [])
    let turn = prepare(structuredClone(base))
    for (let i = 0; i < 10; i++) turn = resolveTurn(turn, map, monthly(turn.turn))
    const live = liveMonths(prepare(startLive(structuredClone(base))), 10, monthly)
    expect(live.turn).toBe(turn.turn)
    expect(stripped(live)).toEqual(stripped(turn))
    checkInvariants(turn)
    checkInvariants(live)
    // And something did happen: the program phased in, the project finished, the stock is there.
    expect(turn.nations[O].arsenal).toEqual({ cruise: 4, tactical: 3 })
    expect(turn.regions.r1.works?.culturalCentre?.done).toBe(true)
  })
})
