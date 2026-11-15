import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { computeEconomy } from '../economy'
import { empireCount } from '../empire'
import { applyEventChoice } from '../events'
import { resolveTurn } from '../resolveTurn'
import type { GameState } from '../types'
import { SKILL_KEYS } from '../types'

/** Plays every nation with the AI for some months on the real world and returns the state. */
function play(seed: number, difficulty: 'easy' | 'normal' | 'hard', months: number): GameState {
  const { map } = getWorld()
  let s = createInitialState(map, { playerRegionId: 'poland', seed, difficulty, goal: 'world', victoryShare: 2 })
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    s = resolveTurn(s, map, [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)])
  }
  return s
}

const median = (v: number[]) => {
  const x = [...v].sort((a, b) => a - b)
  return x.length ? x[Math.floor(x.length / 2)] : 0
}

/** Every new number stays in its range and is a real number. */
function checkInvariants(s: GameState) {
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
    const p = n.people
    const sum = SKILL_KEYS.reduce((a, k) => a + p.skills[k], 0)
    expect(sum, n.id).toBeCloseTo(1, 5)
    for (const k of SKILL_KEYS) expect(p.skills[k] >= 0 && Number.isFinite(p.skills[k]), `${n.id} ${k}`).toBe(true)
    expect(p.schooling >= 0 && p.schooling <= 0.98, `${n.id} schooling ${p.schooling}`).toBe(true)
    expect(p.health >= 0 && p.health <= 0.98, `${n.id} health`).toBe(true)
    expect(p.unemployment >= 0.01 - 1e-9 && p.unemployment <= 0.45 + 1e-9, `${n.id} unemployment ${p.unemployment}`).toBe(true)
    expect(n.bank.inflation >= -5 && n.bank.inflation <= 60, `${n.id} inflation`).toBe(true)
    expect(n.bank.currency >= 0.6 - 1e-9 && n.bank.currency <= 1.6 + 1e-9, `${n.id} currency`).toBe(true)
    expect(n.bank.fund >= 0, `${n.id} fund`).toBe(true)
    expect(Math.abs(n.debt - n.bonds.reduce((a, b) => a + b.amount, 0)) < 1e-6, `${n.id} debt`).toBe(true)
    expect(Number.isFinite(n.resources.capital), `${n.id} money`).toBe(true)
    expect(n.tier >= 1 && n.tier <= 5, `${n.id} tier`).toBe(true)
  }
}

describe('the economy over years of play', () => {
  it('sixty months on Hard: every number in range, prices and jobs sane, no runaway empire', () => {
    const s = play(5, 'hard', 60)
    checkInvariants(s)
    const { map } = getWorld()
    const alive = Object.values(s.nations).filter((n) => n.alive)
    const infl = median(alive.map((n) => n.bank.inflation))
    const jobless = median(alive.map((n) => n.people.unemployment))
    expect(infl).toBeLessThan(15)
    expect(jobless).toBeLessThan(0.1)
    // A big empire earns more per worker than a small nation, but not by much: bonuses from many countries flatten out.
    const perWorker = (big: boolean) =>
      median(
        alive
          .filter((n) => (big ? empireCount(s, n.id) >= 10 : empireCount(s, n.id) <= 3))
          .map((n) => {
            const e = computeEconomy(s, map, n.id)
            return e.gross / Math.max(0.3, e.workforce)
          }),
      )
    const big = perWorker(true)
    const small = perWorker(false)
    const tiers = [1, 2, 3, 4, 5].map((t) => alive.filter((n) => n.tier === t).length)
    console.log(`60 months Hard: inflation median ${infl.toFixed(1)}%, unemployment median ${(jobless * 100).toFixed(1)}%, gross per worker big/small ${(big / Math.max(1e-6, small)).toFixed(2)}, tiers ${tiers.join('/')}, schooling median ${median(alive.map((n) => n.people.schooling)).toFixed(2)}, health median ${median(alive.map((n) => n.people.health)).toFixed(2)}`)
    if (big > 0) expect(big / small).toBeLessThan(1.6)
    // On Hard, someone has grown into a regional power within five years.
    expect(alive.some((n) => n.tier >= 2)).toBe(true)
  }, 240_000)

  it('runs the same twice: the new systems are deterministic', () => {
    const a = play(9, 'normal', 18)
    const b = play(9, 'normal', 18)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    checkInvariants(a)
  }, 240_000)
})
