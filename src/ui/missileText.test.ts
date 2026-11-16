import { describe, expect, it } from 'vitest'
import { MISSILES, MISSILE_TYPES } from '../data/missiles'
import { startLive } from '../engine/live'
import { lineMap, startState } from '../engine/__tests__/fixtures'
import { clockOf } from '../engine/calendar'
import { MISSILE_ARC, MISSILE_SWATCH, buildCostText, clampCount, effectText, flightDays, flightText, incomingSalvos, incomingText, landedEffect, shieldNote } from './missileText'

describe('missile words', () => {
  it('every kind has its own arc colors and swatch, so the globe tells them apart', () => {
    const arcs = MISSILE_TYPES.map((k) => MISSILE_ARC[k].join('>'))
    expect(new Set(arcs).size).toBe(MISSILE_TYPES.length)
    expect(new Set(MISSILE_TYPES.map((k) => MISSILE_SWATCH[k])).size).toBe(MISSILE_TYPES.length)
  })

  it('says what each kind does from its numbers', () => {
    expect(effectText('cruise')).toBe('Cuts the Defense Line by 0.25 each (up to 4 in a salvo), stops its factories for 1 month.')
    expect(effectText('tactical')).toMatch(/Destroys 0.6% of their army each \(up to 12%\)/)
    expect(effectText('tactical')).not.toMatch(/Defense Line/)
    expect(effectText('ballistic')).toMatch(/destroys a building for every 3/)
    expect(effectText('ballistic')).toMatch(/kills 0.4% of the people each \(up to 5%\)/)
    expect(effectText('ballistic')).toMatch(/\. The world will not forgive it\.$/)
    expect(effectText('cruise')).not.toMatch(/forgive/)
    expect(landedEffect('tactical')).toBe('destroyed part of the army')
    expect(landedEffect('cruise')).toBe('cut the Defense Line, stopped the factories')
  })

  it('shows what share a shield lets through, harsher on cruise missiles than ballistic ones', () => {
    expect(shieldNote(0, 'cruise')).toEqual({ through: 1, text: 'No Interceptor Shield: every missile gets through.' })
    const cruise = shieldNote(2, 'cruise')
    const ballistic = shieldNote(2, 'ballistic')
    expect(cruise.through).toBeLessThan(ballistic.through)
    expect(cruise.text).toMatch(/level 2: about \d+% of cruise missiles get through/)
    expect(Math.round(cruise.through * 100)).toBe(Number(cruise.text.match(/about (\d+)%/)![1]))
  })

  it('keeps a custom count to a whole number between one and what there is', () => {
    expect(clampCount(7, 4)).toBe(4)
    expect(clampCount(0, 4)).toBe(1)
    expect(clampCount(-3, 4)).toBe(1)
    expect(clampCount(2.9, 4)).toBe(2)
    expect(clampCount(Number.NaN, 4)).toBe(1)
    expect(clampCount(5, 0)).toBe(1)
  })

  it('prices a missile in plain words and leaves out what is free', () => {
    expect(buildCostText('cruise')).toBe('6 money, 1 steel')
    expect(buildCostText('ballistic')).toBe('30 money, 5 steel, 3 oil')
    expect(flightText('ballistic', true)).toBe('lands in 3 days')
    expect(flightText('tactical', true)).toBe('lands in 1 day')
    expect(flightText('ballistic', false)).toBe('lands when the month ends')
  })
})

describe('missiles coming at you', () => {
  const map = lineMap(4)
  const game = () => {
    const s = startLive(startState(map))
    s.wars.push('r0|r1', 'r0|r2')
    return s
  }

  it('groups what is in the air by who fired it, soonest first, and says the days left', () => {
    const s = game()
    const now = clockOf(s)
    s.flights = [
      { id: 'a', nationId: 'r2', from: 'r2', target: 'r0', count: 4, kind: 'ballistic', launched: now, lands: now + 3 },
      { id: 'b', nationId: 'r1', from: 'r1', target: 'r0', count: 2, kind: 'cruise', launched: now, lands: now + 2 },
      { id: 'c', nationId: 'r1', from: 'r1', target: 'r0', count: 1, launched: now, lands: now + 1 },
      { id: 'd', nationId: 'r0', from: 'r0', target: 'r1', count: 9, launched: now, lands: now + 1 },
    ]
    const salvos = incomingSalvos(s, 'r0')
    expect(salvos.map((x) => [x.from, x.count, x.days])).toEqual([
      ['r1', 3, 1],
      ['r2', 4, 3],
    ])
    expect(salvos[0].kinds.sort()).toEqual(['cruise', 'hypersonic'])
    expect(incomingText(salvos)).toBe(`Missiles incoming from ${s.nations.r1.name}: 1 day (and 1 other nation)`)
    expect(incomingText(salvos.slice(1))).toBe(`Missiles incoming from ${s.nations.r2.name}: 3 days`)
    expect(incomingText([])).toBe('')
  })

  it('a flight spends at least a day in the air', () => {
    expect(flightDays({ launched: 5, lands: 8 })).toBe(3)
    expect(flightDays({ launched: 5, lands: 5 })).toBe(1)
    expect(MISSILES.ballistic.days).toBeGreaterThan(MISSILES.tactical.days)
  })
})
