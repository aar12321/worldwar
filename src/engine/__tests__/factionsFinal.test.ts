import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { botContractVote } from '../../ai/factions'
import { addOpinion } from '../../ai/opinion'
import { FACTION } from '../../data/factions'
import { factionOf, sharesOf, tallyOf, withdrawable } from '../factions'
import { enemiesOf } from '../helpers'
import { declareWar } from '../diplomacy'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { validateOrder } from '../orders'
import { createRng } from '../rng'
import { marketPrices } from '../trade'
import type { Faction, FactionGift, FactionProposal, GameState, NationId, Order } from '../types'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'
import { BLOC } from '../../data/blocs'
// These tests pin the legacy faction rules (the common pool, votes, the pooled army). They still run, with the bloc layer switched off,
// which is the switch-off proof of docs/BLOC_STATUS.md; the bloc rules themselves are in bloc*.test.ts.
beforeAll(() => {
  BLOC.on = false
})
afterAll(() => {
  BLOC.on = true
})


const map = lineMap(8)

function world(humans: NationId[], seed = 3): GameState {
  const s = startState(map, 'r0', seed)
  s.humans = humans
  for (const id of Object.keys(s.nations)) {
    const n = s.nations[id]
    n.resources.capital = 1000
    n.resources.pp = 300
    n.resources.oil = 100
    n.resources.steel = 100
    n.resources.goods = 60
    n.resources.food = 120
    n.isPlayer = humans.includes(id)
    setMilitary(s, id, { infantry: 10, armor: 4 })
  }
  s.humans = humans
  return s
}

const ok = (s: GameState, o: Order) => {
  const r = applyOrderNow(s, map, o)
  expect(r.error, JSON.stringify(o)).toBeNull()
}
const refused = (s: GameState, o: Order, pending: Order[] = []) => validateOrder(s, map, o, pending)
const money = (n: number): FactionGift => ({ stock: { money: n } })

function formed(members: NationId[], humans: NationId[], charter?: Partial<Faction['charter']>): { s: GameState; f: Faction } {
  const s = world(humans)
  for (const m of members.filter((x) => !humans.includes(x))) for (const o of members) if (o !== m) addOpinion(s, m, o, 'Friends', 60, 0.01)
  ok(s, { type: 'factionFound', nationId: members[0], name: 'Iron Pact', charter })
  for (const m of members.slice(1)) {
    ok(s, { type: 'factionInvite', nationId: members[0], target: m })
    const f = factionOf(s, members[0])!
    if (!f.members.includes(m)) ok(s, { type: 'factionJoin', nationId: m, factionId: f.id })
  }
  return { s, f: factionOf(s, members[0])! }
}

describe('rivals and supply contracts with the pool', () => {
  /** A faction of a person and a rival, with an army in the pool that has no fuel and a treasury to pay for it. */
  function needy(level: 'easy' | 'normal' | 'hard') {
    const { s } = formed(['r0', 'r1'], ['r0'])
    s.settings.difficulty = level
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 8, armor: 4 }, stock: { money: 600 } } })
    s.nations.r1.resources.oil = 400
    s.nations.r1.resources.food = 400
    return s
  }
  const proposals = (s: GameState, level: 'easy' | 'normal' | 'hard') => {
    let found: Extract<Order, { type: 'factionPropose' }>[] = []
    for (let i = 0; i < 40 && !found.length; i++) {
      s.turn += 1
      found = generateBotOrders(s, map, 'r1').filter((o): o is Extract<Order, { type: 'factionPropose' }> => o.type === 'factionPropose' && o.proposal.kind === 'contract')
    }
    void level
    return found
  }

  it('a Medium or Hard rival offers to sell fuel to the pool at the market price, within bounds; Easy never does', () => {
    for (const level of ['normal', 'hard'] as const) {
      const s = needy(level)
      const found = proposals(s, level)
      expect(found.length, level).toBeGreaterThan(0)
      const p = found[0].proposal
      if (p.kind !== 'contract') throw new Error('contract')
      const t = p.terms
      expect(t.member).toBe('r1')
      const r = t.supply.food ? 'food' : 'oil'
      expect(t.supply[r] ?? 0).toBeGreaterThanOrEqual(2)
      expect(t.supply[r]!).toBeLessThanOrEqual(400 * 0.2)
      expect(t.months).toBeLessThanOrEqual(6)
      // Never above the market (to the tenth of a coin).
      const px = marketPrices(s)[r]
      expect(t.pay.money!).toBeLessThanOrEqual(Math.ceil(t.supply[r]! * px * 10) / 10 + 1e-9)
      expect(validateOrder(s, map, found[0])).toBeNull()
    }
    const easy = needy('easy')
    expect(proposals(easy, 'easy')).toHaveLength(0)
  })

  it('it makes no offer when the pool has the fuel or cannot pay, and never two at once', () => {
    const rich = needy('hard')
    Object.assign(factionOf(rich, 'r0')!.pool.stock, { oil: 500, food: 500 })
    expect(proposals(rich, 'hard')).toHaveLength(0)
    const poor = needy('hard')
    factionOf(poor, 'r0')!.pool.stock.money = 5
    expect(proposals(poor, 'hard')).toHaveLength(0)
    const busy = needy('hard')
    const f = factionOf(busy, 'r0')!
    f.proposals.push({ id: 'x', kind: 'contract', by: 'r1', created: 0, expires: 99, votes: { r1: 'yes' }, terms: { member: 'r1', supply: { oil: 5 }, pay: { money: 5 }, months: 3, start: 0, collateral: 0 } })
    expect(proposals(busy, 'hard')).toHaveLength(0)
  })

  it('a rival votes yes to a fair price and no to one above the market (oil and food arbitrage)', () => {
    const { s, f } = formed(['r0', 'r1'], ['r0'])
    s.settings.difficulty = 'hard'
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: money(900) })
    const px = marketPrices(s).oil
    // Make oil cheap on the market so the fixed pool value would overpay.
    const draft = (pay: number): FactionProposal => ({ id: 'p', kind: 'contract', by: 'r0', created: 0, expires: 3, votes: { r0: 'yes' }, terms: { member: 'r0', supply: { oil: 50 }, pay: { money: pay }, months: 6, start: 0, collateral: 0 } })
    expect(botContractVote(s, map, 'r1', f, draft(Math.floor(50 * px)))).toBe('yes')
    expect(botContractVote(s, map, 'r1', f, draft(Math.ceil(50 * px * 1.5)))).toBe('no')
    // Even at the old fixed value of 2 a unit, a cheap market makes it a bad deal.
    s.marketPressure = { oil: -0.25 }
    const cheap = marketPrices(s).oil
    expect(cheap).toBeLessThan(2)
    expect(botContractVote(s, map, 'r1', f, draft(50 * 2))).toBe('no')
  })

  it('a rival who is short of food and likes its neighbor backs a standing supply with collateral; Easy posts none', () => {
    const seen: Record<string, number> = { easy: 0, normal: 0, hard: 0 }
    const trades: Record<string, number> = { easy: 0, normal: 0, hard: 0 }
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const s = world([])
      s.settings.difficulty = level
      s.turn = 12
      for (let i = 0; i < 8; i++) {
        s.nations[`r${i}`].resources.food = 400
        s.nations[`r${i}`].resources.capital = 600
      }
      // r3 feeds a big army on a thin harvest: its food runs a small deficit it can see coming.
      s.nations.r3.resources.food = 100
      s.nations.r3.military.units.infantry = 40
      s.alliances.push('r3|r4')
      for (const o of ['r2', 'r4']) addOpinion(s, 'r3', o, 'Friends', 70, 0.01)
      let cur = s
      for (let i = 0; i < 3; i++) {
        const orders = generateAllBotOrders(cur, map)
        for (const o of orders) if (o.type === 'propose' && o.proposal.kind === 'trade' && o.proposal.terms.months >= 3) trades[level]++
        for (const o of orders) if (o.type === 'propose' && o.proposal.kind === 'trade' && (o.proposal.terms.collateral ?? 0) > 0) seen[level]++
        cur = resolveTurn(cur, map, orders)
      }
    }
    expect(trades.easy).toBeGreaterThan(0)
    expect(seen.easy).toBe(0)
    expect(seen.normal + seen.hard).toBeGreaterThan(0)
  })
})

describe('faction exploit sweep', () => {
  it('money paid in after a vote was called cannot buy it: a weighted vote counts the weights of the day it was put forward', () => {
    const { s, f } = formed(['r0', 'r1', 'r2'], ['r0', 'r1', 'r2'], { vote: 'weighted' })
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: money(300) })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: money(300) })
    ok(s, { type: 'factionContribute', nationId: 'r2', gift: money(10) })
    giveRegions(s, 'r4', ['r3'])
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r4' } })
    const p = f.proposals[0]
    expect(p.weights).toBeDefined()
    expect(p.weights!.r2).toBeLessThan(0.05)
    // r2 now pays in a fortune and votes no: it would be the biggest owner, but the vote was fixed before.
    ok(s, { type: 'factionContribute', nationId: 'r2', gift: money(900) })
    expect(sharesOf(f).r2).toBeGreaterThan(0.5)
    ok(s, { type: 'factionVote', nationId: 'r2', proposalId: p.id, vote: 'no' })
    const t = tallyOf(s, f, p)
    expect(t.no / t.total).toBeLessThan(0.05)
    const m1 = resolveTurn(s, map, [])
    const m2 = resolveTurn(m1, map, [])
    expect(factionOf(m2, 'r0')!.wars).toHaveLength(0)
    // The same vote with r1 for it carries it on the day-one weights, whatever r2 paid in since.
    const withYes = resolveTurn(s, map, [{ type: 'factionVote', nationId: 'r1', proposalId: p.id, vote: 'yes' }])
    const passed = resolveTurn(withYes, map, [])
    expect(factionOf(passed, 'r0')!.wars).toHaveLength(1)
  })

  it('a one-member-one-vote charter keeps no weights', () => {
    const { s, f } = formed(['r0', 'r1'], ['r0', 'r1'])
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r2' } })
    expect(f.proposals[0].weights).toBeUndefined()
  })

  it('the lock cannot be got around by leaving: leaving returns the claim less the fee, so a quick exit is never a gain', () => {
    const { s } = formed(['r0', 'r1'], ['r0', 'r1'])
    const before = s.nations.r1.resources.capital
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: money(400) })
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r1', gift: money(100) })).toMatch(/locked/)
    ok(s, { type: 'factionLeave', nationId: 'r1' })
    expect(s.nations.r1.resources.capital).toBeCloseTo(before - 400 * FACTION.exitFee, 6)
  })

  it('leaving after a loss refunds the shrunken claim, never what was put in', () => {
    const { s, f } = formed(['r0', 'r1', 'r2'], ['r0', 'r1', 'r2'])
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: money(300) })
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: money(300) })
    f.pool.stock.money = 300 // half was lost
    const before = s.nations.r1.resources.capital
    ok(s, { type: 'factionLeave', nationId: 'r1' })
    expect(s.nations.r1.resources.capital - before).toBeCloseTo(150 * (1 - FACTION.exitFee), 6)
    // The ones who stay are not shorted by the leaving: r0's claim is still worth no more than it was.
    expect(withdrawable(factionOf(s, 'r0')!, 'r0', 'money')).toBeLessThanOrEqual(300 + 1e-9)
  })

  it('soldiers cannot be pooled by a nation fighting a war of its own: nothing defends its land from the pool', () => {
    const { s } = formed(['r0', 'r1'], ['r0', 'r1'])
    declareWar(s, map, 'r0', 'r4', createRng(1), true)
    expect(enemiesOf(s, 'r0').length).toBeGreaterThan(0)
    expect(refused(s, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 5 } } })).toMatch(/defend your land/)
    // Money and fuel are fine, and a member at peace may pool its soldiers.
    expect(refused(s, { type: 'factionContribute', nationId: 'r0', gift: money(50) })).toBeNull()
    expect(refused(s, { type: 'factionContribute', nationId: 'r1', gift: { units: { infantry: 5 } } })).toBeNull()
  })
})
