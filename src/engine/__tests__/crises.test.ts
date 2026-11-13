import { describe, expect, it } from 'vitest'
import { CRISIS } from '../../data/crises'
import { advise } from '../advisor'
import { answerCrisis, runCrises, validateCrisisAction, worldTension } from '../crises'
import { justificationOf } from '../helpers'
import { validateOrder } from '../orders'
import { createRng } from '../rng'
import { resolveTurn } from '../resolveTurn'
import type { Crisis } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(8)

function dispute(): Crisis {
  return { id: 'c1', kind: 'dispute', nation: 'r2', rival: 'r3', area: 'Europe', stage: 1, next: 99, boil: CRISIS.escalate, answered: [] }
}

describe('crises and news', () => {
  it('news comes in stages: a rumor, a disturbance, then the crisis', () => {
    const s = startState(map)
    const c = { ...dispute(), stage: 0, next: s.turn }
    s.crises.push(c)
    runCrises(s, map, createRng(1, 1))
    expect(s.crises[0].stage).toBe(1)
    expect(s.log.some((l) => l.kind === 'news')).toBe(true)
    s.turn = s.crises[0].next
    runCrises(s, map, createRng(1, 2))
    expect(s.crises[0].stage).toBe(2)
  })

  it('a rumor cannot be answered yet; a crisis can, once', () => {
    const s = startState(map)
    s.crises.push({ ...dispute(), stage: 0 })
    expect(validateCrisisAction(s, 'r0', 'c1', 'aid')).toMatch(/rumor/)
    s.crises[0].stage = 1
    expect(validateCrisisAction(s, 'r0', 'c1', 'aid')).toBeNull()
    answerCrisis(s, 'r0', 'c1', 'aid')
    expect(validateCrisisAction(s, 'r0', 'c1', 'aid')).toMatch(/already/)
  })

  it('aid lowers the chance of trouble and is remembered', () => {
    const s = startState(map)
    s.crises.push(dispute())
    s.nations.r0.resources.pp = 50
    s.nations.r0.resources.capital = 200
    const next = resolveTurn(s, map, [{ type: 'crisisAction', nationId: 'r0', crisisId: 'c1', action: 'aid' }])
    expect(next.crises.find((c) => c.id === 'c1')!.boil).toBeLessThan(CRISIS.escalate)
    expect(next.nations.r0.resources.capital).toBeLessThan(s.nations.r0.resources.capital + 100)
  })

  it('backing the victim earns a reason to fight the aggressor, and a little infamy', () => {
    const s = startState(map)
    s.crises.push(dispute())
    s.nations.r0.resources.pp = 50
    const next = resolveTurn(s, map, [{ type: 'crisisAction', nationId: 'r0', crisisId: 'c1', action: 'support' }])
    expect(justificationOf(next, 'r0', 'r3')?.reason).toContain('Stands with')
    expect(next.infamy.r0).toBeGreaterThan(0)
  })

  it('a dispute that boils over becomes a war, and one that calms does not', () => {
    const boil = startState(map)
    boil.crises.push({ ...dispute(), stage: 2, next: boil.turn, boil: 1 })
    runCrises(boil, map, createRng(2, 1))
    expect(boil.wars).toContain('r2|r3')
    const calm = startState(map)
    calm.crises.push({ ...dispute(), stage: 2, next: calm.turn, boil: 0 })
    runCrises(calm, map, createRng(2, 1))
    expect(calm.wars).not.toContain('r2|r3')
    expect(calm.crises.find((c) => c.id === 'c1')).toBeUndefined()
  })

  it('unrest that boils over shakes the government and raises rebels', () => {
    const s = startState(map)
    s.crises.push({ id: 'c2', kind: 'unrest', nation: 'r3', rival: null, area: 'Africa', stage: 2, next: s.turn, boil: 1, answered: [] })
    const before = s.nations.r3.stability
    runCrises(s, map, createRng(3, 1))
    expect(s.nations.r3.stability).toBeLessThan(before - 10)
    expect(Object.values(s.regions).some((r) => r.owner === 'r3' && r.rebels > 0)).toBe(true)
  })

  it('the world has trouble over time, and tension rises with it', () => {
    let s = startState(map)
    expect(worldTension(s)).toBeLessThan(5)
    let seen = 0
    for (let i = 0; i < 60; i++) {
      s = resolveTurn(s, map, [])
      if (s.crises.length) seen++
    }
    expect(seen).toBeGreaterThan(0)
    s.infamy.r1 = 80
    expect(worldTension(s)).toBeGreaterThan(20)
  })

  it('the advisor points out a crisis you could answer', () => {
    const s = startState(map)
    s.crises.push(dispute())
    expect(advise(s, map, 'r0', [], 8).some((a) => a.id === 'crisis')).toBe(true)
    expect(validateOrder(s, map, { type: 'crisisAction', nationId: 'r0', crisisId: 'c1', action: 'mediate' })).toBeNull()
  })
})
