import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { offerOutlook } from '../../ai/diplomat'
import { nationNeighbors } from '../../ai/opinion'
import { DEALINGS } from '../../data/relations'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { alliesOf } from '../helpers'
import { resolveTurn } from '../resolveTurn'
import { trustFactor, trustReport } from '../ties'
import type { Difficulty, GameState } from '../types'

/**
 * Trust in a rival's answer (docs/RELATIONS_STATUS.md, "Gaps closed"): the same bot worlds with `DEALINGS` on and off, measured. Each run prints
 * a DEALSIM line to stderr. More seeds by VITE_DEALSIM_SEEDS ("1,2,3"), the difficulty by VITE_DEALSIM_DIFF.
 */

const { map } = getWorld()
const write = (line: string) => (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(line + '\n')
const env = (k: string) => (import.meta as unknown as { env: Record<string, string | undefined> }).env[k]

function withDealings<T>(on: boolean, fn: () => T): T {
  const was = DEALINGS.on
  DEALINGS.on = on
  try {
    return fn()
  } finally {
    DEALINGS.on = was
  }
}

function run(seed: number, difficulty: Difficulty, months: number) {
  let s: GameState = createInitialState(map, { playerRegionId: 'poland', seed, difficulty })
  let declared = 0
  let pactsMade = 0
  let maxAllies = 0
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    const wars = new Set(s.wars)
    const pacts = new Set(Object.keys(s.pacts))
    s = resolveTurn(s, map, generateAllBotOrders(s, map))
    declared += s.wars.filter((w) => !wars.has(w)).length
    pactsMade += Object.keys(s.pacts).filter((k) => !pacts.has(k)).length
    for (const n of Object.values(s.nations)) if (n.alive) maxAllies = Math.max(maxAllies, alliesOf(s, n.id).length)
  }
  return { s, declared, pactsMade, maxAllies, alliances: s.alliances.length, trades: s.deals.filter((d) => d.kind === 'trade').length }
}

/** Trust among rivals at the end: every nation toward its neighbours (where trust has most to say), as mean, 5th and 95th percentile. */
function trustSpread(s: GameState) {
  const v: number[] = []
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
    for (const m of nationNeighbors(s, map, n.id)) if (s.nations[m]?.alive) v.push(trustReport(s, n.id, m, { borders: true }).total)
  }
  v.sort((a, b) => a - b)
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))]
  return { n: v.length, mean: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, p5: at(0.05), p95: at(0.95), moved: v.filter((x) => Math.abs(trustFactor(x)) >= 0.1).length / v.length }
}

/** How often trust changes the answer a neighbour would give to a pact or an alliance, on one end state: on against off. */
function flips(s: GameState) {
  let asked = 0
  let changed = 0
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
    for (const m of [...nationNeighbors(s, map, n.id)].sort().slice(0, 3)) {
      if (!s.nations[m]?.alive) continue
      for (const kind of ['pact', 'alliance'] as const) {
        const on = withDealings(true, () => offerOutlook(s, map, m, n.id, { kind }).outlook)
        const off = withDealings(false, () => offerOutlook(s, map, m, n.id, { kind }).outlook)
        asked++
        if (on !== off) changed++
      }
    }
  }
  return { asked, changed: Math.round((changed / Math.max(1, asked)) * 1000) / 10 }
}

describe('trust in rivals’ answers keeps the world coherent (DEALINGS on against off)', () => {
  const seeds = (env('VITE_DEALSIM_SEEDS') ?? '1').split(',').map(Number)
  const diff = (env('VITE_DEALSIM_DIFF') ?? 'hard') as Difficulty
  for (const seed of seeds) {
    it(`${diff}, seed ${seed}, 24 months`, () => {
      const on = withDealings(true, () => run(seed, diff, 24))
      const off = withDealings(false, () => run(seed, diff, 24))
      const t = trustSpread(on.s)
      const f = flips(on.s)
      write(`DEALSIM ${diff} seed ${seed}: on alliances ${on.alliances} pacts made ${on.pactsMade} trade deals ${on.trades} wars declared ${on.declared} most allies ${on.maxAllies} | off ${off.alliances} ${off.pactsMade} ${off.trades} ${off.declared} ${off.maxAllies} | trust among neighbours mean ${t.mean} p5 ${t.p5} p95 ${t.p95} weighing ${Math.round(t.moved * 100)}% of ${t.n} | answers changed ${f.changed}% of ${f.asked}`)
      // Coherent: no runaway of alliances or wars, nobody allied to everyone, trust in range and mostly near untested.
      expect(on.alliances).toBeLessThanOrEqual(Math.ceil(off.alliances * 1.3) + 3)
      expect(on.alliances).toBeGreaterThanOrEqual(Math.floor(off.alliances * 0.7) - 3)
      expect(on.declared).toBeLessThanOrEqual(Math.ceil(off.declared * 1.3) + 3)
      expect(on.maxAllies).toBeLessThanOrEqual(Math.max(5, off.maxAllies + 1))
      expect(t.p5).toBeGreaterThanOrEqual(0)
      expect(t.p95).toBeLessThanOrEqual(100)
      // Bounded: trust tips a minority of answers.
      expect(f.changed).toBeLessThan(25)
    }, 900_000)
  }
})
