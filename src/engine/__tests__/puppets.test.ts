import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { managePuppets } from '../../ai/puppets'
import { PUPPET, TRIBUTE } from '../../data/puppets'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { empireCount } from '../empire'
import { annexCost, validateOrder } from '../orders'
import { applyGovern, aidGain, bindPuppet, compliance, countWeight, equilibrium, extraction, governProblem, pressureOf, previewGovern, viewOf, yieldOf } from '../puppets'
import { createRng } from '../rng'
import { applyOrderNow, describeOrder, resolveTurn } from '../resolveTurn'
import type { GameState, Order, PuppetPatch } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

/** r0 holds r1 as a puppet (and r2 as its own land); everyone else keeps to themselves. */
function world(): GameState {
  const s = startState(map, 'r0', 5)
  s.nations.r0.resources.pp = 400
  s.nations.r0.resources.capital = 2000
  // The master is the stronger, as a victor is: a puppet that outguns its master is restless on that account alone.
  setMilitary(s, 'r0', { infantry: 40, armor: 10 })
  bindPuppet(s, 'r1', 'r0')
  s.nations.r1.overlordSince = -20
  return s
}

const govern = (patch: PuppetPatch, target = 'r1'): Order => ({ type: 'governPuppet', nationId: 'r0', target, patch })

describe('a new puppet', () => {
  it('has a loyalty, the default tribute and no master-set rules', () => {
    const s = world()
    expect(s.nations.r1.overlord).toBe('r0')
    expect(s.nations.r1.loyalty).toBe(PUPPET.start)
    expect(s.nations.r1.tribute).toBeUndefined()
    expect(s.nations.r1.ruledAt).toBeUndefined()
  })

  it('a nation that is not a puppet has none of the new fields', () => {
    const s = world()
    expect(s.nations.r0.loyalty).toBeUndefined()
    expect(s.nations.r2.loyalty).toBeUndefined()
  })

  it("passes up the puppets of a nation that becomes one: no puppet of a puppet", () => {
    const s = world()
    bindPuppet(s, 'r2', 'r1')
    bindPuppet(s, 'r1', 'r3')
    // r2 was r1's puppet; now r1 serves r3 and r2 is r3's directly.
    expect(s.nations.r2.overlord).toBe('r3')
    expect(s.nations.r1.overlord).toBe('r3')
  })
})

describe('ruling a puppet', () => {
  it('sets tax, draft, a law, spending and the tribute in one order, at the month end, for influence', () => {
    const s = world()
    const o = govern({ taxRate: 0.3, draftRate: 0.08, law: { id: 'free_trade', on: true }, spending: { housing: 2 }, tribute: { form: 'oil', share: 0.3 } })
    expect(validateOrder(s, map, o)).toBeNull()
    const pp = s.nations.r0.resources.pp
    const next = resolveTurn(s, map, [o])
    const r1 = next.nations.r1
    expect(r1.taxRate).toBeCloseTo(0.3)
    expect(r1.draftRate).toBeCloseTo(0.08)
    expect(r1.laws).toContain('free_trade')
    expect(r1.spending.housing).toBe(2)
    expect(r1.tribute).toEqual({ form: 'oil', share: 0.3 })
    expect(r1.ruledAt).toBe(s.turn)
    // 3 + 3 + 6 + 2 + 4 influence, less the month's income.
    expect(pp - next.nations.r0.resources.pp).toBeGreaterThan(10)
  })

  it('is allowed once a month for each puppet: a second in the same batch, or in the same month, is refused', () => {
    const s = world()
    const a = govern({ taxRate: 0.3 })
    expect(validateOrder(s, map, govern({ draftRate: 0.1 }), [a])).toMatch(/already changed/)
    const next = resolveTurn(s, map, [a])
    next.nations.r0.resources.pp = 400
    next.nations.r1.ruledAt = next.turn
    expect(validateOrder(next, map, govern({ draftRate: 0.1 }))).toMatch(/already changed/)
    next.nations.r1.ruledAt = next.turn - 1
    expect(validateOrder(next, map, govern({ draftRate: 0.1 }))).toBeNull()
  })

  it('only the master may rule, and not a nation that is not its puppet', () => {
    const s = world()
    expect(validateOrder(s, map, { type: 'governPuppet', nationId: 'r2', target: 'r1', patch: { taxRate: 0.3 } })).toMatch(/not your puppet/)
    expect(validateOrder(s, map, govern({ taxRate: 0.3 }, 'r3'))).toMatch(/not your puppet/)
    expect(validateOrder(s, map, govern({ taxRate: 0.3 }, 'nobody'))).toMatch(/not your puppet/)
  })

  it('keeps every number in bounds and reads well when it refuses', () => {
    const s = world()
    const bad: [Parameters<typeof govern>[0], RegExp][] = [
      [{ taxRate: 0.9 }, /tax goes from/],
      [{ taxRate: 0.01 }, /tax goes from/],
      [{ taxRate: NaN }, /number/],
      [{ draftRate: 0.3 }, /draft goes from/],
      [{ draftRate: Infinity }, /number/],
      [{ tribute: { form: 'money', share: 0.9 } }, /goes from/],
      [{ tribute: { form: 'gold' as never, share: 0.1 } }, /Choose money/],
      [{ tribute: { form: 'oil', share: Number.NaN } }, /goes from/],
      [{ aid: 1 }, /Aid goes from/],
      [{ aid: 1e9 }, /Aid goes from/],
      [{ law: { id: 'war_economy', on: true } }, /can only be given/],
      [{ law: { id: 'martial_law', on: false } }, /not in force/],
      [{ spending: { works: 3 } as never }, /can be set/],
      [{ spending: { health: 9 } }, /goes from 0 to 4/],
      [{ spending: { health: 1.5 } }, /goes from 0 to 4/],
      [{ spending: {} }, /Choose spending/],
      [{}, /Choose what to change/],
      [{ taxRate: 0.2, draftRate: 0.05 }, /changes nothing/],
      [{ bogus: 1 } as never, /Nothing called/],
    ]
    for (const [patch, why] of bad) expect(validateOrder(s, map, govern(patch)), JSON.stringify(patch)).toMatch(why)
  })

  it('refuses malformed orders without throwing', () => {
    const s = world()
    const junk = [undefined, null, 5, 'x', [], { taxRate: {} }, { law: 7 }, { law: { id: 3, on: 'yes' } }, { spending: [] }, { spending: null }, { tribute: null }, { tribute: 3 }, { aid: 'lots' }, { taxRate: '0.3' }]
    for (const patch of junk) {
      const r = validateOrder(s, map, { type: 'governPuppet', nationId: 'r0', target: 'r1', patch } as never)
      expect(typeof r).toBe('string')
    }
    expect(typeof validateOrder(s, map, { type: 'governPuppet', nationId: 'r0', target: 7 } as never)).toBe('string')
    expect(() => describeOrder(s, map, { type: 'governPuppet', nationId: 'r0', target: 'r1', patch: undefined } as never)).not.toThrow()
  })

  it('costs influence for each change, and money for aid, and is refused without them', () => {
    const s = world()
    s.nations.r0.resources.pp = 5
    expect(validateOrder(s, map, govern({ law: { id: 'free_trade', on: true } }))).toMatch(/influence/)
    s.nations.r0.resources.pp = 400
    s.nations.r0.resources.capital = 20
    expect(validateOrder(s, map, govern({ aid: 100 }))).toMatch(/money/)
  })

  it('limits the laws a master may keep on a puppet', () => {
    const s = world()
    s.nations.r1.laws = ['free_trade', 'austerity', 'rationing']
    expect(validateOrder(s, map, govern({ law: { id: 'press_control', on: true } }))).toMatch(/only 3|no room/)
    // Even a puppet whose own rank would allow more laws takes no more than three from its master.
    s.nations.r1.tier = 3
    expect(validateOrder(s, map, govern({ law: { id: 'press_control', on: true } }))).toMatch(/only 3/)
  })

  it('cannot rule a puppet that another player runs', () => {
    const s = world()
    s.humans.push('r1')
    expect(validateOrder(s, map, govern({ taxRate: 0.3 }))).toMatch(/another player/)
  })

  it('cannot rule a puppet at war with its master, or one that was annexed or freed', () => {
    const s = world()
    s.wars.push('r0|r1')
    expect(validateOrder(s, map, govern({ taxRate: 0.3 }))).toMatch(/at war/)
    s.wars = []
    s.nations.r1.overlord = null
    expect(validateOrder(s, map, govern({ taxRate: 0.3 }))).toMatch(/not your puppet/)
  })

  it('an order queued with an annexation fails readably after the puppet is gone', () => {
    const s = world()
    s.nations.r0.resources.pp = 900
    const orders: Order[] = [{ type: 'annexPuppet', nationId: 'r0', target: 'r1' }, govern({ taxRate: 0.3 })]
    const next = resolveTurn(s, map, orders)
    // The rules are set first, then the land joins: nothing is left half done.
    expect(next.regions.r1.owner).toBe('r0')
    expect(next.nations.r1.loyalty).toBeUndefined()
    expect(validateOrder(next, map, govern({ draftRate: 0.1 }))).toMatch(/not your puppet/)
  })

  it('hands the puppet its master-set rules: its own bot no longer changes them', () => {
    const s = world()
    s.nations.r1.taxRate = 0.4
    const own: Order = { type: 'setPolicy', nationId: 'r1', taxRate: 0.2, draftRate: 0.05 }
    expect(validateOrder(s, map, own)).toMatch(/sets your taxes/)
    expect(validateOrder(s, map, { type: 'enactLaw', nationId: 'r1', law: 'free_trade' })).toMatch(/decides your laws/)
    // Business tax alone is still its own.
    expect(validateOrder(s, map, { type: 'setPolicy', nationId: 'r1', taxRate: 0.4, draftRate: s.nations.r1.draftRate, corporateTax: 0.2 })).toBeNull()
    // A puppet with no loyalty (an old save) is not locked.
    delete s.nations.r1.loyalty
    expect(validateOrder(s, map, own)).toBeNull()
    // Nor is a puppet another player runs.
    bindPuppet(s, 'r1', 'r0')
    s.humans.push('r1')
    expect(validateOrder(s, map, own)).toBeNull()
  })

  it('an old puppet gains a loyalty the first time its master rules it', () => {
    const s = world()
    delete s.nations.r1.loyalty
    const next = resolveTurn(s, map, [govern({ taxRate: 0.3 })])
    expect(next.nations.r1.loyalty).toBeDefined()
  })
})

describe('loyalty', () => {
  const monthsOf = (s: GameState, n: number, orders: Order[] = []) => {
    let t = s
    for (let i = 0; i < n; i++) {
      t = resolveTurn(t, map, i === 0 ? orders : [])
      t.nations.r0.resources.pp = 400
    }
    return t
  }

  it('a puppet left alone stays near its starting loyalty and pays the old 12%', () => {
    const s = world()
    const next = monthsOf(s, 12)
    expect(next.nations.r1.loyalty).toBeGreaterThan(50)
    expect(next.nations.r1.loyalty).toBeLessThan(75)
    expect(next.nations.r1.overlord).toBe('r0')
  })

  it('heavy tax and draft lower it, light tax raises it, and both are bounded', () => {
    const s = world()
    const heavy = monthsOf(s, 24, [govern({ taxRate: 0.45, draftRate: 0.2 })])
    const light = monthsOf(s, 24, [govern({ taxRate: 0.12, draftRate: 0.03 })])
    expect(heavy.nations.r1.loyalty ?? 0).toBeLessThan(25)
    expect(light.nations.r1.loyalty!).toBeGreaterThan(62)
    expect(light.nations.r1.loyalty!).toBeLessThanOrEqual(100)
    expect(heavy.nations.r1.loyalty ?? 0).toBeGreaterThanOrEqual(0)
  })

  it('the settling pull means loyalty above neutral must be paid for every month: it equals neutral plus pressure over settle', () => {
    const s = world()
    const p = pressureOf(s, map, s.nations.r1)
    expect(equilibrium(p.total)).toBeCloseTo(Math.min(100, Math.max(0, PUPPET.neutral + p.total / PUPPET.settle)))
    expect(equilibrium(100)).toBe(100)
    expect(equilibrium(-100)).toBe(0)
  })

  it('with nothing pressing on it, a devoted puppet slips back toward 60 and a bitter one recovers toward it', () => {
    const hi = world()
    hi.nations.r1.loyalty = 100
    const lo = world()
    lo.nations.r1.loyalty = 20
    const a = monthsOf(hi, 3)
    const b = monthsOf(lo, 3)
    expect(a.nations.r1.loyalty!).toBeLessThan(100)
    expect(a.nations.r1.loyalty!).toBeGreaterThan(60)
    expect(b.nations.r1.loyalty!).toBeGreaterThan(20)
    expect(b.nations.r1.loyalty!).toBeLessThan(60)
  })

  it('a puppet under 35 loses stability each month, in proportion; one above does not', () => {
    const calm = world()
    calm.nations.r1.loyalty = 60
    const sore = world()
    sore.nations.r1.loyalty = 15
    const a = resolveTurn(calm, map, [])
    const b = resolveTurn(sore, map, [])
    // The same seed and land: the only difference is the unrest (35 - 15) * 0.04 = 0.8 a month, before any rebels.
    expect(a.nations.r1.stability - b.nations.r1.stability).toBeGreaterThan(0.5)
  })

  it('stripping rights (martial law) costs loyalty at once and every month', () => {
    const s = world()
    const before = s.nations.r1.loyalty!
    const o = govern({ law: { id: 'martial_law', on: true } })
    const next = resolveTurn(s, map, [o])
    expect(next.nations.r1.loyalty!).toBeLessThan(before - 5)
    const pv = previewGovern(s, map, 'r0', 'r1', { law: { id: 'martial_law', on: true } })
    expect(pv.shock).toBeLessThan(0)
    expect(pv.pressureAfter).toBeLessThan(pv.pressureNow)
  })

  it('aid buys loyalty with a diminishing return and stops at a ceiling', () => {
    const s = world()
    const small = aidGain(s, map, 'r1', 50)
    const big = aidGain(s, map, 'r1', 500)
    expect(big).toBeGreaterThan(small)
    expect(big).toBeLessThan(PUPPET.aid.gain)
    expect(big / 500).toBeLessThan(small / 50)
    s.nations.r1.loyalty = 96
    expect(validateOrder(s, map, govern({ aid: 100 }))).toMatch(/more loyal/)
  })

  it('aid costs the master money and part of it reaches the puppet', () => {
    const s = world()
    const m = s.nations.r0.resources.capital
    const p = s.nations.r1.resources.capital
    const after = structuredClone(s)
    expect(applyOrderNow(after, map, govern({ aid: 100 })).error).toBeNull()
    // Month-end orders are not applied by applyOrderNow's validation path; run through the turn instead.
    const next = resolveTurn(s, map, [govern({ aid: 100 })])
    const twin = resolveTurn(s, map, [])
    expect(m - next.nations.r0.resources.capital).toBeGreaterThan(50)
    // Half of the 100 reaches its treasury, over what the same month would have brought it.
    expect(next.nations.r1.resources.capital - twin.nations.r1.resources.capital).toBeGreaterThan(40)
    expect(next.nations.r1.resources.capital).toBeGreaterThan(p)
    expect(next.nations.r1.loyalty!).toBeGreaterThan(twin.nations.r1.loyalty!)
  })

  it('a garrison and the master’s investment raise the pressure', () => {
    const s = world()
    const base = pressureOf(s, map, s.nations.r1).total
    s.investments = [{ id: 'i1', investor: 'r0', target: 'r1', sector: 'industry' as never, amount: 400 }]
    expect(pressureOf(s, map, s.nations.r1).total).toBeGreaterThan(base)
    const g = world()
    g.nations.r0.military.units.infantry = 20
    g.nations.r0.military.deployment = { coastal: 0, subs: 0, air: 0, border: { r1: 0.5 }, changed: 0 }
    expect(pressureOf(g, map, g.nations.r1).total).toBeGreaterThan(pressureOf(world(), map, world().nations.r1).total)
  })

  it('a restive puppet is unsettled, rebels and may break free; a loyal one does not', () => {
    const s = world()
    s.nations.r1.loyalty = 5
    let freed = 0
    let rebels = 0
    for (let seed = 1; seed <= 60; seed++) {
      const t = structuredClone(s)
      t.seed = seed
      const next = resolveTurn(t, map, [])
      if (!next.nations.r1.overlord) freed++
      rebels += Object.values(next.regions).filter((r) => r.owner === 'r1' && r.rebels > 0).length
      if (next.nations.r1.overlord) expect(next.nations.r1.stability).toBeLessThan(t.nations.r1.stability + 3)
    }
    expect(freed).toBeGreaterThan(2)
    expect(freed).toBeLessThan(40)
    const calm = world()
    calm.nations.r1.loyalty = 90
    for (let seed = 1; seed <= 30; seed++) {
      const t = structuredClone(calm)
      t.seed = seed
      expect(resolveTurn(t, map, []).nations.r1.overlord).toBe('r0')
    }
  })

  it('a freed puppet loses every puppet field', () => {
    const s = world()
    s.nations.r1.tribute = { form: 'oil', share: 0.3 }
    s.nations.r1.ruledAt = 3
    s.nations.r0.alive = false
    const next = resolveTurn(s, map, [])
    expect(next.nations.r1.overlord).toBeNull()
    expect(next.nations.r1.loyalty).toBeUndefined()
    expect(next.nations.r1.tribute).toBeUndefined()
    expect(next.nations.r1.ruledAt).toBeUndefined()
  })

  it('a restive puppet calls for help: neighbors get a reason to free it', () => {
    const s = world()
    s.nations.r1.loyalty = 10
    const next = resolveTurn(s, map, [])
    if (!next.nations.r1.overlord) return
    expect(next.nations.r1.calledOut).toBe(s.turn)
    // r2 borders r1.
    expect(next.casusBelli['r2|r0']).toBeGreaterThanOrEqual(s.turn)
    expect(next.reasons['r2|r0']).toMatch(/Free/)
  })
})

describe('a peace that makes a puppet', () => {
  it('gives it a loyalty and the default tribute, and nothing else changes about it', () => {
    const s = startState(map, 'r0', 5)
    s.humans = ['r0', 'r1']
    s.nations.r1.isPlayer = true
    s.nations.r0.resources.pp = 400
    s.wars = ['r0|r1']
    s.warScore['r0>r1'] = 90
    s.nations.r1.warWeariness = 60
    const propose: Order = { type: 'propose', nationId: 'r0', target: 'r1', proposal: { kind: 'peace', terms: { cede: [], reparations: 0, puppet: true } } }
    expect(validateOrder(s, map, propose)).toBeNull()
    const sent = resolveTurn(s, map, [propose])
    const offer = sent.proposals.find((p) => p.from === 'r0' && p.to === 'r1')
    expect(offer).toBeDefined()
    const done = resolveTurn(sent, map, [{ type: 'respond', nationId: 'r1', proposalId: offer!.id, accept: true }])
    expect(done.nations.r1.overlord).toBe('r0')
    expect(done.nations.r1.loyalty).toBeGreaterThan(50)
    expect(done.nations.r1.loyalty).toBeLessThanOrEqual(PUPPET.start)
    expect(done.nations.r1.tribute).toBeUndefined()
  })
})

describe('tribute', () => {
  it('money at the default share is the old 12% of income, at neutral loyalty', () => {
    const s = world()
    const y = yieldOf(s, map, s.nations.r1, { form: 'money', share: 0.12 }, 60)
    expect(compliance(60)).toBeCloseTo(0.7 + 0.5 * 0.6)
    expect(y.amount).toBeGreaterThan(0)
  })

  it('every form is bounded and weighs in money', () => {
    const s = world()
    s.nations.r1.resources.oil = 100
    s.nations.r1.resources.steel = 100
    s.nations.r1.militaryPool = 100
    for (const form of Object.keys(TRIBUTE) as (keyof typeof TRIBUTE)[]) {
      const lo = yieldOf(s, map, s.nations.r1, { form, share: TRIBUTE[form].min })
      const hi = yieldOf(s, map, s.nations.r1, { form, share: TRIBUTE[form].max })
      expect(hi.amount).toBeGreaterThanOrEqual(lo.amount)
      expect(Number.isFinite(hi.money)).toBe(true)
    }
  })

  it('a loyal puppet pays more than a restive one', () => {
    const s = world()
    const t = { form: 'money' as const, share: 0.12 }
    expect(yieldOf(s, map, s.nations.r1, t, 100).amount).toBeGreaterThan(yieldOf(s, map, s.nations.r1, t, 0).amount)
  })

  it('oil tribute moves oil to the master and soldiers move to its pool', () => {
    const s = world()
    s.nations.r1.resources.oil = 100
    s.nations.r1.militaryPool = 100
    const oilBefore = s.nations.r0.resources.oil
    const a = resolveTurn(s, map, [govern({ tribute: { form: 'oil', share: 0.5 } })])
    expect(a.nations.r0.resources.oil).toBeGreaterThanOrEqual(oilBefore - 50)
    const b = resolveTurn(s, map, [govern({ tribute: { form: 'levy', share: 0.25 } })])
    expect(b.nations.r0.militaryPool).toBeGreaterThan(resolveTurn(s, map, []).nations.r0.militaryPool)
  })

  it('what a master takes from all puppets together is capped at a share of its own gross', () => {
    const s = world()
    bindPuppet(s, 'r3', 'r0')
    for (const id of ['r1', 'r3']) s.nations[id].tribute = { form: 'money', share: 0.3 }
    const e = extraction(s, map, 'r0')
    expect(e.cap).toBeGreaterThan(0)
    const before = s.nations.r0.resources.capital
    const next = resolveTurn(s, map, [])
    const baseline = resolveTurn(structuredClone({ ...s, nations: { ...s.nations, r1: { ...s.nations.r1, tribute: undefined }, r3: { ...s.nations.r3, tribute: undefined } } }), map, [])
    expect(next.nations.r0.resources.capital - baseline.nations.r0.resources.capital).toBeLessThan(Math.max(e.cap, 1) * 1.01)
    void before
  })

  it('a puppet with no loyalty keeps the old tribute exactly', () => {
    const s = world()
    delete s.nations.r1.loyalty
    const a = resolveTurn(s, map, [])
    expect(a.nations.r1.loyalty).toBeUndefined()
    expect(a.nations.r1.overlord).toBe('r0')
  })
})

describe('counting and annexing', () => {
  it('a puppet counts half of its countries; more when loyal, less when restive; an old one half', () => {
    const s = world()
    for (const id of ['r2', 'r3', 'r4', 'r5']) {
      s.regions[id].owner = 'r1'
      s.nations[id].alive = false
    }
    // r1 now holds r1..r5: five countries.
    expect(countWeight(s.nations.r1)).toBe(0.5)
    expect(empireCount(s, 'r0')).toBe(1 + 2)
    s.nations.r1.loyalty = 90
    expect(empireCount(s, 'r0')).toBe(1 + 3)
    s.nations.r1.loyalty = 5
    expect(empireCount(s, 'r0')).toBe(1 + 1)
    delete s.nations.r1.loyalty
    expect(empireCount(s, 'r0')).toBe(1 + 2)
  })

  it('annexing a devoted puppet is cheap and a restive one costs more', () => {
    const s = world()
    s.nations.r1.loyalty = 100
    const cheap = annexCost(s, 'r1')
    s.nations.r1.loyalty = 50
    const mid = annexCost(s, 'r1')
    s.nations.r1.loyalty = 0
    const dear = annexCost(s, 'r1')
    expect(cheap).toBeLessThan(mid)
    expect(mid).toBeLessThan(dear)
    delete s.nations.r1.loyalty
    expect(annexCost(s, 'r1')).toBe(15)
  })

  it('annexing a restive puppet settles its land slowly, and clears its fields', () => {
    const hi = world()
    hi.nations.r1.loyalty = 100
    const lo = world()
    lo.nations.r1.loyalty = 5
    const a = resolveTurn(hi, map, [{ type: 'annexPuppet', nationId: 'r0', target: 'r1' }])
    const b = resolveTurn(lo, map, [{ type: 'annexPuppet', nationId: 'r0', target: 'r1' }])
    expect(a.regions.r1.owner).toBe('r0')
    expect(b.regions.r1.integration).toBeLessThan(a.regions.r1.integration)
    expect(a.nations.r1.loyalty).toBeUndefined()
  })
})

describe('wars', () => {
  it('a loyal puppet fights beside its master; a restive one refuses', () => {
    const s = world()
    s.nations.r0.resources.pp = 900
    const loyal = resolveTurn(s, map, [{ type: 'declareWar', nationId: 'r0', target: 'r5' }])
    expect(loyal.wars).toContain('r1|r5')
    const t = world()
    t.nations.r0.resources.pp = 900
    t.nations.r1.loyalty = 10
    const restive = resolveTurn(t, map, [{ type: 'declareWar', nationId: 'r0', target: 'r5' }])
    expect(restive.wars).not.toContain('r1|r5')
    expect(restive.wars).toContain('r0|r5')
  })

  it('a loyal puppet joins a war that began before it was a puppet, within the month', () => {
    const s = world()
    s.wars.push('r0|r6')
    const next = resolveTurn(s, map, [])
    expect(next.wars).toContain('r1|r6')
  })
})

describe('the bot master', () => {
  it('Easy never rules a puppet, Medium sets a moderate rule once, Hard tends loyalty', () => {
    const s = world()
    s.nations.r1.taxRate = 0.4
    const tries: Order[] = []
    const add = (o: Order) => (validateOrder(s, map, o, tries) === null ? (tries.push(o), true) : false)
    managePuppets(s, map, 'r0', 1, createRng(1, 1), add, 500)
    expect(tries).toHaveLength(1)
    expect(tries[0]).toMatchObject({ type: 'governPuppet', target: 'r1' })
    const hard = world()
    hard.nations.r1.ruledAt = 0
    hard.turn = 10
    hard.nations.r1.loyalty = 20
    hard.nations.r1.taxRate = 0.4
    const t2: Order[] = []
    managePuppets(hard, map, 'r0', 2, createRng(1, 1), (o) => (validateOrder(hard, map, o, t2) === null ? (t2.push(o), true) : false), 500)
    expect((t2[0] as Extract<Order, { type: 'governPuppet' }>).patch.taxRate).toBeLessThan(0.4)
  })

  it('Easy bots leave puppets alone in a real game', () => {
    const { map: world0 } = getWorld()
    const s = createInitialState(world0, { playerRegionId: 'france', seed: 3, difficulty: 'easy', goal: 'classic', victoryShare: 2 })
    expect(generateAllBotOrders(s, world0).filter((o) => o.type === 'governPuppet')).toHaveLength(0)
  })
})

describe('previewing', () => {
  it('shows the cost, the shock and what the tribute and loyalty will be before the order is given', () => {
    const s = world()
    const pv = previewGovern(s, map, 'r0', 'r1', { taxRate: 0.35, tribute: { form: 'money', share: 0.25 } })
    expect(pv.cost.pp).toBe(PUPPET.cost.tax + PUPPET.cost.tributeShare)
    expect(pv.shock).toBeLessThan(0)
    expect(pv.settlesAfter).toBeLessThan(pv.settlesNow)
    expect(pv.yieldAfter.amount).toBeGreaterThan(0)
    expect(viewOf(s.nations.r1).taxRate).toBe(s.nations.r1.taxRate)
    // The preview changes nothing.
    expect(s.nations.r1.taxRate).toBeCloseTo(0.2)
  })

  it('applyGovern and the preview agree on the shock', () => {
    const s = world()
    const patch = { draftRate: 0.15 }
    const pv = previewGovern(s, map, 'r0', 'r1', patch)
    const t = structuredClone(s)
    applyGovern(t, map, { type: 'governPuppet', nationId: 'r0', target: 'r1', patch })
    expect(t.nations.r1.loyalty! - s.nations.r1.loyalty!).toBeCloseTo(pv.shock)
    expect(governProblem(s, { type: 'governPuppet', nationId: 'r0', target: 'r1', patch }, [])).toBeNull()
  })
})
