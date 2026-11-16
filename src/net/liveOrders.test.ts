import { describe, expect, it } from 'vitest'
import type { Order } from '../engine/types'
import { gameOf, liveRoom, same } from './liveHarness'

const build = (nation: string, region = nation): Order => ({ type: 'build', nationId: nation, regionId: region, building: 'farm' })

describe('live rooms: orders', () => {
  it('an order from a guest is answered, applied by the host, and reaches both screens', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    const before = gameOf(guest).nations.r1.resources.capital
    const sent = guest.s.sendCommand(build('r1'))
    expect(sent.error).toBeNull()
    expect(guest.s.liveStatus().pending).toBe(1)
    await room.run(400)
    expect(guest.acks).toEqual([{ cid: sent.cid, ok: true, reason: undefined }])
    expect(guest.s.liveStatus().pending).toBe(0)
    expect(gameOf(host).nations.r1.resources.capital).toBeLessThan(before)
    expect(gameOf(guest).nations.r1.resources.capital).toBe(gameOf(host).nations.r1.resources.capital)
    expect(host.orders.map((o) => o.by)).toEqual(['b'])
    expect(guest.orders.map((o) => o.own)).toEqual([true])
    expect(same(room)).toBe(true)
  })

  it('an order that cannot be done is refused with words, and a forged one changes nothing anywhere', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    const copy = JSON.stringify(gameOf(host))
    const sent = guest.s.sendCommand({ type: 'attack', nationId: 'r1', target: 'r0', commit: 'main', stance: 'assault' })
    expect(sent.error).toBeTruthy()
    expect(guest.s.liveStatus().pending).toBe(0)
    // An order for somebody else's nation never gets past the host, whatever the screen did.
    guest.s.transport.send({ t: 'cmd', from: 'b', cid: 99, order: build('r0') })
    await room.run(400)
    expect(room.hub.log.filter((m) => m.t === 'ack').at(-1)).toMatchObject({ to: 'b', cid: 99, ok: false, reason: expect.stringMatching(/another nation/) })
    expect(JSON.stringify(gameOf(host))).toBe(copy)
    expect(host.orders).toHaveLength(0)
    // A sender who is not in the game at all gets nowhere either.
    guest.s.transport.send({ t: 'cmd', from: 'stranger', cid: 1, order: build('r1') })
    await room.run(400)
    expect(JSON.stringify(gameOf(host))).toBe(copy)
  })

  it('an order is done once when it is sent twice', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    const sent = guest.s.sendCommand(build('r1'))
    guest.s.transport.send({ t: 'cmd', from: 'b', cid: sent.cid, order: build('r1') })
    await room.run(400)
    expect(host.orders).toHaveLength(1)
    expect(same(room)).toBe(true)
  })

  it('the host gives its own orders the same way, and both screens agree', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    expect(host.s.sendCommand(build('r0')).error).toBeNull()
    await room.run(400)
    expect(host.acks[0].ok).toBe(true)
    expect(guest.orders.map((o) => o.by)).toEqual(['host'])
    expect(same(room)).toBe(true)
  })

  it('orders for the 1st wait in the game, are shared, and are carried out when the month turns', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    const policy: Order = { type: 'setPolicy', nationId: 'r1', taxRate: 0.3, draftRate: 0.02 }
    expect(guest.s.sendCommand(policy).error).toBeNull()
    await room.run(400)
    expect(gameOf(host).liveOrders?.r1).toHaveLength(1)
    expect(gameOf(guest).liveOrders?.r1).toHaveLength(1)
    // A later policy replaces the earlier one.
    guest.s.sendCommand({ ...policy, taxRate: 0.25 } as Order)
    await room.run(400)
    expect(gameOf(host).liveOrders?.r1).toHaveLength(1)
    host.s.controlClock({ kind: 'speed', speed: 4 })
    host.s.controlClock({ kind: 'resume' })
    await room.run(31 * 500 + 600)
    expect(gameOf(host).turn).toBe(2)
    expect(gameOf(guest).turn).toBe(2)
    expect(gameOf(host).liveOrders).toEqual({})
    expect(gameOf(host).nations.r1.taxRate).toBeCloseTo(0.25)
    expect(same(room)).toBe(true)
  })
})
