import { MARKET, TRADE_LIMITS } from '../data/unitTypes'
import { clamp } from './helpers'
import type { GameState, Nation, NationId, ResourceBundle, TradeResource, TradeTerms } from './types'
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
    out[r] = Math.round(MARKET[r].base * clamp(Math.sqrt(MARKET[r].reference / Math.max(1, m)), 0.6, 1.8) * 100) / 100
  }
  return out
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
  if (bundleEmpty(terms.give) && bundleEmpty(terms.receive)) return 'The deal is empty'
  const mine = shortfall(s.nations[proposer], terms.give)
  if (mine) return `You lack the ${MARKET[mine].name}`
  const theirs = shortfall(s.nations[target], terms.receive)
  if (theirs) return `${s.nations[target].name} lacks the ${MARKET[theirs].name}`
  return null
}
