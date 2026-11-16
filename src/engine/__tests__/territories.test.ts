import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders, peaceTerms } from '../../ai/bot'
import { evaluateProposal } from '../../ai/diplomat'
import { wantsTerritory } from '../../ai/territories'
import { TERRITORY } from '../../data/territories'
import { FACTION } from '../../data/factions'
import { populationShare, countriesTaken, controlled, economicShare, holdsTheWorld } from '../victory'
import { propose, respond, validateProposal, describeProposal, declareWar } from '../diplomacy'
import { empireCount } from '../empire'
import { factionOf, pruneFactions, tallyOf } from '../factions'
import { atWar, territoriesOf } from '../helpers'
import { applyOrderNow, describeOrder, resolveTurn } from '../resolveTurn'
import { validateOrder, isMonthEndOrder, undoable } from '../orders'
import { bindPuppet } from '../puppets'
import { createRng } from '../rng'
import { annexTerritoryCost, bindTerritory, cutOf, freeTerritory, revenueOf, runTerritoryMonth, territoryProblem, territoryValue } from '../territories'
import type { GameState, Order, PeaceTerms, Proposal } from '../types'
import { killNation } from '../warfare'
import { puppetValue, termsCost, validatePeaceTerms } from '../warscore'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

/** r0 is the master; r1 is made its territory. r0 is the person at the keyboard, so r1 is a bot. */
function world(seed = 5): GameState {
  const s = startState(map, 'r0', seed)
  for (const id of Object.keys(s.nations)) {
    s.nations[id].resources.capital = 1000
    s.nations[id].resources.pp = 400
    s.nations[id].resources.oil = 100
    s.nations[id].resources.steel = 100
    s.nations[id].resources.food = 150
    s.nations[id].resources.goods = 60
    setMilitary(s, id, { infantry: 10, armor: 3 })
  }
  s.nations.r0.tier = 3
  return s
}

function held(): GameState {
  const s = world()
  bindTerritory(s, 'r1', 'r0')
  s.territories!.r1.since = -30
  return s
}

const terms = (extra: Partial<PeaceTerms> = {}): PeaceTerms => ({ cede: [], reparations: 0, ...extra })
const ok = (s: GameState, o: Order) => expect(applyOrderNow(s, map, o).error, JSON.stringify(o)).toBeNull()
const cmd = (inner: Order, territory = 'r1', nationId = 'r0'): Order => ({ type: 'commandTerritory', nationId, territory, order: inner })

/** Sets a number in the data for the length of `fn`: the mutation checks put a wrong rule in and expect the tests' numbers to notice. */
function mutated<T>(obj: Record<string, unknown>, key: string, value: unknown, fn: () => T): T {
  const old = obj[key]
  obj[key] = value
  try {
    return fn()
  } finally {
    obj[key] = old
  }
}

describe('the peace table: make them a territory', () => {
  function atWarWorld(): GameState {
    const s = world()
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = s.turn
    s.warScore['r0>r1'] = 99
    return s
  }

  it('costs more than a puppet of the same size, from the data, and never more than the cap', () => {
    const s = atWarWorld()
    const p = puppetValue(s, map, 'r1')
    expect(territoryValue(s, map, 'r1')).toBe(Math.round(Math.min(TERRITORY.valueCap, p * TERRITORY.valueMult)))
    expect(territoryValue(s, map, 'r1')).toBeGreaterThan(p)
    expect(termsCost(s, map, terms({ territory: true }), 'r0', 'r1').demand).toBe(territoryValue(s, map, 'r1'))
    // Mutation check: with a puppet's price the test's number is wrong.
    expect(mutated(TERRITORY as never, 'valueMult', 1, () => territoryValue(s, map, 'r1'))).toBe(p)
    expect(mutated(TERRITORY as never, 'valueCap', 21, () => territoryValue(s, map, 'r1'))).toBeLessThanOrEqual(21)
  })

  it('is refused without the war score for it, and allowed with it', () => {
    const s = atWarWorld()
    s.warScore['r0>r1'] = 5
    expect(validatePeaceTerms(s, map, terms({ territory: true }), 'r0', 'r1')).toMatch(/exceed your war score/)
    s.warScore['r0>r1'] = 99
    expect(validatePeaceTerms(s, map, terms({ territory: true }), 'r0', 'r1')).toBeNull()
  })

  it('cannot go with a puppet, a liberation, or reparations owed to the master', () => {
    const s = atWarWorld()
    expect(validatePeaceTerms(s, map, terms({ territory: true, puppet: true }), 'r0', 'r1')).toMatch(/territory and a puppet/)
    expect(validatePeaceTerms(s, map, terms({ territory: true, liberate: 'r2' }), 'r0', 'r1')).toMatch(/territory and a puppet/)
    expect(validatePeaceTerms(s, map, terms({ territory: true, reparations: 5 }), 'r0', 'r1')).toMatch(/owes no reparations/)
  })

  it('is not for a nation a person runs, a puppet, a territory, or from a puppet or territory', () => {
    const s = atWarWorld()
    s.humans.push('r1')
    expect(territoryProblem(s, 'r0', 'r1')).toMatch(/run by a player/)
    s.humans = ['r0']
    s.nations.r1.overlord = 'r5'
    expect(territoryProblem(s, 'r0', 'r1')).toMatch(/puppet/)
    s.nations.r1.overlord = null
    s.nations.r1.territoryOf = 'r5'
    expect(territoryProblem(s, 'r0', 'r1')).toMatch(/already a territory/)
    delete s.nations.r1.territoryOf
    s.nations.r0.overlord = 'r5'
    expect(territoryProblem(s, 'r0', 'r1')).toMatch(/puppet cannot hold/)
    s.nations.r0.overlord = null
    s.nations.r0.territoryOf = 'r5'
    expect(territoryProblem(s, 'r0', 'r1')).toMatch(/territory cannot hold/)
  })

  it('a master holds as many as its tier allows, the loser\'s own territories counting too', () => {
    const s = world()
    s.nations.r0.tier = 1
    bindTerritory(s, 'r1', 'r0')
    expect(territoryProblem(s, 'r0', 'r2')).toMatch(/can hold 1 territory/)
    s.nations.r0.tier = 3
    expect(territoryProblem(s, 'r0', 'r2')).toBeNull()
    bindTerritory(s, 'r2', 'r0')
    expect(territoryProblem(s, 'r0', 'r3')).toMatch(/can hold 2 territories/)
    freeTerritory(s, 'r2')
    // r4 holds a territory of its own: it would pass up with r4 and count against the limit.
    freeTerritory(s, 'r2')
    bindTerritory(s, 'r3', 'r4')
    expect(territoryProblem(s, 'r0', 'r4')).toMatch(/can hold 2/)
    s.nations.r0.tier = 4
    expect(territoryProblem(s, 'r0', 'r4')).toBeNull()
    // Mutation check: the table is the limit.
    expect(mutated(TERRITORY as never, 'maxByTier', [9, 9, 9, 9, 9], () => territoryProblem(s, 'r0', 'r4'))).toBeNull()
  })

  it('accepted: the loser becomes a territory, joins the master\'s faction, and the deal reads in words', () => {
    const s = atWarWorld()
    s.humans = ['r1']
    s.nations.r1.isPlayer = true
    // A person's nation cannot be made a territory at all.
    expect(validateProposal(s, map, 'r0', 'r1', { kind: 'peace', terms: terms({ territory: true }) })).toMatch(/run by a player/)
    s.humans = ['r0']
    s.nations.r1.isPlayer = false
    const d = { kind: 'peace', terms: terms({ territory: true }) } as const
    expect(validateProposal(s, map, 'r0', 'r1', d)).toBeNull()
    expect(describeProposal(s, map, { ...d, from: 'r0', to: 'r1' })).toMatch(/becomes a territory of/)
    const p = { ...d, id: 'p1', from: 'r0', to: 'r1', created: s.turn, expires: s.turn + 3 } as Proposal
    s.proposals.push(p)
    s.nations.r1.isPlayer = true
    s.humans = ['r1', 'r0']
    // Accepting at the table is checked again, so a person cannot sign themselves away either.
    respond(s, map, 'r1', 'p1', true, createRng(1, 1))
    expect(s.nations.r1.territoryOf).toBeUndefined()
  })

  it('a bot master offers one only when Hard with a crushing lead, and never to a richer land', () => {
    const oldLand = TERRITORY.ai.minLand
    try {
      botOffers()
    } finally {
      TERRITORY.ai.minLand = oldLand
    }
  })

  function botOffers() {
    const s = atWarWorld()
    s.settings.difficulty = 'hard'
    s.regions.r0.population *= 4
    // A one-country test map is worth less than a real land: the rule's floor is lowered for it.
    TERRITORY.ai.minLand = 1
    expect(wantsTerritory(s, map, 'r0', 'r1', 99, 2)).toBe(true)
    expect(wantsTerritory(s, map, 'r0', 'r1', 99, 1)).toBe(false)
    expect(wantsTerritory(s, map, 'r0', 'r1', 99, 0)).toBe(false)
    expect(wantsTerritory(s, map, 'r0', 'r1', 10, 2)).toBe(false)
    expect(peaceTerms(s, map, 'r0', 'r1', 99, false, 2).territory).toBe(true)
    expect(peaceTerms(s, map, 'r0', 'r1', 99, false, 1).territory).toBeUndefined()
    // Not when the loser out-earns the master.
    s.regions.r1.population *= 40
    for (const k of Object.keys(s.nations.r1.sectors) as (keyof typeof s.nations.r1.sectors)[]) s.nations.r1.sectors[k] = 5
    expect(wantsTerritory(s, map, 'r0', 'r1', 99, 2)).toBe(false)
  }

  it('a bot loser gives itself up only when desperate', () => {
    const s = atWarWorld()
    const p = { kind: 'peace', terms: terms({ territory: true }), id: 'p1', from: 'r0', to: 'r1', created: s.turn, expires: s.turn + 3 } as Proposal
    const rng = createRng(3, 3)
    // A fresh war and a strong army: no.
    s.warScore['r0>r1'] = 0
    s.warStarted['r0|r1'] = s.turn
    expect(evaluateProposal(s, map, 'r1', p, rng).accept).toBe(false)
    // Beaten and exhausted: yes (and the same terms as a puppet would have been taken at a lower score).
    s.warScore['r0>r1'] = 100
    s.warStarted['r0|r1'] = s.turn - 20
    s.nations.r1.warWeariness = 90
    setMilitary(s, 'r1', { infantry: 0.1 })
    const v = evaluateProposal(s, map, 'r1', p, rng)
    expect(v.accept).toBe(true)
  })
})

describe('becoming a territory', () => {
  it('writes it down on the nation and in the record, and a game without one has neither', () => {
    const plain = world()
    expect(plain.territories).toBeUndefined()
    expect(plain.nations.r1.territoryOf).toBeUndefined()
    expect('territoryOf' in plain.nations.r1).toBe(false)
    const s = held()
    expect(s.nations.r1.territoryOf).toBe('r0')
    expect(s.territories!.r1.master).toBe('r0')
    expect(s.nations.r1.overlord).toBeNull()
    expect(s.nations.r1.loyalty).toBeUndefined()
    expect(territoriesOf(s, 'r0')).toEqual(['r1'])
  })

  it('founds a faction for a master that has none, with the default charter, and puts the territory in it', () => {
    const s = world()
    expect(factionOf(s, 'r0')).toBeNull()
    bindTerritory(s, 'r1', 'r0')
    const f = factionOf(s, 'r0')!
    expect(f.members.sort()).toEqual(['r0', 'r1'])
    expect(f.founder).toBe('r0')
    expect(f.charter).toEqual({ vote: 'majority', spoils: 'share', exit: 'refund' })
    expect(factionOf(s, 'r1')!.id).toBe(f.id)
  })

  it('goes into the master\'s existing faction, leaving its own, ignoring the limit on members', () => {
    const s = world()
    s.humans = ['r0', 'r7']
    s.nations.r7.isPlayer = true
    // r1 had a faction of its own with r2.
    const f1 = { id: 'FOLD', name: 'Old', founder: 'r1', founded: 0, charter: { vote: 'majority', spoils: 'share', exit: 'refund' }, members: ['r1', 'r2'], pool: { stock: { money: 0, oil: 0, steel: 0, goods: 0, food: 0 }, units: { infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 } }, ledger: {}, proposals: [], contracts: [], invites: [], wars: [], history: [] } as never
    s.factions = [f1]
    ;(f1 as { ledger: Record<string, unknown> }).ledger = { r1: { stock: { money: 0, oil: 0, steel: 0, goods: 0, food: 0 }, units: {}, last: 0, joined: 0 }, r2: { stock: { money: 0, oil: 0, steel: 0, goods: 0, food: 0 }, units: {}, last: 0, joined: 0 } }
    ok(s, { type: 'factionFound', nationId: 'r0', name: 'Lords' })
    const mine = factionOf(s, 'r0')!
    for (const id of ['r3', 'r4', 'r5', 'r6']) {
      mine.members.push(id)
      mine.ledger[id] = { stock: { money: 0, oil: 0, steel: 0, goods: 0, food: 0 }, units: { infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }, last: 0, joined: 0 }
    }
    mine.members.push('r7')
    mine.ledger.r7 = mine.ledger.r3
    FACTION.maxMembers = mine.members.length
    try {
      bindTerritory(s, 'r1', 'r0')
      expect(factionOf(s, 'r1')!.id).toBe(mine.id)
      expect(factionOf(s, 'r2')!.id).toBe('FOLD')
      expect(mine.members.length).toBe(FACTION.maxMembers + 1)
      // It takes no seat: the faction is as full as it was.
      expect(validateOrder(s, map, { type: 'factionInvite', nationId: 'r0', target: 'r2' })).toMatch(/already in a faction/)
    } finally {
      FACTION.maxMembers = 8
    }
    // The seat is not used: another nation may still be invited... after one leaves; the full count excludes the territory.
    expect(validateOrder(s, map, { type: 'factionInvite', nationId: 'r0', target: 'r2' })).toMatch(/already in a faction/)
  })

  it('forgives the reparations it owed, and owes none after', () => {
    const s = world()
    s.deals.push({ id: 'd1', kind: 'reparations', from: 'r1', to: 'r5', give: { capital: 10 }, receive: {}, until: s.turn + 10 })
    s.deals.push({ id: 'd2', kind: 'reparations', from: 'r5', to: 'r1', give: { capital: 10 }, receive: {}, until: s.turn + 10 })
    bindTerritory(s, 'r1', 'r0')
    expect(s.deals.map((d) => d.id)).toEqual(['d2'])
  })

  it('what the new territory ruled passes up: its puppets and its own territories', () => {
    const s = world()
    bindPuppet(s, 'r2', 'r1')
    bindTerritory(s, 'r3', 'r1')
    bindTerritory(s, 'r1', 'r0')
    expect(s.nations.r2.overlord).toBe('r0')
    expect(s.nations.r3.territoryOf).toBe('r0')
    expect(factionOf(s, 'r3')!.id).toBe(factionOf(s, 'r0')!.id)
  })

  it('a master that becomes a puppet takes its territories up with it', () => {
    const s = world()
    bindTerritory(s, 'r1', 'r0')
    bindPuppet(s, 'r0', 'r5')
    expect(s.nations.r1.territoryOf).toBe('r5')
    expect(s.territories!.r1.master).toBe('r5')
    expect(factionOf(s, 'r1')!.id).toBe(factionOf(s, 'r5')!.id)
  })

  it('a master that becomes a territory takes its territories up with it', () => {
    const s = world()
    bindTerritory(s, 'r1', 'r0')
    bindTerritory(s, 'r0', 'r5')
    expect(s.nations.r1.territoryOf).toBe('r5')
    expect(s.nations.r0.territoryOf).toBe('r5')
    expect(s.territories!.r1.master).toBe('r5')
  })
})

describe('the permanent cut', () => {
  const month = (s: GameState) => {
    const before = { m: s.nations.r0.resources.capital, t: s.nations.r1.resources.capital }
    const c = cutOf(s, map, 'r1')
    runTerritoryMonth(s, map)
    return { taken: before.t - s.nations.r1.resources.capital, given: s.nations.r0.resources.capital - before.m, expected: c }
  }

  it('takes 30% of its revenue (taxes, factories, trade, business tax) and gives it all to the master', () => {
    const s = held()
    const rev = revenueOf(s, map, 'r1')
    expect(rev).toBeGreaterThan(5)
    const r = month(s)
    expect(r.taken).toBeCloseTo(rev * 0.3, 6)
    expect(r.given).toBeCloseTo(rev * 0.3, 6)
    expect(s.territories!.r1.taken).toBeCloseTo(rev * 0.3, 6)
    expect(s.territories!.r1.last).toBeCloseTo(rev * 0.3, 6)
    // Mutation checks: a different share, a different base, or paying it twice would all change this number.
    expect(mutated(TERRITORY as never, 'cut', 0.5, () => month(held()).taken)).toBeCloseTo(revenueOf(held(), map, 'r1') * 0.5, 6)
    expect(mutated(TERRITORY as never, 'cut', 0.3, () => month(held()).taken)).not.toBeCloseTo(revenueOf(held(), map, 'r1') * 0.2, 3)
  })

  it('is not the puppet tribute: no loyalty moves, the cap on tribute does not apply, no tribute is taken', () => {
    const s = held()
    s.nations.r0.resources.capital = 0
    const gross = revenueOf(s, map, 'r0')
    const before = s.nations.r1.resources.capital
    const next = resolveTurn(s, map, [])
    expect(next.nations.r1.loyalty).toBeUndefined()
    expect(next.nations.r1.tribute).toBeUndefined()
    // The master's rise is its own income plus 30% of the territory's, which is well past the puppet cap (25% of its own gross) when the territory is as big.
    const cut = next.territories!.r1.last
    expect(cut).toBeGreaterThan(0)
    expect(cut).toBeLessThanOrEqual(0.3 * revenueOf(s, map, 'r1') * 1.5 + 1e-9)
    expect(before).toBeGreaterThan(0)
    expect(gross).toBeGreaterThan(0)
  })

  it('takes nothing when there is no revenue, and never more than the treasury holds', () => {
    const s = held()
    s.nations.r1.resources.capital = 0.5
    expect(month(s).taken).toBeCloseTo(0.5, 9)
    const t = held()
    t.nations.r1.resources.capital = -50
    expect(month(t).taken).toBe(0)
    expect(t.nations.r1.resources.capital).toBe(-50)
    const z = held()
    for (const k of Object.keys(z.nations.r1.sectors) as (keyof typeof z.nations.r1.sectors)[]) z.nations.r1.sectors[k] = 0
    z.nations.r1.taxRate = 0.1
    z.regions.r1.population = 0
    expect(cutOf(z, map, 'r1').cut).toBeLessThanOrEqual(0.3 * Math.max(0, revenueOf(z, map, 'r1')) + 1e-9)
  })

  it('cannot be lowered, paused or argued with: no order of the territory\'s or the master\'s changes it, and it is taken month after month', () => {
    let s = held()
    s.nations.r1.taxRate = 0.1
    const a = s.nations.r0.resources.capital
    for (let i = 0; i < 6; i++) s = resolveTurn(s, map, [])
    expect(s.territories!.r1.taken).toBeGreaterThan(0)
    expect(s.territories!.r1.taken).toBeGreaterThan(s.territories!.r1.last)
    expect(s.nations.r0.resources.capital).toBeGreaterThan(a)
    // No order exists that touches it: governing a puppet refuses a territory.
    expect(validateOrder(s, map, { type: 'governPuppet', nationId: 'r0', target: 'r1', patch: { taxRate: 0.3 } })).toMatch(/not your puppet/)
  })

  it('is taken for ever: after fifty months the master still takes it, and the totals add up', () => {
    let s = held()
    let sum = 0
    for (let i = 0; i < 24; i++) {
      s = resolveTurn(s, map, [])
      sum += s.territories?.r1.last ?? 0
    }
    expect(s.territories!.r1.taken).toBeCloseTo(sum, 6)
    expect(s.territories!.r1.last).toBeGreaterThanOrEqual(0)
  })
})

describe('the faction: always in it, never out', () => {
  it('cannot leave, found, join or be invited; nor can the master leave while it holds one', () => {
    const s = held()
    const own = (o: Order) => validateOrder(s, map, o)
    expect(own({ type: 'factionLeave', nationId: 'r1' })).toMatch(/must stay/)
    expect(own({ type: 'factionFound', nationId: 'r1', name: 'Free Land' })).toMatch(/decides/)
    expect(own({ type: 'factionLeave', nationId: 'r0' })).toMatch(/territories sit in this faction/)
    expect(own({ type: 'factionInvite', nationId: 'r0', target: 'r1' })).toMatch(/territory|already in a faction/)
    // Free it and the master may leave again.
    freeTerritory(s, 'r1')
    expect(own({ type: 'factionLeave', nationId: 'r0' })).toBeNull()
  })

  it('stays in through months, wars and a dissolved faction record: put back if it was ever left out', () => {
    const s = held()
    const f = factionOf(s, 'r0')!
    f.members = f.members.filter((m) => m !== 'r1')
    delete f.ledger.r1
    expect(factionOf(s, 'r1')).toBeNull()
    runTerritoryMonth(s, map)
    expect(factionOf(s, 'r1')!.id).toBe(f.id)
  })

  it('has no vote and uses no seat: the master speaks for it', () => {
    const s = held()
    const f = factionOf(s, 'r0')!
    const p = { id: 'x1', kind: 'war', by: 'r0', target: 'r5', created: 0, expires: 9, votes: { r0: 'yes' } } as never
    const t = tallyOf(s, f, p)
    expect(t.total).toBe(1)
    expect(t.yes).toBe(1)
    expect(t.waiting).toEqual([])
    expect(t.outcome).toBe('pass')
    // Mutation check: counting the territory as a member leaves one vote waiting and no majority.
    delete s.nations.r1.territoryOf
    expect(tallyOf(s, f, p).waiting).toEqual(['r1'])
  })

  it('goes with the master when the faction fights: it is able to join a faction war, and is not a target of its own faction', () => {
    const s = held()
    const f = factionOf(s, 'r0')!
    expect(validateOrder(s, map, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r1' } })).toMatch(/in the faction/)
    expect(f.members).toContain('r1')
  })
})

describe('wars', () => {
  it('fights in every war its master declares', () => {
    const s = held()
    declareWar(s, map, 'r0', 'r5', createRng(1, 1))
    expect(atWar(s, 'r0', 'r5')).toBe(true)
    expect(atWar(s, 'r1', 'r5')).toBe(true)
    // Even when it had a pact with the foe, and past the limit on wars.
    const t = held()
    t.pacts['r1|r5'] = t.turn + 10
    t.alliances.push('r1|r5')
    declareWar(t, map, 'r0', 'r5', createRng(1, 1))
    expect(atWar(t, 'r1', 'r5')).toBe(true)
    expect(t.pacts['r1|r5']).toBeUndefined()
    expect(t.alliances).not.toContain('r1|r5')
  })

  it('fights in a war the master was already in when it became a territory, and one the master is dragged into', () => {
    const s = world()
    s.wars.push('r0|r5')
    s.warStarted['r0|r5'] = s.turn
    bindTerritory(s, 'r1', 'r0')
    expect(atWar(s, 'r1', 'r5')).toBe(true)
    // The same through the month's housekeeping: a war begun with no declaration is joined next month.
    const t = held()
    t.wars.push('r0|r6')
    t.warStarted['r0|r6'] = t.turn
    runTerritoryMonth(t, map)
    expect(atWar(t, 'r1', 'r6')).toBe(true)
  })

  it('a war on the territory is a war on its master', () => {
    const s = held()
    declareWar(s, map, 'r5', 'r1', createRng(1, 1))
    expect(atWar(s, 'r5', 'r1')).toBe(true)
    expect(atWar(s, 'r5', 'r0')).toBe(true)
    // Unless the master is allied with the attacker.
    const t = held()
    t.alliances.push('r0|r5')
    declareWar(t, map, 'r5', 'r1', createRng(1, 1))
    expect(atWar(t, 'r5', 'r0')).toBe(false)
  })

  it('cannot declare a war or make peace for itself, and nobody can make peace with it but its master', () => {
    const s = held()
    s.wars.push('r0|r5', 'r1|r5')
    expect(validateOrder(s, map, { type: 'declareWar', nationId: 'r1', target: 'r6' })).toMatch(/decides/)
    expect(validateOrder(s, map, { type: 'propose', nationId: 'r1', target: 'r5', proposal: { kind: 'peace', terms: terms() } })).toMatch(/decides/)
    expect(validateProposal(s, map, 'r5', 'r1', { kind: 'peace', terms: terms() })).toMatch(/makes peace for its territory/)
    expect(validateOrder(s, map, { type: 'declareWar', nationId: 'r0', target: 'r1' })).toMatch(/Release/)
  })

  it('peace between the master and the foe ends the territory\'s war with that foe, and the foe\'s territories\' war with the master', () => {
    const s = held()
    bindTerritory(s, 'r6', 'r5')
    declareWar(s, map, 'r0', 'r5', createRng(1, 1))
    expect(atWar(s, 'r1', 'r5')).toBe(true)
    expect(atWar(s, 'r6', 'r0')).toBe(true)
    const p = { kind: 'peace', terms: terms(), id: 'pp', from: 'r0', to: 'r5', created: s.turn, expires: s.turn + 3 } as Proposal
    s.proposals.push(p)
    respond(s, map, 'r5', 'pp', true, createRng(2, 2))
    expect(atWar(s, 'r0', 'r5')).toBe(false)
    expect(atWar(s, 'r1', 'r5')).toBe(false)
    expect(atWar(s, 'r6', 'r0')).toBe(false)
  })

  it('a master can sue for peace in its territory\'s name, but only in a war it is not fighting itself', () => {
    const s = held()
    s.wars.push('r1|r5', 'r0|r6', 'r1|r6')
    s.warScore['r1>r5'] = 10
    const peace = (target: string): Order => cmd({ type: 'propose', nationId: 'r1', target, proposal: { kind: 'peace', terms: terms() } })
    expect(validateOrder(s, map, peace('r5'))).toBeNull()
    expect(validateOrder(s, map, peace('r6'))).toMatch(/make peace yourself/)
    expect(validateOrder(s, map, cmd({ type: 'propose', nationId: 'r1', target: 'r5', proposal: { kind: 'pact' } }))).toMatch(/only asks for peace/)
  })
})

describe('no war reparations', () => {
  it('peace terms never charge a territory, in either direction of the deal', () => {
    const s = held()
    s.wars.push('r5|r1')
    s.warScore['r5>r1'] = 60
    // r5 wins against the territory and asks for reparations: refused.
    expect(validatePeaceTerms(s, map, terms({ reparations: 5 }), 'r5', 'r1', false)).toMatch(/owes no reparations/)
    // The territory asking for peace and offering to pay: refused.
    expect(validatePeaceTerms(s, map, terms({ reparations: -5 }), 'r1', 'r5', false)).toMatch(/owes no reparations/)
    // But a territory may receive them, and the master's own obligations are unaffected.
    expect(validatePeaceTerms(s, map, terms({ reparations: -5 }), 'r5', 'r1', false)).toBeNull()
    s.wars.push('r0|r6')
    s.warScore['r6>r0'] = 60
    expect(validatePeaceTerms(s, map, terms({ reparations: 5 }), 'r6', 'r0', false)).toBeNull()
  })

  it('a reparations deal that somehow stands against a territory is dropped, not paid', () => {
    const s = held()
    s.deals.push({ id: 'dx', kind: 'reparations', from: 'r1', to: 'r5', give: { capital: 10 }, receive: {}, until: s.turn + 10 })
    const a = s.nations.r5.resources.capital
    const next = resolveTurn(s, map, [])
    expect(next.deals.some((d) => d.id === 'dx')).toBe(false)
    expect(next.nations.r5.resources.capital - a).toBeLessThan(10)
  })
})

describe('people and counts', () => {
  it('its people, output and workforce are never the master\'s: shares do not move', () => {
    const s = world()
    const pop = populationShare(s, 'r0')
    const eco = (s.worldGross = 100, economicShare(s, map, 'r0'))
    bindTerritory(s, 'r1', 'r0')
    expect(populationShare(s, 'r0')).toBe(pop)
    expect(economicShare(s, map, 'r0')).toBe(eco)
    // A puppet, by comparison, does add its output.
    const t = world()
    t.worldGross = 100
    bindPuppet(t, 'r1', 'r0')
    expect(economicShare(t, map, 'r0')).toBeGreaterThan(eco)
  })

  it('counts for map control and for half its countries in the empire tier and the conquest goal', () => {
    const s = world()
    s.regions.r2.owner = 'r1'
    s.regions.r3.owner = 'r1'
    s.regions.r4.owner = 'r1'
    const base = empireCount(s, 'r0')
    const goal = countriesTaken(s, 'r0')
    const ctl = controlled(s, 'r0')
    bindTerritory(s, 'r1', 'r0')
    expect(empireCount(s, 'r0')).toBe(base + 2)
    expect(countriesTaken(s, 'r0')).toBe(goal + 2)
    expect(controlled(s, 'r0')).toBe(ctl + 4)
    // Mutation check.
    expect(mutated(TERRITORY as never, 'countWeight', 1, () => empireCount(s, 'r0'))).toBe(base + 4)
  })

  it('holds the world when every other nation is its territory', () => {
    const s = world()
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']) s.nations[id].territoryOf = 'r0'
    s.settings.goal = 'world'
    s.humans = ['r0']
    expect(controlled(s, 'r0')).toBe(8)
    expect(holdsTheWorld(s, 'r0')).toBe(true)
    delete s.nations.r4.territoryOf
    expect(holdsTheWorld(s, 'r0')).toBe(false)
  })
})

describe('forced trade', () => {
  const deal = (give: object, receive: object, months = 3) => ({ give, receive, months })

  it('forces a deal with the master with no answer needed, and it runs every month', () => {
    const s = held()
    const o: Order = { type: 'forceTrade', nationId: 'r0', territory: 'r1', partner: 'r0', terms: deal({ oil: 10 }, { capital: 22 }) }
    expect(validateOrder(s, map, o)).toBeNull()
    const next = resolveTurn(s, map, [o])
    expect(next.deals.some((d) => d.kind === 'trade' && d.from === 'r1' && d.to === 'r0')).toBe(true)
  })

  it('forces a deal on a third nation, whose consent is still needed', () => {
    const s = held()
    const o: Order = { type: 'forceTrade', nationId: 'r0', territory: 'r1', partner: 'r5', terms: deal({ steel: 10 }, { capital: 20 }, 2) }
    expect(validateOrder(s, map, o)).toBeNull()
    const next = resolveTurn(s, map, [o])
    // The bot r5 answered at once: a deal exists exactly when it agreed.
    const made = next.deals.some((d) => d.kind === 'trade' && d.from === 'r1' && d.to === 'r5')
    expect(next.proposalMemory['r1>r5:trade']).toBe(s.turn)
    // The partner is a bot and answered at once: it either agreed (a deal exists) or declined (none), never "forced".
    expect(next.proposals.some((p) => p.from === 'r1' && p.to === 'r5')).toBe(false)
    expect(typeof made).toBe('boolean')
  })

  it('a person asked to deal with a territory gets the offer in the inbox, not a forced deal', () => {
    const s = held()
    s.nations.r5.isPlayer = true
    s.humans = ['r0', 'r5']
    const o: Order = { type: 'forceTrade', nationId: 'r0', territory: 'r1', partner: 'r5', terms: deal({ steel: 10 }, { capital: 20 }, 2) }
    const next = resolveTurn(s, map, [o])
    expect(next.proposals.some((p) => p.from === 'r1' && p.to === 'r5' && p.kind === 'trade')).toBe(true)
    expect(next.deals.some((d) => d.from === 'r1' && d.to === 'r5')).toBe(false)
  })

  it('must be fair to the territory: it cannot be drained for nothing, nor overbooked', () => {
    const s = held()
    const gift: Order = { type: 'forceTrade', nationId: 'r0', territory: 'r1', partner: 'r0', terms: deal({ capital: 200 }, {}, 3) }
    expect(validateOrder(s, map, gift)).toMatch(/at least 70%/)
    const cheap: Order = { type: 'forceTrade', nationId: 'r0', territory: 'r1', partner: 'r0', terms: deal({ capital: 100 }, { capital: 50 }, 3) }
    expect(validateOrder(s, map, cheap)).toMatch(/at least 70%/)
    const fair: Order = { type: 'forceTrade', nationId: 'r0', territory: 'r1', partner: 'r0', terms: deal({ capital: 100 }, { capital: 75 }, 3) }
    expect(validateOrder(s, map, fair)).toBeNull()
    // Mutation check: with no floor the gift passes.
    expect(mutated(TERRITORY as never, 'forceFair', 0, () => validateOrder(s, map, gift))).toBeNull()
    for (let i = 0; i < TERRITORY.maxDeals; i++) s.deals.push({ id: `t${i}`, kind: 'trade', from: 'r1', to: 'r6', give: { food: 1 }, receive: { capital: 1 }, until: s.turn + 5 })
    expect(validateOrder(s, map, fair)).toMatch(/already has/)
  })

  it('refuses what is not the master\'s to force: another master\'s territory, an enemy, itself, nonsense', () => {
    const s = held()
    const base = { type: 'forceTrade', nationId: 'r0', territory: 'r1', partner: 'r5', terms: deal({ steel: 10 }, { capital: 20 }) } as Order & { type: 'forceTrade' }
    expect(validateOrder(s, map, { ...base, nationId: 'r2' })).toMatch(/not your territory/)
    expect(validateOrder(s, map, { ...base, territory: 'r3' })).toMatch(/not your territory/)
    expect(validateOrder(s, map, { ...base, partner: 'r1' })).toMatch(/Choose a nation/)
    expect(validateOrder(s, map, { ...base, partner: 'zzz' })).toMatch(/Choose a nation/)
    s.wars.push('r1|r5')
    expect(validateOrder(s, map, base)).toMatch(/at war/)
    for (const junk of [undefined, null, 5, {}, { give: {} }, { give: 1, receive: 2 }]) expect(typeof validateOrder(s, map, { ...base, terms: junk } as never)).toBe('string')
  })

  it('the territory itself can neither refuse nor cancel: its own order to cancel a deal is refused, the master\'s is allowed', () => {
    const s = held()
    s.deals.push({ id: 'dq', kind: 'trade', from: 'r1', to: 'r6', give: { food: 1 }, receive: { capital: 1 }, until: s.turn + 5 })
    expect(validateOrder(s, map, { type: 'cancelDeal', nationId: 'r1', dealId: 'dq' })).toMatch(/decides/)
    expect(validateOrder(s, map, cmd({ type: 'cancelDeal', nationId: 'r1', dealId: 'dq' }))).toBeNull()
    // And from the master it takes the deal without a word, even at a bad opinion.
    const p = { kind: 'trade', terms: deal({ capital: 5 }, { food: 2 }), id: 'p9', from: 'r0', to: 'r1', created: s.turn, expires: s.turn + 3 } as Proposal
    expect(evaluateProposal(s, map, 'r1', p, createRng(1, 1)).accept).toBe(true)
    expect(evaluateProposal(s, map, 'r1', { ...p, from: 'r5' } as Proposal, createRng(1, 1)).reason).not.toMatch(/speaks for us/)
    expect(evaluateProposal(s, map, 'r1', { kind: 'alliance', id: 'p8', from: 'r5', to: 'r1', created: 0, expires: 9 } as Proposal, createRng(1, 1)).accept).toBe(false)
  })
})

describe('the master commands the army', () => {
  const armed = () => {
    const s = held()
    setMilitary(s, 'r1', { infantry: 12, armor: 6 })
    s.nations.r1.resources.capital = 900
    s.wars.push('r0|r2', 'r1|r2')
    s.warStarted['r0|r2'] = s.warStarted['r1|r2'] = s.turn
    return s
  }

  it('the territory\'s own orders for its army are refused, the master\'s are not', () => {
    const s = armed()
    expect(validateOrder(s, map, { type: 'queueTrain', nationId: 'r1', unit: 'infantry' })).toMatch(/decides/)
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r1', target: 'r2' })).toMatch(/decides/)
    expect(validateOrder(s, map, { type: 'setAlert', nationId: 'r1', alert: 'high' } as never)).toMatch(/decides/)
    expect(validateOrder(s, map, cmd({ type: 'queueTrain', nationId: 'r1', unit: 'infantry' }))).toBeNull()
    // Its economy is still its own.
    expect(validateOrder(s, map, { type: 'setPolicy', nationId: 'r1', taxRate: 0.2, draftRate: 0.05 })).toBeNull()
  })

  it('trains, drills and upgrades with the territory\'s money, not the master\'s', () => {
    const s = armed()
    const m = s.nations.r0.resources.capital
    const t = s.nations.r1.resources.capital
    const next = resolveTurn(s, map, [cmd({ type: 'train', nationId: 'r1', unit: 'infantry' })])
    expect(next.nations.r1.military.drill.infantry).toBe(1)
    expect(next.nations.r0.military.drill.infantry).toBe(0)
    expect(t - next.nations.r1.resources.capital).toBeGreaterThan(0)
    expect(next.nations.r0.resources.capital - m).toBeGreaterThan(-1)
    const q = resolveTurn(s, map, [cmd({ type: 'queueTrain', nationId: 'r1', unit: 'infantry' })])
    // The new division joins the territory's army (or waits in its queue), never the master's.
    expect(q.trainingQueue.some((j) => j.nationId === 'r0')).toBe(false)
    const grew = q.trainingQueue.some((j) => j.nationId === 'r1') || q.nations.r1.military.units.infantry > s.nations.r1.military.units.infantry
    expect(grew).toBe(true)
    expect(q.nations.r0.military.units.infantry).toBeLessThanOrEqual(s.nations.r0.military.units.infantry + 1e-9)
  })

  it('is refused when the territory cannot pay: its treasury is what counts', () => {
    const s = armed()
    s.nations.r1.resources.capital = 0
    expect(validateOrder(s, map, cmd({ type: 'train', nationId: 'r1', unit: 'infantry' }))).toMatch(/Not enough money/)
    s.nations.r0.resources.capital = 99999
    expect(validateOrder(s, map, cmd({ type: 'train', nationId: 'r1', unit: 'infantry' }))).toMatch(/Not enough money/)
  })

  it('a territory still pays its army\'s upkeep from its own budget', () => {
    const s = armed()
    setMilitary(s, 'r1', { infantry: 60, armor: 30 })
    const up = resolveTurn(s, map, [])
    const small = armed()
    setMilitary(small, 'r1', { infantry: 1 })
    const down = resolveTurn(small, map, [])
    // More soldiers cost the territory more and the master nothing more.
    expect(up.nations.r1.resources.capital).toBeLessThan(down.nations.r1.resources.capital)
  })

  it('attacks with its own units, as a commander of its own, in turn mode: the master keeps its own attack too', () => {
    const s = armed()
    const mine: Order = { type: 'attack', nationId: 'r0', target: 'r2', commit: 'main', stance: 'assault' }
    const theirs = cmd({ type: 'attack', nationId: 'r1', target: 'r2', commit: 'main', stance: 'assault' })
    expect(validateOrder(s, map, theirs, [mine])).toBeNull()
    const r = applyOrderNow(s, map, theirs)
    expect(r.error).toBeNull()
    expect(r.battle?.attacker.nationId).toBe('r1')
    // The master's own attack is still open: the two are separate slots.
    expect(s.nations.r1.military.attacksThisTurn).toBeGreaterThan(0)
    expect(s.nations.r0.military.attacksThisTurn).toBe(0)
    expect(mine.nationId).toBe('r0')
  })

  it('per-unit deployment: a chosen force, and a territory\'s units only, not the master\'s', () => {
    const s = armed()
    const o = cmd({ type: 'attack', nationId: 'r1', target: 'r2', units: { infantry: 4, armor: 2 }, stance: 'assault' })
    expect(validateOrder(s, map, o)).toBeNull()
    const tooMany = cmd({ type: 'attack', nationId: 'r1', target: 'r2', units: { infantry: 400 }, stance: 'assault' })
    expect(validateOrder(s, map, tooMany)).not.toBeNull()
    const r = applyOrderNow(s, map, o)
    expect(r.error).toBeNull()
  })

  it('sets its station and alert through the master', () => {
    const s = armed()
    expect(validateOrder(s, map, cmd({ type: 'setDeployment', nationId: 'r1', coastal: 0, subs: 0, air: 0, border: {} }))).toBeNull()
    expect(validateOrder(s, map, cmd({ type: 'setAlert', nationId: 'r1', level: 'ready' } as never))).not.toBe(undefined)
  })

  it('only the master may command, only the kinds of order in the data, and only as the territory', () => {
    const s = armed()
    const inner: Order = { type: 'queueTrain', nationId: 'r1', unit: 'infantry' }
    expect(validateOrder(s, map, cmd(inner, 'r1', 'r2'))).toMatch(/not your territory/)
    expect(validateOrder(s, map, cmd(inner, 'r3'))).toMatch(/not your territory/)
    expect(validateOrder(s, map, cmd({ ...inner, nationId: 'r0' } as Order))).toMatch(/as the territory/)
    expect(validateOrder(s, map, cmd({ type: 'declareWar', nationId: 'r1', target: 'r5' }))).toMatch(/cannot command/)
    expect(validateOrder(s, map, cmd({ type: 'setPolicy', nationId: 'r1', taxRate: 0.3, draftRate: 0.1 }))).toMatch(/cannot command/)
    // A command that carries a command is refused, so there is no way to chain one into another nation.
    expect(validateOrder(s, map, cmd(cmd(inner)))).toMatch(/as the territory|cannot command/)
  })

  it('malformed commands are refused without throwing', () => {
    const s = armed()
    const junk: unknown[] = [undefined, null, 5, 'x', [], {}, { type: 'x' }, { type: 'queueTrain' }, { type: 'attack', nationId: 'r1' }, { type: 'attack', nationId: 'r1', target: 5 }, { type: 'attack', nationId: 'r1', target: 'r2', units: 'many' }]
    for (const order of junk) {
      expect(typeof validateOrder(s, map, { type: 'commandTerritory', nationId: 'r0', territory: 'r1', order } as never)).toBe('string')
    }
    for (const territory of [undefined, null, 5, {}, 'nobody']) expect(typeof validateOrder(s, map, { type: 'commandTerritory', nationId: 'r0', territory, order: { type: 'train', nationId: 'r1', unit: 'infantry' } } as never)).toBe('string')
    expect(() => resolveTurn(s, map, [{ type: 'commandTerritory', nationId: 'r0', territory: 'r1', order: null } as never, { type: 'commandTerritory', nationId: 'r0' } as never])).not.toThrow()
    expect(() => describeOrder(s, map, { type: 'commandTerritory', nationId: 'r0', territory: 'r1' } as never)).not.toThrow()
    for (const o of [{ type: 'forceTrade', nationId: 'r0' }, { type: 'releaseTerritory', nationId: 'r0' }, { type: 'annexTerritory', nationId: 'r0', target: 9 }] as never[]) expect(typeof validateOrder(s, map, o)).toBe('string')
  })

  it('a command is a month-end or immediate order as the order it carries, and undoes as it does', () => {
    const s = armed()
    expect(isMonthEndOrder(s, 'commandTerritory', cmd({ type: 'queueTrain', nationId: 'r1', unit: 'infantry' }))).toBe(false)
    expect(isMonthEndOrder(s, 'commandTerritory', cmd({ type: 'cancelDeal', nationId: 'r1', dealId: 'x' }))).toBe(true)
    expect(isMonthEndOrder(s, 'forceTrade')).toBe(true)
    expect(undoable(s, cmd({ type: 'attack', nationId: 'r1', target: 'r2' }))).toBe(false)
    expect(undoable(s, cmd({ type: 'queueTrain', nationId: 'r1', unit: 'infantry' }))).toBe(true)
  })

  it('a bot master commands its territory with the plans its territory\'s bot makes, and a person\'s territory plans only its economy', () => {
    const s = armed()
    s.humans = []
    s.nations.r0.isPlayer = false
    const orders = generateBotOrders(s, map, 'r1')
    // Nothing of its own left that the rules would refuse.
    for (const o of orders) expect(validateOrder(s, map, o), JSON.stringify(o)).toBeNull()
    expect(orders.every((o) => o.type !== 'queueTrain' && o.type !== 'attack' && o.type !== 'train' && o.type !== 'setDeployment')).toBe(true)
    const p = world()
    bindTerritory(p, 'r1', 'r0')
    setMilitary(p, 'r1', { infantry: 12 })
    const own = generateBotOrders(p, map, 'r1')
    expect(own.some((o) => o.type === 'commandTerritory')).toBe(false)
    // Over a few months of all bots, some command arrives.
    let seen = 0
    let g = armed()
    g.humans = []
    g.nations.r0.isPlayer = false
    for (let i = 0; i < 6; i++) {
      const all = generateAllBotOrders(g, map)
      seen += all.filter((o) => o.type === 'commandTerritory').length
      for (const o of all) if (o.type === 'commandTerritory') expect(o.nationId).toBe('r0')
      g = resolveTurn(g, map, all)
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('ending it', () => {
  it('the master can set it free: independent, out of the faction, grateful, and the record goes', () => {
    const s = held()
    const o: Order = { type: 'releaseTerritory', nationId: 'r0', target: 'r1' }
    expect(validateOrder(s, map, o)).toBeNull()
    expect(validateOrder(s, map, { ...o, nationId: 'r2' })).toMatch(/not your territory/)
    const next = resolveTurn(s, map, [o])
    expect(next.nations.r1.territoryOf).toBeUndefined()
    expect(next.territories).toBeUndefined()
    expect(factionOf(next, 'r1')).toBeNull()
    expect(factionOf(next, 'r0')!.members).toContain('r0')
    // And it pays no more.
    expect(next.nations.r1.resources.capital).toBeGreaterThan(0)
  })

  it('can be annexed after its term, for influence, absorbing land, army and money, half settled', () => {
    const s = held()
    s.territories!.r1.since = s.turn - 3
    const o: Order = { type: 'annexTerritory', nationId: 'r0', target: 'r1' }
    expect(validateOrder(s, map, o)).toMatch(/must serve 12 months first \(9 to go\)/)
    s.territories!.r1.since = s.turn - 12
    expect(validateOrder(s, map, o)).toBeNull()
    expect(mutated(TERRITORY as never, 'annexMonths', 99, () => validateOrder(s, map, o))).toMatch(/must serve/)
    s.nations.r0.resources.pp = 5
    expect(validateOrder(s, map, o)).toMatch(/influence/)
    s.nations.r0.resources.pp = 500
    const units = s.nations.r1.military.units.infantry
    const mine = s.nations.r0.military.units.infantry
    const next = resolveTurn(s, map, [o])
    expect(next.regions.r1.owner).toBe('r0')
    expect(next.nations.r1.territoryOf).toBeUndefined()
    expect(next.territories).toBeUndefined()
    expect(next.nations.r0.military.units.infantry).toBeGreaterThanOrEqual(mine + units - 1)
    expect(next.regions.r1.integration).toBeLessThanOrEqual(1)
    expect(factionOf(next, 'r1')).toBeNull()
    expect(annexTerritoryCost(s, 'r1')).toBe(Math.round(15 * 1 * TERRITORY.annexCostMult))
  })

  it('when the master falls, the territory is independent, out of the faction, and the faction is dissolved', () => {
    const s = held()
    killNation(s, 'r0', 'r5')
    pruneFactions(s)
    expect(s.nations.r1.territoryOf).toBeUndefined()
    expect(s.territories).toBeUndefined()
    expect(factionOf(s, 'r1')).toBeNull()
    expect(s.factions ?? []).toHaveLength(0)
    expect(s.nations.r1.alive).toBe(true)
  })

  it('when the territory itself falls, its master loses nothing but it: record and faction seat are gone', () => {
    const s = held()
    killNation(s, 'r1', 'r5')
    pruneFactions(s)
    expect(s.territories).toBeUndefined()
    expect(factionOf(s, 'r0')!.members).toEqual(['r0'])
  })

  it('a territory whose master became a vassal passes up to the new master (the housekeeping repairs a record that fell behind)', () => {
    const s = held()
    s.nations.r0.overlord = 'r5'
    runTerritoryMonth(s, map)
    expect(s.nations.r1.territoryOf).toBe('r5')
    expect(factionOf(s, 'r1')!.id).toBe(factionOf(s, 'r5')!.id)
  })

  it('a territory freed by the master cannot be freed twice, and a stale order fails readably', () => {
    const s = held()
    const orders: Order[] = [{ type: 'releaseTerritory', nationId: 'r0', target: 'r1' }, { type: 'annexTerritory', nationId: 'r0', target: 'r1' }, cmd({ type: 'train', nationId: 'r1', unit: 'infantry' })]
    const next = resolveTurn(s, map, orders)
    expect(next.nations.r1.territoryOf).toBeUndefined()
    expect(validateOrder(next, map, orders[1])).toMatch(/not your territory/)
    expect(validateOrder(next, map, orders[2])).toMatch(/not your territory/)
  })
})

describe('puppets are not touched', () => {
  it('a puppet still has loyalty, tribute and its rules; a territory is neither', () => {
    const s = world()
    bindPuppet(s, 'r1', 'r0')
    bindTerritory(s, 'r2', 'r0')
    expect(s.nations.r1.loyalty).toBeDefined()
    expect(s.nations.r2.loyalty).toBeUndefined()
    expect(validateOrder(s, map, { type: 'annexPuppet', nationId: 'r0', target: 'r2' })).toMatch(/not your puppet/)
    expect(validateOrder(s, map, { type: 'releasePuppet', nationId: 'r0', target: 'r2' })).toMatch(/not your puppet/)
    expect(validateOrder(s, map, { type: 'annexTerritory', nationId: 'r0', target: 'r1' })).toMatch(/not your territory/)
  })

  it('a territory is not eligible for liberation: no cause exists and no puppet is listed', () => {
    const s = held()
    s.wars.push('r5|r0')
    s.warScore['r5>r0'] = 80
    expect(validatePeaceTerms(s, map, terms({ liberate: 'r1' }), 'r5', 'r0', false)).toMatch(/not a puppet/)
  })

  it('a bot master of a puppet and a territory keeps both without error over a year', () => {
    let s = world()
    bindPuppet(s, 'r1', 'r0')
    bindTerritory(s, 'r2', 'r0')
    s.humans = []
    s.nations.r0.isPlayer = false
    for (let i = 0; i < 12; i++) s = resolveTurn(s, map, generateAllBotOrders(s, map))
    expect(s.nations.r2.territoryOf ?? 'free').toBeDefined()
  })
})

describe('saves', () => {
  it('survive a round trip and keep working; an old save with none has no field and plays on', () => {
    const s = held()
    const back = JSON.parse(JSON.stringify(s)) as GameState
    expect(back.territories).toEqual(s.territories)
    expect(back.nations.r1.territoryOf).toBe('r0')
    const a = resolveTurn(s, map, [])
    const b = resolveTurn(back, map, [])
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    const old = JSON.parse(JSON.stringify(world())) as GameState
    expect(old.territories).toBeUndefined()
    const next = resolveTurn(old, map, [])
    expect(next.territories).toBeUndefined()
    expect(Object.values(next.nations).some((n) => 'territoryOf' in n)).toBe(false)
  })

  it('a record whose nation is gone is dropped by the month without a throw', () => {
    const s = held()
    s.territories!.r9 = { master: 'r0', since: 0, taken: 0, last: 0, revenue: 0 }
    expect(() => runTerritoryMonth(s, map)).not.toThrow()
    expect(s.territories!.r9).toBeUndefined()
  })
})

describe('online: several people', () => {
  it('a person cannot be made a territory, and a person master commands its territory by its own orders only', () => {
    const s = held()
    s.humans = ['r0', 'r5']
    s.nations.r5.isPlayer = true
    expect(territoryProblem(s, 'r0', 'r5')).toMatch(/run by a player/)
    // r5's order naming r0's territory is not its to give.
    expect(validateOrder(s, map, cmd({ type: 'train', nationId: 'r1', unit: 'infantry' }, 'r1', 'r5'))).toMatch(/not your territory/)
    // A wrapper with another person's nation id inside is refused whoever sends it.
    expect(validateOrder(s, map, cmd({ type: 'train', nationId: 'r5', unit: 'infantry' }))).toMatch(/as the territory/)
    // And a person who is the master gets no bot plan for its territory's army.
    expect(generateBotOrders(s, map, 'r1').some((o) => o.type === 'commandTerritory')).toBe(false)
  })

  it('the month is the same however the orders arrive: one month of a territory with commands gives equal states from either order of the list', () => {
    const s = held()
    setMilitary(s, 'r1', { infantry: 8 })
    const a = cmd({ type: 'train', nationId: 'r1', unit: 'infantry' })
    const b: Order = { type: 'setPolicy', nationId: 'r0', taxRate: 0.3, draftRate: 0.05 }
    const x = resolveTurn(s, map, [a, b])
    const y = resolveTurn(s, map, [b, a])
    expect(JSON.stringify(x.nations.r1)).toBe(JSON.stringify(y.nations.r1))
    expect(JSON.stringify(x.nations.r0)).toBe(JSON.stringify(y.nations.r0))
  })
})

describe('describing', () => {
  it('reads in words', () => {
    const s = held()
    expect(describeOrder(s, map, cmd({ type: 'train', nationId: 'r1', unit: 'infantry' }))).toMatch(/Command .*infantry|Command/)
    expect(describeOrder(s, map, { type: 'forceTrade', nationId: 'r0', territory: 'r1', partner: 'r5', terms: { give: {}, receive: {}, months: 0 } })).toMatch(/Force/)
    expect(describeOrder(s, map, { type: 'releaseTerritory', nationId: 'r0', target: 'r1' })).toMatch(/free/)
    expect(describeOrder(s, map, { type: 'annexTerritory', nationId: 'r0', target: 'r1' })).toMatch(/Annex/)
    expect(propose).toBeDefined()
  })
})
