import { describe, expect, it } from 'vitest'
import { planBulk } from '../bulk'
import { regionsOf } from '../helpers'
import { applyOrderNow } from '../resolveTurn'
import { lineMap, giveRegions, startState } from './fixtures'

const map = lineMap(6)
function empire() {
  const s = startState(map)
  giveRegions(s, 'r0', ['r1', 'r2', 'r3'])
  s.nations.r0.resources.capital = 10_000
  return s
}

describe('bulk upgrades', () => {
  it('upgrade one kind of building in every country, and match what really happens', () => {
    const s = empire()
    const plan = planBulk(s, map, 'r0', { target: 'farm', levels: 1, settledOnly: false, reserve: 0 })
    expect(plan.countries).toBe(4)
    expect(plan.upgrades).toBe(4)
    expect(plan.orders.every((o) => o.type === 'build' && o.building === 'farm')).toBe(true)
    const real = structuredClone(s)
    for (const o of plan.orders) expect(applyOrderNow(real, map, o).error).toBeNull()
    for (const id of regionsOf(real, 'r0')) expect(real.regions[id].buildings.farm).toBe(s.regions[id].buildings.farm + 1)
    expect(s.nations.r0.resources.capital - real.nations.r0.resources.capital).toBeCloseTo(plan.cost)
  })

  it('add several levels, one level everywhere before a second anywhere, lowest first', () => {
    const s = empire()
    s.regions.r0.buildings.factory = 3
    s.regions.r1.buildings.factory = 0
    const plan = planBulk(s, map, 'r0', { target: 'factory', levels: 2, settledOnly: false, reserve: 0 })
    expect(plan.upgrades).toBe(8)
    // The first round starts with the lowest country.
    expect(plan.orders[0]).toMatchObject({ regionId: 'r1' })
    const firstRound = plan.orders.slice(0, 4).map((o) => (o as { regionId: string }).regionId)
    expect(new Set(firstRound).size).toBe(4)
  })

  it('stop when the money runs out, keep the reserve, and say what was skipped', () => {
    const s = empire()
    s.nations.r0.resources.capital = 150
    const plan = planBulk(s, map, 'r0', { target: 'factory', levels: 3, settledOnly: false, reserve: 80 })
    expect(plan.cost).toBeLessThanOrEqual(150 - 80)
    expect(plan.skipped.noMoney).toBeGreaterThan(0)
    const none = planBulk(s, map, 'r0', { target: 'factory', levels: 1, settledOnly: false, reserve: 500 })
    expect(none.upgrades).toBe(0)
  })

  it('can skip countries still settling', () => {
    const s = empire()
    s.regions.r1.integration = 0.2
    const plan = planBulk(s, map, 'r0', { target: 'farm', levels: 1, settledOnly: true, reserve: 0 })
    expect(plan.orders.some((o) => (o as { regionId: string }).regionId === 'r1')).toBe(false)
    expect(plan.countries).toBe(3)
  })

  it('stop at each country\'s highest level instead of failing', () => {
    const s = empire()
    const plan = planBulk(s, map, 'r0', { target: 'port', levels: 10, settledOnly: false, reserve: 0 })
    // Non-coastal test countries cannot take a port at all: nothing to do, nothing broken.
    expect(plan.upgrades).toBe(0)
    const farms = planBulk(s, map, 'r0', { target: 'farm', levels: 10, settledOnly: false, reserve: 0 })
    expect(farms.skipped.atMax + farms.skipped.other + farms.skipped.noMoney).toBeGreaterThan(0)
    const real = structuredClone(s)
    for (const o of farms.orders) expect(applyOrderNow(real, map, o).error).toBeNull()
  })

  it('can grow every city, or a little of everything', () => {
    const s = empire()
    const cities = planBulk(s, map, 'r0', { target: 'cities', levels: 1, settledOnly: false, reserve: 0 })
    expect(cities.orders.every((o) => o.type === 'developCity')).toBe(true)
    const real = structuredClone(s)
    for (const o of cities.orders) expect(applyOrderNow(real, map, o).error).toBeNull()
    const all = planBulk(s, map, 'r0', { target: 'all', levels: 1, settledOnly: false, reserve: 0 })
    expect(new Set(all.orders.map((o) => (o as { building: string }).building)).size).toBeGreaterThan(2)
  })
})
