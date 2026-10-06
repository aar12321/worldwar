import { PERSONALITIES } from '../data/personalities'
import { computeEconomy, militaryPower, unitPower, type EconomyReport } from '../engine/economy'
import { alliesOf, atWar, enemiesOf, hasCasusBelli, hasPact, isAllied, nationModifiers, pairKey } from '../engine/helpers'
import type { Rng } from '../engine/rng'
import { bundleEmpty, bundleEntries, marketPrices, stockOf, type MarketPrices } from '../engine/trade'
import type { Army, GameState, NationId, Proposal, RegionId, ResourceBundle, TradeResource, WorldMap } from '../engine/types'
import { visibleRegions } from '../engine/visibility'
import { netWarScore, termsCost } from '../engine/warscore'
import { coalitionActive, nationNeighbors, opinionOf } from './opinion'

function hash01(...parts: (string | number)[]): number {
  let h = 2166136261
  const str = parts.join('|')
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/**
 * What `viewer` believes `target`'s military power to be. Armies it can see are counted exactly;
 * hidden ones are guessed with a +-20% error that drifts every few months, like real intelligence.
 */
export function perceivedPower(s: GameState, map: WorldMap, viewer: NationId, target: NationId, vis?: Set<RegionId> | 'all', armies?: Army[]): number {
  if (viewer === target) return militaryPower(s, target)
  const n = s.nations[target]
  if (!n) return 0
  const seen = vis ?? visibleRegions(s, map, viewer)
  const mods = nationModifiers(n)
  let visible = 0
  let hidden = 0
  for (const a of armies ?? Object.values(s.armies)) {
    if (a.owner !== target) continue
    const p = unitPower(a.units, mods)
    if (seen === 'all' || seen.has(a.location)) visible += p
    else hidden += p
  }
  return visible + hidden * (0.8 + 0.4 * hash01(viewer, target, Math.floor(s.turn / 3)))
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
  }
}

function valueFor(s: GameState, id: NationId, b: ResourceBundle, prices: MarketPrices, econ: EconomyReport): number {
  return bundleEntries(b).reduce((sum, [r, v]) => sum + v * prices[r] * needFor(s, id, r, econ), 0)
}

/** Amount of a resource a nation keeps back and will not trade away. */
export const TRADE_RESERVE: Record<TradeResource, number> = { capital: 25, food: 8, tp: 0, manpower: 30 }

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
  const coalition = coalitionActive(s)
  const op = opinionOf(s, map, botId, p.from, { borders, coalition })
  const vis = visibleRegions(s, map, botId)
  const myP = Math.max(1, militaryPower(s, botId))
  const theirP = perceivedPower(s, map, botId, p.from, vis)
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
        const px = perceivedPower(s, map, botId, x, vis) * (coalition && x === s.playerId ? 1.4 : 1)
        if (px > myP * 1.3 && opinionOf(s, map, botId, x, { borders: true, coalition }) < 10) {
          threat = x
          break
        }
      }
      let dragged = 0
      for (const e of enemiesOf(s, p.from)) if (!myEnemies.has(e) && perceivedPower(s, map, botId, e, vis) > myP * 0.6) dragged += 18
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
    case 'callToArms': {
      const enemy = p.enemy
      const enemyName = s.nations[enemy]?.name ?? 'them'
      if (hasPact(s, botId, enemy) || isAllied(s, botId, enemy)) return verdict(false, `we are bound by treaty with ${enemyName}`)
      const eP = perceivedPower(s, map, botId, enemy, vis)
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
