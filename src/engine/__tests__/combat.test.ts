import { describe, expect, it } from 'vitest'
import { hasCombinedArms, resolveBattle, sidePower, type Combatant } from '../combat'
import { createArmy } from '../helpers'
import { createRng } from '../rng'
import { resolveTurn } from '../resolveTurn'
import { giveRegions, lineMap, startState } from './fixtures'

const even = { infantry: 1, armor: 1, air: 1, naval: 1 }
const side = (units: Partial<Combatant['units']>): Combatant => ({
  units: { infantry: 0, armor: 0, air: 0, naval: 0, ...units },
  mods: null,
  penalty: 1,
  penaltyNotes: [],
})

describe('combat math', () => {
  it('armor is far weaker in mountains than on plains', () => {
    const tanks = side({ armor: 5 })
    expect(sidePower(tanks, even, 'mountain', false, false)).toBeLessThan(sidePower(tanks, even, 'plains', false, false) * 0.4)
  })

  it('combined arms beats the same divisions without the mix', () => {
    const mixed = side({ infantry: 2, armor: 2, air: 2 })
    expect(hasCombinedArms(mixed.units)).toBe(true)
    const raw =
      sidePower(side({ infantry: 2 }), even, 'plains', false, false) +
      sidePower(side({ armor: 2 }), even, 'plains', false, false) +
      sidePower(side({ air: 2 }), even, 'plains', false, false)
    expect(sidePower(mixed, even, 'plains', false, false)).toBeCloseTo(raw * 1.25)
  })

  it('mountain defenders get a terrain bonus', () => {
    const inf = side({ infantry: 5 })
    expect(sidePower(inf, even, 'mountain', false, true)).toBeGreaterThan(sidePower(inf, even, 'plains', false, true))
  })

  it('an overwhelming attacker wins and battles are reproducible', () => {
    const input = { attacker: side({ infantry: 20, armor: 6 }), defender: side({ infantry: 3 }), terrain: 'plains' as const, coastal: false }
    const a = resolveBattle(input, createRng(5))
    const b = resolveBattle(input, createRng(5))
    expect(a.winner).toBe('attacker')
    expect(a).toEqual(b)
    expect(a.rounds.length).toBeGreaterThan(0)
  })

  it('a weak attacker is repulsed', () => {
    const out = resolveBattle({ attacker: side({ infantry: 1 }), defender: side({ infantry: 8 }), terrain: 'mountain', coastal: false }, createRng(2))
    expect(out.winner).toBe('defender')
  })
})

describe('attacks through resolveTurn', () => {
  it('a successful attack captures the region and moves the army in', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    const army = Object.values(s.armies).find((a) => a.owner === 'r0')!
    army.units = { infantry: 30, armor: 10, air: 5, naval: 0 }
    for (const a of Object.values(s.armies)) if (a.owner === 'r1') a.units = { infantry: 1, armor: 0, air: 0, naval: 0 }
    const next = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1' }])
    expect(next.regions.r1.owner).toBe('r0')
    expect(next.armies[army.id].location).toBe('r1')
    expect(next.battles[0].captured).toBe(true)
    expect(next.nations.r1.alive).toBe(false)
  })

  it('every territory attacks together, and only the army that can reach moves in', () => {
    const map = lineMap(4)
    const s = startState(map)
    s.wars = ['r0|r1']
    const home = Object.values(s.armies).find((a) => a.owner === 'r0')!
    home.units = { infantry: 4, armor: 0, air: 0, naval: 0 }
    const far = createArmy(s, { owner: 'r0', location: 'r3', units: { infantry: 24, armor: 0, air: 0, naval: 0 }, homeTerritoryId: 'r0:far' })
    const defender = Object.values(s.armies).find((a) => a.owner === 'r1')!
    defender.units = { infantry: 12, armor: 0, air: 0, naval: 0 }
    const next = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: home.id, target: 'r1' }])
    expect(next.battles[0].attacker.units.infantry).toBeCloseTo(28)
    expect(next.regions.r1.owner).toBe('r0')
    expect(next.armies[home.id].location).toBe('r1')
    expect(next.armies[far.id].location).toBe('r3')
    expect(next.armies[far.id].units.infantry).toBeLessThan(24)
    expect(next.armies[home.id].units.infantry).toBeGreaterThan(0)
  })

  it('the defender fights with every territory', () => {
    const map = lineMap(3)
    const s = startState(map)
    s.wars = ['r0|r1']
    const attacker = Object.values(s.armies).find((a) => a.owner === 'r0')!
    attacker.units = { infantry: 14, armor: 0, air: 0, naval: 0 }
    const local = Object.values(s.armies).find((a) => a.owner === 'r1')!
    local.units = { infantry: 1, armor: 0, air: 0, naval: 0 }
    const far = createArmy(s, { owner: 'r1', location: 'r2', units: { infantry: 40, armor: 0, air: 0, naval: 0 }, homeTerritoryId: 'r1:far' })
    const next = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: attacker.id, target: 'r1' }])
    expect(next.battles[0].defender.units.infantry).toBeGreaterThan(30)
    expect(next.regions.r1.owner).toBe('r1')
    expect(next.armies[far.id].location).toBe('r2')
    expect(next.armies[far.id].units.infantry).toBeLessThan(40)
  })

  it('a nation commits its armies to one battle a month', () => {
    const map = lineMap(3)
    const s = startState(map)
    s.wars = ['r0|r1', 'r0|r2']
    const home = Object.values(s.armies).find((a) => a.owner === 'r0')!
    home.units = { infantry: 30, armor: 0, air: 0, naval: 0 }
    const far = createArmy(s, { owner: 'r0', location: 'r1', units: { infantry: 10, armor: 0, air: 0, naval: 0 }, homeTerritoryId: 'r0:far' })
    const next = resolveTurn(s, map, [
      { type: 'attack', nationId: 'r0', armyId: home.id, target: 'r1' },
      { type: 'attack', nationId: 'r0', armyId: far.id, target: 'r2' },
    ])
    expect(next.battles.filter((b) => b.attacker.nationId === 'r0')).toHaveLength(1)
  })

  it('cannot attack a nation you are not at war with', () => {
    const map = lineMap(2)
    const s = startState(map)
    const army = Object.values(s.armies).find((a) => a.owner === 'r0')!
    const next = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1' }])
    expect(next.regions.r1.owner).toBe('r1')
    expect(next.battles).toHaveLength(0)
  })

  it('a rebel uprising that overwhelms the garrison secedes the region', () => {
    const map = lineMap(3)
    const s = startState(map)
    giveRegions(s, 'r0', ['r1'])
    s.regions.r1.rebels = 40
    const next = resolveTurn(s, map, [])
    expect(next.regions.r1.owner).not.toBe('r0')
    expect(next.nations[next.regions.r1.owner].alive).toBe(true)
    expect(next.wars.some((k) => k.includes('r0'))).toBe(true)
  })
})
