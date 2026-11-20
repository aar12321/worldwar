import { afterEach, describe, expect, it } from 'vitest'
import { evaluateProposal, offerOutlook } from '../../ai/diplomat'
import { addOpinion, opinionReport } from '../../ai/opinion'
import { DEALINGS, RELATIONS, TIES } from '../../data/relations'
import { normalizeGame } from '../migrate'
import { reception, thankInvestment, warmthFactor } from '../relations'
import { resolveTurn } from '../resolveTurn'
import { peaceMonths, tieLines, trustFactor, trustReport } from '../ties'
import type { GameState, Proposal } from '../types'
import { createRng } from '../rng'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)
const WEIGHTS = { ...DEALINGS.trust }

function world(): GameState {
  const s = startState(map, 'r0', 5)
  for (const id of Object.keys(s.nations)) {
    const n = s.nations[id]
    n.resources.capital = 1000
    n.resources.pp = 300
    n.government = 'democracy'
    n.personality = 'honorable'
    setMilitary(s, id, { infantry: 10 })
  }
  return s
}

/** r3 trusts r0 well: an embassy of r0's, a deal honoured. */
function trusted(s: GameState) {
  s.relations = { last: {}, soft: {}, embassies: [{ from: 'r0', to: 'r3', since: s.turn, attache: false } as never], programs: [], plans: [], favours: {}, requests: [], log: [], since: {}, contact: {} }
  addOpinion(s, 'r3', 'r0', 'Honored our deal', 10, 0.3)
}

afterEach(() => {
  DEALINGS.on = true
  Object.assign(DEALINGS.trust, WEIGHTS)
})

describe('trust in a rival’s answer (DEALINGS.trust)', () => {
  it('the factor is bounded: -1 at 0, 0 untested, +1 at 100, and 0 with DEALINGS off', () => {
    expect(trustFactor(0)).toBe(-1)
    expect(trustFactor(50)).toBe(0)
    expect(trustFactor(100)).toBe(1)
    expect(trustFactor(75)).toBe(0.5)
    DEALINGS.on = false
    expect(trustFactor(100)).toBe(0)
  })

  it('a pact, an alliance, a guarantee and a loan lean with trust; the reading comes with the verdict', () => {
    // A huge weight shows the wiring: trust alone decides. The real weights are bounded (below).
    for (const k of ['pact', 'alliance', 'guarantee', 'loan'] as const) DEALINGS.trust[k] = 1000
    const hi = world()
    trusted(hi)
    const lo = world()
    lo.infamy = { r0: 60 }
    expect(trustReport(hi, 'r3', 'r0').total).toBeGreaterThan(50)
    expect(trustReport(lo, 'r3', 'r0').total).toBeLessThan(50)
    for (const kind of ['pact', 'alliance', 'guarantee'] as const) {
      expect(offerOutlook(hi, map, 'r3', 'r0', { kind }).outlook).toBe('likely')
      expect(offerOutlook(lo, map, 'r3', 'r0', { kind }).outlook).toBe('unlikely')
    }
    const p: Proposal = { id: 'x', kind: 'pact', from: 'r0', to: 'r3', created: 1, expires: 3 }
    const v = evaluateProposal(lo, map, 'r3', p, createRng(1, 1))
    expect(v.trust?.total).toBe(trustReport(lo, 'r3', 'r0').total)
    expect(v.reason).toMatch(/word counts for little|do not trust/)
  })

  it('a trade deal: a trusted partner gets a better price, a doubted one pays more; at most 8% either way', () => {
    const hi = world()
    trusted(hi)
    const lo = world()
    lo.infamy = { r0: 60 }
    /** The least money for 10 food that r3 takes up on its worst day. */
    const edge = (s: GameState) => {
      for (let g = 1; g < 2000; g++) if (offerOutlook(s, map, 'r3', 'r0', { kind: 'trade', terms: { give: { capital: g }, receive: { food: 10 }, months: 0 } }).outlook === 'likely') return g
      return Infinity
    }
    const hiOn = edge(hi)
    const loOn = edge(lo)
    DEALINGS.on = false
    const hiOff = edge(hi)
    const loOff = edge(lo)
    expect(hiOn).toBeLessThan(hiOff)
    expect(loOn).toBeGreaterThan(loOff)
    // Bounded: the price moves by at most the weight (8% of the threshold, rounded to whole money).
    expect(hiOn / hiOff).toBeGreaterThan(0.9)
    expect(loOn / loOff).toBeLessThan(1.1)
  })

  it('with DEALINGS off, a verdict carries no trust and is exactly what it was', () => {
    const lo = world()
    lo.infamy = { r0: 60 }
    const p: Proposal = { id: 'x', kind: 'alliance', from: 'r0', to: 'r3', created: 1, expires: 3 }
    DEALINGS.on = false
    const v = evaluateProposal(lo, map, 'r3', p, createRng(1, 1))
    expect(v.trust).toBeUndefined()
  })

  it('a joint venture needs less opinion from a partner that trusts you, more from one that does not, and says why', () => {
    const lo = world()
    lo.infamy = { r0: 60 }
    const r = reception(lo, map, 'r3', 'r0', 'venture', 0)
    expect(r.trust?.shift).toBeLessThan(0)
    DEALINGS.on = false
    const off = reception(lo, map, 'r3', 'r0', 'venture', 0)
    expect(off.trust).toBeUndefined()
    expect(r.need - off.need).toBe(-r.trust!.shift)
    expect(Math.abs(r.trust!.shift)).toBeLessThanOrEqual(DEALINGS.trust.venture)
  })
})

describe('investment counts under the desk’s caps (DEALINGS)', () => {
  it('the thanks is softened by the warmth factor and stops at the 45 that all acts can give', () => {
    const s = world()
    expect(thankInvestment(s, 'r3', 'r0', 60)).toBe(TIES.invest.thanks)
    // A nation given a great deal lately takes the next thanks for less.
    s.relations!.soft['r3>r0'] = RELATIONS.softCap
    const s2 = structuredClone(s)
    delete s2.opinions['r3>r0']
    expect(thankInvestment(s2, 'r3', 'r0', 60)).toBeCloseTo(TIES.invest.thanks * warmthFactor(s, 'r3', 'r0'))
    // At the earned cap nothing more is added.
    const full = world()
    addOpinion(full, 'r3', 'r0', 'State visit', RELATIONS.earnedCap, 0.1)
    expect(thankInvestment(full, 'r3', 'r0', 60)).toBe(0)
    // It is contact and goes in the partners' history.
    expect(s.relations!.contact['r0|r3']).toBe(s.turn)
    expect(s.relations!.log.at(-1)?.act).toBe('invest')
  })

  it('the invest order uses it; the money itself is still its own lasting line', () => {
    const s = world()
    s.nations.r3.sectors.manufacturing = 10
    addOpinion(s, 'r3', 'r0', 'State visit', RELATIONS.earnedCap, 0.1)
    const next = resolveTurn(s, map, [{ type: 'invest', nationId: 'r0', target: 'r3', sector: 'manufacturing', amount: 40 }])
    expect((next.opinions['r3>r0'] ?? []).some((m) => m.label === 'Invested in our businesses')).toBe(false)
    expect(opinionReport(next, map, 'r3', 'r0').parts.some((p) => p.label === 'Invests in our economy')).toBe(true)
    DEALINGS.on = false
    const old = resolveTurn(s, map, [{ type: 'invest', nationId: 'r0', target: 'r3', sector: 'manufacturing', amount: 40 }])
    expect((old.opinions['r3>r0'] ?? []).some((m) => m.label === 'Invested in our businesses')).toBe(true)
  })
})

describe('a long peace on a save from before ties', () => {
  it('a save without a record starts it at load: no long peace for 12 months, then it grows as usual', () => {
    const s = world()
    s.turn = 40
    delete s.ties
    const loaded = normalizeGame(structuredClone(s), map)
    expect(loaded.ties?.since).toBe(40)
    expect(peaceMonths(loaded, 'r0', 'r1')).toBe(0)
    expect(tieLines(loaded, 'r1', 'r0', true).some((l) => l.label === 'Long peace')).toBe(false)
    loaded.turn = 52
    expect(tieLines(loaded, 'r1', 'r0', true).some((l) => l.label === 'Long peace')).toBe(false)
    loaded.turn = 54
    expect(tieLines(loaded, 'r1', 'r0', true).find((l) => l.label === 'Long peace')?.value).toBeCloseTo(TIES.peace.step * 2)
    // Before this, the same save counted 39 months of peace at once.
    expect(peaceMonths(s, 'r0', 'r1')).toBe(39)
  })

  it('a new game, a save that kept its record, and DEALINGS off are unchanged', () => {
    const fresh = world()
    expect(normalizeGame(structuredClone(fresh), map).ties).toBeUndefined()
    const kept = world()
    kept.turn = 30
    kept.ties = { fought: { 'r0|r1': 10 }, tradeSince: {}, tradeLast: {} }
    expect(normalizeGame(structuredClone(kept), map).ties).toEqual(kept.ties)
    DEALINGS.on = false
    const old = world()
    old.turn = 40
    expect(normalizeGame(structuredClone(old), map).ties).toBeUndefined()
  })

  it('a war going on in the old save is recorded at load', () => {
    const s = world()
    s.turn = 40
    s.wars.push('r0|r1')
    const loaded = normalizeGame(structuredClone(s), map)
    expect(loaded.ties?.fought['r0|r1']).toBe(40)
  })
})
