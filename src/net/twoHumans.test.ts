import { describe, expect, it } from 'vitest'
import { offerIsMoot } from '../engine/offers'
import { atWar } from '../engine/helpers'
import type { GameState, Order } from '../engine/types'
import { confirmFor } from '../ui/confirmRules'
import { warRefusal } from '../ui/warHint'
import { orderNews } from '../ui/livePresent'
import { speak } from '../ui/plain'
import { validateOrder } from '../engine/orders'
import { gameOf, liveRoom, patchAll, same, settle, type LiveRoom } from './liveHarness'

/**
 * Two people in one room, playing against each other: the flows a pair of friends reach in their first hour, in a live room and in
 * a turn room. r0 is the host's nation, r1 the guest's.
 */

/** Enough influence, money, research and steel for anything, on every screen alike (a dev patch that only changed one screen's copy would be refused by the host). */
const rich = (room: LiveRoom) =>
  patchAll(room, (g) => {
    for (const id of g.humans) {
      const r = g.nations[id].resources
      r.pp += 500
      r.capital += 5000
      r.tp += 500
      r.steel += 500
    }
  })

/** Turn room: each seat sends its plan and says it is ready; the host resolves the month and every screen gets it. */
async function month(room: LiveRoom, plans: Order[][]) {
  // A loaded machine may still be squeezing the first game to a screen.
  for (let i = 0; i < 40 && room.seats.some((x) => !x.s.game); i++) await room.run(200)
  const turn = gameOf(room.seats[0]).turn
  room.seats.forEach((x, i) => x.s.submitOrders(turn, plans[i] ?? [], true))
  for (let i = 0; i < 40 && room.seats.some((x) => gameOf(x)?.turn === turn); i++) await room.run(200)
  await settle(50)
  for (const x of room.seats) expect(gameOf(x).turn).toBe(turn + 1)
}

const war = (from: string, to: string): Order => ({ type: 'declareWar', nationId: from, target: to })
const peace = (from: string, to: string, extra: object): Order => ({ type: 'propose', nationId: from, target: to, proposal: { kind: 'peace', terms: { cede: [], reparations: 0, ...extra } } }) as Order
const ackOf = (room: LiveRoom, seat: number) => room.seats[seat].acks.at(-1)

describe('two humans, live room', () => {
  it('war between the two players: at the start it is refused for influence (30 of 60) with the same words on both sides, and goes through once it is affordable', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, (g) => {
      g.nations.r0.resources.pp = 30
      g.nations.r1.resources.pp = 30
    })
    // The guest's screen says why at once; the host says the same to an order that skipped the screen's check.
    expect(guest.s.sendCommand(war('r1', 'r0')).error).toBe('Not enough influence (costs 60)')
    guest.s.transport.send({ t: 'cmd', from: 'b', cid: 77, order: war('r1', 'r0') })
    await room.run(400)
    expect(room.hub.log.filter((m) => m.t === 'ack').at(-1)).toMatchObject({ to: 'b', cid: 77, ok: false, reason: 'Not enough influence (costs 60)' })
    // A patch on one screen only (what an earlier browser script did) does not reach the room's game: the host still refuses.
    gameOf(guest).nations.r1.resources.pp = 400
    guest.s.sendCommand(war('r1', 'r0'))
    await room.run(400)
    expect(ackOf(room, 1)).toMatchObject({ ok: false, reason: 'Not enough influence (costs 60)' })
    patchAll(room, (g) => {
      g.nations.r1.resources.pp = 400
    })
    expect(guest.s.sendCommand(war('r1', 'r0')).error).toBeNull()
    await room.run(400)
    expect(ackOf(room, 1)).toMatchObject({ ok: true })
    for (const x of [host, guest]) expect(atWar(gameOf(x), 'r0', 'r1')).toBe(true)
    expect(host.orders.at(-1)).toMatchObject({ by: 'b', nation: 'r1' })
    // The Declare war button, before money was patched in, says what to do instead of only the shortfall.
    const fresh = structuredClone(gameOf(host))
    fresh.wars = []
    fresh.nations.r0.resources.pp = 30
    const why = warRefusal(fresh, 'r0', 'r1', speak(validateOrder(fresh, room.map, war('r0', 'r1'))!))
    expect(why).toMatch(/you have 30\. Build a case first \(20 influence, ready in 3 months\): then war costs only 10/)
    expect(same(room)).toBe(true)
  })

  it('a war clears the pact offer it makes impossible, on both screens', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    rich(room)
    expect(guest.s.sendCommand({ type: 'propose', nationId: 'r1', target: 'r0', proposal: { kind: 'pact' } }).error).toBeNull()
    await room.run(400)
    const offer = gameOf(host).proposals.find((p) => p.from === 'r1' && p.to === 'r0' && p.kind === 'pact')!
    expect(offer).toBeTruthy()
    expect(offerIsMoot(gameOf(host), room.map, offer)).toBe(false)
    expect(host.s.sendCommand(war('r0', 'r1')).error).toBeNull()
    await room.run(400)
    for (const x of [host, guest]) expect(gameOf(x).proposals.some((p) => p.id === offer.id)).toBe(false)
    expect(same(room)).toBe(true)
  })

  it('an offer between the players that became moot (both offered a pact, one was accepted) folds, and Clear removes it on both screens', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    rich(room)
    guest.s.sendCommand({ type: 'propose', nationId: 'r1', target: 'r0', proposal: { kind: 'pact' } })
    host.s.sendCommand({ type: 'propose', nationId: 'r0', target: 'r1', proposal: { kind: 'pact' } })
    await room.run(600)
    const mine = gameOf(guest).proposals.find((p) => p.from === 'r0' && p.to === 'r1')!
    const theirs = gameOf(host).proposals.find((p) => p.from === 'r1' && p.to === 'r0')!
    expect(guest.s.sendCommand({ type: 'respond', nationId: 'r1', proposalId: mine.id, accept: true }).error).toBeNull()
    await room.run(400)
    expect(gameOf(host).proposals.some((p) => p.id === theirs.id)).toBe(true)
    expect(offerIsMoot(gameOf(host), room.map, theirs)).toBe(true)
    const guestBefore = structuredClone(gameOf(guest))
    const seen = guest.orders.length
    expect(host.s.sendCommand({ type: 'respond', nationId: 'r0', proposalId: theirs.id, accept: false }).error).toBeNull()
    await room.run(400)
    for (const x of [host, guest]) expect(gameOf(x).proposals.some((p) => p.id === theirs.id)).toBe(false)
    // The friend whose offer was cleared hears it was tidied away, not that it was rejected.
    const e = guest.orders.slice(seen).find((o) => o.order.type === 'respond')!
    const news = orderNews({ ...guestBefore, playerId: 'r1' }, e.state, e.own, e.order, room.map)
    expect(news.map((n) => n.text)).toEqual(["Region 0 cleared Region 1's non-aggression pact offer: it was no longer possible (pact already in force)."])
    expect(same(room)).toBe(true)
  })

  it('a peace that makes the loser a puppet: the winner proposes, the friend accepts, both screens agree; a territory of a player is refused with a reason', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    rich(room)
    host.s.sendCommand(war('r0', 'r1'))
    await room.run(400)
    patchAll(room, (g) => {
      g.warScore['r0>r1'] = 100
    })
    expect(host.s.sendCommand(peace('r0', 'r1', { territory: true })).error).toMatch(/run by a player/)
    expect(host.s.sendCommand(peace('r0', 'r1', { puppet: true })).error).toBeNull()
    await room.run(400)
    const offer = gameOf(guest).proposals.find((p) => p.from === 'r0' && p.kind === 'peace')!
    expect(offer).toBeTruthy()
    expect(guest.s.sendCommand({ type: 'respond', nationId: 'r1', proposalId: offer.id, accept: true }).error).toBeNull()
    await room.run(600)
    for (const x of [host, guest]) {
      expect(atWar(gameOf(x), 'r0', 'r1')).toBe(false)
      expect(gameOf(x).nations.r1.overlord).toBe('r0')
    }
    // A puppet run by a player keeps its own government: the master cannot set its taxes.
    expect(host.s.sendCommand({ type: 'governPuppet', nationId: 'r0', target: 'r1', patch: { taxRate: 0.4 } } as Order).error).toBeTruthy()
    expect(same(room)).toBe(true)
  })

  it('an aircraft development started by the guest runs on both screens', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    rich(room)
    patchAll(room, (g) => {
      g.nations.r1.techs.push('air_propeller')
    })
    expect(guest.s.sendCommand({ type: 'startAircraftDev', nationId: 'r1', node: 'radar' }).error).toBeNull()
    await room.run(400)
    expect(ackOf(room, 1)).toMatchObject({ ok: true })
    for (const x of [host, guest]) expect(gameOf(x).nations.r1.aircraft?.radar).toBeTruthy()
    expect(same(room)).toBe(true)
  })

  it('a nuke from one player on the other: the confirmation names the victim, and the warhead flies the same on both screens', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    rich(room)
    host.s.sendCommand(war('r0', 'r1'))
    await room.run(400)
    superpower(room, 'r0')
    const order: Order = { type: 'nuke', nationId: 'r0', target: 'r1' }
    const ask = confirmFor(gameOf(host), room.map, order)!
    expect(ask.title).toMatch(/Region 1/)
    expect(ask.danger).toBe(true)
    expect(host.s.sendCommand(order).error).toBeNull()
    await room.run(400)
    expect(ackOf(room, 0)).toMatchObject({ ok: true })
    for (const x of [host, guest]) expect((gameOf(x).nukes ?? []).some((f) => f.nationId === 'r0')).toBe(true)
    expect(gameOf(guest).nations.r0.nuclear?.warheads).toBe(0)
    host.s.controlClock({ kind: 'speed', speed: 4 })
    host.s.controlClock({ kind: 'resume' })
    await room.run(8 * 500)
    expect((gameOf(host).nukes ?? []).length).toBe(0)
    expect(same(room)).toBe(true)
  })
})

/** A Superpower with Hypersonic Missiles and one warhead, on every screen. */
function superpower(room: LiveRoom, id: string) {
  patchAll(room, (g: GameState) => {
    const n = g.nations[id]
    n.tier = 4
    if (!n.techs.includes('frontier_hypersonic')) n.techs.push('frontier_hypersonic')
    n.nuclear = { ...(n.nuclear ?? { building: [] }), warheads: 1, building: n.nuclear?.building ?? [] } as typeof n.nuclear
    for (const r of Object.values(g.regions)) if (r.owner === id) r.buildings.factory = Math.max(1, r.buildings.factory)
  })
}

describe('two humans, turn room', () => {
  it('war between the players goes through at the month end when affordable, and is dropped with a note when not', async () => {
    const room = await liveRoom(2, { mode: 'turns' })
    patchAll(room, (g) => {
      g.nations.r0.resources.pp = 30
      g.nations.r1.resources.pp = 30
    })
    await month(room, [[], [war('r1', 'r0')]])
    expect(atWar(gameOf(room.seats[0]), 'r0', 'r1')).toBe(false)
    rich(room)
    await month(room, [[], [war('r1', 'r0')]])
    for (const x of room.seats) expect(atWar(gameOf(x), 'r0', 'r1')).toBe(true)
    expect(same(room)).toBe(true)
  })

  it('a pact offer that a war made moot folds, and Clear removes it at the month end', async () => {
    const room = await liveRoom(2, { mode: 'turns' })
    rich(room)
    await month(room, [[], [{ type: 'propose', nationId: 'r1', target: 'r0', proposal: { kind: 'pact' } }]])
    const offer = gameOf(room.seats[0]).proposals.find((p) => p.from === 'r1' && p.kind === 'pact')!
    expect(offer).toBeTruthy()
    rich(room)
    await month(room, [[war('r0', 'r1')], []])
    const still = gameOf(room.seats[0]).proposals.find((p) => p.id === offer.id)
    if (still) {
      expect(offerIsMoot(gameOf(room.seats[0]), room.map, still)).toBe(true)
      await month(room, [[{ type: 'respond', nationId: 'r0', proposalId: offer.id, accept: false }], []])
    }
    for (const x of room.seats) expect(gameOf(x).proposals.some((p) => p.id === offer.id)).toBe(false)
    expect(same(room)).toBe(true)
  })

  it('a peace that makes the loser a puppet, proposed one month and accepted the next', async () => {
    const room = await liveRoom(2, { mode: 'turns' })
    rich(room)
    await month(room, [[war('r0', 'r1')], []])
    patchAll(room, (g) => {
      g.warScore['r0>r1'] = 100
    })
    await month(room, [[peace('r0', 'r1', { puppet: true })], []])
    const offer = gameOf(room.seats[1]).proposals.find((p) => p.from === 'r0' && p.kind === 'peace')!
    expect(offer).toBeTruthy()
    await month(room, [[], [{ type: 'respond', nationId: 'r1', proposalId: offer.id, accept: true }]])
    for (const x of room.seats) expect(gameOf(x).nations.r1.overlord).toBe('r0')
    expect(same(room)).toBe(true)
  })

  it('an aircraft development and a nuke between the players resolve the same on both screens', async () => {
    const room = await liveRoom(2, { mode: 'turns' })
    rich(room)
    patchAll(room, (g) => {
      g.nations.r1.techs.push('air_propeller')
    })
    await month(room, [[war('r0', 'r1')], [{ type: 'startAircraftDev', nationId: 'r1', node: 'radar' }]])
    for (const x of room.seats) expect(gameOf(x).nations.r1.aircraft?.radar).toBeTruthy()
    superpower(room, 'r0')
    const before = gameOf(room.seats[1]).regions.r1.population
    await month(room, [[{ type: 'nuke', nationId: 'r0', target: 'r1' }], []])
    for (const x of room.seats) expect(gameOf(x).regions.r1.population).toBeLessThan(before)
    expect(same(room)).toBe(true)
  })
})
