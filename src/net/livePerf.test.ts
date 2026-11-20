import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../ai/bot'
import { createInitialState } from '../data/startingNations'
import { daysInMonth } from '../engine/calendar'
import { FREEZE } from '../engine/frozen'
import { startLive } from '../engine/live'
import { resolveTurn } from '../engine/resolveTurn'
import type { GameState } from '../engine/types'
import { getWorld } from '../map/world'
import { liveFingerprint } from './fingerprint'
import { gameOf, liveRoom, same } from './liveHarness'
import { monthEndsNext, planAhead, stepRoomDay } from './liveRoom'

/** Runs `fn` with nothing frozen: every report worked out each time, as before the month-end work. */
function unfrozen<T>(fn: () => T): T {
  FREEZE.on = false
  try {
    return fn()
  } finally {
    FREEZE.on = true
  }
}

describe('the month end, faster without changing anything', () => {
  it('on the real world, the rivals plan exactly the same orders with the planning caches on and off, and planning changes nothing', () => {
    const { map } = getWorld()
    let s: GameState = createInitialState(map, { playerRegionId: 'france', seed: 11, victoryShare: 2 } as never)
    s.humans = ['france', 'germany']
    for (let month = 0; month < 4; month++) {
      const before = JSON.stringify(s)
      const on = generateAllBotOrders(s, map)
      expect(JSON.stringify(s)).toBe(before)
      const off = unfrozen(() => generateAllBotOrders(s, map))
      expect(JSON.stringify(on)).toBe(JSON.stringify(off))
      expect(on.length).toBeGreaterThan(50)
      s = resolveTurn(s, map, on)
    }
  }, 600_000)

  it('a live month end on the real world is the same with the caches on and off', () => {
    const { map } = getWorld()
    const s = startLive(createInitialState(map, { playerRegionId: 'france', seed: 5, victoryShare: 2 } as never))
    s.humans = ['france', 'germany']
    s.day = daysInMonth(s.turn) - 1
    expect(monthEndsNext(s)).toBe(true)
    const on = stepRoomDay(structuredClone(s), map)
    const off = unfrozen(() => stepRoomDay(structuredClone(s), map))
    expect(on.monthEnded).toBe(true)
    expect(liveFingerprint(on.state)).toBe(liveFingerprint(off.state))
  }, 600_000)

  it('a plan made ahead on a quiet tick gives the same month end, and a state that changed after it is planned afresh', () => {
    const { map } = getWorld()
    const s = startLive(createInitialState(map, { playerRegionId: 'france', seed: 9, victoryShare: 2 } as never))
    s.humans = ['france', 'germany']
    s.day = daysInMonth(s.turn) - 2
    // Not the last day yet: nothing to plan.
    expect(planAhead(s, map)).toBe(false)
    s.day++
    const fresh = stepRoomDay(structuredClone(s), map)
    expect(planAhead(s, map)).toBe(true)
    expect(planAhead(s, map)).toBe(false)
    expect(liveFingerprint(stepRoomDay(s, map).state)).toBe(liveFingerprint(fresh.state))
    // A plan for a state that then changed is never used for the changed one.
    const t = structuredClone(s)
    planAhead(t, map)
    const changed = { ...t, nations: { ...t.nations, germany: { ...t.nations.germany, resources: { ...t.nations.germany.resources, capital: 0 } } } }
    const plain = stepRoomDay(structuredClone(changed), map)
    expect(liveFingerprint(stepRoomDay(changed, map).state)).toBe(liveFingerprint(plain.state))
  }, 600_000)

  it('two screens that plan ahead on their own ticks stay in step through several month ends', async () => {
    const room = await liveRoom(2)
    const [host] = room.seats
    host.s.controlClock({ kind: 'speed', speed: 4 })
    host.s.controlClock({ kind: 'resume' })
    await room.run(3 * 31 * 500 + 1200)
    expect(gameOf(host).turn).toBeGreaterThanOrEqual(4)
    expect(same(room)).toBe(true)
    expect(room.seats[1].statuses.at(-1)?.resyncs ?? 0).toBe(0)
  })
})
