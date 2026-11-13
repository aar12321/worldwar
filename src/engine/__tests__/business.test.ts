import { describe, expect, it } from 'vitest'
import { BUSINESS, INVEST, SECTOR_IDS, TREASURY } from '../../data/business'
import { cleanInvestments, creditReport, dividendsFor, fundingGain, growSectors, growthClimate, sectorCap, sectorYield } from '../business'
import { computeEconomy, nationWorkforce } from '../economy'
import { policyEffects } from '../policy'
import { orderCost, validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(3)
const P = 'r0'

function base(): GameState {
  const s = startState(map)
  s.nations[P].resources.capital = 800
  s.nations[P].stability = 70
  return s
}

describe('private business', () => {
  it('every sector adds what it says it does', () => {
    const s = base()
    const n = s.nations[P]
    n.sectors = { farming: 0, energy: 0, manufacturing: 0, arms: 0, technology: 0, finance: 0 }
    const none = computeEconomy(s, map, P)
    n.sectors.farming = 10
    expect(computeEconomy(s, map, P).foodProduction).toBeCloseTo(none.foodProduction + 10 * BUSINESS.food)
    n.sectors = { ...n.sectors, farming: 0, energy: 10 }
    expect(computeEconomy(s, map, P).oilProduction).toBeCloseTo(10 * BUSINESS.oil)
    n.sectors = { ...n.sectors, energy: 0, manufacturing: 10 }
    expect(computeEconomy(s, map, P).goodsProduction).toBeGreaterThan(none.goodsProduction)
    expect(computeEconomy(s, map, P).steelProduction).toBeGreaterThan(none.steelProduction)
    n.sectors = { ...n.sectors, manufacturing: 0, technology: 10 }
    expect(computeEconomy(s, map, P).tpGain).toBeGreaterThan(none.tpGain)
    n.sectors = { ...n.sectors, technology: 0, finance: 10 }
    expect(computeEconomy(s, map, P).netCapital).toBeGreaterThan(none.netCapital)
    expect(sectorYield({ sectors: { ...n.sectors, arms: 5, finance: 0 } }).armsDiscount).toBeCloseTo(5 * BUSINESS.armsDiscount)
  })

  it('business tax raises money but slows growth', () => {
    const low = base()
    const high = base()
    low.nations[P].corporateTax = 0.05
    high.nations[P].corporateTax = 0.4
    expect(computeEconomy(high, map, P).corporateIncome).toBeGreaterThan(computeEconomy(low, map, P).corporateIncome)
    const pol = policyEffects(low.nations[P])
    expect(growthClimate(low.nations[P], pol)).toBeGreaterThan(growthClimate(high.nations[P], pol))
    const a = structuredClone(low.nations[P])
    const b = structuredClone(high.nations[P])
    a.sectors.technology = b.sectors.technology = 2
    for (let i = 0; i < 24; i++) {
      growSectors(a, 10, pol, false)
      growSectors(b, 10, pol, false)
    }
    expect(a.sectors.technology).toBeGreaterThan(b.sectors.technology)
  })

  it('sectors grow toward a cap that rises with the workforce, and shrink in turmoil', () => {
    const s = base()
    const n = s.nations[P]
    const pol = policyEffects(n)
    n.sectors.technology = 0
    for (let i = 0; i < 12; i++) growSectors(n, 10, pol, false)
    expect(n.sectors.technology).toBeGreaterThan(0)
    for (let i = 0; i < 400; i++) growSectors(n, 10, pol, false)
    expect(n.sectors.technology).toBeLessThanOrEqual(sectorCap(10) * 1.5)
    expect(sectorCap(40)).toBeGreaterThan(sectorCap(10))
    const before = n.sectors.technology
    n.stability = 10
    growSectors(n, 10, pol, false)
    expect(n.sectors.technology).toBeLessThan(before)
  })

  it('war helps the arms makers and hurts the bankers', () => {
    const peace = base().nations[P]
    const war = structuredClone(peace)
    peace.sectors.arms = war.sectors.arms = peace.sectors.finance = war.sectors.finance = 2
    const pol = policyEffects(peace)
    growSectors(peace, 10, pol, false)
    growSectors(war, 10, pol, true)
    expect(war.sectors.arms).toBeGreaterThan(peace.sectors.arms)
    expect(war.sectors.finance).toBeLessThan(peace.sectors.finance)
  })

  it('a grant adds business, with less return as the sector gets big', () => {
    expect(fundingGain(2, 100)).toBeGreaterThan(fundingGain(10, 100))
    const s = base()
    s.nations[P].sectors.technology = 1
    const before = s.nations[P].sectors.technology
    const money = s.nations[P].resources.capital
    expect(applyOrderNow(s, map, { type: 'fundSector', nationId: P, sector: 'technology', amount: 100 }).error).toBeNull()
    const cap = sectorCap(nationWorkforce(s, map, P)) * 1.5
    expect(s.nations[P].sectors.technology).toBeCloseTo(Math.min(cap, before + fundingGain(before, 100)))
    expect(s.nations[P].sectors.technology).toBeGreaterThan(before)
    expect(s.nations[P].resources.capital).toBe(money - 100)
    expect(validateOrder(s, map, { type: 'fundSector', nationId: P, sector: 'technology', amount: 5 })).toMatch(/at least/)
  })

  it('subsidies cost money each month and speed growth', () => {
    const s = base()
    const n = s.nations[P]
    n.sectors.technology = 4
    const plain = computeEconomy(s, map, P)
    n.subsidies = ['technology']
    const sub = computeEconomy(s, map, P)
    expect(sub.subsidies).toBeCloseTo(4 * BUSINESS.subsidyCost)
    expect(sub.netCapital).toBeLessThan(plain.netCapital)
    const a = structuredClone(n)
    const b = structuredClone(n)
    b.subsidies = []
    growSectors(a, 10, policyEffects(a), false)
    growSectors(b, 10, policyEffects(b), false)
    expect(a.sectors.technology).toBeGreaterThan(b.sectors.technology)
  })

  it('an arms industry makes units cheaper', () => {
    const s = base()
    const train = { type: 'queueTrain', nationId: P, unit: 'armor' } as const
    s.nations[P].sectors.arms = 0
    const full = orderCost(s, train).capital
    s.nations[P].sectors.arms = 8
    expect(orderCost(s, train).capital).toBeLessThan(full)
  })
})

describe('investing abroad', () => {
  it('pays dividends, grows the other nation, and is seized by war', () => {
    const s = base()
    s.nations.r1.sectors.technology = 2
    const before = s.nations.r1.sectors.technology
    expect(applyOrderNow(s, map, { type: 'invest', nationId: P, target: 'r1', sector: 'technology', amount: 45 }).error).toBeNull()
    expect(s.nations.r1.sectors.technology).toBeGreaterThan(before)
    expect(s.investments).toHaveLength(1)
    expect(dividendsFor(s, P)).toBeCloseTo(45 * INVEST.dividend)
    const withDividend = computeEconomy(s, map, P).netCapital
    s.investments = []
    expect(withDividend).toBeGreaterThan(computeEconomy(s, map, P).netCapital)
    s.investments = [{ id: 'i1', investor: P, target: 'r1', sector: 'technology', amount: 100 }]
    s.wars = ['r0|r1']
    cleanInvestments(s)
    expect(s.investments).toEqual([])
  })

  it('needs peace and a real target, and has a limit', () => {
    const s = base()
    s.wars = ['r0|r1']
    expect(validateOrder(s, map, { type: 'invest', nationId: P, target: 'r1', sector: 'finance', amount: 100 })).toMatch(/at war/)
    s.wars = []
    expect(validateOrder(s, map, { type: 'invest', nationId: P, target: P, sector: 'finance', amount: 100 })).toMatch(/another nation/)
    expect(validateOrder(s, map, { type: 'invest', nationId: P, target: 'r1', sector: 'finance', amount: 5 })).toMatch(/start at/)
    s.nations.r1.sectors.finance = 1
    expect(validateOrder(s, map, { type: 'invest', nationId: P, target: 'r1', sector: 'finance', amount: 5000 })).toMatch(/cannot take/)
  })

  it('makes the other nation like you', () => {
    const s = base()
    s.nations.r1.sectors.finance = 6
    applyOrderNow(s, map, { type: 'invest', nationId: P, target: 'r1', sector: 'finance', amount: 80 })
    expect(Object.values(s.opinions).flat().some((m) => m.label === 'Invested in our businesses')).toBe(true)
  })
})

describe('the treasury', () => {
  it('lends against income and rating, charges interest, and lets you repay', () => {
    const s = base()
    const n = s.nations[P]
    const e = computeEconomy(s, map, P)
    const gross = e.taxIncome + e.factoryIncome + e.tradeIncome + e.corporateIncome
    const rep = creditReport(s, n, gross, false)
    expect(rep.room).toBeGreaterThan(0)
    expect(validateOrder(s, map, { type: 'issueBonds', nationId: P, amount: rep.room + 100 })).toMatch(/at most/)
    const money = n.resources.capital
    expect(applyOrderNow(s, map, { type: 'issueBonds', nationId: P, amount: 100 }).error).toBeNull()
    expect(n.debt).toBe(100)
    expect(n.resources.capital).toBe(money + 100)
    const after = computeEconomy(s, map, P)
    expect(after.interest).toBeGreaterThan(0)
    expect(after.netCapital).toBeLessThan(e.netCapital)
    expect(applyOrderNow(s, map, { type: 'repayDebt', nationId: P, amount: 60 }).error).toBeNull()
    expect(n.debt).toBe(40)
    expect(validateOrder(s, map, { type: 'repayDebt', nationId: P, amount: 500 })).toMatch(/only owe/)
  })

  it('a worse rating means less credit and higher interest', () => {
    const s = base()
    const n = s.nations[P]
    const good = creditReport(s, n, 40, false)
    n.stability = 20
    n.debt = 300
    const bad = creditReport(s, n, 40, true)
    expect(bad.score).toBeLessThan(good.score)
    expect(bad.rate).toBeGreaterThanOrEqual(good.rate)
    expect(bad.room).toBeLessThan(good.room)
  })

  it('a nation in the red for months with debt defaults', () => {
    let s = base()
    const n = s.nations[P]
    n.debt = 200
    n.resources.capital = -500
    n.stability = 60
    for (let i = 0; i < TREASURY.defaultAfter; i++) s = resolveTurn(s, map, [])
    const after = s.nations[P]
    expect(after.debt).toBeLessThan(200)
    expect(after.defaultedUntil).toBeGreaterThan(s.turn)
    expect(validateOrder(s, map, { type: 'issueBonds', nationId: P, amount: 50 })).toMatch(/default/)
  })

  it('every nation starts with business, no debt and a rating', () => {
    const s = base()
    for (const id of SECTOR_IDS) expect(s.nations[P].sectors[id]).toBeGreaterThanOrEqual(0)
    expect(s.nations[P].debt).toBe(0)
  })
})
