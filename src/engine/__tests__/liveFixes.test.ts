import { describe, expect, it } from 'vitest'
import { daysInMonth } from '../calendar'
import { advanceDay, startLive, type LiveEvent } from '../live'
import { homePower, militaryPower } from '../militaryStats'
import { isMonthEndOrder } from '../orders'
import { applyOrderNow } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)
const none = () => []

/** r0 (the player) is at war with its neighbor r1. */
function war() {
  const s = startLive(startState(map))
  s.wars.push('r0|r1')
  s.nations.r0.resources.capital = 3000
  setMilitary(s, 'r0', { infantry: 20, armor: 6, artillery: 4 })
  setMilitary(s, 'r1', { infantry: 2 })
  s.regions.r1.line = 3
  return s
}
const attack = (extra: Partial<Extract<Order, { type: 'attack' }>> = {}, target = 'r1'): Order => ({ type: 'attack', nationId: 'r0', target, commit: 'main', stance: 'assault', ...extra })

function run(s: GameState, days: number) {
  const events: LiveEvent[] = []
  for (let i = 0; i < days; i++) {
    const step = advanceDay(s, map, { planner: none })
    s = step.state
    events.push(...step.events)
  }
  return { s, events }
}

/** Moves to the last day of the month. */
function toMonthEnd(s: GameState) {
  return run(s, daysInMonth(s.turn) - 1 - (s.day ?? 0)).s
}

describe('strength counts armies in the field', () => {
  it('a nation with its army abroad is as strong as before for diplomacy, but weaker at home', () => {
    const s = war()
    const before = militaryPower(s, 'r0')
    applyOrderNow(s, map, attack())
    expect(militaryPower(s, 'r0')).toBeCloseTo(before)
    expect(homePower(s, 'r0')).toBeLessThan(before * 0.5)
  })

  it('in a turn game the two are the same', () => {
    const s = startState(map)
    expect(homePower(s, 'r0')).toBe(militaryPower(s, 'r0'))
  })
})

describe('the month turning over', () => {
  it('news written as the month turns over carries the 1st of the new month', () => {
    let s = toMonthEnd(war())
    s = advanceDay(s, map, { planner: none }).state
    expect(s.day).toBe(0)
    for (const e of s.log.filter((x) => x.turn === s.turn)) expect(e.day).toBe(0)
  })

  it('a decision that comes with the new month holds the 1st until it is answered', () => {
    let s = war()
    s.nextEventTurn = 2
    s.humans = ['r0']
    // An army that arrives on the 1st must wait for the decision.
    s = toMonthEnd(s)
    s.armies = []
    applyOrderNow(s, map, attack())
    const army = s.armies![0]
    army.end = (s.armies![0].start = Math.ceil(army.end) - 10) + 1
    const turned = advanceDay(s, map, { planner: none })
    expect(turned.state.pendingEvent).toBeTruthy()
    expect(turned.state.pendingDay).toBeDefined()
    expect(turned.events.filter((e) => e.kind === 'battle')).toEqual([])
    // Nothing moves while the decision waits.
    expect(advanceDay(turned.state, map, { planner: none }).state).toBe(turned.state)
    const answered = { ...turned.state, pendingEvent: null }
    const next = advanceDay(answered, map, { planner: none })
    expect(next.state.pendingDay).toBeUndefined()
    expect(next.state.day).toBe(0)
  })

  it('a game won at the end of a month stays won', () => {
    let s = toMonthEnd(war())
    s.settings.victoryShare = 0
    const step = advanceDay(s, map, { planner: none })
    expect(step.monthEnded).toBe(true)
    expect(step.state.outcome).not.toBe('playing')
    s = step.state
    expect(advanceDay(s, map, { planner: none }).state).toBe(s)
  })
})

describe('why an army turns back', () => {
  it('another nation taking the target is not "the war is over"', () => {
    const s = war()
    applyOrderNow(s, map, attack())
    expect(s.armies![0].foe).toBe('r1')
    // r2 takes r1 while the army marches; r0 is not at war with r2.
    s.regions.r1.owner = 'r2'
    const { events } = run(s, 1)
    const back = events.find((e) => e.kind === 'turnedBack')
    expect(back && back.kind === 'turnedBack' && back.why).toBe('changed')
  })

  it('peace turns it back as peace', () => {
    const s = war()
    applyOrderNow(s, map, attack())
    s.wars = []
    const { events } = run(s, 1)
    const back = events.find((e) => e.kind === 'turnedBack')
    expect(back && back.kind === 'turnedBack' && back.why).toBe('peace')
  })

  it('an army whose launch country fell on the way cannot fight and comes home', () => {
    const s = war()
    s.regions.r2.owner = 'r0'
    applyOrderNow(s, map, attack())
    const a = s.armies![0]
    // The country it set out from falls to the enemy while it marches.
    s.regions[a.home].owner = 'r1'
    const { events } = run(s, 10)
    expect(events.some((e) => e.kind === 'battle')).toBe(false)
    const back = events.find((e) => e.kind === 'turnedBack')
    expect(back && back.kind === 'turnedBack' && back.why).toMatch(/cut|changed/)
  })
})

describe('live rules', () => {
  it('an offer reaches a rival at once in a live game and waits for the month in a turn game', () => {
    expect(isMonthEndOrder(war(), 'propose')).toBe(false)
    expect(isMonthEndOrder(startState(map), 'propose')).toBe(true)
  })

  it('a rival answers an offer of peace the moment it is made', () => {
    const s = war()
    s.nations.r0.resources.pp = 100
    const res = applyOrderNow(s, map, { type: 'propose', nationId: 'r0', target: 'r1', proposal: { kind: 'peace', terms: { cede: [], reparations: 0 } } })
    expect(res.error).toBeNull()
    expect(s.dispatches.some((d) => d.from === 'r1' && d.to === 'r0')).toBe(true)
  })

  it('the AI pays for a Blitz when its planned attack leaves', () => {
    const s = war()
    setMilitary(s, 'r1', { infantry: 20, armor: 10 })
    s.nations.r1.resources.capital = 100
    s.launches = [{ id: 'l1', at: 1, order: { type: 'attack', nationId: 'r1', target: 'r0', commit: 'main', stance: 'blitz' } }]
    const { s: after } = run(s, 1)
    expect(after.armies!.some((a) => a.nationId === 'r1')).toBe(true)
    expect(after.nations.r1.resources.capital).toBeCloseTo(100 - 8)
  })
})
