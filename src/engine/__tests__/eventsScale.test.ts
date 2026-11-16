import { describe, expect, it } from 'vitest'
import { EVENT_BY_ID } from '../../data/events'
import { EVENT_GAP_TURNS, effectAmount, eventGap, eventScale, resolveEvent } from '../events'
import type { GameState } from '../types'
import { giveRegions, lineMap, startState } from './fixtures'

/** A nation of `n` countries on a line map. */
function empire(n: number): { s: GameState; map: ReturnType<typeof lineMap> } {
  const map = lineMap(Math.max(n, 2) + 2)
  const s = startState(map, 'r0')
  giveRegions(s, 'r0', Array.from({ length: n - 1 }, (_, i) => `r${i + 1}`))
  return { s, map }
}

describe('decisions weigh more, and come sooner, for a bigger empire', () => {
  it('the flat sums scale with the square root of the countries held', () => {
    expect(eventScale(empire(1).s, 'r0')).toBe(1)
    expect(eventScale(empire(10).s, 'r0')).toBeCloseTo(2.2, 5)
    expect(eventScale(empire(25).s, 'r0')).toBeGreaterThan(2.9)
    expect(eventScale(empire(25).s, 'r0')).toBeLessThan(eventScale(empire(60).s, 'r0'))
    expect(effectAmount({ type: 'resource', key: 'pp', amount: 20 }, 0, 3)).toBe(60)
    // The default is the old rule, so nothing that does not pass a scale changes.
    expect(effectAmount({ type: 'resource', key: 'capital', amount: -40, perWorkforce: -2 }, 10)).toBe(-60)
  })

  it('the gap between decisions shrinks from a year to half a year', () => {
    expect(eventGap(empire(1).s, 'r0')).toBe(EVENT_GAP_TURNS)
    expect(eventGap(empire(3).s, 'r0')).toBe(EVENT_GAP_TURNS)
    expect(eventGap(empire(4).s, 'r0')).toBe(10)
    expect(eventGap(empire(10).s, 'r0')).toBe(8)
    expect(eventGap(empire(25).s, 'r0')).toBe(6)
  })

  it('a decision pays or costs a big empire more in absolute terms than a single country', () => {
    const gained = (n: number) => {
      const { s, map } = empire(n)
      s.pendingEvent = { eventId: 'foreign_investors', turn: 1, rivalId: 'r1', regionId: null }
      const def = EVENT_BY_ID.foreign_investors
      const pp = def.options.findIndex((o) => o.effects.some((e) => e.type === 'resource' && e.key === 'pp' && e.amount > 0))
      expect(pp).toBeGreaterThanOrEqual(0)
      s.nations.r0.resources.pp = 0
      expect(resolveEvent(s, map, pp, 'r0', false)).toBe(true)
      return s.nations.r0.resources.pp
    }
    expect(gained(25)).toBeGreaterThan(gained(1) * 2.5)
  })
})
