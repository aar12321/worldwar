import { describe, expect, it } from 'vitest'
import { generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { computeEconomy } from '../economy'
import { validateOrder } from '../orders'
import { attackableRegions, canAttackRegion } from '../warfare'
import { checkOutcome, conquestGoal, countriesTaken } from '../victory'
import { lineMap, setMilitary, startState } from './fixtures'

describe('victory', () => {
  it('asks for 3, 6, or 12 countries', () => {
    expect(conquestGoal(0.25)).toBe(3)
    expect(conquestGoal(0.4)).toBe(6)
    expect(conquestGoal(0.6)).toBe(12)
  })

  it('wins by taking the asked-for countries, and loses when the nation is gone', () => {
    const map = lineMap(6)
    const s = startState(map, 'r0')
    s.settings.victoryShare = 0.25
    expect(checkOutcome(s)).toBe('playing')
    expect(countriesTaken(s)).toBe(0)

    s.regions.r1.owner = 'r0'
    s.regions.r2.owner = 'r0'
    for (const region of Object.values(s.regions)) region.population = region.owner === 'r0' ? 1 : 500
    expect(countriesTaken(s)).toBe(2)
    expect(checkOutcome(s)).toBe('playing')
    s.regions.r3.owner = 'r0'
    expect(checkOutcome(s)).toBe('victory')

    const lost = startState(map, 'r0')
    lost.nations.r0.alive = false
    expect(checkOutcome(lost)).toBe('defeat')
  })

  it('still wins by leading enough people', () => {
    const map = lineMap(2)
    const s = startState(map, 'r0')
    s.settings.victoryShare = 0.4
    s.regions.r0.population = 50
    s.regions.r1.population = 10
    expect(checkOutcome(s)).toBe('victory')
  })
})

describe('food and sea landings', () => {
  it('refuses training that the farms cannot feed', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.nations.r0.resources.food = 0
    s.nations.r0.foodShortage = true
    expect(validateOrder(s, map, { type: 'queueTrain', nationId: 'r0', unit: 'infantry' })).toMatch(/food/)
  })

  it('lets a port launch a sea invasion without Destroyers', () => {
    const map = lineMap(2)
    map.regions.r0.neighbors = []
    map.regions.r1.neighbors = []
    map.regions.r0.seaLanes = ['r1']
    map.regions.r1.seaLanes = ['r0']
    const s = startState(map)
    s.regions.r0.buildings.port = 1
    expect(canAttackRegion(s, map, 'r0', 'r1')).toEqual({ ok: true, bySea: true })
    s.regions.r0.buildings.port = 0
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(false)
  })

  it('lists a sea target only once there is a port', () => {
    const map = lineMap(2)
    map.regions.r0.neighbors = []
    map.regions.r1.neighbors = []
    map.regions.r0.seaLanes = ['r1']
    map.regions.r1.seaLanes = ['r0']
    const s = startState(map)
    s.wars = ['r0|r1']
    s.regions.r0.buildings.port = 0
    expect(attackableRegions(s, map, 'r0')).toEqual([])
    s.regions.r0.buildings.port = 1
    expect(attackableRegions(s, map, 'r0')).toEqual(['r1'])
  })

  it('starts a tiny country with food to spare', () => {
    const map = lineMap(1)
    map.regions.r0.basePopulation = 0.05
    map.regions.r0.development = 0.2
    const s = createInitialState(map, { playerRegionId: 'r0', seed: 1, victoryShare: 0.4 })
    expect(s.nations.r0.resources.food).toBeGreaterThanOrEqual(8)
    expect(computeEconomy(s, map, 'r0').netFood).toBeGreaterThanOrEqual(0.4)
  })
})

describe('rivals pick on the weak', () => {
  it('a strong expansionist declares war on a weak neighbor', () => {
    const map = lineMap(2)
    let wars = 0
    for (let seed = 1; seed <= 24; seed++) {
      const s = startState(map, 'r0', seed)
      s.turn = 22 + (seed % 4)
      s.nations.r1.personality = 'expansionist'
      s.nations.r1.aggression = 0.95
      s.settings.difficulty = 'normal'
      setMilitary(s, 'r1', { infantry: 30 })
      setMilitary(s, 'r0', { infantry: 1 })
      const orders = generateBotOrders(s, map, 'r1')
      if (orders.some((o) => o.type === 'declareWar' && o.target === 'r0')) wars++
    }
    expect(wars).toBeGreaterThan(0)
  })

  it('a starving rival builds a farm before it does anything else', () => {
    const map = lineMap(2)
    const s = startState(map, 'r0', 3)
    s.nations.r1.foodShortage = true
    s.nations.r1.resources.food = 0
    s.nations.r1.resources.capital = 80
    const orders = generateBotOrders(s, map, 'r1')
    expect(orders.some((o) => o.type === 'build' && o.building === 'farm')).toBe(true)
  })
})
