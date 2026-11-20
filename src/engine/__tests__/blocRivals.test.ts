import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blocBotOrders, blocOpEnemies, warOfChoice } from '../../ai/blocs'
import { BLOC } from '../../data/blocs'
import { blocOf } from '../bloc'
import { factionOf } from '../factions'
import { pairKey } from '../helpers'
import { advanceDay, startLive } from '../live'
import { validateOrder } from '../orders'
import type { GameState, Order } from '../types'
import { map, ok, setup } from './blocFixtures'
void setup

/** Runs `fn` with one bloc flag switched, and puts it back. */
function withFlag<T>(key: 'aiWars' | 'liveAnswers', on: boolean, fn: () => T): T {
  const was = BLOC[key]
  BLOC[key] = on
  try {
    return fn()
  } finally {
    BLOC[key] = was
  }
}

/** setup() with both members founding as people, then only `humans` left as people (a rival cannot be invited by a click). */
function bloc(humans: string[]) {
  const r = setup(['r0', 'r1'])
  r.s.humans = humans
  for (const id of Object.keys(r.s.nations)) r.s.nations[id].isPlayer = humans.includes(id)
  return r
}

/** The bloc of setup() at peace: r0 and r1 in a bloc, r2 (holding r2, r3, r4) next to r1 and much weaker. */
function atPeace(humans: string[] = []) {
  const { s, f } = bloc(humans)
  s.wars = []
  return { s, f }
}

describe('rival blocs choose a war they can win (BLOC.aiWars)', () => {
  // The test map has eight nations; the real world's bound (only while 100 are alive) is checked on its own below.
  const minNations = BLOC.warMinNations
  beforeEach(() => {
    BLOC.warMinNations = 0
  })
  afterEach(() => {
    BLOC.warMinNations = minNations
  })

  it('a world already thinned out is left alone: no war of choice below the least number of nations alive', () => {
    const { s, f } = atPeace()
    BLOC.warMinNations = Object.values(s.nations).filter((n) => n.alive).length + 1
    expect(warOfChoice(s, map, f(), 0.85)).toBeNull()
  })

  it('picks the weak neighbour, forecasts it with every member that could join, and leaves the state exactly as it was', () => {
    const { s, f } = atPeace()
    const before = JSON.stringify(s)
    const war = warOfChoice(s, map, f(), 0.85)
    expect(war).toMatchObject({ target: 'r2' })
    expect(war!.odds).toBeGreaterThanOrEqual(BLOC.warOdds)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('never picks a person, an ally, or a nation it likes', () => {
    const { s, f } = atPeace()
    s.humans = ['r2']
    expect(warOfChoice(s, map, f(), 0.85)).toBeNull()
    s.humans = []
    s.alliances.push(pairKey('r1', 'r2'))
    expect(warOfChoice(s, map, f(), 0.85)).toBeNull()
  })

  it('a strong target is left alone', () => {
    const { s, f } = atPeace()
    s.nations.r2.military.units.infantry = 60
    s.nations.r2.military.units.armor = 30
    expect(warOfChoice(s, map, f(), 0.85)).toBeNull()
  })

  it('with a reason in hand the leader declares and plans the operation in the same month; the plan is valid against the queued war', () => {
    const { s, f } = atPeace()
    // r1 leads: it borders r2, so it can plan the operation the month it declares.
    f().founder = 'r1'
    s.turn = 8
    let orders: Order[] = []
    // The leader thinks of a war on some months only: find one where it does (deterministic by month).
    for (let t = 8; t < 40 && !orders.length; t++) {
      s.turn = t
      s.casusBelli[`r1|r2`] = t + 6
      const out: Order[] = []
      blocBotOrders(s, map, 'r1', (o) => {
        if (validateOrder(s, map, o, out)) return false
        out.push(o)
        return true
      })
      if (out.some((o) => o.type === 'declareWar')) orders = out
    }
    expect(orders.find((o) => o.type === 'declareWar')).toMatchObject({ nationId: 'r1', target: 'r2' })
    expect(orders.find((o) => o.type === 'blocPlan')).toMatchObject({ nationId: 'r1', when: 1 })
    // While the operation is planned, the members hold their own attacks on that enemy for D-Day.
    expect(blocOpEnemies(s, 'r1', orders)).toEqual(['r2'])
  })

  it('a plan or a call is refused without a war, and accepted with a war declared in the same month', () => {
    const { s } = atPeace(['r0', 'r1'])
    const plan: Order = { type: 'blocPlan', nationId: 'r1', target: 'r2', when: 1 }
    expect(validateOrder(s, map, plan)).toMatch(/No member is at war/)
    expect(validateOrder(s, map, plan, [{ type: 'declareWar', nationId: 'r1', target: 'r2' }])).toBeNull()
    // Someone else's declaration does not count.
    expect(validateOrder(s, map, plan, [{ type: 'declareWar', nationId: 'r5', target: 'r2' }])).toMatch(/No member is at war/)
    const call: Order = { type: 'blocCall', nationId: 'r0', target: 'r2' }
    expect(validateOrder(s, map, call)).toMatch(/Declare war/)
  })

  it('switched off, a bloc at peace never thinks of a war', () => {
    withFlag('aiWars', false, () => {
      const { s } = atPeace()
      s.casusBelli[`r0|r2`] = 99
      for (let t = 8; t < 30; t++) {
        s.turn = t
        const out: Order[] = []
        blocBotOrders(s, map, 'r0', (o) => (out.push(o), true))
        expect(out.some((o) => o.type === 'declareWar' || o.type === 'blocPlan')).toBe(false)
      }
    })
  })
})

describe('live games: rival members answer on the next day (BLOC.liveAnswers)', () => {
  /** A person (r0) leads; r1 is a rival member. */
  function livePlan(): { s: GameState; opId: string } {
    const { s, f } = bloc(['r0'])
    startLive(s)
    ok(s, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 7 })
    return { s, opId: blocOf(f()).ops[0].id }
  }

  it('a rival member pledges to a person’s operation the next day, not at the month’s turn, before it sets out', () => {
    const { s, opId } = livePlan()
    expect(blocOf(factionOf(s, 'r0')).ask).toBe(1)
    const next = advanceDay(s, map).state
    const op = blocOf(factionOf(next, 'r0')).ops.find((o) => o.id === opId)!
    expect(op.pledges.r1).toBeTruthy()
    expect(blocOf(factionOf(next, 'r0')).ask).toBeUndefined()
    // The same on every screen: two runs agree exactly.
    expect(JSON.stringify(advanceDay(livePlan().s, map).state)).toBe(JSON.stringify(next))
  })

  it('a rival member answers a person’s call to arms the next day', () => {
    const { s, f } = bloc(['r0'])
    s.wars = s.wars.filter((w) => w !== pairKey('r1', 'r2'))
    startLive(s)
    ok(s, { type: 'blocCall', nationId: 'r0', target: 'r2' })
    const next = advanceDay(s, map).state
    const call = blocOf(factionOf(next, 'r0')).calls[0]
    expect(call.answers.r1).toBeDefined()
    void f
  })

  it('switched off, they wait for the month to turn, and nothing is asked', () => {
    withFlag('liveAnswers', false, () => {
      const { s, opId } = livePlan()
      expect(blocOf(factionOf(s, 'r0')).ask).toBeUndefined()
      const next = advanceDay(s, map).state
      expect(blocOf(factionOf(next, 'r0')).ops.find((o) => o.id === opId)!.pledges.r1).toBeUndefined()
    })
  })

  it('a turn game never asks', () => {
    const { s, f } = bloc(['r0'])
    ok(s, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 1 })
    expect(blocOf(f()).ask).toBeUndefined()
  })
})
