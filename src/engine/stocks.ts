import { addOpinion } from '../ai/opinion'
import { COMPANIES, COMPANY_BY_ID, STOCKS } from '../data/companies'
import { worldTension } from './crises'
import { addLog, atWar, clamp, hasTech } from './helpers'
import type { Rng } from './rng'
import type { GameState, NationId, Order, StockState, WorldMap } from './types'

/** A fresh exchange. Only companies whose home country is on this map are listed. */
export function newStocks(map: WorldMap): StockState {
  const price: Record<string, number> = {}
  for (const co of COMPANIES) if (map.regions[co.home]) price[co.id] = STOCKS.startPrice
  return { price, last: { ...price }, size: {}, held: {}, mood: 0, index: 100 }
}

/** The nation that holds a company's home country now. */
export const homeOwner = (s: GameState, id: string): NationId | null => {
  const home = COMPANY_BY_ID[id]?.home
  return home ? s.regions[home]?.owner ?? null : null
}

export const stake = (s: GameState, nationId: NationId, company: string) => s.stocks.held[nationId]?.[company] ?? 0

/** What a nation's holdings are worth, and what they pay each month. */
export function portfolio(s: GameState, nationId: NationId): { value: number; dividends: number; lines: { company: string; shares: number; value: number }[] } {
  let value = 0
  const lines = []
  for (const [company, shares] of Object.entries(s.stocks.held[nationId] ?? {})) {
    if (shares <= 0 || s.stocks.price[company] === undefined) continue
    const v = shares * s.stocks.price[company]
    value += v
    lines.push({ company, shares, value: v })
  }
  return { value, dividends: value * STOCKS.dividend, lines }
}

export function validateTrade(s: GameState, o: Extract<Order, { type: 'buyShares' | 'sellShares' }>, pending: Order[] = []): string | null {
  const n = s.nations[o.nationId]
  const price = s.stocks.price[o.company]
  if (price === undefined) return 'That company is not listed'
  if (!Number.isFinite(o.shares) || o.shares < 1 || o.shares > STOCKS.float) return 'Choose a number of shares'
  const owner = homeOwner(s, o.company)
  if (o.type === 'sellShares') {
    const queued = pending.filter((p) => p.type === 'sellShares' && p.company === o.company).reduce((sum, p) => sum + (p as { shares: number }).shares, 0)
    return stake(s, o.nationId, o.company) - queued >= o.shares ? null : 'You do not hold that many shares'
  }
  if (!owner || !s.nations[owner]?.alive) return 'Its home country is gone'
  if (owner !== o.nationId && atWar(s, o.nationId, owner)) return 'You cannot invest in a country you are at war with'
  if (stake(s, o.nationId, o.company) + o.shares > STOCKS.maxStake) return `No nation may own more than ${STOCKS.maxStake} of ${STOCKS.float} shares`
  if (n.resources.capital < tradeValue(s, o.company, o.shares, 'buy')) return 'Not enough money'
  return null
}

/** Money a trade moves. Buying pays the fee on top, selling loses it. */
export function tradeValue(s: GameState, company: string, shares: number, side: 'buy' | 'sell'): number {
  const v = (s.stocks.price[company] ?? 0) * shares
  return side === 'buy' ? v * (1 + STOCKS.fee) : v * (1 - STOCKS.fee)
}

export function buyShares(s: GameState, nationId: NationId, company: string, shares: number) {
  const n = s.nations[nationId]
  n.resources.capital -= tradeValue(s, company, shares, 'buy')
  const book = (s.stocks.held[nationId] ??= {})
  book[company] = (book[company] ?? 0) + shares
}

export function sellShares(s: GameState, nationId: NationId, company: string, shares: number) {
  s.nations[nationId].resources.capital += tradeValue(s, company, shares, 'sell')
  const book = s.stocks.held[nationId]
  book[company] -= shares
  if (book[company] <= 0) delete book[company]
}

/** How much of a country's listed companies a nation owns, from 0 to 1. */
export function shareOfCountry(s: GameState, holder: NationId, country: NationId): number {
  let total = 0
  let mine = 0
  for (const id of Object.keys(s.stocks.price)) {
    if (homeOwner(s, id) !== country) continue
    total += STOCKS.float
    mine += stake(s, holder, id)
  }
  return total > 0 ? mine / total : 0
}

const SECTOR_TECH: Record<string, string[]> = { technology: ['frontier_ai', 'frontier_quantum', 'cyber_warfare'], arms: ['frontier_drones', 'frontier_hypersonic'] }

/** The month on the exchange: prices follow the home economies, dividends are paid, and wars seize what is held abroad. */
export function runStocks(s: GameState, _map: WorldMap, rng: Rng) {
  const st = s.stocks
  const tension = worldTension(s)
  // Market-wide mood: now and then a crash or a boom, fading each month.
  st.mood *= 0.6
  if (rng.chance(STOCKS.crash * (1 + tension / 25))) {
    st.mood -= 0.12
    addLog(s, 'news', 'Panic on the exchanges: share prices fall sharply around the world.', [])
  } else if (rng.chance(STOCKS.boom * (1 - tension / 200))) {
    st.mood += 0.05
    addLog(s, 'news', 'The world exchange rallies on good news.', [])
  }

  let sum = 0
  let count = 0
  for (const co of COMPANIES) {
    const price = st.price[co.id]
    if (price === undefined) continue
    const ownerId = homeOwner(s, co.id)
    const owner = ownerId ? s.nations[ownerId] : null
    st.last[co.id] = price
    if (!owner?.alive) {
      st.price[co.id] = Math.max(1, price * 0.8)
      continue
    }
    const size = owner.sectors[co.sector] ?? 0
    const before = st.size[co.id] ?? size
    st.size[co.id] = size
    const growth = before > 0 ? (size - before) / before : 0
    let r = 0.4 * growth + (owner.stability - 55) / 1500
    if (atWar(s, owner.id, owner.id) || s.wars.some((w) => w.split('|').includes(owner.id))) r -= 0.015
    if (s.crises.some((c) => c.nation === owner.id || c.rival === owner.id)) r -= 0.012
    if (owner.inDebt) r -= 0.015
    r -= Math.max(0, (owner.corporateTax ?? 0) - 0.2) * 0.1
    for (const t of SECTOR_TECH[co.sector] ?? []) if (hasTech(owner, t)) r += 0.003
    r += st.mood
    const noise = (rng.next() - 0.5) * 2 * (0.015 + tension / 3000)
    // Prices drift back toward 100 over the long run, so no company runs away forever.
    const pull = (STOCKS.startPrice * 1.5 - price) / (STOCKS.startPrice * 1.5) * 0.004
    st.price[co.id] = clamp(price * (1 + r + noise + pull), 1, 2000)
    sum += st.price[co.id] / STOCKS.startPrice
    count++
  }
  st.index = count > 0 ? (sum / count) * 100 : st.index

  // Dividends, seizure in war, and the goodwill of countries whose companies you own.
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
    const book = st.held[n.id]
    if (!book) continue
    for (const company of Object.keys(book)) {
      const ownerId = homeOwner(s, company)
      if (st.price[company] === undefined || !ownerId || !s.nations[ownerId]?.alive) {
        delete book[company]
        continue
      }
      if (ownerId !== n.id && atWar(s, n.id, ownerId)) {
        if (n.isPlayer) addLog(s, 'economy', `${s.nations[ownerId].name} seized your shares in ${COMPANY_BY_ID[company].name}.`, [n.id, ownerId])
        delete book[company]
      }
    }
    const { dividends } = portfolio(s, n.id)
    n.resources.capital += dividends
    for (const country of new Set(Object.keys(book).map((c) => homeOwner(s, c)).filter((x): x is NationId => !!x && x !== n.id))) {
      const share = shareOfCountry(s, n.id, country)
      if (share >= 0.1) addOpinion(s, country, n.id, 'Invests in our companies', Math.min(STOCKS.opinionCap, Math.floor(share * 10) * STOCKS.opinionPerTenth), 1)
    }
  }
}
