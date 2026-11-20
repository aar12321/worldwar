import { COALITION } from '../data/coalition'
import { LIBERATE_TEXT } from '../data/puppets'
import { TERRITORY_TEXT } from '../data/territories'
import { PERSONALITIES } from '../data/personalities'
import { difficultyOf } from '../data/difficulty'
import { alarmBetween, leadersOf, type ThreatReport } from '../engine/coalition'
import { generalPeaceTies, loanPayment } from '../engine/diplomacy'
import { computeEconomy, militaryPower, type EconomyReport } from '../engine/economy'
import { alliesOf, atWar, enemiesOf, hasCasusBelli, hasPact, isAllied, pairKey } from '../engine/helpers'
import type { Rng } from '../engine/rng'
import { bundleEmpty, bundleEntries, marketPrices, stockOf, type MarketPrices } from '../engine/trade'
import type { GameState, NationId, PeaceTerms, Proposal, ProposalDraft, ResourceBundle, TradeResource, WorldMap } from '../engine/types'
import { netWarScore, termsCost } from '../engine/warscore'
import { coalitionActive, nationNeighbors, opinionOf } from './opinion'
import { DEALINGS } from '../data/relations'
import { trustFactor, trustReport, type TrustReport } from '../engine/ties'
import { truceWilling } from '../engine/missileWar'

export function perceivedPower(s: GameState, _map: WorldMap, _viewer: NationId, target: NationId): number {
  return militaryPower(s, target)
}

/** How badly `n` wants more of a resource right now (1 = normal market value). */
function needFor(s: GameState, id: NationId, r: TradeResource, econ: EconomyReport): number {
  const n = s.nations[id]
  switch (r) {
    case 'food':
      if (n.foodShortage) return 1.9
      if (econ.netFood < 0) return 1.4
      return n.resources.food > econ.workforce * 12 ? 0.6 : 1
    case 'capital':
      if (n.resources.capital < 20) return 1.6
      if (econ.netCapital < 0) return 1.3
      return n.resources.capital > 300 ? 0.75 : 1
    case 'tp':
      return n.resources.tp < 25 ? 1.2 : n.resources.tp > 400 ? 0.7 : 1
    case 'manpower':
      if (enemiesOf(s, id).length > 0) return 1.4
      return n.militaryPool > econ.militaryCap * 0.8 ? 0.6 : 1
    case 'oil':
      if (n.oilShortage) return 1.8
      return econ.netOil < 0 ? 1.4 : n.resources.oil > econ.oilUse * 6 + 20 ? 0.6 : 1
    case 'steel':
      return n.resources.steel < 6 ? 1.4 : n.resources.steel > 60 ? 0.6 : 1
    case 'goods':
      if (n.goodsShortage) return 1.7
      return econ.netGoods < 0 ? 1.3 : n.resources.goods > econ.goodsUse * 6 ? 0.6 : 1
  }
}

function valueFor(s: GameState, id: NationId, b: ResourceBundle, prices: MarketPrices, econ: EconomyReport): number {
  return bundleEntries(b).reduce((sum, [r, v]) => sum + v * prices[r] * needFor(s, id, r, econ), 0)
}

/** Amount of a resource a nation keeps back and will not trade away. */
export const TRADE_RESERVE: Record<TradeResource, number> = { capital: 25, food: 8, tp: 0, manpower: 30, oil: 6, steel: 8, goods: 8 }

/** A rival gives itself up as a territory only when the war has gone this far against it: well past the point where it would take a puppet's chains. */
export const TERRITORY_AI_ACCEPT = 16

/** The dice every answer rolls: a draw spread evenly from -NOISE up to (not quite) +NOISE, added to the score. */
export const NOISE = 6

/**
 * A decision made on a roll of the dice: yes exactly when `base` plus a draw spread evenly over [-spread, spread) is above `need`.
 * The answers that read their score this way (peace, a call to arms, a bloc's call) return it, so the screens can give the real chance.
 */
export interface DiceRule {
  base: number
  need: number
  spread: number
  /** Why the bar is where it is, when it is raised (for the screens only). */
  why?: string
}

/** The chance a dice rule says yes: 1 when it does even on the worst draw, 0 when not even on the best, otherwise the share of draws that do. */
export function diceChance(r: DiceRule): number {
  if (r.base - r.spread > r.need) return 1
  if (r.base + r.spread <= r.need) return 0
  return Math.min(1, Math.max(0, (r.base + r.spread - r.need) / (2 * r.spread)))
}

/** One term of a score, for the details on the screens. */
export interface OddsFactor {
  label: string
  value: number
}

/** A score from its terms, added in order from the first (exactly as the rule always added them). */
export const sumFactors = (fs: OddsFactor[]): number => fs.reduce((sum, f) => sum + f.value, 0)

export interface Verdict {
  accept: boolean
  reason: string
  opinion: number
  /** Their trust in the one proposing, when it was weighed (`DEALINGS.on`, a treaty, a trade deal or a loan). */
  trust?: TrustReport
  /** For an answer that rolls dice on a score: the score before the dice and what it must beat. */
  dice?: DiceRule
  /** The terms of that score, in the order they are added. */
  factors?: OddsFactor[]
}

const withOpinion = (reason: string, op: number) => (Math.abs(op) >= 20 ? `${reason} (opinion ${op > 0 ? '+' : ''}${op})` : reason)

/**
 * How `botId` weighs peace terms from `from`: the score before the dice, what it must beat (more for a puppet, a territory or a freed
 * puppet) and the answer for a score. `evaluateProposal` and the screens' outlook both read it, so they cannot disagree.
 */
export function peaceRule(s: GameState, map: WorldMap, botId: NationId, from: NationId, terms: PeaceTerms, op: number, ratio: number) {
  const me = s.nations[botId]
  const net = netWarScore(s, from, botId)
  const { demand, concession } = termsCost(s, map, terms, from, botId)
  const started = s.warStarted[pairKey(from, botId)] ?? s.turn
  const fresh = s.turn - started < 3
  const bias = { expansionist: -12, opportunist: -4, turtle: 10, trader: 8, honorable: 0 }[me.personality ?? 'honorable']
  // A general peace also stops the wars its friends are winning, so it is a harder sell.
  const others = terms.general ? generalPeaceTies(s, from, botId).length : 0
  // The score is these added up in this order, then the dice.
  const factors: OddsFactor[] = [
    { label: 'War weariness', value: me.warWeariness * 1.1 },
    { label: 'Your strength against theirs', value: (ratio - 1) * 25 },
    { label: 'War score', value: net * 0.6 },
    { label: 'What you give', value: concession },
    { label: 'What you demand', value: -(demand * 0.8) },
    { label: 'Their opinion of you', value: op * 0.15 },
    { label: `Temperament (${PERSONALITIES[me.personality ?? 'honorable'].name})`, value: bias },
    { label: 'The war has only just begun', value: -(fresh ? 12 : 0) },
    { label: 'Pride', value: -8 },
    { label: 'Their friends at war with yours', value: -Math.min(10, others * 2.5) },
  ]
  const base = sumFactors(factors)
  const need = Math.max(0, terms.puppet ? 8 : 0, terms.territory ? TERRITORY_AI_ACCEPT : 0, terms.liberate !== undefined ? 8 : 0)
  const decide = (score: number): { accept: boolean; reason: string } => {
    const no = (reason: string) => ({ accept: false, reason })
    const yes = (reason: string) => ({ accept: true, reason })
    if (terms.puppet && score <= 8) return no('we will never be your puppet')
    if (terms.territory && score <= TERRITORY_AI_ACCEPT) return no(TERRITORY_TEXT.refusal)
    if (terms.liberate !== undefined && score <= 8) return no(LIBERATE_TEXT.refusal)
    if (score > 0) {
      if (me.warWeariness > 25) return yes('the war has bled us dry')
      if (ratio > 1.3 || net > 15) return yes('we cannot win this war')
      if (concession > 0) return yes('your terms are generous')
      return yes('we welcome an end to the bloodshed')
    }
    if (demand > concession + 10) return no('your demands are too harsh')
    if (net < -10) return no('we are winning this war')
    if (fresh) return no('the war has only just begun')
    return no('we will fight on')
  }
  return { factors, base, need, decide }
}

/** A bot's answer to a proposal, with the reason a human diplomat would give. */
export function evaluateProposal(s: GameState, map: WorldMap, botId: NationId, p: Proposal, rng: Rng, prices?: MarketPrices, leaders?: ThreatReport[]): Verdict {
  const me = s.nations[botId]
  const persona = PERSONALITIES[me.personality ?? 'honorable']
  const myNeighbors = nationNeighbors(s, map, botId)
  const borders = myNeighbors.has(p.from)
  const coalition = coalitionActive(s, map)
  const op = opinionOf(s, map, botId, p.from, { borders, coalition })
  const myP = Math.max(1, militaryPower(s, botId))
  const theirP = perceivedPower(s, map, botId, p.from)
  const ratio = theirP / myP
  const noise = rng.range(-NOISE, NOISE)
  // Trust (src/engine/ties.ts): worked out only for the offers that weigh it, and only with DEALINGS on, so nothing changes with it off.
  let trust: TrustReport | undefined
  const weighs = DEALINGS.on && (p.kind === 'pact' || p.kind === 'alliance' || p.kind === 'guarantee' || p.kind === 'trade' || p.kind === 'loan')
  if (weighs) trust = trustReport(s, botId, p.from, { borders })
  /** Trust as a factor from -1 to +1 (0 untested, and always 0 with DEALINGS off). */
  const tf = trust ? trustFactor(trust.total) : 0
  const verdict = (accept: boolean, reason: string): Verdict => ({ accept, reason: withOpinion(reason, op), opinion: op, ...(trust ? { trust } : {}) })
  /** A refusal that distrust tipped says so. */
  const distrust = tf <= -0.3

  // A territory's master speaks for it: it takes its master's trade deals without a word and turns down everything else.
  if (me.territoryOf) {
    const master = s.nations[me.territoryOf]?.name ?? 'its master'
    if (p.from === me.territoryOf && p.kind === 'trade') return verdict(true, 'our master commands it')
    if (p.kind !== 'trade') return verdict(false, `${master} speaks for us`)
  }
  switch (p.kind) {
    case 'peace': {
      const r = peaceRule(s, map, botId, p.from, p.terms, op, ratio)
      const d = r.decide(r.base + noise)
      const why = p.terms.territory ? 'to become a territory' : p.terms.puppet ? 'to become a puppet' : p.terms.liberate !== undefined ? 'to free a puppet' : undefined
      return { ...verdict(d.accept, d.reason), dice: { base: r.base, need: r.need, spread: NOISE, ...(why ? { why } : {}) }, factors: r.factors }
    }
    case 'pact': {
      let score = (ratio - 0.8) * 30 + op * 0.5 + persona.pactBias + (borders ? 0 : 6) - 6 + noise
      if (tf) score += tf * DEALINGS.trust.pact
      if (hasCasusBelli(s, botId, p.from)) score -= 12
      const eyeing = (me.personality === 'expansionist' || me.personality === 'opportunist') && borders && myP > theirP * 1.5
      if (eyeing) score -= 20
      if (score > 0) return verdict(true, ratio > 1.2 ? 'peace with a strong neighbor is wise' : 'a sensible guarantee')
      if (op <= -20) return verdict(false, 'we do not trust you')
      if (distrust) return verdict(false, 'your word counts for little with us')
      if (eyeing || myP > theirP * 1.5) return verdict(false, 'we have no need to tie our hands')
      return verdict(false, 'not at this time')
    }
    case 'alliance': {
      const myEnemies = new Set(enemiesOf(s, botId))
      const shared = enemiesOf(s, p.from).filter((e) => myEnemies.has(e)).length
      const theirNeighbors = nationNeighbors(s, map, p.from)
      let threat: NationId | null = null
      for (const x of myNeighbors) {
        if (x === p.from || !s.nations[x]?.alive) continue
        if (!(theirNeighbors.has(x) || atWar(s, p.from, x))) continue
        const px = perceivedPower(s, map, botId, x) * (coalition && s.humans.includes(x) ? 1.4 : 1)
        if (px > myP * 1.3 && opinionOf(s, map, botId, x, { borders: true, coalition }) < 10) {
          threat = x
          break
        }
      }
      let dragged = 0
      for (const e of enemiesOf(s, p.from)) if (!myEnemies.has(e) && perceivedPower(s, map, botId, e) > myP * 0.6) dragged += 18
      dragged = Math.min(40, dragged)
      const allies = alliesOf(s, botId).length
      // A leader the world fears draws its rivals together: two nations that both border it, or fight it, stand together.
      const alarm = difficultyOf(s.settings.difficulty).coalitions ? alarmBetween(s, map, botId, p.from, leaders) : null
      const score = -28 + op * 0.7 + shared * 28 + (threat ? 22 : 0) + (alarm ? COALITION.allyBonus * Math.min(1, alarm.pressure) : 0) + Math.min(15, ratio * 8) + (persona.loyalty - 1) * 20 - dragged - Math.max(0, allies - 1) * 12 + noise + tf * DEALINGS.trust.alliance
      if (score > 0) {
        if (shared > 0) return verdict(true, 'a common enemy unites us')
        if (threat) return verdict(true, `together we can stand against ${s.nations[threat].name}`)
        if (alarm) return verdict(true, `together we can stand against ${s.nations[alarm.leader].name}`)
        return verdict(true, 'our friendship is strong')
      }
      if (op < -10) return verdict(false, 'we do not trust you')
      if (distrust) return verdict(false, 'your word counts for little with us')
      if (dragged > 0) return verdict(false, 'we will not be dragged into your wars')
      if (allies >= 3) return verdict(false, 'we are committed elsewhere')
      return verdict(false, 'we see no common cause')
    }
    case 'trade': {
      if (atWar(s, botId, p.from)) return verdict(false, 'we do not trade with enemies')
      if (p.terms.joinWars) {
        // Fighting beside someone is a matter of trust, and it must not set us against our own friends.
        if (!isAllied(s, botId, p.from) && op < 20) return verdict(false, 'we will not fight your wars on a promise')
        const foes = enemiesOf(s, p.from).filter((e) => e !== botId)
        if (foes.some((e) => isAllied(s, botId, e) || hasPact(s, botId, e))) return verdict(false, 'we are bound by treaty to one of your enemies')
        if (bundleEmpty(p.terms.give) && bundleEmpty(p.terms.receive)) return verdict(true, 'we stand with our friends')
      }
      const px = prices ?? marketPrices(s)
      const econ = computeEconomy(s, map, botId)
      const { give, receive, months } = p.terms
      for (const [r, v] of bundleEntries(receive)) {
        const stock = stockOf(me, r)
        const needed = months > 0 ? v * 2 : v
        if (stock - needed < TRADE_RESERVE[r]) return verdict(false, `we cannot spare the ${r === 'tp' ? 'research' : r}`)
      }
      const got = valueFor(s, botId, give, px, econ)
      const paid = valueFor(s, botId, receive, px, econ)
      if (bundleEmpty(receive)) return verdict(true, 'a generous gift')
      if (bundleEmpty(give)) {
        if (borders && ratio > 2.2 && op > -40) return verdict(true, 'we cannot refuse so mighty a neighbor')
        return verdict(false, 'we pay no tribute')
      }
      let threshold = 1.05 - op * 0.004 - (persona.dealAppetite - 1) * 0.25 - (isAllied(s, botId, p.from) ? 0.05 : 0) - Math.min(0.1, (p.terms.collateral ?? 0) / 1000)
      if (months > 0 && op < 0) threshold += 0.1
      // A partner they trust gets a better price; one they doubt must pay more.
      if (tf) threshold -= tf * DEALINGS.trust.tradePrice
      const fairness = got / Math.max(0.01, paid)
      if (fairness >= threshold + noise / 150) return verdict(true, fairness > 1.25 ? 'an excellent bargain' : 'a fair exchange')
      return verdict(false, `the price is too low (worth ${Math.round(fairness * 100)}% to us${distrust ? ', and we doubt your word' : ''})`)
    }
    case 'loan': {
      if (atWar(s, botId, p.from)) return verdict(false, 'we do not borrow from enemies')
      const econ = computeEconomy(s, map, botId)
      const pay = loanPayment(p.amount, p.months)
      if (econ.netCapital < pay * 0.8) return verdict(false, 'we could not make the payments')
      // Trust counts as opinion would: a lender they trust is a friend, one they doubt a risk.
      const lop = op + tf * DEALINGS.trust.loan
      if (lop < -25) return verdict(false, 'we do not trust you with our debts')
      const hungry = me.resources.capital < 40 || econ.netCapital < 2
      if (hungry) return verdict(true, 'we need the money')
      return lop > 15 && p.amount < me.resources.capital ? verdict(true, 'a friendly loan is welcome') : verdict(false, distrust ? 'we would rather not owe you' : 'we have no need to borrow')
    }
    case 'guarantee': {
      const gop = op + tf * DEALINGS.trust.guarantee
      if (gop < -20) return verdict(false, 'a guarantee from you is no comfort')
      if (me.overlord === p.from) return verdict(false, 'we are already yours')
      const threatened = enemiesOf(s, botId).length > 0 || [...myNeighbors].some((x) => perceivedPower(s, map, botId, x) > myP * 1.3)
      if (threatened || gop > 10) return verdict(true, threatened ? 'we welcome a protector' : 'our friendship is strong')
      return verdict(false, 'we are not in need of protection')
    }
    case 'truce': {
      // Only a player is sent this offer; a bot standing in for one answers as a rival would.
      const w = truceWilling(s, botId, p.from)
      return verdict(w.accepts, w.accepts ? 'we will stop the missiles' : 'we see no reason to stop yet')
    }
    case 'callToArms': {
      const enemy = p.enemy
      const enemyName = s.nations[enemy]?.name ?? 'them'
      if (hasPact(s, botId, enemy) || isAllied(s, botId, enemy)) return verdict(false, `we are bound by treaty with ${enemyName}`)
      const eP = perceivedPower(s, map, botId, enemy)
      const opEnemy = opinionOf(s, map, botId, enemy, { borders: myNeighbors.has(enemy), coalition })
      // Rivals rally to a war against a leader the world fears.
      const rally = difficultyOf(s.settings.difficulty).coalitions ? (leaders ?? leadersOf(s, map, COALITION.allyFrom, { output: false }).map((l) => l.threat)).filter((l) => l.nation === enemy).reduce((sum, l) => sum + COALITION.armsBonus * Math.min(1, l.pressure), 0) : 0
      // The score is these added up in this order, then the dice.
      const factors: OddsFactor[] = [
        { label: 'Going to war at all', value: -8 },
        { label: 'Their opinion of you', value: op * 0.45 },
        { label: 'Your alliance', value: isAllied(s, botId, p.from) ? 20 : 0 },
        { label: 'Their loyalty', value: (persona.loyalty - 1) * 30 },
        { label: `${enemyName}'s strength`, value: -((eP / myP) * 18) },
        { label: 'War weariness', value: -(me.warWeariness * 0.6) },
        { label: 'Wars of their own', value: -(enemiesOf(s, botId).length * 14) },
        { label: `Their opinion of ${enemyName}`, value: -(opEnemy * 0.25) },
        { label: myNeighbors.has(enemy) ? `${enemyName} is their neighbour` : `${enemyName} is far away`, value: myNeighbors.has(enemy) ? 5 : -5 },
        { label: `${enemyName} is a leader the world fears`, value: rally },
      ]
      const base = sumFactors(factors)
      const dice: DiceRule = { base, need: 0, spread: NOISE }
      const v = (accept: boolean, reason: string): Verdict => ({ ...verdict(accept, reason), dice, factors })
      if (base + noise > 0) return v(true, 'we stand with our allies')
      if (eP > myP * 1.2) return v(false, `${enemyName} is too strong for us`)
      if (me.warWeariness > 20) return v(false, 'our people are weary of war')
      return v(false, 'we will not bleed for you')
    }
  }
}

/**
 * A rival's answer to an offer before it is asked, for the screens: `likely` when it says yes on every draw of its dice, `unlikely` when on
 * none, `unsure` when the dice decide, with the real chance.
 */
export interface OfferOutlook {
  outlook: 'likely' | 'unsure' | 'unlikely'
  /** The chance it says yes: 1 when likely, 0 when unlikely, otherwise the share of its draws that say yes. */
  chance: number
  /** The reason it would give (on an average draw; when the dice decide, the reason it gives when it says no). */
  reason: string
  /** Their trust in you, when this kind of offer weighs it. */
  trust?: TrustReport
  /** The score and what it must beat, for the answers that read a score (peace, a call to arms). */
  dice?: DiceRule
  /** The terms of that score. */
  factors?: OddsFactor[]
}

/** A stand-in for the dice: always the same draw, so the answer can be read before it is asked. */
const fixedDraw = (x: number): Rng => ({ next: () => 0.5, range: () => x, int: (min) => min, chance: () => false, pick: (items) => items[0] })

const outlookWord = (chance: number): OfferOutlook['outlook'] => (chance >= 1 ? 'likely' : chance <= 0 ? 'unlikely' : 'unsure')

/**
 * How a decision that rolls one draw from [-spread, spread) would come out, read off the decision itself (`at(x)` is its answer on draw x).
 * A rule that says how it reads its score (`dice`) gives the exact chance. Any other moves one way only as the draw grows (up for a treaty,
 * down for a price), so its two ends say whether the dice matter and the edge between them, found by halving, gives the chance.
 */
export function outlookFrom(at: (x: number) => Verdict, spread = NOISE): OfferOutlook {
  const read = (v: Verdict, chance: number): OfferOutlook => ({
    outlook: outlookWord(chance),
    chance,
    reason: v.reason,
    ...(v.trust ? { trust: v.trust } : {}),
    ...(v.dice ? { dice: v.dice } : {}),
    ...(v.factors ? { factors: v.factors } : {}),
  })
  const mid = at(0)
  if (mid.dice) {
    const chance = diceChance(mid.dice)
    // When the dice decide, the reason is the one it gives on the draws that say no (a low draw lowers the score).
    return read(chance > 0 && chance < 1 ? at(-mid.dice.spread) : mid, chance)
  }
  const lo = at(-spread)
  const hi = at(spread)
  if (lo.accept === hi.accept) return read(mid, lo.accept ? 1 : 0)
  let a = -spread
  let b = spread
  for (let i = 0; i < 24; i++) {
    const m = (a + b) / 2
    if (at(m).accept === lo.accept) a = m
    else b = m
  }
  const chance = lo.accept ? (b + spread) / (2 * spread) : (spread - b) / (2 * spread)
  return read(lo.accept ? hi : lo, Math.min(0.999, Math.max(0.001, chance)))
}

/**
 * How `botId` would answer `draft` from `from`, read off `evaluateProposal` itself (`outlookFrom`), so the screen and the rival can never
 * disagree. Pure: changes nothing. As things stand now: an offer answered at the month's end is weighed on the world then.
 */
export function offerOutlook(s: GameState, map: WorldMap, botId: NationId, from: NationId, draft: ProposalDraft, prices?: MarketPrices): OfferOutlook {
  const p = { ...draft, id: 'outlook', from, to: botId, created: s.turn, expires: s.turn } as Proposal
  return outlookFrom((x) => evaluateProposal(s, map, botId, p, fixedDraw(x), prices))
}
