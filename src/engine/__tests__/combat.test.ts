import { describe, expect, it } from 'vitest'
import { hasCombinedArms, resolveBattle, sidePower, type Combatant } from '../combat'
import { combatMods } from '../arms'
import { createRng } from '../rng'
import { validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'

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

describe('attacks', () => {
  it('a successful attack captures the whole country and ends a nation with no land left', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 30, armor: 10, air: 5 })
    setMilitary(s, 'r1', { infantry: 1 })
    const result = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })
    expect(result.error).toBeNull()
    expect(result.battle?.captured).toBe(true)
    expect(s.regions.r1.owner).toBe('r0')
    expect(s.nations.r1.alive).toBe(false)
    expect(s.nations.r0.military.lastAttackTurn).toBe(s.turn)
  })

  it('cannot attack a nation you are not at war with', () => {
    const map = lineMap(2)
    const s = startState(map)
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })).toMatch(/Not at war/)
  })

  it('attacks once per turn', () => {
    const map = lineMap(3)
    const s = startState(map)
    s.wars = ['r0|r1', 'r1|r2']
    setMilitary(s, 'r0', { infantry: 30, armor: 10, air: 5 })
    expect(applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1' }).error).toBeNull()
    s.wars = ['r0|r2']
    giveRegions(s, 'r0', [])
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r0', target: 'r2' })).toBe('Your military has already attacked this turn')
  })

  it('the defender fights with its whole military plus the garrison', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 6 })
    setMilitary(s, 'r1', { infantry: 20 })
    const result = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })
    expect(result.battle?.defender.units.infantry).toBeGreaterThan(20)
    expect(result.battle?.winner).toBe('defender')
    expect(s.regions.r1.owner).toBe('r1')
  })

  it('a battle report lists the losses of every round', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 12, armor: 4, air: 3 })
    setMilitary(s, 'r1', { infantry: 6 })
    const { battle } = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })
    expect(battle?.rounds).toHaveLength(3)
    const lost = battle!.rounds.reduce((sum, r) => sum + r.defenderLosses.infantry, 0)
    expect(lost).toBeCloseTo(battle!.defender.losses.infantry, 6)
  })

  it('weapons raise both attack and defense', () => {
    const map = lineMap(2)
    const s = startState(map)
    const plain = combatMods(s.nations.r0)
    s.nations.r0.military.weapons.infantry = 3
    const armed = combatMods(s.nations.r0)
    expect(armed.unitAttack.infantry).toBeCloseTo(plain.unitAttack.infantry + 0.18)
    expect(armed.unitDefense.infantry).toBeCloseTo(plain.unitDefense.infantry + 0.18)
  })

  it('a rebel uprising that overwhelms the garrison secedes the region', () => {
    const map = lineMap(3)
    const s = startState(map)
    giveRegions(s, 'r0', ['r1'])
    s.regions.r1.rebels = 60
    setMilitary(s, 'r0', { infantry: 1 })
    const next = resolveTurn(s, map, [])
    expect(next.regions.r1.owner).not.toBe('r0')
    expect(next.nations[next.regions.r1.owner].alive).toBe(true)
    expect(next.wars.some((k) => k.includes('r0'))).toBe(true)
  })
})
