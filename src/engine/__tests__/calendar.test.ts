import { describe, expect, it } from 'vitest'
import { absDate, absDay, clockMonth, daysInMonth, dayDate, fromAbsDay } from '../calendar'
import { turnDate } from '../helpers'

describe('the live calendar', () => {
  it('has real month lengths, leap years included', () => {
    expect(daysInMonth(1)).toBe(31) // January 2026
    expect(daysInMonth(2)).toBe(28) // February 2026
    expect(daysInMonth(4)).toBe(30) // April 2026
    expect(daysInMonth(26)).toBe(29) // February 2028
    expect(daysInMonth(14)).toBe(28) // February 2027
    let year = 0
    for (let t = 1; t <= 12; t++) year += daysInMonth(t)
    expect(year).toBe(365)
  })

  it('counts days from the first of January of the first year', () => {
    expect(absDay(1, 0)).toBe(0)
    expect(absDay(2, 0)).toBe(31)
    expect(absDay(13, 0)).toBe(365)
    expect(absDay(3, 13)).toBe(31 + 28 + 13)
  })

  it('turns days into dates and back, over ten years', () => {
    for (let turn = 1; turn <= 120; turn++) {
      for (let day = 0; day < daysInMonth(turn); day++) expect(fromAbsDay(absDay(turn, day))).toEqual({ turn, day })
      // The day after the last day is the first of the next month.
      expect(absDay(turn, daysInMonth(turn))).toBe(absDay(turn + 1, 0))
    }
  })

  it('writes dates in words, and agrees with the turn calendar on the month', () => {
    expect(dayDate(3, 13)).toBe('14 March 2026')
    expect(dayDate(26, 28)).toBe('29 February 2028')
    expect(absDate(absDay(7, 0))).toBe('1 July 2026')
    for (const turn of [1, 2, 13, 40, 77]) expect(dayDate(turn, 4)).toContain(turnDate(turn).split(' ')[0])
  })

  it('reads the next month at the instant the AI plans it, and the turn otherwise', () => {
    expect(clockMonth({ turn: 5, day: undefined })).toBe(5)
    expect(clockMonth({ turn: 5, day: 12 })).toBe(5)
    expect(clockMonth({ turn: 5, day: daysInMonth(5) })).toBe(6)
  })
})
