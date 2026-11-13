import { describe, expect, it } from 'vitest'
import { TECHS, TECH_BY_ID } from '../../data/techTree'
import { TRAITS, traitOf } from '../../data/traits'
import { operationOdds } from '../agencies'
import { computeEconomy } from '../economy'
import { governorOrders } from '../governors'
import { nationModifiers } from '../helpers'
import { validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import { killNation } from '../warfare'
import { lineMap, startState } from './fixtures'

const map = lineMap(6)

describe('frontier technology', () => {
  it('has a branch of milestone technologies that chain from the first', () => {
    const frontier = TECHS.filter((t) => t.branch === 'frontier')
    expect(frontier.length).toBeGreaterThanOrEqual(8)
    for (const t of frontier) for (const r of t.requires) expect(TECH_BY_ID[r], `${t.id} needs ${r}`).toBeTruthy()
    expect(frontier.some((t) => t.id === 'cyber_warfare')).toBe(true)
    expect(frontier.some((t) => t.id === 'frontier_nano')).toBe(true)
  })

  it('milestones improve agency odds, and cyber warfare unlocks the cyber attack', () => {
    const s = startState(map)
    s.nations.r0.agencies.foreign.level = 4
    s.nations.r0.resources.capital = 500
    const base = operationOdds(s, 'r0', 'intel', 'r1').chance
    expect(validateOrder(s, map, { type: 'operation', nationId: 'r0', op: 'cyber', target: 'r1' })).toMatch(/Needs/)
    s.nations.r0.techs.push('frontier_drones', 'cyber_warfare', 'frontier_ai')
    expect(nationModifiers(s.nations.r0).agencyBonus).toBeCloseTo(0.05)
    expect(operationOdds(s, 'r0', 'intel', 'r1').chance).toBeGreaterThan(base)
    expect(validateOrder(s, map, { type: 'operation', nationId: 'r0', op: 'cyber', target: 'r1' })).toBeNull()
  })

  it('nanotechnology raises output and calm', () => {
    const s = startState(map)
    const before = computeEconomy(s, map, 'r0')
    s.nations.r0.techs.push('frontier_nano')
    const after = computeEconomy(s, map, 'r0')
    expect(after.stabilityTarget).toBeGreaterThan(before.stabilityTarget)
    expect(after.netCapital).toBeGreaterThan(before.netCapital)
  })
})

describe('unique countries', () => {
  it('every country has a trait, and the well-known ones are hand-picked', () => {
    expect(traitOf('taiwan')).toBe('chips')
    expect(traitOf('saudi-arabia')).toBe('energy')
    expect(traitOf('some-place', { id: 'x', name: 'x', lat: 0, lng: 0, area: 1, terrain: 'mountain', coastal: false, neighbors: [], seaLanes: [], basePopulation: 3, development: 0.3 })).toBe('fortress')
    for (const t of Object.values(TRAITS)) expect(t.blurb.length).toBeGreaterThan(10)
  })

  it('holding a country with a trait helps the whole nation, and more once it has settled', () => {
    const s = startState(map)
    const before = computeEconomy(s, map, 'r0')
    s.regions.r1.owner = 'r0'
    s.regions.r1.integration = 0
    s.nations.r1.alive = false
    const settling = computeEconomy(s, map, 'r0').netCapital
    s.regions.r1.integration = 1
    const settled = computeEconomy(s, map, 'r0').netCapital
    expect(settled).toBeGreaterThan(settling)
    expect(settled).toBeGreaterThan(before.netCapital)
  })

  it('a conquered nation\'s treasury and a technology it knew pass to its conqueror', () => {
    const s = startState(map)
    s.nations.r1.resources.capital = 200
    s.nations.r1.techs = ['eco_banking']
    s.nations.r0.techs = []
    const before = s.nations.r0.resources.capital
    killNation(s, 'r1', 'r0')
    expect(s.nations.r0.resources.capital).toBeGreaterThan(before + 70)
    expect(s.nations.r0.techs).toContain('eco_banking')
  })
})

describe('governors', () => {
  it('upgrade a country each month, within the money kept in reserve', () => {
    const s = startState(map)
    s.regions.r0.governor = 'industry'
    s.nations.r0.resources.capital = 500
    const orders = governorOrders(s, map)
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ type: 'build', building: 'factory', regionId: 'r0' })
    const next = resolveTurn(s, map, [])
    expect(next.regions.r0.buildings.factory).toBe(s.regions.r0.buildings.factory + 1)
    s.nations.r0.resources.capital = 90
    expect(governorOrders(s, map)).toHaveLength(0)
  })

  it('are set at once, and only for your own countries', () => {
    const s = startState(map)
    expect(validateOrder(s, map, { type: 'setGovernor', nationId: 'r0', regionId: 'r0', governor: 'farming' })).toBeNull()
    expect(validateOrder(s, map, { type: 'setGovernor', nationId: 'r0', regionId: 'r1', governor: 'farming' })).toMatch(/do not control/)
  })
})
