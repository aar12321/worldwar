import { describe, it } from 'vitest'
import type { Difficulty } from '../types'
import { summarizeTerritory, territoryBotRun } from './territoriesBots.sim'

/** Opt-in: VITE_TERRBOT=hard VITE_TERRBOT_SEEDS=1,2,3 VITE_TERRBOT_MONTHS=120 npx vitest run src/engine/__tests__/territoriesBots.test.ts. Prints TERRBOT lines. */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env
const suite = env.VITE_TERRBOT ? describe : describe.skip
suite('territories in bot play', () => {
  const diff = (env.VITE_TERRBOT ?? 'hard') as Difficulty
  const seeds = (env.VITE_TERRBOT_SEEDS ?? '1,2,3').split(',').map(Number)
  const months = Number(env.VITE_TERRBOT_MONTHS ?? 120)
  for (const seed of seeds)
    it(`${diff} seed ${seed}`, async () => {
      const r = territoryBotRun(diff, seed, months)
      const line = 'TERRBOT ' + JSON.stringify({ ...r, lives: r.lives.map(summarizeTerritory) })
      console.log(line)
      if (env.VITE_TERRBOT_OUT) (await import(/* @vite-ignore */ 'node:' + 'fs')).appendFileSync(env.VITE_TERRBOT_OUT, line + '\n')
    }, 3_600_000)
})
