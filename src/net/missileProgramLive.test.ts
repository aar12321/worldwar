import { describe, expect, it } from 'vitest'
import type { Order } from '../engine/types'
import type { MissileProgramAction } from '../data/missileProgram'
import { gameOf, liveRoom, patchAll, same } from './liveHarness'

const act = (nationId: string, action: MissileProgramAction): Order => ({ type: 'missileProgram', nationId, action })

/** The missile program in a two-player live room: orders go through the host with acks, and both screens hold the same game. */
describe('live rooms: the missile program', () => {
  it('both players build, hire, develop and test; every screen agrees through the month, a mid-month finish and the test', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, (g) => {
      for (const id of ['r0', 'r1']) {
        g.nations[id].resources.capital = 4000
        g.nations[id].resources.tp = 500
        g.nations[id].missileProgram = 1
      }
    })
    for (const a of [{ kind: 'build', facility: 'institute' }, { kind: 'hire', role: 'engineer', count: 2 }, { kind: 'develop', dev: 'motors', by: 'foreign' }] as MissileProgramAction[]) expect(guest.s.sendCommand(act('r1', a)).error).toBeNull()
    expect(host.s.sendCommand(act('r0', { kind: 'build', facility: 'stand' })).error).toBeNull()
    expect(host.s.sendCommand(act('r0', { kind: 'budget', level: 1.5 })).error).toBeNull()
    await room.run(600)
    expect(guest.acks.every((a) => a.ok)).toBe(true)
    expect(gameOf(host).nations.r1.mprog?.devs.motors?.state).toBe('dev')
    expect(gameOf(guest).nations.r0.mprog?.budget).toBe(1.5)
    expect(same(room)).toBe(true)

    // The clock runs: the foreign contractor finishes mid-month, the facilities open as the month turns, on both screens.
    host.s.controlClock({ kind: 'speed', speed: 4 })
    host.s.controlClock({ kind: 'resume' })
    await room.run(34 * 500 + 600)
    expect(gameOf(host).turn).toBe(2)
    expect(gameOf(guest).nations.r1.mprog?.fac.institute).toBe(1)
    expect(gameOf(host).nations.r0.mprog?.fac.stand).toBe(1)
    // Two months of work at the foreign firm's 1.7 pace: done about six days into the second month.
    expect(gameOf(guest).nations.r1.mprog?.devs.motors?.state).toBe('dev')
    await room.run(8 * 500)
    expect(gameOf(guest).nations.r1.mprog?.devs.motors?.state).toBe('test')
    expect(gameOf(host).nations.r1.mprog?.devs.motors?.state).toBe('test')
    expect(same(room)).toBe(true)

    // The guest needs a stand to test; the host refuses until it has one, with words.
    const early = guest.s.sendCommand(act('r1', { kind: 'test', dev: 'motors' }))
    expect(early.error).toMatch(/test stand/)
    patchAll(room, (g) => {
      g.nations.r1.mprog!.fac.stand = 1
    })
    expect(guest.s.sendCommand(act('r1', { kind: 'test', dev: 'motors' })).error).toBeNull()
    await room.run(8 * 500)
    expect(gameOf(host).nations.r1.mprog?.stats.tests).toBe(1)
    expect(gameOf(guest).nations.r1.mprog?.stats.tests).toBe(1)
    expect(gameOf(host).missileTests).toBeUndefined()
    expect(same(room)).toBe(true)
  })

  it('a malformed or forged program order changes nothing anywhere', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    const copy = JSON.stringify(gameOf(host))
    guest.s.transport.send({ t: 'cmd', from: 'b', cid: 41, order: { type: 'missileProgram', nationId: 'r1', action: { kind: 'hire', role: 'engineer', count: 1e9 } } as Order })
    guest.s.transport.send({ t: 'cmd', from: 'b', cid: 42, order: { type: 'missileProgram', nationId: 'r1', action: null } as unknown as Order })
    guest.s.transport.send({ t: 'cmd', from: 'b', cid: 43, order: act('r0', { kind: 'build', facility: 'institute' }) })
    await room.run(600)
    expect(JSON.stringify(gameOf(host))).toBe(copy)
    expect(same(room)).toBe(true)
  })
})
