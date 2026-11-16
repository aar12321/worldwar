import { describe, expect, it } from 'vitest'
import { computeEconomy } from '../economy'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { companiesOf, stake, tradeValue } from '../stocks'
import type { GameState } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(6)
const P = 'r0'

/**
 * A carry trade: sell bonds at the bank's rate, put the money into the home company's shares, wait, then sell the shares and repay.
 * Share prices are held where they started so only what the shares pay, what the bonds cost and the fees remain. Returns the money
 * made over a twin that did nothing.
 */
function carry(borrow: number, months: number) {
  const idle = startState(map)
  const trader = startState(map)
  for (const s of [idle, trader]) s.nations[P].resources.capital = 400
  const company = companiesOf(trader, P)[0]
  // A dear company (a hundred times the price), so that rounding a trade up to a whole coin does not drown the small sums.
  trader.stocks.meta[company].base *= 100
  trader.stocks.price[company] *= 100
  const price = trader.stocks.price[company]
  const room = computeEconomy(trader, map, P).credit.room
  const amount = Math.min(borrow, Math.floor(room))
  expect(applyOrderNow(trader, map, { type: 'issueBonds', nationId: P, amount, term: 36 }).error).toBeNull()
  // Buy shares in small lots, as a patient trader would, putting the price back each time: price impact is not what is being tested.
  const lot = 5
  let shares = 0
  while (shares + lot <= 1000 && tradeValue(trader, company, lot, 'buy') <= trader.nations[P].resources.capital - 400) {
    expect(applyOrderNow(trader, map, { type: 'buyShares', nationId: P, company, shares: lot }).error).toBeNull()
    trader.stocks.price[company] = price
    shares += lot
  }
  let a: GameState = idle
  let b: GameState = trader
  for (let i = 0; i < months; i++) {
    b.stocks.price[company] = price
    a = resolveTurn(a, map, [])
    b = resolveTurn(b, map, [])
  }
  b.stocks.price[company] = price
  for (let left = stake(b, P, company); left > 0; left -= lot) {
    expect(applyOrderNow(b, map, { type: 'sellShares', nationId: P, company, shares: Math.min(lot, left) }).error).toBeNull()
    b.stocks.price[company] = price
  }
  b.nations[P].resources.capital -= b.nations[P].debt
  return { shares, amount, net: b.nations[P].resources.capital - a.nations[P].resources.capital }
}

describe('fair returns', () => {
  it('borrowing with bonds to buy dividend shares earns nothing, however much is borrowed', () => {
    for (const borrow of [100, 250, 400]) {
      const r = carry(borrow, 24)
      expect(r.shares, `${borrow} borrowed`).toBeGreaterThan(0)
      expect(r.net, `${borrow} borrowed for 24 months`).toBeLessThanOrEqual(1e-6)
    }
  }, 120_000)

  it('and not for three years either', () => {
    for (const borrow of [100, 300]) expect(carry(borrow, 36).net, `${borrow} borrowed`).toBeLessThanOrEqual(1e-6)
  }, 120_000)
})
