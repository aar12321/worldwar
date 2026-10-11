import { describe, expect, it } from 'vitest'
import { applyEconomy, computeEconomy } from '../economy'
import { normalizeGame } from '../migrate'
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

  it('higher taxes raise capital and only unsettle the country a little', () => {
    const s = startState(map)
    s.nations.r0.taxRate = 0.2
    const base = computeEconomy(s, map, 'r0')
    s.nations.r0.taxRate = 0.5
    const taxed = computeEconomy(s, map, 'r0')
    expect(taxed.taxIncome).toBeGreaterThan(base.taxIncome)
    expect(taxed.stabilityTarget).toBeLessThan(base.stabilityTarget)
    expect(base.stabilityTarget - taxed.stabilityTarget).toBeLessThan(15)
    expect(taxed.stabilityTarget).toBeGreaterThan(80)
  })

  it('influence grows quickly and stability stays high until a war lasts fifteen months', () => {
    const s = startState(map)
    expect(s.nations.r0.stability).toBeGreaterThanOrEqual(90)
    const peace = computeEconomy(s, map, 'r0')
    expect(peace.ppGain).toBeGreaterThan(8)
    expect(peace.stabilityTarget).toBeGreaterThanOrEqual(88)
    expect(peace.warMonths).toBe(0)

    s.wars = ['r0|r1']
    s.warStarted['r0|r1'] = s.turn
    s.nations.r0.warWeariness = 40
    expect(computeEconomy(s, map, 'r0').stabilityTarget).toBeGreaterThanOrEqual(85)

    s.turn = s.warStarted['r0|r1'] + 15
    const long = computeEconomy(s, map, 'r0')
    expect(long.warMonths).toBe(15)
    expect(long.stabilityTarget).toBeLessThan(55)

    s.turn = s.warStarted['r0|r1'] + 22
    expect(computeEconomy(s, map, 'r0').stabilityTarget).toBeLessThan(long.stabilityTarget)
  })

  it('weariness fades during a short war and builds after fifteen months', () => {
    const s = startState(map)
    const n = s.nations.r0
    s.wars = ['r0|r1']
    s.warStarted['r0|r1'] = 1
    n.warWeariness = 10
    applyEconomy(s, map, 'r0', createRng(1))
    expect(n.warWeariness).toBeLessThan(10)

    s.turn = 20
    n.warWeariness = 10
    applyEconomy(s, map, 'r0', createRng(1))
    expect(n.warWeariness).toBeGreaterThan(10)
  })

  it('a save from a short war is settled again', () => {
    const s = startState(map)
    s.nations.r0.stability = 40
    s.nations.r0.warWeariness = 30
    s.wars = ['r0|r1']
    s.warStarted['r0|r1'] = s.turn
    normalizeGame(s, map)
    expect(s.nations.r0.stability).toBeGreaterThanOrEqual(90)
    expect(s.nations.r0.warWeariness).toBe(0)

    s.turn = 30
    s.nations.r0.stability = 40
    s.nations.r0.warWeariness = 20
    normalizeGame(s, map)
    expect(s.nations.r0.stability).toBe(40)
    expect(s.nations.r0.warWeariness).toBe(20)
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
