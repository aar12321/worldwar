import { describe, expect, it } from 'vitest'
import { REACH } from '../../data/war'
import { validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import { canAttackRegion, distanceKm, reachProblem } from '../warfare'
import { lineMap, setMilitary, startState } from './fixtures'

/** Two countries on opposite sides of an ocean: no border, no sea lane. */
function oceanWorld(km: number) {
  const map = lineMap(2)
  map.regions.r0.neighbors = []
  map.regions.r1.neighbors = []
  map.regions.r0.coastal = true
  map.regions.r1.coastal = true
  map.regions.r0.lat = 0
  map.regions.r0.lng = 0
  map.regions.r1.lat = 0
  map.regions.r1.lng = (km / 111.19)
  const s = startState(map)
  s.wars.push('r0|r1')
  setMilitary(s, 'r0', { infantry: 30 })
  s.regions.r0.buildings.port = 0
  s.regions.r0.buildings.factory = 0
  return { map, s }
}

describe('reaching far countries', () => {
  it('measures distance on the globe', () => {
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 90 })).toBeCloseTo(10008, -2)
  })

  it('a distant country is out of reach with only infantry, and the reason says what to build', () => {
    const { map, s } = oceanWorld(7000)
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(false)
    const why = validateOrder(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })
    expect(why).toMatch(/port and train warships/)
    expect(why).toMatch(/fighters or strike aircraft/)
    expect(reachProblem(s, map, 'r0', 'r1')).toMatch(/Out of reach/)
  })

  it('a port and warships carry an assault across the open ocean to a distant coast', () => {
    const { map, s } = oceanWorld(7000)
    s.regions.r0.buildings.port = 1
    setMilitary(s, 'r0', { infantry: 30, naval: 2 })
    expect(canAttackRegion(s, map, 'r0', 'r1')).toMatchObject({ ok: true, bySea: true, via: 'fleet' })
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })).toBeNull()
  })

  it('a port alone is not enough, and neither are warships without a port', () => {
    const { map, s } = oceanWorld(7000)
    s.regions.r0.buildings.port = 1
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(false)
    s.regions.r0.buildings.port = 0
    setMilitary(s, 'r0', { infantry: 30, naval: 2 })
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(false)
  })

  it('ships cannot reach an inland country, but can reach any coast in the world', () => {
    const { map, s } = oceanWorld(7000)
    s.regions.r0.buildings.port = 1
    setMilitary(s, 'r0', { infantry: 30, naval: 2 })
    map.regions.r1.coastal = false
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(false)
    expect(reachProblem(s, map, 'r0', 'r1')).toMatch(/inland/)
    map.regions.r1.coastal = true
    map.regions.r1.lng = 170
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(true)
  })

  it('fighters or strike aircraft and a factory for an airbase reach any country in air range, inland or not', () => {
    const { map, s } = oceanWorld(4000)
    map.regions.r1.coastal = false
    setMilitary(s, 'r0', { infantry: 30, fighter: 2 })
    s.regions.r0.buildings.factory = 1
    expect(canAttackRegion(s, map, 'r0', 'r1')).toMatchObject({ ok: true, bySea: true, via: 'air' })
    s.regions.r0.buildings.factory = 0
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(false)
    s.regions.r0.buildings.factory = 1
    setMilitary(s, 'r0', { infantry: 30, air: 1 })
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(true)
    map.regions.r1.lng = (REACH.airKm + 1000) / 111.19
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(false)
  })

  it('a land border and a short sea lane still work as before', () => {
    const map = lineMap(3)
    const s = startState(map)
    s.wars.push('r0|r1')
    expect(canAttackRegion(s, map, 'r0', 'r1')).toMatchObject({ ok: true, bySea: false, via: 'land' })
  })
})

describe('a distant attack really plays out', () => {
  it('resolves with the amphibious penalty and can take the country', () => {
    const { map, s } = oceanWorld(7000)
    s.regions.r0.buildings.port = 1
    setMilitary(s, 'r0', { infantry: 60, naval: 2 })
    setMilitary(s, 'r1', { infantry: 1 })
    const order = { type: 'attack', nationId: 'r0', target: 'r1' } as const
    const next = resolveTurn(s, map, [order])
    const battle = next.battles.find((b) => b.regionId === 'r1')
    expect(battle).toBeTruthy()
    expect(battle!.attacker.nationId).toBe('r0')
    expect(battle!.modifiers.some((m) => /amphibious/i.test(m))).toBe(true)
  })
})
