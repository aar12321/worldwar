import { describe, expect, it } from 'vitest'
import { AGENCY, DOMESTIC_OPS, FOREIGN_OPS, levelsCost, type DomesticOp, type ForeignOp } from '../../data/agencies'
import { justificationOf } from '../helpers'
import { orderCost, validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(6)

function rich(): GameState {
  const s = startState(map)
  const n = s.nations.r0
  n.agencies.foreign.level = 5
  n.agencies.domestic.level = 5
  n.resources.capital = 5000
  n.resources.pp = 200
  // The target is shaky, has something to steal, and has factories and rebels to work on.
  s.nations.r1.stability = 30
  s.nations.r1.agencies.domestic.level = 0
  s.nations.r1.techs = ['eco_banking', 'eco_exchanges', 'eco_mass_production', 'frontier_drones', 'cyber_warfare']
  n.techs = ['eco_banking', 'frontier_drones', 'cyber_warfare']
  s.regions.r1.buildings.factory = 3
  return s
}

/** Runs a month of one order across seeds, since each operation is a roll, until it works. Returns the state where it did. */
function succeeds(order: Order, worked: (before: GameState, after: GameState) => boolean, setup?: (s: GameState) => void): GameState {
  for (let seed = 1; seed <= 60; seed++) {
    const s = rich()
    s.seed = seed
    setup?.(s)
    expect(validateOrder(s, map, order)).toBeNull()
    const after = resolveTurn(s, map, [order])
    expect(after.nations.r0.resources.capital).toBeLessThan(s.nations.r0.resources.capital + 100)
    if (worked(s, after)) return after
  }
  throw new Error(`${order.type} never worked in 60 months`)
}

const foreign = (op: ForeignOp, target = 'r1'): Order => ({ type: 'operation', nationId: 'r0', op, target })

describe('every foreign operation works end to end', () => {
  it('gather intelligence opens their numbers', () => {
    const after = succeeds(foreign('intel'), (_, a) => (a.intel['r0|r1'] ?? -1) >= a.turn)
    expect(after.intel['r0|r1']).toBeGreaterThan(after.turn)
  })
  it('build a case gives a reason for war', () => {
    succeeds(foreign('case'), (_, a) => justificationOf(a, 'r0', 'r1')?.reason === 'Evidence of plotting')
  })
  it('sabotage stops their factories', () => {
    succeeds(foreign('sabotage'), (_, a) => a.regions.r1.sabotaged > 0)
  })
  it('arming rebels raises a revolt, and the world suspects who', () => {
    const after = succeeds(foreign('rebels'), (_, a) => a.log.some((l) => l.text.startsWith('Rebels rose in')))
    expect(after.infamy.r0).toBeGreaterThan(0)
  })
  it('helping them keep order calms rebels, lifts stability and earns thanks', () => {
    succeeds(
      foreign('aid'),
      (b, a) => a.nations.r1.stability > b.nations.r1.stability && a.regions.r1.rebels < 2 && (a.opinions['r1>r0'] ?? []).some((m) => m.label === 'Helped us keep order'),
      (s) => {
        s.regions.r1.rebels = 5
      },
    )
  })
  it('stealing technology gives you one you lacked', () => {
    succeeds(foreign('steal'), (b, a) => a.nations.r0.techs.length > b.nations.r0.techs.length)
  })
  it('a coup on a shaky nation makes it your puppet', () => {
    succeeds(foreign('coup'), (_, a) => a.nations.r1.overlord === 'r0')
  })
  it('a cyber attack drains their treasury', () => {
    succeeds(
      foreign('cyber'),
      (b, a) => a.nations.r1.resources.capital < b.nations.r1.resources.capital * 0.8,
      (s) => {
        s.nations.r1.resources.capital = 300
      },
    )
  })
  it('every operation charges exactly its price', () => {
    const s = rich()
    for (const op of Object.keys(FOREIGN_OPS) as ForeignOp[]) {
      const cost = orderCost(s, foreign(op))
      expect(cost.capital).toBe(FOREIGN_OPS[op].money)
      expect(cost.pp).toBe(FOREIGN_OPS[op].pp)
    }
  })
  it('a failed, noticed operation costs reputation and hands them a reason to fight', () => {
    let seen = false
    for (let seed = 1; seed <= 80 && !seen; seed++) {
      const s = rich()
      s.seed = seed
      s.nations.r1.agencies.domestic.level = 5
      s.nations.r1.secureUntil = s.turn + 12
      const after = resolveTurn(s, map, [foreign('sabotage')])
      if (justificationOf(after, 'r1', 'r0')?.reason === 'Caught agents') {
        expect(after.infamy.r0).toBeGreaterThan(0)
        seen = true
      }
    }
    expect(seen).toBe(true)
  })
})

describe('every domestic operation works end to end', () => {
  const domestic = (op: DomesticOp, regionId?: string): Order => ({ type: 'domestic', nationId: 'r0', op, regionId })
  it('hunting foreign agents makes operations against you harder for a year', () => {
    const s = rich()
    const before = s.nations.r0.secureUntil
    const after = resolveTurn(s, map, [domestic('counter')])
    expect(after.nations.r0.secureUntil).toBe(s.turn + AGENCY.counterMonths)
    expect(after.nations.r0.secureUntil).toBeGreaterThan(before)
  })
  it('calming unrest raises stability', () => {
    const s = rich()
    s.nations.r0.stability = 40
    expect(resolveTurn(s, map, [domestic('calm')]).nations.r0.stability).toBeGreaterThan(s.nations.r0.stability + 3)
  })
  it('breaking up rebels removes most of them in the country you name', () => {
    const s = rich()
    s.regions.r0.rebels = 4
    expect(validateOrder(s, map, domestic('crackdown'))).toMatch(/rebels/)
    const after = resolveTurn(s, map, [domestic('crackdown', 'r0')])
    expect(after.regions.r0.rebels).toBeLessThan(2)
  })
  it('rooting out corruption recovers money', () => {
    const s = rich()
    const after = resolveTurn(s, map, [domestic('corruption')])
    const spec = DOMESTIC_OPS.corruption
    expect(after.nations.r0.resources.capital).toBeGreaterThan(s.nations.r0.resources.capital - spec.money)
  })
})

describe('growing an agency', () => {
  const fund = (levels?: number): Order => ({ type: 'fundAgency', nationId: 'r0', agency: 'domestic', levels })
  it('can be raised past level 2, several levels at once, and takes effect at once', () => {
    const s = startState(map)
    s.nations.r0.resources.capital = 1000
    s.nations.r0.agencies.domestic.level = 2
    expect(validateOrder(s, map, fund())).toBeNull()
    const one = structuredClone(s)
    expect(applyOrderNow(one, map, fund()).error).toBeNull()
    expect(one.nations.r0.agencies.domestic.level).toBe(3)
    const three = structuredClone(s)
    expect(applyOrderNow(three, map, fund(3)).error).toBeNull()
    expect(three.nations.r0.agencies.domestic.level).toBe(5)
    expect(three.nations.r0.resources.capital).toBe(1000 - levelsCost(2, 3))
  })
  it('cannot go past the top, and says how many levels are left', () => {
    const s = startState(map)
    s.nations.r0.resources.capital = 1000
    s.nations.r0.agencies.domestic.level = 4
    expect(validateOrder(s, map, fund(2))).toMatch(/Only 1 more level/)
    s.nations.r0.agencies.domestic.level = 5
    expect(validateOrder(s, map, fund())).toMatch(/highest/)
    expect(validateOrder(s, map, fund(0))).toMatch(/how many/)
  })
  it('says when you cannot afford it', () => {
    const s = startState(map)
    s.nations.r0.agencies.domestic.level = 2
    s.nations.r0.resources.capital = 100
    expect(validateOrder(s, map, fund())).toMatch(/Not enough money/)
  })
})
