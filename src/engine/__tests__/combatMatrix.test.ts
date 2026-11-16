import { describe, expect, it } from 'vitest'
import { UNIT_SPECS } from '../../data/unitTypes'
import { COMBAT, hitPoints } from '../combat'
import { forecastPlan } from '../forecast'
import { totalUnits } from '../helpers'
import { budgetToHold, budgetToWin, costOf, fight, recipeToWin, RECIPES, units, winCurve } from './combatMatrix.sweep'
import { lineMap, setMilitary, startState } from './fixtures'

/**
 * The combat rules as a stats game: what the numbers have to look like for a choice of units to matter. The sweep that prints the whole
 * tables is combatMatrix.sweep.ts (see docs/WAR_STATUS.md for the before and after); these tests pin the findings so a later change that
 * brings an old problem back fails here.
 */

describe('the odds are real probabilities, not a switch', () => {
  it('the step from a sure loss to a sure win is several divisions wide', () => {
    const curve = winCurve('plains')
    const first = (p: number) => curve.find((r) => r.win >= p)!.n
    // Before the fortune of the day, 10% and 90% were one division apart (12 to 13 against ten defenders).
    expect(first(0.9) - first(0.1)).toBeGreaterThanOrEqual(3)
    expect(curve[0].win).toBeLessThan(0.05)
    expect(curve[curve.length - 1].win).toBeGreaterThan(0.99)
    // Monotone: more force never wins less (within the noise of the fixed dice).
    for (let i = 1; i < curve.length; i++) expect(curve[i].win).toBeGreaterThanOrEqual(curve[i - 1].win - 0.06)
  })

  it('without the fortune of the day the switch comes back (mutation guard)', () => {
    const was = COMBAT.luck
    COMBAT.luck = 0
    try {
      const curve = winCurve('plains')
      const first = (p: number) => curve.find((r) => r.win >= p)!.n
      expect(first(0.9) - first(0.1)).toBeLessThanOrEqual(2)
    } finally {
      COMBAT.luck = was
    }
  })
})

describe('no kind of unit is strictly dominant or strictly dominated', () => {
  const plains = { infantry: budgetToWin('infantry', 'plains'), armor: budgetToWin('armor', 'plains') }
  it('tanks pay their way on open ground and are poor in the mountains, where infantry hold best', () => {
    // Within a third of infantry's cost on plains and desert...
    expect(plains.armor).toBeLessThan(plains.infantry * 1.3)
    expect(budgetToWin('armor', 'desert')).toBeLessThan(budgetToWin('infantry', 'desert') * 1.3)
    // ...and far dearer than infantry where they cannot use their guns.
    expect(budgetToWin('armor', 'mountain')).toBeGreaterThan(budgetToWin('infantry', 'mountain') * 2)
    expect(budgetToHold('infantry', 'mountain')).toBeLessThan(budgetToHold('armor', 'mountain'))
  })

  it('infantry is the cheapest way to hold ground, and not so far ahead that nothing else is worth buying', () => {
    for (const k of ['armor', 'artillery', 'robot'] as const) expect(budgetToHold('infantry', 'plains')).toBeLessThan(budgetToHold(k, 'plains'))
    // The line units that cost more are within a reasonable multiple of it on open ground (robots also need no soldiers and never tire the people).
    expect(budgetToHold('armor', 'plains') / budgetToHold('infantry', 'plains')).toBeLessThan(1.7)
    expect(budgetToHold('robot', 'plains') / budgetToHold('infantry', 'plains')).toBeLessThan(1.4)
  })

  it('a combined-arms army is as cheap as pure infantry on open ground, so the mix is a real choice', () => {
    const mixed = recipeToWin(RECIPES['combined arms'], 'plains')
    expect(mixed).toBeLessThan(plains.infantry * 1.12)
    const armoured = recipeToWin(RECIPES.armoured, 'desert')
    expect(armoured).toBeLessThan(budgetToWin('infantry', 'desert') * 1.12)
    // On mountains pure infantry beats it: the terrain decides.
    expect(recipeToWin(RECIPES['combined arms'], 'mountain')).toBeGreaterThan(budgetToWin('infantry', 'mountain') * 1.15)
  })

  it('drones are cheap and worth it but not a free win; every dearer kind soaks up more punishment', () => {
    expect(budgetToWin('drone', 'plains')).toBeGreaterThan(plains.infantry * 0.7)
    for (const k of ['armor', 'artillery', 'fighter', 'air', 'naval', 'robot'] as const) {
      expect(costOf(k)).toBeGreaterThan(costOf('infantry') * 2)
      expect(UNIT_SPECS[k].toughness).toBeGreaterThanOrEqual(2)
    }
    expect(UNIT_SPECS.infantry.toughness).toBe(1)
  })
})

describe('size, defender advantage and stance', () => {
  it('a bigger edge costs fewer losses (force-size returns), and the defender holds equal forces', () => {
    const even = fight({ infantry: 20 }, { infantry: 20 }, 'plains', 200)
    expect(even.win).toBeLessThan(0.3)
    const twice = fight({ infantry: 40 }, { infantry: 20 }, 'plains', 200)
    expect(twice.win).toBeGreaterThan(0.95)
    expect(twice.attLossFrac).toBeLessThan(even.attLossFrac)
    // Mountains help the defender.
    expect(fight({ infantry: 24 }, { infantry: 20 }, 'mountain', 200).win).toBeLessThan(fight({ infantry: 24 }, { infantry: 20 }, 'plains', 200).win)
  })

  it('stances trade losses for speed: Blitz pushes the line furthest and costs most, Siege is cheap in lives and slow', () => {
    const map = lineMap(4)
    const s = startState(map)
    s.wars.push('r0|r1')
    s.regions.r1.line = 30
    setMilitary(s, 'r0', { infantry: 16, armor: 3, artillery: 2, air: 3, fighter: 2 })
    setMilitary(s, 'r1', { infantry: 14 })
    const f = (stance: 'assault' | 'blitz' | 'siege') => forecastPlan(s, map, 'r0', { target: 'r1', stance, commit: 'allin' }, 512, false)!
    const [a, b, g] = [f('assault'), f('blitz'), f('siege')]
    expect(b.lineDamage).toBeGreaterThan(a.lineDamage)
    expect(a.lineDamage).toBeGreaterThan(g.lineDamage)
    expect(b.yourLosses).toBeGreaterThan(a.yourLosses)
    expect(a.yourLosses).toBeGreaterThan(g.yourLosses)
  })

  it('losses are shared out by hit points: a division of tanks soaks up as much as three of infantry', () => {
    const mixed = units({ infantry: 3, armor: 1 })
    expect(hitPoints(mixed)).toBeCloseTo(3 + UNIT_SPECS.armor.toughness)
    expect(totalUnits(mixed)).toBe(4)
    // Equal strength, fewer divisions: the tank force loses fewer divisions than the infantry force that matches its power.
    const t = fight({ infantry: 20 }, { armor: 7 }, 'plains', 100)
    expect(t.defLoss).toBeLessThan(t.attLoss)
  })
})
