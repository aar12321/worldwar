import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { advanceDay, startLive } from '../live'
import { applyEventChoice } from '../events'
import { resolveTurn } from '../resolveTurn'
import type { GameState } from '../types'
import { playAttacks } from './attackRate'
import { checkInvariants } from './invariants'

/**
 * Long headless games with the AI in every seat, both modes, checking every number stays real and in range. Slow, so it runs only
 * when asked for: VITE_LONG_SIM=1 npx vitest run src/engine/__tests__/longSim.test.ts
 */
const long = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_LONG_SIM ? describe : describe.skip

function turns(seed: number, difficulty: 'easy' | 'normal' | 'hard', months: number): GameState {
  const { map } = getWorld()
  let s = createInitialState(map, { playerRegionId: 'poland', seed, difficulty, goal: 'world', victoryShare: 2 })
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, i % 2)
    s = resolveTurn(s, map, [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)])
    if (i % 12 === 11) checkInvariants(s)
  }
  return s
}

function live(seed: number, difficulty: 'easy' | 'normal' | 'hard', months: number): GameState {
  const { map } = getWorld()
  let s = startLive(createInitialState(map, { playerRegionId: 'poland', seed, difficulty, goal: 'world', victoryShare: 2 }))
  const planner = (st: GameState, m: typeof map) => [...generateAllBotOrders(st, m), ...generateBotOrders(st, m, st.playerId, true)]
  const target = months + 1
  let guard = 0
  while (s.turn < target && s.outcome === 'playing' && guard++ < months * 40) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    s = advanceDay(s, map, { planner }).state
    if (s.day === 0 && s.turn % 12 === 0) checkInvariants(s)
  }
  return s
}

const summary = (label: string, s: GameState) => {
  const alive = Object.values(s.nations).filter((n) => n.alive)
  const tiers = [1, 2, 3, 4, 5].map((t) => alive.filter((n) => n.tier === t).length)
  const med = (f: (n: (typeof alive)[number]) => number) => [...alive.map(f)].sort((a, b) => a - b)[Math.floor(alive.length / 2)]
  console.log(`${label}: month ${s.turn - 1}, ${alive.length} nations alive, tiers ${tiers.join('/')}, inflation median ${med((n) => n.bank.inflation).toFixed(1)}%, jobless median ${(med((n) => n.people.unemployment) * 100).toFixed(1)}%, health ${med((n) => n.people.health).toFixed(2)}, schooling ${med((n) => n.people.schooling).toFixed(2)}, outcome ${s.outcome}`)
}

long('long headless games', () => {
  for (const [difficulty, months] of [['hard', 120], ['normal', 60], ['easy', 60]] as const) {
    it(`turns: ${months} months on ${difficulty}`, () => {
      const s = turns(11, difficulty, months)
      checkInvariants(s)
      summary(`turns ${difficulty}`, s)
      expect(s.turn).toBeGreaterThan(Math.min(months, 30))
    }, 1_800_000)
    it(`live: ${months} months on ${difficulty}`, () => {
      const s = live(11, difficulty, months)
      checkInvariants(s)
      summary(`live ${difficulty}`, s)
      expect(s.turn).toBeGreaterThan(Math.min(months, 30))
      // Every army that is still out belongs to a living nation, and no unit count has gone negative or odd.
      for (const a of s.armies ?? []) expect(s.nations[a.nationId]?.alive).toBe(true)
    }, 3_600_000)
  }
})

/**
 * The plan's promise: "attack-rate parity stays within ±20% over 36 months". The same AI plans the same wars in both modes; live
 * only adds marches, recalls and held-back launches, so it should fight about as many battles as turns do. Three seeds each, added
 * up, because a single seed swings by a quarter either way (battles depend on who happens to fall to whom). Measured when this was
 * written, over seeds 1 to 3 on China: Hard 880 live vs 889 turns (0.99), Normal 538 vs 596 (0.90); seeds 4 to 6 on Hard, 946 vs 1080 (0.88).
 */
long('attack-rate parity between turns and live, 36 months', () => {
  for (const difficulty of ['hard', 'normal'] as const) {
    it(`${difficulty}: live fights within 20% of the battles turns do, over three seeds`, () => {
      const total = { turns: { battles: 0, captures: 0 }, live: { battles: 0, captures: 0 } }
      for (const seed of [1, 2, 3]) {
        const t = playAttacks('turns', { seed, difficulty, months: 36 })
        const l = playAttacks('live', { seed, difficulty, months: 36 })
        console.log(`${difficulty} seed ${seed}: turns ${t.battles} battles, ${t.captures} captured; live ${l.battles} battles, ${l.captures} captured`)
        for (const k of ['battles', 'captures'] as const) {
          total.turns[k] += t[k]
          total.live[k] += l[k]
        }
      }
      const ratio = total.live.battles / total.turns.battles
      const captureRatio = total.live.captures / Math.max(1, total.turns.captures)
      console.log(`${difficulty}: battles live/turns = ${total.live.battles}/${total.turns.battles} = ${ratio.toFixed(2)}, captures ${total.live.captures}/${total.turns.captures} = ${captureRatio.toFixed(2)}`)
      expect(total.turns.battles).toBeGreaterThan(300)
      expect(ratio).toBeGreaterThanOrEqual(0.8)
      expect(ratio).toBeLessThanOrEqual(1.2)
      // Captures are a fifth as many, so they are noisier: a wider band, still tight enough to notice a live clock that stops taking land.
      expect(captureRatio).toBeGreaterThanOrEqual(0.7)
      expect(captureRatio).toBeLessThanOrEqual(1.3)
    }, 3_600_000)
  }
})
