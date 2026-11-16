import { describe, it } from 'vitest'
import type { Difficulty } from '../types'
import { puppetBotRun, summarizeLife } from './puppetsBots.sim'

/** Opt-in: VITE_PUPBOT=hard VITE_PUPBOT_SEEDS=1,2,3 VITE_PUPBOT_MONTHS=120 npx vitest run src/engine/__tests__/puppetsBots.test.ts. Prints PUPBOT lines. */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env
const suite = env.VITE_PUPBOT ? describe : describe.skip
suite('puppets in bot play', () => {
  const diff = (env.VITE_PUPBOT ?? 'hard') as Difficulty
  const seeds = (env.VITE_PUPBOT_SEEDS ?? '1,2,3').split(',').map(Number)
  const months = Number(env.VITE_PUPBOT_MONTHS ?? 120)
  for (const seed of seeds)
    it(`${diff} seed ${seed}`, () => {
      const r = puppetBotRun(diff, seed, months)
      console.log('PUPBOT ' + JSON.stringify({ ...r, lives: r.lives.map(summarizeLife) }))
    }, 3_600_000)
})
