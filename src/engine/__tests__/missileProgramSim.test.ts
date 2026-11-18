import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { DEV_IDS, FACILITY_IDS } from '../../data/missileProgram'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { computeEconomy } from '../economy'
import { applyEventChoice } from '../events'
import { programBill } from '../missileProgram'
import { programStaff } from '../programEffects'
import { resolveTurn } from '../resolveTurn'
import type { Difficulty, GameState } from '../types'

/**
 * Rivals running missile programs over two years on the real world: who does, how far they get, what it costs them, and that nobody
 * spams tests or goes broke on it. Prints a summary line per difficulty (kept for docs/MISSILE_PROGRAM_STATUS.md).
 */
function play(difficulty: Difficulty, months: number, seed = 5) {
  const { map } = getWorld()
  let s: GameState = createInitialState(map, { playerRegionId: 'poland', seed, difficulty, goal: 'classic', victoryShare: 2 })
  let worstShare = 0
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    s = resolveTurn(s, map, [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, false)])
    for (const n of Object.values(s.nations)) {
      if (!n.alive || !n.mprog || n.isPlayer) continue
      const gross = computeEconomy(s, map, n.id).gross
      if (gross > 0) worstShare = Math.max(worstShare, programBill(n).total / gross)
    }
  }
  const programs = Object.values(s.nations).filter((n) => n.mprog && !n.isPlayer)
  const sum = (f: (n: (typeof programs)[number]) => number) => programs.reduce((a, n) => a + f(n), 0)
  return {
    s,
    programs: programs.length,
    facilities: sum((n) => FACILITY_IDS.reduce((a, f) => a + (n.mprog!.fac[f] ?? 0), 0)),
    devs: sum((n) => DEV_IDS.filter((d) => n.mprog!.devs[d]?.state === 'done').length),
    tests: sum((n) => n.mprog!.stats.tests),
    successes: sum((n) => n.mprog!.stats.successes),
    staff: sum((n) => programStaff(n)),
    poached: sum((n) => n.mprog!.stats.poached),
    maxTests: Math.max(0, ...programs.map((n) => n.mprog!.stats.tests)),
    worstShare,
    news: s.log.filter((l) => l.text.startsWith('TEST LAUNCH')).length,
  }
}

describe('rivals and the missile program', () => {
  it('Easy rivals never run one', () => {
    expect(play('easy', 12).programs).toBe(0)
  }, 300_000)

  it('Hard rivals build programs, test what they develop, and keep the bill small', () => {
    const r = play('hard', 24)
    const { s: _s, ...line } = r
    console.info('hard 24 months', JSON.stringify(line))
    expect(r.programs).toBeGreaterThanOrEqual(2)
    expect(r.facilities).toBeGreaterThanOrEqual(r.programs)
    expect(r.tests).toBeGreaterThan(0)
    expect(r.successes).toBeGreaterThan(0)
    // No spam: at most a test a month for the busiest, and the bill inside an eighth of income.
    expect(r.maxTests).toBeLessThanOrEqual(24)
    expect(r.worstShare).toBeLessThan(0.12)
  }, 600_000)

  it('Medium rivals are modest', () => {
    const hard = play('hard', 24)
    const medium = play('normal', 24)
    const { s: _m, ...line } = medium
    console.info('normal 24 months', JSON.stringify(line))
    expect(medium.facilities).toBeLessThanOrEqual(hard.facilities)
    expect(medium.worstShare).toBeLessThan(0.12)
  }, 900_000)
})
