import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../types'
import { relationsBotRun } from './relationsBots.sim'

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env

/**
 * A short always-on check that rivals really use the desk and the world stays sane. The long one is opt in:
 * VITE_RELSIM=hard VITE_RELSIM_SEEDS=1,2,3 VITE_RELSIM_MONTHS=60 npx vitest run src/engine/__tests__/relationsSim.test.ts
 * (prints RELSIM lines).
 */
describe('relationships in bot play (short)', () => {
  it('Hard rivals tend their friendships for 12 months, and no opinion runs away', () => {
    const r = relationsBotRun('hard', 3, 12)
    expect(Object.values(r.acts).reduce((a, b) => a + b, 0)).toBeGreaterThan(5)
    expect(r.pairs.atTop).toBeLessThanOrEqual(Math.ceil(r.pairs.n * 0.02))
    expect(r.maxAllies).toBeLessThanOrEqual(4)
  }, 240_000)

  it('Easy rivals rarely do anything', () => {
    const hard = relationsBotRun('hard', 3, 12)
    const easy = relationsBotRun('easy', 3, 12)
    const sum = (a: Record<string, number>) => Object.values(a).reduce((x, y) => x + y, 0)
    expect(sum(easy.acts)).toBeLessThan(sum(hard.acts) / 3)
  }, 240_000)
})

const long = env.VITE_RELSIM ? describe : describe.skip
long('relationships in bot play (long)', () => {
  const diff = (env.VITE_RELSIM ?? 'hard') as Difficulty
  const seeds = (env.VITE_RELSIM_SEEDS ?? '1,2,3').split(',').map(Number)
  const months = Number(env.VITE_RELSIM_MONTHS ?? 60)
  for (const seed of seeds)
    for (const on of [true, false])
      it(`${diff} seed ${seed} ${on ? 'with' : 'without'} the relationship rules`, () => {
        const r = relationsBotRun(diff, seed, months, on)
        const line = 'RELSIM ' + JSON.stringify(r)
        ;(globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(line + '\n')
      }, 3_600_000)
})
