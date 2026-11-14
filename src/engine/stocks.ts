import { COMPANY_CAP, COMPANY_SEEDS, DIRECTIVES, EXPAND_GROWTH, SPECIALTY, STOCKS, TIERS } from '../data/companies'
import { NO_EFFECTS, type PolicyEffects } from '../data/government'
import { SECTOR_IDS, SECTORS } from '../data/business'
import { traitOf, type TraitId } from '../data/traits'
import { WAR } from '../data/war'
import { worldTension } from './crises'
import { addLog, clamp, hasTech } from './helpers'
import type { Rng } from './rng'
import type { CompanyInfo, Directive, GameState, NationId, Order, SectorId, StockState, WorldMap } from './types'

/** Rough monthly income per point of a country's workforce at the start of a game, to price companies by. */
const INCOME_PER_WORKFORCE = 4.8

/** A country's trait suggests what its first company does. */
const TRAIT_SECTOR: Record<TraitId, SectorId> = {
  chips: 'technology',
  finance: 'finance',
  energy: 'energy',
  minerals: 'manufacturing',
  shipyards: 'manufacturing',
  farmland: 'farming',
  manpower: 'manufacturing',
  fortress: 'arms',
  research: 'technology',
  trade_hub: 'finance',
  heavy: 'manufacturing',
  culture: 'technology',
}

const NOUNS: Record<SectorId, string[]> = {
  technology: ['Technologies', 'Digital', 'Systems'],
  finance: ['Bank', 'Capital', 'Trust'],
  energy: ['Energy', 'Petroleum', 'Power'],
  manufacturing: ['Industries', 'Works', 'Heavy Industries'],
  arms: ['Defense', 'Armaments', 'Aerospace'],
  farming: ['Agro', 'Foods', 'Harvest'],
}

/** A small stable number from a name, so generated companies are the same in every game. */
function hash(text: string): number {
  let h = 7
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100003
  return h
}

/** How many companies a country has: none when it is poor, one when it is well off, two when it is very, very developed. */
export const companyCount = (development: number) => (development >= 0.85 ? 2 : development >= 0.55 ? 1 : 0)

/** A fresh exchange. Each developed country on the map is home to up to two companies; the same ones every game. */
export function newStocks(map: WorldMap): StockState {
  const meta: Record<string, CompanyInfo> = {}
  const price: Record<string, number> = {}
  for (const id of map.order) {
    const region = map.regions[id]
    const count = companyCount(region.development)
    if (count === 0) continue
    // A company is worth some months of what its country earns, spread over the float.
    const workforce = Math.pow(Math.max(0.05, region.basePopulation), 0.6) * (0.3 + 0.7 * region.development)
    const base = Math.max(0.05, (STOCKS.worth * INCOME_PER_WORKFORCE * workforce) / STOCKS.float)
    const taken = new Set<SectorId>()
    const pick = (sector: SectorId, company: string, name: string) => {
      taken.add(sector)
      meta[company] = { name, sector, home: id, country: region.name, base }
      price[company] = base
    }
    // The well-known countries have names of their own.
    for (const seed of COMPANY_SEEDS) {
      if (taken.size >= count) break
      if (seed.home === id && !taken.has(seed.sector)) pick(seed.sector, seed.id, seed.name)
    }
    // The rest are named for the country, in a sector that suits it.
    const h = hash(id)
    const sectors: SectorId[] = [TRAIT_SECTOR[traitOf(id, region)], ...SECTOR_IDS.map((_, i) => SECTOR_IDS[(h + i) % SECTOR_IDS.length])]
    let k = 0
    for (const sector of sectors) {
      if (taken.size >= count) break
      if (taken.has(sector)) continue
      const noun = NOUNS[sector][(h + k++) % NOUNS[sector].length]
      pick(sector, `${id}:${sector}`, `${region.name} ${noun}`)
    }
  }
  return { meta, price, last: { ...price }, size: {}, held: {}, directive: {}, mood: 0, index: 100 }
}

/** The nation that holds a company's home country now. */
export const homeOwner = (s: GameState, id: string): NationId | null => {
  const home = s.stocks.meta[id]?.home
  return home ? s.regions[home]?.owner ?? null : null
}

/** The companies based in the countries a nation holds. Only these can be invested in. */
export function companiesOf(s: GameState, nationId: NationId): string[] {
  return Object.keys(s.stocks.meta)
    .filter((id) => homeOwner(s, id) === nationId)
    .sort()
}

export const stake = (s: GameState, nationId: NationId, company: string) => s.stocks.held[nationId]?.[company] ?? 0

/** The share of a company a nation holds, from 0 to 1. */
export const stakeShare = (s: GameState, nationId: NationId, company: string) => stake(s, nationId, company) / STOCKS.float

/** Which rung of ownership a share gets: -1 for none or a small holding, then 0 Investor, 1 Board seat, 2 Control, 3 Dominant. */
export function tierOf(share: number): number {
  let tier = -1
  for (let i = 0; i < TIERS.length; i++) if (share >= TIERS[i].at - 1e-9) tier = i
  return tier
}

/** How strongly a holder's instructions work: nothing under a board seat, half at one, then full. */
export const strengthOf = (share: number) => (tierOf(share) >= 0 ? TIERS[tierOf(share)].strength : 0)

/** What a company is doing: its holder's instruction if they have the say, or paying dividends. */
export function directiveOf(s: GameState, company: string): Directive {
  return s.stocks.directive[company] ?? 'payout'
}

/** The instruction that is really in force. Without a board seat the company just pays out. */
function activeDirective(s: GameState, nationId: NationId, company: string): Directive {
  return strengthOf(stakeShare(s, nationId, company)) > 0 ? directiveOf(s, company) : 'payout'
}

const integration = (s: GameState, region: string) => {
  const r = s.regions[region]
  return WAR.integrationFloor + (1 - WAR.integrationFloor) * clamp(r?.integration ?? 1, 0, 1)
}

export interface CompanyEffects extends PolicyEffects {
  /** Share unit purchases cost less. */
  armsDiscount: number
  /** Share Frontier systems cost less. */
  systemDiscount: number
  /** Extra monthly growth of a sector from companies told to expand. */
  expand: Partial<Record<SectorId, number>>
}

/** What the companies a nation instructs do for it: bonuses on the economy, cheaper units, faster sectors. */
export function companyEffects(s: GameState, nationId: NationId): CompanyEffects {
  const out: CompanyEffects = { ...NO_EFFECTS, armsDiscount: 0, systemDiscount: 0, expand: {} }
  const book = s.stocks?.held?.[nationId]
  if (!book) return out
  for (const company of Object.keys(book).sort()) {
    const info = s.stocks.meta[company]
    if (!info || homeOwner(s, company) !== nationId) continue
    const strength = strengthOf(stakeShare(s, nationId, company))
    if (strength <= 0) continue
    const power = strength * integration(s, info.home)
    const directive = directiveOf(s, company)
    if (directive === 'focus') {
      const f = SPECIALTY[info.sector]
      for (const [k, v] of Object.entries(f.effects)) out[k as keyof PolicyEffects] += v * power
      out.armsDiscount += (f.armsDiscount ?? 0) * power
      out.systemDiscount += (f.systemDiscount ?? 0) * power
    } else if (directive === 'expand') {
      out.expand[info.sector] = (out.expand[info.sector] ?? 0) + EXPAND_GROWTH * power
    }
  }
  // No matter how many companies, their instructions only go so far.
  for (const k of Object.keys(NO_EFFECTS) as (keyof PolicyEffects)[]) out[k] = clamp(out[k], -COMPANY_CAP.effect, COMPANY_CAP.effect)
  out.armsDiscount = Math.min(COMPANY_CAP.arms, out.armsDiscount)
  out.systemDiscount = Math.min(COMPANY_CAP.systems, out.systemDiscount)
  return out
}

/** What a company's current instruction does, in plain words, at a given share of ownership. */
export function describeDirective(s: GameState, company: string, directive: Directive, share: number): string {
  const info = s.stocks.meta[company]
  if (!info) return ''
  const strength = strengthOf(share)
  if (directive === 'payout') return `Pays ${(STOCKS.dividend.payout * 100).toFixed(1)}% of the value of your shares each month.`
  if (directive === 'expand') return `${SECTORS[info.sector].name} grows ${(EXPAND_GROWTH * Math.max(strength, 0.5) * 100).toFixed(1)}% a month faster. No dividends.`
  const f = SPECIALTY[info.sector]
  const bits: string[] = []
  const e = f.effects
  const p = Math.max(strength, 0.5)
  if (e.research) bits.push(`research +${(e.research * p * 100).toFixed(1)}%`)
  if (e.growth) bits.push(`business growth +${(e.growth * p * 100).toFixed(1)}%`)
  if (e.money) bits.push(`income +${(e.money * p * 100).toFixed(1)}%`)
  if (e.trade) bits.push(`trade room +${(e.trade * p * 100).toFixed(1)}%`)
  if (e.output) bits.push(`output +${(e.output * p * 100).toFixed(1)}%`)
  if (e.factory) bits.push(`factories +${(e.factory * p * 100).toFixed(1)}%`)
  if (e.foodUse) bits.push(`food use ${(e.foodUse * p * 100).toFixed(1)}%`)
  if (e.stability) bits.push(`stability +${(e.stability * p).toFixed(1)}`)
  if (e.upkeep) bits.push(`upkeep ${(e.upkeep * p * 100).toFixed(1)}%`)
  if (f.armsDiscount) bits.push(`units ${(f.armsDiscount * p * 100).toFixed(0)}% cheaper`)
  if (f.systemDiscount) bits.push(`Frontier systems ${(f.systemDiscount * p * 100).toFixed(0)}% cheaper`)
  return `${f.name}: ${bits.join(', ')}.`
}

/** What a nation's holdings are worth, and what they pay each month. */
export function portfolio(s: GameState, nationId: NationId): { value: number; dividends: number; lines: { company: string; shares: number; value: number; dividend: number }[] } {
  let value = 0
  let dividends = 0
  const lines = []
  for (const [company, shares] of Object.entries(s.stocks.held[nationId] ?? {})) {
    if (shares <= 0 || s.stocks.price[company] === undefined) continue
    const v = shares * s.stocks.price[company]
    const dividend = v * STOCKS.dividend[activeDirective(s, nationId, company)]
    value += v
    dividends += dividend
    lines.push({ company, shares, value: v, dividend })
  }
  return { value, dividends, lines }
}

export function validateTrade(s: GameState, o: Extract<Order, { type: 'buyShares' | 'sellShares' }>, pending: Order[] = []): string | null {
  const n = s.nations[o.nationId]
  const price = s.stocks.price[o.company]
  if (price === undefined) return 'That company is not listed'
  if (!Number.isInteger(o.shares) || o.shares < 1 || o.shares > STOCKS.float) return 'Choose a number of shares'
  if (o.type === 'sellShares') {
    const queued = pending.filter((p) => p.type === 'sellShares' && p.company === o.company).reduce((sum, p) => sum + (p as { shares: number }).shares, 0)
    return stake(s, o.nationId, o.company) - queued >= o.shares ? null : 'You do not hold that many shares'
  }
  const owner = homeOwner(s, o.company)
  if (owner !== o.nationId) {
    return `You can only invest in companies in your own territory. Take ${s.stocks.meta[o.company].country} first`
  }
  if (stake(s, o.nationId, o.company) + o.shares > STOCKS.float) return `Only ${STOCKS.float} shares exist. You hold ${stake(s, o.nationId, o.company)}`
  if (n.resources.capital < tradeValue(s, o.company, o.shares, 'buy')) return 'Not enough money'
  return null
}

/** Money a trade moves. Big trades move the price against you; buying pays the fee on top, selling loses it. */
export function tradeValue(s: GameState, company: string, shares: number, side: 'buy' | 'sell'): number {
  const price = s.stocks.price[company] ?? 0
  const move = (STOCKS.impact * shares) / STOCKS.float
  const average = side === 'buy' ? price * (1 + move / 2) : price * (1 - move / 2)
  const v = average * shares
  return side === 'buy' ? v * (1 + STOCKS.fee) : v * (1 - STOCKS.fee)
}

const movePrice = (s: GameState, company: string, factor: number) => {
  const base = s.stocks.meta[company].base
  s.stocks.price[company] = clamp(s.stocks.price[company] * factor, base * STOCKS.minFactor, base * STOCKS.maxFactor)
}

/** Adds the shares and moves the price. The money was already taken when the order was paid for. */
export function buyShares(s: GameState, nationId: NationId, company: string, shares: number) {
  const book = (s.stocks.held[nationId] ??= {})
  book[company] = (book[company] ?? 0) + shares
  movePrice(s, company, 1 + (STOCKS.impact * shares) / STOCKS.float)
}

export function sellShares(s: GameState, nationId: NationId, company: string, shares: number) {
  s.nations[nationId].resources.capital += tradeValue(s, company, shares, 'sell')
  const book = s.stocks.held[nationId]
  book[company] -= shares
  if (book[company] <= 0) delete book[company]
  movePrice(s, company, 1 - (STOCKS.impact * shares) / STOCKS.float)
  // Giving up the board seat ends the instructions that needed it.
  if (strengthOf(stakeShare(s, nationId, company)) <= 0) delete s.stocks.directive[company]
}

export function validateDirective(s: GameState, o: Extract<Order, { type: 'setDirective' }>): string | null {
  if (!s.stocks.meta[o.company]) return 'That company is not listed'
  if (!DIRECTIVES[o.directive]) return 'Unknown instruction'
  if (homeOwner(s, o.company) !== o.nationId) return 'You can only instruct companies in your own territory'
  const share = stakeShare(s, o.nationId, o.company)
  if (strengthOf(share) <= 0) return `You need a board seat to instruct it: ${Math.round(TIERS[1].at * 100)}% of its shares`
  return null
}

export function setDirective(s: GameState, company: string, directive: Directive) {
  if (directive === 'payout') delete s.stocks.directive[company]
  else s.stocks.directive[company] = directive
}

const SECTOR_TECH: Record<string, string[]> = { technology: ['frontier_ai', 'frontier_quantum', 'cyber_warfare'], arms: ['frontier_drones', 'frontier_hypersonic'] }

/** The month on the exchange: prices follow the home economies, shares follow the land, and dividends are paid. */
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
  for (const company of Object.keys(st.meta).sort()) {
    const info = st.meta[company]
    const price = st.price[company]
    if (price === undefined) continue
    const ownerId = homeOwner(s, company)
    const owner = ownerId ? s.nations[ownerId] : null
    st.last[company] = price
    if (!owner?.alive) {
      st.price[company] = Math.max(info.base * STOCKS.minFactor, price * 0.8)
      continue
    }
    const size = owner.sectors[info.sector] ?? 0
    const before = st.size[company] ?? size
    st.size[company] = size
    const growth = before > 0 ? (size - before) / before : 0
    let r = 0.4 * growth + (owner.stability - 55) / 1500
    if (s.wars.some((w) => w.split('|').includes(owner.id))) r -= 0.015
    if (s.crises.some((c) => c.nation === owner.id || c.rival === owner.id)) r -= 0.012
    if (owner.inDebt) r -= 0.015
    r -= Math.max(0, (owner.corporateTax ?? 0) - 0.2) * 0.1
    for (const t of SECTOR_TECH[info.sector] ?? []) if (hasTech(owner, t)) r += 0.003
    r += st.mood
    const noise = (rng.next() - 0.5) * 2 * (0.015 + tension / 3000)
    // Prices drift back toward a level near where they started, so no company runs away forever.
    const pull = ((info.base * 1.5 - price) / (info.base * 1.5)) * 0.004
    st.price[company] = clamp(price * (1 + r + noise + pull), info.base * STOCKS.minFactor, info.base * STOCKS.maxFactor)
    sum += st.price[company] / info.base
    count++
  }
  st.index = count > 0 ? (sum / count) * 100 : st.index

  // Shares follow the land: take a country and what its owner held in its companies comes to you.
  for (const holder of Object.keys(st.held).sort()) {
    const book = st.held[holder]
    for (const company of Object.keys(book).sort()) {
      const ownerId = homeOwner(s, company)
      const info = st.meta[company]
      if (!info || st.price[company] === undefined || !ownerId || !s.nations[ownerId]?.alive) {
        delete book[company]
        continue
      }
      if (ownerId === holder) continue
      const shares = book[company]
      delete book[company]
      const mine = (st.held[ownerId] ??= {})
      mine[company] = (mine[company] ?? 0) + shares
      delete st.directive[company]
      const loser = s.nations[holder]
      const winner = s.nations[ownerId]
      if (winner.isPlayer) addLog(s, 'economy', `With ${info.country} you took ${Math.round((shares / STOCKS.float) * 100)}% of ${info.name} from ${loser?.name ?? 'its old owner'}.`, [holder, ownerId])
      else if (loser?.isPlayer) addLog(s, 'economy', `${winner.name} took your ${Math.round((shares / STOCKS.float) * 100)}% of ${info.name} along with ${info.country}.`, [holder, ownerId])
    }
  }

  // Dividends.
  for (const n of Object.values(s.nations)) {
    if (!n.alive || !st.held[n.id]) continue
    n.resources.capital += portfolio(s, n.id).dividends
  }
  // A company whose owner lost the board seat is no longer under instruction.
  for (const company of Object.keys(st.directive)) {
    const ownerId = homeOwner(s, company)
    if (!ownerId || strengthOf(stakeShare(s, ownerId, company)) <= 0) delete st.directive[company]
  }
}
