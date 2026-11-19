import { describe, expect, it } from 'vitest'
import { advise } from '../advisor'
import { offerIsMoot } from '../offers'
import type { Proposal } from '../types'
import { offersWaiting } from '../../ui/regCtx'
import { lineMap, startState } from './fixtures'

const map = lineMap(6)

describe('offers the world has overtaken', () => {
  it('a pact from a nation you are now allied with is moot; the same offer from a stranger is not', () => {
    const s = startState(map)
    const pact = (from: string): Proposal => ({ id: `p-${from}`, kind: 'pact', from, to: 'r0', created: s.turn, expires: s.turn + 2 })
    s.alliances.push('r0|r1')
    s.proposals.push(pact('r1'), pact('r2'))
    expect(offerIsMoot(s, map, s.proposals[0])).toBe(true)
    expect(offerIsMoot(s, map, s.proposals[1])).toBe(false)
    // The badge counts only the one you can still take up, and the advisor does not nag about the other.
    expect(offersWaiting(s, [])).toBe(1)
    const offers = advise(s, map, 'r0', [], 50).find((a) => a.id === 'offers')
    expect(offers?.title).toMatch(/Nation r2|waiting/)
    expect(offers?.title).not.toMatch(/2 offers/)
  })

  it('peace with a nation you are no longer at war with is moot, and an answered offer is not counted at all', () => {
    const s = startState(map)
    s.proposals.push({ id: 'peace', kind: 'peace', from: 'r1', to: 'r0', created: s.turn, expires: s.turn + 2, terms: { cede: [], reparations: 0 } })
    expect(offerIsMoot(s, map, s.proposals[0])).toBe(true)
    expect(offersWaiting(s, [])).toBe(0)
    s.wars.push('r0|r1')
    expect(offerIsMoot(s, map, s.proposals[0])).toBe(false)
    expect(offersWaiting(s, [])).toBe(1)
    expect(offersWaiting(s, [{ type: 'respond', nationId: 'r0', proposalId: 'peace', accept: false }])).toBe(0)
  })
})
