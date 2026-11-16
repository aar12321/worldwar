import { describe, expect, it } from 'vitest'
import { LIVE } from '../data/live'
import { ASLEEP_MS, MAX_DAYS_PER_TICK, VOTE_MS } from './session'
import { dayOf, gameOf, liveRoom, same } from './liveHarness'

const DAY = LIVE.msPerDay

describe('live rooms: who holds the clock', () => {
  it('host-only: a guest cannot pause or change the speed, and the host is told they asked', async () => {
    const room = await liveRoom(2, { liveControl: 'host' })
    const [host, guest] = room.seats
    host.s.controlClock({ kind: 'resume' })
    await room.run(2 * DAY)
    guest.s.controlClock({ kind: 'pause' })
    guest.s.controlClock({ kind: 'speed', speed: 4 })
    await room.run(2 * DAY)
    expect(host.s.clock.running).toBe(true)
    expect(host.s.clock.speed).toBe(1)
    expect(host.requests).toEqual(['Bo:pause', 'Bo:speed'])
    expect(dayOf(guest)).toBeGreaterThanOrEqual(4)
  })

  it('host-only: the host pauses everyone, and every screen says who did', async () => {
    const room = await liveRoom(2, { liveControl: 'host' })
    const [host, guest] = room.seats
    host.s.controlClock({ kind: 'resume' })
    await room.run(3 * DAY)
    host.s.controlClock({ kind: 'pause' })
    await room.run(100)
    const frozen = dayOf(guest)
    await room.run(5 * DAY)
    expect(dayOf(guest)).toBe(frozen)
    expect(dayOf(host)).toBe(frozen)
    expect(guest.s.clock).toMatchObject({ running: false, by: 'Hana' })
  })

  it('vote: one player cannot freeze the others, and the second vote does', async () => {
    const room = await liveRoom(2, { liveControl: 'vote' })
    const [host, guest] = room.seats
    guest.s.controlClock({ kind: 'resume' })
    await room.run(300)
    // Two players here: starting needs both.
    expect(host.s.clock.running).toBe(false)
    expect(guest.s.clock.vote).toMatchObject({ by: ['Bo'], need: 2 })
    host.s.controlClock({ kind: 'resume' })
    await room.run(300)
    expect(host.s.clock.running).toBe(true)
    expect(guest.s.clock.running).toBe(true)
    expect(guest.s.clock.vote ?? null).toBeNull()
    await room.run(3 * DAY)
    const before = dayOf(host)
    guest.s.controlClock({ kind: 'pause' })
    await room.run(2 * DAY)
    expect(dayOf(host)).toBeGreaterThan(before)
    expect(host.s.clock.running).toBe(true)
    host.s.controlClock({ kind: 'pause' })
    await room.run(300)
    expect(host.s.clock.running).toBe(false)
    expect(guest.s.clock.by).toBe('Bo and Hana')
  })

  it('vote: a proposal that does not get the votes lapses', async () => {
    const room = await liveRoom(2, { liveControl: 'vote' })
    const [host, guest] = room.seats
    guest.s.controlClock({ kind: 'resume' })
    await room.run(300)
    expect(host.s.clockView().vote).toBeTruthy()
    await room.run(VOTE_MS + 1000)
    expect(host.s.clockView().vote ?? null).toBeNull()
    expect(guest.s.clock.vote ?? null).toBeNull()
    expect(host.s.clock.running).toBe(false)
  })

  it('vote with three players: two of three decide, and a player who is away does not count', async () => {
    const room = await liveRoom(3, { liveControl: 'vote' })
    const [host, b, c] = room.seats
    host.s.controlClock({ kind: 'resume' })
    await room.run(300)
    expect(host.s.clock.running).toBe(false)
    expect(host.s.clockView().vote).toMatchObject({ need: 2 })
    b.s.controlClock({ kind: 'resume' })
    await room.run(300)
    expect(c.s.clock.running).toBe(true)
    // Cy goes away: two players are left, so both must agree, and Hana alone cannot pause.
    c.s.leave()
    await room.run(12_000, [host, b])
    host.s.controlClock({ kind: 'pause' })
    await room.run(300, [host, b])
    expect(host.s.clock.running).toBe(true)
    b.s.controlClock({ kind: 'pause' })
    await room.run(300, [host, b])
    expect(host.s.clock.running).toBe(false)
  })

  it('vote: a player alone in the room can run their own clock', async () => {
    const room = await liveRoom(2, { liveControl: 'vote' })
    const [host, guest] = room.seats
    guest.s.leave()
    await room.run(12_000, [host])
    host.s.controlClock({ kind: 'resume' })
    await room.run(2 * DAY + 400, [host])
    expect(host.s.clock.running).toBe(true)
    expect(dayOf(host)).toBe(2)
  })

  it('a request that changes nothing does nothing', async () => {
    const room = await liveRoom(2)
    const [host] = room.seats
    const n = room.hub.log.length
    host.s.controlClock({ kind: 'pause' })
    host.s.controlClock({ kind: 'speed', speed: 1 })
    await room.run(100)
    expect(room.hub.log.filter((m) => m.t === 'stream').length).toBe(room.hub.log.slice(0, n).filter((m) => m.t === 'stream').length)
  })

  it('the clock stops by itself when the game is over', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    host.s.controlClock({ kind: 'resume' })
    await room.run(2 * DAY)
    for (const x of room.seats) x.s.game!.outcome = 'victory'
    await room.run(2 * DAY)
    expect(host.s.clock.running).toBe(false)
    expect(host.s.clock.why).toBe('over')
    expect(guest.s.clock.why).toBe('over')
  })
})

describe('live rooms: a host whose timers are slow', () => {
  it('a tab that wakes late plays the days it missed, a few at a time, and loses none', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    host.s.controlClock({ kind: 'resume' })
    await room.run(DAY)
    const start = dayOf(host)
    // The tab is hidden: one timer fires only after 40 seconds (20 days of game time).
    host.s.setHidden(true)
    room.clock.t += 40_000
    host.s.tick()
    await room.run(0)
    expect(dayOf(host) - start).toBe(MAX_DAYS_PER_TICK)
    // The rest follows on the next ticks, without waiting for the clock to run again.
    for (let i = 0; i < 3; i++) {
      host.s.tick()
      await room.run(0)
    }
    expect(dayOf(host) - start).toBe(20)
    expect(dayOf(guest)).toBe(dayOf(host))
    expect(same(room)).toBe(true)
    // The game is a day short of 40 seconds' worth, never a day more.
    expect((room.clock.t - 1_000_000 - 100) / DAY).toBeGreaterThan(dayOf(host) - 1)
  })

  it('friends are told when the host tab is hidden, and when it is back', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    host.s.setHidden(true)
    await room.run(300)
    expect(guest.s.liveStatus().hostHidden).toBe(true)
    host.s.setHidden(false)
    await room.run(300)
    expect(guest.s.liveStatus().hostHidden).toBe(false)
  })

  it('a computer that slept for a long time stops the clock instead of racing', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    host.s.controlClock({ kind: 'resume' })
    await room.run(DAY)
    const at = dayOf(host)
    room.clock.t += ASLEEP_MS + 1000
    host.s.tick()
    await room.run(300)
    expect(dayOf(host)).toBe(at)
    expect(host.s.clock).toMatchObject({ running: false, why: 'asleep' })
    expect(guest.s.clock.why).toBe('asleep')
    // The host starts it again when everyone is back.
    host.s.controlClock({ kind: 'resume' })
    await room.run(2 * DAY)
    expect(dayOf(guest)).toBeGreaterThan(at)
  })

  it('the game keeps its own count: slow ticks at 4× still give 4 days per 2 seconds', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    host.s.controlClock({ kind: 'speed', speed: 4 })
    host.s.controlClock({ kind: 'resume' })
    // Ticks one second apart instead of 200 ms.
    for (let i = 0; i < 10; i++) {
      room.clock.t += 1000
      host.s.tick()
      guest.s.tick()
      await room.run(0)
    }
    expect(dayOf(host)).toBe(20)
    expect(dayOf(guest)).toBe(20)
    expect(gameOf(host).day).toBe(20)
  })
})
