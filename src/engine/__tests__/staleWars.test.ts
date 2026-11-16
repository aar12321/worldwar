import { describe, expect, it } from 'vitest'
import { WAR } from '../../data/war'
import { expireDiplomacy } from '../diplomacy'
import { hasPact } from '../helpers'
import type { GameState } from '../types'
import { lineMap, startState } from './fixtures'

/** r0 and r1 (AI nations) have been at war since turn 1; r3 is the human. */
function war(turn: number): GameState {
  const map = lineMap(4)
  const s = startState(map, 'r3')
  s.wars.push('r0|r1')
  s.warStarted['r0|r1'] = 1
  s.turn = turn
  return s
}

describe('a war nobody fights fizzles out', () => {
  it('ends in the usual truce after a year with no blow struck', () => {
    const s = war(1 + WAR.staleMonths)
    expireDiplomacy(s)
    expect(s.wars).not.toContain('r0|r1')
    expect(hasPact(s, 'r0', 'r1')).toBe(true)
    expect(s.log.some((l) => l.text.includes('fizzled out'))).toBe(true)
  })

  it('a war that is still being fought goes on, and one that is younger than a year is left alone', () => {
    const s = war(1 + WAR.staleMonths)
    s.regions.r1.attackedTurn = s.turn - 3
    expireDiplomacy(s)
    expect(s.wars).toContain('r0|r1')
    const young = war(WAR.staleMonths)
    expireDiplomacy(young)
    expect(young.wars).toContain('r0|r1')
  })

  it('never ends a war a human is in', () => {
    const s = war(30)
    s.wars = ['r0|r3']
    s.warStarted['r0|r3'] = 1
    expireDiplomacy(s)
    expect(s.wars).toContain('r0|r3')
  })
})
