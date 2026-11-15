import { describe, expect, it } from 'vitest'
import { LIVE } from '../../data/live'
import { totalUnits } from '../helpers'
import { startLive } from '../live'
import { validateOrder } from '../orders'
import { applyOrderNow } from '../resolveTurn'
import { commitShare, forecastAttack } from '../warfare'
import type { Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(6)
const attack = (share?: number): Order => ({ type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault', ...(share !== undefined ? { share } : {}) })

function war(live = false) {
  const s = live ? startLive(startState(map)) : startState(map)
  s.wars.push('r0|r1')
  s.nations.r0.resources.capital = 3000
  setMilitary(s, 'r0', { infantry: 40 })
  setMilitary(s, 'r1', { infantry: 6 })
  return s
}

describe('choosing how much of the military to send', () => {
  it('a chosen share replaces the preset, and cannot exceed what is left at home', () => {
    const s = war()
    expect(commitShare(s.nations.r0, 'main', 0.2)).toBeCloseTo(0.2)
    expect(commitShare(s.nations.r0, 'main')).toBeCloseTo(0.66)
    s.nations.r0.military.exposed = 0.9
    expect(commitShare(s.nations.r0, 'main', 0.5)).toBeCloseTo(0.1)
  })

  it('rejects a share outside 5% to 100%', () => {
    const s = war()
    for (const bad of [0, 0.01, 1.2, -1, Number.NaN]) expect(validateOrder(s, map, attack(bad))).toMatch(/5% and 100%/)
    expect(validateOrder(s, map, attack(0.3))).toBeNull()
  })

  it('the forecast and the fight use the chosen share', () => {
    const s = war()
    const small = forecastAttack(s, map, 'r0', 'r1', 'main', 'assault', 8, undefined, 0.1)!
    const big = forecastAttack(s, map, 'r0', 'r1', 'main', 'assault', 8, undefined, 0.9)!
    expect(small.share).toBeCloseTo(0.1)
    expect(big.share).toBeCloseTo(0.9)
    expect(big.winChance).toBeGreaterThanOrEqual(small.winChance)
    const result = applyOrderNow(s, map, attack(0.25))
    expect(result.battle).toBeTruthy()
    expect(result.battle!.modifiers.join(' ')).toMatch(/a chosen force \(25% of the military\)/)
  })

  it('a live army takes exactly that share with it, and a guard stays home', () => {
    const s = war(true)
    const before = totalUnits(s.nations.r0.military.units)
    const out = applyOrderNow(s, map, attack(0.25))
    expect(out.army).toBeTruthy()
    expect(totalUnits(out.army!.units) / before).toBeCloseTo(0.25, 1)
    const all = war(true)
    const full = applyOrderNow(all, map, attack(1))
    expect(totalUnits(full.army!.units) / before).toBeCloseTo(1 - LIVE.homeGuard, 1)
  })
})
