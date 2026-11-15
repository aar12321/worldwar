import { describe, expect, it } from 'vitest'
import { LIVE } from '../data/live'
import { lineMap } from '../engine/__tests__/fixtures'
import { daysInMonth } from '../engine/calendar'
import { applyLiveOp, isMonthEndDay } from '../engine/live'
import type { GameState, Order } from '../engine/types'
import type { LiveUpdate } from './liveRoom'
import { fingerprint, type LiveClock, type RoomSettings } from './protocol'
import { HOST_TIMEOUT_MS, OnlineSession, RESEND_MS } from './session'
import { MemoryHub } from './transport'

const map = lineMap(8)
const SETTINGS: RoomSettings = { difficulty: 'normal', victoryShare: 2, timer: 0, seed: 7, mode: 'live', speed: 4, pauses: 2, pauseLimitSec: 30 }
const settle = async (ms = 10) => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, ms / 4))
}
/** Moves a fake clock forward in quarter seconds, as the real ticker does. Sessions not in the list are not ticked. */
async function pass(clock: { t: number }, sessions: OnlineSession[], ms: number) {
  for (let spent = 0; spent < ms; spent += 250) {
    clock.t += 250
    for (const s of sessions) s.tick()
    await settle(4)
  }
}

interface Seat {
  s: OnlineSession
  updates: LiveUpdate[]
  clocks: LiveClock[]
  fails: { nonce: string; error: string }[]
  starts: GameState[]
}

function seat(hub: MemoryHub, clientId: string, name: string, clock: { t: number }): Seat {
  const out: Seat = { s: null as unknown as OnlineSession, updates: [], clocks: [], fails: [], starts: [] }
  out.s = new OnlineSession({
    transport: hub.join(clientId),
    clientId,
    name,
    map,
    now: () => clock.t,
    autoTick: false,
    events: {
      onLive: (u) => out.updates.push(u),
      onClock: (c) => out.clocks.push(c),
      onActFail: (nonce, error) => out.fails.push({ nonce, error }),
      onStart: (st) => out.starts.push(st),
    },
  })
  return out
}

/** The game each screen holds: the host's true game, or a screen's copy of it. */
const gameOf = (x: Seat) => (x.s.referee?.game ?? x.s.mirror?.game) as GameState
/** The same game, whoever's screen it is on. */
const same = (a: GameState, b: GameState) => JSON.stringify({ ...a, playerId: '' }) === JSON.stringify({ ...b, playerId: '' })

async function started(count = 3, settings: RoomSettings = SETTINGS) {
  const hub = new MemoryHub()
  const clock = { t: 1_000_000 }
  const seats = [seat(hub, 'host', 'Hana', clock), seat(hub, 'b', 'Bo', clock), seat(hub, 'c', 'Cy', clock)].slice(0, count)
  seats[0].s.createRoom('ABCDE', settings)
  for (const x of seats.slice(1)) x.s.joinRoom()
  await settle(40)
  seats.forEach((x, i) => x.s.pickNation(`r${i}`))
  await settle(40)
  await seats[0].s.startGame()
  await settle(80)
  return { hub, clock, seats, all: seats.map((x) => x.s) }
}

const farm = (nationId: string): Order => ({ type: 'build', nationId, regionId: nationId, building: 'farm' })
const msPerDay = LIVE.msPerDay / (SETTINGS.speed ?? 1)

describe('the engine steps of an online live game', () => {
  it('two copies given the same steps stay identical, and a bad order changes nothing', async () => {
    const { seats } = await started(1)
    let a = gameOf(seats[0])
    let b = structuredClone(a)
    for (let i = 0; i < 20; i++) {
      const op = i % 5 === 0 ? ({ k: 'act', nationId: 'r0', order: farm('r0') } as const) : ({ k: 'day' } as const)
      if (op.k === 'day' && isMonthEndDay(a)) break
      a = applyLiveOp(a, map, op).state
      b = applyLiveOp(b, map, op).state
    }
    expect(same(a, b)).toBe(true)
    const bad = applyLiveOp(a, map, { k: 'act', nationId: 'r0', order: farm('r1') })
    expect(bad.error).toBeTruthy()
    expect(bad.state).toBe(a)
  })
})

describe('playing live together', () => {
  it('starts paused, as a live game, with no surprise decisions', async () => {
    const { seats } = await started(2)
    const g = gameOf(seats[1])
    expect(g.settings.mode).toBe('live')
    expect(g.settings.online).toBe(true)
    expect(seats[1].starts).toHaveLength(1)
    expect(seats[1].s.clock?.running).toBe(false)
  })

  it('every screen holds the same world after two months of orders from everyone', async () => {
    const { clock, seats, all } = await started(3)
    seats[0].s.requestResume()
    const turn = gameOf(seats[0]).turn
    for (let day = 0; gameOf(seats[0]).turn < turn + 2; day++) {
      if (day % 7 === 1) seats[1].s.sendAct(farm('r1'))
      if (day % 9 === 2) seats[2].s.sendAct(farm('r2'))
      if (day % 11 === 3) seats[0].s.sendAct(farm('r0'))
      await pass(clock, all, msPerDay)
    }
    await pass(clock, all, 1000)
    const host = gameOf(seats[0])
    expect(host.turn).toBeGreaterThanOrEqual(turn + 2)
    for (const x of seats.slice(1)) {
      expect(fingerprint(gameOf(x))).toBe(fingerprint(host))
      expect(same(gameOf(x), host)).toBe(true)
      expect(x.s.mirror!.seq).toBe(seats[0].s.referee!.seq)
    }
    expect(host.regions.r1.buildings.farm).toBeGreaterThan(0)
    // Every screen heard that the months ended, with this screen's own nation as the player.
    expect(seats[1].updates.filter((u) => u.monthEnded).length).toBeGreaterThanOrEqual(2)
    expect(seats[1].updates.at(-1)!.next.playerId).toBe('r1')
    // Orders it could not afford were refused; the ones it could reached every screen.
    expect(seats[1].fails.every((f) => f.error.startsWith('Not enough'))).toBe(true)
    expect(seats[2].updates.flatMap((u) => u.acts).some((a) => a.nationId === 'r1')).toBe(true)
  })

  it('refuses an order for another nation, and one that waits for the month', async () => {
    const { seats } = await started(2)
    const nonce = seats[1].s.sendAct(farm('r0'))
    seats[1].s.sendAct({ type: 'research', nationId: 'r1', techId: 'x' } as Order)
    await settle(40)
    expect(seats[1].fails.map((f) => f.nonce)).toContain(nonce)
    expect(seats[1].fails).toHaveLength(2)
    expect(seats[0].s.referee!.seq).toBe(0)
  })

  it('month-end orders sent as a plan count when the month turns over', async () => {
    const { clock, seats, all } = await started(2)
    const g = gameOf(seats[1])
    const n = g.nations.r1
    const policy: Order = { type: 'setPolicy', nationId: 'r1', taxRate: 0.3, draftRate: n.draftRate, corporateTax: n.corporateTax, spending: n.spending }
    seats[1].s.submitOrders(g.turn, [policy], false)
    seats[0].s.requestResume()
    await pass(clock, all, msPerDay * (daysInMonth(g.turn) + 2))
    const month = seats[1].updates.find((u) => u.monthEnded)!
    expect(month.plans?.r1).toBe(g.turn)
    expect(gameOf(seats[1]).nations.r1.taxRate).toBeCloseTo(0.3)
  })
})

describe('the shared clock', () => {
  it('anyone may pause a few times; only they or the host resume; a pause ends by itself', async () => {
    const { clock, seats, all } = await started(3)
    seats[0].s.requestResume()
    await pass(clock, all, 500)
    seats[1].s.requestPause()
    await pass(clock, all, 250)
    expect(seats[2].s.clock?.running).toBe(false)
    expect(seats[2].s.clock?.pausedBy).toBe('b')
    expect(seats[2].s.clock?.pausesLeft.b).toBe(1)
    const day = gameOf(seats[0]).day
    seats[2].s.requestResume()
    await pass(clock, all, 1000)
    expect(seats[2].fails.some((f) => f.nonce === 'clock-resume')).toBe(true)
    expect(gameOf(seats[0]).day).toBe(day)
    seats[1].s.requestResume()
    await pass(clock, all, 250)
    expect(seats[2].s.clock?.running).toBe(true)
    // The second pause runs out by itself after the limit.
    seats[1].s.requestPause()
    await pass(clock, all, 250)
    expect(seats[0].s.clock?.running).toBe(false)
    await pass(clock, all, (SETTINGS.pauseLimitSec ?? 0) * 1000 + 500)
    expect(seats[0].s.clock?.running).toBe(true)
    // None left.
    seats[1].s.requestPause()
    await pass(clock, all, 250)
    expect(seats[1].fails.some((f) => f.error.includes('no pauses'))).toBe(true)
    expect(seats[0].s.clock?.running).toBe(true)
  })

  it('only the host sets the speed', async () => {
    const { clock, seats, all } = await started(2)
    seats[1].s.requestSpeed(1)
    await pass(clock, all, 250)
    expect(seats[1].s.clock?.speed).toBe(4)
    seats[0].s.requestSpeed(2)
    await pass(clock, all, 250)
    expect(seats[1].s.clock?.speed).toBe(2)
  })
})

describe('when the network misbehaves', () => {
  it('a screen that missed steps gets them again', async () => {
    const { hub, clock, seats, all } = await started(2)
    seats[0].s.requestResume()
    await pass(clock, all, msPerDay * 2)
    hub.dropFrom.add('host')
    await pass(clock, all, msPerDay * 3)
    hub.dropFrom.delete('host')
    await pass(clock, all, msPerDay * 3)
    expect(seats[1].s.mirror!.seq).toBe(seats[0].s.referee!.seq)
    expect(same(gameOf(seats[1]), gameOf(seats[0]))).toBe(true)
  })

  it('a screen whose game drifted takes the host\'s game', async () => {
    const { clock, seats, all } = await started(2)
    seats[0].s.requestResume()
    await pass(clock, all, msPerDay * 2)
    seats[1].s.mirror!.game = { ...gameOf(seats[1]), nextId: gameOf(seats[1]).nextId + 50 }
    await pass(clock, all, msPerDay * 4)
    expect(fingerprint(gameOf(seats[1]))).toBe(fingerprint(gameOf(seats[0])))
    expect(seats[1].updates.some((u) => u.resync)).toBe(true)
  })

  it('when the host drops, the next player carries on from the same step, paused', async () => {
    const { hub, clock, seats, all } = await started(3)
    seats[0].s.requestResume()
    await pass(clock, all, msPerDay * 3)
    const seq = seats[0].s.referee!.seq
    hub.dropFrom.add('host')
    await pass(clock, all.slice(1), HOST_TIMEOUT_MS + 1000)
    expect(seats[1].s.isHost).toBe(true)
    expect(seats[1].s.referee).not.toBeNull()
    expect(seats[1].s.referee!.seq).toBeGreaterThanOrEqual(seq)
    expect(seats[2].s.clock?.running).toBe(false)
    seats[1].s.requestResume()
    await pass(clock, all.slice(1), msPerDay * 4)
    expect(seats[1].s.referee!.seq).toBeGreaterThan(seq)
    expect(seats[2].s.mirror!.seq).toBe(seats[1].s.referee!.seq)
    expect(same(gameOf(seats[2]), gameOf(seats[1]))).toBe(true)
  })

  it('an order whose message was lost is sent again, and made only once', async () => {
    const { hub, clock, seats, all } = await started(2)
    hub.dropFrom.add('b')
    const nonce = seats[1].s.sendAct(farm('r1'))
    await settle(20)
    hub.dropFrom.delete('b')
    expect(seats[0].s.referee!.seq).toBe(0)
    await pass(clock, all, RESEND_MS + 500)
    expect(seats[0].s.referee!.seq).toBe(1)
    // The same message arriving twice more changes nothing.
    hub.join('spy').send({ t: 'act', from: 'b', nonce, order: farm('r1') })
    await pass(clock, all, RESEND_MS + 500)
    expect(seats[0].s.referee!.seq).toBe(1)
    expect(seats[1].updates.flatMap((u) => u.acts).filter((a) => a.nonce === nonce)).toHaveLength(1)
    expect(gameOf(seats[1]).regions.r1.buildings.farm).toBe(gameOf(seats[0]).regions.r1.buildings.farm)
  })

  it('a player who joins a running game gets the game and the clock', async () => {
    const { hub, clock, seats, all } = await started(2)
    seats[0].s.requestResume()
    await pass(clock, all, msPerDay * 2)
    // Bo's page reloads: a new session with the same id.
    seats[1].s.close()
    const back = seat(hub, 'b', 'Bo', clock)
    back.s.joinRoom()
    await pass(clock, [seats[0].s, back.s], msPerDay * 2)
    expect(back.starts).toHaveLength(1)
    expect(back.s.clock?.running).toBe(true)
    expect(same(gameOf(back), gameOf(seats[0]))).toBe(true)
  })
})
