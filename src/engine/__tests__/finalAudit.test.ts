import { describe, expect, it } from 'vitest'
import { blocsOf } from '../blocs'
import { atWar, enemiesOf, maxWars, pairKey } from '../helpers'
import { detonate } from '../nuclear'
import { validateOrder } from '../orders'
import { createRng } from '../rng'
import { lineMap, setMilitary, startState } from './fixtures'

const line = lineMap(10)

function nuclearWorld() {
  const s = startState(line, 'r0', 3)
  const me = s.nations.r0
  me.tier = 4
  me.techs.push('frontier_hypersonic')
  me.resources.capital = 5000
  me.resources.pp = 500
  me.nuclear = { warheads: 1, building: [] }
  s.wars.push('r0|r1')
  s.regions.r1.population = 40
  setMilitary(s, 'r1', { infantry: 20 })
  return s
}

describe('the world answers a nuclear strike whatever the attacker\'s own war limit', () => {
  it('an attacker already at its limit is still declared on by the leading blocs; the declarers\' own limits still hold', () => {
    const s = nuclearWorld()
    s.alliances.push(pairKey('r2', 'r3'), pairKey('r4', 'r5'))
    setMilitary(s, 'r2', { infantry: 30 })
    setMilitary(s, 'r3', { infantry: 20 })
    setMilitary(s, 'r4', { infantry: 12 })
    setMilitary(s, 'r5', { infantry: 6 })
    // r0 already fights as many wars as it may (r1 is one of them).
    for (const id of ['r6', 'r7']) s.wars.push(pairKey('r0', id))
    s.wars.sort()
    expect(enemiesOf(s, 'r0').length).toBeGreaterThanOrEqual(maxWars(s, 'r0'))
    // r4 is stretched to its own limit and stays out.
    for (const id of ['r6', 'r7', 'r8']) if (!s.wars.includes(pairKey('r4', id))) s.wars.push(pairKey('r4', id))
    s.wars.sort()
    expect(blocsOf(s).length).toBeGreaterThan(0)
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    for (const id of ['r2', 'r3', 'r5']) expect(atWar(s, id, 'r0'), id).toBe(true)
    expect(atWar(s, 'r4', 'r0')).toBe(false)
    // Over its limit only by the answer: it cannot start a new war of its own.
    expect(enemiesOf(s, 'r0').length).toBeGreaterThan(maxWars(s, 'r0'))
    expect(validateOrder(s, line, { type: 'declareWar', nationId: 'r0', target: 'r9' })).toMatch(/already fighting/)
  })
})
