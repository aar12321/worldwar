import { describe, expect, it } from 'vitest'
import type { Order } from '../engine/types'
import { daysInMonth } from '../engine/calendar'
import { humanOrder } from './liveRoom'
import { monthOrdersOf, stepRoomDay } from './liveRoom'
import { liveFingerprint } from './fingerprint'
import { gameOf, liveRoom, patchAll, same } from './liveHarness'
import { attackPool } from '../engine/deploy'
import { choiceOrder, choiceUnits } from '../ui/attackChoices'

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
    const train: Order = { type: 'train', nationId: 'r1', unit: 'infantry' }
    const sent = guest.s.sendCommand(train)
    guest.s.transport.send({ t: 'cmd', from: 'b', cid: sent.cid, order: train })
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

  it('the month-end orders of all players run in the seeded order, not the order they came in', async () => {
    const room = await liveRoom(3)
    const g = structuredClone(gameOf(room.seats[0]))
    const order = (n: string): Order => ({ type: 'setPolicy', nationId: n, taxRate: 0.2, draftRate: 0.02 })
    g.liveOrders = { r2: [order('r2')], r0: [order('r0')], r1: [order('r1')] }
    const seen = new Set<string>()
    for (let turn = 1; turn < 30; turn++) {
      g.turn = turn
      const ids = monthOrdersOf(g).map((o) => o.nationId)
      expect(ids).toEqual(humanOrder(g.seed, turn, ['r0', 'r1', 'r2']))
      seen.add(ids.join())
    }
    expect(seen.size).toBeGreaterThan(2)
  })

  it('a nation whose player is away is played by the AI at the month end, and one whose player is here is not', async () => {
    const room = await liveRoom(2)
    const g = structuredClone(gameOf(room.seats[0]))
    g.day = daysInMonth(g.turn) - 1
    const away = { ...structuredClone(g), liveAi: ['r1'] }
    const here = structuredClone(g)
    const a = stepRoomDay(away, room.map).state
    const b = stepRoomDay(here, room.map).state
    expect(a.turn).toBe(2)
    expect(liveFingerprint(a)).not.toBe(liveFingerprint(b))
    // The AI did something with r1's money that an idle player did not.
    expect(JSON.stringify(a.nations.r1)).not.toBe(JSON.stringify(b.nations.r1))
  })

  it('a War Room attack from a guest reaches the host with its named units and no missiles; an older order with missiles still works', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, (g) => {
      g.nations.r1.resources.pp = 500
      g.nations.r1.military.units.infantry = 14
      g.nations.r1.military.units.armor = 4
      g.nations.r1.military.units.missile = 6
    })
    expect(guest.s.sendCommand({ type: 'declareWar', nationId: 'r1', target: 'r2' }).error).toBeNull()
    await room.run(600)
    const pool = attackPool(gameOf(guest), 'r1', [], true)
    const units = choiceUnits(pool, 'main', false)
    const order = choiceOrder('r1', 'r2', 'assault', units)
    expect(guest.s.sendCommand(order).error).toBeNull()
    await room.run(600)
    expect(guest.acks.at(-1)).toMatchObject({ ok: true })
    const army = (gameOf(host).armies ?? []).find((a) => a.nationId === 'r1')!
    expect(army.units.missile).toBe(0)
    expect(army.units.infantry).toBeCloseTo(units.infantry, 6)
    expect(army.units.armor).toBeCloseTo(units.armor, 6)
    expect(gameOf(host).nations.r1.military.units.missile).toBe(6)
    expect(same(room)).toBe(true)
    // An older screen or a save may still name missiles: the host accepts it and fires exactly those.
    expect(guest.s.sendCommand({ type: 'attack', nationId: 'r1', target: 'r2', commit: 'probe', stance: 'assault', missiles: 2 }).error).toBeNull()
    await room.run(600)
    expect(guest.acks.at(-1)).toMatchObject({ ok: true })
    expect((gameOf(host).armies ?? []).filter((a) => a.nationId === 'r1').map((a) => a.units.missile)).toEqual([0, 2])
    expect(gameOf(host).nations.r1.military.units.missile).toBe(4)
    expect(same(room)).toBe(true)
  })
})
