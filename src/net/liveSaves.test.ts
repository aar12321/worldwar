import { describe, expect, it } from 'vitest'
import { LIVE } from '../data/live'
import { dayOf, gameOf, liveRoom, liveSeat, same, settle } from './liveHarness'
import { liveFingerprint } from './fingerprint'
import { listOnlineSaves, loadOnlineSave, writeOnlineSave } from './saves'

const DAY = LIVE.msPerDay

describe('live rooms: saved games', () => {
  it('a live room is saved with its day, opened again by the host, and friends take their seats back', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    host.s.controlClock({ kind: 'speed', speed: 4 })
    host.s.controlClock({ kind: 'resume' })
    await room.run(5 * DAY)
    guest.s.sendCommand({ type: 'setPolicy', nationId: 'r1', taxRate: 0.27, draftRate: 0.02 })
    await room.run(400)
    const mem = new Map<string, string>()
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    expect(await writeOnlineSave(host.s.lobby!, gameOf(host), 1, store)).toBe(true)
    const info = listOnlineSaves(store)[0]
    expect(info).toMatchObject({ code: 'LIVE1', live: true, day: gameOf(host).day })
    const fp = liveFingerprint(gameOf(host))
    const day = dayOf(host)

    // Everyone closes their tabs. A new screen opens the saved room as Hana's seat.
    host.s.close()
    guest.s.close()
    const saved = (await loadOnlineSave('LIVE1', store))!
    const again = liveSeat(room.hub, room.map, 'host2', 'Hana', room.clock)
    expect(again.s.resumeRoom(saved.lobby, saved.game, 'r0')).toBeNull()
    expect(liveFingerprint(gameOf(again))).toBe(fp)
    expect(again.s.clock.running).toBe(false)
    const friend = liveSeat(room.hub, room.map, 'b2', 'Bo', room.clock)
    friend.s.joinRoom()
    await settle(50)
    friend.s.takeSeat('r1')
    await settle(150)
    await room.run(600, [again, friend])
    expect(same({ ...room, seats: [again, friend] }, [again, friend])).toBe(true)
    // The month's waiting order survived, and the clock carries on from the saved day.
    expect(gameOf(friend).liveOrders?.r1).toHaveLength(1)
    again.s.controlClock({ kind: 'resume' })
    await room.run(3 * DAY, [again, friend])
    expect(dayOf(again)).toBeGreaterThan(day)
    expect(dayOf(friend)).toBe(dayOf(again))
    expect(same({ ...room, seats: [again, friend] }, [again, friend])).toBe(true)
  })
})
