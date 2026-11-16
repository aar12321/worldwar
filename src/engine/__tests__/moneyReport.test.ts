import { describe, expect, it } from 'vitest'
import { computeEconomy } from '../economy'
import { monthEndLines, treasuryChange } from '../monthEnd'
import { resolveTurn } from '../resolveTurn'
import { companiesOf } from '../stocks'
import type { GameState } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(6)
const P = 'r0'

/** The treasury's real change over one quiet month. */
const realChange = (s: GameState) => resolveTurn(s, map, []).nations[P].resources.capital - s.nations[P].resources.capital

describe('the money report adds up', () => {
  it('every line sums to what is left over, and a plain month changes the treasury by exactly that', () => {
    const s = startState(map)
    const e = computeEconomy(s, map, P)
    expect(e.lines.reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(e.netCapital, 9)
    expect(monthEndLines(s, map, P)).toEqual([])
    expect(realChange(s)).toBeCloseTo(e.netCapital, 6)
  })

  it('with shares, a puppet, and a trade deal, the month-end lines close the gap', () => {
    const s = startState(map)
    const mine = companiesOf(s, P)[0]
    s.stocks.held[P] = { [mine]: 600 }
    s.nations.r1.overlord = P
    s.deals.push({ id: 'd1', kind: 'trade', from: P, to: 'r2', give: { capital: 3 }, receive: { capital: 10 }, until: s.turn + 5 })
    s.nations.r2.resources.capital = 500
    const lines = monthEndLines(s, map, P)
    expect(lines.map((l) => l.label)).toEqual(expect.arrayContaining(['Dividends on shares', 'Tribute from puppets', 'Trade deals and reparations']))
    expect(lines.find((l) => l.label === 'Trade deals and reparations')!.amount).toBe(7)
    // The share dividend is paid on the month's closing price, so it matches to within the month's price move.
    expect(realChange(s)).toBeCloseTo(treasuryChange(s, map, P), 1)
    // And the puppet's side shows what it pays.
    expect(monthEndLines(s, map, 'r1').find((l) => /^Tribute to/.test(l.label))!.amount).toBeLessThan(0)
  })
})
