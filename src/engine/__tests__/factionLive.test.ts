import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { addOpinion } from '../../ai/opinion'
import { armiesToRecall } from '../../ai/liveBot'
import { launchFactionArmies, factionOf } from '../factions'
import { absDay, clockOf, daysInMonth } from '../calendar'
import { forceUnits, totalUnits } from '../helpers'
import { recallProblem } from '../armies'
import { advanceDay, startLive, type LiveEvent } from '../live'
import { normalizeGame } from '../migrate'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { validateOrder } from '../orders'
import type { GameState, NationId, Order } from '../types'
import { UNIT_TYPES } from '../types'
import { invariantProblems } from './invariants'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'
import { BLOC } from '../../data/blocs'
// These tests pin the legacy faction rules (the common pool, votes, the pooled army). They still run, with the bloc layer switched off,
// which is the switch-off proof of docs/BLOC_STATUS.md; the bloc rules themselves are in bloc*.test.ts.
beforeAll(() => {
  BLOC.on = false
})
afterAll(() => {
  BLOC.on = true
})


/**
 * A faction's joint offensive in a live game: it sets out on the day the vote passes as a real army, fights on arrival, comes home.
 * (A turn game's offensive is fought at once: factions.test.ts.)
 */
const map = lineMap(8)

function world(): GameState {
  const humans: NationId[] = ['r0', 'r1']
  const s = startState(map, 'r0', 3)
  s.humans = humans
  for (const id of Object.keys(s.nations)) {
    const n = s.nations[id]
    n.resources.capital = 1000
    n.resources.pp = 300
    n.resources.oil = 100
    n.resources.steel = 100
    n.resources.goods = 60
    n.resources.food = 120
    n.isPlayer = humans.includes(id)
    setMilitary(s, id, { infantry: 10, armor: 4 })
  }
  s.humans = humans
  return s
}
const ok = (s: GameState, o: Order) => expect(applyOrderNow(s, map, o).error, JSON.stringify(o)).toBeNull()

/** r0, r1 and r5 in a faction with a full pool, a war on r2 (which holds r3 and r4) put to the vote; the vote passes at the end of the first live month. */
function setup(strongest?: NationId) {
  const s = world()
  for (const m of ['r5']) for (const o of ['r0', 'r1']) addOpinion(s, m, o, 'Friends', 60, 0.01)
  ok(s, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
  for (const m of ['r1', 'r5']) {
    ok(s, { type: 'factionInvite', nationId: 'r0', target: m })
    const f = factionOf(s, 'r0')!
    if (!f.members.includes(m)) ok(s, { type: 'factionJoin', nationId: m, factionId: f.id })
  }
  giveRegions(s, 'r2', ['r3', 'r4'])
  for (const id of ['r2', 'r3', 'r4']) s.regions[id].line = 40
  setMilitary(s, 'r2', { infantry: 6 })
  ok(s, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 8, armor: 3 }, stock: { money: 200, oil: 40, food: 40 } } })
  ok(s, { type: 'factionContribute', nationId: 'r1', gift: { units: { infantry: 6 } } })
  // The lead is the strongest member when the war begins.
  if (strongest) setMilitary(s, strongest, { infantry: 60, armor: 20 })
  ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r2' } })
  const id = factionOf(s, 'r0')!.proposals[0].id
  const turnOfVote = s.turn + 1
  const monthOrders = (turn: number): Order[] => (turn === turnOfVote ? [{ type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'yes' }] : [])
  return { s: startLive(structuredClone(s)), monthOrders }
}

interface Day {
  s: GameState
  events: LiveEvent[]
}

function* days(start: GameState, monthOrders: (t: number) => Order[], n: number): Generator<Day> {
  let s = start
  for (let i = 0; i < n; i++) {
    const last = (s.day ?? 0) >= daysInMonth(s.turn) - 1
    const step = advanceDay(s, map, { monthOrders: last ? monthOrders(s.turn) : undefined, planner: () => [] })
    s = step.state
    yield { s, events: step.events }
  }
}

const poolUnits = (s: GameState) => totalUnits(factionOf(s, 'r0')!.pool.units)

describe('a faction\'s joint army in a live game', () => {
  it('sets out on the day the vote passes, a real army that carries a copy of the pool', () => {
    const { s: start, monthOrders } = setup()
    let launched: { s: GameState; ev: LiveEvent } | null = null
    for (const d of days(start, monthOrders, 70)) {
      const ev = d.events.find((e) => e.kind === 'launched' && e.army.faction)
      if (ev) {
        launched = { s: d.s, ev }
        break
      }
    }
    expect(launched).not.toBeNull()
    const s = launched!.s
    const army = s.armies!.find((a) => a.faction)!
    const f = factionOf(s, 'r0')!
    // The war is on, the day is the 1st of the month after the vote month, and it is the lead member's army.
    expect(f.wars).toHaveLength(1)
    expect(army.faction!.id).toBe(f.id)
    expect(army.faction!.war).toBe(f.wars[0].id)
    expect(army.nationId).toBe(f.wars[0].lead)
    expect(army.launched).toBe(absDay(s.turn, 0))
    expect(army.launched).toBe(clockOf(s))
    expect(army.phase).toBe('outbound')
    // It is a copy: the pool keeps its soldiers, and no member's military lost any.
    for (const k of UNIT_TYPES) expect(army.units[k]).toBeCloseTo(f.pool.units[k], 9)
    expect(f.pool.units.infantry).toBeGreaterThan(10)
    expect(forceUnits(s, army.nationId).infantry).toBeCloseTo(s.nations[army.nationId].military.units.infantry, 9)
  })

  it('marches, fights on arrival, charges its losses to the pool, and comes home without adding a soldier to anyone\'s military', () => {
    const { s: start, monthOrders } = setup()
    let before: GameState | null = null
    let fought = false
    let home = false
    let armyId = ''
    let poolAtLaunch = 0
    let militaryAtLaunch = 0
    let lead: NationId = 'r5'
    let last = start
    for (const d of days(start, monthOrders, 120)) {
      expect(invariantProblems(d.s)).toEqual([])
      last = d.s
      const launch = d.events.find((e) => e.kind === 'launched' && e.army.faction)
      if (launch && launch.kind === 'launched' && !before) {
        before = d.s
        armyId = launch.army.id
        lead = launch.army.nationId
        poolAtLaunch = poolUnits(d.s)
        militaryAtLaunch = totalUnits(d.s.nations[lead].military.units)
      }
      if (!before) continue
      const f = factionOf(d.s, 'r0')!
      const a = d.s.armies?.find((x) => x.id === armyId)
      // While it is out, the lead's own military is untouched, and the pool never gains soldiers from the army.
      expect(totalUnits(d.s.nations[lead].military.units)).toBeCloseTo(militaryAtLaunch, 6)
      expect(poolUnits(d.s)).toBeLessThanOrEqual(poolAtLaunch + 1e-6)
      if (d.events.some((e) => e.kind === 'battle' && e.armyId === armyId)) {
        fought = true
        // The pool is charged exactly what the army lost.
        if (a) for (const k of UNIT_TYPES) expect(f.pool.units[k]).toBeCloseTo(a.units[k], 6)
      }
      if (d.events.some((e) => e.kind === 'home' && e.army.id === armyId)) {
        home = true
        break
      }
    }
    expect(before).not.toBeNull()
    expect(fought).toBe(true)
    expect(home).toBe(true)
    expect(last.armies?.some((a) => a.faction)).toBeFalsy()
    // Coming home added nothing to the lead's military: it is what it was before the army set out.
    expect(totalUnits(last.nations[lead].military.units)).toBeCloseTo(militaryAtLaunch, 6)
    expect(poolUnits(last)).toBeLessThan(poolAtLaunch)
  })

  it('an army that sets out from another member\'s soil is not cut off from home', () => {
    // r0 leads; the nearest ground to the target is r5's.
    const { s: start, monthOrders } = setup('r0')
    let armyHome: string | null = null
    let fought = false
    let home = false
    for (const d of days(start, monthOrders, 120)) {
      const a = d.s.armies?.find((x) => x.faction)
      if (a && !armyHome) {
        expect(a.nationId).toBe('r0')
        armyHome = d.s.regions[a.home].owner
      }
      if (d.events.some((e) => e.kind === 'battle')) fought = true
      if (d.events.some((e) => e.kind === 'turnedBack' && e.why === 'cut')) throw new Error('the army was cut off')
      if (d.events.some((e) => e.kind === 'home' && e.army.faction)) {
        home = true
        break
      }
    }
    expect(armyHome).not.toBe('r0')
    expect(fought && home).toBe(true)
  })

  it('cannot be recalled by one member, and a rival does not call it home', () => {
    const { s: start, monthOrders } = setup()
    for (const d of days(start, monthOrders, 70)) {
      const army = d.s.armies?.find((a) => a.faction && a.phase === 'outbound')
      if (!army) continue
      expect(recallProblem(d.s, army.nationId, army.id)).toMatch(/joint army/)
      expect(validateOrder(d.s, map, { type: 'recall', nationId: army.nationId, armyId: army.id })).toMatch(/joint army/)
      // A rival that sees an army marching on its country calls its strongest army home: not the faction's.
      d.s.nations[army.nationId].isPlayer = false
      d.s.armies!.push({ ...structuredClone(army), id: 'threat', nationId: 'r7', faction: undefined, units: { ...army.units, infantry: 500 }, target: d.s.nations[army.nationId].capital, phase: 'outbound', end: army.end + 5, home: 'r7' })
      delete d.s.armies![d.s.armies!.length - 1].faction
      expect(armiesToRecall(d.s, map, clockOf(d.s))).not.toContain(army.id)
      return
    }
    throw new Error('no army set out')
  })

  it('turns back when the war ends, and the pool is whole', () => {
    const { s: start, monthOrders } = setup()
    let s = start
    let launchedAt = 0
    for (const d of days(start, monthOrders, 70)) {
      s = d.s
      if (d.events.some((e) => e.kind === 'launched' && e.army.faction)) {
        launchedAt = poolUnits(s)
        break
      }
    }
    expect(launchedAt).toBeGreaterThan(0)
    // Peace with the target: the faction's war is over before the army arrives.
    s.wars = s.wars.filter((k) => !k.includes('r2'))
    let turned = false
    for (const d of days(s, () => [], 12)) {
      s = d.s
      if (d.events.some((e) => e.kind === 'turnedBack' && e.army.faction)) turned = true
    }
    expect(turned).toBe(true)
    expect(s.armies?.some((a) => a.faction)).toBeFalsy()
    expect(poolUnits(s)).toBeCloseTo(launchedAt, 6)
  })

  it('the pool\'s soldiers are committed while the army is out: a second army is not sent', () => {
    const { s: start, monthOrders } = setup()
    for (const d of days(start, monthOrders, 70)) {
      if (d.s.armies?.some((a) => a.faction)) {
        expect(launchFactionArmies(d.s, map, clockOf(d.s))).toHaveLength(0)
        expect(d.s.armies!.filter((a) => a.faction)).toHaveLength(1)
        return
      }
    }
    throw new Error('no army set out')
  })

  it('sends one army at a time, so the pool\'s soldiers are never in two places', () => {
    const { s: start, monthOrders } = setup()
    let s = start
    let launches = 0
    for (const d of days(start, monthOrders, 140)) {
      s = d.s
      launches += d.events.filter((e) => e.kind === 'launched' && e.army.faction).length
      expect(s.armies!.filter((a) => a.faction).length).toBeLessThanOrEqual(1)
    }
    expect(launches).toBeGreaterThanOrEqual(1)
    expect(launches).toBeGreaterThanOrEqual(1)
  })

  it('a save with the army on the road loads and plays on the same; one whose faction is gone loses the army, not a soldier', () => {
    const { s: start, monthOrders } = setup()
    let s = start
    for (const d of days(start, monthOrders, 70)) {
      s = d.s
      if (s.armies?.some((a) => a.faction)) break
    }
    expect(s.armies?.some((a) => a.faction)).toBe(true)
    const loaded = normalizeGame(JSON.parse(JSON.stringify(s)), map)
    expect(JSON.stringify(loaded.armies)).toBe(JSON.stringify(s.armies))
    const a = advanceDay(loaded, map, { planner: () => [] }).state
    const b = advanceDay(s, map, { planner: () => [] }).state
    expect(JSON.stringify(a.armies)).toBe(JSON.stringify(b.armies))
    const orphan = JSON.parse(JSON.stringify(s)) as GameState
    const poolBefore = totalUnits(orphan.factions![0].pool.units)
    orphan.factions![0].wars = []
    const cleaned = normalizeGame(orphan, map)
    expect(cleaned.armies?.some((x) => x.faction)).toBeFalsy()
    expect(totalUnits(cleaned.factions![0].pool.units)).toBeCloseTo(poolBefore, 9)
  })

  it('the turn game is untouched: it still fights the same month, instantly, with no army on the road', () => {
    const { s: start, monthOrders } = setup()
    const turn = structuredClone(start)
    delete turn.settings.mode
    delete turn.day
    delete turn.armies
    delete turn.launches
    delete turn.flights
    let t = turn
    for (let i = 0; i < 2; i++) t = resolveTurn(t, map, monthOrders(t.turn))
    expect(t.armies).toBeUndefined()
    expect(factionOf(t, 'r0')!.history.some((h) => /joint army (captured|pushed back|was repulsed)/.test(h.text))).toBe(true)
  })
})
