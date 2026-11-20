import { describe, expect, it } from 'vitest'
import { NODES, ROCKETS, type NodeId, type RocketId } from '../../data/space'
import { benchRate, monthsToFinish, newSpace, rocketBuildRate, rocketDevRate, runSpace } from '../space'
import { rocketBuildCost, rocketDevCost, rocketDevMonths, spaceBill } from '../spaceEffects'
import type { GameState } from '../types'
import { lineMap, startState } from './fixtures'

/**
 * The Space tab counts months and money with `monthsToFinish` and the rates `runSpace` adds (`rocketDevRate`, `rocketBuildRate`,
 * `benchRate`). These run the real month end and check that the work finishes on the month the screen named, and that the bill paid
 * on the way equals the total the screen showed (the monthly bill times those months).
 */
const map = lineMap(4)

function world(): GameState {
  const s = startState(map, 'r0', 4)
  s.nations.r0.resources.capital = 1e6
  s.nations.r0.space = newSpace()
  s.space = { claims: {}, launches: 0 }
  return s
}

/** Month ends until `done` holds, and the building bill paid on the way. */
function run(s: GameState, researchStaff: number, done: () => boolean) {
  const n = s.nations.r0
  let months = 0
  let paid = 0
  while (!done() && months < 200) {
    paid += spaceBill(n.space, n).building
    runSpace(s, map, n, researchStaff)
    months++
  }
  return { months, paid }
}

describe('Space timers on screen match the month end', () => {
  it('rocket development, slowed by too few engineers, at every staffing level', () => {
    for (const rocket of ['orbital', 'heavy', 'deep'] as RocketId[]) {
      for (const engineers of [1, 3, 5, 9, 40]) {
        const s = world()
        const sp = s.nations.r0.space!
        sp.engineers = engineers
        sp.dev = { rocket, progress: 0 }
        const need = rocketDevMonths(rocket, 1)
        const shown = monthsToFinish(0, need, rocketDevRate(sp, rocket))!
        const shownCost = (rocketDevCost(rocket, 1) / need) * shown
        const { months, paid } = run(s, 1, () => !sp.dev)
        expect(months, `${rocket} with ${engineers} engineers`).toBe(shown)
        expect(paid).toBeCloseTo(shownCost, 6)
        if (engineers < ROCKETS[rocket].engineers) expect(shown).toBeGreaterThan(need)
      }
    }
  })

  it('a rocket on the line, faster with the build-speed discoveries', () => {
    for (const discoveries of [[], ['methalox'], ['methalox', 'propellant']] as NodeId[][]) {
      const s = world()
      const sp = s.nations.r0.space!
      sp.discoveries = [...discoveries]
      sp.builds = [{ rocket: 'interplanetary', progress: 0 }]
      const shown = monthsToFinish(0, ROCKETS.interplanetary.months, rocketBuildRate(sp))!
      const shownCost = (rocketBuildCost('interplanetary', sp, s.nations.r0) / ROCKETS.interplanetary.months) * shown
      const { months, paid } = run(s, 1, () => sp.builds.length === 0)
      expect(months).toBe(shown)
      expect(paid).toBeCloseTo(shownCost, 6)
      // 25% faster turns five months of work into four.
      if (discoveries.length === 2) expect(shown).toBe(4)
    }
  })

  it('a discovery on a bench, at the lab level times the scientists on staff', () => {
    for (const labs of [1, 2, 3]) {
      for (const staff of [0.35, 0.8, 1, 1.15]) {
        const s = world()
        const sp = s.nations.r0.space!
        sp.labs = labs
        const node: NodeId = 'methalox'
        sp.research = [{ node, progress: 0 }]
        const shown = monthsToFinish(0, NODES[node].months, benchRate(sp, staff))!
        const { months, paid } = run(s, staff, () => sp.research.length === 0)
        expect(months, `labs ${labs}, staff ${staff}`).toBe(shown)
        expect(paid).toBeCloseTo((NODES[node].money / NODES[node].months) * shown, 6)
      }
    }
  })

  it('work that cannot move says so instead of a number', () => {
    expect(monthsToFinish(0, 10, benchRate({ ...newSpace(), labs: 2 }, 0))).toBeNull()
    expect(monthsToFinish(0, 10, benchRate(newSpace(), 1))).toBeNull()
    expect(monthsToFinish(10, 10, 1)).toBe(0)
  })
})
