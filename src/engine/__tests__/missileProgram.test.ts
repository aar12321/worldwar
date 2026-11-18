import { describe, expect, it } from 'vitest'
import { DEVS, FACILITIES, MPROG, PROGRAM_RULES, STAFF, TEST_RULES, type MissileProgramAction } from '../../data/missileProgram'
import { MISSILES, MISSILE_PROGRAM } from '../../data/missiles'
import { absDay, clockOf, daysInMonth } from '../calendar'
import { computeEconomy, nationWorkforce } from '../economy'
import { advanceDay, startLive } from '../live'
import { strikeForecast } from '../missileForecast'
import {
  activeDevs,
  chiefCandidates,
  dayAfter,
  devRate,
  devStatus,
  milestones,
  monthsBetween,
  nextDue,
  poachRisk,
  programBill,
  programDueBy,
  programNews,
  programTalentCap,
  rivalPrograms,
  testOdds,
} from '../missileProgram'
import { buildMissilesCost, buildRoom, launchSite, reachKm, storageCap } from '../missiles'
import { harmOf, interceptorCap, salvoDefense } from '../missileWar'
import { validateOrder } from '../orders'
import { programFx } from '../programEffects'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { talentCap } from '../space'
import type { GameState, Order } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(8)
const act = (action: MissileProgramAction, nationId = 'r0'): Order => ({ type: 'missileProgram', nationId, action })

function rich(s: GameState = startState(map)) {
  for (const id of ['r0', 'r1']) {
    const n = s.nations[id]
    n.resources.capital = 5000
    n.resources.tp = 2000
    n.resources.steel = 500
    n.resources.oil = 500
  }
  return s
}

/** Applies orders at once and fails the test on the first refusal. */
function apply(s: GameState, ...orders: Order[]) {
  for (const o of orders) {
    const r = applyOrderNow(s, map, o)
    expect(r.error, JSON.stringify(o)).toBeNull()
  }
  return s
}

const month = (s: GameState, orders: Order[] = []) => resolveTurn(s, map, orders)

/** A program with the institute, the stand and staff, at charter level 2. */
function founded() {
  let s = rich()
  s.nations.r0.missileProgram = 2
  apply(s, act({ kind: 'build', facility: 'institute' }), act({ kind: 'hire', role: 'engineer', count: 3 }))
  s = month(s)
  apply(s, act({ kind: 'build', facility: 'stand' }))
  s = month(s)
  return s
}

describe('time', () => {
  it('a whole month is exactly one, whatever its length', () => {
    for (const turn of [1, 2, 13, 14]) expect(monthsBetween(absDay(turn, 0), absDay(turn + 1, 0))).toBe(1)
  })
  it('dayAfter lands on the first of the month for whole months, and inside it for parts', () => {
    expect(dayAfter(absDay(3, 0), 2)).toBe(absDay(5, 0))
    const half = dayAfter(absDay(2, 0), 0.5)
    expect(half).toBeGreaterThan(absDay(2, 0))
    expect(half).toBeLessThan(absDay(3, 0))
  })
})

describe('structure: facilities', () => {
  it('a nation with no program can found the institute, which is paid at once and opens after its months', () => {
    let s = rich()
    const money = s.nations.r0.resources.capital
    apply(s, act({ kind: 'build', facility: 'institute' }))
    expect(s.nations.r0.resources.capital).toBe(money - FACILITIES.institute.money[0])
    expect(s.nations.r0.mprog?.fac.institute).toBeUndefined()
    s = month(s)
    expect(s.nations.r0.mprog?.fac.institute).toBe(1)
    expect(s.nations.r0.mprog?.stats.built).toBe(1)
  })

  it('the charter caps the level: one above the program level, and the tier caps it too', () => {
    let s = rich()
    apply(s, act({ kind: 'build', facility: 'institute' }))
    s = month(s)
    expect(validateOrder(s, map, act({ kind: 'build', facility: 'institute' }))).toMatch(/Raise the program to level 1/)
    s.nations.r0.missileProgram = 3
    s.nations.r0.mprog!.fac.institute = 3
    expect(validateOrder(s, map, act({ kind: 'build', facility: 'institute' }))).toMatch(/can build it to level 3/)
    s.nations.r0.tier = 2
    expect(validateOrder(s, map, act({ kind: 'build', facility: 'institute' }))).toBeNull()
  })

  it('one construction at a time for a small nation, and never the same facility twice', () => {
    const s = rich()
    apply(s, act({ kind: 'build', facility: 'institute' }))
    expect(validateOrder(s, map, act({ kind: 'build', facility: 'institute' }))).toMatch(/Already under construction/)
    expect(validateOrder(s, map, act({ kind: 'build', facility: 'bureau' }))).toMatch(/at a time/)
  })

  it('the monthly bill is upkeep plus salaries plus operations, and the economy charges it as its own line', () => {
    const s = founded()
    const bill = programBill(s.nations.r0)
    expect(bill.upkeep).toBe(FACILITIES.institute.upkeep[0] + FACILITIES.stand.upkeep[0])
    expect(bill.salaries).toBeCloseTo(3 * STAFF.engineer.salary)
    const line = computeEconomy(s, map, 'r0').lines?.find((l) => l.label === 'Missile program')
    expect(line?.amount).toBeCloseTo(-bill.total)
  })

  it('a nation that never uses it has no bill, no line and no field', () => {
    const s = month(rich())
    expect(s.nations.r0.mprog).toBeUndefined()
    expect(programBill(s.nations.r0).total).toBe(0)
    expect(computeEconomy(s, map, 'r0').lines?.some((l) => l.label === 'Missile program')).toBe(false)
  })
})

describe('talent', () => {
  it('hires are capped by what the people can spare, and the space agency shares the pool', () => {
    const s = rich()
    const wf = nationWorkforce(s, map, 'r0')
    const cap = programTalentCap(s.nations.r0, wf)
    expect(cap).toBeGreaterThanOrEqual(2)
    const n = s.nations.r0
    n.mprog = { fac: {}, builds: [], staff: { engineer: cap }, devs: {}, line: [], budget: 1, exp: 0, asOf: clockOf(s), stats: { tests: 0, successes: 0, failures: 0, built: 0, poached: 0, gained: 0 }, seq: 0 }
    expect(validateOrder(s, map, act({ kind: 'hire', role: 'crew', count: 1 }))).toMatch(/spare no more/)
    n.mprog.staff.engineer = cap - 1
    expect(validateOrder(s, map, act({ kind: 'hire', role: 'crew', count: 1 }))).toBeNull()
    // A space engineer takes two places.
    n.space = { engineers: 1, astronauts: 0 } as never
    expect(programTalentCap(n, wf)).toBe(cap - 2)
    expect(validateOrder(s, map, act({ kind: 'hire', role: 'crew', count: 1 }))).toMatch(/spare no more/)
    // And the program's staff come out of the space agency's pool.
    delete n.space
    expect(talentCap(n, wf)).toBeLessThan(talentCap({ ...n, mprog: undefined }, wf))
  })

  it('staff draw engineers from the factories', () => {
    const s = founded()
    const e = computeEconomy(s, map, 'r0')
    const bare = computeEconomy({ ...s, nations: { ...s.nations, r0: { ...s.nations.r0, mprog: undefined } } }, map, 'r0')
    expect(e.basis.extraEngineers ?? 0).toBeGreaterThan(bare.basis.extraEngineers ?? 0)
  })

  it('more engineers develop faster; the chief designer of the branch faster still', () => {
    const s = founded()
    apply(s, act({ kind: 'develop', dev: 'motors' }))
    const base = devRate(s.nations.r0, 'motors')
    apply(s, act({ kind: 'hire', role: 'propulsion', count: 2 }))
    const more = devRate(s.nations.r0, 'motors')
    expect(more).toBeGreaterThan(base)
    const pick = chiefCandidates(s, s.nations.r0).findIndex((c) => c.trait === 'engines')
    if (pick >= 0) {
      apply(s, act({ kind: 'chief', pick }))
      expect(devRate(s.nations.r0, 'motors')).toBeGreaterThan(more)
    }
  })

  it('chief candidates are the same on every screen and change with the year', () => {
    const s = rich()
    expect(chiefCandidates(s, s.nations.r0)).toEqual(chiefCandidates(structuredClone(s), s.nations.r0))
    const later = { ...s, turn: s.turn + 12 }
    expect(chiefCandidates(later, s.nations.r0)).not.toEqual(chiefCandidates(s, s.nations.r0))
    expect(new Set(chiefCandidates(s, s.nations.r0).map((c) => c.trait)).size).toBe(3)
  })
})

describe('development and test launches', () => {
  it('in-house work needs an institute and two engineers; a contractor needs neither but costs more', () => {
    const s = rich()
    s.nations.r0.missileProgram = 1
    expect(validateOrder(s, map, act({ kind: 'develop', dev: 'motors' }))).toMatch(/research institute/)
    expect(validateOrder(s, map, act({ kind: 'develop', dev: 'motors', by: 'domestic' }))).toBeNull()
    const before = s.nations.r0.resources.capital
    apply(s, act({ kind: 'develop', dev: 'motors', by: 'domestic' }))
    expect(before - s.nations.r0.resources.capital).toBe(Math.ceil(DEVS.motors.money * 1.35))
    expect(s.nations.r0.resources.tp).toBe(2000 - DEVS.motors.tp)
  })

  it('prerequisites, the charter and facilities gate a development', () => {
    const s = founded()
    expect(devStatus(s.nations.r0, 'stage')).toBe('locked')
    expect(validateOrder(s, map, act({ kind: 'develop', dev: 'stage' }))).toMatch(/Improved motors first/)
    expect(validateOrder(s, map, act({ kind: 'develop', dev: 'warheads' }))).toMatch(/Inertial guidance first/)
    expect(validateOrder(s, map, act({ kind: 'develop', dev: 'mirv' }))).toMatch(/first/)
    expect(validateOrder(s, map, act({ kind: 'develop', dev: 'lines' }))).toMatch(/production plant/)
  })

  it('slots: one project at a time with a small institute', () => {
    const s = founded()
    apply(s, act({ kind: 'develop', dev: 'motors' }))
    expect(validateOrder(s, map, act({ kind: 'develop', dev: 'inertial' }))).toMatch(/at a time/)
  })

  it('a development reaches its test, a test is a seeded roll judged at the month end, and both outcomes happen', () => {
    let wins = 0
    let losses = 0
    for (let seed = 1; seed <= 12; seed++) {
      let s = founded()
      s.seed = seed
      apply(s, act({ kind: 'develop', dev: 'motors' }))
      for (let i = 0; i < 3 && s.nations.r0.mprog!.devs.motors!.state === 'dev'; i++) s = month(s)
      expect(s.nations.r0.mprog!.devs.motors!.state).toBe('test')
      const odds = testOdds(s.nations.r0, 'motors')
      apply(s, act({ kind: 'test', dev: 'motors' }))
      expect(s.missileTests?.length).toBe(1)
      expect(validateOrder(s, map, act({ kind: 'test', dev: 'motors' }))).toMatch(/already on the pad/)
      const tension = s.missileTension ?? 0
      s = month(s)
      expect(s.missileTests).toBeUndefined()
      const d = s.nations.r0.mprog!.devs.motors!
      if (d.state === 'done') {
        wins++
        expect(s.missileTension).toBeCloseTo(tension + TEST_RULES.tension)
      } else {
        losses++
        expect(d.fails).toBe(1)
        expect(testOdds(s.nations.r0, 'motors')).toBeGreaterThan(odds)
      }
      expect(s.nations.r0.mprog!.stats.tests).toBe(1)
    }
    expect(wins).toBeGreaterThan(0)
    expect(losses).toBeGreaterThan(0)
  })

  it('the same game gives the same test result', () => {
    const play = () => {
      let s = founded()
      apply(s, act({ kind: 'develop', dev: 'inertial' }))
      for (let i = 0; i < 3; i++) s = month(s)
      apply(s, act({ kind: 'test', dev: 'inertial' }))
      return month(s).nations.r0.mprog!.devs.inertial
    }
    expect(play()).toEqual(play())
  })

  it('tests need a stand and are limited by its level', () => {
    const s = rich()
    s.nations.r0.missileProgram = 1
    apply(s, act({ kind: 'develop', dev: 'motors', by: 'foreign' }))
    s.nations.r0.mprog!.devs.motors!.state = 'test'
    expect(validateOrder(s, map, act({ kind: 'test', dev: 'motors' }))).toMatch(/test stand/)
    s.nations.r0.mprog!.fac.stand = 1
    expect(validateOrder(s, map, act({ kind: 'test', dev: 'motors' }))).toBeNull()
  })

  it('projects without a test are in service when the work is done', () => {
    let s = founded()
    apply(s, act({ kind: 'build', facility: 'plant' }))
    s = month(month(s))
    apply(s, act({ kind: 'develop', dev: 'lines' }))
    for (let i = 0; i < 3; i++) s = month(s)
    expect(s.nations.r0.mprog!.devs.lines!.state).toBe('done')
  })

  it('a foreign contractor exposes the program to every rival', () => {
    const s = rich()
    s.nations.r0.missileProgram = 1
    expect(rivalPrograms(s, s.nations.r1)).toEqual([])
    apply(s, act({ kind: 'develop', dev: 'motors', by: 'foreign' }))
    expect(rivalPrograms(s, s.nations.r1).map((r) => r.id)).toEqual(['r0'])
  })
})

describe('budget and money', () => {
  it('a bigger budget works faster and costs more operations', () => {
    const s = founded()
    apply(s, act({ kind: 'develop', dev: 'motors' }))
    const r = devRate(s.nations.r0, 'motors')
    const ops = programBill(s.nations.r0).ops
    apply(s, act({ kind: 'budget', level: 1.5 }))
    expect(devRate(s.nations.r0, 'motors')).toBeCloseTo((r * 1.2) / 1)
    expect(programBill(s.nations.r0).ops).toBeCloseTo(ops * 1.5)
    expect(validateOrder(s, map, act({ kind: 'budget', level: 1.5 }))).toMatch(/already/)
    expect(validateOrder(s, map, act({ kind: 'budget', level: 7 }))).toMatch(/Choose a budget/)
  })

  it('an empty treasury stalls in-house work for the month', () => {
    let s = founded()
    apply(s, act({ kind: 'develop', dev: 'motors' }))
    s.nations.r0.resources.capital = -500
    s = month(s)
    expect(s.nations.r0.mprog!.stalled).toBe(true)
    expect(devRate(s.nations.r0, 'motors')).toBe(0)
    const left = s.nations.r0.mprog!.devs.motors!.left
    s = month(s)
    expect(s.nations.r0.mprog!.devs.motors!.left).toBeCloseTo(left)
  })
})

/** A program with a finished development's effects, to compare strikes with and without. */
function withDevs(s: GameState, id: string, devs: (keyof typeof DEVS)[]) {
  const n = s.nations[id]
  n.mprog = { fac: {}, builds: [], staff: {}, devs: Object.fromEntries(devs.map((d) => [d, { state: 'done', left: 0, total: 1, by: 'house', fails: 0 }])), line: [], budget: 1, exp: 0, asOf: clockOf(s), stats: { tests: 0, successes: 0, failures: 0, built: 0, poached: 0, gained: 0 }, seq: 0 }
}

describe('the program changes strikes and forecasts', () => {
  function warWorld() {
    const s = rich()
    s.wars.push('r0|r3')
    s.nations.r0.missileProgram = 3
    s.nations.r0.arsenal = { cruise: 20, ballistic: 10 }
    s.regions.r0.buildings.factory = 1
    s.regions.r3.buildings.factory = 1
    s.nations.r3.systems = { ...(s.nations.r3.systems ?? {}), shield: 3 } as never
    return s
  }

  it('propulsion work extends the range a strike reaches', () => {
    const s = warWorld()
    const far = 'r7'
    s.wars.push('r0|r7')
    const km = MISSILES.tactical.km
    s.nations.r0.arsenal = { tactical: 5 }
    // r0 to r7 is 35 degrees of longitude at the equator (about 3900 km): past a tactical missile's 2500 km.
    expect(launchSite(s, map, 'r0', far, 'tactical')).toBeNull()
    withDevs(s, 'r0', ['motors', 'stage'])
    s.nations.r0.missileProgram = 3
    expect(reachKm(s.nations.r0, 'tactical')).toBe(Math.round(km * 1.45))
    expect(launchSite(s, map, 'r0', far, 'tactical')).toBeNull()
    withDevs(s, 'r0', ['motors', 'stage', 'glide'])
    expect(reachKm(s.nations.r0, 'tactical')).toBe(Math.round(km * 1.55))
    // Hypersonic missiles are technology's, not the program's.
    expect(reachKm(s.nations.r0, 'hypersonic')).toBe(MISSILES.hypersonic.km)
  })

  it('decoys and stealth get more through a shield; newer interceptors stop more', () => {
    const s = warWorld()
    const plain = salvoDefense(s, 'r0', 'r3', 'r3', 'cruise', 6).through
    withDevs(s, 'r0', ['decoys', 'stealth'])
    const sneaky = salvoDefense(s, 'r0', 'r3', 'r3', 'cruise', 6).through
    expect(sneaky).toBeGreaterThan(plain)
    withDevs(s, 'r3', ['gen2', 'gen3'])
    expect(salvoDefense(s, 'r0', 'r3', 'r3', 'cruise', 6).through).toBeLessThan(sneaky)
    // The forecast reads the same rules.
    const f = strikeForecast(s, map, 'r0', 'r3', 'cruise', 6, 'country')
    expect(f!.chance).toBeCloseTo(salvoDefense(s, 'r0', 'r3', 'r3', 'cruise', 6).through, 5)
  })

  it('guidance makes each missile that lands do more; hardened silos save a store', () => {
    const region = { cities: [] }
    const plain = harmOf('ballistic', 4, 0.5, 'country', region)
    const sharp = harmOf('ballistic', 4, 0.5, 'country', region, 0, false, { harm: 0.3, harden: 0 })
    expect(sharp.line).toBeGreaterThan(plain.line)
    expect(sharp.lossPct).toBeGreaterThan(plain.lossPct)
    expect(sharp.tension).toBe(plain.tension)
    const site = harmOf('tactical', 4, 0.5, 'site', region)
    const hard = harmOf('tactical', 4, 0.5, 'site', region, 0, false, { harm: 0, harden: 0.4 })
    expect(hard.stock).toBeCloseTo(site.stock * 0.6)
  })

  it('production work makes missiles cheaper, more a month, and the silos store more', () => {
    const s = warWorld()
    const o = { type: 'buildMissiles' as const, nationId: 'r0', kind: 'cruise' as const, count: 10 }
    const price = buildMissilesCost(o, s.nations.r0).capital
    const room = buildRoom(s.nations.r0, s.turn)
    const cap = storageCap(s.nations.r0)
    withDevs(s, 'r0', ['lines', 'auto', 'hardened'])
    s.nations.r0.mprog!.fac.plant = 1
    expect(buildMissilesCost(o, s.nations.r0).capital).toBeLessThan(price)
    expect(buildRoom(s.nations.r0, s.turn)).toBe(room + 4 + 3)
    expect(storageCap(s.nations.r0)).toBe(cap + 6)
    expect(room).toBe(MISSILE_PROGRAM.capacity[3])
  })

  it('interceptor works hold more rounds', () => {
    const s = warWorld()
    const cap = interceptorCap(s.nations.r3)
    withDevs(s, 'r3', ['gen2'])
    s.nations.r3.mprog!.fac.works = 1
    expect(interceptorCap(s.nations.r3)).toBe(Math.round(cap * 1.35))
  })

  it('effects are held to their caps', () => {
    const s = rich()
    withDevs(s, 'r0', Object.keys(DEVS) as (keyof typeof DEVS)[])
    s.nations.r0.mprog!.fac = { integration: 2, works: 3, silos: 3, plant: 4 }
    s.nations.r0.mprog!.staff = { guidance: 20, production: 20 }
    const fx = programFx(s.nations.r0)!
    expect(fx.harm).toBeLessThanOrEqual(0.5)
    expect(fx.evade).toBeLessThanOrEqual(0.3)
    expect(fx.cost).toBeLessThanOrEqual(0.35)
  })
})

describe('the production line', () => {
  it('delivers a batch over the month, a missile at a time', () => {
    let s = founded()
    s.nations.r0.mprog!.fac.plant = 1
    const before = s.nations.r0.arsenal?.cruise ?? 0
    apply(s, act({ kind: 'produce', missile: 'cruise', count: 5 }))
    s = month(s)
    // Three a month from a level-1 plant at the normal budget.
    expect((s.nations.r0.arsenal?.cruise ?? 0) - before).toBe(3)
    s = month(s)
    expect((s.nations.r0.arsenal?.cruise ?? 0) - before).toBe(5)
    expect(s.nations.r0.mprog!.line).toEqual([])
  })

  it('a batch must fit the stores', () => {
    const s = founded()
    s.nations.r0.mprog!.fac.plant = 1
    s.nations.r0.arsenal = { cruise: storageCap(s.nations.r0) }
    expect(validateOrder(s, map, act({ kind: 'produce', missile: 'cruise', count: 1 }))).toMatch(/stores are full/)
  })
})

describe('live games', () => {
  it('a facility opens on its own day, the clock runs that day, and the month matches a turn game', () => {
    const live = rich(startLive(startState(map)))
    apply(live, act({ kind: 'build', facility: 'institute' }))
    const due = nextDue(live.nations.r0)
    expect(due).toBe(absDay(live.turn + 1, 0))
    let s = live
    while (clockOf(s) < due) {
      expect(programDueBy(s, clockOf(s))).toBe(false)
      s = advanceDay(s, map, { planner: () => [] }).state
    }
    expect(s.nations.r0.mprog?.fac.institute).toBe(1)
    const turn = month(apply(rich(), act({ kind: 'build', facility: 'institute' })))
    expect(turn.nations.r0.mprog?.fac.institute).toBe(1)
  })

  it('a half-month job finishes mid-month on the day it is due', () => {
    let s = rich(startLive(startState(map)))
    s.nations.r0.missileProgram = 1
    apply(s, act({ kind: 'develop', dev: 'motors', by: 'foreign' }))
    const due = nextDue(s.nations.r0)
    expect(due).toBeLessThan(absDay(s.turn + 2, 0))
    while (clockOf(s) < due) s = advanceDay(s, map, { planner: () => [] }).state
    expect(s.nations.r0.mprog!.devs.motors!.state).toBe('test')
  })

  it('a test counts down, flies, and lands on its day; the arc is on the game for every screen', () => {
    let s = rich(startLive(startState(map)))
    s.nations.r0.missileProgram = 1
    apply(s, act({ kind: 'develop', dev: 'motors', by: 'foreign' }))
    s.nations.r0.mprog!.devs.motors!.state = 'test'
    s.nations.r0.mprog!.fac.stand = 1
    const now = clockOf(s)
    apply(s, act({ kind: 'test', dev: 'motors' }))
    const t = s.missileTests![0]
    expect(t.launched).toBe(now + TEST_RULES.countdown)
    expect(t.lands).toBe(t.launched + TEST_RULES.flight)
    while (clockOf(s) < t.lands - 1) s = advanceDay(s, map, { planner: () => [] }).state
    expect(s.missileTests?.length).toBe(1)
    s = advanceDay(s, map, { planner: () => [] }).state
    expect(s.missileTests).toBeUndefined()
    expect(s.nations.r0.mprog!.stats.tests).toBe(1)
  })

  it('a quiet program does not wake the clock', () => {
    const s = rich(startLive(startState(map)))
    apply(s, act({ kind: 'hire', role: 'engineer', count: 2 }))
    expect(nextDue(s.nations.r0)).toBe(Infinity)
    const next = advanceDay(s, map, { planner: () => [] })
    expect(next.state.nations).toBe(s.nations)
  })

  it('the same orders on two screens give the same game', () => {
    const play = () => {
      let s = rich(startLive(startState(map, 'r0', 9)))
      s.nations.r0.missileProgram = 2
      apply(s, act({ kind: 'build', facility: 'institute' }), act({ kind: 'hire', role: 'engineer', count: 2 }), act({ kind: 'develop', dev: 'motors', by: 'domestic' }))
      for (let i = 0; i < 70; i++) {
        s = advanceDay(s, map, { planner: () => [] }).state
        if (s.nations.r0.mprog!.devs.motors?.state === 'test' && !s.missileTests && (s.nations.r0.mprog!.fac.stand ?? 0) > 0) applyOrderNow(s, map, act({ kind: 'test', dev: 'motors' }))
        if (i === 31) applyOrderNow(s, map, act({ kind: 'build', facility: 'stand' }))
      }
      return JSON.stringify(s)
    }
    expect(play()).toBe(play())
  })
})

describe('rivals', () => {
  it('poaching is seeded, needs staff, and analysts and a rich budget cut the risk', () => {
    const s = founded()
    apply(s, act({ kind: 'hire', role: 'crew', count: 1 }))
    const base = poachRisk(s, s.nations.r0)
    expect(base).toBeGreaterThan(0)
    apply(s, act({ kind: 'budget', level: 1.5 }))
    const rich2 = poachRisk(s, s.nations.r0)
    expect(rich2).toBeLessThan(base)
    s.nations.r0.mprog!.staff.analyst = 2
    expect(poachRisk(s, s.nations.r0)).toBeLessThan(rich2)
  })

  it('over many months some staff are poached and go to a rival program, the same way every time', () => {
    const play = () => {
      let s = founded()
      s.nations.r0.mprog!.staff = { engineer: 6, crew: 4 }
      s.nations.r0.mprog!.budget = 0.5
      withDevs(s, 'r1', [])
      s.nations.r1.mprog!.staff.engineer = 1
      for (let i = 0; i < 30; i++) s = month(s)
      return s
    }
    const a = play()
    expect(a.nations.r0.mprog!.stats.poached).toBeGreaterThan(0)
    expect(a.nations.r1.mprog!.stats.gained).toBe(a.nations.r0.mprog!.stats.poached - (a.nations.r0.mprog!.chief ? 0 : 0))
    expect(JSON.stringify(play())).toBe(JSON.stringify(a))
  })

  it('analysts show rival programs; three show what they develop', () => {
    const s = founded()
    withDevs(s, 'r1', ['motors'])
    expect(rivalPrograms(s, s.nations.r0)).toEqual([])
    apply(s, act({ kind: 'hire', role: 'analyst', count: 1 }))
    expect(rivalPrograms(s, s.nations.r0)[0].detail).toBe(false)
    s.nations.r0.mprog!.staff.analyst = 3
    expect(rivalPrograms(s, s.nations.r0)[0].detail).toBe(true)
  })
})

describe('the screen', () => {
  it('milestones and news follow the state', () => {
    let s = rich()
    const before = structuredClone(s)
    apply(s, act({ kind: 'build', facility: 'institute' }))
    s = month(s)
    expect(milestones(s.nations.r0)).toContain('founded')
    const news = programNews(before, s, 'r0')
    expect(news.some((x) => x.text.includes('Research institute level 1'))).toBe(true)
  })
})

describe('malformed orders and the switch', () => {
  const junk: unknown[] = [
    undefined,
    null,
    3,
    'build',
    {},
    { kind: 7 },
    { kind: 'build' },
    { kind: 'build', facility: 'moonbase' },
    { kind: 'hire', role: 'engineer' },
    { kind: 'hire', role: 'engineer', count: -2 },
    { kind: 'hire', role: 'engineer', count: 1.5 },
    { kind: 'hire', role: 'engineer', count: 1e9 },
    { kind: 'hire', role: 'wizard', count: 1 },
    { kind: 'dismiss', role: 'engineer', count: 3 },
    { kind: 'chief', pick: 9 },
    { kind: 'chief', pick: -1 },
    { kind: 'chief', pick: 'x' },
    { kind: 'develop', dev: 'warp' },
    { kind: 'develop', dev: 'motors', by: 'aliens' },
    { kind: 'test', dev: 'motors' },
    { kind: 'test' },
    { kind: 'budget', level: NaN },
    { kind: 'budget', level: 99 },
    { kind: 'produce', missile: 'hypersonic', count: 1 },
    { kind: 'produce', missile: 'cruise', count: 0 },
    { kind: 'produce', missile: 'cruise', count: 1e6 },
    { kind: 'dropChief' },
    { kind: 'nonsense' },
  ]

  it('every malformed action is refused, nothing throws, nothing is charged', () => {
    const s = rich()
    for (const a of junk) {
      const o = { type: 'missileProgram', nationId: 'r0', action: a } as Order
      const err = validateOrder(s, map, o)
      expect(err, JSON.stringify(a)).not.toBeNull()
      expect(err, JSON.stringify(a)).not.toMatch(/makes no sense \(/)
      expect(applyOrderNow(structuredClone(s), map, o).error).not.toBeNull()
    }
    expect(s.nations.r0.mprog).toBeUndefined()
  })

  it('a month with malformed orders from a human still resolves', () => {
    const s = rich()
    s.humans = ['r0']
    const orders = junk.map((a) => ({ type: 'missileProgram', nationId: 'r0', action: a }) as Order)
    expect(() => month(s, orders)).not.toThrow()
  })

  it('random actions never throw and keep the program sane', () => {
    let s = rich()
    s.nations.r0.missileProgram = 3
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
    const kinds = ['build', 'hire', 'dismiss', 'chief', 'dropChief', 'develop', 'test', 'budget', 'produce']
    for (let i = 0; i < 400; i++) {
      const a = { kind: pick(kinds), facility: pick(Object.keys(FACILITIES)), role: pick(Object.keys(STAFF)), count: pick([1, 2, 5, 0, -1]), pick: pick([0, 1, 2, 5]), dev: pick(Object.keys(DEVS)), by: pick(['house', 'domestic', 'foreign']), level: pick(PROGRAM_RULES.budgets), missile: pick(['cruise', 'tactical', 'decoy']) } as unknown as MissileProgramAction
      expect(() => applyOrderNow(s, map, act(a))).not.toThrow()
      if (i % 25 === 24) s = month(s)
    }
    const p = s.nations.r0.mprog!
    expect(activeDevs(s.nations.r0).length).toBeLessThanOrEqual(3)
    for (const v of Object.values(p.staff)) expect(v).toBeGreaterThan(0)
    expect(Number.isFinite(s.nations.r0.resources.capital)).toBe(true)
  })

  it('with the program switched off, every order is refused and every effect is zero', () => {
    const s = rich()
    withDevs(s, 'r0', ['motors', 'decoys'])
    MPROG.on = false
    try {
      expect(validateOrder(s, map, act({ kind: 'budget', level: 1.5 }))).toMatch(/not available/)
      expect(programFx(s.nations.r0)).toBeUndefined()
      expect(reachKm(s.nations.r0, 'cruise')).toBe(MISSILES.cruise.km)
      expect(programBill(s.nations.r0).total).toBe(0)
    } finally {
      MPROG.on = true
    }
  })
})

describe('numbers', () => {
  it('every development and facility is reachable: prerequisites exist and needs are buildable within the caps', () => {
    for (const [id, d] of Object.entries(DEVS)) {
      for (const r of d.requires) expect(DEVS[r], `${id} needs ${r}`).toBeDefined()
      for (const [f, lvl] of Object.entries(d.needs)) expect(FACILITIES[f as keyof typeof FACILITIES].money.length, `${id} needs ${f} ${lvl}`).toBeGreaterThanOrEqual(lvl!)
      expect(d.months).toBeGreaterThan(0)
    }
    for (const f of Object.values(FACILITIES)) expect(f.money.length === f.months.length && f.months.length === f.upkeep.length).toBe(true)
  })

  it('a turn game day count is the real month', () => {
    expect(daysInMonth(2)).toBe(28)
  })
})
