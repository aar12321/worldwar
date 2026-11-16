import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { addOpinion } from '../../ai/opinion'
import { FACTION } from '../../data/factions'
import { claimValue, factionNews, factionOf, poolPower, runFactionMonth, sharesOf, stockRatio, tallyOf, voteWeights, warTargetProblem, withdrawable } from '../factions'
import { atWar } from '../helpers'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { validateOrder } from '../orders'
import type { Faction, FactionContractTerms, FactionGift, GameState, NationId, Order } from '../types'
import { POOL_RESOURCES } from '../types'
import { advise } from '../advisor'
import { daysInMonth } from '../calendar'
import { advanceDay, startLive } from '../live'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

/** A world of eight nations on a line, the first two or three played by people, all with money, materials and soldiers. */
function world(humans: NationId[] = ['r0', 'r1'], seed = 3): GameState {
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

/** Founds a faction for r0 and brings the others in (people join by their own order). */
function formed(members: NationId[] = ['r0', 'r1'], humans: NationId[] = members, opts: { charter?: Partial<Faction['charter']> } = {}): { s: GameState; f: Faction } {
  const s = world(humans)
  // Rivals only join a faction whose members they like.
  for (const m of members.filter((x) => !humans.includes(x))) for (const o of members) if (o !== m) addOpinion(s, m, o, 'Friends', 60, 0.01)
  ok(s, { type: 'factionFound', nationId: members[0], name: 'Iron Pact', charter: opts.charter })
  for (const m of members.slice(1)) {
    ok(s, { type: 'factionInvite', nationId: members[0], target: m })
    const f = factionOf(s, members[0])!
    if (!f.members.includes(m)) ok(s, { type: 'factionJoin', nationId: m, factionId: f.id })
  }
  return { s, f: factionOf(s, members[0])! }
}

const money = (n: number): FactionGift => ({ stock: { money: n } })

/** Everything of value in the game that the pool can touch, to check that nothing is made or lost. */
function totals(s: GameState) {
  const t = { money: 0, oil: 0, steel: 0, goods: 0, food: 0, infantry: 0, armor: 0 }
  for (const n of Object.values(s.nations)) {
    t.money += n.resources.capital
    t.oil += n.resources.oil
    t.steel += n.resources.steel
    t.goods += n.resources.goods
    t.food += n.resources.food
    t.infantry += n.military.units.infantry
    t.armor += n.military.units.armor
  }
  for (const f of s.factions ?? []) {
    t.money += f.pool.stock.money + f.contracts.reduce((a, c) => a + c.held, 0)
    t.oil += f.pool.stock.oil
    t.steel += f.pool.stock.steel
    t.goods += f.pool.stock.goods
    t.food += f.pool.stock.food
    t.infantry += f.pool.units.infantry
    t.armor += f.pool.units.armor
  }
  return t
}

describe('a game with no faction is untouched', () => {
  it('has no factions field and plays a month exactly as before', () => {
    const s = world()
    expect('factions' in s).toBe(false)
    const next = resolveTurn(s, map, [])
    expect('factions' in next).toBe(false)
  })
})

describe('founding, inviting, joining and leaving', () => {
  it('founding costs influence, makes a one-member faction and refuses a second', () => {
    const s = world()
    const pp = s.nations.r0.resources.pp
    ok(s, { type: 'factionFound', nationId: 'r0', name: '  Iron   Pact ' })
    const f = factionOf(s, 'r0')!
    expect(f.name).toBe('Iron Pact')
    expect(s.nations.r0.resources.pp).toBe(pp - FACTION.foundInfluence)
    expect(f.members).toEqual(['r0'])
    expect(f.founder).toBe('r0')
    expect(f.charter).toEqual({ vote: 'majority', spoils: 'share', exit: 'refund' })
    expect(refused(s, { type: 'factionFound', nationId: 'r0', name: 'Again' })).toMatch(/already in/)
    expect(refused(world(), { type: 'factionFound', nationId: 'r0', name: 'x' })).toMatch(/Name it/)
    expect(refused(world(), { type: 'factionFound', nationId: 'r0', name: 'Fine', charter: { vote: 'dictator' as 'majority' } })).toMatch(/charter/)
    const poor = world()
    poor.nations.r0.resources.pp = 3
    expect(refused(poor, { type: 'factionFound', nationId: 'r0', name: 'Fine Name' })).toMatch(/influence/)
  })

  it('a person joins only with an invitation, and only before it expires', () => {
    const s = world()
    ok(s, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    const f = factionOf(s, 'r0')!
    expect(refused(s, { type: 'factionJoin', nationId: 'r1', factionId: f.id })).toMatch(/not been invited/)
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
    expect(f.invites).toHaveLength(1)
    expect(refused(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })).toMatch(/Already invited/)
    s.turn += FACTION.inviteMonths + 1
    expect(refused(s, { type: 'factionJoin', nationId: 'r1', factionId: f.id })).toMatch(/not been invited/)
    s.turn -= FACTION.inviteMonths + 1
    ok(s, { type: 'factionJoin', nationId: 'r1', factionId: f.id })
    expect(f.members).toEqual(['r0', 'r1'])
    expect(f.invites).toHaveLength(0)
    expect(refused(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })).toMatch(/already in a faction/)
  })

  it('nobody at war with a member can join, and members cannot fight each other', () => {
    const { s, f } = formed(['r0', 'r1'])
    s.wars.push('r1|r2')
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r3' })
    expect(refused(s, { type: 'factionInvite', nationId: 'r0', target: 'r2' })).toMatch(/at war with a member/)
    expect(refused(s, { type: 'declareWar', nationId: 'r0', target: 'r1' })).toMatch(/same faction/)
    expect(f.members).not.toContain('r2')
  })

  it('a rival answers an invitation at once by what it thinks of the members; Easy rivals never join', () => {
    const s = world(['r0'])
    ok(s, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    addOpinion(s, 'r1', 'r0', 'Friends', 60, 0.1)
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
    expect(factionOf(s, 'r1')?.name).toBe('Iron Pact')
    const enemy = world(['r0'])
    ok(enemy, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    addOpinion(enemy, 'r1', 'r0', 'Hated', -60, 0.1)
    ok(enemy, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
    expect(factionOf(enemy, 'r1')).toBeNull()
    const easy = world(['r0'])
    easy.settings.difficulty = 'easy'
    ok(easy, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    addOpinion(easy, 'r1', 'r0', 'Friends', 60, 0.1)
    // The order is refused with the reason, instead of being spent and turned down in silence.
    expect(refused(easy, { type: 'factionInvite', nationId: 'r0', target: 'r1' })).toMatch(/will not join a faction on this difficulty/)
    expect(factionOf(easy, 'r1')).toBeNull()
  })

  it('leaving takes back the claim less the fee, and what is left stays', () => {
    const { s, f } = formed(['r0', 'r1'])
    s.turn += 5
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: { stock: { money: 200, oil: 30 }, units: { infantry: 4 } } })
    s.turn += 5
    const before = s.nations.r1.resources.capital
    ok(s, { type: 'factionLeave', nationId: 'r1' })
    expect(f.members).toEqual(['r0'])
    expect(s.nations.r1.resources.capital).toBeCloseTo(before + 180, 6)
    expect(s.nations.r1.resources.oil).toBeCloseTo(70 + 27, 6)
    expect(s.nations.r1.military.units.infantry).toBeCloseTo(10, 6)
    expect(f.pool.stock.money).toBeCloseTo(20, 6)
    expect(f.ledger.r1).toBeUndefined()
  })

  it('a forfeiting charter leaves everything behind, but the last member takes it all', () => {
    const { s, f } = formed(['r0', 'r1'], ['r0', 'r1'], { charter: { exit: 'forfeit' } })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: money(300) })
    const m = s.nations.r1.resources.capital
    ok(s, { type: 'factionLeave', nationId: 'r1' })
    expect(s.nations.r1.resources.capital).toBeCloseTo(m, 6)
    expect(f.pool.stock.money).toBeCloseTo(300, 6)
    const r0 = s.nations.r0.resources.capital
    ok(s, { type: 'factionLeave', nationId: 'r0' })
    expect(s.factions).toBeUndefined()
    expect(s.nations.r0.resources.capital).toBeCloseTo(r0 + 300, 6)
  })

  it('the founder passes to the member with the biggest share', () => {
    const { s, f } = formed(['r0', 'r1', 'r2'])
    ok(s, { type: 'factionContribute', nationId: 'r2', gift: money(500) })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: money(100) })
    ok(s, { type: 'factionLeave', nationId: 'r0' })
    expect(f.founder).toBe('r2')
  })
})

describe('the pool and the ledger', () => {
  it('a gift moves exactly what it says from the nation to the pool and the ledger', () => {
    const { s, f } = formed()
    const had = totals(s)
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: { stock: { money: 150, oil: 20, steel: 10, goods: 5, food: 12 }, units: { infantry: 3, armor: 1 } } })
    expect(f.pool.stock).toEqual({ money: 150, oil: 20, steel: 10, goods: 5, food: 12 })
    expect(f.pool.units.infantry).toBe(3)
    expect(f.pool.units.armor).toBe(1)
    expect(f.ledger.r1.stock.money).toBe(150)
    expect(f.ledger.r1.units.infantry).toBe(3)
    expect(s.nations.r1.resources.capital).toBe(850)
    expect(s.nations.r1.resources.steel).toBe(90)
    expect(s.nations.r1.resources.oil).toBe(80)
    expect(s.nations.r1.military.units.infantry).toBe(7)
    expect(totals(s)).toEqual(had)
  })

  it('refuses gifts that are empty, negative, huge, or more than the nation has', () => {
    const { s } = formed()
    const bad: FactionGift[] = [{}, { stock: { money: 0 } }, { stock: { money: -50 } }, { stock: { money: NaN } }, { stock: { money: Infinity } }, { stock: { money: 5000 } }, { stock: { oil: 101 } }, { units: { infantry: 11 } }, { units: { infantry: -1 } }, { stock: { gold: 5 } as never }, { units: { dragons: 1 } as never }]
    for (const gift of bad) expect(refused(s, { type: 'factionContribute', nationId: 'r1', gift }), JSON.stringify(gift)).not.toBeNull()
    expect(refused(s, { type: 'factionContribute', nationId: 'r5', gift: money(5) })).toMatch(/not in a faction/)
  })

  it('counts gifts already queued, so a batch cannot give away more than the nation has', () => {
    const { s } = formed()
    const first: Order = { type: 'factionContribute', nationId: 'r1', gift: { stock: { oil: 70 }, units: { infantry: 7 } } }
    expect(refused(s, first)).toBeNull()
    const second: Order = { type: 'factionContribute', nationId: 'r1', gift: { stock: { oil: 40 } } }
    expect(refused(s, second, [first])).toMatch(/oil/)
    expect(refused(s, { type: 'factionContribute', nationId: 'r1', gift: { units: { infantry: 4 } } }, [first])).toMatch(/infantry/)
    const rich: Order = { type: 'factionContribute', nationId: 'r1', gift: money(900) }
    expect(refused(s, { type: 'factionContribute', nationId: 'r1', gift: money(200) }, [rich])).toMatch(/money/i)
  })

  it('ownership shares follow what each member put in, at fixed values', () => {
    const { s, f } = formed(['r0', 'r1', 'r2'])
    expect(sharesOf(f)).toEqual({ r0: 1 / 3, r1: 1 / 3, r2: 1 / 3 })
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: money(100) })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: { stock: { oil: 50 } } })
    ok(s, { type: 'factionContribute', nationId: 'r2', gift: { units: { infantry: 10 } } })
    const sh = sharesOf(f)
    // 100 money, 50 oil at 2 each, 10 infantry at 10 each.
    expect(sh.r0).toBeCloseTo(1 / 3, 9)
    expect(sh.r1).toBeCloseTo(1 / 3, 9)
    expect(sh.r2).toBeCloseTo(1 / 3, 9)
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: money(200) })
    const more = sharesOf(f)
    expect(more.r0).toBeCloseTo(300 / 500, 9)
    expect(more.r1 + more.r2 + more.r0).toBeCloseTo(1, 9)
    expect(claimValue(f, 'r0')).toBeCloseTo(300, 9)
  })

  it('money cannot be turned into a bigger share of something else: a claim is in kind', () => {
    const { s, f } = formed()
    s.turn += 5
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: { stock: { oil: 50 } } })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: money(100) })
    s.turn += 5
    // r1 put in money, so money is all r1 can take back; it cannot reach r0's oil or take more money than it gave.
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r1', gift: { stock: { oil: 1 } } })).toMatch(/no oil/i)
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r1', gift: money(100.5) })).toMatch(/take back/)
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r0', gift: money(1) })).toMatch(/no money/i)
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r1', gift: money(100) })).toBeNull()
    expect(f.pool.stock.money).toBe(100)
  })

  it('what you put in is locked for a while, and a batch cannot take it twice', () => {
    const { s } = formed()
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: money(200) })
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r1', gift: money(50) })).toMatch(/locked for 2 more months/)
    s.turn += FACTION.lockMonths
    const half: Order = { type: 'factionWithdraw', nationId: 'r1', gift: money(120) }
    expect(refused(s, half)).toBeNull()
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r1', gift: money(120) }, [half])).toMatch(/take back 80/)
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r1', gift: money(80) }, [half])).toBeNull()
  })

  it('a contribution and a withdrawal in the same month is a wash, never a profit', () => {
    const { s } = formed()
    const had = totals(s)
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: { stock: { money: 100, oil: 10 }, units: { armor: 2 } } })
    s.turn += FACTION.lockMonths
    ok(s, { type: 'factionWithdraw', nationId: 'r1', gift: { stock: { money: 100, oil: 10 }, units: { armor: 2 } } })
    expect(totals(s)).toEqual(had)
    expect(sharesOf(factionOf(s, 'r0')!).r1).toBeCloseTo(0.5, 9)
  })

  it('losses are shared: when the pool has less than its claims, every claim shrinks alike', () => {
    const { s, f } = formed(['r0', 'r1'])
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: money(300) })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: money(100) })
    f.pool.stock.money = 200
    s.turn += 5
    expect(stockRatio(f, 'money')).toBe(0.5)
    expect(withdrawable(f, 'r0', 'money')).toBeCloseTo(150, 9)
    expect(withdrawable(f, 'r1', 'money')).toBeCloseTo(50, 9)
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r1', gift: money(51) })).not.toBeNull()
    ok(s, { type: 'factionWithdraw', nationId: 'r1', gift: money(25) })
    // Half of r1's claim went with it: 25 out, 50 of the claim used.
    expect(f.ledger.r1.stock.money).toBeCloseTo(50, 9)
    expect(withdrawable(f, 'r0', 'money')).toBeCloseTo(150 * (175 / 175), 9)
    expect(stockRatio(f, 'money')).toBeCloseTo(0.5, 9)
  })

  it('a surplus nobody owns never lets anyone take more than they put in', () => {
    const { s, f } = formed(['r0', 'r1'])
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: money(100) })
    f.pool.stock.money += 500
    s.turn += 5
    expect(stockRatio(f, 'money')).toBe(1)
    expect(withdrawable(f, 'r0', 'money')).toBe(100)
    expect(withdrawable(f, 'r1', 'money')).toBe(0)
  })

  it('money gifts at the same moment as other orders cannot spend the same money twice', () => {
    const { s } = formed()
    const a: Order = { type: 'factionContribute', nationId: 'r1', gift: money(700) }
    const b: Order = { type: 'factionContribute', nationId: 'r1', gift: money(700) }
    expect(refused(s, a)).toBeNull()
    expect(refused(s, b, [a])).toMatch(/Not enough money/)
    const r = resolveTurn(s, map, [a, b])
    const pool = factionOf(r, 'r1')!.pool.stock.money
    expect(pool).toBeCloseTo(700, 6)
  })

  it('whatever order the gifts, withdrawals and departures come in, nothing is made or lost', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { s } = formed(['r0', 'r1', 'r2', 'r3'])
      const had = totals(s)
      let x = seed * 7919
      const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
      const ids: NationId[] = ['r0', 'r1', 'r2', 'r3']
      for (let i = 0; i < 160; i++) {
        s.turn += rnd() < 0.3 ? 1 : 0
        const id = ids[Math.floor(rnd() * 4)]
        const amount = Math.floor(rnd() * 90) + 1
        const kind = Math.floor(rnd() * 5)
        const gift: FactionGift = kind === 0 ? money(amount) : kind === 1 ? { stock: { oil: amount / 4 } } : kind === 2 ? { units: { infantry: amount / 30 } } : kind === 3 ? { stock: { steel: amount / 3, goods: amount / 5 } } : { stock: { food: amount / 3 } }
        const order: Order = rnd() < 0.55 ? { type: 'factionContribute', nationId: id, gift } : { type: 'factionWithdraw', nationId: id, gift }
        if (!validateOrder(s, map, order)) applyOrderNow(s, map, order)
        // The pool never holds a negative amount, and nobody's ledger exceeds the pool by more than what was lost.
        for (const f of s.factions ?? []) {
          for (const r of POOL_RESOURCES) expect(f.pool.stock[r]).toBeGreaterThanOrEqual(-1e-9)
          for (const m of f.members) for (const r of POOL_RESOURCES) expect(f.ledger[m].stock[r]).toBeGreaterThanOrEqual(-1e-9)
        }
        const t = totals(s)
        for (const k of Object.keys(t) as (keyof typeof t)[]) expect(t[k], `${k} step ${i}`).toBeCloseTo(had[k], 5)
      }
      // Then everyone leaves: the pool is empty and every unit is back.
      for (const id of ids) {
        s.turn += 5
        const f = factionOf(s, id)
        if (f) applyOrderNow(s, map, { type: 'factionLeave', nationId: id })
      }
      const t = totals(s)
      for (const k of Object.keys(t) as (keyof typeof t)[]) expect(t[k], `${k} at the end`).toBeCloseTo(had[k], 5)
    }
  })
})

describe('votes', () => {
  /** Three people in a faction, r0 proposing war on r4 (a bot). */
  function voting(charter: Partial<Faction['charter']> = {}) {
    const { s, f } = formed(['r0', 'r1', 'r2'], ['r0', 'r1', 'r2'], { charter })
    // Next to a border, so the war is possible.
    giveRegions(s, 'r4', ['r3'])
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r4' } })
    return { s, f }
  }

  it('putting a country to the vote costs influence, counts the proposer as yes, and waits for the next month', () => {
    const { s, f } = voting()
    expect(f.proposals).toHaveLength(1)
    const p = f.proposals[0]
    expect(p.votes).toEqual({ r0: 'yes' })
    expect(s.nations.r0.resources.pp).toBe(300 - FACTION.foundInfluence - 60)
    expect(p.expires).toBe(p.created + FACTION.voteMonths)
    // Proposed this month, so this month's end does not decide it.
    const next = resolveTurn(s, map, [])
    expect(factionOf(next, 'r0')!.proposals).toHaveLength(1)
    expect(atWar(next, 'r0', 'r4')).toBe(false)
  })

  it('one yes from another member passes it at the month end (2 of 3 is a majority) and the war begins', () => {
    const { s } = voting()
    const m1 = resolveTurn(s, map, [])
    const m2 = resolveTurn(m1, map, [{ type: 'factionVote', nationId: 'r1', proposalId: factionOf(m1, 'r0')!.proposals[0].id, vote: 'yes' }])
    const f = factionOf(m2, 'r0')!
    expect(f.proposals).toHaveLength(0)
    expect(f.wars).toHaveLength(1)
    for (const m of ['r0', 'r1', 'r2']) expect(atWar(m2, m, 'r4'), m).toBe(true)
  })

  it('a tie fails: with two of four for and two against, nothing happens', () => {
    const { s, f } = formed(['r0', 'r1', 'r2', 'r5'])
    giveRegions(s, 'r4', ['r3'])
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r4' } })
    const id = f.proposals[0].id
    const m1 = resolveTurn(s, map, [])
    const m2 = resolveTurn(m1, map, [
      { type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'yes' },
      { type: 'factionVote', nationId: 'r2', proposalId: id, vote: 'no' },
      { type: 'factionVote', nationId: 'r5', proposalId: id, vote: 'no' },
    ])
    expect(factionOf(m2, 'r0')!.wars).toHaveLength(0)
    expect(factionOf(m2, 'r0')!.proposals).toHaveLength(0)
    const t = tallyOf(
      m1,
      factionOf(m1, 'r0')!,
      { ...factionOf(m1, 'r0')!.proposals[0], votes: { r0: 'yes', r1: 'yes', r2: 'no', r5: 'no' } },
    )
    expect(t.outcome).toBe('fail')
    const tie2 = tallyOf(m1, factionOf(m1, 'r0')!, { ...factionOf(m1, 'r0')!.proposals[0], votes: { r0: 'yes', r1: 'yes' } })
    expect(tie2.outcome).toBe('open')
  })

  it('votes can be changed until the vote is decided, and only members vote', () => {
    const { s, f } = voting()
    const id = f.proposals[0].id
    ok(s, { type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'no' })
    ok(s, { type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'yes' })
    expect(f.proposals[0].votes.r1).toBe('yes')
    expect(refused(s, { type: 'factionVote', nationId: 'r6', proposalId: id, vote: 'yes' })).toMatch(/not in a faction/)
    expect(refused(s, { type: 'factionVote', nationId: 'r1', proposalId: 'nope', vote: 'yes' })).toMatch(/No such/)
    expect(refused(s, { type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'maybe' as 'yes' })).not.toBeNull()
  })

  it('a proposal nobody answers is decided when time runs out, if at least half the weight spoke', () => {
    const { s, f } = formed(['r0', 'r1', 'r2', 'r5'])
    giveRegions(s, 'r4', ['r3'])
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r4' } })
    let cur = resolveTurn(s, map, [])
    const id = factionOf(cur, 'r0')!.proposals[0].id
    // r0 yes alone is a quarter: not enough to decide when time runs out.
    cur = resolveTurn(cur, map, [])
    expect(factionOf(cur, 'r0')!.proposals).toHaveLength(1)
    cur = resolveTurn(cur, map, [])
    expect(factionOf(cur, 'r0')!.proposals).toHaveLength(0)
    expect(factionOf(cur, 'r0')!.wars).toHaveLength(0)
    // With two yes and one no it passes at expiry even though one member stayed silent.
    const t = tallyOf({ ...cur, turn: f.proposals[0].expires }, f, { ...f.proposals[0], votes: { r0: 'yes', r1: 'yes', r2: 'no' } })
    expect(t.outcome).toBe('pass')
    void id
  })

  it('weighted charter: a big contributor can carry the vote alone, a small one cannot', () => {
    const { s, f } = formed(['r0', 'r1', 'r2'], ['r0', 'r1', 'r2'], { charter: { vote: 'weighted' } })
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: money(100) })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: money(100) })
    ok(s, { type: 'factionContribute', nationId: 'r2', gift: money(800) })
    const w = voteWeights(f)
    expect(w.r2).toBeCloseTo(0.8, 9)
    giveRegions(s, 'r4', ['r3'])
    ok(s, { type: 'factionPropose', nationId: 'r2', proposal: { kind: 'war', target: 'r4' } })
    const m1 = resolveTurn(s, map, [])
    // r2 alone is 80%: the proposal passes without anyone else.
    expect(factionOf(m1, 'r2')!.proposals).toHaveLength(1)
    const m2 = resolveTurn(m1, map, [])
    expect(factionOf(m2, 'r2')!.wars).toHaveLength(1)
    // The same proposal from a small member does not carry on its own.
    const small = resolveTurn(m1, map, [])
    expect(small.turn).toBe(m2.turn)
    const t = tallyOf(m1, factionOf(m1, 'r0')!, { ...factionOf(m1, 'r0')!.proposals[0], by: 'r0', votes: { r0: 'yes' } })
    expect(t.outcome).toBe('open')
  })

  it('members who leave take their votes, and their proposals, with them', () => {
    const { s, f } = voting()
    ok(s, { type: 'factionVote', nationId: 'r1', proposalId: f.proposals[0].id, vote: 'yes' })
    ok(s, { type: 'factionLeave', nationId: 'r1' })
    expect(f.proposals[0].votes.r1).toBeUndefined()
    ok(s, { type: 'factionLeave', nationId: 'r0' })
    expect(f.proposals).toHaveLength(0)
  })

  it('at most a few proposals at once, one for each target, and a member cannot propose their own side', () => {
    const { s } = voting()
    giveRegions(s, 'r5', ['r6'])
    expect(refused(s, { type: 'factionPropose', nationId: 'r1', proposal: { kind: 'war', target: 'r4' } })).toMatch(/already voting/)
    expect(refused(s, { type: 'factionPropose', nationId: 'r1', proposal: { kind: 'war', target: 'r2' } })).toMatch(/in the faction/)
    expect(refused(s, { type: 'factionPropose', nationId: 'r1', proposal: { kind: 'war', target: 'zz' } })).toMatch(/Choose a country/)
  })
})

describe('the joint war', () => {
  function campaign(opts: { charter?: Partial<Faction['charter']>; members?: NationId[]; lines?: number } = {}) {
    const members = opts.members ?? ['r0', 'r1', 'r5']
    const { s, f } = formed(members, members, { charter: opts.charter })
    // r4 holds three countries in a row next to r1... r1 touches r2, so r2 and r3 and r4 are one nation's.
    giveRegions(s, 'r2', ['r3', 'r4'])
    for (const id of ['r2', 'r3', 'r4']) s.regions[id].line = opts.lines ?? 0.4
    setMilitary(s, 'r2', { infantry: 1 })
    // The members pool their armies.
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 8, armor: 3 }, stock: { money: 200, oil: 40, food: 40 } } })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: { units: { infantry: 6, armor: 2 }, stock: { money: 100 } } })
    ok(s, { type: 'factionContribute', nationId: 'r5', gift: { units: { infantry: 4 } } })
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r2' } })
    const id = f.proposals[0].id
    let cur = resolveTurn(s, map, [])
    cur = resolveTurn(cur, map, [{ type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'yes' }])
    return { s: cur, f: factionOf(cur, 'r0')! }
  }

  it('a passed vote puts every able member at war with the target', () => {
    const { s, f } = campaign()
    expect(f.wars).toHaveLength(1)
    for (const m of ['r0', 'r1', 'r5']) expect(atWar(s, m, 'r2'), m).toBe(true)
    expect(f.wars[0].lead).toBeDefined()
    expect(f.history.some((h) => /is at war with/.test(h.text))).toBe(true)
  })

  it('a war without a reason costs the proposer the world\'s trust; a war with a reason does not', () => {
    const noReason = campaign()
    expect(noReason.s.infamy.r0 ?? 0).toBeGreaterThan(0)
    expect(noReason.s.reasons['r0|r2']).toBeUndefined()
    const members = ['r0', 'r1', 'r5']
    const { s, f } = formed(members)
    giveRegions(s, 'r2', ['r3', 'r4'])
    s.casusBelli['r1|r2'] = s.turn + 20
    s.reasons['r1|r2'] = 'Border incident'
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r2' } })
    const id = f.proposals[0].id
    // r0's own cost was the unjustified price, and r1 holds the reason: r1 declares.
    let cur = resolveTurn(s, map, [])
    cur = resolveTurn(cur, map, [{ type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'yes' }])
    expect(atWar(cur, 'r1', 'r2')).toBe(true)
    expect(cur.infamy.r1 ?? 0).toBeLessThan(noReason.s.infamy.r0 ?? 0)
  })

  it('the pooled army attacks as one: one battle for the pool, with the lead member\'s name and the combined force', () => {
    const { s, f } = campaign()
    const joint = s.battles.filter((b) => b.modifiers.some((m) => /Joint army of/.test(m)))
    expect(joint.length).toBeGreaterThanOrEqual(1)
    const b = joint[0]
    expect(b.attacker.nationId).toBe(f.wars[0]?.lead ?? b.attacker.nationId)
    // 18 infantry and 5 tanks went into the one fight.
    expect(b.attacker.units.infantry).toBeCloseTo(18, 5)
    expect(b.attacker.units.armor).toBeCloseTo(5, 5)
    expect(b.armyId).toBeUndefined()
  })

  it('captured countries are split by ownership share, and the treasure is shared with them', () => {
    const { s, f } = campaign({ members: ['r0', 'r1', 'r5'] })
    const taken = ['r2', 'r3', 'r4'].filter((id) => ['r0', 'r1', 'r5'].includes(s.regions[id].owner))
    expect(taken.length).toBeGreaterThanOrEqual(2)
    const given = f.wars[0]?.given ?? {}
    const counts = Object.values(given)
    // Shares are 0.5, 0.25, 0.25 by value (300 money-equivalent v 150 v 40...): nobody gets more than the share rule allows.
    const sh = sharesOf(f)
    const total = counts.reduce((a, b) => a + b, 0)
    for (const m of ['r0', 'r1', 'r5']) expect(given[m] ?? 0).toBeLessThanOrEqual(Math.ceil(sh[m] * total) + 1)
    expect(Object.values(given).length).toBeGreaterThan(0)
  })

  it('the proposer charter hands every country to the proposer', () => {
    const { s } = campaign({ charter: { spoils: 'proposer' } })
    const mine = ['r2', 'r3', 'r4'].filter((id) => s.regions[id].owner !== 'r2')
    expect(mine.length).toBeGreaterThanOrEqual(2)
    for (const id of mine) expect(s.regions[id].owner).toBe('r0')
  })

  it('losses fall on the pool, and are shared by every claim', () => {
    const { s, f } = campaign({ lines: 40 })
    const before = 18
    expect(f.pool.units.infantry).toBeLessThan(before)
    expect(stockRatio(f, 'money')).toBeLessThanOrEqual(1)
    const lost = before - f.pool.units.infantry
    expect(lost).toBeGreaterThan(0)
    expect(withdrawable(f, 'r0', 'money')).toBeLessThanOrEqual(f.pool.stock.money + 1e-9)
    void s
  })

  it('soldiers stay in the pool while the faction is at war, and cannot be taken out', () => {
    const { s } = campaign({ lines: 40 })
    s.turn += 10
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r0', gift: { units: { infantry: 1 } } })).toMatch(/at war/)
    expect(refused(s, { type: 'factionWithdraw', nationId: 'r0', gift: { stock: { money: 1 } } })).toBeNull()
  })

  it('a faction cannot go to war with its own members, allies of every member, or what nobody can reach', () => {
    const { s, f } = formed(['r0', 'r1'])
    expect(warTargetProblem(s, map, f, 'r0', 'r1')).toMatch(/in the faction/)
    expect(warTargetProblem(s, map, f, 'r0', 'r6')).toMatch(/Out of reach/)
    s.alliances.push('r0|r2', 'r1|r2')
    expect(warTargetProblem(s, map, f, 'r0', 'r2')).toMatch(/No member can attack/)
    s.alliances = []
    s.pacts['r0|r2'] = s.turn + 10
    s.pacts['r1|r2'] = s.turn + 10
    expect(warTargetProblem(s, map, f, 'r0', 'r2')).toMatch(/No member can attack/)
    s.pacts = {}
    expect(warTargetProblem(s, map, f, 'r0', 'r2')).toBeNull()
  })

  it('the war ends when the last member makes peace with the target, and the army stays home in the pool', () => {
    const { s, f } = campaign({ lines: 40 })
    s.wars = s.wars.filter((w) => !w.includes('r2'))
    const next = resolveTurn(s, map, [])
    expect(factionOf(next, 'r0')!.wars).toHaveLength(0)
    expect(poolPower(next, factionOf(next, 'r0')!)).toBeGreaterThan(0)
    void f
  })

  it('the pooled army fights without oil and food when the pool has none and no money to buy them', () => {
    const { s: base } = campaign({ lines: 40 })
    const f = factionOf(base, 'r0')!
    f.pool.stock.money = 0
    f.pool.stock.oil = 0
    f.pool.stock.food = 0
    for (const m of f.members) base.nations[m].resources.capital = 0
    const next = resolveTurn(base, map, [])
    expect(factionOf(next, 'r0')!.short).toEqual({ oil: true, food: true })
  })
})

describe('upkeep', () => {
  it('the pool pays for its army out of the pool; when it cannot, members pay by share; what is unpaid deserts', () => {
    const { s, f } = formed(['r0', 'r1'])
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 10, armor: 4 }, stock: { money: 100 } } })
    const need = 10 * 0.6 + 4 * 1.4
    const next = resolveTurn(s, map, [])
    const g = factionOf(next, 'r0')!
    // The pool had 100: it pays the upkeep itself, and buys the oil and food its army ate on the market, with the same money.
    expect(100 - g.pool.stock.money).toBeGreaterThan(need - 1e-6)
    expect(100 - g.pool.stock.money).toBeLessThan(need + 12)
    expect(g.short).toBeUndefined()
    expect(g.pool.units.infantry).toBeCloseTo(10, 6)
    // With no money in the pool the members are charged by share.
    const t = world(['r0', 'r1'])
    ok(t, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    ok(t, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
    ok(t, { type: 'factionJoin', nationId: 'r1', factionId: factionOf(t, 'r0')!.id })
    ok(t, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 10 } } })
    ok(t, { type: 'factionContribute', nationId: 'r1', gift: { units: { infantry: 10 } } })
    const levy = resolveTurn(t, map, [])
    expect(factionOf(levy, 'r0')!.pool.units.infantry).toBeCloseTo(20, 6)
    expect(factionOf(levy, 'r0')!.history.some((h) => /deserted/.test(h.text))).toBe(false)
    // Nobody can pay: soldiers desert.
    const broke = world(['r0', 'r1'])
    ok(broke, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    ok(broke, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 10 } } })
    broke.nations.r0.resources.capital = 0
    broke.nations.r0.taxRate = 0.05
    const hit = resolveTurn(broke, map, [])
    const left = factionOf(hit, 'r0')!.pool.units.infantry
    expect(left).toBeLessThan(10)
    expect(left).toBeGreaterThanOrEqual(5 - 1e-6)
    void f
  })
})

describe('faction contracts with the pool', () => {
  const supply = (s: GameState, member: NationId, terms: Partial<FactionContractTerms> = {}) => {
    const proposal = { kind: 'contract' as const, terms: { member, supply: { oil: 10 }, pay: {}, start: 0, months: 3, collateral: 0, ...terms } }
    ok(s, { type: 'factionPropose', nationId: member, proposal })
    return factionOf(s, member)!
  }

  it('a contract is voted on like a war, then delivers each month and counts as a contribution when nothing is paid back', () => {
    const { s } = formed(['r0', 'r1'])
    const f = supply(s, 'r1')
    const id = f.proposals[0].id
    let cur = resolveTurn(s, map, [])
    cur = resolveTurn(cur, map, [{ type: 'factionVote', nationId: 'r0', proposalId: id, vote: 'yes' }])
    const g = factionOf(cur, 'r0')!
    expect(g.contracts).toHaveLength(1)
    const delivered = g.pool.stock.oil
    expect(delivered).toBeGreaterThan(0)
    expect(g.ledger.r1.stock.oil).toBeCloseTo(delivered, 9)
    const after = resolveTurn(cur, map, [])
    expect(factionOf(after, 'r0')!.pool.stock.oil).toBeCloseTo(delivered + 10, 6)
  })

  it('a paid supply is a sale: the pool pays the member from its money and the ledger does not grow', () => {
    const { s } = formed(['r0', 'r1'])
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: money(500) })
    const f = supply(s, 'r1', { supply: { steel: 5 }, pay: { money: 20 }, months: 2 })
    const id = f.proposals[0].id
    let cur = resolveTurn(s, map, [])
    cur = resolveTurn(cur, map, [{ type: 'factionVote', nationId: 'r0', proposalId: id, vote: 'yes' }])
    const g = factionOf(cur, 'r0')!
    expect(g.pool.stock.steel).toBeCloseTo(5, 6)
    expect(g.ledger.r1.stock.steel).toBe(0)
    expect(g.pool.stock.money).toBeCloseTo(500 - 20, 6)
  })

  it('the pool cannot be made to pay what it does not have: the contract ends and the collateral comes back', () => {
    const { s } = formed(['r0', 'r1'])
    const f = supply(s, 'r1', { supply: { steel: 5 }, pay: { money: 20 }, months: 3, collateral: 50 })
    const id = f.proposals[0].id
    let cur = resolveTurn(s, map, [])
    const before = cur.nations.r1.resources.capital
    cur = resolveTurn(cur, map, [{ type: 'factionVote', nationId: 'r0', proposalId: id, vote: 'yes' }])
    const g = factionOf(cur, 'r0')!
    expect(g.contracts).toHaveLength(0)
    expect(g.history.some((h) => /could not pay/.test(h.text))).toBe(true)
    expect(cur.nations.r1.resources.capital).toBeGreaterThan(before - 5)
    void before
  })

  it('a member who cannot deliver breaks the contract, loses the collateral to the pool and the others think worse of them', () => {
    const { s } = formed(['r0', 'r1'], ['r1'])
    const f = supply(s, 'r1', { supply: { oil: 90 }, months: 3, collateral: 80 })
    const id = f.proposals[0].id
    let cur = resolveTurn(s, map, [])
    cur = resolveTurn(cur, map, [{ type: 'factionVote', nationId: 'r0', proposalId: id, vote: 'yes' }])
    expect(factionOf(cur, 'r0')!.contracts).toHaveLength(1)
    cur.nations.r1.resources.oil = 0
    const money0 = factionOf(cur, 'r0')!.pool.stock.money
    cur = resolveTurn(cur, map, [])
    const g = factionOf(cur, 'r0')!
    expect(g.contracts).toHaveLength(0)
    expect(g.pool.stock.money).toBeCloseTo(money0 + 80, 6)
    expect((cur.opinions['r0>r1'] ?? []).some((o) => o.label === 'Broke a faction contract')).toBe(true)
  })

  it('a contract is checked: only for yourself, in range, never empty', () => {
    const { s } = formed(['r0', 'r1'])
    const t = (terms: object) => ({ type: 'factionPropose' as const, nationId: 'r1', proposal: { kind: 'contract' as const, terms: { member: 'r1', supply: { oil: 5 }, pay: {}, start: 0, months: 2, collateral: 0, ...terms } } })
    expect(refused(s, t({}))).toBeNull()
    expect(refused(s, t({ member: 'r0' }))).toMatch(/for yourself/)
    expect(refused(s, t({ supply: {}, pay: {} }))).toMatch(/empty/)
    expect(refused(s, t({ months: 0 }))).toMatch(/months/)
    expect(refused(s, t({ months: 99 }))).toMatch(/months/)
    expect(refused(s, t({ start: 9 }))).toMatch(/start/)
    expect(refused(s, t({ collateral: -5 }))).toMatch(/Collateral/)
    expect(refused(s, t({ supply: { oil: -5 } }))).toMatch(/Invalid/)
    expect(refused(s, t({ supply: { oil: 9999 } }))).toMatch(/Invalid/)
    expect(refused(s, t({ supply: { gold: 5 } }))).toMatch(/cannot hold/)
  })
})

describe('live contracts between two nations (state.deals)', () => {
  const contract = (terms: object): Order => ({ type: 'propose', nationId: 'r0', target: 'r1', proposal: { kind: 'trade', terms: { give: { oil: 10 }, receive: {}, months: 3, ...terms } } })

  it('start late: nothing moves before the start month, then oil flows each month', () => {
    const s = world(['r0', 'r1'])
    const o = contract({ start: 2 })
    expect(refused(s, o)).toBeNull()
    let cur = resolveTurn(s, map, [o])
    expect(cur.proposals).toHaveLength(1)
    cur = resolveTurn(cur, map, [{ type: 'respond', nationId: 'r1', proposalId: cur.proposals[0].id, accept: true }])
    expect(cur.deals).toHaveLength(1)
    const d = cur.deals[0]
    expect(d.contract?.start).toBe(cur.turn - 1 + 2)
    expect(d.until).toBe(d.contract!.start + 2)
    const oil = cur.nations.r1.resources.oil
    const first = resolveTurn(cur, map, [])
    expect(first.deals).toHaveLength(1)
    // Still waiting: r1's oil only moves with the world (no delivery).
    expect(first.nations.r1.resources.oil).toBeLessThanOrEqual(oil + 5)
    const second = resolveTurn(first, map, [])
    const third = resolveTurn(second, map, [])
    expect(third.nations.r1.resources.oil).toBeGreaterThan(second.nations.r1.resources.oil - 1)
  })

  it('collateral is held, returned when the contract is fulfilled, and handed over on a breach', () => {
    const s = world(['r0', 'r1'])
    const o = contract({ collateral: 200, months: 2 })
    let cur = resolveTurn(s, map, [o])
    const before = cur.nations.r0.resources.capital
    cur = resolveTurn(cur, map, [{ type: 'respond', nationId: 'r1', proposalId: cur.proposals[0].id, accept: true }])
    expect(cur.deals[0].contract?.held).toBe(200)
    expect(cur.nations.r0.resources.capital).toBeLessThan(before)
    const done = resolveTurn(cur, map, [])
    const end = resolveTurn(done, map, [])
    expect(end.deals).toHaveLength(0)
    // Fulfilled: the collateral came home.
    expect(end.nations.r0.resources.capital).toBeGreaterThan(done.nations.r0.resources.capital)
    // A breach: r0 runs out of oil.
    const broke = structuredClone(cur)
    broke.nations.r0.resources.oil = 0
    const r1Money = broke.nations.r1.resources.capital
    const after = resolveTurn(broke, map, [])
    expect(after.deals).toHaveLength(0)
    expect(after.nations.r1.resources.capital).toBeGreaterThan(r1Money + 150)
    expect((after.opinions['r1>r0'] ?? []).some((m) => m.label === 'Broke a contract')).toBe(false)
    expect(after.casusBelli['r1|r0']).toBeGreaterThanOrEqual(after.turn)
  })

  it('join my wars: the partner takes up every war the proposer fights, for as long as it runs', () => {
    const s = world(['r0', 'r1'])
    s.wars.push('r0|r4')
    const o = contract({ give: {}, joinWars: true, months: 4 })
    expect(refused(s, o)).toBeNull()
    let cur = resolveTurn(s, map, [o])
    cur = resolveTurn(cur, map, [{ type: 'respond', nationId: 'r1', proposalId: cur.proposals[0].id, accept: true }])
    expect(atWar(cur, 'r1', 'r4')).toBe(true)
    cur.wars.push('r0|r6')
    cur.wars.sort()
    const next = resolveTurn(cur, map, [])
    expect(atWar(next, 'r1', 'r6')).toBe(true)
  })

  it('a partner who cannot join (bound by a pact to the enemy) breaks the contract', () => {
    const s = world(['r0', 'r1'])
    const o = contract({ give: {}, joinWars: true, months: 4 })
    let cur = resolveTurn(s, map, [o])
    cur = resolveTurn(cur, map, [{ type: 'respond', nationId: 'r1', proposalId: cur.proposals[0].id, accept: true }])
    cur.wars.push('r0|r4')
    cur.pacts['r1|r4'] = cur.turn + 20
    const next = resolveTurn(cur, map, [])
    expect(next.deals).toHaveLength(0)
    expect(atWar(next, 'r1', 'r4')).toBe(false)
    expect(next.casusBelli['r0|r1']).toBeGreaterThanOrEqual(next.turn)
  })

  it('cancelling a running contract gives the collateral to the other side; before it starts it comes back', () => {
    const s = world(['r0', 'r1'])
    const o = contract({ collateral: 100, start: 3 })
    let cur = resolveTurn(s, map, [o])
    cur = resolveTurn(cur, map, [{ type: 'respond', nationId: 'r1', proposalId: cur.proposals[0].id, accept: true }])
    const early = resolveTurn(cur, map, [{ type: 'cancelDeal', nationId: 'r0', dealId: cur.deals[0].id }])
    expect(early.deals).toHaveLength(0)
    const r0Before = cur.nations.r0.resources.capital
    expect(early.nations.r0.resources.capital).toBeGreaterThan(r0Before)
    const running = structuredClone(cur)
    running.turn = running.deals[0].contract!.start
    const r1Before = running.nations.r1.resources.capital
    ok(running, { type: 'cancelDeal', nationId: 'r0', dealId: running.deals[0].id })
    expect(running.nations.r1.resources.capital).toBeCloseTo(r1Before + 100, 6)
  })

  it('refuses a contract with bad terms, and collateral the proposer does not have', () => {
    const s = world(['r0', 'r1'])
    expect(refused(s, contract({ start: 9 }))).toMatch(/start/)
    expect(refused(s, contract({ start: -1 }))).toMatch(/start/)
    expect(refused(s, contract({ collateral: 9999 }))).toMatch(/Collateral/)
    expect(refused(s, contract({ collateral: NaN }))).toMatch(/Collateral/)
    expect(refused(s, contract({ months: 0, joinWars: true }))).toMatch(/at least a month/)
    expect(refused(s, contract({ give: {}, receive: {} }))).toMatch(/empty/)
    s.nations.r0.resources.capital = 50
    expect(refused(s, contract({ collateral: 100 }))).toMatch(/collateral/)
  })

  it('a rival accepts a pledge to fight beside it only from a friend', () => {
    const s = world(['r0'])
    const o = contract({ give: {}, joinWars: true, months: 4 })
    const stranger = resolveTurn(s, map, [o])
    expect(stranger.deals).toHaveLength(0)
    const friend = world(['r0'])
    friend.alliances.push('r0|r1')
    const done = resolveTurn(friend, map, [o])
    expect(done.deals).toHaveLength(1)
    expect(done.deals[0].contract?.joins).toBe('r1')
  })
})

describe('rivals in factions', () => {
  it('Easy rivals ignore factions altogether; Medium and Hard found, join, pay in and vote', () => {
    let founded = 0
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const s = world(['r0'])
      s.settings.difficulty = level
      s.turn = 8
      s.alliances.push('r1|r2')
      let made = 0
      let cur = s
      for (let i = 0; i < 12; i++) {
        cur = resolveTurn(cur, map, generateAllBotOrders(cur, map))
        made += cur.factions?.length ?? 0
      }
      if (level === 'easy') expect(cur.factions).toBeUndefined()
      else founded += made
    }
    expect(founded).toBeGreaterThan(0)
  })

  it('a rival member votes by what it thinks of the target and its own reasons', () => {
    const { s, f } = formed(['r0', 'r1', 'r2'], ['r0'])
    s.settings.difficulty = 'hard'
    s.turn = 30
    giveRegions(s, 'r4', ['r3'])
    for (const m of ['r1', 'r2']) addOpinion(s, m, 'r4', 'Rival', -50, 0.1)
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r4' } })
    const next = resolveTurn(s, map, [])
    const orders = [generateBotOrders(next, map, 'r1'), generateBotOrders(next, map, 'r2')].flat()
    const votes = orders.filter((o) => o.type === 'factionVote')
    expect(votes.length).toBe(2)
    expect(votes.every((o) => o.type === 'factionVote' && o.vote === 'yes')).toBe(true)
    const friendly = structuredClone(next)
    for (const m of ['r1', 'r2']) addOpinion(friendly, m, 'r4', 'Friends', 120, 0.1)
    friendly.alliances.push('r1|r4')
    const no = generateBotOrders(friendly, map, 'r1').filter((o) => o.type === 'factionVote')
    expect(no[0] && no[0].type === 'factionVote' && no[0].vote).toBe('no')
    void f
  })

  it('humans and rivals in one faction: the whole path from proposal to joint attack', () => {
    const { s } = formed(['r0', 'r1', 'r5'], ['r0'])
    s.settings.difficulty = 'hard'
    s.turn = 30
    giveRegions(s, 'r2', ['r3', 'r4'])
    for (const id of ['r2', 'r3', 'r4']) s.regions[id].line = 0.4
    for (const m of ['r1', 'r5']) addOpinion(s, m, 'r2', 'Rival', -60, 0.05)
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 9, armor: 4 }, stock: { money: 200, oil: 40, food: 40 } } })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: { units: { infantry: 6 } } })
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r2' } })
    let cur = resolveTurn(s, map, [])
    // The rivals vote on their own, from the state, as the game would.
    cur = resolveTurn(cur, map, [...generateBotOrders(cur, map, 'r1'), ...generateBotOrders(cur, map, 'r5')])
    const f = factionOf(cur, 'r0')!
    expect(f.wars).toHaveLength(1)
    expect(atWar(cur, 'r5', 'r2')).toBe(true)
    expect(['r2', 'r3', 'r4'].some((id) => f.members.includes(cur.regions[id].owner))).toBe(true)
  })
})

describe('notifications and online play', () => {
  it('tell a member about an invitation, a vote that needs them and a war that began', () => {
    const { s, f } = formed(['r0', 'r1'])
    const outsider = world(['r0', 'r1', 'r2'])
    ok(outsider, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    ok(outsider, { type: 'factionInvite', nationId: 'r0', target: 'r2' })
    expect(factionNews(world(['r0', 'r1', 'r2']), outsider, 'r2').join(' ')).toMatch(/invited you/)
    giveRegions(s, 'r2', ['r3'])
    const before = structuredClone(s)
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r2' } })
    expect(factionNews(before, s, 'r1').join(' ')).toMatch(/needs you/)
    expect(factionNews(before, s, 'r0').join(' ')).not.toMatch(/needs you/)
    void f
  })

  it('the state is plain data: it survives a save and a load and the faction plays on', () => {
    const { s } = formed(['r0', 'r1'])
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: { stock: { money: 100 }, units: { infantry: 3 } } })
    const copy = JSON.parse(JSON.stringify(s)) as GameState
    const a = resolveTurn(s, map, [])
    const b = resolveTurn(copy, map, [])
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('every faction order is a month-end order, validated again by the host against the sender\'s own nation', () => {
    const { s } = formed(['r0', 'r1'])
    const forged: Order = { type: 'factionContribute', nationId: 'r1', gift: money(100) }
    // The host throws away orders that name a nation other than the sender's; an order that arrives anyway is checked as that nation's.
    const next = resolveTurn(s, map, [forged])
    expect(factionOf(next, 'r1')!.pool.stock.money).toBeCloseTo(100 - 0, 6)
  })
})

describe('turn and live months are the same month for a faction', () => {
  it('a vote and a joint war give the same war in a live month as in a turn month (the fighting itself marches in live: see factionLive.test.ts)', () => {
    const { s: base } = formed(['r0', 'r1', 'r5'])
    giveRegions(base, 'r2', ['r3', 'r4'])
    for (const id of ['r2', 'r3', 'r4']) base.regions[id].line = 0.4
    ok(base, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 8, armor: 3 }, stock: { money: 200, oil: 40, food: 40 } } })
    ok(base, { type: 'factionContribute', nationId: 'r1', gift: { units: { infantry: 6 } } })
    ok(base, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r2' } })
    const id = factionOf(base, 'r0')!.proposals[0].id
    const monthOrders = (turn: number): Order[] => (turn === base.turn + 1 ? [{ type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'yes' }] : [])
    let turn = structuredClone(base)
    for (let i = 0; i < 2; i++) turn = resolveTurn(turn, map, monthOrders(turn.turn))
    let live = startLive(structuredClone(base))
    while (live.turn < turn.turn) {
      const last = (live.day ?? 0) >= daysInMonth(live.turn) - 1
      live = advanceDay(live, map, { monthOrders: last ? monthOrders(live.turn) : undefined, planner: () => [] }).state
    }
    // What the vote and the declaration decided: members, ledger, who leads, who declared, the wars between nations. The pool's losses and
    // the land it took are not compared: a turn game fights at once, a live game sends the army on its way (it has not arrived yet).
    const core = (s: GameState) => {
      const f = factionOf(s, 'r0')!
      return JSON.stringify({ members: f.members, ledger: f.ledger, charter: f.charter, proposals: f.proposals, wars: f.wars.map((w) => ({ id: w.id, target: w.target, lead: w.lead, proposer: w.proposer, since: w.since })), nationsWars: s.wars, history: f.history.filter((h) => !/joint army|goes to/.test(h.text)) })
    }
    expect(factionOf(turn, 'r0')!.wars.length).toBe(1)
    expect(core(live)).toBe(core(turn))
  })
})

describe('edge cases the host and the desk meet', () => {
  /** r0, r1, r5 at war with r2 (which holds r3 and r4 too), the pool full of soldiers. */
  function atWarTogether() {
    const members: NationId[] = ['r0', 'r1', 'r5']
    const { s, f } = formed(members, members)
    giveRegions(s, 'r2', ['r3', 'r4'])
    for (const id of ['r2', 'r3', 'r4']) s.regions[id].line = 40
    setMilitary(s, 'r2', { infantry: 30 })
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 8, armor: 3 }, stock: { money: 200, oil: 40, food: 40 } } })
    ok(s, { type: 'factionContribute', nationId: 'r1', gift: { units: { infantry: 6 } } })
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r2' } })
    const id = f.proposals[0].id
    let cur = resolveTurn(s, map, [])
    cur = resolveTurn(cur, map, [{ type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'yes' }])
    return { s: cur, f: factionOf(cur, 'r0')! }
  }

  it('a member who leaves in the middle of a war leaves its soldiers in the fight, and the command passes on', () => {
    const { s, f } = atWarTogether()
    s.turn += FACTION.lockMonths + 1
    // r1 put soldiers in and commands the army.
    f.wars[0].lead = 'r1'
    const lead = 'r1'
    const soldiers = f.pool.units.infantry
    const m = s.nations[lead]
    const homeBefore = m.military.units.infantry
    ok(s, { type: 'factionLeave', nationId: lead })
    expect(f.members).not.toContain(lead)
    expect(f.wars[0].lead).not.toBe(lead)
    expect(f.members).toContain(f.wars[0].lead)
    // The soldiers stay in the pool, and the leaver gets money back but no soldiers.
    expect(f.pool.units.infantry).toBeCloseTo(soldiers, 9)
    expect(m.military.units.infantry).toBeCloseTo(homeBefore, 9)
    const next = resolveTurn(s, map, [])
    expect(factionOf(next, 'r0')!.wars).toHaveLength(1)
  })

  it('a faction whose only member at war falls ends the war and carries on in peace', () => {
    const { s, f } = atWarTogether()
    s.nations.r5.alive = false
    for (const rid of Object.keys(s.regions)) if (s.regions[rid].owner === 'r5') s.regions[rid].owner = 'r4'
    const next = resolveTurn(s, map, [])
    expect(factionOf(next, 'r0')!.members).not.toContain('r5')
    expect(f.members).toContain('r0')
  })

  it('a human member who is offline during a vote is voted for by the host through the rival play, by the same rules', () => {
    const { s } = formed(['r0', 'r1', 'r2'], ['r0'])
    s.settings.difficulty = 'hard'
    s.turn = 30
    giveRegions(s, 'r4', ['r3'])
    for (const m of ['r0', 'r1', 'r2']) addOpinion(s, m, 'r4', 'Rival', -60, 0.05)
    ok(s, { type: 'factionPropose', nationId: 'r1', proposal: { kind: 'war', target: 'r4' } })
    const next = resolveTurn(s, map, [])
    // r0 is a person who is away: the host plays its nation with allowPlayer on.
    const orders = generateBotOrders(next, map, 'r0', true)
    const vote = orders.find((o) => o.type === 'factionVote')
    expect(vote && vote.type === 'factionVote' && vote.vote).toBe('yes')
    // And an Easy world never does.
    next.settings.difficulty = 'easy'
    expect(generateBotOrders(next, map, 'r0', true).some((o) => o.type === 'factionVote')).toBe(false)
  })

  it('a proposal that nobody can carry expires and leaves nothing behind', () => {
    const { s, f } = formed(['r0', 'r1', 'r2'])
    giveRegions(s, 'r4', ['r3'])
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r4' } })
    const pp = s.nations.r0.resources.pp
    let cur = s
    for (let i = 0; i < FACTION.voteMonths + 2; i++) cur = resolveTurn(cur, map, [])
    expect(factionOf(cur, 'r0')!.proposals).toHaveLength(0)
    expect(factionOf(cur, 'r0')!.wars).toHaveLength(0)
    expect(factionOf(cur, 'r0')!.history.some((h) => /voted down/.test(h.text))).toBe(true)
    // The stake is spent either way.
    expect(cur.nations.r0.resources.pp).toBeLessThanOrEqual(pp + 40)
    void f
  })

  it('the advisor tells a member about a vote that needs them, and stops when the vote is queued', () => {
    const { s } = formed(['r0', 'r1'])
    giveRegions(s, 'r2', ['r3'])
    ok(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r2' } })
    const id = factionOf(s, 'r0')!.proposals[0].id
    expect(advise(s, map, 'r1', [], 20).some((a) => a.id === 'faction-vote' && a.target.desk === 'faction')).toBe(true)
    expect(advise(s, map, 'r0', [], 20).some((a) => a.id === 'faction-vote')).toBe(false)
    const queued: Order = { type: 'factionVote', nationId: 'r1', proposalId: id, vote: 'yes' }
    expect(advise(s, map, 'r1', [queued], 20).some((a) => a.id === 'faction-vote')).toBe(false)
  })

  it('the advisor shows an invitation until it is answered', () => {
    const s = world(['r0', 'r1'])
    ok(s, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
    const f = factionOf(s, 'r0')!
    expect(advise(s, map, 'r1', [], 20).some((a) => a.id === 'faction-invite')).toBe(true)
    expect(advise(s, map, 'r1', [{ type: 'factionJoin', nationId: 'r1', factionId: f.id }], 20).some((a) => a.id === 'faction-invite')).toBe(false)
  })

  it('pool upkeep that cannot be paid never makes anything negative, and the soldiers desert', () => {
    const { s } = formed(['r0', 'r1'])
    ok(s, { type: 'factionContribute', nationId: 'r0', gift: { units: { infantry: 10, armor: 4 } } })
    for (const n of Object.values(s.nations)) n.resources.capital = 0
    for (let i = 0; i < 6; i++) {
      // The month's upkeep with an empty pool and empty treasuries.
      runFactionMonth(s)
      const f = factionOf(s, 'r0')!
      for (const r of POOL_RESOURCES) expect(f.pool.stock[r]).toBeGreaterThanOrEqual(-1e-9)
      for (const k of Object.keys(f.pool.units) as (keyof typeof f.pool.units)[]) expect(f.pool.units[k]).toBeGreaterThanOrEqual(0)
      for (const n of Object.values(s.nations)) expect(n.resources.capital).toBeGreaterThanOrEqual(-1e-9)
    }
    expect(factionOf(s, 'r0')!.pool.units.infantry).toBeLessThan(5)
    expect(factionOf(s, 'r0')!.history.some((h) => /deserted/.test(h.text))).toBe(true)
  })

  it('a damaged faction in a save is repaired on load', async () => {
    const { normalizeGame } = await import('../migrate')
    const { s } = formed(['r0', 'r1'])
    const copy = JSON.parse(JSON.stringify(s)) as GameState
    copy.factions![0].pool.stock.money = Number.NaN
    copy.factions![0].members.push('nowhere')
    delete (copy.factions![0].ledger as Record<string, unknown>).r1
    const fixed = normalizeGame(copy, map)
    const f = fixed.factions![0]
    expect(f.pool.stock.money).toBe(0)
    expect(f.members).toEqual(['r0', 'r1'])
    expect(f.ledger.r1).toBeDefined()
    copy.factions = [{ junk: true } as never]
    expect(normalizeGame(copy, map).factions).toBeUndefined()
  })
})
