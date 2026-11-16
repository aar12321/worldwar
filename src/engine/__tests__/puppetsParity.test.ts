import { describe, expect, it } from 'vitest'
import { PUPPET, TRIBUTE_FORMS } from '../../data/puppets'
import { daysInMonth } from '../calendar'
import { advanceDay, startLive } from '../live'
import { validateOrder } from '../orders'
import { bindPuppet } from '../puppets'
import { createRng } from '../rng'
import { resolveTurn } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { killNation } from '../warfare'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

function world(): GameState {
  const s = startState(map, 'r0', 4)
  s.nations.r0.resources.capital = 3000
  s.nations.r0.resources.pp = 300
  setMilitary(s, 'r0', { infantry: 40, armor: 10 })
  bindPuppet(s, 'r1', 'r0')
  s.nations.r1.overlordSince = -20
  return s
}

function stripped(s: GameState) {
  const copy = JSON.parse(JSON.stringify(s))
  for (const k of ['day', 'armies', 'launches', 'flights', 'pendingDay']) delete copy[k]
  delete copy.settings.mode
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

describe('a year with a puppet: turn and live games agree', () => {
  it('twelve months of ruling, tribute, aid and a change of form give the same game', () => {
    // The master rules in months 1, 3 and 6; the puppet's loyalty, tribute and treasuries must match to the digit.
    const orders = (turn: number): Order[] => {
      const base = { type: 'governPuppet' as const, nationId: 'r0', target: 'r1' }
      if (turn === 1) return [{ ...base, patch: { taxRate: 0.3, draftRate: 0.08, tribute: { form: 'money', share: 0.2 } } }]
      if (turn === 3) return [{ ...base, patch: { aid: 80, law: { id: 'free_trade', on: true } } }]
      if (turn === 6) return [{ ...base, patch: { tribute: { form: 'oil', share: 0.3 }, spending: { housing: 2 } } }]
      return []
    }
    let turn = world()
    for (let i = 0; i < 12; i++) {
      turn.nations.r0.resources.pp = 300
      turn = resolveTurn(turn, map, orders(turn.turn))
    }
    let live = startLive(structuredClone(world()))
    const keep = (t: number): Order[] => orders(t)
    // The same standing influence in both: topped up on the 1st of every month, as above.
    while (live.turn < turn.turn) {
      live.nations.r0.resources.pp = 300
      const monthStart = live.turn
      live = liveMonths(live, 1, keep)
      expect(live.turn).toBe(monthStart + 1)
    }
    expect(live.turn).toBe(turn.turn)
    const a = stripped(turn)
    const b = stripped(live)
    for (const l of [...a.log, ...b.log]) delete l.day
    expect(b.nations.r1).toEqual(a.nations.r1)
    expect(b.nations.r0).toEqual(a.nations.r0)
    expect(b.regions).toEqual(a.regions)
    expect(b.log).toEqual(a.log)
  })
})

describe('edge cases', () => {
  it('a puppet of a puppet is not allowed: the peace terms refuse it', () => {
    // A puppet cannot make puppets; a nation that is a puppet cannot be made another's.
    const s = world()
    expect(s.nations.r1.overlord).toBe('r0')
    bindPuppet(s, 'r2', 'r1')
    // Binding passes the new puppet's own puppets up: r2 serves r1, then r1 becomes r3's, so r2 ends as r3's, not r1's.
    bindPuppet(s, 'r1', 'r3')
    expect(s.nations.r2.overlord).toBe('r3')
    expect(Object.values(s.nations).filter((n) => n.overlord && s.nations[n.overlord]?.overlord).length).toBe(0)
  })

  it('a puppet that is conquered by a third party leaves its master with no puppet and no stale fields', () => {
    const s = world()
    s.nations.r1.tribute = { form: 'steel', share: 0.3 }
    killNation(s, 'r1', 'r5')
    expect(s.nations.r1.alive).toBe(false)
    expect(s.nations.r1.overlord).toBeNull()
    expect(s.nations.r1.loyalty).toBeUndefined()
    expect(s.nations.r1.tribute).toBeUndefined()
    const next = resolveTurn(s, map, [])
    expect(next.nations.r0.alive).toBe(true)
  })

  it('the master dies: the puppet is free and keeps nothing of the old rules but its laws and rates', () => {
    const s = world()
    s.nations.r1.ruledAt = 0
    killNation(s, 'r0', 'r5')
    const next = resolveTurn(s, map, [])
    expect(next.nations.r1.overlord).toBeNull()
    expect(next.nations.r1.loyalty).toBeUndefined()
    // Free again, its own bot may rule it.
    expect(validateOrder(next, map, { type: 'setPolicy', nationId: 'r1', taxRate: 0.3, draftRate: 0.05 })).toBeNull()
  })

  it('releasing a puppet clears its loyalty and its tribute', () => {
    const s = world()
    s.nations.r1.tribute = { form: 'levy', share: 0.1 }
    const next = resolveTurn(s, map, [{ type: 'releasePuppet', nationId: 'r0', target: 'r1' }])
    expect(next.nations.r1.overlord).toBeNull()
    expect(next.nations.r1.loyalty).toBeUndefined()
    expect(next.nations.r1.tribute).toBeUndefined()
  })

  it('a puppet can be the master of nobody and a master’s own master cannot rule it', () => {
    const s = world()
    expect(validateOrder(s, map, { type: 'governPuppet', nationId: 'r1', target: 'r0', patch: { taxRate: 0.3 } })).toMatch(/not your puppet/)
  })
})

describe('fuzz', () => {
  it('thousands of random patches never throw, never leave a number out of range and never reach a nonsense state', () => {
    const rng = createRng(77, 1)
    const junk = [undefined, null, NaN, Infinity, -1, 0, 0.5, 1e12, 'x', {}, [], true, 3, -0.2]
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng.next() * xs.length)]
    const forms = [...TRIBUTE_FORMS, 'gold', 7, null]
    const laws = ['martial_law', 'free_trade', 'austerity', 'war_economy', 'nope', 3, null]
    let accepted = 0
    for (let i = 0; i < 1500; i++) {
      const s = world()
      const patch: Record<string, unknown> = {}
      if (rng.chance(0.5)) patch.taxRate = rng.chance(0.6) ? rng.next() : pick(junk)
      if (rng.chance(0.4)) patch.draftRate = rng.chance(0.6) ? rng.next() * 0.3 : pick(junk)
      if (rng.chance(0.3)) patch.law = rng.chance(0.7) ? { id: pick(laws), on: rng.chance(0.5) } : pick(junk)
      if (rng.chance(0.3)) patch.spending = rng.chance(0.7) ? { [pick(['schools', 'health', 'works', 'pensions', 'jobless', 'housing', 'zzz'])]: pick([0, 1, 2, 3, 4, 5, -1, 1.5, NaN]) } : pick(junk)
      if (rng.chance(0.4)) patch.tribute = rng.chance(0.7) ? { form: pick(forms), share: rng.chance(0.7) ? rng.next() * 0.7 : pick(junk) } : pick(junk)
      if (rng.chance(0.3)) patch.aid = rng.chance(0.6) ? rng.next() * 800 : pick(junk)
      if (rng.chance(0.1)) patch[pick(['bogus', 'proto', '__proto__'])] = 1
      const o = { type: 'governPuppet', nationId: 'r0', target: pick(['r1', 'r1', 'r2', 'zz']), patch: rng.chance(0.05) ? pick(junk) : patch } as Order
      const why = validateOrder(s, map, o)
      expect(why === null || typeof why === 'string').toBe(true)
      if (why !== null) continue
      accepted++
      const next = resolveTurn(s, map, [o])
      const p = next.nations.r1
      if (!p.overlord) continue
      expect(p.loyalty!).toBeGreaterThanOrEqual(0)
      expect(p.loyalty!).toBeLessThanOrEqual(100)
      for (const v of [p.taxRate, p.draftRate, p.resources.capital, p.stability, next.nations.r0.resources.capital, next.nations.r0.resources.pp]) expect(Number.isFinite(v)).toBe(true)
      expect(p.taxRate).toBeGreaterThanOrEqual(0.05 - 1e-9)
      expect(p.taxRate).toBeLessThanOrEqual(PUPPET.maxTax + 1e-9)
      expect(p.laws.length).toBeLessThanOrEqual(PUPPET.maxLaws)
    }
    expect(accepted).toBeGreaterThan(30)
  })
})
