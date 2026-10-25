import { describe, expect, it } from 'vitest'
import { indexTerritories } from '../../data/territories'
import { applyEventChoice } from '../events'
import { applyImmediate } from '../realtime'
import { resolveTurn } from '../resolveTurn'
import { validateOrder } from '../orders'
import { territoryOwner } from '../territory'
import { addUnitAtTerritory } from '../training'
import { checkOutcome } from '../victory'
import { garrisonStrength } from '../warfare'
import { lineMap, startState } from './fixtures'
import type { GameState, Territory, WorldMap } from '../types'

/** A line of three countries where `regionId` has `count` territories. */
function mapWith(regionId: string, count: number): WorldMap {
  const map = lineMap(3)
  const region = map.regions[regionId]
  const sites: Territory[] = Array.from({ length: count }, (_, i) => ({
    id: `${regionId}:${i}`,
    regionId,
    name: `${regionId} site ${i}`,
    lat: region.lat + i * 3,
    lng: region.lng,
    index: i,
  }))
  const indexed = indexTerritories([...Object.values(map.territories).filter((t) => t.regionId !== regionId), ...sites])
  return { ...map, ...indexed }
}

function strongArmy(s: GameState, owner: string) {
  const army = Object.values(s.armies).find((a) => a.owner === owner)!
  army.units = { infantry: 60, armor: 12, air: 6, naval: 0 }
  for (const a of Object.values(s.armies)) if (a.owner !== owner) a.units = { infantry: 1, armor: 0, air: 0, naval: 0 }
  return army
}

describe('capture rules', () => {
  it('lets a country retake a territory an enemy holds inside it', () => {
    const map = mapWith('r0', 3)
    const s = startState(map)
    s.wars = ['r0|r1']
    s.territoryOwners = { 'r0:1': 'r1' }
    const army = strongArmy(s, 'r0')
    const order = { type: 'attack' as const, nationId: 'r0', armyId: army.id, target: 'r0', territoryId: 'r0:1' }
    expect(validateOrder(s, map, order)).toBeNull()

    const next = resolveTurn(s, map, [order])

    expect(territoryOwner(next, map, 'r0:1')).toBe('r0')
    expect(next.territoryOwners?.['r0:1']).toBeUndefined()
    expect(next.regions.r0.owner).toBe('r0')
  })

  it('still refuses to attack your own country when nothing is held or rebelling', () => {
    const map = mapWith('r0', 2)
    const s = startState(map)
    const army = strongArmy(s, 'r0')
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r0', armyId: army.id, target: 'r0' })).toBe('Region is already yours')
  })

  it('never takes land from a nation you are not at war with', () => {
    const map = mapWith('r1', 3)
    const s = startState(map)
    s.wars = ['r0|r1']
    s.territoryOwners = { 'r1:1': 'r2' }
    const army = strongArmy(s, 'r0')

    const next = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1', territoryId: 'r1:1' }])

    expect(territoryOwner(next, map, 'r1:1')).toBe('r2')
  })

  it('leaves a third nation its territory when the country around it falls', () => {
    const map = mapWith('r1', 2)
    const s = startState(map)
    s.wars = ['r0|r1']
    s.territoryOwners = { 'r1:1': 'r2' }
    const army = strongArmy(s, 'r0')

    const next = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1', territoryId: 'r1:0' }])

    expect(next.regions.r1.owner).toBe('r0')
    expect(territoryOwner(next, map, 'r1:0')).toBe('r0')
    expect(territoryOwner(next, map, 'r1:1')).toBe('r2')
  })
})

describe('garrisons', () => {
  it('give every territory its own defenders, with the capital bonus in the first one', () => {
    const map = mapWith('r0', 4)
    const s = startState(map)
    const first = garrisonStrength(s, map, 'r0', 'r0:0')
    const second = garrisonStrength(s, map, 'r0', 'r0:1')
    expect(second).toBeGreaterThanOrEqual(1)
    expect(first - second).toBeCloseTo(1, 5)
  })
})

describe('recruits', () => {
  it('pull the drill rank of their army down', () => {
    const map = lineMap(2)
    const s = startState(map)
    const army = addUnitAtTerritory(s, map, 'r0', 'r0:0', 'infantry')!
    army.units.infantry = 4
    army.training.infantry = 4
    addUnitAtTerritory(s, map, 'r0', 'r0:0', 'infantry')
    expect(army.units.infantry).toBe(5)
    expect(army.training.infantry).toBe(3)
  })
})

describe('decision events', () => {
  it('never leave you in debt', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.nations.r0.resources.capital = 3
    s.pendingEvent = { eventId: 'bread_riot', turn: 1, rivalId: null, regionId: null }
    const next = applyEventChoice(s, map, 0)
    expect(next.nations.r0.resources.capital).toBeGreaterThanOrEqual(0)
  })
})

describe('defeat', () => {
  function capitalFallen(): GameState {
    const map = lineMap(3)
    const s = startState(map)
    s.regions.r0.owner = 'r1'
    s.regions.r2.owner = 'r0'
    for (const a of Object.values(s.armies)) if (a.owner === 'r0') delete s.armies[a.id]
    s.nations.r0.resources.capital = 0
    return s
  }
  it('comes when the capital is lost and nothing is left to fight with', () => {
    expect(checkOutcome(capitalFallen())).toBe('defeat')
  })
  it('waits while you can still raise an army', () => {
    const s = capitalFallen()
    s.nations.r0.resources.capital = 100
    expect(checkOutcome(s)).toBe('playing')
  })
})

describe('entrenchment', () => {
  it('is lost the moment an army marches out', () => {
    const map = mapWith('r1', 2)
    const s = startState(map)
    s.wars = ['r0|r1']
    const army = strongArmy(s, 'r0')
    army.entrenched = 3
    const result = applyImmediate(s, map, { type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1' })
    expect(result.error).toBeNull()
    expect(result.state.armies[army.id].entrenched).toBe(0)
  })
})
