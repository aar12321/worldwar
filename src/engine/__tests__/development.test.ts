import { describe, expect, it } from 'vitest'
import { UPGRADE_SPECS } from '../../data/development'
import { territoryCount } from '../../data/territories'
import { UNIT_SPECS } from '../../data/unitTypes'
import { getWorld } from '../../map/world'
import { developmentBonus, populationGrowth } from '../development'
import { computeEconomy } from '../economy'
import { validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import { lineMap, startState } from './fixtures'

const P = 'r0'

describe('territories', () => {
  it('gives small countries one territory and large countries at most eight', () => {
    expect(territoryCount(0.4, 0.0002)).toBe(1)
    expect(territoryCount(9, 0.0002)).toBe(2)
    expect(territoryCount(400, 0.01)).toBe(8)
    expect(territoryCount(1, 0.2)).toBe(8)

    const world = getWorld().map
    const counts = world.order.map((id) => world.territoriesByRegion[id]?.length ?? 0)
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...counts)).toBeLessThanOrEqual(8)
    expect(world.territoriesByRegion.fiji).toHaveLength(1)
    expect(world.territoriesByRegion.luxembourg).toHaveLength(1)
    const america = world.territoriesByRegion['united-states-of-america']
    const russia = world.territoriesByRegion.russia
    expect(america.length).toBeGreaterThanOrEqual(6)
    expect(america.length).toBeLessThanOrEqual(8)
    expect(russia.length).toBeGreaterThan(world.territoriesByRegion.luxembourg.length)
    expect(world.territories[america[0]].name).toBe('The Heartland')
    expect(new Set(america.map((id) => world.territories[id].name)).size).toBe(america.length)
  })
})

describe('territory development', () => {
  const map = lineMap(1)

  it('pays for works and leaves untouched land unchanged', () => {
    const s = startState(map)
    s.nations[P].resources.capital = 500
    expect(populationGrowth(false, 0, 1)).toBe(1.0008)
    const next = resolveTurn(s, map, [{ type: 'develop', nationId: P, territoryId: 'r0:0', upgrade: 'works' }])
    expect(next.territoryDev['r0:0'].works).toBe(1)
    expect(developmentBonus(next, map, P).capital).toBeCloseTo(UPGRADE_SPECS.works.capital)
    const bare = structuredClone(next)
    bare.territoryDev = {}
    const bonus = computeEconomy(next, map, P).netCapital - computeEconomy(bare, map, P).netCapital
    expect(bonus).toBeCloseTo(UPGRADE_SPECS.works.capital - 0.3)
    expect(validateOrder(next, map, { type: 'develop', nationId: P, territoryId: 'r0:0', upgrade: 'works' })).toBeNull()
  })

  it('refuses a fourth level', () => {
    const s = startState(map)
    s.nations[P].resources.capital = 5000
    s.territoryDev['r0:0'] = { housing: 0, works: 3, granary: 0, roads: 0, civic: 0 }
    expect(validateOrder(s, map, { type: 'develop', nationId: P, territoryId: 'r0:0', upgrade: 'works' })).toMatch(/fully developed/)
  })
})

describe('military training queue', () => {
  const map = lineMap(2)

  it('delivers infantry after one month and armor after two, into the army that fights', () => {
    const s = startState(map)
    s.nations[P].resources.capital = 800
    s.nations[P].militaryPool = 80
    const army = Object.values(s.armies).find((item) => item.owner === P)!
    const infantry = army.units.infantry
    const armor = army.units.armor

    const queued = resolveTurn(s, map, [{ type: 'queueTrain', nationId: P, territoryId: 'r0:0', unit: 'infantry' }])
    expect(queued.trainingQueue).toHaveLength(1)
    expect(queued.armies[army.id].units.infantry).toBe(infantry)

    const ready = resolveTurn(queued, map, [])
    expect(ready.trainingQueue).toHaveLength(0)
    expect(ready.armies[army.id].units.infantry).toBe(infantry + 1)

    const tanks = resolveTurn(ready, map, [{ type: 'queueTrain', nationId: P, territoryId: 'r0:0', unit: 'armor' }])
    expect(tanks.armies[army.id].units.armor).toBe(armor)
    expect(tanks.trainingQueue[0].remaining).toBe(2)
    const midway = resolveTurn(tanks, map, [])
    expect(midway.trainingQueue[0].remaining).toBe(1)
    expect(midway.armies[army.id].units.armor).toBe(armor)
    midway.wars = [...midway.wars, 'r0|r1']
    const struck = resolveTurn(midway, map, [{ type: 'attack', nationId: P, armyId: army.id, target: 'r1' }])
    expect(struck.trainingQueue).toHaveLength(0)
    expect(struck.battles[0]?.attacker.units.armor).toBeGreaterThanOrEqual(armor + 1)
  })

  it('refunds a queued unit that has not started finishing', () => {
    const s = startState(map)
    s.nations[P].resources.capital = 800
    s.nations[P].militaryPool = 80
    const queued = resolveTurn(s, map, [{ type: 'queueTrain', nationId: P, territoryId: 'r0:0', unit: 'armor' }])
    const job = queued.trainingQueue[0]
    expect(job.remaining).toBe(job.total)
    const idle = resolveTurn(structuredClone(queued), map, [])
    const cancelled = resolveTurn(structuredClone(queued), map, [{ type: 'cancelTrain', nationId: P, jobId: job.id }])
    expect(cancelled.trainingQueue).toHaveLength(0)
    expect(cancelled.nations[P].resources.capital - idle.nations[P].resources.capital).toBeCloseTo(UNIT_SPECS.armor.capitalCost)
    expect(cancelled.nations[P].militaryPool - idle.nations[P].militaryPool).toBeCloseTo(UNIT_SPECS.armor.manpowerCost)
  })
})
