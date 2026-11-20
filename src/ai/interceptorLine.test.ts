import { afterEach, describe, expect, it } from 'vitest'
import { AI_LINE, MPROG, PRODUCTION_RULES } from '../data/missileProgram'
import { MW } from '../data/missileWar'
import { lineMap, setMilitary, startState } from '../engine/__tests__/fixtures'
import { computeEconomy } from '../engine/economy'
import { newProgram, programCost, roundsOnLine } from '../engine/missileProgram'
import { interceptorCap, interceptorsOf } from '../engine/missileWar'
import { applyOrderNow, resolveTurn } from '../engine/resolveTurn'
import type { GameState, Order } from '../engine/types'
import { generateBotOrders } from './bot'
import { interceptorThreat, queueInterceptorRounds } from './missileProgram'
import { missileWarOrders } from './missileWar'
import { createRng } from '../engine/rng'

const map = lineMap(6)

/**
 * r1, an AI rival, runs a program with a production plant and interceptor works, has a shield (its store empty) and money, and is at war
 * with r0, the player, who holds cruise missiles at a launch site next door.
 */
function threatened(): GameState {
  const s = startState(map)
  s.settings.difficulty = 'hard'
  s.wars.push('r0|r1')
  s.warStarted['r0|r1'] = s.turn
  s.regions.r0.buildings.factory = 1
  s.nations.r0.arsenal = { cruise: 20 }
  const n = s.nations.r1
  n.resources.capital = 2000
  for (const r of ['r1']) {
    s.regions[r].buildings.factory = 6
    s.regions[r].population = 80
  }
  setMilitary(s, 'r1', { infantry: 6 })
  n.systems.shield = 2
  n.missileWar = { interceptors: 0 }
  n.mprog = { ...newProgram(s), fac: { institute: 1, plant: 1, works: 1 } }
  return s
}

function queue(s: GameState, skill: 0 | 1 | 2 = 2, budget = 1000, id = 'r1'): Order[] {
  const out: Order[] = []
  queueInterceptorRounds(s, map, id, computeEconomy(s, map, id), skill, (o) => out.push(o) > 0, budget)
  return out
}
const rounds = (orders: Order[]) => orders.reduce((a, o) => (o.type === 'missileProgram' && o.action.kind === 'produce' && o.action.missile === 'interceptor' ? a + o.action.count : a), 0)

afterEach(() => {
  MPROG.aiInterceptorLine = true
  MPROG.interceptorLine = true
  MPROG.on = true
})

describe('rivals put interceptor rounds on their program line', () => {
  it('the setup has money in the black (the guards would not stop it)', () => {
    const s = threatened()
    expect(computeEconomy(s, map, 'r1').netCapital).toBeGreaterThanOrEqual(8)
    expect(interceptorCap(s.nations.r1)).toBeGreaterThan(AI_LINE.minBatch)
  })

  it('under threat it queues a batch that fills the store, counting rounds on the line, at the line price', () => {
    const s = threatened()
    const cap = interceptorCap(s.nations.r1)
    expect(interceptorThreat(s, map, 'r1')).toBe('lowStore')
    const orders = queue(s)
    expect(orders).toEqual([{ type: 'missileProgram', nationId: 'r1', action: { kind: 'produce', missile: 'interceptor', count: Math.min(cap, PRODUCTION_RULES.batchMax) } }])
    // Through the order path: paid when queued, on the line, made at the line's pace.
    const before = s.nations.r1.resources.capital
    const cost = programCost(s, s.nations.r1, (orders[0] as Extract<Order, { type: 'missileProgram' }>).action).capital
    expect(cost).toBe(Math.ceil(rounds(orders) * MW.roundCost * PRODUCTION_RULES.roundPrice))
    expect(applyOrderNow(s, map, orders[0]).error).toBeNull()
    expect(before - s.nations.r1.resources.capital).toBe(cost)
    expect(roundsOnLine(s.nations.r1)).toBe(rounds(orders))
    const next = resolveTurn(s, map, [])
    const n = next.nations.r1
    expect(interceptorsOf(n)).toBeGreaterThan(0)
    // A second batch is not queued over the first: the line already fills the room.
    n.missileWar = { ...n.missileWar, interceptors: interceptorCap(n) - roundsOnLine(n) }
    expect(queue(next)).toEqual([])
  })

  it('each threat on its own: struck lately, a low store, an armed enemy in range; none at peace or with a full store and no threat', () => {
    const s = threatened()
    const cap = interceptorCap(s.nations.r1)
    // Room enough but not low, nobody struck it, and the enemy cannot reach.
    s.nations.r1.missileWar = { interceptors: cap - AI_LINE.minBatch }
    s.nations.r0.arsenal = {}
    expect(interceptorThreat(s, map, 'r1')).toBeNull()
    expect(queue(s)).toEqual([])
    // Struck lately.
    s.nations.r1.struckBy = { r0: s.turn - 1 }
    expect(interceptorThreat(s, map, 'r1')).toBe('struck')
    expect(rounds(queue(s))).toBe(AI_LINE.minBatch)
    delete s.nations.r1.struckBy
    // An armed enemy with a launch site in range.
    s.nations.r0.arsenal = { cruise: 20 }
    expect(interceptorThreat(s, map, 'r1')).toBe('inRange')
    expect(rounds(queue(s))).toBe(AI_LINE.minBatch)
    // Armed but out of range (no launch site).
    s.regions.r0.buildings.factory = 0
    expect(interceptorThreat(s, map, 'r1')).toBeNull()
    // At peace.
    const p = threatened()
    p.wars = []
    expect(interceptorThreat(p, map, 'r1')).toBeNull()
    expect(queue(p)).toEqual([])
    // Too little room for a batch.
    const f = threatened()
    f.nations.r1.missileWar = { interceptors: interceptorCap(f.nations.r1) - (AI_LINE.minBatch - 1) }
    expect(queue(f)).toEqual([])
  })

  it('Medium and Hard do it, Easy never', () => {
    expect(queue(threatened(), 2)).toHaveLength(1)
    expect(queue(threatened(), 1)).toHaveLength(1)
    expect(queue(threatened(), 0)).toEqual([])
    // Through the whole bot: an Easy world never queues rounds, a Hard one does.
    const easy = threatened()
    easy.settings.difficulty = 'easy'
    expect(rounds(generateBotOrders(easy, map, 'r1'))).toBe(0)
    expect(rounds(generateBotOrders(threatened(), map, 'r1'))).toBeGreaterThan(0)
  })

  it('needs a plant, the works and a store to fill', () => {
    const a = threatened()
    a.nations.r1.mprog!.fac = { institute: 1, works: 1 }
    expect(queue(a)).toEqual([])
    const b = threatened()
    b.nations.r1.mprog!.fac = { institute: 1, plant: 1 }
    expect(queue(b)).toEqual([])
    const c = threatened()
    c.nations.r1.systems.shield = 0
    expect(queue(c)).toEqual([])
    const d = threatened()
    delete d.nations.r1.mprog
    expect(queue(d)).toEqual([])
  })

  it('within budget: the program money guards hold (treasury reserve, budget, income, the bill)', () => {
    const each = Math.ceil(MW.roundCost * PRODUCTION_RULES.roundPrice)
    // The budget caps the batch, and below a minimum batch nothing is queued.
    expect(rounds(queue(threatened(), 2, 20 + each * 6))).toBe(6)
    expect(queue(threatened(), 2, 20 + each * (AI_LINE.minBatch - 1))).toEqual([])
    // The treasury keeps its reserve.
    const poor = threatened()
    poor.nations.r1.resources.capital = 60 + each * 5
    expect(rounds(queue(poor))).toBe(5)
    poor.nations.r1.resources.capital = 40 + 20 + each * 2
    expect(queue(poor)).toEqual([])
    // Income in the red, or the bill past its share: nothing.
    const s = threatened()
    const econ = computeEconomy(s, map, 'r1')
    const out: Order[] = []
    queueInterceptorRounds(s, map, 'r1', { ...econ, netCapital: 5 }, 2, (o) => out.push(o) > 0, 1000)
    queueInterceptorRounds(s, map, 'r1', { ...econ, gross: 1 }, 2, (o) => out.push(o) > 0, 1000)
    expect(out).toEqual([])
  })

  it('switched off (or the line itself off, or the program off) nothing is queued', () => {
    MPROG.aiInterceptorLine = false
    expect(queue(threatened())).toEqual([])
    MPROG.aiInterceptorLine = true
    MPROG.interceptorLine = false
    expect(queue(threatened())).toEqual([])
    MPROG.interceptorLine = true
    MPROG.on = false
    expect(queue(threatened())).toEqual([])
  })

  it('the missile war AI does not also buy the rounds the line will make', () => {
    const s = threatened()
    s.nations.r0.arsenal = { cruise: 20 }
    const buys = (g: GameState) => missileWarOrders(g, map, 'r1', 2, createRng(1, 1), 'prepare').filter((o) => o.type === 'missileDefense' && o.item === 'interceptors')
    expect(buys(s)).toHaveLength(1)
    // The batch fills the whole store on the line: nothing left to buy outright.
    expect(applyOrderNow(s, map, queue(s)[0]).error).toBeNull()
    expect(roundsOnLine(s.nations.r1)).toBe(interceptorCap(s.nations.r1))
    expect(buys(s)).toEqual([])
    // Switched off, the old count (the store alone) stands, as before.
    MPROG.aiInterceptorLine = false
    expect(buys(s)).toHaveLength(1)
  })
})
