import { describe, expect, it } from 'vitest'
import { JUSTIFY } from '../../data/war'
import { pairKey } from '../helpers'
import { buildWarheadProblem, detonate } from '../nuclear'
import { createRng } from '../rng'
import { lineMap, setMilitary, startState } from './fixtures'

/** Two rules of the nuclear weapon that the mutation sweep found nothing guarding (docs/FINAL2_STATUS.md). */
const line = lineMap(10)

function nuclearWorld() {
  const s = startState(line, 'r0', 3)
  const me = s.nations.r0
  me.tier = 4
  me.techs.push('frontier_hypersonic')
  me.resources.capital = 5000
  me.resources.steel = 500
  me.resources.tp = 500
  me.resources.pp = 500
  s.regions.r0.buildings.factory = 1
  me.nuclear = { warheads: 1, building: [] }
  s.wars.push('r0|r1')
  setMilitary(s, 'r1', { infantry: 20 })
  return s
}

describe('nuclear rules guarded by the mutation sweep', () => {
  it('a warhead can only be built where there is a factory', () => {
    const s = nuclearWorld()
    expect(buildWarheadProblem(s, { type: 'buildWarhead', nationId: 'r0' }, [])).toBeNull()
    s.regions.r0.buildings.factory = 0
    expect(buildWarheadProblem(s, { type: 'buildWarhead', nationId: 'r0' }, [])).toMatch(/factory/)
  })

  it('the nations that answer a bomb answer it with a reason for war: no stain on them, no no-cause stability loss', () => {
    const s = nuclearWorld()
    for (const [a, b] of [['r2', 'r3'], ['r4', 'r5']]) s.alliances.push(pairKey(a, b))
    setMilitary(s, 'r2', { infantry: 30 })
    setMilitary(s, 'r3', { infantry: 20 })
    setMilitary(s, 'r4', { infantry: 12 })
    setMilitary(s, 'r5', { infantry: 6 })
    const stability = s.nations.r2.stability
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    for (const id of ['r2', 'r3']) {
      expect(s.wars.some((k) => k === pairKey(id, 'r0'))).toBe(true)
      expect(s.infamy[id] ?? 0).toBe(JUSTIFY.infamyWithReason)
    }
    expect(s.nations.r2.stability).toBe(stability)
  })
})
