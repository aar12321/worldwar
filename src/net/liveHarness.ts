import { lineMap } from '../engine/__tests__/fixtures'
import type { GameState, Order, WorldMap } from '../engine/types'
import { clockOf } from '../engine/calendar'
import { liveFingerprint } from './fingerprint'
import type { ClockView, RoomSettings } from './protocol'
import { OnlineSession, type LiveStatus, type OrderEvent } from './session'
import { MemoryHub } from './transport'

/** Test helpers for live rooms: several sessions on one in-memory hub and a fake clock. Not used by the app. */
export const LIVE_SETTINGS: RoomSettings = { difficulty: 'normal', victoryShare: 2, timer: 0, seed: 7, mode: 'live', liveSpeed: 1, liveControl: 'host' }

export interface LiveSeat {
  id: string
  s: OnlineSession
  days: number
  orders: OrderEvent[]
  acks: { cid: number; ok: boolean; reason?: string }[]
  clocks: ClockView[]
  statuses: LiveStatus[]
  starts: GameState[]
  requests: string[]
  kicked: number
  rematches: number
}

export const settle = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms))
}

export interface LiveRoom {
  hub: MemoryHub
  clock: { t: number }
  seats: LiveSeat[]
  map: WorldMap
  /** Moves the fake time forward in 200 ms ticks, as the real timer would, letting each screen run. */
  run(ms: number, who?: LiveSeat[]): Promise<void>
  /** Adds a screen that joins the room (it has not picked a nation). */
  add(id: string, name: string): LiveSeat
}

export function liveSeat(hub: MemoryHub, map: WorldMap, id: string, name: string, clock: { t: number }): LiveSeat {
  const out: LiveSeat = { id, s: null as unknown as OnlineSession, days: 0, orders: [], acks: [], clocks: [], statuses: [], starts: [], requests: [], kicked: 0, rematches: 0 }
  out.s = new OnlineSession({
    transport: hub.join(id),
    clientId: id,
    name,
    map,
    now: () => clock.t,
    autoTick: false,
    events: {
      onDay: () => void out.days++,
      onOrder: (e) => out.orders.push(e),
      onAck: (cid, ok, reason) => out.acks.push({ cid, ok, reason }),
      onClock: (c) => out.clocks.push(c),
      onLive: (st) => out.statuses.push(st),
      onStart: (st) => out.starts.push(st),
      onClockRequest: (n, req) => out.requests.push(`${n}:${req.kind}`),
      onKicked: () => void out.kicked++,
      onRematch: () => void out.rematches++,
    },
  })
  return out
}

/** Opens a live room with `count` players on a line map, everyone has picked a nation, and the game has started (clock stopped). */
export async function liveRoom(count = 2, settings: Partial<RoomSettings> = {}, size = 8): Promise<LiveRoom> {
  const hub = new MemoryHub()
  const map = lineMap(size)
  const clock = { t: 1_000_000 }
  const names = ['Hana', 'Bo', 'Cy', 'Di']
  const ids = ['host', 'b', 'c', 'd']
  const seats = Array.from({ length: count }, (_, i) => liveSeat(hub, map, ids[i], names[i], clock))
  const room: LiveRoom = {
    hub,
    clock,
    seats,
    map,
    async run(ms, who = seats) {
      for (let spent = 0; spent < ms; spent += 200) {
        clock.t += Math.min(200, ms - spent)
        for (const x of who) x.s.tick()
        await settle()
      }
    },
    add(id, name) {
      const x = liveSeat(hub, map, id, name, clock)
      seats.push(x)
      return x
    },
  }
  seats[0].s.createRoom('LIVE1', { ...LIVE_SETTINGS, ...settings })
  for (const x of seats.slice(1)) x.s.joinRoom()
  await settle()
  seats.forEach((x, i) => x.s.pickNation(`r${i}`))
  await settle()
  const err = await seats[0].s.startGame()
  if (err) throw new Error(err)
  await settle(150)
  return room
}

/** Waits until every screen has the game, whatever state it takes to get there. */
export async function syncAll(room: LiveRoom, ms = 600) {
  await room.run(ms)
  await settle(100)
}

export const gameOf = (x: LiveSeat): GameState => x.s.game as GameState
export const dayOf = (x: LiveSeat) => clockOf(gameOf(x))
export const same = (room: LiveRoom, seats = room.seats) => new Set(seats.map((x) => (x.s.game ? liveFingerprint(x.s.game) : 'none'))).size === 1

/** An attack order from `from` on `target`, with the whole stance defaults. */
export const attackOrder = (from: string, target: string): Order => ({ type: 'attack', nationId: from, target, commit: 'main', stance: 'assault' }) as Order
