import { describe, expect, it } from 'vitest'
import { hasIntel, powerView, showPower } from '../intel'
import { pairKey } from '../helpers'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(5)

describe('what a nation knows about another\'s army', () => {
  it('sees its own, its friends\', its enemies\' and its puppets\' for certain, and strangers\' only roughly', () => {
    const s = startState(map)
    setMilitary(s, 'r1', { infantry: 33 })
    expect(hasIntel(s, 'r0', 'r0')).toBe(true)
    expect(hasIntel(s, 'r0', 'r1')).toBe(false)
    expect(powerView(s, 'r0', 'r1').exact).toBe(false)
    s.alliances.push(pairKey('r0', 'r2'))
    expect(hasIntel(s, 'r0', 'r2')).toBe(true)
    s.wars.push(pairKey('r0', 'r3'))
    expect(hasIntel(s, 'r0', 'r3')).toBe(true)
    s.nations.r4.overlord = 'r0'
    expect(hasIntel(s, 'r0', 'r4')).toBe(true)
  })

  it('spying lifts the fog for a while, and the guess is close, steady and rounded', () => {
    const s = startState(map)
    setMilitary(s, 'r1', { infantry: 60, armor: 10 })
    const real = powerView(s, 'r1', 'r1').value
    const guess = powerView(s, 'r0', 'r1')
    expect(guess.exact).toBe(false)
    expect(guess.value).toBeGreaterThan(real * 0.7)
    expect(guess.value).toBeLessThan(real * 1.3)
    expect(guess.value % 5).toBe(0)
    expect(powerView(s, 'r0', 'r1')).toEqual(guess)
    expect(showPower(guess)).toMatch(/^~/)
    s.intel['r0|r1'] = s.turn + 12
    expect(powerView(s, 'r0', 'r1')).toEqual({ value: real, exact: true })
    s.turn += 13
    expect(hasIntel(s, 'r0', 'r1')).toBe(false)
  })
})
