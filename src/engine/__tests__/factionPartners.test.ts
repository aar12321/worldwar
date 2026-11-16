import { describe, expect, it } from 'vitest'
import { addOpinion } from '../../ai/opinion'
import { inviteOutlook } from '../../ai/factions'
import { FACTION } from '../../data/factions'
import { advise } from '../advisor'
import { factionNews, factionOf } from '../factions'
import { pairKey } from '../helpers'
import { invitablePartners, inviteCandidates, partnerRelations } from '../partners'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { validateOrder } from '../orders'
import type { GameState, NationId, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

/**
 * The bug: "if I partner someone on the diplomacy tab I cannot find them in my faction to invite".
 * The invite list was the whole world by strength, with nations already in a faction left out without a word,
 * and only allies marked as partners.
 */
const map = lineMap(8)

function world(humans: NationId[] = ['r0']): GameState {
  const s = startState(map, 'r0', 3)
  s.humans = humans
  for (const id of Object.keys(s.nations)) {
    const n = s.nations[id]
    n.resources.capital = 1000
    n.resources.pp = 300
    n.resources.oil = 100
    n.resources.steel = 100
    n.isPlayer = humans.includes(id)
    setMilitary(s, id, { infantry: 10 })
  }
  s.humans = humans
  return s
}

const ok = (s: GameState, o: Order) => {
  const r = applyOrderNow(s, map, o)
  expect(r.error, JSON.stringify(o)).toBeNull()
}
const refused = (s: GameState, o: Order, pending: Order[] = []) => validateOrder(s, map, o, pending)

function withFaction(humans: NationId[] = ['r0']) {
  const s = world(humans)
  ok(s, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
  return { s, f: factionOf(s, 'r0')! }
}

describe('partners in the Diplomacy sense', () => {
  it('lists allies, pact partners, guarantees both ways, trade and loans, and not reparations or the dead', () => {
    const s = world()
    s.alliances.push(pairKey('r0', 'r1'))
    s.pacts[pairKey('r0', 'r2')] = s.turn + 10
    s.guarantees.push({ from: 'r3', to: 'r0', until: s.turn + 10 }, { from: 'r0', to: 'r4', until: s.turn + 10 })
    const deal = (id: string, kind: 'trade' | 'loan' | 'reparations', from: string, to: string) => s.deals.push({ id, kind, from, to, give: {}, receive: {}, until: s.turn + 5 } as never)
    deal('d1', 'trade', 'r0', 'r5')
    deal('d2', 'loan', 'r6', 'r0')
    deal('d3', 'reparations', 'r7', 'r0')
    const p = partnerRelations(s, 'r0')
    expect(p.get('r1')).toEqual(['ally'])
    expect(p.get('r2')).toEqual(['pact'])
    expect(p.get('r3')).toEqual(['guarantor'])
    expect(p.get('r4')).toEqual(['guarded'])
    expect(p.get('r5')).toEqual(['trade'])
    expect(p.get('r6')).toEqual(['loan'])
    expect(p.has('r7')).toBe(false)
    s.nations.r5.alive = false
    expect(partnerRelations(s, 'r0').has('r5')).toBe(false)
    s.pacts[pairKey('r0', 'r2')] = s.turn - 1
    expect(partnerRelations(s, 'r0').has('r2')).toBe(false)
  })

  it('an expired guarantee is not a partnership', () => {
    const s = world()
    s.guarantees.push({ from: 'r3', to: 'r0', until: s.turn - 1 })
    expect(partnerRelations(s, 'r0').has('r3')).toBe(false)
  })
})

describe('the invite list never loses a nation', () => {
  it('has every living nation but you, with the reason when it cannot be invited', () => {
    const { s, f } = withFaction()
    const other = s.nations.r2
    // r2 is in another faction, r3 is a puppet, r4 is at war with a member.
    s.factions!.push({ ...structuredClone(f), id: 'f2', name: 'Other Pact', founder: 'r2', members: ['r2'], invites: [] })
    other.isPlayer = false
    s.nations.r3.overlord = 'r6'
    s.wars.push(pairKey('r0', 'r4'))
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r5' })
    const rows = inviteCandidates(s, map, 'r0', factionOf(s, 'r0')!)
    const alive = Object.values(s.nations).filter((n) => n.alive && n.id !== 'r0').map((n) => n.id)
    expect(rows.map((r) => r.id).sort()).toEqual([...alive].sort())
    const by = (id: string) => rows.find((r) => r.id === id)!
    expect(by('r2').problem).toMatch(/already in a faction \(Other Pact\)/)
    expect(by('r2').inFaction?.id).toBe('f2')
    expect(by('r3').problem).toMatch(/puppet/)
    expect(by('r4').problem).toMatch(/at war with a member \(/)
    expect(by('r1').problem).toBeNull()
    expect(by('r1').outlook).not.toBeNull()
  })

  it('shows your own members as in your faction, and says when the faction is full', () => {
    const { s, f } = withFaction()
    f.members.push('r1')
    expect(inviteCandidates(s, map, 'r0', f).find((r) => r.id === 'r1')!.problem).toMatch(/already in a faction \(yours\)/)
    for (const id of ['r2', 'r3', 'r4', 'r5', 'r6', 'r7']) f.members.push(id)
    expect(f.members.length).toBe(FACTION.maxMembers)
    s.nations.r1.alive = true
    const rows = inviteCandidates(s, map, 'r0', f)
    expect(rows.length).toBe(7)
    expect(rows.every((r) => !!r.problem)).toBe(true)
  })

  it('puts partners first, whatever their size, and everyone else by what they think of you', () => {
    const { s, f } = withFaction()
    // r7 is the smallest on the line; it is a pact partner. The others are strangers, r3 likes us most.
    s.pacts[pairKey('r0', 'r7')] = s.turn + 10
    addOpinion(s, 'r3', 'r0', 'Friends', 50, 0.01)
    addOpinion(s, 'r2', 'r0', 'Dislike', -40, 0.01)
    const rows = inviteCandidates(s, map, 'r0', f)
    expect(rows[0].id).toBe('r7')
    expect(rows[0].relations).toEqual(['pact'])
    const rest = rows.slice(1).filter((r) => !r.problem)
    expect(rest[0].id).toBe('r3')
    expect(rest.map((r) => r.opinion)).toEqual([...rest.map((r) => r.opinion)].sort((a, b) => b - a))
    expect(rest.at(-1)!.id).toBe('r2')
  })

  it('a partner that cannot be invited stays in the partner group, below the ones that can', () => {
    const { s, f } = withFaction()
    s.pacts[pairKey('r0', 'r1')] = s.turn + 10
    s.pacts[pairKey('r0', 'r2')] = s.turn + 10
    s.nations.r1.overlord = 'r5'
    const rows = inviteCandidates(s, map, 'r0', f)
    expect(rows[0].id).toBe('r2')
    expect(rows[1].id).toBe('r1')
    expect(rows[1].problem).toMatch(/puppet/)
    expect(invitablePartners(s, map, 'r0', f).map((c) => c.id)).toEqual(['r2'])
  })

  it('every partner of every kind can be invited by the real order, not just listed', () => {
    const { s, f } = withFaction()
    s.alliances.push(pairKey('r0', 'r1'))
    s.pacts[pairKey('r0', 'r2')] = s.turn + 10
    s.guarantees.push({ from: 'r0', to: 'r3', until: s.turn + 10 })
    s.deals.push({ id: 'd1', kind: 'trade', from: 'r0', to: 'r4', give: {}, receive: {}, until: s.turn + 5 } as never)
    for (const id of ['r1', 'r2', 'r3', 'r4']) expect(refused(s, { type: 'factionInvite', nationId: 'r0', target: id })).toBeNull()
    expect(invitablePartners(s, map, 'r0', f).map((c) => c.id).sort()).toEqual(['r1', 'r2', 'r3', 'r4'])
  })
})

describe('what an invitation costs you and how it goes', () => {
  it('a rival that its difficulty keeps out is refused up front, a player is not', () => {
    const s = world(['r0', 'r1'])
    s.settings.difficulty = 'easy'
    ok(s, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    expect(refused(s, { type: 'factionInvite', nationId: 'r0', target: 'r2' })).toMatch(/will not join a faction on this difficulty/)
    expect(refused(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })).toBeNull()
  })

  it('tells the inviter when a rival says no, and when it says yes', () => {
    const { s } = withFaction()
    addOpinion(s, 'r1', 'r0', 'Friends', 70, 0.01)
    addOpinion(s, 'r2', 'r0', 'Hated', -70, 0.01)
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r2' })
    const yes = s.dispatches.find((d) => d.from === 'r1')
    const no = s.dispatches.find((d) => d.from === 'r2')
    expect(yes).toMatchObject({ kind: 'accepted', to: 'r0', proposalKind: 'faction' })
    expect(yes!.text).toMatch(/accepted your invitation/)
    expect(no).toMatchObject({ kind: 'rejected', to: 'r0', proposalKind: 'faction' })
    expect(no!.text).toMatch(/turned down your invitation/)
  })

  it('rivals inviting each other is not news for the player', () => {
    const s = world(['r0'])
    ok(s, { type: 'factionFound', nationId: 'r1', name: 'Rival Pact' })
    addOpinion(s, 'r2', 'r1', 'Friends', 70, 0.01)
    s.nations.r1.isPlayer = false
    s.dispatches = []
    ok(s, { type: 'factionInvite', nationId: 'r1', target: 'r2' })
    expect(s.dispatches.filter((d) => d.proposalKind === 'faction')).toHaveLength(0)
  })

  it('a player who joins tells the inviter', () => {
    const s = world(['r0', 'r1'])
    ok(s, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
    const f = factionOf(s, 'r0')!
    ok(s, { type: 'factionJoin', nationId: 'r1', factionId: f.id })
    expect(s.dispatches.some((d) => d.proposalKind === 'faction' && d.kind === 'accepted' && d.from === 'r1' && d.to === 'r0')).toBe(true)
  })

  it('the notes survive a month end: they are in the month that follows the order', () => {
    const { s } = withFaction()
    addOpinion(s, 'r1', 'r0', 'Friends', 70, 0.01)
    const next = resolveTurn(s, map, [{ type: 'factionInvite', nationId: 'r0', target: 'r1' }])
    expect(next.dispatches.some((d) => d.proposalKind === 'faction' && d.from === 'r1')).toBe(true)
  })
})

describe('asking to join', () => {
  const set = (s: GameState, id: string, charge: number) => {
    s.nations[id].resources.pp = charge
  }

  it('costs influence and needs a faction that exists, has room, and is not at war with you', () => {
    const s = world(['r0'])
    ok(s, { type: 'factionFound', nationId: 'r1', name: 'Rival Pact' })
    const f = factionOf(s, 'r1')!
    const ask: Order = { type: 'factionRequest', nationId: 'r0', factionId: f.id }
    expect(refused(s, { ...ask, factionId: 'nope' } as Order)).toMatch(/No such faction/)
    set(s, 'r0', 1)
    expect(refused(s, ask)).toMatch(/influence/)
    set(s, 'r0', 100)
    expect(refused(s, ask)).toBeNull()
    s.wars.push(pairKey('r0', 'r1'))
    expect(refused(s, ask)).toMatch(/at war with/)
    s.wars.pop()
    f.invites.push({ nation: 'r0', by: 'r1', expires: s.turn + 2 })
    expect(refused(s, ask)).toMatch(/already invited you/)
    f.invites.pop()
    for (const id of ['r2', 'r3', 'r4', 'r5', 'r6', 'r7']) f.members.push(id)
    f.members.push('x')
    expect(refused(s, ask)).toMatch(/is full/)
    s.nations.r0.overlord = 'r6'
    expect(refused(s, ask)).toMatch(/puppet/)
  })

  it('one request at a time, and not on a difficulty that closes rival factions', () => {
    const s = world(['r0'])
    ok(s, { type: 'factionFound', nationId: 'r1', name: 'Rival Pact' })
    const f = factionOf(s, 'r1')!
    const ask: Order = { type: 'factionRequest', nationId: 'r0', factionId: f.id }
    expect(refused(s, ask, [ask])).toMatch(/Already asked/)
    s.settings.difficulty = 'easy'
    expect(refused(s, ask)).toMatch(/keep Rival Pact closed/)
  })

  it('a faction run by rivals takes in a nation they like, and turns away one they do not, and says so', () => {
    const s = world(['r0'])
    ok(s, { type: 'factionFound', nationId: 'r1', name: 'Rival Pact' })
    const f = factionOf(s, 'r1')!
    const pp = s.nations.r0.resources.pp
    addOpinion(s, 'r1', 'r0', 'Friends', 80, 0.01)
    ok(s, { type: 'factionRequest', nationId: 'r0', factionId: f.id })
    expect(s.nations.r0.resources.pp).toBe(pp - FACTION.requestInfluence)
    expect(f.members).toContain('r0')
    expect(s.dispatches.find((d) => d.to === 'r0' && d.proposalKind === 'faction')).toMatchObject({ kind: 'accepted' })

    const t = world(['r0'])
    ok(t, { type: 'factionFound', nationId: 'r1', name: 'Rival Pact' })
    addOpinion(t, 'r1', 'r0', 'Hated', -80, 0.01)
    const g = factionOf(t, 'r1')!
    ok(t, { type: 'factionRequest', nationId: 'r0', factionId: g.id })
    expect(g.members).toEqual(['r1'])
    expect(t.dispatches.find((d) => d.to === 'r0' && d.proposalKind === 'faction')).toMatchObject({ kind: 'rejected' })
  })

  it('a faction with a player in it keeps the request, tells them, and joins the asker the moment they invite it', () => {
    const s = world(['r0', 'r1'])
    ok(s, { type: 'factionFound', nationId: 'r1', name: 'Player Pact' })
    const f = factionOf(s, 'r1')!
    const before = structuredClone(s)
    ok(s, { type: 'factionRequest', nationId: 'r0', factionId: f.id })
    expect(f.requests).toEqual([{ nation: 'r0', expires: s.turn + FACTION.requestMonths }])
    expect(f.members).toEqual(['r1'])
    expect(factionNews(before, s, 'r1').join(' ')).toMatch(/r0|asks to join Player Pact/i)
    // Even on a difficulty that shuts rivals out, the player who asked can be taken.
    s.settings.difficulty = 'easy'
    expect(refused(s, { type: 'factionInvite', nationId: 'r1', target: 'r0' })).toBeNull()
    ok(s, { type: 'factionInvite', nationId: 'r1', target: 'r0' })
    expect(f.members).toEqual(['r1', 'r0'])
    expect(f.requests).toEqual([])
    expect(f.invites).toEqual([])
  })

  it('a request lapses after its months', () => {
    const s = world(['r0', 'r1'])
    ok(s, { type: 'factionFound', nationId: 'r1', name: 'Player Pact' })
    const f = factionOf(s, 'r1')!
    ok(s, { type: 'factionRequest', nationId: 'r0', factionId: f.id })
    let cur = s
    for (let i = 0; i < FACTION.requestMonths + 2; i++) cur = resolveTurn(cur, map, [])
    expect(factionOf(cur, 'r1')!.requests ?? []).toEqual([])
  })
})

describe('the advisor and the odds', () => {
  it('suggests the partners that are not in your faction yet', () => {
    const { s } = withFaction()
    s.turn += 1
    s.alliances.push(pairKey('r0', 'r1'))
    addOpinion(s, 'r1', 'r0', 'Friends', 40, 0.01)
    const tips = advise(s, map, 'r0', [], 99)
    const tip = tips.find((t) => t.id === 'faction-partner')
    expect(tip?.title).toMatch(/Invite .* to your faction/)
    expect(tip?.target).toMatchObject({ desk: 'faction' })
    // Once it is in, the tip goes away.
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
    if (factionOf(s, 'r1')) expect(advise(s, map, 'r0', [], 99).some((t) => t.id === 'faction-partner')).toBe(false)
  })

  it('says nothing when no partner can be invited, and on a difficulty that keeps rivals out', () => {
    const { s } = withFaction()
    expect(advise(s, map, 'r0', [], 99).some((t) => t.id === 'faction-partner')).toBe(false)
    s.alliances.push(pairKey('r0', 'r1'))
    s.settings.difficulty = 'easy'
    expect(advise(s, map, 'r0', [], 99).some((t) => t.id === 'faction-partner')).toBe(false)
  })

  it('the odds follow what the rival thinks of the members', () => {
    const { s, f } = withFaction()
    addOpinion(s, 'r1', 'r0', 'Friends', 80, 0.01)
    addOpinion(s, 'r2', 'r0', 'Hated', -80, 0.01)
    expect(inviteOutlook(s, map, 'r1', f)).toBe('likely')
    expect(inviteOutlook(s, map, 'r2', f)).toBe('unlikely')
    s.settings.difficulty = 'easy'
    expect(inviteOutlook(s, map, 'r1', f)).toBe('unlikely')
  })
})
