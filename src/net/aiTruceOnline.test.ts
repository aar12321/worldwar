import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AI_TRUCE } from '../data/missileWar'
import { trucePair } from '../engine/missileWar'
import type { GameState } from '../engine/types'
import { lineMap } from '../engine/__tests__/fixtures'
import { gameOf, liveRoom, patchAll, same, settle } from './liveHarness'
import { OnlineSession } from './session'
import { MemoryHub } from './transport'

/**
 * A rival's missile ceasefire offer reaches a human player online (AI_TRUCE, src/ai/missileTruce.ts): r0 and r1 are people, r2 is an AI
 * rival at war with r0, which struck it last month; r2 has no missiles to answer with, so it wants the missiles to stop.
 */
const underFire = (g: GameState) => {
  if (!g.wars.includes('r0|r2')) g.wars.push('r0|r2')
  g.wars.sort()
  g.warStarted['r0|r2'] = g.turn
  g.regions.r0.buildings.factory = 1
  g.nations.r0.arsenal = { cruise: 20 }
  g.nations.r2.arsenal = {}
  g.nations.r2.military.units.missile = 0
  g.nations.r2.personality = 'honorable'
  g.nations.r2.struckBy = { r0: g.turn - 1 }
}

const was = AI_TRUCE.chance
beforeEach(() => {
  // The month's draw is its own test (src/ai/missileTruce.test.ts); here the rival with a reason always offers.
  AI_TRUCE.chance = 1
})
afterEach(() => {
  AI_TRUCE.chance = was
})

async function turnsRoom() {
  const hub = new MemoryHub()
  const map = lineMap(6)
  const clock = { t: 1_000_000 }
  const mk = (id: string, name: string) => new OnlineSession({ transport: hub.join(id), clientId: id, name, map, now: () => clock.t, events: {} })
  const host = mk('host', 'Hana')
  const guest = mk('b', 'Bo')
  host.createRoom('ABCDE', { difficulty: 'hard', victoryShare: 2, timer: 0, seed: 7 })
  guest.joinRoom()
  await settle()
  host.pickNation('r0')
  guest.pickNation('r1')
  await settle()
  expect(await host.startGame()).toBeNull()
  await settle(120)
  for (const s of [host, guest]) underFire(s.game!)
  return { host, guest }
}

describe('a rival offers a player a missile ceasefire online', () => {
  it('turns: the offer reaches the player at the month end, both screens see it, and accepting makes the ceasefire', async () => {
    const { host, guest } = await turnsRoom()
    const t0 = host.game!.turn
    host.submitOrders(t0, [], true)
    guest.submitOrders(t0, [], true)
    await settle(200)
    expect(host.game!.turn).toBe(t0 + 1)
    const offer = host.game!.proposals.find((p) => p.kind === 'truce' && p.from === 'r2' && p.to === 'r0')!
    expect(offer).toBeTruthy()
    expect(guest.game!.proposals.some((p) => p.id === offer.id)).toBe(true)
    // The player hears of it: a dispatch for the month's toasts, and the offer in the Diplomacy inbox.
    expect(host.game!.dispatches.some((d) => d.kind === 'proposal' && d.from === 'r2' && d.to === 'r0' && d.proposalKind === 'truce')).toBe(true)
    host.submitOrders(t0 + 1, [{ type: 'respond', nationId: 'r0', proposalId: offer.id, accept: true }], true)
    guest.submitOrders(t0 + 1, [], true)
    await settle(200)
    for (const s of [host, guest]) {
      expect(s.game!.turn).toBe(t0 + 2)
      expect(trucePair(s.game!, 'r0', 'r2')).not.toBeNull()
      expect(s.game!.wars).toContain('r0|r2')
    }
    expect(host.game!.log.some((l) => /missile ceasefire/i.test(l.text))).toBe(true)
  })

  it('turns: the player declines; no ceasefire, and the rival waits before offering again', async () => {
    const { host, guest } = await turnsRoom()
    const t0 = host.game!.turn
    host.submitOrders(t0, [], true)
    guest.submitOrders(t0, [], true)
    await settle(200)
    const offer = host.game!.proposals.find((p) => p.kind === 'truce' && p.from === 'r2')!
    expect(offer).toBeTruthy()
    host.submitOrders(t0 + 1, [{ type: 'respond', nationId: 'r0', proposalId: offer.id, accept: false }], true)
    guest.submitOrders(t0 + 1, [], true)
    await settle(200)
    for (const s of [host, guest]) {
      expect(trucePair(s.game!, 'r0', 'r2')).toBeNull()
      expect(s.game!.truceRefused).toEqual({ 'r2>r0': t0 + 1 })
    }
    expect(host.game!.dispatches.some((d) => d.kind === 'rejected' && d.from === 'r0' && d.to === 'r2' && d.proposalKind === 'truce')).toBe(true)
    // Struck again, it still does not ask the next month.
    for (const s of [host, guest]) s.game!.nations.r2.struckBy = { r0: s.game!.turn - 1 }
    host.submitOrders(t0 + 2, [], true)
    guest.submitOrders(t0 + 2, [], true)
    await settle(200)
    expect(host.game!.proposals.some((p) => p.kind === 'truce')).toBe(false)
  })

  it('live: the rival offers at the month end, the player accepts at once, and both screens agree', async () => {
    const room = await liveRoom(2, { difficulty: 'hard' }, 6)
    const [host, guest] = room.seats
    patchAll(room, underFire)
    expect(same(room)).toBe(true)
    const t0 = gameOf(host).turn
    host.s.controlClock({ kind: 'resume' })
    for (let i = 0; i < 80 && gameOf(host).turn === t0; i++) await room.run(1000)
    host.s.controlClock({ kind: 'pause' })
    await room.run(1000)
    expect(gameOf(host).turn).toBe(t0 + 1)
    const offer = gameOf(host).proposals.find((p) => p.kind === 'truce' && p.from === 'r2' && p.to === 'r0')!
    expect(offer).toBeTruthy()
    expect(gameOf(guest).proposals.some((p) => p.id === offer.id)).toBe(true)
    expect(host.s.sendCommand({ type: 'respond', nationId: 'r0', proposalId: offer.id, accept: true }).error).toBeNull()
    await room.run(600)
    for (const x of room.seats) {
      expect(trucePair(gameOf(x), 'r0', 'r2')).not.toBeNull()
      expect(gameOf(x).proposals.some((p) => p.kind === 'truce')).toBe(false)
    }
    expect(same(room)).toBe(true)
  })

  it('live: the player declines at once; nothing changes but the news and the rival\'s memory', async () => {
    const room = await liveRoom(2, { difficulty: 'hard' }, 6)
    const [host, guest] = room.seats
    patchAll(room, underFire)
    const t0 = gameOf(host).turn
    host.s.controlClock({ kind: 'resume' })
    for (let i = 0; i < 80 && gameOf(host).turn === t0; i++) await room.run(1000)
    host.s.controlClock({ kind: 'pause' })
    await room.run(1000)
    const offer = gameOf(guest).proposals.find((p) => p.kind === 'truce' && p.from === 'r2')!
    expect(offer).toBeTruthy()
    expect(host.s.sendCommand({ type: 'respond', nationId: 'r0', proposalId: offer.id, accept: false }).error).toBeNull()
    await room.run(600)
    for (const x of room.seats) {
      expect(trucePair(gameOf(x), 'r0', 'r2')).toBeNull()
      expect(gameOf(x).proposals.some((p) => p.kind === 'truce')).toBe(false)
      expect(gameOf(x).truceRefused?.['r2>r0']).toBe(gameOf(x).turn)
    }
    expect(gameOf(host).log.some((l) => /rejected .*missile ceasefire/i.test(l.text))).toBe(true)
    expect(same(room)).toBe(true)
  })
})
