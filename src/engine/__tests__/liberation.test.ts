import { describe, expect, it } from 'vitest'
import { liberationChoice } from '../../ai/puppets'
import { peaceTerms } from '../../ai/bot'
import { LIBERATE_TEXT, PUPPET } from '../../data/puppets'
import { evaluateProposal } from '../../ai/diplomat'
import { declareWar, describeProposal, propose, respond, validateProposal } from '../diplomacy'
import { atWar, grantJustification } from '../helpers'
import { liberationProblem, bindPuppet, extraction } from '../puppets'
import { createRng } from '../rng'
import { resolveTurn } from '../resolveTurn'
import type { GameState, PeaceTerms, Proposal } from '../types'
import { liberateValue, termsCost, validatePeaceTerms } from '../warscore'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

/** r0 (the winner) is at war with r1, whose puppet is r2. r1 is the human, so its answer is its own. */
function world(loyalty = 60): GameState {
  const s = startState(map, 'r0', 4)
  s.humans = ['r1']
  s.nations.r1.isPlayer = true
  s.nations.r0.isPlayer = false
  s.playerId = 'r1'
  bindPuppet(s, 'r2', 'r1')
  s.nations.r2.loyalty = loyalty
  s.wars.push('r0|r1')
  s.warStarted['r0|r1'] = s.turn
  s.warScore['r0>r1'] = 90
  return s
}

const terms = (extra: Partial<PeaceTerms> = {}): PeaceTerms => ({ cede: [], reparations: 0, ...extra })
const offer = (s: GameState, t: PeaceTerms): Proposal => {
  const p = { kind: 'peace', terms: t, id: 'p1', from: 'r0', to: 'r1', created: s.turn, expires: s.turn + 6 } as Proposal
  s.proposals.push(p)
  return p
}

describe('liberate: a peace term that frees a puppet', () => {
  it('needs a cause: neither a quiet puppet nor a war for another reason will do', () => {
    const s = world(60)
    expect(liberationProblem(s, 'r0', 'r1', 'r2')).toMatch(/no cause/)
    expect(validatePeaceTerms(s, map, terms({ liberate: 'r2' }), 'r0', 'r1')).toMatch(/no cause/)
  })

  it('a puppet that cries out (loyalty under the limit) may be freed', () => {
    const s = world(PUPPET.liberate.below - 1)
    expect(liberationProblem(s, 'r0', 'r1', 'r2')).toBeNull()
    expect(validatePeaceTerms(s, map, terms({ liberate: 'r2' }), 'r0', 'r1')).toBeNull()
    const edge = world(PUPPET.liberate.below)
    expect(liberationProblem(edge, 'r0', 'r1', 'r2')).toMatch(/no cause/)
  })

  it('a war declared under "Free X from Y" is the cause, whatever the loyalty', () => {
    const s = world(70)
    s.wars = []
    s.warStarted = {}
    grantJustification(s, 'r0', 'r1', LIBERATE_TEXT.cause(s.nations.r2.name, s.nations.r1.name), 12)
    declareWar(s, map, 'r0', 'r1', createRng(1, 1))
    expect(s.liberationWars?.['r0>r1']).toEqual(['r2'])
    expect(liberationProblem(s, 'r0', 'r1', 'r2')).toBeNull()
  })

  it('a war for some other reason leaves no cause, and an old record does not outlive the war', () => {
    const s = world(70)
    s.wars = []
    s.liberationWars = { 'r0>r1': ['r2'] }
    grantJustification(s, 'r0', 'r1', 'Border incident', 12)
    declareWar(s, map, 'r0', 'r1', createRng(1, 1))
    expect(s.liberationWars?.['r0>r1']).toBeUndefined()
    expect(liberationProblem(s, 'r0', 'r1', 'r2')).toMatch(/no cause/)
  })

  it('refuses a nation that is not the master\'s puppet, a peace not at war, and a puppet asking', () => {
    const s = world(5)
    expect(validatePeaceTerms(s, map, terms({ liberate: 'r3' }), 'r0', 'r1')).toMatch(/not a puppet/)
    expect(validatePeaceTerms(s, map, terms({ liberate: 'nowhere' }), 'r0', 'r1')).toMatch(/not a puppet/)
    const lone = world(5)
    lone.wars = []
    expect(validateProposal(lone, map, 'r0', 'r1', { kind: 'peace', terms: terms({ liberate: 'r2' }) })).toMatch(/Not at war/)
    const slave = world(5)
    bindPuppet(slave, 'r0', 'r5')
    expect(liberationProblem(slave, 'r0', 'r1', 'r2')).toMatch(/puppet cannot/)
  })

  it('costs war score, less than making the puppet its own', () => {
    const s = world(5)
    const cost = termsCost(s, map, terms({ liberate: 'r2' }), 'r0', 'r1').demand
    expect(cost).toBe(liberateValue(s, map, 'r2'))
    expect(cost).toBeGreaterThan(0)
    s.warScore['r0>r1'] = cost - 1
    expect(validatePeaceTerms(s, map, terms({ liberate: 'r2' }), 'r0', 'r1')).toMatch(/exceed your war score/)
    s.warScore['r0>r1'] = cost
    expect(validatePeaceTerms(s, map, terms({ liberate: 'r2' }), 'r0', 'r1')).toBeNull()
  })

  it('accepted: independent, no tribute, grateful, at peace with its liberator', () => {
    const s = world(5)
    // Dragged into the war on its master's side.
    s.wars.push('r0|r2')
    s.nations.r2.tribute = { form: 'money', share: 0.3 }
    const before = s.nations.r2.opinions?.r0 ?? 0
    const p = offer(s, terms({ liberate: 'r2' }))
    respond(s, map, 'r1', p.id, true, createRng(1, 1))
    const r2 = s.nations.r2
    expect(r2.overlord).toBeNull()
    expect(r2.loyalty).toBeUndefined()
    expect(r2.tribute).toBeUndefined()
    expect(atWar(s, 'r0', 'r1')).toBe(false)
    expect(atWar(s, 'r0', 'r2')).toBe(false)
    expect(extraction(s, map, 'r1').total).toBe(0)
    expect(JSON.stringify(s.opinions ?? {})).toContain(LIBERATE_TEXT.opinion)
    void before
    expect(s.log.some((l) => l.text === LIBERATE_TEXT.log(s.nations.r0.name, r2.name, s.nations.r1.name))).toBe(true)
    // The record of the war is gone with the peace.
    expect(s.liberationWars?.['r0>r1']).toBeUndefined()
  })

  it('a freed puppet pays nothing in the months that follow', () => {
    const s = world(5)
    s.nations.r2.tribute = { form: 'money', share: 0.3 }
    respond(s, map, 'r1', offer(s, terms({ liberate: 'r2' })).id, true, createRng(1, 1))
    let cur = s
    for (let i = 0; i < 3; i++) cur = resolveTurn(cur, map, [])
    expect(cur.nations.r2.overlord).toBeNull()
    expect(cur.nations.r2.loyalty).toBeUndefined()
  })

  it('the offer reads in plain words, from data the screen can reuse', () => {
    const s = world(5)
    const text = describeProposal(s, map, offer(s, terms({ liberate: 'r2' })))
    expect(text).toContain(LIBERATE_TEXT.describe(s.nations.r2.name, s.nations.r1.name))
    expect(LIBERATE_TEXT.term.length).toBeGreaterThan(3)
    expect(LIBERATE_TEXT.hint).toMatch(/cause/)
  })

  it('a bot master refuses when it is holding its own and accepts when the war has bled it', () => {
    const botMaster = (weary: number, mine: number, theirs: number) => {
      const s = world(5)
      s.humans = ['r0']
      s.nations.r0.isPlayer = true
      s.nations.r1.isPlayer = false
      s.playerId = 'r0'
      s.warScore['r0>r1'] = 30
      s.nations.r1.warWeariness = weary
      s.nations.r1.personality = 'honorable'
      setMilitary(s, 'r0', { infantry: theirs })
      setMilitary(s, 'r1', { infantry: mine })
      s.warStarted['r0|r1'] = s.turn - 10
      return s
    }
    const strong = botMaster(0, 60, 5)
    propose(strong, map, 'r0', 'r1', { kind: 'peace', terms: terms({ liberate: 'r2' }) }, createRng(3, 1))
    expect(atWar(strong, 'r0', 'r1')).toBe(true)
    expect(strong.nations.r2.overlord).toBe('r1')
    const weak = botMaster(40, 5, 60)
    propose(weak, map, 'r0', 'r1', { kind: 'peace', terms: terms({ liberate: 'r2' }) }, createRng(3, 1))
    expect(atWar(weak, 'r0', 'r1')).toBe(false)
    expect(weak.nations.r2.overlord).toBeNull()
  })
})

describe('bots and liberation', () => {
  it('a bot that is only just persuaded still will not give up a puppet (the guard band of the verdict)', () => {
    const reasons = new Set<string>()
    for (let weary = 0; weary <= 50; weary += 2) {
      for (let seed = 1; seed <= 12; seed++) {
        const s = world(5)
        s.humans = ['r0']
        s.nations.r0.isPlayer = true
        s.nations.r1.isPlayer = false
        s.playerId = 'r0'
        s.warScore['r0>r1'] = 30
        s.nations.r1.warWeariness = weary
        s.warStarted['r0|r1'] = s.turn - 10
        const p = { kind: 'peace', terms: terms({ liberate: 'r2' }), id: 'p1', from: 'r0', to: 'r1', created: s.turn, expires: s.turn + 6 } as Proposal
        reasons.add(evaluateProposal(s, map, 'r1', p, createRng(seed, 1)).reason)
      }
    }
    expect([...reasons].some((r) => r.includes(LIBERATE_TEXT.refusal))).toBe(true)
  })

  it('Hard asks for it when it has cause and the score; Medium and Easy never do', () => {
    const s = world(5)
    s.warScore['r0>r1'] = 20
    const need = liberateValue(s, map, 'r2')
    expect(need).toBeLessThanOrEqual(17)
    expect(peaceTerms(s, map, 'r0', 'r1', 20, false, 2).liberate).toBe('r2')
    expect(peaceTerms(s, map, 'r0', 'r1', 20, false, 1).liberate).toBeUndefined()
    expect(peaceTerms(s, map, 'r0', 'r1', 20, false, 0).liberate).toBeUndefined()
  })

  it('does not free a puppet it has no cause for, or cannot afford', () => {
    const quiet = world(60)
    expect(peaceTerms(quiet, map, 'r0', 'r1', 20, false, 2).liberate).toBeUndefined()
    const poor = world(5)
    const cost = liberateValue(poor, map, 'r2')
    expect(liberationChoice(poor, map, 'r0', 'r1', cost - 1, 2)).toBeNull()
    expect(liberationChoice(poor, map, 'r0', 'r1', cost, 2)?.id).toBe('r2')
  })

  it('the terms it makes pass validation', () => {
    const s = world(5)
    s.warScore['r0>r1'] = 30
    const t = peaceTerms(s, map, 'r0', 'r1', 30, false, 2)
    expect(validatePeaceTerms(s, map, t, 'r0', 'r1')).toBeNull()
  })
})
