import { afterEach, describe, expect, it } from 'vitest'
import { generateBotOrders } from '../../ai/bot'
import { DEALINGS } from '../../data/relations'
import { advise } from '../advisor'
import { startLive } from '../live'
import { offerIsMoot } from '../offers'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState, Proposal } from '../types'
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

describe('the engine withdraws offers the world has overtaken (DEALINGS)', () => {
  const pact = (s: GameState, from: string, id = `p-${from}`): Proposal => ({ id, kind: 'pact', from, to: 'r0', created: s.turn, expires: s.turn + 2 })

  afterEach(() => {
    DEALINGS.on = true
  })

  it('at the month end: a pact offer from a new ally is withdrawn with a line in the news, the stranger’s offer stays', () => {
    const s = startState(map)
    s.alliances.push('r0|r1')
    s.proposals.push(pact(s, 'r1'), pact(s, 'r2'))
    const next = resolveTurn(s, map, [])
    expect(next.proposals.map((p) => p.id)).toEqual(['p-r2'])
    expect(next.log.map((l) => l.text)).toContain(`${s.nations.r1.name}'s offer of a non-aggression pact to ${s.nations.r0.name} was withdrawn: they are allies now.`)
    expect(next.dispatches.some((d) => d.kind === 'expired' && d.from === 'r1' && d.proposalKind === 'pact')).toBe(true)
  })

  it('a moot offer on its last month is withdrawn, not counted as ignored', () => {
    const s = startState(map)
    s.alliances.push('r0|r1')
    s.proposals.push({ ...pact(s, 'r1'), expires: s.turn })
    const next = resolveTurn(s, map, [])
    expect(next.proposals).toEqual([])
    expect((next.opinions['r1>r0'] ?? []).some((m) => m.label === 'Ignored our offer')).toBe(false)
    // Before, the same offer expired as ignored and cost the player's standing with r1.
    DEALINGS.on = false
    const old = resolveTurn(s, map, [])
    expect((old.opinions['r1>r0'] ?? []).some((m) => m.label === 'Ignored our offer')).toBe(true)
  })

  it('a shortfall the player can fix is not moot, and is kept', () => {
    const s = startState(map)
    s.nations.r1.resources.capital = 0
    s.proposals.push({ id: 'loan', kind: 'loan', from: 'r1', to: 'r0', created: s.turn, expires: s.turn + 2, amount: 100, months: 12 })
    expect(resolveTurn(s, map, []).proposals.map((p) => p.id)).toEqual(['loan'])
  })

  it('a pact that lapses this month makes an offer of a new one possible again: it is not withdrawn', () => {
    const s = startState(map)
    s.pacts['r0|r1'] = s.turn
    s.proposals.push(pact(s, 'r1'))
    expect(offerIsMoot(s, map, s.proposals[0])).toBe(true)
    expect(resolveTurn(s, map, []).proposals.map((p) => p.id)).toEqual(['p-r1'])
  })

  it('on the live clock: accepting an alliance withdraws the same nation’s pact offer that day', () => {
    const s = startLive(startState(map))
    s.proposals.push(pact(s, 'r1'), { id: 'ally', kind: 'alliance', from: 'r1', to: 'r0', created: s.turn, expires: s.turn + 2 })
    const res = applyOrderNow(s, map, { type: 'respond', nationId: 'r0', proposalId: 'ally', accept: true })
    expect(res.error).toBeNull()
    expect(s.alliances).toContain('r0|r1')
    expect(s.proposals).toEqual([])
    expect(s.log.at(-1)?.text).toMatch(/offer of a non-aggression pact .* was withdrawn: they are allies now/)
    expect(s.log.at(-1)?.day).toBe(s.day)
  })

  it('a turn game waits for the month end, and with DEALINGS off nothing is withdrawn on a live clock', () => {
    const turn = startState(map)
    turn.proposals.push(pact(turn, 'r1'), { id: 'ally', kind: 'alliance', from: 'r1', to: 'r0', created: turn.turn, expires: turn.turn + 2 })
    applyOrderNow(turn, map, { type: 'respond', nationId: 'r0', proposalId: 'ally', accept: true })
    expect(turn.proposals.map((p) => p.id)).toEqual(['p-r1'])
    DEALINGS.on = false
    const live = startLive(startState(map))
    live.proposals.push(pact(live, 'r1'), { id: 'ally', kind: 'alliance', from: 'r1', to: 'r0', created: live.turn, expires: live.turn + 2 })
    applyOrderNow(live, map, { type: 'respond', nationId: 'r0', proposalId: 'ally', accept: true })
    expect(live.proposals.map((p) => p.id)).toEqual(['p-r1'])
  })

  it('a bot standing in for a player does not answer an offer that is moot', () => {
    const s = startState(map)
    s.alliances.push('r0|r1')
    s.proposals.push(pact(s, 'r1'), pact(s, 'r2'))
    const answers = generateBotOrders(s, map, 'r0', true).filter((o) => o.type === 'respond')
    expect(answers.map((o) => (o.type === 'respond' ? o.proposalId : ''))).toEqual(['p-r2'])
  })
})
