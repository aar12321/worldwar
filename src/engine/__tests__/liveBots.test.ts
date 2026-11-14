import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { LIVE } from '../../data/live'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { absDay, daysInMonth } from '../calendar'
import { applyEventChoice } from '../events'
import { advanceDay, type LiveEvent } from '../live'
import { resolveTurn } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'
import { startLive } from '../live'

const map = lineMap(6)

/** r1 is an AI at war with the player's r0, and has a mind to attack. */
function front() {
  const s = startLive(startState(map))
  s.wars.push('r0|r1')
  setMilitary(s, 'r1', { infantry: 14, armor: 4 })
  setMilitary(s, 'r0', { infantry: 3 })
  return s
}
const plan = (): Order[] => [{ type: 'attack', nationId: 'r1', target: 'r0', commit: 'main', stance: 'assault' }]

/** Plays to the end of the current month. */
function toMonthEnd(s: GameState, planner: () => Order[]) {
  const events: LiveEvent[] = []
  let step = { state: s, events, monthEnded: false }
  const length = daysInMonth(s.turn)
  for (let i = 0; i < length; i++) {
    step = { ...advanceDay(step.state, map, { planner }), events }
    events.push(...step.events)
  }
  return step
}

describe('the AI in a live game', () => {
  it('plans once a month, and its attacks leave on days of the new month, not all at once', () => {
    const { state } = toMonthEnd(front(), plan)
    expect(state.turn).toBe(2)
    const sent = (state.armies ?? []).length + (state.launches ?? []).length
    expect(sent).toBe(1)
    if (state.launches?.length) {
      const [first, last] = LIVE.launchWindow
      expect(state.launches[0].at).toBeGreaterThanOrEqual(absDay(2, first))
      expect(state.launches[0].at).toBeLessThanOrEqual(absDay(2, last))
    }
  })

  it('launches the planned army on its day, and it marches and fights like the player\'s', () => {
    const { state } = toMonthEnd(front(), plan)
    const events: LiveEvent[] = []
    let s = state
    for (let i = 0; i < 25; i++) {
      const step = advanceDay(s, map, { planner: () => [] })
      s = step.state
      events.push(...step.events)
    }
    expect(events.some((e) => e.kind === 'launched' && e.army.nationId === 'r1')).toBe(true)
    expect(events.some((e) => e.kind === 'battle')).toBe(true)
    expect(s.launches).toHaveLength(0)
  })

  it('is the same on every screen: the same game plans the same days', () => {
    const a = toMonthEnd(front(), plan).state
    const b = toMonthEnd(front(), plan).state
    expect(JSON.stringify(a.launches)).toBe(JSON.stringify(b.launches))
    expect(JSON.stringify(a.armies)).toBe(JSON.stringify(b.armies))
  })

  it('drops a launch that no longer makes sense, such as after peace', () => {
    const { state } = toMonthEnd(front(), plan)
    state.wars = []
    const events: LiveEvent[] = []
    let s = state
    for (let i = 0; i < 20; i++) {
      const step = advanceDay(s, map, { planner: () => [] })
      s = step.state
      events.push(...step.events)
    }
    expect(events.some((e) => e.kind === 'launched')).toBe(false)
    expect(s.launches).toHaveLength(0)
    expect(s.armies).toHaveLength(0)
  })
})

describe('the AI attacks about as often live as in turns', () => {
  const { map: world } = getWorld()

  function play(mode: 'turns' | 'live', months: number) {
    let s = createInitialState(world, { playerRegionId: 'china', seed: 5, difficulty: 'hard', goal: 'classic', victoryShare: 2, mode })
    const planner = (st: GameState, m: typeof world) => [...generateAllBotOrders(st, m), ...generateBotOrders(st, m, st.playerId, true)]
    let battles = 0
    if (mode === 'turns') {
      for (let i = 0; i < months && s.outcome === 'playing'; i++) {
        if (s.pendingEvent) s = applyEventChoice(s, world, 0)
        s = resolveTurn(s, world, planner(s, world))
        battles += s.battles.filter((b) => b.attacker.nationId !== 'rebels').length
      }
    } else {
      while (s.turn <= months && s.outcome === 'playing') {
        if (s.pendingEvent) s = applyEventChoice(s, world, 0)
        const step = advanceDay(s, world, { planner })
        s = step.state
        battles += step.events.filter((e) => e.kind === 'battle').length
      }
    }
    return battles
  }

  it('over a year and a half on the real world', () => {
    const turns = play('turns', 18)
    const live = play('live', 18)
    expect(turns).toBeGreaterThan(20)
    expect(live).toBeGreaterThan(turns * 0.6)
    expect(live).toBeLessThan(turns * 1.6)
  }, 120_000)
})
