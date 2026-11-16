import { MARKET, TRADE_LIMITS } from '../data/unitTypes'
import { MATERIALS } from '../data/deposits'
import { ECON, computeEconomy, marketSpread } from './economy'
import { clamp } from './helpers'
import type { GameState, Nation, NationId, ResourceBundle, TradeResource, TradeTerms, WorldMap } from './types'
import { TRADE_RESOURCES } from './types'

export type MarketPrices = Record<TradeResource, number>

export const stockOf = (n: Nation, r: TradeResource) => (r === 'manpower' ? n.militaryPool : n.resources[r])

function adjustStock(n: Nation, r: TradeResource, delta: number) {
  if (r === 'manpower') n.militaryPool = Math.max(0, n.militaryPool + delta)
  else n.resources[r] += delta
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Capital value of one unit of each resource, driven by how scarce it is across the living world. */
export function marketPrices(s: GameState): MarketPrices {
  const alive = Object.values(s.nations).filter((n) => n.alive)
  const out = {} as MarketPrices
  for (const r of TRADE_RESOURCES) {
    const m = median(alive.map((n) => stockOf(n, r)))
    const push = 1 + clamp(s.marketPressure?.[r] ?? 0, MATERIALS.pressureMin, MATERIALS.pressureMax)
    out[r] = Math.round(MARKET[r].base * clamp(Math.sqrt(MARKET[r].reference / Math.max(1, m)), MATERIALS.priceMin, MATERIALS.priceMax) * push * 100) / 100
  }
  return out
}

/** Records a trade on the world market: buying pushes the price up, selling pushes it down. */
export function pushMarket(s: GameState, r: TradeResource, amount: number) {
  const p = (s.marketPressure ??= {})
  p[r] = clamp((p[r] ?? 0) + (amount / MATERIALS.pressureScale) * 0.1, MATERIALS.pressureMin, MATERIALS.pressureMax)
}

/** The month's fading of the market's memory of big trades. */
export function fadeMarket(s: GameState) {
  if (!s.marketPressure) return
  for (const r of Object.keys(s.marketPressure) as TradeResource[]) {
    const v = (s.marketPressure[r] ?? 0) * (1 - MATERIALS.pressureFade)
    if (Math.abs(v) < 0.002) delete s.marketPressure[r]
    else s.marketPressure[r] = v
  }
}

/** Materials and food can be bought and sold on the world market. Money, research and soldiers cannot. */
export const MARKET_GOODS: TradeResource[] = ['food', 'oil', 'steel', 'goods']

/** Money for `amount` of a resource: what the nation pays when buying, or is paid when selling. */
export function marketValue(s: GameState, n: Nation, r: TradeResource, amount: number, side: 'buy' | 'sell', prices: MarketPrices = marketPrices(s)): number {
  const spread = marketSpread(n)
  return amount * prices[r] * (side === 'buy' ? 1 + spread : 1 - spread)
}

/** Units this nation can still move through the market this month. */
export function tradeRoom(s: GameState, map: WorldMap, nationId: NationId): number {
  const n = s.nations[nationId]
  const cap = computeEconomy(s, map, nationId).tradeCapacity * ((n.embargoedUntil ?? 0) >= s.turn ? ECON.embargoTradeMult : 1)
  return Math.max(0, cap - (n.tradeUsed ?? 0))
}

export const bundleEntries = (b: ResourceBundle) =>
  TRADE_RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => [r, b[r] as number] as const)

export const bundleEmpty = (b: ResourceBundle) => bundleEntries(b).length === 0

export function bundleValue(b: ResourceBundle, prices: MarketPrices): number {
  return bundleEntries(b).reduce((sum, [r, v]) => sum + v * prices[r], 0)
}

/** The first resource `n` cannot cover, or null. */
export function shortfall(n: Nation, b: ResourceBundle): TradeResource | null {
  for (const [r, v] of bundleEntries(b)) if (stockOf(n, r) < v) return r
  return null
}

export function transferBundle(s: GameState, from: NationId, to: NationId, b: ResourceBundle) {
  for (const [r, v] of bundleEntries(b)) {
    adjustStock(s.nations[from], r, -v)
    adjustStock(s.nations[to], r, v)
  }
}

export function describeBundle(b: ResourceBundle): string {
  const parts = bundleEntries(b).map(([r, v]) => `${Math.round(v)} ${MARKET[r].name}`)
  return parts.length ? parts.join(' + ') : 'nothing'
}

export function validateTradeTerms(s: GameState, terms: TradeTerms, proposer: NationId, target: NationId): string | null {
  if (!Number.isInteger(terms.months) || terms.months < 0 || terms.months > TRADE_LIMITS.maxMonths) return `Deals run up to ${TRADE_LIMITS.maxMonths} months`
  for (const b of [terms.give, terms.receive])
    for (const r of TRADE_RESOURCES) {
      const v = b[r]
      if (v === undefined) continue
      if (!Number.isFinite(v) || v < 0 || v > TRADE_LIMITS.maxAmount) return 'Invalid amount'
    }
  const live = terms.start !== undefined || terms.collateral !== undefined || !!terms.joinWars
  if (live) {
    if (terms.months < 1) return 'A live contract runs for at least a month'
    if (terms.start !== undefined && (!Number.isInteger(terms.start) || terms.start < 0 || terms.start > TRADE_LIMITS.maxStart)) return `A contract can start up to ${TRADE_LIMITS.maxStart} months from now`
    if (terms.collateral !== undefined && (!Number.isFinite(terms.collateral) || terms.collateral < 0 || terms.collateral > TRADE_LIMITS.maxCollateral)) return `Collateral goes up to ${TRADE_LIMITS.maxCollateral} money`
  }
  if (bundleEmpty(terms.give) && bundleEmpty(terms.receive) && !terms.joinWars) return 'The deal is empty'
  const mine = shortfall(s.nations[proposer], terms.give)
  if (mine) return `Not enough ${MARKET[mine].name.toLowerCase()}`
  if ((terms.collateral ?? 0) > 0 && s.nations[proposer].resources.capital < (terms.collateral ?? 0) + (terms.give.capital ?? 0)) return 'Not enough money for the collateral'
  const theirs = shortfall(s.nations[target], terms.receive)
  if (theirs) return `${s.nations[target].name} does not have enough ${MARKET[theirs].name.toLowerCase()}`
  return null
}
