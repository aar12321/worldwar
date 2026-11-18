import { describe, expect, it } from 'vitest'
import { blocOf } from '../engine/bloc'
import { clockOf } from '../engine/calendar'
import { factionOf } from '../engine/factions'
import { pairKey, totalUnits } from '../engine/helpers'
import { applyOrderNow } from '../engine/resolveTurn'
import type { GameState } from '../engine/types'
import { gameOf, liveRoom, patchAll, same } from './liveHarness'

/**
 * Two people in one bloc, online, live (docs/BLOC_STATUS.md): an operation is planned by one, both pledge from their own armies through
 * the normal order path (the host applies, both screens get it), both see the same D-Day count down, the force marches and fights on
 * D-Day, and both see the same joint battle report. No screen keeps a state of its own.
 */
describe('a live online bloc', () => {
  it('both players pledge to one operation; it marches, fights on D-Day, and both screens agree on everything', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, (g: GameState) => {
      for (const id of ['r0', 'r1']) {
        g.nations[id].resources.pp = 200
        g.nations[id].military.units = { infantry: 10, armor: 4, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }
      }
      // Founded and joined the same way on every screen (the engine is deterministic), then at war with r2.
      expect(applyOrderNow(g, room.map, { type: 'factionFound', nationId: 'r0', name: 'Twin Pact' }).error).toBeNull()
      expect(applyOrderNow(g, room.map, { type: 'factionInvite', nationId: 'r0', target: 'r1' }).error).toBeNull()
      expect(applyOrderNow(g, room.map, { type: 'factionJoin', nationId: 'r1', factionId: factionOf(g, 'r0')!.id }).error).toBeNull()
      g.nations.r2.military.units = { infantry: 3, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }
      g.regions.r2.line = 2
      g.wars.push(pairKey('r0', 'r2'), pairKey('r1', 'r2'))
      g.wars.sort()
    })
    expect(same(room)).toBe(true)
    // The host plans; it reaches the guest's screen as soon as the host has done it.
    const plan = host.s.sendCommand({ type: 'blocPlan', nationId: 'r0', target: 'r2', when: 8 })
    expect(plan.error).toBeNull()
    await room.run(600)
    const op = blocOf(factionOf(gameOf(guest), 'r1')).ops[0]
    expect(op).toMatchObject({ target: 'r2', status: 'planned' })
    expect(blocOf(factionOf(gameOf(host), 'r0')).ops[0].dday).toBe(op.dday)
    // Both pledge from their own armies.
    expect(guest.s.sendCommand({ type: 'blocCommit', nationId: 'r1', opId: op.id, units: { infantry: 6, armor: 2 } }).error).toBeNull()
    expect(host.s.sendCommand({ type: 'blocCommit', nationId: 'r0', opId: op.id, units: { infantry: 5 } }).error).toBeNull()
    await room.run(600)
    expect(guest.acks.at(-1)?.ok).toBe(true)
    for (const x of room.seats) expect(Object.keys(blocOf(factionOf(gameOf(x), 'r0')).ops[0].pledges).sort()).toEqual(['r0', 'r1'])
    expect(same(room)).toBe(true)
    // A pledge for somebody else's nation never gets past the host.
    guest.s.transport.send({ t: 'cmd', from: 'b', cid: 77, order: { type: 'blocCommit', nationId: 'r0', opId: op.id, units: { infantry: 9 } } })
    await room.run(400)
    expect(blocOf(factionOf(gameOf(host), 'r0')).ops[0].pledges.r0).toEqual({ infantry: 5 })
    // The clock runs: the countdown is the same on both screens, the force sets out and arrives on D-Day.
    const units0 = totalUnits(gameOf(host).nations.r0.military.units) + totalUnits(gameOf(host).nations.r1.military.units)
    host.s.controlClock({ kind: 'resume' })
    let sawMarch = false
    for (let i = 0; i < 40 && blocOf(factionOf(gameOf(host), 'r0')).ops[0].status !== 'done'; i++) {
      await room.run(2000)
      const h = blocOf(factionOf(gameOf(host), 'r0')).ops[0]
      if (h.status === 'marching') {
        sawMarch = true
        const army = gameOf(host).armies!.find((a) => a.id === h.armyId)!
        expect(army.end).toBe(op.dday)
        expect(Object.keys(army.op!.from).sort()).toEqual(['r0', 'r1'])
      }
    }
    await room.run(6000)
    host.s.controlClock({ kind: 'pause' })
    await room.run(1000)
    expect(sawMarch).toBe(true)
    const done = blocOf(factionOf(gameOf(host), 'r0')).ops[0]
    expect(done.status).toBe('done')
    expect(done.result?.failed).toBeUndefined()
    expect(Object.keys(done.result!.members).sort()).toEqual(['r0', 'r1'])
    expect(clockOf(gameOf(host))).toBeGreaterThanOrEqual(op.dday)
    for (const x of room.seats) expect(blocOf(factionOf(gameOf(x), 'r0')).ops[0].result).toEqual(done.result)
    // The force is home: each member has what it sent back, less what the report says it lost (training may add, nothing else takes).
    const lost = done.result!.members.r0.lost + done.result!.members.r1.lost
    expect(gameOf(host).armies?.some((a) => a.op)).toBe(false)
    expect(totalUnits(gameOf(host).nations.r0.military.units) + totalUnits(gameOf(host).nations.r1.military.units)).toBeGreaterThanOrEqual(units0 - lost - 1e-6)
    expect(same(room)).toBe(true)
  }, 120_000)
})
