import { describe, expect, it } from 'vitest'
import { COMPANY_CAP, STOCKS, TIERS } from '../../data/companies'
import { getWorld } from '../../map/world'
import { computeEconomy } from '../economy'
import { normalizeGame } from '../migrate'
import { orderCost, validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { createRng } from '../rng'
import { fundSystemCost } from '../systems'
import { companiesOf, companyCount, companyEffects, directiveOf, homeOwner, newStocks, portfolio, runStocks, stake, tierOf, tradeValue } from '../stocks'
import type { GameState, Order, SectorId } from '../types'
import { giveRegions, lineMap, startState } from './fixtures'

const map = lineMap(6)

/** r0 is the player and is home to one company; r1 has one too. */
function exchange(sector: SectorId = 'technology') {
  const s = startState(map)
  const mine = companiesOf(s, 'r0')[0]
  s.stocks.meta[mine].sector = sector
  s.nations.r0.resources.capital = 20000
  return { s, mine, theirs: companiesOf(s, 'r1')[0] }
}
const buy = (company: string, shares: number): Order => ({ type: 'buyShares', nationId: 'r0', company, shares })
const sell = (company: string, shares: number): Order => ({ type: 'sellShares', nationId: 'r0', company, shares })
const tell = (company: string, directive: 'payout' | 'expand' | 'focus'): Order => ({ type: 'setDirective', nationId: 'r0', company, directive })
const own = (s: GameState, company: string, shares: number) => {
  s.stocks.held.r0 = { ...(s.stocks.held.r0 ?? {}), [company]: shares }
}

describe('which companies exist', () => {
  const { map: world } = getWorld()
  const stocks = newStocks(world)
  const perCountry: Record<string, number> = {}
  for (const c of Object.values(stocks.meta)) perCountry[c.home] = (perCountry[c.home] ?? 0) + 1

  it('no country has more than two, and only well-developed ones have any', () => {
    expect(Math.max(...Object.values(perCountry))).toBeLessThanOrEqual(2)
    for (const r of Object.values(world.regions)) expect(perCountry[r.id] ?? 0).toBe(companyCount(r.development))
    expect(companyCount(0.3)).toBe(0)
    expect(companyCount(0.6)).toBe(1)
    expect(companyCount(0.9)).toBe(2)
  })

  it('a very, very developed country has two companies in different sectors', () => {
    const rich = Object.values(world.regions).filter((r) => r.development >= 0.85)
    expect(rich.length).toBeGreaterThan(10)
    for (const r of rich) {
      const sectors = Object.values(stocks.meta).filter((c) => c.home === r.id).map((c) => c.sector)
      expect(sectors.length).toBe(2)
      expect(new Set(sectors).size).toBe(2)
    }
  })

  it('has well-known names where they fit, unique names and ids, and prices from the home economy', () => {
    expect(stocks.meta.nimbus?.home).toBe('united-states-of-america')
    expect(new Set(Object.values(stocks.meta).map((c) => c.name)).size).toBe(Object.keys(stocks.meta).length)
    for (const [id, c] of Object.entries(stocks.meta)) {
      expect(stocks.price[id]).toBe(c.base)
      expect(c.base).toBeGreaterThan(0)
      expect(world.regions[c.home]).toBeTruthy()
    }
    // A big economy's company is worth more than a small one's.
    expect(stocks.meta.nimbus.base * STOCKS.float).toBeGreaterThan(stocks.meta.fjordlabs.base * STOCKS.float)
  })

  it('is the same list every time, so every screen of an online game agrees', () => {
    expect(JSON.stringify(newStocks(world))).toBe(JSON.stringify(newStocks(world)))
  })
})

describe('investing in your own territory', () => {
  it('you can invest at home, and not in a country you do not hold', () => {
    const { s, mine, theirs } = exchange()
    expect(homeOwner(s, mine)).toBe('r0')
    expect(validateOrder(s, map, buy(mine, 10))).toBeNull()
    expect(validateOrder(s, map, buy(theirs, 10))).toMatch(/own territory/)
    giveRegions(s, 'r0', ['r1'])
    expect(validateOrder(s, map, buy(theirs, 10))).toBeNull()
    expect(validateOrder(s, map, buy('missing', 1))).toMatch(/not listed/)
  })

  it('buying costs the price plus a fee and pushes the price up; selling pays less and pushes it down', () => {
    const { s, mine } = exchange()
    const price = s.stocks.price[mine]
    const cost = orderCost(s, buy(mine, 100)).capital
    expect(cost).toBe(Math.round(tradeValue(s, mine, 100, 'buy')))
    expect(cost).toBeGreaterThan(100 * price * (1 + STOCKS.fee) - 1)
    const bought = structuredClone(s)
    expect(applyOrderNow(bought, map, buy(mine, 100)).error).toBeNull()
    expect(stake(bought, 'r0', mine)).toBe(100)
    expect(bought.stocks.price[mine]).toBeGreaterThan(price)
    const sold = structuredClone(bought)
    expect(applyOrderNow(sold, map, sell(mine, 100)).error).toBeNull()
    expect(sold.stocks.price[mine]).toBeLessThan(bought.stocks.price[mine])
    // Buying and selling straight back loses money to the fee and to the price moving.
    expect(sold.nations.r0.resources.capital).toBeLessThan(s.nations.r0.resources.capital)
  })

  it('a bigger trade moves the price more, and pays a worse average price', () => {
    const { s, mine } = exchange()
    const small = tradeValue(s, mine, 100, 'buy') / 100
    const big = tradeValue(s, mine, 500, 'buy') / 500
    expect(big).toBeGreaterThan(small)
    const a = structuredClone(s)
    const b = structuredClone(s)
    applyOrderNow(a, map, buy(mine, 100))
    applyOrderNow(b, map, buy(mine, 500))
    expect(b.stocks.price[mine]).toBeGreaterThan(a.stocks.price[mine])
  })

  it('charges for a purchase exactly once, whether it is bought at once or at month end', () => {
    const { s, mine } = exchange()
    const cost = orderCost(s, buy(mine, 50)).capital
    const now = structuredClone(s)
    expect(applyOrderNow(now, map, buy(mine, 50)).error).toBeNull()
    expect(s.nations.r0.resources.capital - now.nations.r0.resources.capital).toBe(cost)
    const month = resolveTurn(s, map, [buy(mine, 50)])
    const idle = resolveTurn(s, map, [])
    expect(stake(month, 'r0', mine)).toBe(50)
    // The month also brings income, so compare to a month with no purchase; dividends on the new shares are tiny.
    expect(idle.nations.r0.resources.capital - month.nations.r0.resources.capital).toBeCloseTo(cost, -1)
  })

  it('needs the money, and you cannot own more than all of it', () => {
    const { s, mine } = exchange()
    s.nations.r0.resources.capital = 1
    expect(validateOrder(s, map, buy(mine, 100))).toMatch(/money/)
    s.nations.r0.resources.capital = 1e6
    own(s, mine, 950)
    expect(validateOrder(s, map, buy(mine, 100))).toMatch(/Only 1000/)
    expect(validateOrder(s, map, sell(mine, 951))).toMatch(/do not hold/)
    expect(validateOrder(s, map, sell(mine, 950))).toBeNull()
  })

  it('a player can reach a board seat of a modest company from the first months of a game', () => {
    const { map: world } = getWorld()
    const s = startState(world, 'poland')
    const company = companiesOf(s, 'poland')[0]
    const seat = Math.ceil(TIERS[1].at * STOCKS.float)
    // Poland starts with about 70 money and earns about 28 a month.
    expect(tradeValue(s, company, seat, 'buy')).toBeLessThan(s.nations.poland.resources.capital + 3 * 28)
  })
})

describe('owning a share of a company', () => {
  it('has four rungs: investor, board seat, control, dominant', () => {
    expect(tierOf(0.05)).toBe(-1)
    expect(tierOf(0.1)).toBe(0)
    expect(tierOf(0.24)).toBe(0)
    expect(tierOf(0.25)).toBe(1)
    expect(tierOf(0.5)).toBe(1)
    expect(tierOf(0.51)).toBe(2)
    expect(tierOf(0.75)).toBe(3)
    expect(tierOf(1)).toBe(3)
  })

  it('needs a board seat to give the company instructions', () => {
    const { s, mine } = exchange()
    own(s, mine, 240)
    expect(validateOrder(s, map, tell(mine, 'focus'))).toMatch(/board seat/)
    own(s, mine, 250)
    expect(validateOrder(s, map, tell(mine, 'focus'))).toBeNull()
    expect(validateOrder(s, map, tell('r1:x', 'focus'))).toMatch(/not listed/)
    const { theirs } = exchange()
    expect(validateOrder(s, map, tell(theirs, 'focus'))).toMatch(/own territory|not listed/)
  })

  it('an instruction sticks until changed, and ends when the board seat is sold', () => {
    const { s, mine } = exchange()
    own(s, mine, 300)
    expect(applyOrderNow(s, map, tell(mine, 'expand')).error).toBeNull()
    expect(directiveOf(s, mine)).toBe('expand')
    const next = resolveTurn(s, map, [])
    expect(directiveOf(next, mine)).toBe('expand')
    expect(applyOrderNow(s, map, sell(mine, 100)).error).toBeNull()
    expect(directiveOf(s, mine)).toBe('payout')
  })

  it('half strength at a board seat, full at control, a quarter more when dominant', () => {
    const { s, mine } = exchange('technology')
    const power = (shares: number) => {
      own(s, mine, shares)
      s.stocks.directive[mine] = 'focus'
      return companyEffects(s, 'r0').research
    }
    expect(power(100)).toBe(0)
    const half = power(300)
    const full = power(600)
    const top = power(800)
    expect(half).toBeGreaterThan(0)
    expect(full).toBeCloseTo(half * 2, 5)
    expect(top).toBeCloseTo(full * 1.25, 5)
  })
})

describe('what a company does when told to', () => {
  it('"Specialize" in technology raises research and makes Frontier systems cheaper', () => {
    const { s, mine } = exchange('technology')
    own(s, mine, 600)
    const base = computeEconomy(s, map, 'r0').tpGain
    const cost = fundSystemCost(s, { type: 'fundSystem', nationId: 'r0', system: 'ai', levels: 1 })
    s.stocks.directive[mine] = 'focus'
    expect(computeEconomy(s, map, 'r0').tpGain).toBeGreaterThan(base)
    expect(fundSystemCost(s, { type: 'fundSystem', nationId: 'r0', system: 'ai', levels: 1 })).toBeLessThan(cost)
  })

  it('"Specialize" in arms makes units cheaper', () => {
    const { s, mine } = exchange('arms')
    own(s, mine, 600)
    const unit: Order = { type: 'queueTrain', nationId: 'r0', unit: 'infantry' }
    const before = orderCost(s, unit).capital
    s.stocks.directive[mine] = 'focus'
    expect(orderCost(s, unit).capital).toBeLessThan(before)
    expect(companyEffects(s, 'r0').armsDiscount).toBeGreaterThan(0)
  })

  it('"Specialize" in farming, energy, manufacturing and finance each do something for the nation', () => {
    for (const sector of ['farming', 'energy', 'manufacturing', 'finance'] as SectorId[]) {
      const { s, mine } = exchange(sector)
      own(s, mine, 600)
      s.stocks.directive[mine] = 'focus'
      const e = companyEffects(s, 'r0')
      const total = e.output + e.factory + e.money + e.trade + e.growth - e.foodUse + e.stability
      expect(total, sector).toBeGreaterThan(0)
    }
  })

  it('"Expand the business" grows the sector faster and pays no dividends', () => {
    const plain = exchange('manufacturing')
    const grown = exchange('manufacturing')
    own(plain.s, plain.mine, 600)
    own(grown.s, grown.mine, 600)
    grown.s.stocks.directive[grown.mine] = 'expand'
    let a = plain.s
    let b = grown.s
    for (let i = 0; i < 6; i++) {
      a = resolveTurn(a, map, [])
      b = resolveTurn(b, map, [])
    }
    expect(b.nations.r0.sectors.manufacturing).toBeGreaterThan(a.nations.r0.sectors.manufacturing)
    expect(portfolio(grown.s, 'r0').dividends).toBe(0)
    expect(portfolio(plain.s, 'r0').dividends).toBeGreaterThan(0)
  })

  it('dividends: paying out is best, specializing pays a little, and a small holding just pays out', () => {
    const { s, mine } = exchange()
    own(s, mine, 600)
    const value = 600 * s.stocks.price[mine]
    expect(portfolio(s, 'r0').dividends).toBeCloseTo(value * STOCKS.dividend.payout)
    s.stocks.directive[mine] = 'focus'
    expect(portfolio(s, 'r0').dividends).toBeCloseTo(value * STOCKS.dividend.focus)
    own(s, mine, 100)
    expect(portfolio(s, 'r0').dividends).toBeCloseTo(100 * s.stocks.price[mine] * STOCKS.dividend.payout)
    const before = s.nations.r0.resources.capital
    const next = resolveTurn(s, map, [])
    expect(next.nations.r0.resources.capital).toBeGreaterThan(before)
  })

  it('however many companies you run, the bonus stops growing', () => {
    const { s } = exchange('technology')
    giveRegions(s, 'r0', ['r1', 'r2', 'r3', 'r4', 'r5'])
    for (const company of companiesOf(s, 'r0')) {
      s.stocks.meta[company].sector = 'technology'
      own(s, company, 1000)
      s.stocks.directive[company] = 'focus'
      // The nation holds them in full, not only a recent conquest's half.
    }
    for (const r of Object.values(s.regions)) r.integration = 1
    expect(companyEffects(s, 'r0').research).toBeLessThanOrEqual(COMPANY_CAP.effect)
    expect(companyEffects(s, 'r0').research).toBeGreaterThan(0.2)
  })

  it('a conquered country counts for less until it has settled', () => {
    const { s } = exchange('technology')
    giveRegions(s, 'r0', ['r1'])
    const company = companiesOf(s, 'r0').find((c) => s.stocks.meta[c].home === 'r1')!
    s.stocks.meta[company].sector = 'technology'
    own(s, company, 1000)
    s.stocks.directive[company] = 'focus'
    s.regions.r1.integration = 1
    const settled = companyEffects(s, 'r0').research
    s.regions.r1.integration = 0
    expect(companyEffects(s, 'r0').research).toBeLessThan(settled)
  })
})

describe('shares follow the land', () => {
  it('whoever takes a country takes its companies, and the instruction is reset', () => {
    const { s, mine } = exchange()
    own(s, mine, 600)
    s.stocks.directive[mine] = 'focus'
    s.regions.r0.owner = 'r1'
    runStocks(s, map, createRng(1, 1))
    expect(stake(s, 'r0', mine)).toBe(0)
    expect(stake(s, 'r1', mine)).toBe(600)
    expect(directiveOf(s, mine)).toBe('payout')
    expect(companiesOf(s, 'r1')).toContain(mine)
  })

  it('a company whose country is gone is worth less each month and its shares vanish', () => {
    const { s, mine } = exchange()
    own(s, mine, 50)
    const price = s.stocks.price[mine]
    s.nations.r0.alive = false
    runStocks(s, map, createRng(1, 1))
    expect(s.stocks.price[mine]).toBeLessThan(price)
    expect(stake(s, 'r0', mine)).toBe(0)
  })

  it('prices follow the home economy: a country in trouble sinks its companies', () => {
    const calm = exchange()
    const shaky = exchange()
    shaky.s.nations.r0.stability = 15
    shaky.s.nations.r0.inDebt = true
    for (let i = 0; i < 12; i++) {
      runStocks(calm.s, map, createRng(5, i))
      runStocks(shaky.s, map, createRng(5, i))
    }
    expect(shaky.s.stocks.price[shaky.mine]).toBeLessThan(calm.s.stocks.price[calm.mine])
    expect(calm.s.stocks.index).toBeGreaterThan(0)
  })
})

describe('older saves', () => {
  it('cash out old holdings anywhere in the world and open the new exchange', () => {
    const s = startState(map)
    const money = s.nations.r0.resources.capital
    const old = s as unknown as { stocks: { price: Record<string, number>; held: Record<string, Record<string, number>>; meta?: unknown; directive?: unknown } }
    delete old.stocks.meta
    delete old.stocks.directive
    old.stocks.price = { nimbus: 5, helix: 5 }
    old.stocks.held = { r0: { nimbus: 100, helix: 40 } }
    const game = normalizeGame(s, map)
    expect(game.stocks.held.r0 ?? {}).toEqual({})
    expect(game.stocks.directive).toEqual({})
    expect(Object.keys(game.stocks.meta).length).toBeGreaterThan(0)
    expect(game.nations.r0.resources.capital).toBeCloseTo(money + 140 * 5 * 0.99)
  })
})
