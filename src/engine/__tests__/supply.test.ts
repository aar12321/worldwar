import { describe, expect, it } from 'vitest'
import { applySupply, suppliedRegions, SUPPLY } from '../supply'
import { giveRegions, lineMap, startState } from './fixtures'

describe('supply lines', () => {
  const map = lineMap(8)

  it('supply reaches only a limited distance from the capital', () => {
    const s = startState(map)
    giveRegions(s, 'r0', ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
    const supplied = suppliedRegions(s, map, 'r0')
    expect(supplied.has(`r${SUPPLY.baseRange}`)).toBe(true)
    expect(supplied.has(`r${SUPPLY.baseRange + 1}`)).toBe(false)
  })

  it('railways extend supply range', () => {
    const s = startState(map)
    giveRegions(s, 'r0', ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
    s.nations.r0.techs.push('infra_farming', 'infra_railways')
    expect(suppliedRegions(s, map, 'r0').has(`r${SUPPLY.baseRange + 1}`)).toBe(true)
  })

  it('territory cut off from the capital is unsupplied', () => {
    const s = startState(map)
    giveRegions(s, 'r0', ['r1', 'r3'])
    expect(suppliedRegions(s, map, 'r0').has('r3')).toBe(false)
  })

  it('armies out of supply wither and surrender after 3 months', () => {
    const s = startState(map)
    giveRegions(s, 'r0', ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
    const army = Object.values(s.armies).find((a) => a.owner === 'r0')!
    army.location = 'r7'
    const start = army.units.infantry
    applySupply(s, map, 'r0')
    expect(s.armies[army.id].units.infantry).toBeLessThan(start)
    expect(s.armies[army.id].outOfSupplyTurns).toBe(1)
    applySupply(s, map, 'r0')
    applySupply(s, map, 'r0')
    expect(s.armies[army.id]).toBeUndefined()
  })

  it('a logistician general tolerates one extra step', () => {
    const s = startState(map)
    giveRegions(s, 'r0', ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
    const army = Object.values(s.armies).find((a) => a.owner === 'r0')!
    s.nations.r0.generals = [{ id: 'g', name: 'Test', trait: 'logistician' }]
    army.generalId = 'g'
    army.location = `r${SUPPLY.baseRange + 1}`
    applySupply(s, map, 'r0')
    expect(s.armies[army.id].outOfSupplyTurns).toBe(0)
  })
})
