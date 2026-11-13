import { describe, expect, it } from 'vitest'
import { COMPANIES, STOCKS } from '../../data/companies'
import { getWorld } from '../../map/world'
import { orderCost, validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { createRng } from '../rng'
import { homeOwner, newStocks, portfolio, runStocks, shareOfCountry, stake } from '../stocks'
import { lineMap, startState } from './fixtures'

const map = lineMap(6)
/** A world where r1 is home to one company. */
function exchange() {
  const s = startState(map)
  s.stocks.price = { nimbus: STOCKS.startPrice, helix: STOCKS.startPrice }
  s.stocks.last = { ...s.stocks.price }
  const spec = COMPANIES.find((c) => c.id === 'nimbus')!
  const home = { ...spec, home: 'r1' }
  Object.assign(spec, home)
  Object.assign(COMPANIES.find((c) => c.id === 'helix')!, { home: 'r1' })
  s.nations.r0.resources.capital = 5000
  return s
}
const buy = (company: string, shares: number) => ({ type: 'buyShares', nationId: 'r0', company, shares }) as const
const sell = (company: string, shares: number) => ({ type: 'sellShares', nationId: 'r0', company, shares }) as const

describe('the stock market', () => {
  it('lists real companies for countries on the map, all at the start price', () => {
    const { map: world } = getWorld()
    const stocks = newStocks(world)
    expect(Object.keys(stocks.price).length).toBeGreaterThan(25)
    for (const id of Object.keys(stocks.price)) expect(stocks.price[id]).toBe(STOCKS.startPrice)
    expect(Object.keys(stocks.price).length).toBe(COMPANIES.filter((c) => world.regions[c.home]).length)
  })

  it('buying costs the price plus a fee, selling pays the price minus it', () => {
    const s = exchange()
    expect(validateOrder(s, map, buy('nimbus', 10))).toBeNull()
    expect(orderCost(s, buy('nimbus', 10)).capital).toBe(Math.round(10 * STOCKS.startPrice * (1 + STOCKS.fee)))
    const bought = resolveTurn(s, map, [buy('nimbus', 10)])
    expect(stake(bought, 'r0', 'nimbus')).toBe(10)
    const idle = resolveTurn(s, map, [])
    expect(idle.nations.r0.resources.capital - bought.nations.r0.resources.capital).toBeCloseTo(10 * STOCKS.startPrice * (1 + STOCKS.fee), 0)
    expect(validateOrder(bought, map, sell('nimbus', 11))).toMatch(/do not hold/)
    expect(validateOrder(bought, map, sell('nimbus', 10))).toBeNull()
  })

  it('a player can afford shares from the first month', () => {
    const s = startState(map)
    s.stocks.price = { nimbus: STOCKS.startPrice }
    const home = COMPANIES.find((c) => c.id === 'nimbus')!
    home.home = 'r1'
    s.nations.r0.resources.capital = 118
    // Ten shares cost a few dozen money, a tiny share of a typical treasury, and a meaningful stake is within reach.
    expect(10 * STOCKS.startPrice * (1 + STOCKS.fee)).toBeLessThan(s.nations.r0.resources.capital * 0.5)
    expect(validateOrder(s, map, buy('nimbus', 10))).toBeNull()
    expect(validateOrder(s, map, buy('nimbus', 20))).toBeNull()
  })

  it('charges for a purchase exactly once, whether it is bought at once or at month end', () => {
    const s = exchange()
    const cost = orderCost(s, buy('nimbus', 10)).capital
    const now = structuredClone(s)
    expect(applyOrderNow(now, map, buy('nimbus', 10)).error).toBeNull()
    expect(s.nations.r0.resources.capital - now.nations.r0.resources.capital).toBe(cost)
    expect(stake(now, 'r0', 'nimbus')).toBe(10)
    const month = resolveTurn(s, map, [buy('nimbus', 10)])
    // The month also brings income and dividends, so compare to a month with no purchase.
    const idle = resolveTurn(s, map, [])
    expect(idle.nations.r0.resources.capital - month.nations.r0.resources.capital).toBeCloseTo(cost, 0)
  })

  it('limits one nation\'s stake and needs the money', () => {
    const s = exchange()
    expect(validateOrder(s, map, buy('nimbus', STOCKS.maxStake + 1))).toMatch(/more than/)
    s.nations.r0.resources.capital = 50
    expect(validateOrder(s, map, buy('nimbus', 10))).toMatch(/money/)
    expect(validateOrder(s, map, buy('missing', 1))).toMatch(/not listed/)
  })

  it('holdings pay a dividend every month', () => {
    const s = exchange()
    s.stocks.held.r0 = { nimbus: 100 }
    const before = s.nations.r0.resources.capital
    const next = resolveTurn(s, map, [])
    expect(portfolio(s, 'r0').dividends).toBeCloseTo(100 * STOCKS.startPrice * STOCKS.dividend)
    expect(next.nations.r0.resources.capital).toBeGreaterThan(before)
  })

  it('prices follow the home economy: a country in trouble sinks its companies', () => {
    const calm = exchange()
    const shaky = exchange()
    shaky.nations.r1.stability = 15
    shaky.nations.r1.inDebt = true
    for (let i = 0; i < 12; i++) {
      runStocks(calm, map, createRng(5, i))
      runStocks(shaky, map, createRng(5, i))
    }
    expect(shaky.stocks.price.nimbus).toBeLessThan(calm.stocks.price.nimbus)
    expect(calm.stocks.index).toBeGreaterThan(0)
  })

  it('a war with the home country seizes what you hold there', () => {
    const s = exchange()
    s.stocks.held.r0 = { nimbus: 50 }
    s.wars.push('r0|r1')
    runStocks(s, map, createRng(1, 1))
    expect(stake(s, 'r0', 'nimbus')).toBe(0)
    expect(validateOrder(s, map, buy('nimbus', 5))).toMatch(/at war/)
  })

  it('owning a tenth of a country\'s companies earns its goodwill', () => {
    const s = exchange()
    s.stocks.held.r0 = { nimbus: 1000, helix: 200 }
    expect(shareOfCountry(s, 'r0', 'r1')).toBeCloseTo(0.6)
    runStocks(s, map, createRng(1, 1))
    expect(homeOwner(s, 'nimbus')).toBe('r1')
    expect(s.opinions['r1>r0']?.some((m) => m.label === 'Invests in our companies' && m.value > 0)).toBe(true)
  })

  it('a company whose country is gone is worth less each month and its shares vanish', () => {
    const s = exchange()
    s.stocks.held.r0 = { nimbus: 50 }
    s.nations.r1.alive = false
    runStocks(s, map, createRng(1, 1))
    expect(s.stocks.price.nimbus).toBeLessThan(STOCKS.startPrice)
    expect(stake(s, 'r0', 'nimbus')).toBe(0)
  })
})
