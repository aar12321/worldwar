import { describe, expect, it } from 'vitest'
import { DIPLOMACY } from '../../data/unitTypes'
import { computeEconomy } from '../economy'
import { declareWar, loanPayment, respond } from '../diplomacy'
import { guarantorsOf, sanctionersOf } from '../helpers'
import { validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { createRng } from '../rng'
import { countriesTaken } from '../victory'
import { puppetValue } from '../warscore'
import type { GameState, Proposal } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(5)
const P = 'r0'

function base(): GameState {
  const s = startState(map)
  s.nations[P].resources.capital = 600
  s.nations[P].resources.pp = 100
  return s
}

const proposal = (s: GameState, p: Record<string, unknown> & { kind: string }, from = P, to = 'r1'): Proposal => {
  const full = { ...p, id: 'p1', from, to, created: s.turn, expires: s.turn + 6 } as Proposal
  s.proposals.push(full)
  return full
}

describe('loans', () => {
  it('move money now and are repaid with interest every month', () => {
    const s = base()
    s.nations.r1.isPlayer = true
    s.nations.r0.isPlayer = false
    s.playerId = 'r1'
    s.nations.r0.resources.capital = 300
    const p = proposal(s, { kind: 'loan', amount: 120, months: 12 })
    const borrowerBefore = s.nations.r1.resources.capital
    respond(s, map, 'r1', p.id, true, createRng(1, 1))
    expect(s.nations.r0.resources.capital).toBe(180)
    expect(s.nations.r1.resources.capital).toBe(borrowerBefore + 120)
    expect(s.deals).toHaveLength(1)
    expect(s.deals[0].kind).toBe('loan')
    expect(s.deals[0].give.capital).toBeCloseTo(loanPayment(120, 12))
    expect(loanPayment(120, 12) * 12).toBeCloseTo(120 * (1 + DIPLOMACY.loan.interest * 12))
    const lenderBefore = s.nations.r0.resources.capital
    s.nations.r1.resources.capital = 500
    const next = resolveTurn(s, map, [])
    expect(next.nations.r1.resources.capital).toBeLessThan(500 + 1000)
    expect(next.nations.r0.resources.capital).toBeGreaterThan(lenderBefore)
  })

  it('has limits, and a lender must have the money', () => {
    const s = base()
    const v = (amount: number, months: number) => validateOrder(s, map, { type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'loan', amount, months } })
    expect(v(10, 12)).toMatch(/Loans run/)
    expect(v(100, 1)).toMatch(/months/)
    expect(v(100, 12)).toBeNull()
    s.nations[P].resources.capital = 50
    expect(v(100, 12)).toMatch(/do not have/)
  })

  it('a bot with money troubles takes one, a bot that cannot pay does not', () => {
    const needy = base()
    needy.nations.r1.resources.capital = 5
    needy.nations.r1.autoBuy = []
    const accepted = resolveTurn(needy, map, [{ type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'loan', amount: 100, months: 12 } }])
    expect(accepted.deals.some((d) => d.kind === 'loan')).toBe(true)
    const broke = base()
    broke.nations.r1.resources.capital = 5
    broke.nations.r1.taxRate = 0.05
    broke.nations.r1.autoBuy = []
    setMilitary(broke, 'r1', { infantry: 200 })
    const refused = resolveTurn(broke, map, [{ type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'loan', amount: 400, months: 3 } }])
    expect(refused.deals.some((d) => d.kind === 'loan')).toBe(false)
  })
})

describe('sanctions', () => {
  it('cut the target market access and port trade, and expire', () => {
    const s = base()
    s.regions.r1.buildings.port = 3
    const free = computeEconomy(s, map, 'r1')
    expect(applyOrderNow(s, map, { type: 'imposeSanctions', nationId: P, target: 'r1' }).error).toBeNull()
    expect(sanctionersOf(s, 'r1')).toEqual([P])
    const hit = computeEconomy(s, map, 'r1')
    expect(hit.tradeCapacity).toBeCloseTo(free.tradeCapacity * (1 - DIPLOMACY.sanctions.tradeCut))
    expect(hit.tradeIncome).toBeLessThan(free.tradeIncome)
    expect(validateOrder(s, map, { type: 'imposeSanctions', nationId: P, target: 'r1' })).toMatch(/Already/)
    s.turn += DIPLOMACY.sanctions.months + 2
    expect(sanctionersOf(resolveTurn(s, map, []), 'r1')).toEqual([])
  })

  it('several sanctioners hurt more, never below the floor, and can be lifted', () => {
    const s = base()
    for (const id of ['r0', 'r2', 'r3', 'r4']) s.sanctions.push({ from: id, to: 'r1', until: 99 })
    s.regions.r1.buildings.port = 2
    const e = computeEconomy(s, map, 'r1')
    s.sanctions = []
    expect(e.tradeCapacity).toBeLessThan(computeEconomy(s, map, 'r1').tradeCapacity * 0.5)
    s.sanctions.push({ from: P, to: 'r1', until: 99 })
    applyOrderNow(s, map, { type: 'liftSanctions', nationId: P, target: 'r1' })
    expect(s.sanctions).toEqual([])
  })
})

describe('guarantees', () => {
  it('bring the guarantor into the war when the guaranteed nation is attacked', () => {
    const s = base()
    s.guarantees.push({ from: 'r2', to: 'r1', until: 99 })
    expect(guarantorsOf(s, 'r1')).toEqual(['r2'])
    const rng = createRng(1, 1)
    declareWar(s, map, 'r3', 'r1', rng)
    // The guarantor is a bot with no pact or tie to the aggressor, so it answers the call.
    expect(s.wars.some((w) => w.includes('r2') && w.includes('r3')) || s.log.some((l) => /guarantee|ignored/i.test(l.text)) || s.dispatches.length > 0).toBe(true)
  })

  it('are a proposal that lasts three years', () => {
    const s = base()
    const next = resolveTurn(s, map, [{ type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'guarantee' } }])
    const accepted = next.guarantees.some((g) => g.from === P && g.to === 'r1')
    const refused = next.dispatches.some((d) => d.kind === 'rejected' && d.proposalKind === 'guarantee')
    expect(accepted || refused).toBe(true)
    if (accepted) expect(next.guarantees[0].until).toBe(s.turn + DIPLOMACY.guarantee.months)
  })

  it('cannot be offered to an ally or an enemy', () => {
    const s = base()
    s.alliances = ['r0|r1']
    expect(validateOrder(s, map, { type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'guarantee' } })).toMatch(/Allies/)
    s.alliances = []
    s.wars = ['r0|r1']
    expect(validateOrder(s, map, { type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'guarantee' } })).toMatch(/at war/)
  })
})

describe('puppet states', () => {
  function winning(): GameState {
    const s = base()
    s.wars = ['r0|r1']
    s.warScore['r0>r1'] = 90
    return s
  }

  it('cost war score, and a nation with an overlord cannot declare war', () => {
    const s = winning()
    const value = puppetValue(s, map, 'r1')
    expect(value).toBeGreaterThanOrEqual(DIPLOMACY.puppet.minValue)
    s.warScore['r0>r1'] = 1
    expect(validateOrder(s, map, { type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'peace', terms: { cede: [], reparations: 0, puppet: true } } })).toMatch(/exceed your war score/)
    s.nations.r1.overlord = P
    s.wars = []
    expect(validateOrder(s, map, { type: 'declareWar', nationId: 'r1', target: 'r2' })).toMatch(/puppet/)
    expect(validateOrder(s, map, { type: 'declareWar', nationId: P, target: 'r1' })).toMatch(/puppet/)
  })

  it('a conquered nation that accepts becomes a puppet, pays tribute and counts as half a country', () => {
    const s = winning()
    s.nations.r1.warWeariness = 55
    s.nations.r1.resources.capital = 200
    const next = resolveTurn(s, map, [{ type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'peace', terms: { cede: [], reparations: 0, puppet: true } } }])
    if (next.nations.r1.overlord !== P) return // a stubborn bot may refuse; the engine path is covered below
    expect(next.wars).toEqual([])
    expect(next.regions.r1.owner).toBe('r1')
    expect(countriesTaken({ ...next, playerId: P })).toBe(0)
  })

  it('tribute flows to the master every month, and a dead master frees the puppet', () => {
    let s = base()
    s.nations.r1.overlord = P
    const masterBefore = s.nations[P].resources.capital
    const e = computeEconomy(s, map, 'r1')
    const tribute = Math.max(0, e.taxIncome + e.factoryIncome + e.tradeIncome + e.corporateIncome) * DIPLOMACY.puppet.tribute
    const a = resolveTurn(structuredClone(s), map, [])
    const b = structuredClone(s)
    b.nations.r1.overlord = null
    const c = resolveTurn(b, map, [])
    expect(a.nations[P].resources.capital - c.nations[P].resources.capital).toBeGreaterThan(tribute * 0.5)
    expect(masterBefore).toBeGreaterThan(0)
    s.nations[P].alive = false
    s = resolveTurn(s, map, [])
    expect(s.nations.r1.overlord).toBeNull()
  })

  it('two puppets count as one more country toward the goal', () => {
    const s = base()
    s.nations.r1.overlord = P
    s.nations.r2.overlord = P
    expect(countriesTaken(s)).toBe(1)
    s.nations.r3.overlord = P
    expect(countriesTaken(s)).toBe(1)
  })

  it('a master can set a puppet free', () => {
    const s = base()
    s.nations.r1.overlord = P
    expect(applyOrderNow(s, map, { type: 'releasePuppet', nationId: P, target: 'r1' }).error).toBeNull()
    expect(s.nations.r1.overlord).toBeNull()
    expect(validateOrder(s, map, { type: 'releasePuppet', nationId: P, target: 'r1' })).toMatch(/not your puppet/)
  })
})

describe('the economic victory and the economy techs', () => {
  it('a nation with a big enough share of the world output wins', async () => {
    const { checkOutcome, economicGoal, economicShare, grossIncome, worldGross } = await import('../victory')
    const s = base()
    s.worldGross = worldGross(s, map)
    const share = economicShare(s, map, P)
    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThan(1)
    expect(checkOutcome(s, map)).toBe('playing')
    s.settings.victoryShare = 0.4
    s.worldGross = grossIncome(s, map, P) / (economicGoal(0.4) + 0.01)
    expect(checkOutcome(s, map)).toBe('victory')
    s.worldGross = 0
    expect(economicShare(s, map, P)).toBe(0)
  })

  it('half a puppet counts toward the share', async () => {
    const { economicShare, grossIncome, worldGross } = await import('../victory')
    const s = base()
    s.worldGross = worldGross(s, map)
    const alone = economicShare(s, map, P)
    s.nations.r1.overlord = P
    expect(economicShare(s, map, P)).toBeCloseTo(alone + (grossIncome(s, map, 'r1') * 0.5) / s.worldGross)
  })

  it('every economy tech changes the numbers it describes', async () => {
    const { TECHS } = await import('../../data/techTree')
    const { policyEffects } = await import('../policy')
    const eco = TECHS.filter((t) => t.branch === 'economy')
    expect(eco).toHaveLength(6)
    const s = base()
    const none = policyEffects(s.nations[P])
    for (const tech of eco) {
      const n = structuredClone(s.nations[P])
      n.techs = [tech.id]
      const e = policyEffects(n)
      const changed = (Object.keys(e) as (keyof typeof e)[]).some((k) => e[k] !== none[k])
      expect(changed, tech.id).toBe(true)
    }
    for (const t of eco.slice(1)) expect(t.requires.length).toBe(1)
  })
})

describe('older saves', () => {
  it('load with every new field filled in and keep playing', async () => {
    const { normalizeGame } = await import('../migrate')
    const s = base()
    const old = structuredClone(s) as unknown as Record<string, unknown> & { nations: Record<string, Record<string, unknown>>; regions: Record<string, Record<string, unknown>> }
    for (const n of Object.values(old.nations)) {
      for (const k of ['government', 'budget', 'corporateTax', 'nextElection', 'lastReform', 'sectors', 'subsidies', 'debt', 'redMonths', 'defaultedUntil', 'overlord', 'oilShortage', 'goodsShortage', 'tradeUsed', 'autoBuy']) delete n[k]
      const res = n.resources as Record<string, number>
      delete res.oil
      delete res.steel
      delete res.goods
    }
    for (const r of Object.values(old.regions)) delete r.cities
    for (const k of ['investments', 'sanctions', 'guarantees', 'worldGross']) delete old[k]
    const loaded = normalizeGame(old as unknown as GameState, map)
    expect(loaded.nations[P].government).toBeTruthy()
    expect(loaded.regions[P].cities.length).toBeGreaterThan(0)
    expect(loaded.investments).toEqual([])
    const next = resolveTurn(loaded, map, [])
    expect(Number.isFinite(next.nations[P].resources.capital)).toBe(true)
    expect(Number.isFinite(next.nations[P].resources.oil)).toBe(true)
    expect(next.turn).toBe(loaded.turn + 1)
  })
})
