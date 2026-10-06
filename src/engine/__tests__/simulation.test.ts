import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { resolveTurn } from '../resolveTurn'
import type { GameState } from '../types'

const { map } = getWorld()

function simulate(seed: number, turns: number): GameState {
  let s = createInitialState(map, { playerRegionId: 'germany', seed, victoryShare: 0.6 })
  for (let i = 0; i < turns && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    s = resolveTurn(s, map, generateAllBotOrders(s, map, true))
  }
  return s
}

describe('full simulation', () => {
  it('runs 36 bot-only turns without crashing and keeps numbers finite', () => {
    const s = simulate(42, 36)
    expect(s.turn).toBeGreaterThan(30)
    for (const n of Object.values(s.nations)) {
      for (const v of Object.values(n.resources)) expect(Number.isFinite(v)).toBe(true)
      expect(Number.isFinite(n.stability)).toBe(true)
    }
    for (const a of Object.values(s.armies)) for (const v of Object.values(a.units)) expect(Number.isFinite(v)).toBe(true)
    const alive = Object.values(s.nations).filter((n) => n.alive).length
    expect(alive).toBeGreaterThan(20)
  })

  it('is deterministic for the same seed and orders', () => {
    expect(JSON.stringify(simulate(7, 12))).toBe(JSON.stringify(simulate(7, 12)))
  })
})
