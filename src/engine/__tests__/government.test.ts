import { describe, expect, it } from 'vitest'
import { BUDGET_LIMITS, ELECTION, EVEN_BUDGET, GOVERNMENTS, REFORM } from '../../data/government'
import { LAW_SPECS } from '../../data/unitTypes'
import { computeEconomy } from '../economy'
import { monthsToElection, runPolitics } from '../politics'
import { policyEffects } from '../policy'
import { validateOrder, orderCost } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { createRng } from '../rng'
import type { GameState, LawId } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(3)
const P = 'r0'

function base(gov: GameState['nations'][string]['government'] = 'monarchy'): GameState {
  const s = startState(map)
  s.nations[P].government = gov
  s.nations[P].resources.capital = 500
  s.nations[P].resources.pp = 200
  return s
}

describe('government types', () => {
  it('each form of government changes the numbers it says it does', () => {
    const make = (gov: Parameters<typeof base>[0]) => {
      const s = base(gov)
      s.regions.r0.buildings.university = 3
      return computeEconomy(s, map, P)
    }
    const dem = make('democracy')
    const jun = make('junta')
    const one = make('one_party')
    const mon = make('monarchy')
    expect(dem.tpGain).toBeGreaterThan(one.tpGain)
    expect(one.ppGain).toBeGreaterThan(mon.ppGain)
    expect(jun.upkeep).toBeLessThanOrEqual(mon.upkeep)
    expect(jun.stabilityTarget).toBeLessThan(mon.stabilityTarget)
  })

  it('a democracy is angrier about high taxes than a junta', () => {
    const dem = base('democracy')
    const jun = base('junta')
    for (const s of [dem, jun]) s.nations[P].taxRate = 0.5
    const penaltyDem = computeEconomy(base('democracy'), map, P).stabilityTarget - computeEconomy(dem, map, P).stabilityTarget
    const penaltyJun = computeEconomy(base('junta'), map, P).stabilityTarget - computeEconomy(jun, map, P).stabilityTarget
    expect(penaltyDem).toBeGreaterThan(penaltyJun)
  })

  it('changing the government costs influence, causes turmoil and has a cooldown', () => {
    const s = base('monarchy')
    s.turn = 30
    const stability = s.nations[P].stability
    const order = { type: 'setGovernment', nationId: P, government: 'democracy' } as const
    expect(orderCost(s, order).pp).toBe(REFORM.cost)
    expect(applyOrderNow(s, map, order).error).toBeNull()
    expect(s.nations[P].government).toBe('democracy')
    expect(s.nations[P].stability).toBe(stability - REFORM.turmoil)
    expect(s.nations[P].nextElection).toBe(30 + GOVERNMENTS.democracy.election)
    expect(validateOrder(s, map, { type: 'setGovernment', nationId: P, government: 'junta' })).toMatch(/can change again/)
    expect(validateOrder(s, map, { type: 'setGovernment', nationId: P, government: 'democracy' })).toMatch(/already/)
  })
})

describe('the budget', () => {
  it('is zero-sum: leaning toward research costs upkeep savings', () => {
    const even = policyEffects({ ...base().nations[P], budget: { ...EVEN_BUDGET } })
    const school = policyEffects({ ...base().nations[P], budget: { military: 0.1, education: 0.6, health: 0.15, infrastructure: 0.15 } })
    expect(even.research).toBeCloseTo(0)
    expect(school.research).toBeGreaterThan(0)
    expect(school.upkeep).toBeGreaterThan(even.upkeep)
    expect(school.stability).toBeLessThan(even.stability)
  })

  it('must add up to 100% with each part in range', () => {
    const s = base()
    const ok = { military: 0.4, education: 0.2, health: 0.2, infrastructure: 0.2 }
    expect(validateOrder(s, map, { type: 'setPolicy', nationId: P, taxRate: 0.25, draftRate: 0.05, budget: ok })).toBeNull()
    expect(validateOrder(s, map, { type: 'setPolicy', nationId: P, taxRate: 0.25, draftRate: 0.05, budget: { ...ok, military: 0.5 } })).toMatch(/100%/)
    expect(validateOrder(s, map, { type: 'setPolicy', nationId: P, taxRate: 0.25, draftRate: 0.05, budget: { military: 0.9, education: 0.05, health: 0.025, infrastructure: 0.025 } })).toMatch(/between/)
  })

  it('a budget order takes effect when the month ends, with the business tax', () => {
    const s = base()
    const budget = { military: 0.1, education: 0.4, health: 0.25, infrastructure: 0.25 }
    const next = resolveTurn(s, map, [{ type: 'setPolicy', nationId: P, taxRate: 0.25, draftRate: 0.05, budget, corporateTax: 0.3 }])
    expect(next.nations[P].budget).toEqual(budget)
    expect(next.nations[P].corporateTax).toBe(0.3)
  })

  it('an infrastructure budget makes upgrades cheaper', () => {
    const even = base()
    const roads = base()
    roads.nations[P].budget = { military: 0.1, education: 0.1, health: 0.1, infrastructure: BUDGET_LIMITS.max + 0.1 }
    const upgrade = { type: 'build', nationId: P, regionId: P, building: 'farm' } as const
    expect(orderCost(roads, upgrade).capital).toBeLessThan(orderCost(even, upgrade).capital)
  })
})

describe('laws', () => {
  it('there are ten, each with an effect the economy shows', () => {
    expect(Object.keys(LAW_SPECS)).toHaveLength(10)
    const s = base()
    const plain = computeEconomy(s, map, P)
    for (const law of Object.keys(LAW_SPECS) as LawId[]) {
      if (law === 'conscription_act') continue
      const t = structuredClone(s)
      t.nations[P].laws = [law]
      const e = computeEconomy(t, map, P)
      const changed = e.netCapital !== plain.netCapital || e.stabilityTarget !== plain.stabilityTarget || e.tpGain !== plain.tpGain || e.ppGain !== plain.ppGain || e.foodConsumption !== plain.foodConsumption || e.goodsUse !== plain.goodsUse || e.tradeCapacity !== plain.tradeCapacity || e.upkeep !== plain.upkeep
      expect(changed, law).toBe(true)
    }
  })

  it('martial law and the war economy still do what they always did', () => {
    const s = base()
    const plain = computeEconomy(s, map, P)
    const m = structuredClone(s)
    m.nations[P].laws = ['martial_law']
    expect(computeEconomy(m, map, P).stabilityTarget).toBeCloseTo(plain.stabilityTarget + 15)
    const w = structuredClone(s)
    w.nations[P].laws = ['war_economy']
    expect(computeEconomy(w, map, P).stabilityTarget).toBeCloseTo(plain.stabilityTarget - 10)
    expect(computeEconomy(w, map, P).factoryIncome).toBeGreaterThan(plain.factoryIncome)
  })

  it('healthcare costs income and buys stability', () => {
    const s = base()
    const plain = computeEconomy(s, map, P)
    s.nations[P].laws = ['universal_healthcare']
    const e = computeEconomy(s, map, P)
    expect(e.policyMoney).toBeLessThan(0)
    expect(e.stabilityTarget).toBeCloseTo(plain.stabilityTarget + 8)
  })
})

describe('elections and coups', () => {
  it('a content democracy wins its election and a restless one loses', () => {
    const win = base('democracy')
    win.turn = 20
    win.nations[P].nextElection = 20
    win.nations[P].stability = ELECTION.needed + 10
    runPolitics(win, map, createRng(1, 1))
    expect(win.nations[P].stability).toBe(ELECTION.needed + 10 + ELECTION.win.stability)
    expect(win.nations[P].nextElection).toBe(20 + GOVERNMENTS.democracy.election)

    const lose = base('democracy')
    lose.turn = 20
    lose.nations[P].nextElection = 20
    lose.nations[P].stability = ELECTION.needed - 10
    lose.nations[P].taxRate = 0.45
    runPolitics(lose, map, createRng(1, 1))
    expect(lose.nations[P].stability).toBe(ELECTION.needed - 10 + ELECTION.lose.stability)
    expect(lose.nations[P].taxRate).toBe(ELECTION.lose.tax)
    expect(lose.nations[P].resources.pp).toBe(100)
  })

  it('only democracies hold elections', () => {
    const s = base('monarchy')
    expect(monthsToElection(s, P)).toBeNull()
    s.nations[P].government = 'democracy'
    s.nations[P].nextElection = s.turn + 7
    expect(monthsToElection(s, P)).toBe(7)
  })

  it('a junta close to revolt can be overthrown, a healthy one cannot', () => {
    let coups = 0
    for (let seed = 1; seed <= 200; seed++) {
      const s = base('junta')
      s.nations[P].stability = 5
      s.nations[P].laws = ['rationing']
      runPolitics(s, map, createRng(seed, 2))
      if (s.nations[P].laws.length === 0) coups++
    }
    expect(coups).toBeGreaterThan(10)
    const calm = base('junta')
    calm.nations[P].laws = ['rationing']
    runPolitics(calm, map, createRng(1, 2))
    expect(calm.nations[P].laws).toEqual(['rationing'])
  })
})
