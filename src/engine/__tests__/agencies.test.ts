import { describe, expect, it } from 'vitest'
import { AGENCY, agencyName } from '../../data/agencies'
import { agencyUpkeep, operationOdds, runOperation } from '../agencies'
import { justificationOf } from '../helpers'
import { orderCost, validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import { lineMap, startState } from './fixtures'

const map = lineMap(6)
function setup() {
  const s = startState(map)
  s.nations.r0.agencies.foreign.level = 4
  s.nations.r0.agencies.domestic.level = 2
  s.nations.r0.resources.capital = 500
  s.nations.r0.resources.pp = 100
  s.nations.r1.agencies.domestic.level = 0
  return s
}
const op = (o: string, target = 'r1') => ({ type: 'operation', nationId: 'r0', op: o, target }) as never

describe('agencies', () => {
  it('the United States has the CIA and the FBI, others plain names', () => {
    expect(agencyName('United States of America', 'foreign')).toBe('CIA')
    expect(agencyName('United States of America', 'domestic')).toBe('FBI')
    expect(agencyName('Chad', 'foreign')).toBe('Intelligence Service')
  })

  it('cost money every month by level', () => {
    const s = setup()
    expect(agencyUpkeep(s.nations.r0)).toBeCloseTo(6 * AGENCY.upkeepPerLevel)
  })

  it('odds come from level, experience, tech, partners and the target\'s security', () => {
    const s = setup()
    const base = operationOdds(s, 'r0', 'intel', 'r1').chance
    s.nations.r0.agencies.foreign.exp = 20
    expect(operationOdds(s, 'r0', 'intel', 'r1').chance).toBeGreaterThan(base)
    s.alliances.push('r0|r2')
    const withPartner = operationOdds(s, 'r0', 'intel', 'r1').chance
    expect(withPartner).toBeGreaterThan(base)
    s.nations.r1.agencies.domestic.level = 4
    expect(operationOdds(s, 'r0', 'intel', 'r1').chance).toBeLessThan(withPartner)
    s.nations.r1.secureUntil = s.turn + 5
    expect(operationOdds(s, 'r0', 'intel', 'r1').parts.some((p) => p.label === 'Hunting our agents')).toBe(true)
  })

  it('operations need the agency level, and a team for each', () => {
    const s = setup()
    s.nations.r0.agencies.foreign.level = 1
    expect(validateOrder(s, map, op('sabotage'))).toMatch(/level 2/)
    expect(validateOrder(s, map, op('intel'))).toBeNull()
    expect(validateOrder(s, map, op('case'), [op('intel', 'r2')])).toMatch(/busy/)
    s.nations.r0.agencies.foreign.level = 4
    expect(validateOrder(s, map, op('cyber'))).toMatch(/Needs/)
    expect(validateOrder(s, map, op('coup'))).toMatch(/too stable/)
  })

  it('intelligence opens their numbers for a year', () => {
    const s = setup()
    runOperation(s, map, 'r0', 'intel', 'r1', { chance: () => true } as never)
    expect(s.intel['r0|r1']).toBe(s.turn + AGENCY.intelMonths)
  })

  it('a built case gives a named reason for war', () => {
    const s = setup()
    runOperation(s, map, 'r0', 'case', 'r1', { chance: () => true, int: () => 0 } as never)
    expect(justificationOf(s, 'r0', 'r1')?.reason).toBe('Evidence of plotting')
  })

  it('a failed, noticed operation costs reputation and hands them a reason to fight', () => {
    const s = setup()
    let n = 0
    // First roll (success) fails, second (caught) succeeds.
    runOperation(s, map, 'r0', 'sabotage', 'r1', { chance: () => n++ === 1 } as never)
    expect(s.infamy.r0).toBeGreaterThan(0)
    expect(justificationOf(s, 'r1', 'r0')?.reason).toBe('Caught agents')
  })

  it('a coup on a shaky nation makes it a puppet and shames the sponsor', () => {
    const s = setup()
    s.nations.r1.stability = 30
    expect(validateOrder(s, map, op('coup'))).toBeNull()
    runOperation(s, map, 'r0', 'coup', 'r1', { chance: () => true, int: () => 0 } as never)
    expect(s.nations.r1.overlord).toBe('r0')
    expect(s.infamy.r0).toBeGreaterThan(10)
  })

  it('rebels can be armed abroad and broken up at home', () => {
    const s = setup()
    runOperation(s, map, 'r0', 'rebels', 'r1', { chance: () => true, int: () => 0 } as never)
    expect(s.regions.r1.rebels).toBeGreaterThan(0)
    s.regions.r0.rebels = 3
    const next = resolveTurn(s, map, [{ type: 'domestic', nationId: 'r0', op: 'crackdown', regionId: 'r0' }])
    expect(next.regions.r0.rebels).toBeLessThan(3)
  })

  it('the month-end order charges its cost once and the agency can be grown', () => {
    const s = setup()
    const order = { type: 'domestic', nationId: 'r0', op: 'calm' } as const
    expect(orderCost(s, order).capital).toBe(20)
    s.nations.r0.stability = 50
    expect(resolveTurn(s, map, [order]).nations.r0.stability).toBeGreaterThan(s.nations.r0.stability)
    const grow = { type: 'fundAgency', nationId: 'r0', agency: 'foreign' } as const
    expect(validateOrder(s, map, grow)).toBeNull()
    expect(resolveTurn(s, map, [grow]).nations.r0.agencies.foreign.level).toBe(5)
    s.nations.r0.agencies.foreign.level = 5
    expect(validateOrder(s, map, grow)).toMatch(/highest/)
  })

  it('stealing copies a technology you could learn', () => {
    const s = setup()
    s.nations.r1.techs = ['eco_schools', 'eco_banking', 'eco_exchanges', 'eco_mass_production']
    s.nations.r0.techs = ['eco_banking']
    runOperation(s, map, 'r0', 'steal', 'r1', { chance: () => true, int: () => 0 } as never)
    expect(s.nations.r0.techs).toContain('eco_exchanges')
  })
})
