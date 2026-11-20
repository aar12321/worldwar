import { afterEach, describe, expect, it } from 'vitest'
import { DEALINGS } from '../data/relations'
import { validateOrder } from '../engine/orders'
import { trucePair } from '../engine/missileWar'
import type { GameState } from '../engine/types'
import { gameOf, liveRoom, patchAll, same, settle } from './liveHarness'
import { OnlineSession } from './session'
import { MemoryHub } from './transport'
import { lineMap } from '../engine/__tests__/fixtures'

/** Two players at war, with influence to spare. */
const atWar = (g: GameState) => {
  if (!g.wars.includes('r0|r1')) g.wars.push('r0|r1')
  g.warStarted['r0|r1'] = g.turn
  for (const n of Object.values(g.nations)) n.resources.pp = 200
}

afterEach(() => {
  DEALINGS.on = true
})

describe('a missile ceasefire between two players goes through the normal offer path', () => {
  it('live: one offers, the other sees it in their inbox and accepts; both screens agree the ceasefire holds', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, atWar)
    // The offer is no longer refused as "only AI rivals answer".
    expect(validateOrder(gameOf(guest), room.map, { type: 'missileTruce', nationId: 'r1', target: 'r0' })).toBeNull()
    guest.s.sendCommand({ type: 'missileTruce', nationId: 'r1', target: 'r0' })
    await room.run(600)
    const offer = gameOf(host).proposals.find((p) => p.kind === 'truce' && p.from === 'r1' && p.to === 'r0')
    expect(offer).toBeTruthy()
    expect(trucePair(gameOf(host), 'r0', 'r1')).toBeNull()
    // Offering twice is refused while the first waits.
    expect(validateOrder(gameOf(guest), room.map, { type: 'missileTruce', nationId: 'r1', target: 'r0' })).toBe('Awaiting their answer')
    host.s.sendCommand({ type: 'respond', nationId: 'r0', proposalId: offer!.id, accept: true })
    await room.run(600)
    for (const x of room.seats) {
      expect(trucePair(gameOf(x), 'r0', 'r1')).not.toBeNull()
      expect(gameOf(x).proposals.some((p) => p.kind === 'truce')).toBe(false)
      expect(gameOf(x).wars).toContain('r0|r1')
    }
    expect(same(room)).toBe(true)
    // The ceasefire is news on both screens.
    expect(gameOf(host).log.some((l) => /missile ceasefire/i.test(l.text))).toBe(true)
  })

  it('live: the other player declines, and nothing changes but the news', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, atWar)
    host.s.sendCommand({ type: 'missileTruce', nationId: 'r0', target: 'r1' })
    await room.run(600)
    const offer = gameOf(guest).proposals.find((p) => p.kind === 'truce')!
    expect(offer.to).toBe('r1')
    guest.s.sendCommand({ type: 'respond', nationId: 'r1', proposalId: offer.id, accept: false })
    await room.run(600)
    for (const x of room.seats) {
      expect(trucePair(gameOf(x), 'r0', 'r1')).toBeNull()
      expect(gameOf(x).proposals).toEqual([])
    }
    expect(gameOf(host).log.some((l) => /rejected .*missile ceasefire/i.test(l.text))).toBe(true)
    expect(same(room)).toBe(true)
  })

  it('with DEALINGS off the old refusal stands', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, atWar)
    host.s.sendCommand({ type: 'missileTruce', nationId: 'r0', target: 'r1' })
    await room.run(600)
    expect(gameOf(guest).proposals).toHaveLength(1)
    DEALINGS.on = false
    expect(validateOrder(gameOf(guest), room.map, { type: 'missileTruce', nationId: 'r1', target: 'r0' })).toMatch(/Only AI rivals/)
  })

  it('turns: the offer reaches the other player at the month end, and their answer counts at the next', async () => {
    const hub = new MemoryHub()
    const map = lineMap(6)
    const clock = { t: 1_000_000 }
    const mk = (id: string, name: string) => new OnlineSession({ transport: hub.join(id), clientId: id, name, map, now: () => clock.t, events: {} })
    const host = mk('host', 'Hana')
    const guest = mk('b', 'Bo')
    host.createRoom('ABCDE', { difficulty: 'normal', victoryShare: 2, timer: 0, seed: 7 })
    guest.joinRoom()
    await settle()
    host.pickNation('r0')
    guest.pickNation('r1')
    await settle()
    expect(await host.startGame()).toBeNull()
    await settle(120)
    for (const s of [host, guest]) atWar(s.game!)
    const t0 = host.game!.turn
    host.submitOrders(t0, [{ type: 'missileTruce', nationId: 'r0', target: 'r1' }], true)
    guest.submitOrders(t0, [], true)
    await settle(200)
    expect(guest.game!.turn).toBe(t0 + 1)
    const offer = guest.game!.proposals.find((p) => p.kind === 'truce' && p.to === 'r1')!
    expect(offer).toBeTruthy()
    host.submitOrders(t0 + 1, [], true)
    guest.submitOrders(t0 + 1, [{ type: 'respond', nationId: 'r1', proposalId: offer.id, accept: true }], true)
    await settle(200)
    for (const s of [host, guest]) {
      expect(s.game!.turn).toBe(t0 + 2)
      expect(trucePair(s.game!, 'r0', 'r1')).not.toBeNull()
    }
  })
})
