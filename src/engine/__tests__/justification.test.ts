import { describe, expect, it } from 'vitest'
import { opinionOf } from '../../ai/opinion'
import { JUSTIFY } from '../../data/war'
import { START_YEAR, justificationOf, turnDate } from '../helpers'
import { orderCost, validateOrder, warCost } from '../orders'
import { resolveTurn } from '../resolveTurn'
import { lineMap, startState } from './fixtures'

const map = lineMap(4)
const war = { type: 'declareWar', nationId: 'r0', target: 'r1' } as const

describe('the 2026 start', () => {
  it('begins in January 2026 with taxes at the neutral rate', () => {
    expect(START_YEAR).toBe(2026)
    expect(turnDate(1)).toBe('January 2026')
    const s = startState(map)
    expect(s.nations.r0.taxRate).toBeCloseTo(0.2)
    expect(s.nations.r0.corporateTax).toBeCloseTo(0.15)
  })
})

describe('war needs a reason', () => {
  it('costs far more without one', () => {
    const s = startState(map)
    expect(warCost(s, 'r0', 'r1')).toBe(JUSTIFY.noReasonCost)
    s.casusBelli['r0|r1'] = s.turn + 3
    expect(warCost(s, 'r0', 'r1')).toBe(10)
    expect(orderCost(s, war).pp).toBe(10)
  })

  it('a war without a reason costs stability, reputation and the world\'s goodwill', () => {
    const s = startState(map)
    s.nations.r0.resources.pp = 100
    const next = resolveTurn(s, map, [war])
    const justified = startState(map)
    justified.nations.r0.resources.pp = 100
    justified.casusBelli['r0|r1'] = justified.turn + 3
    const calm = resolveTurn(justified, map, [war])
    expect(next.wars).toContain('r0|r1')
    expect(next.infamy.r0).toBeGreaterThan(JUSTIFY.infamyNoReason - 5)
    expect(next.nations.r0.stability).toBeLessThan(calm.nations.r0.stability - 5)
    expect(opinionOf(next, map, 'r2', 'r0')).toBeLessThan(opinionOf(s, map, 'r2', 'r0'))
    expect(next.log.some((l) => l.text.includes('no justification'))).toBe(true)
  })

  it('a war with a reason is far less costly to your name', () => {
    const s = startState(map)
    s.nations.r0.resources.pp = 100
    s.casusBelli['r0|r1'] = s.turn + 3
    s.reasons['r0|r1'] = 'Border incident'
    const next = resolveTurn(s, map, [war])
    expect(next.infamy.r0).toBeLessThan(JUSTIFY.infamyNoReason)
    expect(next.casusBelli['r0|r1']).toBeUndefined()
  })

  it('reputation fades over time', () => {
    const s = startState(map)
    s.infamy.r0 = 50
    let cur = s
    for (let i = 0; i < 24; i++) cur = resolveTurn(cur, map, [])
    expect((cur.infamy.r0 ?? 0)).toBeLessThan(15)
  })

  it('a case takes months, then becomes a reason that is named', () => {
    const s = startState(map)
    s.nations.r0.resources.pp = 100
    expect(validateOrder(s, map, { type: 'buildCase', nationId: 'r0', target: 'r1' })).toBeNull()
    let cur = resolveTurn(s, map, [{ type: 'buildCase', nationId: 'r0', target: 'r1' }])
    expect(cur.cases).toHaveLength(1)
    expect(justificationOf(cur, 'r0', 'r1')).toBeNull()
    expect(validateOrder(cur, map, { type: 'buildCase', nationId: 'r0', target: 'r1' })).toMatch(/already/)
    for (let i = 0; i < JUSTIFY.caseMonths + 1; i++) cur = resolveTurn(cur, map, [])
    expect(justificationOf(cur, 'r0', 'r1')?.reason).toBe('Disputed claims')
    expect(cur.cases).toHaveLength(0)
  })

  it('attacking an ally gives its friends a reason to fight the attacker', () => {
    const s = startState(lineMap(4))
    s.alliances.push('r1|r2')
    // Bound to the attacker by a pact, the ally cannot join, but it has its reason.
    s.pacts['r0|r2'] = 20
    s.nations.r0.resources.pp = 100
    const next = resolveTurn(s, map, [war])
    expect(justificationOf(next, 'r2', 'r0')?.reason).toBe('Attacked our ally')
  })

  it('imposing sanctions gives the target a reason to fight back', () => {
    const s = startState(map)
    s.nations.r0.resources.pp = 100
    const next = resolveTurn(s, map, [{ type: 'imposeSanctions', nationId: 'r0', target: 'r1' }])
    expect(justificationOf(next, 'r1', 'r0')?.reason).toBe('Sanctioned us')
  })
})
