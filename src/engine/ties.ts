import { DEALINGS, TIES, TRUST } from '../data/relations'
import { MARKET } from '../data/unitTypes'
import { atWar, clamp, hasPact, isAllied, pairKey } from './helpers'
import { sameFaction } from './factions'
import type { RelationLine } from './relationParts'
import type { GameState, NationId, ResourceBundle, TiesState } from './types'

/**
 * Ties (docs/RELATIONS_STATUS.md): what trade, investment and a long peace are worth in a nation's opinion of another, and how far it
 * trusts it. Every line is worked out from the state with a ceiling, so it shows in "why they feel this way" and cannot run away, and the
 * same rules hold between two rivals as toward a player. The only state kept is `GameState.ties`: the last war and the run of trade per pair.
 */

const isTrade = (s: GameState, a: NationId, b: NationId) => (d: GameState['deals'][number]) =>
  d.kind === 'trade' && ((d.from === a && d.to === b) || (d.from === b && d.to === a)) && (d.contract?.start ?? 0) <= s.turn

/** What a bundle is worth at the market's base prices: a fixed yardstick, so the same deal is always worth the same goodwill. */
export function bundleWorth(b: ResourceBundle): number {
  let v = 0
  for (const [r, amount] of Object.entries(b)) v += Math.max(0, amount ?? 0) * (MARKET[r as keyof typeof MARKET]?.base ?? 1)
  return v
}

/** The monthly worth of every running trade deal between two nations, both directions, at base prices. */
export function tradeWorth(s: GameState, a: NationId, b: NationId): number {
  let v = 0
  for (const d of s.deals) if (isTrade(s, a, b)(d)) v += bundleWorth(d.give) + bundleWorth(d.receive)
  return v
}

/** Whether two nations have a trade deal running now. */
export const tradingNow = (s: GameState, a: NationId, b: NationId) => s.deals.some(isTrade(s, a, b))

/** Months of unbroken trade between two nations (0 when they do not trade). */
export function tradeMonths(s: GameState, a: NationId, b: NationId): number {
  if (!tradingNow(s, a, b)) return 0
  const since = s.ties?.tradeSince[pairKey(a, b)]
  return since === undefined ? 0 : Math.max(0, s.turn - since)
}

/**
 * Months since two nations last fought, counting from the start of the record when they never have: the first month of the game, or for a
 * save made before ties the month it was loaded (`TiesState.since`), so a pair that fought before that save earns no long peace it did not keep.
 */
export function peaceMonths(s: GameState, a: NationId, b: NationId): number {
  if (atWar(s, a, b)) return 0
  const last = s.ties?.fought[pairKey(a, b)]
  return Math.max(0, s.turn - (last ?? s.ties?.since ?? 1))
}

/**
 * A save loaded without a record of ties (made before them) starts its record now: no pair has a long peace until 12 months of it have been
 * seen. A game at its first month is unchanged (its record starts there anyway). Only with ties and `DEALINGS` on.
 */
export function startTiesRecord(s: GameState): void {
  if (!TIES.on || !DEALINGS.on || s.ties || !(s.turn > 1)) return
  s.ties = { fought: {}, tradeSince: {}, tradeLast: {}, since: s.turn }
  for (const k of s.wars) s.ties.fought[k] = s.turn
}

/** Whether two nations have fought in this game (as far as the record goes). */
export const haveFought = (s: GameState, a: NationId, b: NationId) => s.ties?.fought[pairKey(a, b)] !== undefined

/** Money `investor` has in `host`'s businesses, outside the joint ventures (those have their own line). */
export function stakeIn(s: GameState, investor: NationId, host: NationId): number {
  let sum = 0
  for (const i of s.investments ?? []) if (i.investor === investor && i.target === host) sum += i.amount
  for (const p of s.relations?.programs ?? []) if (p.kind === 'venture' && p.host === host && (p.a === investor || p.b === investor) && p.host !== investor) sum -= p.stake ?? 0
  return Math.max(0, sum)
}

const ramp = (base: number, per: number, months: number, cap: number) => {
  const raw = base + per * months
  return { value: Math.min(cap, raw), step: raw < cap ? Math.min(per, cap - raw) : 0 }
}

/**
 * The tie lines of `holder`'s opinion of `target`: a running trade deal (worth more the bigger and the longer it runs), their money in
 * our businesses, and a long peace between neighbors or old enemies. `borders` says whether they are neighbors. Empty with ties off.
 */
export function tieLines(s: GameState, holder: NationId, target: NationId, borders: boolean): RelationLine[] {
  if (!TIES.on || holder === target) return []
  const out: RelationLine[] = []
  if (tradingNow(s, holder, target)) {
    const t = TIES.trade
    const worth = Math.min(t.valueCap, tradeWorth(s, holder, target) * t.perValue)
    const months = tradeMonths(s, holder, target)
    const run = ramp(0, t.perMonth, months, t.monthsCap)
    out.push({ label: 'Trade partners', value: t.base + worth + run.value, step: run.step })
  }
  const stake = stakeIn(s, target, holder)
  if (stake > 0) {
    const v = Math.min(TIES.invest.cap, stake / TIES.invest.per)
    if (v >= 0.5) out.push({ label: 'Invests in our economy', value: v, step: 0 })
  }
  if (borders || haveFought(s, holder, target)) {
    const m = peaceMonths(s, holder, target)
    if (m > TIES.peace.after) {
      const v = ramp(0, TIES.peace.step, m - TIES.peace.after, TIES.peace.cap)
      out.push({ label: 'Long peace', value: v.value, step: v.step })
    }
  }
  return out
}

/** The month's bookkeeping for ties: who fought, and the run of trade. Runs after the deals. Keeps nothing for a world with no war and no trade. */
export function runTies(s: GameState): void {
  if (!TIES.on) return
  const need = s.wars.length > 0 || s.deals.some((d) => d.kind === 'trade') || !!s.ties
  if (!need) return
  const t: TiesState = (s.ties ??= { fought: {}, tradeSince: {}, tradeLast: {} })
  for (const k of s.wars) t.fought[k] = s.turn
  for (const d of s.deals) {
    if (d.kind !== 'trade' || (d.contract?.start ?? 0) > s.turn) continue
    const k = pairKey(d.from, d.to)
    if (t.tradeSince[k] === undefined || s.turn - (t.tradeLast[k] ?? -99) > TIES.tradeGrace) t.tradeSince[k] = s.turn
    t.tradeLast[k] = s.turn
  }
  for (const k of Object.keys(t.tradeLast)) {
    if (s.turn - t.tradeLast[k] <= TIES.tradeGrace) continue
    delete t.tradeLast[k]
    delete t.tradeSince[k]
  }
  for (const k of Object.keys(t.fought)) {
    const [a, b] = k.split('|')
    if (!s.nations[a]?.alive || !s.nations[b]?.alive) delete t.fought[k]
  }
}

// ---- trust -----------------------------------------------------------------------------------------------------------------

/** Remembered acts that say a nation does not keep its word. */
export const BROKEN_WORD = new Set([
  'Broke our pact',
  'Breaks its word',
  'Broke a trade deal',
  'Defaulted on a deal',
  'Broke a contract',
  'Defaulted on our loan',
  'Abandoned our alliance',
  'Ignored our call to arms',
  'Abandoned our war plan',
  'Walked out of our venture',
  'Left our program',
  'Revoked basing rights',
  'Caught our spies',
  'Declared war on us',
  'Attacked without cause',
  'Seized our investment',
  'Broke a faction contract',
  'Left our faction',
])

export interface TrustReport {
  /** 0 to 100; 50 is a nation they have no record with. */
  total: number
  label: 'Trusted' | 'Reliable' | 'Untested' | 'Doubtful' | 'Distrusted'
  parts: { label: string; value: number }[]
}

export function trustLabel(v: number): TrustReport['label'] {
  if (v >= 70) return 'Trusted'
  if (v >= 57) return 'Reliable'
  if (v >= 43) return 'Untested'
  if (v >= 25) return 'Doubtful'
  return 'Distrusted'
}

/**
 * How far `holder` expects `target` to keep its word, from its record: treaties kept, steady trade, deals honoured, an embassy, a shared
 * bloc and a long peace on one side; broken promises, spies, aggression and war on the other. With `DEALINGS.on` a rival weighs it in its
 * answer to a treaty, a trade deal, a loan or a joint venture (`trustFactor`, src/ai/diplomat.ts).
 */
export function trustReport(s: GameState, holder: NationId, target: NationId, ctx: { borders?: boolean; stored?: { label: string; value: number }[] } = {}): TrustReport {
  const parts: TrustReport['parts'] = []
  const push = (label: string, value: number) => {
    if (Math.abs(value) >= 0.5) parts.push({ label, value: Math.round(value) })
  }
  const k = pairKey(holder, target)
  if (isAllied(s, holder, target) || hasPact(s, holder, target)) {
    const since = s.relations?.since[k]
    push('Treaty kept', since === undefined ? 4 : Math.min(TRUST.treatyCap, 4 + (s.turn - since) * TRUST.treatyPerMonth))
  }
  if (tradingNow(s, holder, target)) push('Steady trade', Math.min(TRUST.tradeCap, 3 + tradeMonths(s, holder, target) * TRUST.tradePerMonth))
  const stored = ctx.stored ?? s.opinions[`${holder}>${target}`] ?? []
  if (stored.some((m) => m.label === 'Honored our deal' && m.value > 0)) push('Honoured a deal', TRUST.honored)
  if (s.relations?.embassies.some((e) => e.from === target && e.to === holder)) push('Embassy', TRUST.embassy)
  if (sameFaction(s, holder, target)) push('Same bloc', TRUST.bloc)
  if (TIES.on && (ctx.borders || haveFought(s, holder, target))) {
    const m = peaceMonths(s, holder, target) - TIES.peace.after
    if (m > 0) push('Long peace', Math.min(TRUST.peaceCap, m * TRUST.peacePerMonth))
  }
  push('Reputation for aggression', -Math.min(TRUST.infamyCap, (s.infamy?.[target] ?? 0) * TRUST.infamy))
  let broken = 0
  for (const m of stored) if (m.value < 0 && BROKEN_WORD.has(m.label)) broken += -m.value
  push('Broken promises', -Math.min(TRUST.brokenCap, broken * TRUST.broken))
  if (atWar(s, holder, target)) push('At war', TRUST.war)
  const total = Math.round(clamp(TRUST.base + parts.reduce((sum, p) => sum + p.value, 0), 0, 100))
  return { total, label: trustLabel(total), parts }
}

/**
 * What trust is worth in a decision: -1 (trust 0) through 0 (50, untested) to +1 (trust 100), and 0 with `DEALINGS` off. Each kind of offer
 * multiplies it by its own weight (`DEALINGS.trust`), so its effect is bounded and can be said in a sentence.
 */
export function trustFactor(total: number): number {
  return DEALINGS.on ? clamp((total - TRUST.base) / (100 - TRUST.base), -1, 1) : 0
}

/** How trust leans an answer, in words for the screens: "Trust 64 (Reliable) counts for you". */
export function trustLean(t: TrustReport): { text: string; tone: 'good' | 'bad' | 'none' } {
  const f = trustFactor(t.total)
  if (Math.abs(f) < 0.1) return { text: `Trust ${t.total} (${t.label}): no weight either way`, tone: 'none' }
  return f > 0 ? { text: `Trust ${t.total} (${t.label}) counts for you`, tone: 'good' } : { text: `Trust ${t.total} (${t.label}) counts against you`, tone: 'bad' }
}
