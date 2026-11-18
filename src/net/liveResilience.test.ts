import { describe, expect, it } from 'vitest'
import { LIVE } from '../data/live'
import { clockOf } from '../engine/calendar'
import type { Order } from '../engine/types'
import { GAP_MS, HOST_GIVE_UP_MS, HOST_TIMEOUT_MS } from './session'
import { dayOf, gameOf, liveRoom, patchAll, same, settle } from './liveHarness'

const DAY = LIVE.msPerDay
const start = (room: Awaited<ReturnType<typeof liveRoom>>, speed: 1 | 2 | 4 = 4) => {
  room.seats[0].s.controlClock({ kind: 'speed', speed })
  room.seats[0].s.controlClock({ kind: 'resume' })
}

describe('live rooms: staying in step', () => {
  it('a screen whose game drifted finds out at the next check, fetches the game, and is back in step', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    start(room)
    await room.run(DAY)
    // A bug on one screen: it has a little more money than the host's game says.
    gameOf(guest).nations.r5.resources.capital += 1
    expect(same(room)).toBe(false)
    await room.run(6 * DAY)
    expect(guest.s.resyncs).toBeGreaterThanOrEqual(1)
    await room.run(2 * DAY)
    expect(same(room)).toBe(true)
    expect(guest.s.liveStatus().inSync).toBe(true)
    expect(host.s.resyncs).toBe(0)
  })

  it('a message that never arrives is noticed, and the game is fetched again', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    start(room)
    await room.run(DAY)
    room.hub.dropFrom.add('host')
    await room.run(1000)
    room.hub.dropFrom.delete('host')
    await room.run(GAP_MS + 3000)
    expect(guest.s.resyncs).toBeGreaterThanOrEqual(1)
    await settle(150)
    await room.run(2 * DAY)
    expect(same(room)).toBe(true)
    expect(dayOf(guest)).toBe(dayOf(host))
  })

  it('a screen that lost its line and got it back catches up to the same day', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    start(room)
    await room.run(DAY)
    room.hub.setOnline('b', false)
    await room.run(6000)
    expect(dayOf(guest)).toBeLessThan(dayOf(host))
    room.hub.setOnline('b', true)
    await room.run(1000)
    await settle(150)
    await room.run(DAY)
    expect(same(room)).toBe(true)
    expect(guest.s.liveStatus().inSync).toBe(true)
  })

  it('the orders a screen sent while its line was down are not lost', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    room.hub.setOnline('b', false)
    const sent = guest.s.sendCommand({ type: 'build', nationId: 'r1', regionId: 'r1', building: 'farm' })
    expect(sent.error).toBeNull()
    await room.run(1000)
    expect(host.orders).toHaveLength(0)
    room.hub.setOnline('b', true)
    await room.run(6000)
    await settle(150)
    await room.run(DAY)
    expect(host.orders).toHaveLength(1)
    expect(guest.acks.at(-1)?.ok).toBe(true)
    expect(same(room)).toBe(true)
  })

  it('a message from a host that was replaced is ignored', async () => {
    const room = await liveRoom(3)
    const [host, b, c] = room.seats
    start(room, 1)
    await room.run(2 * DAY)
    const hostGame = JSON.stringify(gameOf(c))
    // An old stream message with a lower term and nonsense in it.
    c.s.transport.send({ t: 'stream', from: 'host', term: 0, seq: 1, items: [{ k: 'day', n: 5 }] })
    await room.run(100)
    expect(b.s.game).toBeTruthy()
    expect(JSON.stringify(gameOf(c))).toBe(hostGame)
    expect(host.s.resyncs).toBe(0)
  })
})

describe('live rooms: the host goes away', () => {
  it('a friend takes over in the middle of the game and the clock goes on from where it was', async () => {
    const room = await liveRoom(3)
    const [host, b, c] = room.seats
    start(room)
    await room.run(3 * DAY)
    const last = dayOf(host)
    expect(last).toBeGreaterThan(8)
    host.s.leave()
    await room.run(16_000, [b, c])
    await settle(200)
    expect(b.s.isHost).toBe(true)
    expect(c.s.isHost).toBe(false)
    // At most the day or two in flight was lost, and the clock still runs at the same speed.
    expect(dayOf(b)).toBeGreaterThanOrEqual(last - 2)
    expect(b.s.clock).toMatchObject({ running: true, speed: 4 })
    const at = dayOf(b)
    await room.run(2 * DAY, [b, c])
    expect(dayOf(b)).toBeGreaterThan(at + 4)
    expect(same(room, [b, c])).toBe(true)
    expect(c.s.liveStatus().inSync).toBe(true)
  })

  it('orders sent to the host that left are sent again to the new one, and done once', async () => {
    const room = await liveRoom(3)
    const [host, b, c] = room.seats
    start(room, 1)
    await room.run(2 * DAY)
    host.s.leave()
    const sent = c.s.sendCommand({ type: 'build', nationId: 'r2', regionId: 'r2', building: 'farm' })
    expect(sent.error).toBeNull()
    await room.run(20_000, [b, c])
    await settle(200)
    await room.run(2 * DAY, [b, c])
    expect(c.acks.at(-1)?.ok).toBe(true)
    expect(b.orders.filter((o) => o.by === 'c')).toHaveLength(1)
    expect(c.s.liveStatus().pending).toBe(0)
    expect(same(room, [b, c])).toBe(true)
  })

  it('a friend whose line dies without the relay noticing does not crown itself, and comes back to the game as it went on', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    start(room)
    await room.run(2 * DAY)
    // Cut off both ways while its own line still says "connected", as a phone that lost its signal looks to the relay for a while.
    room.hub.dropFrom.add('b')
    room.hub.deaf.add('b')
    await room.run(30_000)
    expect(guest.s.isHost).toBe(false)
    expect(host.s.isHost).toBe(true)
    const played = dayOf(host)
    expect(played).toBeGreaterThan(dayOf(guest) + 20)
    room.hub.dropFrom.delete('b')
    room.hub.deaf.delete('b')
    await room.run(6000)
    await settle(200)
    await room.run(DAY)
    // Nothing the host played while the friend was gone is undone.
    expect(host.s.isHost).toBe(true)
    expect(guest.s.isHost).toBe(false)
    expect(dayOf(host)).toBeGreaterThanOrEqual(played)
    expect(same(room)).toBe(true)
    expect(guest.s.liveStatus().inSync).toBe(true)
  })

  it('in a room of two, a host that vanished without a word is replaced once its silence has gone on long enough', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    start(room)
    await room.run(2 * DAY)
    room.hub.dropFrom.add('host')
    room.hub.deaf.add('host')
    await room.run(HOST_TIMEOUT_MS + 3000, [guest])
    expect(guest.s.isHost).toBe(false)
    await room.run(HOST_GIVE_UP_MS - HOST_TIMEOUT_MS, [guest])
    expect(guest.s.isHost).toBe(true)
    expect(guest.s.clock.running).toBe(true)
    const at = dayOf(guest)
    await room.run(2 * DAY, [guest])
    expect(dayOf(guest)).toBeGreaterThan(at)
    expect(host.s.isHost).toBe(true)
  })

  it('the host that left comes back as an ordinary player and follows the new host', async () => {
    const room = await liveRoom(3)
    const [host, b, c] = room.seats
    start(room)
    await room.run(2 * DAY)
    room.hub.setOnline('host', false)
    await room.run(16_000, [b, c])
    expect(b.s.isHost).toBe(true)
    room.hub.setOnline('host', true)
    await room.run(6000)
    await settle(200)
    await room.run(2 * DAY)
    expect(host.s.isHost).toBe(false)
    expect(same(room)).toBe(true)
    expect(host.s.liveStatus().inSync).toBe(true)
  })
})

describe('live rooms: players come and go', () => {
  it('a player who leaves is played by the AI, and a newcomer takes the seat in the middle of the game', async () => {
    const room = await liveRoom(3)
    const [host, , c] = room.seats
    start(room)
    await room.run(2 * DAY)
    c.s.leave()
    await room.run(12_000, [host, room.seats[1]])
    expect(gameOf(host).liveAi).toEqual(['r2'])
    const d = room.add('d', 'Di')
    d.s.joinRoom()
    await room.run(600)
    d.s.takeSeat('r2')
    await room.run(1500)
    await settle(150)
    await room.run(2 * DAY)
    expect(gameOf(d).liveAi ?? []).toEqual([])
    expect(gameOf(host).liveAi ?? []).toEqual([])
    expect(d.s.me).toBe('r2')
    expect(same(room, [host, room.seats[1], d])).toBe(true)
    expect(dayOf(d)).toBe(dayOf(host))
    // And their orders count.
    expect(d.s.sendCommand({ type: 'build', nationId: 'r2', regionId: 'r2', building: 'farm' }).error).toBeNull()
    await room.run(600)
    expect(host.orders.at(-1)?.by).toBe('d')
  })

  it('the host removes a player: their nation is the AI, and the game goes on for the others', async () => {
    const room = await liveRoom(3)
    const [host, b, c] = room.seats
    start(room)
    await room.run(DAY)
    host.s.kick('b')
    await room.run(600)
    expect(b.kicked).toBe(1)
    expect(gameOf(host).liveAi).toEqual(['r1'])
    expect(gameOf(c).liveAi).toEqual(['r1'])
    await room.run(40 * 500, [host, c])
    expect(gameOf(host).turn).toBe(2)
    expect(same(room, [host, c])).toBe(true)
  })

  it('a rematch brings everyone back to the lobby, and a new live game starts with the clock stopped', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    start(room)
    await room.run(2 * DAY)
    host.s.rematch()
    await room.run(600)
    expect(host.s.lobby!.phase).toBe('lobby')
    expect(guest.s.lobby!.phase).toBe('lobby')
    expect(guest.rematches).toBe(1)
    expect(host.s.lobby!.settings.mode).toBe('live')
    expect(guest.s.game).toBeNull()
    guest.s.pickNation('r3')
    host.s.pickNation('r2')
    await room.run(600)
    expect(await host.s.startGame()).toBeNull()
    await settle(150)
    expect(host.s.clock.running).toBe(false)
    expect(guest.s.clock.running).toBe(false)
    expect(clockOf(gameOf(guest))).toBe(0)
    expect(guest.s.me).toBe('r3')
    start(room)
    await room.run(2 * DAY)
    expect(same(room)).toBe(true)
    expect(dayOf(guest)).toBeGreaterThan(3)
  })
})

describe('live rooms: decisions and wars', () => {
  it('a decision waiting for one player never holds the clock, and is made for them at the month end if they do not answer', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, (g) => {
      g.nextEventTurn = 2
    })
    start(room)
    await room.run(31 * 500 + 1500)
    expect(gameOf(host).turn).toBe(2)
    const waiting = Object.keys(gameOf(host).pendingEvents ?? {})
    expect(waiting.length).toBeGreaterThan(0)
    expect(Object.keys(gameOf(guest).pendingEvents ?? {})).toEqual(waiting)
    // Days go on while the decisions wait.
    const at = dayOf(host)
    await room.run(5 * DAY)
    expect(dayOf(host)).toBeGreaterThan(at + 8)
    expect(Object.keys(gameOf(host).pendingEvents ?? {})).toEqual(waiting)
    // One player answers: that nation's decision is done, the other's still waits.
    const mine = waiting.includes('r1') ? 'r1' : waiting[0]
    const who = mine === 'r1' ? guest : host
    expect(who.s.sendCommand({ type: 'eventChoice', nationId: mine, index: 0 }).error).toBeNull()
    await room.run(600)
    expect(same(room)).toBe(true)
    // At the month's end the unanswered ones are settled, and nobody waited for them.
    await room.run(31 * 500)
    expect(gameOf(host).turn).toBe(3)
    expect(same(room)).toBe(true)
  })

  it('two players declare war on each other at the same moment: one declaration stands, both screens agree', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, (g) => {
      g.nations.r0.resources.pp = 500
      g.nations.r1.resources.pp = 500
    })
    const a: Order = { type: 'declareWar', nationId: 'r0', target: 'r1' }
    const b: Order = { type: 'declareWar', nationId: 'r1', target: 'r0' }
    host.s.sendCommand(a)
    guest.s.sendCommand(b)
    await room.run(600)
    const results = [...host.acks, ...guest.acks]
    expect(results).toHaveLength(2)
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)?.reason).toBeTruthy()
    expect(gameOf(host).wars.length).toBe(1)
    expect(same(room)).toBe(true)
  })

  it('two players attack the same country: both armies march, and the host settles the battles the same way for everyone', async () => {
    const room = await liveRoom(3)
    const [host, , c] = room.seats
    patchAll(room, (g) => {
      for (const id of ['r0', 'r2']) {
        g.nations[id].resources.pp = 500
        g.nations[id].military.units.infantry = 12
      }
    })
    host.s.sendCommand({ type: 'declareWar', nationId: 'r0', target: 'r1' })
    c.s.sendCommand({ type: 'declareWar', nationId: 'r2', target: 'r1' })
    await room.run(600)
    expect(host.acks.at(-1)?.ok).toBe(true)
    expect(c.acks.at(-1)?.ok).toBe(true)
    host.s.sendCommand({ type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault' })
    c.s.sendCommand({ type: 'attack', nationId: 'r2', target: 'r1', commit: 'main', stance: 'assault' })
    await room.run(600)
    expect(host.acks.at(-1)).toMatchObject({ ok: true })
    expect(c.acks.at(-1)).toMatchObject({ ok: true })
    expect(gameOf(host).armies).toHaveLength(2)
    expect(gameOf(c).armies).toHaveLength(2)
    start(room)
    await room.run(12 * DAY)
    // Both armies have been and fought; every screen has the same battles and the same owner of the country.
    expect(same(room)).toBe(true)
    expect(gameOf(host).log.filter((e) => e.kind === 'battle').length).toBeGreaterThan(0)
    expect(gameOf(host).armies).toHaveLength(0)
    const owner = gameOf(host).regions.r1.owner
    for (const x of room.seats) expect(gameOf(x).regions.r1.owner).toBe(owner)
    expect(room.seats.every((x) => x.days === room.seats[0].days)).toBe(true)
  })
})
