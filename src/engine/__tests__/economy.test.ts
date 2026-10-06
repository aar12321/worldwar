import { describe, expect, it } from 'vitest'
import { applyEconomy, computeEconomy } from '../economy'
import { createRng } from '../rng'
import { lineMap, startState } from './fixtures'

const map = lineMap(3)

describe('economy', () => {
  it('drafting civilians grows the military pool but cuts taxes and food', () => {
    const s = startState(map)
    const low = computeEconomy(s, map, 'r0')
    s.nations.r0.draftRate = 0.2
    const high = computeEconomy(s, map, 'r0')
    expect(high.militaryRegen).toBeGreaterThan(low.militaryRegen)
    expect(high.taxIncome).toBeLessThan(low.taxIncome)
    expect(high.foodProduction).toBeLessThan(low.foodProduction)
    expect(high.civilianManpower).toBeLessThan(low.civilianManpower)
  })

  it('higher taxes raise capital but lower the stability target', () => {
    const s = startState(map)
    s.nations.r0.taxRate = 0.2
    const base = computeEconomy(s, map, 'r0')
    s.nations.r0.taxRate = 0.5
    const taxed = computeEconomy(s, map, 'r0')
    expect(taxed.taxIncome).toBeGreaterThan(base.taxIncome)
    expect(taxed.stabilityTarget).toBeLessThan(base.stabilityTarget - 30)
  })

  it('running out of food triggers a shortage and drags stability down', () => {
    const s = startState(map)
    const n = s.nations.r0
    s.regions.r0.buildings.farm = 0
    n.resources.food = 0
    s.armies[Object.keys(s.armies).find((id) => s.armies[id].owner === 'r0')!].units.infantry = 200
    applyEconomy(s, map, 'r0', createRng(1))
    expect(n.foodShortage).toBe(true)
    expect(n.resources.food).toBe(0)
    const target = computeEconomy(s, map, 'r0').stabilityTarget
    n.foodShortage = false
    expect(computeEconomy(s, map, 'r0').stabilityTarget).toBeGreaterThan(target)
  })

  it('sabotaged factories produce nothing', () => {
    const s = startState(map)
    const before = computeEconomy(s, map, 'r0').factoryIncome
    s.regions.r0.sabotaged = 2
    expect(computeEconomy(s, map, 'r0').factoryIncome).toBe(0)
    expect(before).toBeGreaterThan(0)
  })
})
