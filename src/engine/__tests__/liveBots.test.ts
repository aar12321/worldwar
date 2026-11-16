import { describe, expect, it } from 'vitest'
import { LIVE } from '../../data/live'
import { absDay, daysInMonth } from '../calendar'
import { advanceDay, type LiveEvent } from '../live'
import type { Army, GameState, Order } from '../types'
import { playAttacks } from './attackRate'
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
  /**
   * The cheap, always-on half of the attack-rate check; the 36-month, three-seed ±20% one is in longSim.test.ts. One seed over a year
   * and a half swings more than three over three years, so the band is wider. Measured per seed at 18 months, live over turns ran
   * from 0.73 to 1.13 across Hard seeds 1 to 6 and Normal seeds 1 to 3 (this seed, 5 on Hard: 101 live to 139 turns). The band is
   * 0.6 to 1.4: loose enough for that noise, tight enough to catch live attacking half as often, or half as much again.
   */
  it('over a year and a half on the real world', () => {
    const turns = playAttacks('turns', { seed: 5, difficulty: 'hard', months: 18 }).battles
    const live = playAttacks('live', { seed: 5, difficulty: 'hard', months: 18 }).battles
    expect(turns).toBeGreaterThan(20)
    expect(live).toBeGreaterThan(turns * 0.6)
    expect(live).toBeLessThan(turns * 1.4)
  }, 120_000)
})

describe('rivals that watch for armies marching on them', () => {
  const units = (u: Partial<Record<'infantry' | 'armor', number>>) => ({ infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0, ...u })
  const army = (over: Partial<Army>): Army => ({
    id: 'a',
    nationId: 'r1',
    units: units({ infantry: 6 }),
    commit: 'main',
    stance: 'assault',
    share: 0.66,
    via: 'land',
    bySea: false,
    home: 'r1',
    target: 'r3',
    phase: 'outbound',
    from: { lat: 0, lng: 5 },
    to: { lat: 0, lng: 15 },
    start: 0,
    end: 6,
    launched: 0,
    ...over,
  })

  /** r1 is an AI at war with r3 and with the player's r0, which has an army marching on it while r1's own is out. */
  function pincer(difficulty: 'easy' | 'normal' | 'hard') {
    const s = startLive(startState(lineMap(6)))
    s.settings.difficulty = difficulty
    s.wars.push('r0|r1', 'r1|r3')
    setMilitary(s, 'r1', { infantry: 2 })
    s.armies = [
      army({ id: 'ours', nationId: 'r1', units: units({ infantry: 8 }), target: 'r3' }),
      army({ id: 'theirs', nationId: 'r0', units: units({ infantry: 20, armor: 8 }), home: 'r0', target: 'r1', from: { lat: 0, lng: 0 }, to: { lat: 0, lng: 5 }, end: 5 }),
    ]
    return s
  }
  const step = (s: ReturnType<typeof pincer>) => advanceDay(s, lineMap(6), { planner: () => [] })

  it('a Hard rival calls its army home when a stronger army marches on its country', () => {
    const { state, events } = step(pincer('hard'))
    const ours = state.armies!.find((a) => a.id === 'ours')!
    expect(ours.phase).toBe('returning')
    expect(ours.outcome).toBe('recalled')
    expect(events.some((e) => e.kind === 'turnedBack' && e.why === 'recalled' && e.army.nationId === 'r1')).toBe(true)
    // The player's army is not touched.
    expect(state.armies!.find((a) => a.id === 'theirs')!.phase).toBe('outbound')
  })

  it('a Medium rival does the same, and an Easy one does not', () => {
    expect(step(pincer('normal')).state.armies!.find((a) => a.id === 'ours')!.phase).toBe('returning')
    expect(step(pincer('easy')).state.armies!.find((a) => a.id === 'ours')!.phase).toBe('outbound')
  })

  it('does not call an army home when the danger is smaller than what it has at home', () => {
    const s = pincer('hard')
    s.armies![1].units = units({ infantry: 1 })
    expect(step(s).state.armies!.find((a) => a.id === 'ours')!.phase).toBe('outbound')
  })

  it('holds back a planned attack while its own country is about to be overrun', () => {
    const planned = (difficulty: 'easy' | 'hard') => {
      const s = pincer(difficulty)
      s.armies = [s.armies![1]]
      s.wars.push('r1|r2')
      s.launches = [{ id: 'l1', at: 1, order: { type: 'attack', nationId: 'r1', target: 'r2', commit: 'main', stance: 'assault' } }]
      return s
    }
    const hard = step(planned('hard'))
    expect(hard.events.some((e) => e.kind === 'launched')).toBe(false)
    expect(hard.state.launches).toHaveLength(0)
    expect(step(planned('easy')).events.some((e) => e.kind === 'launched')).toBe(true)
  })

  it('answers the same way every time', () => {
    expect(JSON.stringify(step(pincer('hard')).state)).toBe(JSON.stringify(step(pincer('hard')).state))
  })
})
