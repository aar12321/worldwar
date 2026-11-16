import { describe, expect, it } from 'vitest'
import { forecastMemo, forecastPlan, roughOdds } from '../forecast'
import { totalUnits } from '../helpers'
import type { UnitCounts } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'
import { scenario, simulate } from './forecastScenarios'

/**
 * The forecast is only worth showing if it is the real thing. Each scenario below is played out two ways: the forecast (a hundred or
 * so evenly spread runs of the real battle) and a long simulation of `resolveAttack` itself on a copy of the state with fresh dice.
 * The two must agree within the noise of the simulation.
 */

describe('the forecast is the real fight', () => {
  const N = 40
  const SIMS = 700
  it(`agrees with long simulations of resolveAttack in ${N} varied scenarios`, () => {
    const rows: { name: string; forecast: number; sim: number; diff: number; low: number; high: number }[] = []
    for (let i = 0; i < N; i++) {
      const sc = scenario(i)
      const f = forecastPlan(sc.s, sc.map, 'r0', sc.plan)
      if (!f) continue
      const sim = simulate(sc, SIMS)
      rows.push({ name: sc.name, forecast: f.winChance, sim, diff: Math.abs(f.winChance - sim), low: f.low, high: f.high })
    }
    expect(rows.length).toBeGreaterThan(N * 0.8)
    const mean = rows.reduce((a, r) => a + r.diff, 0) / rows.length
    const worst = Math.max(...rows.map((r) => r.diff))
    const inRange = rows.filter((r) => r.sim >= r.low - 0.02 && r.sim <= r.high + 0.02).length / rows.length
    console.log(`forecast vs simulated win frequency, ${rows.length} scenarios x ${SIMS} fights: mean abs error ${(mean * 100).toFixed(2)} points, worst ${(worst * 100).toFixed(1)}, simulated value inside the stated range (plus simulation noise) ${(inRange * 100).toFixed(0)}%`)
    console.log(rows.map((r) => `${r.name.padEnd(28)} forecast ${(r.forecast * 100).toFixed(1).padStart(5)}  simulated ${(r.sim * 100).toFixed(1).padStart(5)}`).join('\n'))
    expect(mean).toBeLessThan(0.025)
    expect(worst).toBeLessThan(0.08)
    expect(inRange).toBeGreaterThan(0.85)
    // A stated range is a real one, not a rounding of the number.
    for (const r of rows.filter((x) => x.forecast > 0.05 && x.forecast < 0.95)) expect(r.high - r.low).toBeGreaterThan(0.015)
    // The scenarios span the whole range, not only sure things.
    expect(rows.filter((r) => r.sim > 0.15 && r.sim < 0.85).length).toBeGreaterThan(rows.length * 0.25)
  }, 240_000)

  it('is deterministic, free of side effects and cheap enough for every click', () => {
    const sc = scenario(5)
    const before = JSON.stringify(sc.s)
    const a = forecastPlan(sc.s, sc.map, 'r0', sc.plan)!
    const b = forecastPlan(sc.s, sc.map, 'r0', sc.plan)!
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(sc.s)).toBe(before)
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) forecastPlan(sc.s, sc.map, 'r0', sc.plan, 256, false)
    const each = (performance.now() - t0) / 20
    console.log(`forecast of 256 fights: ${each.toFixed(1)} ms`)
    expect(each).toBeLessThan(60)
    // Memoised on the state object.
    const m1 = forecastMemo(sc.s, sc.map, 'r0', sc.plan)
    expect(forecastMemo(sc.s, sc.map, 'r0', sc.plan)).toBe(m1)
  })

  it('more force wins more, and a stronger defence wins less', () => {
    const map = lineMap(6)
    const s = startState(map)
    s.wars.push('r0|r1')
    setMilitary(s, 'r0', { infantry: 20, armor: 6 })
    setMilitary(s, 'r1', { infantry: 10 })
    const at = (units: Partial<UnitCounts>) => forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', units })!.winChance
    expect(at({ infantry: 5 })).toBeLessThan(at({ infantry: 14 }))
    expect(at({ infantry: 14 })).toBeLessThan(at({ infantry: 18 }))
    expect(at({ infantry: 18 })).toBeLessThanOrEqual(at({ infantry: 20, armor: 6 }))
    // The odds are real probabilities, not a switch: a middling edge is a middling chance.
    expect(at({ infantry: 16 })).toBeGreaterThan(0.2)
    expect(at({ infantry: 16 })).toBeLessThan(0.95)
    const weak = forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', units: { infantry: 18 } })!.winChance
    setMilitary(s, 'r1', { infantry: 25 })
    expect(forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', units: { infantry: 18 } })!.winChance).toBeLessThan(weak)
  })

  it('explains the odds with the parts a player can act on', () => {
    const sc = scenario(7)
    const f = forecastPlan(sc.s, sc.map, 'r0', sc.plan)!
    const ids = f.factors.map((x) => x.id)
    for (const id of ['force', 'terrain', 'line', 'stance', 'combined', 'supply', 'quality', 'garrison', 'air', 'missiles', 'reinforce']) expect(ids).toContain(id)
    for (const x of f.factors) {
      expect(x.summary.length).toBeGreaterThan(0)
      expect(x.tip.length).toBeGreaterThan(20)
    }
    expect(f.low).toBeLessThanOrEqual(f.winChance)
    expect(f.high).toBeGreaterThanOrEqual(f.winChance)
    expect(totalUnits(f.sent)).toBeGreaterThan(0)
  })

  it('the rough band always holds the real number and is wider when you know less', () => {
    const sc = scenario(3)
    for (const exact of [0.02, 0.2, 0.5, 0.81, 0.98]) {
      const r = roughOdds(sc.s, 'r0', 'r1', exact)
      expect(r.low).toBeLessThanOrEqual(exact)
      expect(r.high).toBeGreaterThanOrEqual(exact)
      expect(r.high - r.low).toBeGreaterThan(0.1)
    }
    const spied = structuredClone(sc.s)
    spied.intel = { 'r0|r1': spied.turn + 3 }
    const wide = roughOdds(sc.s, 'r0', 'r1', 0.5)
    const narrow = roughOdds(spied, 'r0', 'r1', 0.5)
    expect(narrow.high - narrow.low).toBeLessThan(wide.high - wide.low)
    expect(narrow.intel).toBe('spies')
  })
})
