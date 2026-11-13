import { afterEach, describe, expect, it } from 'vitest'
import { MATERIALS, OIL_DEPOSITS, STEEL_DEPOSITS } from '../../data/deposits'
import { UNIT_SPECS } from '../../data/unitTypes'
import { computeEconomy } from '../economy'
import { validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { marketPrices, marketValue, tradeRoom } from '../trade'
import type { GameState } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(3)
const P = 'r0'

function base(): GameState {
  const s = startState(map)
  s.nations[P].resources.capital = 500
  return s
}

afterEach(() => {
  delete OIL_DEPOSITS.r0
  delete STEEL_DEPOSITS.r0
})

describe('materials', () => {
  it('oil comes from deposits and steel from deposits plus factories', () => {
    const s = base()
    const before = computeEconomy(s, map, P)
    expect(before.oilProduction).toBe(0)
    OIL_DEPOSITS.r0 = 5
    STEEL_DEPOSITS.r0 = 2
    const after = computeEconomy(s, map, P)
    expect(after.oilProduction).toBeCloseTo(5)
    expect(after.steelProduction).toBeCloseTo(before.steelProduction + 2)
    s.regions.r0.integration = 0
    expect(computeEconomy(s, map, P).oilProduction).toBeCloseTo(5 * 0.4)
  })

  it('tanks, planes and ships burn oil every month; infantry does not', () => {
    const s = base()
    setMilitary(s, P, { infantry: 10 })
    expect(computeEconomy(s, map, P).oilUse).toBe(0)
    setMilitary(s, P, { armor: 4, naval: 2 })
    expect(computeEconomy(s, map, P).oilUse).toBeCloseTo(4 * UNIT_SPECS.armor.oil + 2 * UNIT_SPECS.naval.oil)
  })

  it('running out of oil cripples vehicles in battle until oil is found again', () => {
    const s = base()
    s.wars = ['r0|r1']
    setMilitary(s, P, { armor: 10, infantry: 4 })
    setMilitary(s, 'r1', { infantry: 6 })
    s.nations[P].autoBuy = []
    s.nations[P].resources.oil = 0
    s.nations[P].resources.capital = 20
    const dry = resolveTurn(s, map, [])
    expect(dry.nations[P].oilShortage).toBe(true)
    const result = applyOrderNow(dry, map, { type: 'attack', nationId: P, target: 'r1', commit: 'allin' })
    expect(result.battle?.modifiers.some((m) => /no oil/.test(m))).toBe(true)
    dry.nations[P].resources.oil = 50
    expect(resolveTurn(dry, map, []).nations[P].oilShortage).toBe(false)
  })

  it('goods run out and the people grow restless', () => {
    const s = base()
    s.nations[P].autoBuy = []
    s.nations[P].resources.goods = 0
    const fed = computeEconomy(s, map, P).stabilityTarget
    const dry = resolveTurn(s, map, [])
    expect(dry.nations[P].goodsShortage).toBe(computeEconomy(s, map, P).netGoods < 0)
    dry.nations[P].goodsShortage = true
    expect(computeEconomy(dry, map, P).stabilityTarget).toBeCloseTo(fed - MATERIALS.noGoodsStability, 5)
  })

  it('auto-buy keeps a reserve of what the nation burns, and never spends the last money', () => {
    const s = base()
    setMilitary(s, P, { armor: 20 })
    s.nations[P].resources.oil = 0
    s.nations[P].autoBuy = ['oil']
    const next = resolveTurn(s, map, [])
    expect(next.nations[P].oilShortage).toBe(false)
    expect(next.nations[P].resources.oil).toBeGreaterThan(0)
    expect(next.nations[P].resources.capital).toBeLessThan(s.nations[P].resources.capital + computeEconomy(s, map, P).netCapital)
    const poor = base()
    setMilitary(poor, P, { armor: 20 })
    poor.nations[P].resources.oil = 0
    poor.nations[P].resources.capital = 15
    poor.nations[P].autoBuy = ['oil']
    expect(resolveTurn(poor, map, []).nations[P].resources.capital).toBeGreaterThanOrEqual(0)
  })
})

describe('the world market', () => {
  it('buying costs the price plus the spread, selling pays the price minus it', () => {
    const s = base()
    const prices = marketPrices(s)
    const buy = marketValue(s, s.nations[P], 'oil', 10, 'buy', prices)
    const sell = marketValue(s, s.nations[P], 'oil', 10, 'sell', prices)
    expect(buy).toBeCloseTo(10 * prices.oil * (1 + MATERIALS.spread))
    expect(sell).toBeCloseTo(10 * prices.oil * (1 - MATERIALS.spread))
    s.regions.r0.buildings.port = 3
    const before = s.nations[P].resources
    const money = before.capital
    expect(applyOrderNow(s, map, { type: 'marketBuy', nationId: P, resource: 'oil', amount: 10 }).error).toBeNull()
    expect(s.nations[P].resources.oil).toBeCloseTo(8 + 10)
    expect(s.nations[P].resources.capital).toBeCloseTo(money - buy)
    expect(applyOrderNow(s, map, { type: 'marketSell', nationId: P, resource: 'oil', amount: 10 }).error).toBeNull()
    expect(s.nations[P].resources.capital).toBeLessThan(money)
  })

  it('is limited by trade capacity, which ports raise', () => {
    const s = base()
    const room = tradeRoom(s, map, P)
    expect(room).toBeCloseTo(computeEconomy(s, map, P).tradeCapacity)
    expect(validateOrder(s, map, { type: 'marketBuy', nationId: P, resource: 'steel', amount: room + 5 })).toMatch(/trade capacity|move/)
    s.regions.r0.buildings.port = 3
    expect(tradeRoom(s, map, P)).toBeGreaterThan(room)
    applyOrderNow(s, map, { type: 'marketBuy', nationId: P, resource: 'steel', amount: tradeRoom(s, map, P) })
    expect(tradeRoom(s, map, P)).toBeCloseTo(0)
    expect(resolveTurn(s, map, []).nations[P].tradeUsed).toBe(0)
  })

  it('only food and materials can be traded, and you cannot sell what you lack', () => {
    const s = base()
    expect(validateOrder(s, map, { type: 'marketBuy', nationId: P, resource: 'capital', amount: 5 })).toMatch(/cannot be traded/)
    expect(validateOrder(s, map, { type: 'marketSell', nationId: P, resource: 'oil', amount: 9999 })).toMatch(/trade capacity|move|do not have/)
    s.nations[P].resources.oil = 1
    expect(validateOrder(s, map, { type: 'marketSell', nationId: P, resource: 'oil', amount: 5 })).toMatch(/do not have/)
  })

  it('scarcity raises prices', () => {
    const s = base()
    const plenty = marketPrices(s).oil
    for (const n of Object.values(s.nations)) n.resources.oil = 1
    expect(marketPrices(s).oil).toBeGreaterThan(plenty)
  })
})

describe('steel for units', () => {
  it('a tank needs steel, and steel bought on the market in the same list counts', () => {
    const s = base()
    s.nations[P].resources.steel = 0
    const train = { type: 'queueTrain', nationId: P, unit: 'armor' } as const
    expect(validateOrder(s, map, train)).toMatch(/Not enough steel/)
    expect(validateOrder(s, map, train, [{ type: 'marketBuy', nationId: P, resource: 'steel', amount: 6 }])).toBeNull()
    s.nations[P].resources.steel = 10
    const steelBefore = s.nations[P].resources.steel
    applyOrderNow(s, map, train)
    expect(s.nations[P].resources.steel).toBe(steelBefore - UNIT_SPECS.armor.steel)
    const jobId = s.trainingQueue[s.trainingQueue.length - 1].id
    applyOrderNow(s, map, { type: 'cancelTrain', nationId: P, jobId })
    expect(s.nations[P].resources.steel).toBe(steelBefore)
  })

  it('infantry needs none', () => {
    const s = base()
    s.nations[P].resources.steel = 0
    expect(validateOrder(s, map, { type: 'queueTrain', nationId: P, unit: 'infantry' })).toBeNull()
  })
})
