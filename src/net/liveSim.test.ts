import { describe, expect, it } from 'vitest'
import { clockOf } from '../engine/calendar'
import { atWar } from '../engine/helpers'
import type { GameState, Order } from '../engine/types'
import { liveFingerprint } from './fingerprint'
import { dayOf, gameOf, liveRoom, patchAll, settle, type LiveRoom, type LiveSeat } from './liveHarness'
import { createRng } from '../engine/rng'


/** Every number the game keeps about the world is a real number, and what must be unique is. */
function invariants(g: GameState): string[] {
  const bad: string[] = []
  for (const n of Object.values(g.nations)) {
    for (const [k, v] of Object.entries(n.resources)) if (!Number.isFinite(v)) bad.push(`${n.id}.${k} is ${v}`)
    if (!Number.isFinite(n.militaryPool)) bad.push(`${n.id}.militaryPool`)
  }
  for (const r of Object.values(g.regions)) {
    if (!Number.isFinite(r.population) || r.population < 0) bad.push(`${r.id} population ${r.population}`)
    if (!g.nations[r.owner]) bad.push(`${r.id} owner ${r.owner} is not a nation`)
  }
  const ids = (g.armies ?? []).map((a) => a.id)
  if (new Set(ids).size !== ids.length) bad.push('army ids repeat')
  for (const a of g.armies ?? []) if (!g.nations[a.nationId]) bad.push(`army ${a.id} of nobody`)
  if (g.liveOrders) for (const id of Object.keys(g.liveOrders)) if (!g.humans.includes(id)) bad.push(`waiting orders for ${id}`)
  if (!['playing', 'victory', 'defeat'].includes(g.outcome) && typeof g.outcome !== 'string') bad.push('outcome')
  return bad
}

interface Script {
  month: number
  day: number
  seat: number
  order: (g: GameState, me: string) => Order | null
}

/** What two people might do in a month: build, set the budget, start a war when they can afford it, and attack. */
function scripts(): Script[] {
  const farm = (g: GameState, me: string): Order => ({ type: 'build', nationId: me, regionId: me, building: g.regions[me].buildings.farm < 3 ? 'farm' : 'barracks' })
  const policy = (tax: number) => (_g: GameState, me: string): Order => ({ type: 'setPolicy', nationId: me, taxRate: tax, draftRate: 0.02 })
  const train = (_g: GameState, me: string): Order => ({ type: 'train', nationId: me, unit: 'infantry' })
  const war = (g: GameState, me: string): Order | null => {
    const foe = me === 'r0' ? 'r1' : 'r0'
    return atWar(g, me, foe) ? null : { type: 'declareWar', nationId: me, target: foe }
  }
  const hit = (g: GameState, me: string): Order | null => {
    const foe = me === 'r0' ? 'r1' : 'r0'
    return atWar(g, me, foe) ? { type: 'attack', nationId: me, target: foe, commit: 'main', stance: 'assault' } : null
  }
  const out: Script[] = []
  for (let m = 0; m < 24; m++) {
    out.push({ month: m, day: 3, seat: 0, order: farm }, { month: m, day: 3, seat: 1, order: farm })
    out.push({ month: m, day: 5, seat: 1, order: policy(0.18 + (m % 5) * 0.02) }, { month: m, day: 5, seat: 0, order: policy(0.2 + (m % 3) * 0.02) })
    out.push({ month: m, day: 8, seat: 0, order: train }, { month: m, day: 8, seat: 1, order: train })
    // Both want the same thing at the same moment, from month 6 on.
    if (m >= 6) out.push({ month: m, day: 11, seat: 0, order: war }, { month: m, day: 11, seat: 1, order: war })
    if (m >= 7) out.push({ month: m, day: 14, seat: 0, order: hit }, { month: m, day: 14, seat: 1, order: hit })
    // An order that cannot be done is sent as well now and then.
    if (m % 4 === 1) out.push({ month: m, day: 20, seat: 1, order: (_g, me) => ({ type: 'build', nationId: me, regionId: 'r7', building: 'port' }) })
  }
  return out
}

async function playMonths(room: LiveRoom, months: number, check: (when: string) => void, jitter: boolean) {
  const [host, guest] = room.seats
  const rng = createRng(99, 1)
  const plan = scripts()
  const done = new Set<number>()
  host.s.controlClock({ kind: 'speed', speed: 4 })
  host.s.controlClock({ kind: 'resume' })
  let guard = 0
  while (gameOf(host).outcome === 'playing' && gameOf(host).turn <= months && guard++ < 20_000) {
    // A host whose tab is in the background ticks late and in bursts.
    const step = jitter ? Math.round(100 + rng.next() * rng.next() * 3000) : 250
    room.clock.t += step
    for (const x of room.seats) x.s.tick()
    await settle()
    // Everything sent has been delivered by now, so equal days must mean equal games.
    if (dayOf(host) === dayOf(guest)) check(`day ${dayOf(host)}`)
    const g = gameOf(host)
    plan.forEach((sc, i) => {
      if (done.has(i)) return
      if (g.turn - 1 === sc.month && (g.day ?? 0) >= sc.day) {
        done.add(i)
        const seat = room.seats[sc.seat] as LiveSeat
        const order = sc.order(gameOf(seat), seat.s.me!)
        if (order) seat.s.sendCommand(order)
      }
    })
  }
  return gameOf(host).outcome !== 'playing'
}

describe('two humans online, live, for two years', () => {
  it('both screens hold the same game on every day, whatever the timers do, and the invariants hold', async () => {
    const room = await liveRoom(2, { seed: 11 }, 10)
    const [host, guest] = room.seats
    // Money and soldiers enough that the two of them can go to war and fight, which the first months would not allow.
    patchAll(room, (g) => {
      for (const id of ['r0', 'r1']) {
        g.nations[id].resources.pp = 4000
        g.nations[id].resources.capital = 4000
        g.nations[id].military.units.infantry = 20
      }
    })
    let compared = 0
    const check = (when: string) => {
      const a = liveFingerprint(gameOf(host))
      const b = liveFingerprint(gameOf(guest))
      if (a !== b) throw new Error(`the screens differ on ${when}`)
      compared++
      if (compared % 10 === 0) {
        expect(invariants(gameOf(host))).toEqual([])
        expect(invariants(gameOf(guest))).toEqual([])
      }
    }
    const over = await playMonths(room, 24, check, true)
    await room.run(2000)
    await settle(150)
    expect(host.s.resyncs).toBe(0)
    expect(guest.s.resyncs).toBe(0)
    const g = gameOf(host)
    console.log('SIM', { turn: g.turn, day: g.day, outcome: g.outcome, compared, hostOrders: host.orders.length, guestOrders: guest.orders.length, acks: guest.acks.length, nacks: guest.acks.filter((a) => !a.ok).length, wars: g.wars.length, battles: host.battles, msgs: room.hub.log.length })
    expect(over || g.turn > 24).toBe(true)
    expect(compared).toBeGreaterThan(300)
    expect(clockOf(gameOf(guest))).toBe(clockOf(g))
    expect(invariants(g)).toEqual([])
    // Real things happened: orders were taken, and wars were fought.
    expect(host.orders.length + guest.orders.length).toBeGreaterThan(60)
    expect(host.battles).toBeGreaterThan(0)
    expect(guest.battles).toBe(host.battles)
    // Every order was answered.
    expect(guest.s.liveStatus().pending).toBe(0)
    // And the messages stayed small: a handful per game day.
    const streams = room.hub.log.filter((m) => m.t === 'stream')
    const days = clockOf(g)
    expect(streams.length / Math.max(1, days)).toBeLessThan(3)
    expect(Math.max(...streams.map((m) => JSON.stringify(m).length))).toBeLessThan(20_000)
  }, 300_000)
})
