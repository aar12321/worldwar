import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { advanceDay, type LiveEvent } from '../live'
import type { GameState, UnitCounts } from '../types'
import { UNIT_TYPES } from '../types'

const finite = (x: number) => Number.isFinite(x)

describe('a year of a live game, played by the AI', () => {
  const { map } = getWorld()

  it('keeps every number sane every day, and every army accounted for', () => {
    let s: GameState = createInitialState(map, { playerRegionId: 'china', seed: 9, difficulty: 'hard', goal: 'classic', victoryShare: 2, mode: 'live' })
    const planner = (st: GameState, m: typeof map) => [...generateAllBotOrders(st, m), ...generateBotOrders(st, m, st.playerId, true)]
    const launched = new Map<string, UnitCounts>()
    const ms: number[] = []
    const problems: string[] = []
    let battles = 0
    let monthEnds = 0
    while (s.turn <= 12 && s.outcome === 'playing') {
      if (s.pendingEvent) s = applyEventChoice(s, map, 0)
      const t0 = performance.now()
      const step = advanceDay(s, map, { planner })
      ms.push(performance.now() - t0)
      s = step.state
      if (step.monthEnded) monthEnds++
      for (const e of step.events as LiveEvent[]) {
        if (e.kind === 'launched') launched.set(e.army.id, e.army.units)
        if (e.kind === 'battle') battles++
        if (e.kind === 'home') {
          const sent = launched.get(e.army.id)
          for (const k of UNIT_TYPES) if (sent && e.army.units[k] > sent[k] + 1e-6) problems.push(`${e.army.id} came home with more ${k} than it left with`)
        }
      }
      for (const n of Object.values(s.nations)) {
        if (!n.alive) continue
        for (const k of UNIT_TYPES) if (!finite(n.military.units[k]) || n.military.units[k] < -1e-6) problems.push(`${n.id} ${k} ${n.military.units[k]}`)
      }
      for (const a of s.armies ?? []) {
        if (!s.nations[a.nationId]?.alive) problems.push(`army ${a.id} of a fallen nation`)
        if (!(a.end > a.start) || !finite(a.start) || !finite(a.end)) problems.push(`army ${a.id} leg ${a.start}->${a.end}`)
        for (const k of UNIT_TYPES) if (!finite(a.units[k]) || a.units[k] < -1e-6) problems.push(`army ${a.id} ${k} ${a.units[k]}`)
        if (!s.regions[a.target] || !s.regions[a.home]) problems.push(`army ${a.id} has no place to go`)
      }
      for (const l of s.launches ?? []) if (!s.nations[l.order.nationId]?.alive) problems.push(`launch ${l.id} of a fallen nation`)
      for (const f of s.flights ?? []) if (!s.nations[f.nationId]?.alive || !finite(f.count)) problems.push(`flight ${f.id}`)
      if (problems.length > 5) break
    }
    expect(problems).toEqual([])
    expect(monthEnds).toBeGreaterThanOrEqual(11)
    expect(battles).toBeGreaterThan(10)
    // A day tick copies the state when something happens, and costs almost nothing when it does not.
    const sorted = [...ms].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    console.log(`live day tick: median ${median.toFixed(2)} ms, 95th percentile ${p95.toFixed(1)} ms, slowest (a month turning) ${sorted[sorted.length - 1].toFixed(0)} ms`)
    expect(median).toBeLessThan(15)
  }, 180_000)
})
