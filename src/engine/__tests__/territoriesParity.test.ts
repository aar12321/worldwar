import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { daysInMonth } from '../calendar'
import { advanceDay, startLive } from '../live'
import { validateOrder } from '../orders'
import { bindTerritory } from '../territories'
import { createRng } from '../rng'
import { resolveTurn, applyOrderNow } from '../resolveTurn'
import { applyScenario } from '../scenarios'
import { declareWar } from '../diplomacy'
import type { GameState, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

function world(): GameState {
  const s = startState(map, 'r0', 4)
  for (const id of Object.keys(s.nations)) {
    s.nations[id].resources.capital = 1500
    s.nations[id].resources.pp = 300
    s.nations[id].resources.oil = 100
    s.nations[id].resources.steel = 100
    s.nations[id].resources.food = 150
    setMilitary(s, id, { infantry: 10, armor: 3 })
  }
  s.nations.r0.tier = 3
  bindTerritory(s, 'r1', 'r0')
  s.territories!.r1.since = -30
  return s
}

function stripped(s: GameState) {
  const copy = JSON.parse(JSON.stringify(s))
  for (const k of ['day', 'armies', 'launches', 'flights', 'pendingDay']) delete copy[k]
  delete copy.settings.mode
  return copy
}

function liveMonths(s: GameState, months: number, monthOrders: (turn: number) => Order[]) {
  const target = s.turn + months
  while (s.turn < target) {
    const last = (s.day ?? 0) >= daysInMonth(s.turn) - 1
    s = advanceDay(s, map, { monthOrders: last ? monthOrders(s.turn) : undefined, planner: () => [] }).state
  }
  return s
}

describe('a year with a territory: turn and live games agree', () => {
  it('twelve months of cuts, commands, a forced deal and a war give the same game', () => {
    const orders = (turn: number): Order[] => {
      const t = 'r1'
      const cmd = (order: Order): Order => ({ type: 'commandTerritory', nationId: 'r0', territory: t, order })
      if (turn === 1) return [cmd({ type: 'train', nationId: t, unit: 'infantry' }), { type: 'forceTrade', nationId: 'r0', territory: t, partner: 'r0', terms: { give: { oil: 10 }, receive: { capital: 24 }, months: 6 } }]
      if (turn === 3) return [cmd({ type: 'queueTrain', nationId: t, unit: 'infantry' }), cmd({ type: 'upgradeWeapons', nationId: t, unit: 'infantry' })]
      if (turn === 4) return [{ type: 'declareWar', nationId: 'r0', target: 'r5' }]
      if (turn === 6) return [cmd({ type: 'setDeployment', nationId: t, coastal: 0, subs: 0, air: 0, border: { r2: 0.3 } })]
      return []
    }
    let turn = world()
    for (let i = 0; i < 12; i++) {
      turn.nations.r0.resources.pp = 300
      turn = resolveTurn(turn, map, orders(turn.turn))
    }
    let live = startLive(structuredClone(world()))
    while (live.turn < turn.turn) {
      live.nations.r0.resources.pp = 300
      const monthStart = live.turn
      live = liveMonths(live, 1, orders)
      expect(live.turn).toBe(monthStart + 1)
    }
    expect(live.turn).toBe(turn.turn)
    const a = stripped(turn)
    const b = stripped(live)
    for (const l of [...a.log, ...b.log]) delete l.day
    // The two ways of running a month leave the same record of the cut, the same treasuries and the same wars.
    expect(b.territories).toEqual(a.territories)
    expect(b.nations.r1.resources).toEqual(a.nations.r1.resources)
    expect(b.nations.r0.resources).toEqual(a.nations.r0.resources)
    expect(b.wars).toEqual(a.wars)
    expect(b.factions).toEqual(a.factions)
    expect(b.regions).toEqual(a.regions)
    expect(a.territories.r1.taken).toBeGreaterThan(0)
    expect(a.wars).toContain('r0|r5')
    expect(a.wars).toContain('r1|r5')
  })

  it('a live game: an attack commanded for the territory marches as the territory\'s own army', () => {
    const s = world()
    s.wars.push('r0|r2', 'r1|r2')
    s.warStarted['r0|r2'] = s.warStarted['r1|r2'] = s.turn
    s.nations.r1.resources.capital = 900
    const live = startLive(structuredClone(s))
    const o: Order = { type: 'commandTerritory', nationId: 'r0', territory: 'r1', order: { type: 'attack', nationId: 'r1', target: 'r2', units: { infantry: 4 }, stance: 'assault' } }
    expect(validateOrder(live, map, o)).toBeNull()
    const r = applyOrderNow(live, map, o)
    expect(r.error).toBeNull()
    expect(r.army?.nationId).toBe('r1')
    expect(live.nations.r0.military.attacksThisTurn).toBe(0)
  })
})

describe('fuzz: no order breaks a month', () => {
  it('random orders about territories, in the wrong hands, never throw, and the state stays whole', () => {
    const rng = createRng(77, 1)
    let s = world()
    s.humans = ['r0']
    const ids = Object.keys(s.nations)
    const pick = <T,>(xs: T[]) => xs[rng.int(0, xs.length - 1)]
    const junkValue = () => pick<unknown>([undefined, null, 0, -1, 1e12, NaN, Infinity, 'x', [], {}, true])
    for (let month = 0; month < 6; month++) {
      const orders: Order[] = []
      for (let i = 0; i < 30; i++) {
        const nationId = pick(ids)
        const t = pick(ids)
        const inner = pick<unknown>([
          { type: 'train', nationId: t, unit: pick(['infantry', 'armor', 'zzz']) },
          { type: 'queueTrain', nationId: t, unit: junkValue() },
          { type: 'attack', nationId: t, target: pick(ids), units: pick([{ infantry: 3 }, { infantry: junkValue() }, junkValue()]) },
          { type: 'setDeployment', nationId: t, coastal: junkValue(), subs: 0, air: 0, border: junkValue() },
          { type: 'propose', nationId: t, target: pick(ids), proposal: pick([{ kind: 'peace', terms: junkValue() }, { kind: 'pact' }, junkValue()]) },
          junkValue(),
        ])
        const o = pick<unknown>([
          { type: 'commandTerritory', nationId, territory: t, order: inner },
          { type: 'commandTerritory', nationId, territory: junkValue(), order: inner },
          { type: 'forceTrade', nationId, territory: t, partner: pick([...ids, junkValue() as string]), terms: pick<unknown>([{ give: { oil: 5 }, receive: { capital: 12 }, months: 3 }, { give: junkValue(), receive: junkValue(), months: junkValue() }, junkValue()]) },
          { type: 'releaseTerritory', nationId, target: pick([...ids, junkValue() as string]) },
          { type: 'annexTerritory', nationId, target: pick([...ids, junkValue() as string]) },
        ]) as Order
        expect(typeof validateOrder(s, map, o) === 'string' || validateOrder(s, map, o) === null).toBe(true)
        orders.push(o)
      }
      const next = resolveTurn(s, map, [...orders, ...generateAllBotOrders(s, map)])
      // Records and nation fields never disagree, and no territory sits in two places.
      for (const [id, rec] of Object.entries(next.territories ?? {})) {
        expect(next.nations[id].territoryOf).toBe(rec.master)
        expect(next.nations[id].alive).toBe(true)
        expect(next.nations[rec.master].alive).toBe(true)
        expect(next.nations[id].overlord).toBeNull()
        expect(next.nations[rec.master].territoryOf).toBeUndefined()
        expect(next.factions?.some((f) => f.members.includes(id) && f.members.includes(rec.master))).toBe(true)
      }
      for (const n of Object.values(next.nations)) if (n.territoryOf) expect(next.territories?.[n.id]?.master).toBe(n.territoryOf)
      for (const n of Object.values(next.nations)) for (const v of Object.values(n.resources)) expect(Number.isFinite(v)).toBe(true)
      s = next
      // New territories appear and disappear freely, but the lonely test world needs one to keep the fuzz about something.
      if (!s.territories) bindTerritory(s, 'r1', 'r0')
    }
  })

  it('a bot world with several territories over a year keeps every rule', () => {
    let s = world()
    s.humans = []
    s.nations.r0.isPlayer = false
    bindTerritory(s, 'r2', 'r0')
    s.nations.r0.tier = 4
    declareWar(s, map, 'r0', 'r6', createRng(1, 1))
    for (let i = 0; i < 12; i++) {
      s = resolveTurn(s, map, generateAllBotOrders(s, map))
      for (const t of ['r1', 'r2']) {
        if (s.nations[t].territoryOf !== 'r0') continue
        expect(s.factions?.find((f) => f.members.includes('r0'))?.members).toContain(t)
        // It fights wherever its master does.
        for (const foe of Object.keys(s.nations)) if (s.wars.includes([ 'r0', foe ].sort().join('|')) && s.nations[foe].alive && foe !== t) expect(s.wars.includes([t, foe].sort().join('|'))).toBe(true)
      }
    }
  })
})

describe('scenarios', () => {
  it('a scenario can make territories, within the master\'s tier', () => {
    const s = startState(map, 'r0', 3)
    s.nations.r5.tier = 3
    const def = { id: 'terr-test', name: 'T', blurb: '', goal: { kind: 'world' }, ops: [{ op: 'territory', master: 'r5', territories: ['r6', 'r7', 'r4'] }] }
    const report = applyScenario(s, map, def as never)
    expect(report.applied).toEqual(['0:territory'])
    // Tier 3 holds two: the third is refused.
    expect(Object.values(s.nations).filter((n) => n.territoryOf === 'r5')).toHaveLength(2)
    expect(s.territories).toBeDefined()
  })
})
