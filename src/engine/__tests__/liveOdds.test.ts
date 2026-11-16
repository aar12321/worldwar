import { describe, expect, it } from 'vitest'
import { advanceDay, startLive } from '../live'
import { applyOrderNow } from '../resolveTurn'
import type { GameState } from '../types'
import { forecastAttack } from '../warfare'
import { lineMap, setMilitary, startState } from './fixtures'

describe('what the forecast says is what happens in a live war', () => {
  it('the share of real live battles won matches the forecast, over many seeds', () => {
    const map = lineMap(4)
    let predicted = 0
    let won = 0
    const N = 120
    for (let seed = 1; seed <= N; seed++) {
      const s = startLive(startState(map, 'r0', seed))
      s.wars.push('r0|r1')
      s.nations.r0.resources.capital = 1000
      setMilitary(s, 'r0', { infantry: 14, armor: 3 })
      setMilitary(s, 'r1', { infantry: 8, armor: 1 })
      predicted += forecastAttack(s, map, 'r0', 'r1', 'main', 'assault', 64)!.winChance
      const res = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault' })
      expect(res.army).toBeTruthy()
      let cur: GameState = s
      for (let d = 0; d < 20; d++) {
        const step = advanceDay(cur, map, { planner: () => [] })
        cur = step.state
        const b = step.events.find((e) => e.kind === 'battle')
        if (b && b.kind === 'battle') {
          if (b.report.winner === 'attacker') won++
          break
        }
      }
    }
    expect(Math.abs(won / N - predicted / N)).toBeLessThan(0.13)
  }, 120_000)
})
