import { describe, expect, it } from 'vitest'
import { LIVE } from '../data/live'
import { dayOf, gameOf, liveRoom, same } from './liveHarness'

const DAY = LIVE.msPerDay

describe('live rooms: start and clock', () => {
  it('starts a live game with the clock stopped, and everyone has the same game', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    expect(gameOf(host).settings.mode).toBe('live')
    expect(gameOf(guest).settings.mode).toBe('live')
    expect(gameOf(host).multiplayer).toBe(true)
    expect(host.s.clock.running).toBe(false)
    expect(guest.s.clock.running).toBe(false)
    expect(same(room)).toBe(true)
    await room.run(5 * DAY)
    expect(dayOf(host)).toBe(0)
  })

  it('the host runs the clock and every screen plays the same days', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    host.s.controlClock({ kind: 'resume' })
    await room.run(5 * DAY + 400)
    expect(dayOf(host)).toBe(5)
    expect(dayOf(guest)).toBe(5)
    expect(guest.days).toBe(5)
    expect(same(room)).toBe(true)
    expect(guest.s.clock.running).toBe(true)
  })

  it('a faster speed turns time into days faster', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    host.s.controlClock({ kind: 'speed', speed: 4 })
    host.s.controlClock({ kind: 'resume' })
    await room.run(5 * DAY)
    expect(dayOf(host)).toBe(20)
    expect(dayOf(guest)).toBe(20)
    expect(guest.s.clock.speed).toBe(4)
  })
})
