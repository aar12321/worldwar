import { describe, expect, it, vi } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { resolveTurn } from '../resolveTurn'
import { pairKey } from '../helpers'
import { tensionOf } from '../missileWar'
import type { Difficulty, GameState } from '../types'
import { invariantProblems } from './invariants'

vi.setConfig({ testTimeout: 600_000 })

/**
 * The AI plays the missile war for many months on the real world, with bots in every seat. Measures what rivals do with it by difficulty
 * and checks it does not run away: nuclear weapons stay as rare as their own rules make them, the world's tension stays bounded, and Easy
 * rivals never touch it. The numbers are printed so docs/MISSILE_WAR_STATUS.md can quote them.
 */
interface Tally {
  months: number
  salvos: number
  missilesFired: number
  site: number
  raids: number
  auto: number
  ceasefires: number
  nukes: number
  falseAlarms: number
  maxTension: number
  dead: number
  interceptorsSpent: number
  problems: string[]
}

const people = (s: GameState, id: string) => Object.values(s.regions).filter((r) => r.owner === id).reduce((sum, r) => sum + r.population, 0)

/** A stressed world: the eight most populous nations split into two camps at war, each with money, a level-3 missile program, a store of missiles and shields. */
function worldWar(s: GameState) {
  const big = Object.values(s.nations)
    .filter((n) => n.alive)
    .sort((a, b) => people(s, b.id) - people(s, a.id) || (a.id < b.id ? -1 : 1))
    .slice(0, 8)
  big.forEach((a, i) => big.forEach((b, j) => i < 4 && j >= 4 && s.wars.push(pairKey(a.id, b.id))))
  for (const n of big) {
    n.resources.capital += 3000
    n.resources.steel += 500
    n.resources.oil += 200
    n.missileProgram = 3
    n.arsenal = { cruise: 12, tactical: 12, ballistic: 6, decoy: 12 }
    n.military.units.missile = 8
    n.military.units.air = Math.max(n.military.units.air, 3)
    n.military.units.fighter = Math.max(n.military.units.fighter, 3)
    n.systems.shield = 2
  }
}

function play(seed: number, difficulty: Difficulty, player: string, months: number, stress = false): Tally {
  const { map } = getWorld()
  let s: GameState = createInitialState(map, { playerRegionId: player, seed, difficulty, goal: 'classic', victoryShare: 2 })
  if (stress) worldWar(s)
  const t: Tally = { months: 0, salvos: 0, missilesFired: 0, site: 0, raids: 0, auto: 0, ceasefires: 0, nukes: 0, falseAlarms: 0, maxTension: 0, dead: 0, interceptorsSpent: 0, problems: [] }
  const seen = new Set<string>()
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    const orders = [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)]
    s = resolveTurn(s, map, orders)
    t.months++
    for (const r of s.salvos ?? []) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      t.salvos++
      if (r.weapon === 'raid') t.raids++
      else t.missilesFired += r.fired
      if (r.aim === 'site') t.site++
      if (r.auto) t.auto++
      t.dead += r.dead
      t.interceptorsSpent += r.interceptorsUsed
    }
    t.maxTension = Math.max(t.maxTension, tensionOf(s))
    for (const l of s.log) if (l.turn === s.turn - 1) {
      if (/missile ceasefire:/.test(l.text)) t.ceasefires++
      if (/FALSE ALARM/.test(l.text)) t.falseAlarms++
    }
  }
  t.nukes = Object.values(s.nations).reduce((sum, n) => sum + (n.nuclear?.fired ?? 0), 0)
  t.problems = invariantProblems(s).slice(0, 5)
  return t
}

describe('the AI in the missile war', () => {
  const runs: Record<string, Tally> = {}
  const show = (label: string, t: Tally) => {
    runs[label] = t
    // eslint-disable-next-line no-console
    console.log(`MWSIM ${label} ${JSON.stringify(t)}`)
  }

  it('Easy rivals never use it', () => {
    const t = play(3, 'easy', 'poland', 60)
    show('easy-3', t)
    expect(t.site).toBe(0)
    expect(t.raids).toBe(0)
    expect(t.auto).toBe(0)
    expect(t.ceasefires).toBe(0)
    expect(t.problems).toEqual([])
  })

  it('Normal rivals defend and answer, with few raids, and nothing runs away', () => {
    const t = play(7, 'normal', 'poland', 60)
    show('normal-7', t)
    expect(t.nukes).toBeLessThanOrEqual(1)
    expect(t.maxTension).toBeLessThan(100)
    expect(t.problems).toEqual([])
  })

  it.each([
    ['easy', 3],
    ['normal', 7],
    ['hard', 5],
    ['hard', 11],
  ] as const)('a stressed world war, %s (seed %i): bounded, and Hard uses the missile war most', (difficulty, seed) => {
    const t = play(seed, difficulty, 'poland', 36, true)
    show(`war-${difficulty}-${seed}`, t)
    expect(t.problems).toEqual([])
    expect(t.nukes).toBeLessThanOrEqual(2)
    expect(t.maxTension).toBeLessThanOrEqual(100)
    expect(t.falseAlarms).toBeLessThanOrEqual(3)
    if (difficulty === 'easy') expect(t.site + t.raids + t.auto + t.ceasefires).toBe(0)
  })

  it.each([
    [5, 'china'],
    [11, 'poland'],
    [23, 'brazil'],
  ])('Hard rivals run the whole war (seed %i), bounded: no runaway nuclear war, tension bounded', (seed, player) => {
    const t = play(seed, 'hard', player, 90)
    show(`hard-${seed}`, t)
    // The bomb keeps its own rarity rules: a few launches in seven and a half years at most.
    expect(t.nukes).toBeLessThanOrEqual(2)
    expect(t.falseAlarms).toBeLessThanOrEqual(3)
    expect(t.problems).toEqual([])
  })
})
