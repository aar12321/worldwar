import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { outlookAt } from '../forecast'
import { forceUnits, totalUnits } from '../helpers'
import { advanceDay, startLive } from '../live'
import { militaryPower } from '../militaryStats'
import { applyOrderNow } from '../resolveTurn'
import type { GameState } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

/**
 * The bug report: "I am losing to smaller, weaker nations even though my strength score is higher." Strength adds up what units are worth;
 * a battle is won by the share of it that goes, against everything the defender has plus its garrison, and the defender wins ties.
 * Measured here: a player 1.5 to 2 times as strong who sends a main force keeps losing; one who attacks when the real odds are good wins.
 */
function campaign(ratio: number, seed: number, rule: 'blind' | 'odds') {
  const map = lineMap(4)
  let s: GameState = startLive(startState(map, 'r0', seed))
  s.wars.push('r0|r1')
  setMilitary(s, 'r1', { infantry: 6, armor: 1 })
  const base = militaryPower(s, 'r1')
  setMilitary(s, 'r0', { infantry: 6, armor: 1 })
  const f = (ratio * base) / militaryPower(s, 'r0')
  setMilitary(s, 'r0', { infantry: 6 * f, armor: 1 * f })
  s.nations.r0.resources.capital = 2000
  const planner = (st: GameState, m: typeof map) => generateAllBotOrders(st, m)
  const start = s.turn
  let battlesWon = 0
  let battlesLost = 0
  while (s.turn < start + 8 && s.outcome === 'playing' && !s.pendingEvent) {
    const out = (s.armies ?? []).some((a) => a.nationId === 'r0')
    if (!out && s.regions.r1.owner === 'r1' && (s.day ?? 0) % 3 === 0) {
      // 'blind' attacks with a main force whenever it can; 'odds' does it only when the war room says it is a good bet, with all in as the strongest it has.
      const o = outlookAt(s, map, 'r0', 'r1')
      const commit = rule === 'blind' ? 'main' : o && o.main.winChance >= 0.6 ? 'main' : o && o.allin.winChance >= 0.75 ? 'allin' : null
      if (commit) applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit, stance: 'assault' })
    }
    const step = advanceDay(s, map, { planner })
    s = step.state
    for (const e of step.events) if (e.kind === 'battle' && e.report.attacker.nationId === 'r0') {
      if (e.report.winner === 'attacker') battlesWon++
      else battlesLost++
    }
  }
  return { s, battlesWon, battlesLost, mine: totalUnits(forceUnits(s, 'r0')) }
}

describe('a stronger nation in a live game', () => {
  it('Strength is not odds: at 1.5 and 2 times their strength a main force is not a safe bet, and the outlook says so', () => {
    const map = lineMap(4)
    const s = startLive(startState(map, 'r0', 1))
    s.wars.push('r0|r1')
    setMilitary(s, 'r1', { infantry: 6, armor: 1 })
    const base = militaryPower(s, 'r1')
    setMilitary(s, 'r0', { infantry: 6, armor: 1 })
    setMilitary(s, 'r0', { infantry: 6 * ((2 * base) / militaryPower(s, 'r0')), armor: (2 * base) / militaryPower(s, 'r0') })
    expect(militaryPower(s, 'r0') / militaryPower(s, 'r1')).toBeCloseTo(2, 1)
    const o = outlookAt(s, map, 'r0', 'r1')!
    expect(o.main.winChance).toBeLessThan(0.5)
    expect(o.allin.winChance).toBeGreaterThan(o.main.winChance + 0.3)
  })

  it('attacking blind at 1.5 times the strength loses more fights than it wins, over several seeds', () => {
    let won = 0
    let lost = 0
    for (const seed of [1, 2, 3, 4]) {
      const r = campaign(1.5, seed, 'blind')
      won += r.battlesWon
      lost += r.battlesLost
    }
    expect(lost).toBeGreaterThan(won)
  }, 120_000)

  it('following the odds, a nation twice as strong wins its war and is never wiped out, on every seed', () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = campaign(2, seed, 'odds')
      expect(r.s.outcome).toBe('playing')
      expect(r.s.regions.r1.owner).toBe('r0')
      expect(r.battlesLost).toBeLessThanOrEqual(1)
    }
  }, 120_000)
})
