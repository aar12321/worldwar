import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../types'
import { playWorld, summarize, type SimResult } from './strategySim'

/**
 * Long headless games that measure how the AI plays (docs/STRATEGY.md). Slow, so it runs only when asked for:
 *
 *   VITE_STRAT_DIFF=normal VITE_STRAT_SEEDS=1,2,3 VITE_STRAT_MONTHS=120 npx vitest run src/engine/__tests__/strategySim.test.ts
 *
 * It prints one `STRATGAME {json}` line per game and a `STRATSUM {json}` line with the averaged metrics (add --silent=false to see them). Run the three difficulties in
 * separate processes to use more than one core.
 */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env
const on = !!env.VITE_STRAT_DIFF
const noPosture = env.VITE_STRAT_NOPOSTURE === '1'

const suite = on ? describe : describe.skip

suite('strategy harness', () => {
  const difficulty = (env.VITE_STRAT_DIFF ?? 'normal') as Difficulty
  const seeds = (env.VITE_STRAT_SEEDS ?? '1,2,3').split(',').map(Number)
  const months = Number(env.VITE_STRAT_MONTHS ?? 120)
  const players = ['poland', 'china', 'brazil', 'egypt', 'france', 'india']
  const results: SimResult[] = []
  seeds.forEach((seed, i) => {
    it(`plays seed ${seed}`, () => {
      const { result } = playWorld({ seed, difficulty, months, player: players[i % players.length], check: true, noPosture })
      results.push(result)
      console.log('STRATGAME ' + JSON.stringify({ ...result, wars: result.wars.length, aliveSeries: result.aliveSeries.filter((_, k) => k % 12 === 11) }))
    }, 3_600_000)
  })
  it('prints the averages', () => {
    const sum = summarize(results)
    console.log('STRATSUM ' + JSON.stringify({ difficulty, months, ...sum }))
    expect(results.length).toBe(seeds.length)
  })
})
