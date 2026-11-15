import { describe, expect, it } from 'vitest'
import { describeProposal, generalPeaceTies, respond, validateProposal } from '../diplomacy'
import { atWar, hasPact, pairKey } from '../helpers'
import { createRng } from '../rng'
import type { GameState, Proposal } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(6)

/** r0 and r1 fight; r2 (r0's ally) fights r3 (r1's ally); r4 is r0's puppet and fights r1 too; r5 is a bystander at war with r2. */
function world(): GameState {
  const s = startState(map)
  s.humans = ['r1']
  s.nations.r1.isPlayer = true
  s.nations.r0.isPlayer = false
  s.playerId = 'r1'
  s.alliances.push(pairKey('r0', 'r2'), pairKey('r1', 'r3'))
  s.nations.r4.overlord = 'r0'
  for (const [a, b] of [['r0', 'r1'], ['r2', 'r3'], ['r4', 'r1'], ['r2', 'r5']]) {
    s.wars.push(pairKey(a, b))
    s.warStarted[pairKey(a, b)] = s.turn
  }
  s.wars.sort()
  return s
}

const offer = (s: GameState, general: boolean): Proposal => {
  const p = { kind: 'peace', terms: { cede: [], reparations: 0, ...(general ? { general: true } : {}) }, id: 'p1', from: 'r0', to: 'r1', created: s.turn, expires: s.turn + 6 } as Proposal
  s.proposals.push(p)
  return p
}

describe('general peace', () => {
  it('ends the wars between each side\'s allies and puppets, and nothing else', () => {
    const s = world()
    expect(generalPeaceTies(s, 'r0', 'r1').map((t) => t.join('>')).sort()).toEqual(['r2>r3', 'r4>r1'].sort())
    respond(s, map, 'r1', offer(s, true).id, true, createRng(1, 1))
    expect(atWar(s, 'r0', 'r1')).toBe(false)
    expect(atWar(s, 'r2', 'r3')).toBe(false)
    expect(atWar(s, 'r4', 'r1')).toBe(false)
    expect(hasPact(s, 'r2', 'r3')).toBe(true)
    // A war that is not between the two sides carries on.
    expect(atWar(s, 'r2', 'r5')).toBe(true)
  })

  it('an ordinary peace leaves the allies fighting', () => {
    const s = world()
    respond(s, map, 'r1', offer(s, false).id, true, createRng(1, 1))
    expect(atWar(s, 'r0', 'r1')).toBe(false)
    expect(atWar(s, 'r2', 'r3')).toBe(true)
  })

  it('cannot be asked for when nobody else is fighting, and says what it covers', () => {
    const s = world()
    const lone = startState(map)
    lone.wars.push('r0|r1')
    expect(validateProposal(lone, map, 'r0', 'r1', { kind: 'peace', terms: { cede: [], reparations: 0, general: true } })).toMatch(/Nobody else/)
    expect(describeProposal(s, map, offer(s, true))).toMatch(/2 more wars/)
  })
})
