import { describe, expect, it } from 'vitest'
import { BANKING } from '../../data/banking'
import { EVENTS } from '../../data/events'
import { PEOPLE } from '../../data/people'
import { PROJECTS, programCost } from '../../data/projects'
import { taylorRate } from '../../ai/management'
import { dividendRate, issueBond, realIncomeFactor, repayBonds, runBank } from '../bank'
import { projectedVote } from '../council'
import { computeEconomy } from '../economy'
import { adminReport, combineTraits, diminish, empireCount, tierFor, tierGate, updateTiers } from '../empire'
import { runEpidemics, startEpidemic } from '../epidemics'
import { applyEventChoice } from '../events'
import { nationNeighborMap } from '../helpers'
import { industryCapMult } from '../industry'
import { normalizeGame } from '../migrate'
import { coverageMult, populationGrowth, startingPeople } from '../people'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { peopleBasis } from '../statecraft'
import { addUnitToMilitary } from '../training'
import type { GameState, Order } from '../types'
import { SKILL_KEYS } from '../types'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(12)
const P = 'r0'

function base(): GameState {
  const s = startState(map)
  s.nations[P].resources.capital = 3000
  s.nations[P].resources.pp = 200
  s.nations[P].resources.tp = 2000
  return s
}

/** Gives the player countries until it reaches a tier. */
function grow(s: GameState, countries: number) {
  giveRegions(
    s,
    P,
    Array.from({ length: countries - 1 }, (_, i) => `r${i + 1}`),
  )
  updateTiers(s)
  return s
}

const ok = (s: GameState, o: Order) => {
  const r = applyOrderNow(s, map, o)
  expect(r.error).toBeNull()
}

describe('empire tiers', () => {
  it('rise with countries held, and fall only once well below the line', () => {
    expect(tierFor(1)).toBe(1)
    expect(tierFor(4)).toBe(2)
    expect(tierFor(10)).toBe(3)
    expect(tierFor(25)).toBe(4)
    expect(tierFor(60)).toBe(5)
    // A Great power that loses one country keeps its tier; one that falls further loses it.
    expect(tierFor(9, 3)).toBe(3)
    expect(tierFor(8, 3)).toBe(2)
  })

  it('count half of each puppet', () => {
    const s = base()
    giveRegions(s, 'r1', ['r2', 'r3', 'r4', 'r5'])
    s.nations.r1.alive = true
    s.nations.r1.overlord = P
    expect(empireCount(s, P)).toBe(1 + 2)
  })

  it('name the tier and the gap when something is out of reach', () => {
    const s = base()
    expect(tierGate(s, P, 3)).toMatch(/Great power \(10 countries\)\. You hold 1/)
    grow(s, 10)
    expect(s.nations[P].tier).toBe(3)
    expect(tierGate(s, P, 3)).toBeNull()
  })
})

describe('diminishing returns', () => {
  it('leave one country exactly as it was and flatten many', () => {
    expect(diminish(0.1, 0.1, 0.15)).toBeCloseTo(0.1)
    expect(diminish(1, 0.1, 0.15)).toBeLessThan(0.1 + 0.15 + 1e-9)
    const one = combineTraits([{ factory: 0.1 }], 1)
    const many = combineTraits(Array.from({ length: 20 }, () => ({ factory: 0.1 })), 1)
    expect(one.factory).toBeCloseTo(0.1)
    expect(many.factory!).toBeLessThan(0.4)
    expect(combineTraits(Array.from({ length: 20 }, () => ({ factory: 0.1 })), 5).factory!).toBeGreaterThan(many.factory!)
  })
})

describe('administration', () => {
  it('a sprawling empire is over capacity, and regional capitals and civic halls ease it', () => {
    const s = base()
    grow(s, 12)
    for (let i = 1; i < 12; i++) s.regions[`r${i}`].integration = 0
    const before = adminReport(s, map, P)
    expect(before.load).toBeGreaterThan(0)
    for (let i = 0; i < 12; i++) s.regions[`r${i}`].buildings.civic = 3
    expect(adminReport(s, map, P).capacity).toBeGreaterThan(before.capacity)
  })
})

describe('people', () => {
  it('start exactly staffed, so a new game produces what it always did', () => {
    const s = base()
    const e = computeEconomy(s, map, P)
    expect(e.factoryStaff).toBe(1)
    expect(e.researchStaff).toBe(1)
    const sum = SKILL_KEYS.reduce((a, k) => a + s.nations[P].people.skills[k], 0)
    expect(sum).toBeCloseTo(1)
  })

  it('a staff shortfall bites, a generous staff helps a little', () => {
    expect(coverageMult(1, { min: 0.75, max: 1.1 })).toBe(1)
    expect(coverageMult(0.5, { min: 0.75, max: 1.1 })).toBeLessThan(0.9)
    expect(coverageMult(2, { min: 0.75, max: 1.1 })).toBeGreaterThan(1)
  })

  it('schools raise schooling over time, and stopping them lets it slide', () => {
    let s = base()
    s.nations[P].spending.schools = 4
    s.nations[P].programs.stage = 'secondary'
    const start = s.nations[P].people.schooling
    for (let i = 0; i < 12; i++) s = resolveTurn(s, map, [])
    expect(s.nations[P].people.schooling).toBeGreaterThan(start)
  })

  it('a school focus specializes, and changing it starts again', () => {
    let s = base()
    s = resolveTurn(s, map, [{ type: 'setPrograms', nationId: P, programs: { focus: 'engineering' } }])
    for (let i = 0; i < 6; i++) s = resolveTurn(s, map, [])
    expect(s.nations[P].people.specialization).toBeGreaterThan(0)
    // A nation's tier caps specialization.
    expect(s.nations[P].people.specialization).toBeLessThanOrEqual(0.5 + 1e-9)
    s = resolveTurn(s, map, [{ type: 'setPrograms', nationId: P, programs: { focus: 'medicine' } }])
    expect(s.nations[P].people.specialization).toBeLessThan(0.1)
  })

  it('only the employed pay tax', () => {
    const s = base()
    const t = structuredClone(s)
    t.nations[P].people.unemployment = 0.3
    expect(computeEconomy(t, map, P).taxIncome).toBeLessThan(computeEconomy(s, map, P).taxIncome * 0.8)
  })

  it('welfare costs money and buys calm', () => {
    const s = base()
    const t = structuredClone(s)
    t.nations[P].spending.pensions = 2
    t.nations[P].spending.housing = 2
    const a = computeEconomy(s, map, P)
    const b = computeEconomy(t, map, P)
    expect(b.netCapital).toBeLessThan(a.netCapital)
    expect(b.stabilityTarget).toBeGreaterThan(a.stabilityTarget)
  })

  it('health and homes grow the population, and hunger shrinks it', () => {
    const s = base()
    const n = s.nations[P]
    const g = populationGrowth(n)
    expect(g).toBeGreaterThan(0)
    expect(populationGrowth({ ...n, foodShortage: true })).toBeLessThan(0)
    expect(PEOPLE.growthHealth).toBeGreaterThan(0)
  })

  it('a starting nation is staffed for what it has built', () => {
    const s = base()
    const p = startingPeople(s.nations[P], peopleBasis(s, map, P))
    expect(p.unemployment).toBeGreaterThan(0)
    expect(p.health).toBeGreaterThan(0.3)
  })
})

describe('epidemics', () => {
  it('break out, cost people and output, and end', () => {
    let s = base()
    startEpidemic(s, P, 0.5)
    const pop = s.regions[P].population
    const output = computeEconomy(s, map, P).gross
    const clean = structuredClone(s)
    clean.nations[P].people.epidemic = 0
    expect(output).toBeLessThan(computeEconomy(clean, map, P).gross)
    for (let i = 0; i < 30 && s.nations[P].people.epidemic > 0; i++) s = resolveTurn(s, map, [])
    expect(s.nations[P].people.epidemic).toBe(0)
    expect(s.regions[P].population).toBeLessThan(pop * 1.05)
  })

  it('spread to neighbors, less behind a quarantine', () => {
    let spread = 0
    let guarded = 0
    for (let seed = 1; seed <= 40; seed++) {
      for (const q of [false, true]) {
        const s = base()
        s.seed = seed
        startEpidemic(s, 'r1', 0.8)
        s.nations[P].programs.quarantine = q
        runEpidemics(s, map, nationNeighborMap(s, map), new Map())
        if (s.nations[P].people.epidemic > 0) q ? guarded++ : spread++
      }
    }
    expect(spread).toBeGreaterThan(guarded)
  })
})

describe('the central bank and money', () => {
  it('printing gives money now and inflation after', () => {
    let s = base()
    const cash = s.nations[P].resources.capital
    ok(s, { type: 'printMoney', nationId: P, share: 0.05 })
    expect(s.nations[P].resources.capital).toBeGreaterThan(cash)
    const infl = s.nations[P].bank.inflation
    s = resolveTurn(s, map, [])
    expect(s.nations[P].bank.inflation).toBeGreaterThan(infl)
    expect(realIncomeFactor({ bank: { ...s.nations[P].bank, inflation: 13 } })).toBeLessThan(1)
  })

  it('a small nation can print only a little, and must take the world rate', () => {
    const s = base()
    expect(applyOrderNow(s, map, { type: 'printMoney', nationId: P, share: 0.1 }).error).toMatch(/at most 5%/)
    expect(applyOrderNow(s, map, { type: 'setPrograms', nationId: P, programs: {}, rate: 6 }).error).toMatch(/world's interest rate/)
    grow(s, 4)
    expect(applyOrderNow(s, map, { type: 'setPrograms', nationId: P, programs: {}, rate: 6 }).error).toBeNull()
  })

  it('a burst of printing nets a little; printing every month roughly breaks even', () => {
    // A month's gross of 100, starting at target inflation.
    const lossOver = (months: number, share: number) => {
      let infl = BANKING.targetInflation
      let gained = 0
      for (let m = 0; m < 24; m++) {
        const printed = m < months ? share : 0
        gained += printed * 100
        const target = BANKING.targetInflation + BANKING.printInflation * printed
        infl += (target - infl) * BANKING.inflationRate
        gained -= 100 * BANKING.realIncomeLoss * Math.max(0, infl - BANKING.inflationFree)
      }
      return gained
    }
    expect(lossOver(1, 0.1)).toBeGreaterThan(0)
    expect(lossOver(1, 0.1)).toBeLessThan(10)
    expect(Math.abs(lossOver(24, 0.1)) / (24 * 10)).toBeLessThan(0.35)
  })

  it('bonds carry their own rate, come due, and are repaid the dearest first', () => {
    const s = base()
    const n = s.nations[P]
    issueBond(s, n, 100, 12, 0.004)
    issueBond(s, n, 50, 36, 0.009)
    expect(n.debt).toBeCloseTo(150)
    repayBonds(n, 60)
    expect(n.bonds.find((b) => b.rate === 0.009)).toBeUndefined()
    expect(n.debt).toBeCloseTo(90)
    // When it comes due and lenders still lend, it rolls over.
    n.bonds[0].due = s.turn
    runBank(s, n, 100, 80, 1000, 0.003, false)
    expect(n.bonds[0].due).toBeGreaterThan(s.turn)
  })

  it('a small nation sells bonds for 12 or 36 months, a great power also for 60', () => {
    const s = base()
    expect(applyOrderNow(s, map, { type: 'issueBonds', nationId: P, amount: 40, term: 60 }).error).toMatch(/12 or 36/)
    expect(applyOrderNow(s, map, { type: 'issueBonds', nationId: P, amount: 40, term: 36 }).error).toBeNull()
  })

  it('war bonds are for wartime, and buy a little patriotic calm', () => {
    const s = base()
    expect(applyOrderNow(s, map, { type: 'issueBonds', nationId: P, amount: 40, war: true }).error).toMatch(/wartime/)
    s.wars.push('r0|r1')
    const calm = s.nations[P].stability
    ok(s, { type: 'issueBonds', nationId: P, amount: 20, war: true })
    expect(s.nations[P].stability).toBeGreaterThan(calm)
    expect(s.nations[P].bonds.some((b) => b.war && b.rate === BANKING.warBondRate)).toBe(true)
  })

  it('the wealth fund opens to a great power, and taking money out costs a fee', () => {
    const s = base()
    expect(applyOrderNow(s, map, { type: 'wealthFund', nationId: P, amount: 100 }).error).toMatch(/Great power/)
    grow(s, 10)
    ok(s, { type: 'wealthFund', nationId: P, amount: 400 })
    expect(s.nations[P].bank.fund).toBe(400)
    const cash = s.nations[P].resources.capital
    ok(s, { type: 'wealthFund', nationId: P, amount: -100 })
    expect(s.nations[P].resources.capital - cash).toBeCloseTo(99)
  })

  it('borrowing to buy shares earns nothing: dividends follow the world rate', () => {
    const s = base()
    const bestBond = 0.003 * (0.5 + BANKING.neutralRate / BANKING.rateScale)
    // The stock fee alone (1% each way) eats any small gap.
    expect(dividendRate(s, 'payout') - bestBond).toBeLessThan(0.02 / 12)
  })

  it("an AI's central bank raises the rate when prices run and cuts it when people are out of work", () => {
    const s = base()
    const n = s.nations[P]
    expect(taylorRate({ ...n, bank: { ...n.bank, inflation: 10 } })).toBeGreaterThan(taylorRate(n))
    expect(taylorRate({ ...n, people: { ...n.people, unemployment: 0.15 } })).toBeLessThan(taylorRate(n))
  })
})

describe('industry and projects', () => {
  it('a project costs money each month, progresses with engineers, and finishes', () => {
    let s = base()
    ok(s, { type: 'startProject', nationId: P, project: 'rail' })
    expect(applyOrderNow(s, map, { type: 'startProject', nationId: P, project: 'grid' }).error).toMatch(/1 project at once/)
    const cash = s.nations[P].resources.capital
    for (let i = 0; i < 14 && !s.nations[P].projects.rail?.done; i++) s = resolveTurn(s, map, [])
    expect(s.nations[P].projects.rail?.done).toBe(true)
    expect(s.nations[P].resources.capital).toBeLessThan(cash + 1000)
    expect(applyOrderNow(s, map, { type: 'startProject', nationId: P, project: 'digitalGov' }).error).toMatch(/Great power/)
    expect(PROJECTS.rail.months).toBeGreaterThan(0)
  })

  it('a stalled project pauses while the treasury is empty', () => {
    let s = base()
    ok(s, { type: 'startProject', nationId: P, project: 'rail' })
    s.nations[P].resources.capital = -500
    s = resolveTurn(s, map, [])
    expect(s.nations[P].projects.rail!.progress).toBe(0)
  })

  it('state enterprises: buy, seize at a price in trust, sell', () => {
    const s = base()
    s.nations[P].sectors.energy = 3
    ok(s, { type: 'setStateOwned', nationId: P, sector: 'energy', mode: 'buy' })
    expect(s.nations[P].stateOwned).toContain('energy')
    expect(computeEconomy(s, map, P).enterpriseIncome).toBeGreaterThan(0)
    ok(s, { type: 'setStateOwned', nationId: P, sector: 'energy', mode: 'sell' })
    s.nations[P].sectors.arms = 2
    const calm = s.nations[P].stability
    ok(s, { type: 'setStateOwned', nationId: P, sector: 'arms', mode: 'seize' })
    expect(s.nations[P].stability).toBeLessThan(calm)
    expect(s.nations[P].seizedUntil).toBeGreaterThan(s.turn)
  })

  it('skills set how big industry can grow', () => {
    const s = base()
    const n = s.nations[P]
    const rich = { ...n, people: { ...n.people, skills: { ...n.people.skills, scientists: 0.06 } } }
    const poor = { ...n, people: { ...n.people, skills: { ...n.people.skills, scientists: 0.002 } } }
    expect(industryCapMult(rich, 'technology')).toBeGreaterThan(industryCapMult(poor, 'technology'))
  })
})

describe('military and research', () => {
  it('an academy sends recruits out drilled, and makes drill cheaper', () => {
    const s = base()
    s.nations[P].people.schooling = 0.6
    ok(s, { type: 'fundAcademy', nationId: P })
    expect(s.nations[P].academy).toBe(1)
    setMilitary(s, P, { infantry: 0 })
    addUnitToMilitary(s, P, 'infantry')
    expect(s.nations[P].military.drill.infantry).toBe(1)
    // A small nation's tier allows only level 1.
    expect(applyOrderNow(s, map, { type: 'fundAcademy', nationId: P }).error).toMatch(/Regional power/)
  })

  it('research programs take spare research and give lasting gains', () => {
    let s = base()
    const tp = s.nations[P].resources.tp
    s = resolveTurn(s, map, [{ type: 'researchProgram', nationId: P, track: 'productivity' }])
    expect(s.nations[P].research2.productivity).toBe(1)
    expect(s.nations[P].resources.tp).toBeLessThan(tp - programCost(0) + 200)
  })

  it('arms exports bring money, and selling to anyone needs a bigger nation', () => {
    const s = base()
    s.nations[P].sectors.arms = 3
    expect(applyOrderNow(s, map, { type: 'setPrograms', nationId: P, programs: { armsExports: 'anyone' } }).error).toMatch(/Regional power/)
    const t = structuredClone(s)
    t.nations[P].programs.armsExports = 'friends'
    expect(computeEconomy(t, map, P).armsExports).toBeGreaterThan(0)
  })
})

describe('the World Council', () => {
  it('is for superpowers, and shows the vote before it is called', () => {
    const s = base()
    expect(applyOrderNow(s, map, { type: 'resolution', nationId: P, kind: 'recognition' }).error).toMatch(/Superpower/)
    const vote = projectedVote(s, map, P, 'accord')
    expect(vote.votes.length).toBe(Object.values(s.nations).filter((n) => n.alive).length)
    expect(vote.yes).toBeGreaterThan(0)
  })
})

describe('old saves', () => {
  it('a save from before Statecraft loads with spending from its budget and a bond for its debt', () => {
    const s = base()
    const old = JSON.parse(JSON.stringify(s))
    for (const n of Object.values(old.nations) as Record<string, unknown>[]) {
      for (const k of ['spending', 'programs', 'people', 'bank', 'bonds', 'stateOwned', 'seizedUntil', 'projects', 'academy', 'research2', 'tier', 'regionalCapitals', 'capitalMoved', 'lastResolution']) delete n[k]
      n.budget = { military: 0.25, education: 0.5, health: 0.125, infrastructure: 0.125 }
    }
    delete old.worldStats
    old.nations[P].debt = 120
    old.nations[P].laws = ['universal_healthcare']
    const loaded = normalizeGame(old, map)
    expect(loaded.nations[P].spending.schools).toBe(4)
    expect(loaded.nations[P].spending.health).toBe(2)
    expect(loaded.nations[P].laws).not.toContain('universal_healthcare')
    expect(loaded.nations[P].bonds).toHaveLength(1)
    expect(loaded.nations[P].debt).toBeCloseTo(120)
    expect(loaded.worldStats).toBeTruthy()
    // And it plays on.
    expect(() => resolveTurn(loaded, map, [])).not.toThrow()
  })
})

describe('the new events', () => {
  it('every event can be described and chosen without error', () => {
    const s = base()
    s.nations[P].projects.rail = { progress: 2, done: false }
    for (const def of EVENTS) {
      for (let i = 0; i < 2; i++) {
        const t = structuredClone(s)
        t.pendingEvent = { eventId: def.id, turn: t.turn, rivalId: def.needsRival ? 'r1' : null, regionId: def.needsRegion ? P : null }
        expect(() => applyEventChoice(t, map, i)).not.toThrow()
      }
    }
    expect(EVENTS.length).toBeGreaterThanOrEqual(23)
  })
})
