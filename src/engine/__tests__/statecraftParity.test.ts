import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { daysInMonth } from '../calendar'
import { advanceDay, startLive } from '../live'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(8)

/** A state with no live fields, to compare a live game against a turn game. */
function stripped(s: GameState) {
  const copy = JSON.parse(JSON.stringify(s))
  for (const k of ['day', 'armies', 'launches', 'flights', 'pendingDay']) delete copy[k]
  delete copy.settings.mode
  return copy
}

/** Plays a game to the end of `months` months in live mode, one day at a time. */
function liveMonths(s: GameState, months: number, monthOrders: (turn: number) => Order[], planner: (st: GameState, m: typeof map) => Order[]) {
  const target = s.turn + months
  while (s.turn < target) {
    const last = (s.day ?? 0) >= daysInMonth(s.turn) - 1
    s = advanceDay(s, map, { monthOrders: last ? monthOrders(s.turn) : undefined, planner }).state
  }
  return s
}

describe('turn and live months are the same month, Statecraft included', () => {
  it('six quiet months with the same orders give the same game: people, bank, projects, tiers, history', () => {
    const base = startState(map, 'r0', 4)
    base.nations.r0.resources.capital = 3000
    base.nations.r0.resources.pp = 300
    // The same standing orders each month; month-end ones apply on the 1st in both modes.
    const monthOrders = (turn: number): Order[] =>
      turn === 1
        ? [
            { type: 'setPrograms', nationId: 'r0', programs: { focus: 'engineering', stage: 'secondary' } },
            { type: 'setPolicy', nationId: 'r0', taxRate: 0.22, draftRate: 0.05, spending: { schools: 3, health: 3, works: 2, pensions: 1, jobless: 1, housing: 1 } },
          ]
        : []
    const none = () => []
    // Immediate orders happen before the first month in both.
    const prepare = (s: GameState) => {
      for (const o of [
        { type: 'startProject', nationId: 'r0', project: 'rail' },
        { type: 'printMoney', nationId: 'r0', share: 0.05 },
        { type: 'issueBonds', nationId: 'r0', amount: 60, term: 36 },
      ] as Order[])
        expect(applyOrderNow(s, map, o).error).toBeNull()
      return s
    }
    let turn = prepare(structuredClone(base))
    for (let i = 0; i < 6; i++) turn = resolveTurn(turn, map, monthOrders(turn.turn))
    const live = liveMonths(prepare(startLive(structuredClone(base))), 6, monthOrders, none)
    expect(live.turn).toBe(turn.turn)
    const a = stripped(turn)
    const b = stripped(live)
    // The game's log carries days in live mode only; everything else must match exactly.
    for (const l of [...a.log, ...b.log]) delete l.day
    expect(b.nations).toEqual(a.nations)
    expect(b.regions).toEqual(a.regions)
    expect(b.worldStats).toEqual(a.worldStats)
    expect(b.history).toEqual(a.history)
    expect(b.stocks).toEqual(a.stocks)
    expect(b.log).toEqual(a.log)
  })

  it('on the real world, a year of bots in turns and live agree on how many nations are alive and how strong the economy is, within a margin', () => {
    const { map: world } = getWorld()
    const seed = 12
    const mk = () => createInitialState(world, { playerRegionId: 'france', seed, difficulty: 'hard', goal: 'world', victoryShare: 2 })
    let t = mk()
    for (let i = 0; i < 12 && t.outcome === 'playing'; i++) {
      if (t.pendingEvent) t.pendingEvent = null
      t = resolveTurn(t, world, generateAllBotOrders(t, world))
    }
    let l = startLive(mk())
    const planner = (st: GameState, m: typeof world) => generateAllBotOrders(st, m)
    const target = l.turn + 12
    while (l.turn < target && l.outcome === 'playing') {
      if (l.pendingEvent) l = { ...l, pendingEvent: null }
      l = advanceDay(l, world, { planner }).state
    }
    const alive = (s: GameState) => Object.values(s.nations).filter((n) => n.alive).length
    expect(Math.abs(alive(l) - alive(t))).toBeLessThanOrEqual(Math.max(6, alive(t) * 0.06))
    const money = (s: GameState) => Object.values(s.nations).reduce((a, n) => a + (n.alive ? n.resources.capital : 0), 0)
    expect(Math.abs(money(l) - money(t)) / Math.max(1, money(t))).toBeLessThan(0.25)
    for (const n of Object.values(l.nations)) {
      if (!n.alive) continue
      expect(n.tier).toBeGreaterThanOrEqual(1)
      expect(Number.isFinite(n.bank.inflation)).toBe(true)
    }
  }, 240_000)
})
