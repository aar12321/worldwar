import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { nationNeighbors, opinionOf } from '../../ai/opinion'
import { TIES } from '../../data/relations'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { alliesOf } from '../helpers'
import { resolveTurn } from '../resolveTurn'
import type { Difficulty, GameState } from '../types'

/**
 * The starting mood and how it drifts (docs/RELATIONS_STATUS.md, "Ties and the starting mood"). The player sits idle (a new player who has
 * not yet done anything), every rival is a bot, and the world runs with its default goal. Each run prints a TIESSIM line to stderr.
 * Measured with ties on and off, so the numbers in the doc can be checked.
 */

const { map } = getWorld()
const write = (line: string) => (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(line + '\n')

interface Mood {
  n: number
  mean: number
  /** Shares of rivals that are wary or worse (opinion -5 or less) and hostile (-25 or less). */
  wary: number
  hostile: number
  /** Neighbours only. */
  nbN: number
  nbMean: number
  nbWary: number
  nbHostile: number
}

function mood(s: GameState): Mood {
  const nb = nationNeighbors(s, map, s.playerId)
  const all: number[] = []
  const near: number[] = []
  for (const n of Object.values(s.nations)) {
    if (!n.alive || n.id === s.playerId) continue
    const v = opinionOf(s, map, n.id, s.playerId)
    all.push(v)
    if (nb.has(n.id)) near.push(v)
  }
  const share = (v: number[], f: (x: number) => boolean) => Math.round((v.filter(f).length / Math.max(1, v.length)) * 1000) / 1000
  const mean = (v: number[]) => Math.round((v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)) * 10) / 10
  return { n: all.length, mean: mean(all), wary: share(all, (x) => x <= -5), hostile: share(all, (x) => x <= -25), nbN: near.length, nbMean: mean(near), nbWary: share(near, (x) => x <= -5), nbHostile: share(near, (x) => x <= -25) }
}

function withTies<T>(on: boolean, fn: () => T): T {
  const was = TIES.on
  TIES.on = on
  try {
    return fn()
  } finally {
    TIES.on = was
  }
}

const start = (player: string, seed: number, difficulty: Difficulty) => createInitialState(map, { playerRegionId: player, seed, difficulty })

/** Bots in every seat but the player's, for some months; returns the end state and alliance counts. */
function drift(player: string, seed: number, difficulty: Difficulty, months: number) {
  let s = start(player, seed, difficulty)
  let maxAllies = 0
  let declared = 0
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    const before = new Set(s.wars)
    s = resolveTurn(s, map, generateAllBotOrders(s, map))
    declared += s.wars.filter((w) => !before.has(w)).length
    for (const n of Object.values(s.nations)) if (n.alive) maxAllies = Math.max(maxAllies, alliesOf(s, n.id).length)
  }
  // Rival to rival: every nation toward the ten after it, the same sample the relations sim uses.
  const ids = Object.values(s.nations).filter((n) => n.alive).map((n) => n.id)
  const pairs: number[] = []
  for (let i = 0; i < ids.length; i++) for (let k = 1; k <= 10; k++) pairs.push(opinionOf(s, map, ids[i], ids[(i + k) % ids.length]))
  const pairMean = Math.round((pairs.reduce((a, b) => a + b, 0) / pairs.length) * 10) / 10
  const ends = pairs.filter((x) => Math.abs(x) >= 90).length / pairs.length
  return { s, maxAllies, alliances: s.alliances.length, wars: s.wars.length, declared, pairMean, ends }
}

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env
/** Which games the drift runs: "poland:1,china:2" by default; VITE_TIESSIM_RUNS and VITE_TIESSIM_DIFF widen it for a measurement. */
const RUNS = (env.VITE_TIESSIM_RUNS ?? 'poland:1,china:2').split(',').map((x) => [x.split(':')[0], Number(x.split(':')[1])] as const)
const DIFFS = (env.VITE_TIESSIM_DIFF ?? 'normal,hard').split(',') as Difficulty[]

const PLAYERS = ['poland', 'usa', 'china', 'germany', 'brazil', 'india', 'nigeria', 'france']

describe('the starting mood toward a new player', () => {
  it('most nations start neutral or warmer, and neighbours are not hostile by default (with ties on; off, for comparison)', () => {
    for (const difficulty of ['normal', 'hard'] as const) {
      const on: Mood[] = []
      const off: Mood[] = []
      for (const p of PLAYERS)
        for (const seed of [1, 2, 3]) {
          on.push(withTies(true, () => mood(start(p, seed, difficulty))))
          off.push(withTies(false, () => mood(start(p, seed, difficulty))))
        }
      const avg = (list: Mood[], k: keyof Mood) => Math.round((list.reduce((a, m) => a + (m[k] as number), 0) / list.length) * 1000) / 1000
      const sum = (list: Mood[]) => ({ mean: avg(list, 'mean'), wary: avg(list, 'wary'), hostile: avg(list, 'hostile'), nbMean: avg(list, 'nbMean'), nbWary: avg(list, 'nbWary'), nbHostile: avg(list, 'nbHostile') })
      const a = sum(on)
      const b = sum(off)
      write(`TIESSIM start ${difficulty} on ${JSON.stringify(a)} off ${JSON.stringify(b)}`)
      expect(a.mean).toBeGreaterThan(0)
      expect(a.wary).toBeLessThan(0.12)
      expect(a.hostile).toBe(0)
      expect(a.nbHostile).toBeLessThanOrEqual(0.02)
      expect(a.nbWary).toBeLessThan(0.35)
      // The bug the ties fix: with them off, most neighbours start wary and some hostile.
      expect(b.nbWary).toBeGreaterThan(0.5)
      expect(b.nbHostile).toBeGreaterThan(0.05)
      // No single game is a bad start: China and India were feared from month one.
      for (const m of on) expect(m.nbHostile).toBe(0)
    }
  })
})

describe('24 months later', () => {
  for (const difficulty of DIFFS)
    it(`${difficulty}: the mood holds for an idle player, rivals stay in range, and alliances do not run away`, () => {
      for (const [player, seed] of RUNS) {
        const on = withTies(true, () => drift(player, seed, difficulty, 24))
        const off = withTies(false, () => drift(player, seed, difficulty, 24))
        const mOn = withTies(true, () => mood(on.s))
        const mOff = withTies(false, () => mood(off.s))
        write(`TIESSIM drift ${difficulty} ${player}/${seed} on ${JSON.stringify({ ...mOn, alliances: on.alliances, maxAllies: on.maxAllies, wars: on.wars, declared: on.declared, pairMean: on.pairMean, ends: on.ends })} off ${JSON.stringify({ ...mOff, alliances: off.alliances, maxAllies: off.maxAllies, wars: off.wars, declared: off.declared, pairMean: off.pairMean, ends: off.ends })}`)
        expect(mOn.mean).toBeGreaterThan(0)
        expect(mOn.wary).toBeLessThan(0.15)
        expect(mOn.nbHostile).toBeLessThanOrEqual(0.15)
        expect(on.ends).toBeLessThan(0.02)
        expect(on.maxAllies).toBeLessThanOrEqual(5)
        expect(on.alliances).toBeLessThanOrEqual(Math.max(off.alliances * 1.6, off.alliances + 12))
        expect(on.pairMean).toBeGreaterThan(-5)
        expect(on.pairMean).toBeLessThan(15)
      }
    }, 1_800_000)
})
