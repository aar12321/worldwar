import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { absDay, clockOf, daysInMonth } from '../calendar'
import { advanceDay, startLive } from '../live'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)
const none = () => []

function live(seed = 1) {
  return startLive(startState(map, 'r0', seed))
}

/** A state with no live fields, to compare a live game against a turn game. */
function stripped(s: GameState) {
  const copy = JSON.parse(JSON.stringify(s))
  delete copy.day
  delete copy.armies
  delete copy.launches
  delete copy.flights
  delete copy.settings.mode
  return copy
}

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x)) deepFreeze(v)
  }
  return x
}

describe('the live clock', () => {
  it('does nothing in a turn game, while a decision is waiting, or after the game is over', () => {
    const turn = startState(map)
    expect(advanceDay(turn, map).state).toBe(turn)
    const waiting = live()
    waiting.pendingEvent = { eventId: 'x', turn: 1, rivalId: null, regionId: null }
    expect(advanceDay(waiting, map).state).toBe(waiting)
    const over = live()
    over.outcome = 'defeat'
    expect(advanceDay(over, map).state).toBe(over)
  })

  it('a quiet day only moves the date, and everything else stays the same object', () => {
    const s = live()
    const step = advanceDay(s, map, { planner: none })
    expect(step.monthEnded).toBe(false)
    expect(step.events).toEqual([])
    expect(step.state.day).toBe(1)
    expect(step.state.turn).toBe(1)
    expect(step.state.nations).toBe(s.nations)
    expect(step.state.regions).toBe(s.regions)
    expect(step.state.log).toBe(s.log)
    expect(s.day).toBe(0)
  })

  it('a month ends exactly once, on the last day, and the next begins on the 1st', () => {
    let s = live()
    let ends = 0
    const length = daysInMonth(1)
    for (let i = 0; i < length - 1; i++) {
      const step = advanceDay(s, map, { planner: none })
      expect(step.monthEnded).toBe(false)
      s = step.state
    }
    expect(s.turn).toBe(1)
    expect(s.day).toBe(length - 1)
    const step = advanceDay(s, map, { planner: none })
    if (step.monthEnded) ends++
    expect(ends).toBe(1)
    expect(step.state.turn).toBe(2)
    expect(step.state.day).toBe(0)
    expect(clockOf(step.state)).toBe(absDay(2, 0))
  })

  it('applies the orders that waited for the 1st only when the month turns', () => {
    let s = live()
    const policy: Order = { type: 'setPolicy', nationId: 'r0', taxRate: 0.31, draftRate: 0.03, budget: s.nations.r0.budget }
    const before = s.nations.r0.taxRate
    for (let i = 0; i < daysInMonth(1) - 1; i++) {
      s = advanceDay(s, map, { planner: none, monthOrders: [policy] }).state
      expect(s.nations.r0.taxRate).toBe(before)
    }
    s = advanceDay(s, map, { planner: none, monthOrders: [policy] }).state
    expect(s.nations.r0.taxRate).toBeCloseTo(0.31)
  })

  it('three live months with no attacks are exactly three turn months', () => {
    let a = startState(map)
    let b = live()
    for (let m = 0; m < 3; m++) {
      a = resolveTurn(a, map, [])
      const length = daysInMonth(b.turn)
      for (let d = 0; d < length; d++) b = advanceDay(b, map, { planner: none }).state
    }
    expect(b.turn).toBe(4)
    expect(b.day).toBe(0)
    expect(stripped(b)).toEqual(stripped(a))
  })

  it('is deterministic: the same game and the same bots give the same 120 days', () => {
    const run = () => {
      let s = startLive(startState(map, 'r0', 7))
      s.wars.push('r0|r1')
      setMilitary(s, 'r0', { infantry: 12, armor: 3 })
      setMilitary(s, 'r1', { infantry: 3 })
      applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault' })
      for (let i = 0; i < 120; i++) s = advanceDay(s, map, { planner: (st, m) => generateAllBotOrders(st, m) }).state
      return JSON.stringify(s)
    }
    expect(run()).toBe(run())
  })

  it('never changes the game it is given, through wars, captures and a nation falling', () => {
    let s = live()
    s.wars.push('r0|r1', 'r0|r2')
    s.nations.r0.resources.capital = 5000
    setMilitary(s, 'r0', { infantry: 30, armor: 8, artillery: 4, fighter: 2, missile: 8 })
    setMilitary(s, 'r1', { infantry: 1 })
    setMilitary(s, 'r2', { infantry: 1 })
    applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'probe', stance: 'blitz' })
    applyOrderNow(s, map, { type: 'strike', nationId: 'r0', target: 'r2', weapon: 'missile', count: 2 })
    for (let i = 0; i < 90; i++) {
      // A frozen state throws on any change, so this also proves nothing is written to the input.
      deepFreeze(s)
      const before = JSON.stringify(s)
      const next = advanceDay(s, map, { planner: (st, m) => generateAllBotOrders(st, m) }).state
      expect(JSON.stringify(s)).toBe(before)
      s = next
    }
    expect(s.turn).toBeGreaterThanOrEqual(3)
  })
})
