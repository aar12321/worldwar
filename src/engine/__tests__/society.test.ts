import { describe, expect, it } from 'vitest'
import { CAMPAIGNS, CAMPAIGN_IDS, LEVEL_POWER, SOCIAL, SOCIAL_GROUPS, SOCIAL_IDS, SOCIAL_RULES, campaignCost, describeEffect, powerOf } from '../../data/society'
import { computeEconomy } from '../economy'
import { recoveryRate, outbreakChance, startEpidemic } from '../epidemics'
import { adminReport } from '../empire'
import { populationGrowth, electionNeed, healthTarget, jobsTarget, schoolingTarget } from '../people'
import { validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { applyCampaign, campaignPrice, hasSociety, nationSize, societyBill, societyEffects, softCap } from '../society'
import type { CampaignId, GameState, Order, SocialId } from '../types'
import { giveRegions, lineMap, startState } from './fixtures'

const map = lineMap(12)
const P = 'r0'

function base(): GameState {
  const s = startState(map)
  s.nations[P].resources.capital = 3000
  s.nations[P].resources.pp = 300
  return s
}

/** Puts a program straight into a nation, fully phased in, to test what it does. */
function setIn(s: GameState, id: SocialId, level: number, strength = level) {
  ;(s.nations[P].social ??= {})[id] = { level, strength, changed: -1 }
}

const raise = (policy: SocialId, level: number): Order => ({ type: 'setSocial', nationId: P, policy, level })
const targets = (s: GameState) => {
  const e = computeEconomy(s, map, P)
  const n = s.nations[P]
  return {
    e,
    health: healthTarget(n, e.basis, e.coverage.doctors),
    schooling: schoolingTarget(n, e.basis.development),
    jobs: jobsTarget(n, e.basis),
    growth: populationGrowth(n),
    election: electionNeed(n, 45),
  }
}

describe('what is on offer', () => {
  it('22 programs in five groups and 7 campaigns, each with a price and a point', () => {
    expect(SOCIAL_IDS).toHaveLength(22)
    expect(CAMPAIGN_IDS).toHaveLength(7)
    for (const g of Object.keys(SOCIAL_GROUPS)) expect(SOCIAL_IDS.filter((id) => SOCIAL[id].group === g).length).toBeGreaterThanOrEqual(4)
    for (const id of SOCIAL_IDS) {
      const spec = SOCIAL[id]
      expect(spec.cost).toBeGreaterThan(0)
      expect(spec.enact[0]).toBeLessThan(spec.enact[1])
      expect(spec.enact[1]).toBeLessThan(spec.enact[2])
      expect(Object.keys(spec.effects).length).toBeGreaterThan(0)
      expect(spec.blurb.length).toBeGreaterThan(20)
    }
    for (const id of CAMPAIGN_IDS) {
      expect(CAMPAIGNS[id].cooldown).toBeGreaterThanOrEqual(CAMPAIGNS[id].months)
      expect(describeEffect(CAMPAIGNS[id].effects).length).toBeGreaterThan(0)
    }
  })

  it('a bigger level helps more, but less than in proportion to what it costs', () => {
    expect(powerOf(0)).toBe(0)
    expect(powerOf(1)).toBe(1)
    expect(powerOf(2)).toBe(LEVEL_POWER[2])
    expect(powerOf(3)).toBe(LEVEL_POWER[3])
    expect(powerOf(1.5)).toBeCloseTo(1.4)
    expect(powerOf(9)).toBe(LEVEL_POWER[3])
    for (let l = 2; l <= 3; l++) expect(LEVEL_POWER[l] / l).toBeLessThan(LEVEL_POWER[l - 1] / (l - 1))
  })

  it('describes what a program does in plain words, good news first', () => {
    const lines = describeEffect(SOCIAL.surveillance.effects)
    expect(lines.map((l) => l.text)).toContain('Stability +1.8')
    const firstBad = lines.findIndex((l) => !l.good)
    expect(firstBad).toBeGreaterThan(0)
    expect(lines.slice(firstBad).every((l) => !l.good)).toBe(true)
  })
})

describe('setting a program', () => {
  it('costs influence for each step up, and nothing to go down', () => {
    const s = base()
    const before = s.nations[P].resources.pp
    expect(validateOrder(s, map, raise('clinics', 1))).toBeNull()
    const one = applyOrderNow(s, map, raise('clinics', 1))
    expect(one.error).toBeNull()
    expect(before - s.nations[P].resources.pp).toBe(SOCIAL.clinics.enact[0])
    // Next month, from Pilot to National costs the second step only.
    s.turn++
    const mid = s.nations[P].resources.pp
    expect(applyOrderNow(s, map, raise('clinics', 2)).error).toBeNull()
    expect(mid - s.nations[P].resources.pp).toBe(SOCIAL.clinics.enact[1])
    s.turn++
    const top = s.nations[P].resources.pp
    expect(applyOrderNow(s, map, raise('clinics', 0)).error).toBeNull()
    expect(s.nations[P].resources.pp).toBe(top)
    expect(s.nations[P].social!.clinics!.level).toBe(0)
  })

  it('skipping a level pays for each step', () => {
    const s = base()
    const before = s.nations[P].resources.pp
    applyOrderNow(s, map, raise('festivals', 2))
    expect(before - s.nations[P].resources.pp).toBe(SOCIAL.festivals.enact[0] + SOCIAL.festivals.enact[1])
  })

  it('Universal needs a Regional power', () => {
    const s = base()
    expect(validateOrder(s, map, raise('clinics', 3))).toMatch(/Regional power/)
    giveRegions(s, P, ['r1', 'r2', 'r3'])
    s.nations[P].tier = 2
    expect(validateOrder(s, map, raise('clinics', 3))).toBeNull()
  })

  it('can be changed once a month, and refuses a level it is already at, or nonsense', () => {
    const s = base()
    applyOrderNow(s, map, raise('policing', 1))
    expect(validateOrder(s, map, raise('policing', 2))).toMatch(/this month/)
    s.turn++
    expect(validateOrder(s, map, raise('policing', 2))).toBeNull()
    expect(validateOrder(s, map, raise('policing', 1))).toMatch(/Already pilot/)
    expect(validateOrder(s, map, raise('policing', 7))).not.toBeNull()
    expect(validateOrder(s, map, raise('policing', 1.5))).not.toBeNull()
    // Two orders for one program in one batch: the second is refused.
    expect(validateOrder(s, map, raise('courts', 1), [raise('courts', 2)])).toMatch(/this month/)
  })

  it('needs the influence', () => {
    const s = base()
    s.nations[P].resources.pp = 1
    expect(validateOrder(s, map, raise('clinics', 1))).toMatch(/influence/)
  })

  it('cutting a program costs stability at once, for each level', () => {
    const s = base()
    setIn(s, 'clinics', 3)
    const before = s.nations[P].stability
    s.turn++
    applyOrderNow(s, map, raise('clinics', 1))
    expect(before - s.nations[P].stability).toBeCloseTo(2 * SOCIAL_RULES.cutStability)
  })
})

describe('what a program costs and does', () => {
  it('costs money every month, in proportion to its level and the size of the workforce', () => {
    const s = base()
    // Programs with no income of their own, so the treasury shows exactly what they cost. (Courts and transit earn some back.)
    setIn(s, 'clinics', 1)
    setIn(s, 'policing', 2)
    const e = computeEconomy(s, map, P)
    const expected = SOCIAL.clinics.cost * 1 * e.workforce + SOCIAL.policing.cost * 2 * e.workforce
    expect(societyBill(s.nations[P], e.workforce).total).toBeCloseTo(expected)
    expect(e.society.bill).toBeCloseTo(expected)
    expect(e.lines.find((l) => l.label === 'Programs for the people')!.amount).toBeCloseTo(-expected)
    // The treasury pays it: a month later money is lower by that much more than without.
    const without = base()
    const a = resolveTurn(s, map, [])
    const b = resolveTurn(without, map, [])
    const paid = b.nations[P].resources.capital - a.nations[P].resources.capital
    expect(paid).toBeGreaterThan(expected * 0.9)
    expect(paid).toBeLessThan(expected * 1.1)
  })

  it('programs meant to grow the economy earn a real share of their cost back, and those meant for calm do not', () => {
    const earned = (id: SocialId) => {
      const s = base()
      const before = computeEconomy(s, map, P)
      setIn(s, id, 2)
      const e = computeEconomy(s, map, P)
      const gross = (r: typeof e) => r.taxIncome + r.factoryIncome + r.tradeIncome + r.corporateIncome
      return (gross(e) - gross(before)) / e.society.bill
    }
    for (const id of ['courts', 'transit', 'smallLoans', 'apprenticeships'] as SocialId[]) expect(earned(id), id).toBeGreaterThan(0.2)
    for (const id of ['policing', 'clinics', 'elderCare', 'foodAid'] as SocialId[]) expect(earned(id), id).toBeLessThan(0.1)
  })

  it('costs money even while its effect is still phasing in', () => {
    const s = base()
    setIn(s, 'clinics', 2, 0)
    const e = computeEconomy(s, map, P)
    expect(e.society.bill).toBeGreaterThan(0)
    expect(e.society.stability).toBe(0)
  })

  it('phases in over months and fades out the same way', () => {
    let s = base()
    applyOrderNow(s, map, raise('policing', 2))
    const seen: number[] = []
    for (let i = 0; i < 9; i++) {
      s = resolveTurn(s, map, [])
      seen.push(s.nations[P].social!.policing!.strength)
    }
    expect(seen[0]).toBeCloseTo(SOCIAL_RULES.phaseIn)
    expect(seen[3]).toBeCloseTo(1)
    expect(seen[8]).toBe(2)
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true)
    // Cut it to Off: the effect drains, and the entry is forgotten when it is gone.
    s.turn += 2
    s = structuredClone(s)
    applyOrderNow(s, map, raise('policing', 0))
    for (let i = 0; i < 12; i++) s = resolveTurn(s, map, [])
    expect(s.nations[P].social?.policing).toBeUndefined()
  })

  it('stability from programs is capped: it climbs, but never reaches the ceiling', () => {
    expect(softCap(0)).toBe(0)
    expect(softCap(-3)).toBe(-3)
    expect(softCap(1)).toBeCloseTo(1, 0)
    expect(softCap(1)).toBeLessThan(1)
    let last = 0
    for (const raw of [1, 5, 10, 20, 50, 200]) {
      const v = softCap(raw)
      expect(v).toBeGreaterThan(last)
      expect(v).toBeLessThan(SOCIAL_RULES.stabilityCap)
      last = v
    }
    // Every program at the top still stays under the ceiling.
    const s = base()
    for (const id of SOCIAL_IDS) setIn(s, id, 3)
    const r = societyEffects(s.nations[P])
    expect(r.rawStability).toBeGreaterThan(SOCIAL_RULES.stabilityCap)
    expect(r.stability).toBeLessThan(SOCIAL_RULES.stabilityCap)
  })

  it('adds exactly its (capped) stability to where stability is heading, and says so in the breakdown', () => {
    const s = base()
    const before = computeEconomy(s, map, P)
    setIn(s, 'policing', 2)
    setIn(s, 'festivals', 2)
    const after = computeEconomy(s, map, P)
    const soc = societyEffects(s.nations[P])
    expect(soc.stability).toBeGreaterThan(2)
    expect(after.stabilityTarget - before.stabilityTarget).toBeCloseTo(soc.stability, 6)
    const part = after.stabilityParts.find((p) => p.label === 'Programs for the people')!
    expect(part.value).toBeCloseTo(soc.stability, 6)
    expect(soc.sources.map((x) => x.id).sort()).toEqual(['policy:festivals', 'policy:policing'])
  })

  it('the breakdown adds up to the target', () => {
    const s = base()
    const e = computeEconomy(s, map, P)
    const sum = e.stabilityParts.reduce((a, p) => a + p.value, 0)
    expect(sum).toBeCloseTo(e.stabilityTarget, 6)
    expect(e.stabilityParts[0].label).toBe('A settled country')
    // And with trouble: high taxes and hunger show up as their own lines.
    s.nations[P].taxRate = 0.35
    s.nations[P].foodShortage = true
    const bad = computeEconomy(s, map, P)
    expect(bad.stabilityParts.find((p) => p.label === 'High taxes')!.value).toBeLessThan(0)
    expect(bad.stabilityParts.find((p) => p.label === 'Hunger')!.value).toBe(-25)
  })

  it('every program has an effect on the number it names', () => {
    const s = base()
    const t0 = targets(s)
    const e0 = computeEconomy(s, map, P)
    const checks: [SocialId, () => number, number][] = [
      ['clinics', () => targets(s).health - t0.health, 1],
      ['cleanWater', () => targets(s).health - t0.health, 1],
      ['scholarships', () => targets(s).schooling - t0.schooling, 1],
      ['schoolMeals', () => targets(s).schooling - t0.schooling, 1],
      ['jobsGuarantee', () => t0.jobs - targets(s).jobs, 1],
      ['minimumWage', () => targets(s).jobs - t0.jobs, 1],
      ['childBenefit', () => targets(s).growth - t0.growth, 1],
      ['elderCare', () => t0.election - targets(s).election, 1],
      ['surveillance', () => targets(s).election - t0.election, 1],
      ['transit', () => computeEconomy(s, map, P).taxIncome - e0.taxIncome, 1],
      ['smallLoans', () => societyEffects(s.nations[P]).policy.growth, 1],
    ]
    for (const [id, delta, dir] of checks) {
      s.nations[P].social = {}
      setIn(s, id, 2)
      expect(delta() * dir, id).toBeGreaterThan(0)
    }
  })

  it('policing, integration, courts, clean water and food aid reach the systems they name', () => {
    const s = base()
    setIn(s, 'policing', 3)
    setIn(s, 'integration', 3)
    setIn(s, 'courts', 3)
    setIn(s, 'cleanWater', 3)
    setIn(s, 'foodAid', 3)
    const soc = societyEffects(s.nations[P]).social
    expect(soc.order).toBeGreaterThan(0.2)
    expect(soc.settle).toBeGreaterThan(0.3)
    expect(soc.admin).toBeGreaterThan(1)
    expect(soc.epidemic).toBeGreaterThan(0.2)
    expect(soc.famine).toBeGreaterThan(0.5)
    // Administration capacity, epidemic odds and recovery, and the sting of hunger all move.
    const plain = base()
    expect(adminReport(s, map, P).capacity).toBeGreaterThan(adminReport(plain, map, P).capacity)
    expect(outbreakChance(s, P)).toBeLessThan(outbreakChance(plain, P))
    startEpidemic(s, P, 0.5)
    startEpidemic(plain, P, 0.5)
    expect(recoveryRate(s, P, 1)).toBeGreaterThan(recoveryRate(plain, P, 1))
    s.nations[P].foodShortage = true
    plain.nations[P].foodShortage = true
    const hungry = computeEconomy(s, map, P).stabilityParts.find((p) => p.label === 'Hunger')!.value
    const hungryPlain = computeEconomy(plain, map, P).stabilityParts.find((p) => p.label === 'Hunger')!.value
    expect(hungry).toBeGreaterThan(hungryPlain)
  })

  it('conquered land settles faster with integration programs', () => {
    const run = (withProgram: boolean) => {
      const s = base()
      giveRegions(s, P, ['r1'])
      s.regions.r1.integration = 0.1
      s.regions.r1.owner = P
      if (withProgram) setIn(s, 'integration', 3)
      return resolveTurn(s, map, []).regions.r1.integration
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })

  it('policing and surveillance make rebels rarer, both in unsettled land and in a country near collapse', () => {
    // The rolls are seeded, so counting what happens over many fixed seeds is exactly repeatable.
    const outcomes = (withPrograms: boolean) => {
      let unsettled = 0
      let boilOver = 0
      for (let seed = 1; seed <= 300; seed++) {
        const a = base()
        a.seed = seed
        giveRegions(a, P, ['r1'])
        a.regions.r1.integration = 0
        if (withPrograms) {
          setIn(a, 'policing', 3)
          setIn(a, 'surveillance', 3)
        }
        if (resolveTurn(a, map, []).regions.r1.rebels > 0) unsettled++
        const b = base()
        b.seed = seed
        b.nations[P].stability = 0
        if (withPrograms) {
          setIn(b, 'policing', 3)
          setIn(b, 'surveillance', 3)
        }
        if (resolveTurn(b, map, []).log.some((l) => l.text.startsWith('Unrest boils over'))) boilOver++
      }
      return { unsettled, boilOver }
    }
    const plain = outcomes(false)
    const kept = outcomes(true)
    expect(plain.unsettled).toBeGreaterThan(8)
    expect(plain.boilOver).toBeGreaterThan(8)
    expect(kept.unsettled).toBeLessThan(plain.unsettled * 0.6)
    expect(kept.boilOver).toBeLessThan(plain.boilOver * 0.6)
  })

  it('a trade-off is a real one: minimum wage and surveillance and workers rights cost something', () => {
    const s = base()
    setIn(s, 'surveillance', 2)
    expect(societyEffects(s.nations[P]).policy.research).toBeLessThan(0)
    setIn(s, 'workerRights', 2)
    expect(societyEffects(s.nations[P]).policy.factory).toBeLessThan(0)
    setIn(s, 'minimumWage', 2)
    expect(societyEffects(s.nations[P]).policy.growth).toBeLessThan(0)
    setIn(s, 'parentalLeave', 2)
    expect(societyEffects(s.nations[P]).policy.output).toBeLessThan(0)
  })
})

describe('campaigns', () => {
  const run = (id: CampaignId): Order => ({ type: 'campaign', nationId: P, campaign: id })

  it('cost money by the size of the country, and run for their months', () => {
    const s = base()
    expect(nationSize(s, P)).toBeGreaterThan(0)
    const price = campaignPrice(s, s.nations[P], 'celebration')
    expect(price).toBe(campaignCost('celebration', nationSize(s, P)))
    // A bigger nation pays more.
    const big = base()
    giveRegions(big, P, ['r1', 'r2', 'r3'])
    expect(campaignPrice(big, big.nations[P], 'celebration')).toBeGreaterThan(price)
    const money = s.nations[P].resources.capital
    expect(applyOrderNow(s, map, run('celebration')).error).toBeNull()
    expect(money - s.nations[P].resources.capital).toBe(price)
    expect(s.nations[P].campaigns!.celebration!.left).toBe(CAMPAIGNS.celebration.months)
  })

  it('do something at once, then add their effect while they last', () => {
    const s = base()
    const before = s.nations[P].stability
    const target = computeEconomy(s, map, P).stabilityTarget
    applyOrderNow(s, map, run('celebration'))
    expect(s.nations[P].stability - before).toBeCloseTo(CAMPAIGNS.celebration.instant!.stability!)
    expect(computeEconomy(s, map, P).stabilityTarget).toBeGreaterThan(target)
    expect(societyEffects(s.nations[P]).sources.map((x) => x.id)).toContain('campaign:celebration')
  })

  it('end after their months, wait out the cooldown, and can then run again', () => {
    let s = base()
    s.nations[P].resources.capital = 9000
    applyOrderNow(s, map, run('foodBank'))
    expect(validateOrder(s, map, run('foodBank'))).toMatch(/Already running/)
    for (let i = 0; i < CAMPAIGNS.foodBank.months; i++) s = resolveTurn(s, map, [])
    expect(s.nations[P].campaigns!.foodBank!.left).toBe(0)
    expect(societyEffects(s.nations[P]).sources).toEqual([])
    expect(validateOrder(s, map, run('foodBank'))).toMatch(/Ready again in/)
    for (let i = 0; i < CAMPAIGNS.foodBank.cooldown - CAMPAIGNS.foodBank.months; i++) s = resolveTurn(s, map, [])
    expect(validateOrder(s, map, run('foodBank'))).toBeNull()
    expect(s.nations[P].campaigns?.foodBank).toBeUndefined()
  })

  it('a vaccination drive eases a running epidemic at once', () => {
    const s = base()
    startEpidemic(s, P, 0.5)
    const before = s.nations[P].people.epidemic
    applyCampaign(s, s.nations[P], 'vaccination')
    expect(s.nations[P].people.epidemic).toBeLessThan(before)
  })

  it('need the money', () => {
    const s = base()
    s.nations[P].resources.capital = 1
    expect(validateOrder(s, map, run('babyBonus'))).toMatch(/money/)
  })
})

describe('old saves and untouched nations', () => {
  it('a nation that never uses programs has none, and gets the same zeros every time', () => {
    const s = base()
    expect(s.nations[P].social).toBeUndefined()
    expect(s.nations[P].campaigns).toBeUndefined()
    expect(hasSociety(s.nations[P])).toBe(false)
    const a = societyEffects(s.nations[P])
    expect(a.stability).toBe(0)
    expect(a.sources).toEqual([])
    expect(societyEffects(s.nations[P])).toBe(a)
    const after = resolveTurn(s, map, [])
    expect(after.nations[P].social).toBeUndefined()
    expect(JSON.stringify(after.nations[P])).not.toContain('"social"')
  })

  it('a program that is switched off and gone leaves nothing behind', () => {
    let s = base()
    setIn(s, 'clinics', 0, 0.05)
    s = resolveTurn(s, map, [])
    expect(s.nations[P].social?.clinics).toBeUndefined()
    expect(hasSociety(s.nations[P])).toBe(false)
  })
})
