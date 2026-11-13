import { describe, expect, it } from 'vitest'
import { lineMap } from '../engine/__tests__/fixtures'
import type { GameState, Order } from '../engine/types'
import { decodeState, encodeState, fingerprint, newRoomCode, normalizeCode, validCode } from './protocol'
import { HOST_TIMEOUT_MS, OnlineSession, PEER_TIMEOUT_MS, RESEND_MS, humanOrder } from './session'
import { MemoryHub } from './transport'

const map = lineMap(8)
const SETTINGS = { difficulty: 'normal' as const, victoryShare: 2, timer: 0 as const, seed: 7 }
/** Moves a fake clock forward in small steps, letting each screen send its heartbeat, as real timers would. */
async function pass(clock: { t: number }, sessions: OnlineSession[], ms: number) {
  for (let spent = 0; spent < ms; spent += 2000) {
    clock.t += Math.min(2000, ms - spent)
    for (const s of sessions) s.tick()
    await settle(10)
  }
}
const settle = async (ms = 40) => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, ms / 5))
}

interface Seat {
  s: OnlineSession
  states: GameState[]
  starts: GameState[]
  readyList: string[][]
  hostFlags: boolean[]
  resubmits: number
}

function seat(hub: MemoryHub, clientId: string, name: string, clock: { t: number }): Seat {
  const out: Seat = { s: null as unknown as OnlineSession, states: [], starts: [], readyList: [], hostFlags: [], resubmits: 0 }
  out.s = new OnlineSession({
    transport: hub.join(clientId),
    clientId,
    name,
    map,
    now: () => clock.t,
    autoTick: false,
    events: {
      onState: (_p, n) => out.states.push(n),
      onStart: (st) => out.starts.push(st),
      onReady: (r) => out.readyList.push(r),
      onHost: (h) => out.hostFlags.push(h),
      onResubmit: () => out.resubmits++,
    },
  })
  return out
}

async function room(count = 3) {
  const hub = new MemoryHub()
  const clock = { t: 1_000_000 }
  const seats = [seat(hub, 'host', 'Hana', clock), seat(hub, 'b', 'Bo', clock), seat(hub, 'c', 'Cy', clock)].slice(0, count)
  seats[0].s.createRoom('ABCDE', SETTINGS)
  for (const x of seats.slice(1)) x.s.joinRoom()
  await settle()
  seats.forEach((x, i) => x.s.pickNation(`r${i}`))
  await settle()
  return { hub, clock, seats }
}

describe('room codes and snapshots', () => {
  it('codes are five readable characters', () => {
    for (let i = 0; i < 50; i++) expect(validCode(newRoomCode())).toBe(true)
    expect(normalizeCode(' ab-cd 2e ')).toBe('ABCD2E')
    expect(validCode('ABCDI')).toBe(false)
  })

  it('a game survives being squeezed into pieces and put back', async () => {
    const { createInitialState } = await import('../data/startingNations')
    const s = createInitialState(map, { playerRegionId: 'r0', seed: 3, victoryShare: 2 })
    const parts = await encodeState(s)
    expect(parts.every((p) => p.length <= 40_000)).toBe(true)
    const back = await decodeState(parts)
    expect(fingerprint(back)).toBe(fingerprint(s))
    expect(JSON.stringify(back)).toBe(JSON.stringify(s))
  })

  it('the order humans act in changes with the month but never favors a nation by name', () => {
    const ids = ['a', 'b', 'c', 'd']
    const orders = Array.from({ length: 30 }, (_, t) => humanOrder(5, t, ids)[0])
    expect(new Set(orders).size).toBeGreaterThan(2)
    expect(humanOrder(5, 3, ids)).toEqual(humanOrder(5, 3, [...ids].reverse()))
  })
})

describe('the lobby', () => {
  it('lets players join, pick different nations, and start together', async () => {
    const { seats } = await room(3)
    const lobby = seats[0].s.lobby!
    expect(lobby.players.map((p) => p.name)).toEqual(['Hana', 'Bo', 'Cy'])
    expect(lobby.players.map((p) => p.nationId)).toEqual(['r0', 'r1', 'r2'])
    // Two people cannot take the same nation.
    seats[2].s.pickNation('r1')
    await settle()
    expect(seats[0].s.lobby!.players[2].nationId).toBe('r2')
    expect(await seats[1].s.startGame()).toMatch(/Only the host/)
    expect(await seats[0].s.startGame()).toBeNull()
    await settle(120)
    for (const x of seats) {
      expect(x.s.game).toBeTruthy()
      expect(x.s.game!.humans).toEqual(['r0', 'r1', 'r2'])
      expect(x.s.me).toBe(`r${seats.indexOf(x)}`)
      expect(fingerprint(x.s.game!)).toBe(fingerprint(seats[0].s.game!))
    }
    // Each screen is told which nation is its own.
    expect(seats[1].starts[0].playerId).toBe('r1')
    expect(seats[2].starts[0].playerId).toBe('r2')
  })

  it('will not start until everyone has a nation, and caps the room at four', async () => {
    const hub = new MemoryHub()
    const clock = { t: 0 }
    const host = seat(hub, 'host', 'Hana', clock)
    host.s.createRoom('ABCDE', SETTINGS)
    const guests = ['b', 'c', 'd', 'e'].map((id) => seat(hub, id, id, clock))
    guests.forEach((g) => g.s.joinRoom())
    await settle()
    expect(host.s.lobby!.players).toHaveLength(4)
    host.s.pickNation('r0')
    expect(await host.s.startGame()).toMatch(/pick a nation/)
  })

  it('only the host can change the settings', async () => {
    const { seats } = await room(2)
    seats[1].s.updateSettings({ ...SETTINGS, difficulty: 'hard' })
    await settle()
    expect(seats[0].s.lobby!.settings.difficulty).toBe('normal')
    seats[0].s.updateSettings({ ...SETTINGS, difficulty: 'hard', timer: 90 })
    await settle()
    expect(seats[1].s.lobby!.settings.difficulty).toBe('hard')
    expect(seats[1].s.lobby!.settings.timer).toBe(90)
  })
})

describe('playing a month together', () => {
  async function started(count = 3) {
    const r = await room(count)
    await r.seats[0].s.startGame()
    await settle(120)
    return r
  }
  const farm = (nationId: string): Order => ({ type: 'build', nationId, regionId: nationId, building: 'farm' })

  it('resolves when everyone is ready, and every screen shows the same new month', async () => {
    const { seats } = await started(3)
    const turn = seats[0].s.game!.turn
    seats[0].s.submitOrders(turn, [farm('r0')], true)
    seats[1].s.submitOrders(turn, [farm('r1')], true)
    await settle()
    expect(seats[0].s.game!.turn).toBe(turn)
    seats[2].s.submitOrders(turn, [], true)
    await settle(200)
    for (const x of seats) expect(x.s.game!.turn).toBe(turn + 1)
    expect(fingerprint(seats[1].s.game!)).toBe(fingerprint(seats[0].s.game!))
    expect(fingerprint(seats[2].s.game!)).toBe(fingerprint(seats[0].s.game!))
    expect(seats[0].s.game!.regions.r0.buildings.farm).toBeGreaterThan(seats[0].s.game!.regions.r2.buildings.farm - 100)
    const after = seats[1].states[seats[1].states.length - 1]
    expect(after.regions.r1.buildings.farm).toBeGreaterThanOrEqual(1)
  })

  it('shows everyone who is ready', async () => {
    const { seats } = await started(3)
    const turn = seats[0].s.game!.turn
    seats[1].s.submitOrders(turn, [], true)
    await settle()
    expect(seats[2].readyList[seats[2].readyList.length - 1]).toEqual(['r1'])
    seats[1].s.submitOrders(turn, [], false)
    await settle()
    expect(seats[2].readyList[seats[2].readyList.length - 1]).toEqual([])
  })

  it('ignores orders for someone else, and orders from an old month', async () => {
    const { seats } = await started(2)
    const before = seats[0].s.game!
    const turn = before.turn
    const stolen: Order = { type: 'build', nationId: 'r0', regionId: 'r0', building: 'factory' }
    seats[1].s.submitOrders(turn, [stolen], true)
    seats[0].s.submitOrders(turn, [], true)
    await settle(200)
    const after = seats[0].s.game!
    expect(after.turn).toBe(turn + 1)
    expect(after.regions.r0.buildings.factory).toBe(before.regions.r0.buildings.factory)
    seats[1].s.submitOrders(turn, [farm('r1')], true)
    await settle()
    expect(seats[0].s.game!.turn).toBe(turn + 1)
  })

  it('moves on when the timer runs out, without the slow player', async () => {
    const hub = new MemoryHub()
    const clock = { t: 5_000 }
    const a = seat(hub, 'host', 'Hana', clock)
    const b = seat(hub, 'b', 'Bo', clock)
    a.s.createRoom('ABCDE', { ...SETTINGS, timer: 60 })
    b.s.joinRoom()
    await settle()
    a.s.pickNation('r0')
    b.s.pickNation('r1')
    await settle()
    await a.s.startGame()
    await settle(120)
    const turn = a.s.game!.turn
    a.s.submitOrders(turn, [], true)
    await settle()
    await pass(clock, [a.s, b.s], 30_000)
    expect(a.s.game!.turn).toBe(turn)
    await pass(clock, [a.s, b.s], 31_000)
    await settle(200)
    expect(a.s.game!.turn).toBe(turn + 1)
    expect(b.s.game!.turn).toBe(turn + 1)
    expect(a.s.remainingMs).toBeGreaterThan(50_000)
  })

  it('does not wait for someone who has left, and the AI plays their nation', async () => {
    const { seats, clock } = await started(3)
    const turn = seats[0].s.game!.turn
    // The third player was heard from once, then goes quiet.
    seats[2].s.tick()
    seats[0].s.tick()
    await settle()
    clock.t += PEER_TIMEOUT_MS + 1000
    seats[1].s.tick()
    seats[0].s.tick()
    seats[0].s.submitOrders(turn, [], true)
    seats[1].s.submitOrders(turn, [], true)
    await settle(250)
    expect(seats[0].s.game!.turn).toBe(turn + 1)
  })

  it('sends a plan again when the first message was lost', async () => {
    const { hub, clock, seats } = await started(2)
    const turn = seats[0].s.game!.turn
    hub.dropFrom.add('b')
    seats[1].s.submitOrders(turn, [farm('r1')], true)
    await settle()
    expect(seats[0].readyList[seats[0].readyList.length - 1] ?? []).not.toContain('r1')
    hub.dropFrom.delete('b')
    await pass(clock, [seats[0].s, seats[1].s], RESEND_MS + 2000)
    expect(seats[0].readyList[seats[0].readyList.length - 1]).toContain('r1')
  })

  it('a screen that missed a month asks the host for the game', async () => {
    const { hub, clock, seats } = await started(2)
    const turn = seats[0].s.game!.turn
    // The guest hears nothing from the host while the month resolves.
    hub.dropFrom.add('host')
    seats[0].s.submitOrders(turn, [], true)
    seats[1].s.submitOrders(turn, [], true)
    await settle(200)
    expect(seats[0].s.game!.turn).toBe(turn + 1)
    expect(seats[1].s.game!.turn).toBe(turn)
    hub.dropFrom.delete('host')
    // The next thing the host says (here, a heartbeat-driven ready update) shows the guest it is behind.
    seats[0].s.submitOrders(turn + 1, [], false)
    await pass(clock, [seats[0].s, seats[1].s], 3000)
    seats[0].s.submitOrders(turn + 1, [], true)
    await settle(300)
    expect(seats[1].s.game!.turn).toBe(turn + 1)
    expect(fingerprint(seats[1].s.game!)).toBe(fingerprint(seats[0].s.game!))
  })

  it('a player who closes the page and returns gets the game back', async () => {
    const { hub, clock, seats } = await started(2)
    const turn = seats[0].s.game!.turn
    seats[0].s.submitOrders(turn, [], true)
    seats[1].s.submitOrders(turn, [], true)
    await settle(200)
    seats[1].s.close()
    const back = seat(hub, 'b', 'Bo', clock)
    back.s.joinRoom()
    await settle(250)
    expect(back.s.game).toBeTruthy()
    expect(back.s.game!.turn).toBe(turn + 1)
    expect(back.s.me).toBe('r1')
    expect(back.starts[0].playerId).toBe('r1')
  })
})

describe('when the host drops', () => {
  it('the first player still here takes over with the latest game and everyone sends their plan again', async () => {
    const hub = new MemoryHub()
    const clock = { t: 10_000 }
    const seats = [seat(hub, 'host', 'Hana', clock), seat(hub, 'b', 'Bo', clock), seat(hub, 'c', 'Cy', clock)]
    seats[0].s.createRoom('ABCDE', SETTINGS)
    seats[1].s.joinRoom()
    seats[2].s.joinRoom()
    await settle()
    seats.forEach((x, i) => x.s.pickNation(`r${i}`))
    await settle()
    await seats[0].s.startGame()
    await settle(150)
    // Everyone is heard from.
    for (const x of seats) x.s.tick()
    await settle()
    // The host goes silent.
    hub.dropFrom.add('host')
    await pass(clock, [seats[1].s, seats[2].s], HOST_TIMEOUT_MS + 3000)
    expect(seats[1].s.isHost).toBe(true)
    expect(seats[2].s.isHost).toBe(false)
    expect(seats[2].s.lobby!.host).toBe('b')
    expect(seats[2].resubmits).toBeGreaterThan(0)
    // The new host can run the month.
    const turn = seats[1].s.game!.turn
    seats[1].s.submitOrders(turn, [], true)
    seats[2].s.submitOrders(turn, [], true)
    await pass(clock, [seats[1].s, seats[2].s], 1000)
    await settle(250)
    expect(seats[1].s.game!.turn).toBe(turn + 1)
    expect(seats[2].s.game!.turn).toBe(turn + 1)
  })
})

describe('chat', () => {
  it('reaches everyone', async () => {
    const hub = new MemoryHub()
    const clock = { t: 0 }
    const heard: string[] = []
    const a = seat(hub, 'host', 'Hana', clock)
    const b = new OnlineSession({ transport: hub.join('b'), clientId: 'b', name: 'Bo', map, autoTick: false, events: { onChat: (m) => heard.push(`${m.name}: ${m.text}`) } })
    a.s.createRoom('ABCDE', SETTINGS)
    b.joinRoom()
    await settle()
    a.s.chat('good luck')
    await settle()
    expect(heard).toEqual(['Hana: good luck'])
  })
})
