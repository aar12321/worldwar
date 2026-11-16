import { describe, expect, it } from 'vitest'
import { PUPPET } from '../../data/puppets'
import { empireCount } from '../empire'
import { bindPuppet } from '../puppets'
import { economicShare, countriesTaken } from '../victory'
import { scenarioGoalLines } from '../scenarios'
import { lineMap, startState } from './fixtures'

/** Victory counting and the scenario tier counter use the loyalty weights of the empire tier; a puppet with no loyalty stays at half. */
const map = lineMap(10)

function world(n: number) {
  const s = startState(map, 'r0', 4)
  s.settings.goal = 'classic'
  for (let i = 1; i <= n; i++) bindPuppet(s, `r${i}`, 'r0')
  return s
}

describe('puppets count by loyalty in victory and in scenarios', () => {
  it('five loyal puppets count 0.6 each, not half', () => {
    const s = world(5)
    for (let i = 1; i <= 5; i++) s.nations[`r${i}`].loyalty = PUPPET.high
    expect(countriesTaken(s, 'r0')).toBe(3) // floor(5 * 0.6)
    expect(empireCount(s, 'r0')).toBe(1 + 3)
  })

  it('five restive puppets count 0.35 each', () => {
    const s = world(5)
    for (let i = 1; i <= 5; i++) s.nations[`r${i}`].loyalty = 10
    expect(countriesTaken(s, 'r0')).toBe(1) // floor(1.75)
  })

  it('puppets with no loyalty (old saves) still count exactly half', () => {
    const s = world(5)
    for (let i = 1; i <= 5; i++) delete s.nations[`r${i}`].loyalty
    expect(countriesTaken(s, 'r0')).toBe(2) // floor(5 / 2), as before
    const s2 = world(4)
    for (let i = 1; i <= 4; i++) delete s2.nations[`r${i}`].loyalty
    expect(countriesTaken(s2, 'r0')).toBe(2)
  })

  it('a mid-loyalty puppet counts half', () => {
    const s = world(4)
    for (let i = 1; i <= 4; i++) s.nations[`r${i}`].loyalty = 50
    expect(countriesTaken(s, 'r0')).toBe(2)
  })

  it('the output share weighs a loyal puppet at 0.6 and a restive one at 0.35', () => {
    const base = (loyalty: number | undefined) => {
      const s = world(1)
      if (loyalty === undefined) delete s.nations.r1.loyalty
      else s.nations.r1.loyalty = loyalty
      s.worldGross = 1000
      return economicShare(s, map, 'r0')
    }
    const own = (() => {
      const s = startState(map, 'r0', 4)
      s.worldGross = 1000
      return economicShare(s, map, 'r0')
    })()
    const half = base(undefined) - own
    expect(half).toBeGreaterThan(0)
    expect(base(80) - own).toBeCloseTo((half / 0.5) * PUPPET.countHigh, 9)
    expect(base(10) - own).toBeCloseTo((half / 0.5) * PUPPET.countLow, 9)
    expect(base(50) - own).toBeCloseTo(half, 9)
  })

  it('the scenario tier counter agrees with the empire tier', () => {
    const loyal = world(5)
    for (let i = 1; i <= 5; i++) loyal.nations[`r${i}`].loyalty = 90
    loyal.scenario = { id: 'x', start: 0, goal: { kind: 'tier', tier: 2 } } as never
    expect(scenarioGoalLines(loyal, map, 'r0')[0].text).toMatch(/^4 of /)
    const old = world(5)
    for (let i = 1; i <= 5; i++) delete old.nations[`r${i}`].loyalty
    old.scenario = { id: 'x', start: 0, goal: { kind: 'tier', tier: 2 } } as never
    expect(scenarioGoalLines(old, map, 'r0')[0].text).toMatch(/^3 of /) // 1 + floor(5 / 2), the old count
  })
})
