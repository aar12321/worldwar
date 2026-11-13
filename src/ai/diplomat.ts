import { PERSONALITIES } from '../data/personalities'
import { loanPayment } from '../engine/diplomacy'
import { computeEconomy, militaryPower, type EconomyReport } from '../engine/economy'
import { alliesOf, atWar, enemiesOf, hasCasusBelli, hasPact, isAllied, pairKey } from '../engine/helpers'
import type { Rng } from '../engine/rng'
import { bundleEmpty, bundleEntries, marketPrices, stockOf, type MarketPrices } from '../engine/trade'
import type { GameState, NationId, Proposal, ResourceBundle, TradeResource, WorldMap } from '../engine/types'
import { netWarScore, termsCost } from '../engine/warscore'
import { coalitionActive, nationNeighbors, opinionOf } from './opinion'

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

export interface Verdict {
  accept: boolean
  reason: string
  opinion: number
}

const withOpinion = (reason: string, op: number) => (Math.abs(op) >= 20 ? `${reason} (opinion ${op > 0 ? '+' : ''}${op})` : reason)

/** A bot's answer to a proposal, with the reason a human diplomat would give. */
export function evaluateProposal(s: GameState, map: WorldMap, botId: NationId, p: Proposal, rng: Rng, prices?: MarketPrices): Verdict {
  const me = s.nations[botId]
  const persona = PERSONALITIES[me.personality ?? 'honorable']
  const myNeighbors = nationNeighbors(s, map, botId)
  const borders = myNeighbors.has(p.from)
  const coalition = coalitionActive(s, map)
  const op = opinionOf(s, map, botId, p.from, { borders, coalition })
  const myP = Math.max(1, militaryPower(s, botId))
  const theirP = perceivedPower(s, map, botId, p.from)
  const ratio = theirP / myP
  const noise = rng.range(-6, 6)
  const verdict = (accept: boolean, reason: string): Verdict => ({ accept, reason: withOpinion(reason, op), opinion: op })

  switch (p.kind) {
    case 'peace': {
      const net = netWarScore(s, p.from, botId)
      const { demand, concession } = termsCost(s, map, p.terms, p.from, botId)
      const started = s.warStarted[pairKey(p.from, botId)] ?? s.turn
      const fresh = s.turn - started < 3
      const bias = { expansionist: -12, opportunist: -4, turtle: 10, trader: 8, honorable: 0 }[me.personality ?? 'honorable']
      const score = me.warWeariness * 1.1 + (ratio - 1) * 25 + net * 0.6 + concession - demand * 0.8 + op * 0.15 + bias - (fresh ? 12 : 0) - 8 + noise
      if (p.terms.puppet && score <= 8) return verdict(false, 'we will never be your puppet')
      if (score > 0) {
        if (me.warWeariness > 25) return verdict(true, 'the war has bled us dry')
        if (ratio > 1.3 || net > 15) return verdict(true, 'we cannot win this war')
        if (concession > 0) return verdict(true, 'your terms are generous')
        return verdict(true, 'we welcome an end to the bloodshed')
      }
      if (demand > concession + 10) return verdict(false, 'your demands are too harsh')
      if (net < -10) return verdict(false, 'we are winning this war')
      if (fresh) return verdict(false, 'the war has only just begun')
      return verdict(false, 'we will fight on')
    }
    case 'pact': {
      let score = (ratio - 0.8) * 30 + op * 0.5 + persona.pactBias + (borders ? 0 : 6) - 6 + noise
      if (hasCasusBelli(s, botId, p.from)) score -= 12
      const eyeing = (me.personality === 'expansionist' || me.personality === 'opportunist') && borders && myP > theirP * 1.5
      if (eyeing) score -= 20
      if (score > 0) return verdict(true, ratio > 1.2 ? 'peace with a strong neighbor is wise' : 'a sensible guarantee')
      if (op <= -20) return verdict(false, 'we do not trust you')
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
      const score = -28 + op * 0.7 + shared * 28 + (threat ? 22 : 0) + Math.min(15, ratio * 8) + (persona.loyalty - 1) * 20 - dragged - Math.max(0, allies - 1) * 12 + noise
      if (score > 0) {
        if (shared > 0) return verdict(true, 'a common enemy unites us')
        if (threat) return verdict(true, `together we can stand against ${s.nations[threat].name}`)
        return verdict(true, 'our friendship is strong')
      }
      if (op < -10) return verdict(false, 'we do not trust you')
      if (dragged > 0) return verdict(false, 'we will not be dragged into your wars')
      if (allies >= 3) return verdict(false, 'we are committed elsewhere')
      return verdict(false, 'we see no common cause')
    }
    case 'trade': {
      if (atWar(s, botId, p.from)) return verdict(false, 'we do not trade with enemies')
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
      let threshold = 1.05 - op * 0.004 - (persona.dealAppetite - 1) * 0.25 - (isAllied(s, botId, p.from) ? 0.05 : 0)
      if (months > 0 && op < 0) threshold += 0.1
      const fairness = got / Math.max(0.01, paid)
      if (fairness >= threshold + noise / 150) return verdict(true, fairness > 1.25 ? 'an excellent bargain' : 'a fair exchange')
      return verdict(false, `the price is too low (worth ${Math.round(fairness * 100)}% to us)`)
    }
    case 'loan': {
      if (atWar(s, botId, p.from)) return verdict(false, 'we do not borrow from enemies')
      const econ = computeEconomy(s, map, botId)
      const pay = loanPayment(p.amount, p.months)
      if (econ.netCapital < pay * 0.8) return verdict(false, 'we could not make the payments')
      if (op < -25) return verdict(false, 'we do not trust you with our debts')
      const hungry = me.resources.capital < 40 || econ.netCapital < 2
      if (hungry) return verdict(true, 'we need the money')
      return op > 15 && p.amount < me.resources.capital ? verdict(true, 'a friendly loan is welcome') : verdict(false, 'we have no need to borrow')
    }
    case 'guarantee': {
      if (op < -20) return verdict(false, 'a guarantee from you is no comfort')
      if (me.overlord === p.from) return verdict(false, 'we are already yours')
      const threatened = enemiesOf(s, botId).length > 0 || [...myNeighbors].some((x) => perceivedPower(s, map, botId, x) > myP * 1.3)
      if (threatened || op > 10) return verdict(true, threatened ? 'we welcome a protector' : 'our friendship is strong')
      return verdict(false, 'we are not in need of protection')
    }
    case 'callToArms': {
      const enemy = p.enemy
      const enemyName = s.nations[enemy]?.name ?? 'them'
      if (hasPact(s, botId, enemy) || isAllied(s, botId, enemy)) return verdict(false, `we are bound by treaty with ${enemyName}`)
      const eP = perceivedPower(s, map, botId, enemy)
      const opEnemy = opinionOf(s, map, botId, enemy, { borders: myNeighbors.has(enemy), coalition })
      const score =
        -8 +
        op * 0.45 +
        (isAllied(s, botId, p.from) ? 20 : 0) +
        (persona.loyalty - 1) * 30 -
        (eP / myP) * 18 -
        me.warWeariness * 0.6 -
        enemiesOf(s, botId).length * 14 -
        opEnemy * 0.25 +
        (myNeighbors.has(enemy) ? 5 : -5) +
        noise
      if (score > 0) return verdict(true, 'we stand with our allies')
      if (eP > myP * 1.2) return verdict(false, `${enemyName} is too strong for us`)
      if (me.warWeariness > 20) return verdict(false, 'our people are weary of war')
      return verdict(false, 'we will not bleed for you')
    }
  }
}
