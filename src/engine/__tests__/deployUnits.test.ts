import { describe, expect, it } from 'vitest'
import { LIVE } from '../../data/live'
import { attackPool, cleanUnits, deployBill, remainder } from '../deploy'
import { totalUnits } from '../helpers'
import { startLive } from '../live'
import { validateOrder } from '../orders'
import { applyOrderNow, describeOrder, resolveTurn } from '../resolveTurn'
import type { Order, UnitCounts } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(6)
const send = (units: Partial<UnitCounts>, extra: Partial<Extract<Order, { type: 'attack' }>> = {}): Order => ({ type: 'attack', nationId: 'r0', target: 'r1', stance: 'assault', units, ...extra })

function war(live = false) {
  const s = live ? startLive(startState(map)) : startState(map)
  s.wars.push('r0|r1')
  s.nations.r0.resources.capital = 3000
  setMilitary(s, 'r0', { infantry: 20, armor: 8, artillery: 6, fighter: 4, air: 2, missile: 5 })
  setMilitary(s, 'r1', { infantry: 6 })
  return s
}

describe('an attack that names its units', () => {
  it('accepts a force that fits and rejects one that does not', () => {
    const s = war()
    expect(validateOrder(s, map, send({ infantry: 10, armor: 4 }))).toBeNull()
    expect(validateOrder(s, map, send({ infantry: 21 }))).toMatch(/only have 20 infantry/)
    expect(validateOrder(s, map, send({ naval: 1 }))).toMatch(/no warships/)
    expect(validateOrder(s, map, send({ infantry: -1 }))).toMatch(/positive/)
    expect(validateOrder(s, map, send({ infantry: Number.NaN }))).toMatch(/positive/)
    expect(validateOrder(s, map, send({}))).toMatch(/at least/)
    expect(validateOrder(s, map, send({ infantry: 0.2 }))).toMatch(/at least/)
    expect(validateOrder(s, map, send({ missile: 2 } as Partial<UnitCounts>))).toMatch(/Missiles are fired separately/)
  })

  it('cannot send units that stand on station', () => {
    const s = war()
    s.nations.r0.military.deployment = { coastal: 0, subs: 0, air: 1, border: {}, changed: 0 }
    // All the fighters and strike aircraft are on air patrol.
    expect(attackPool(s, 'r0').fighter).toBe(0)
    expect(validateOrder(s, map, send({ fighter: 1 }))).toMatch(/no fighters free/)
    expect(validateOrder(s, map, send({ infantry: 5 }))).toBeNull()
  })

  it('counts what queued orders have already spoken for', () => {
    const s = war()
    const first = send({ infantry: 15 })
    expect(validateOrder(s, map, send({ infantry: 10 }), [first])).toMatch(/only have 5 infantry/)
    expect(validateOrder(s, map, send({ infantry: 5 }), [first])).toBeNull()
    // A share-based order takes its share of everyone.
    expect(attackPool(s, 'r0', [{ type: 'attack', nationId: 'r0', target: 'r1', share: 0.5 }]).infantry).toBe(10)
  })

  it('fights with exactly the named units and nothing else', () => {
    const s = war()
    const out = applyOrderNow(s, map, send({ infantry: 7, armor: 3 }, { missiles: 2 }))
    expect(out.error).toBeNull()
    const b = out.battle!
    expect(b.attacker.units.infantry).toBeCloseTo(7)
    expect(b.attacker.units.armor).toBeCloseTo(3)
    expect(b.attacker.units.artillery).toBe(0)
    expect(b.attacker.units.fighter).toBe(0)
    expect(b.attacker.units.missile).toBe(2)
    expect(b.chosen).toBe(true)
    // Losses come only out of what was sent.
    const left = s.nations.r0.military.units
    expect(left.artillery).toBe(6)
    expect(left.fighter).toBe(4)
  })

  it('a named unit is spent for the month; the rest can still go', () => {
    const s = war()
    expect(applyOrderNow(s, map, send({ infantry: 12 })).error).toBeNull()
    const pool = attackPool(s, 'r0')
    expect(pool.infantry).toBeLessThanOrEqual(8.1)
    expect(applyOrderNow(s, map, send({ infantry: 12 })).error).toMatch(/only have/)
    expect(s.nations.r0.military.sent?.infantry).toBeCloseTo(12)
    // The month ends and they are free again.
    const next = resolveTurn(s, map, [])
    expect(next.nations.r0.military.sent).toBeUndefined()
  })

  it('does not change an order that does not name units (no field is added)', () => {
    const s = war()
    applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault' })
    expect(s.nations.r0.military.sent).toBeUndefined()
    expect('sent' in s.nations.r0.military).toBe(false)
  })

  it('a live army carries exactly those units, and a home guard stays', () => {
    const s = war(true)
    const before = totalUnits(s.nations.r0.military.units)
    const out = applyOrderNow(s, map, send({ infantry: 5, armor: 2, fighter: 1 }))
    expect(out.army).toBeTruthy()
    expect(out.army!.units.infantry).toBeCloseTo(5)
    expect(out.army!.units.armor).toBeCloseTo(2)
    expect(out.army!.units.fighter).toBeCloseTo(1)
    expect(out.army!.units.artillery).toBe(0)
    expect(out.army!.chosen).toBe(true)
    expect(totalUnits(s.nations.r0.military.units)).toBeCloseTo(before - 8)
    // Asking for everything is held to the guard.
    const all = war(true)
    expect(validateOrder(all, map, send({ infantry: 20 }))).toMatch(/only have 18 infantry/)
    expect(attackPool(all, 'r0', [], true).infantry).toBeCloseTo(20 * (1 - LIVE.homeGuard))
  })

  it('is described in words and has a bill', () => {
    const s = war()
    expect(describeOrder(s, map, send({ infantry: 7, armor: 3 }))).toBe('Attack Region 1 with 7 infantry, 3 tanks')
    const bill = deployBill(cleanUnits({ infantry: 10, armor: 4 }))
    expect(bill.upkeep).toBeCloseTo(10 * 0.6 + 4 * 1.4)
    expect(bill.oil).toBeCloseTo(4 * 0.15)
    expect(remainder(s, 'r0', cleanUnits({ infantry: 5 })).infantry).toBe(15)
  })

  it('is deterministic: the same order on the same state gives the same battle', () => {
    const a = applyOrderNow(war(), map, send({ infantry: 9, artillery: 3 })).battle!
    const b = applyOrderNow(war(), map, send({ infantry: 9, artillery: 3 })).battle!
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
