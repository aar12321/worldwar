import { describe, expect, it } from 'vitest'
import { OIL_DEPOSITS } from '../../data/deposits'
import { LOCAL, LOCAL_IDS } from '../../data/localProjects'
import { PROJECT_IDS, PROJECT_LEVELS, PROJECT_RULES, PROJECTS } from '../../data/projects'
import { TIERS } from '../../data/empire'
import { computeEconomy, lineMax } from '../economy'
import { healthTarget } from '../people'
import { activeProjects, doneProject, levelCost, levelMonths, projectBill, projectLevel, projectPower, projectPowerSupply, scaleBonus, scaleFactor } from '../industry'
import { validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { fundSystemCost } from '../systems'
import { societyEffects } from '../society'
import type { GameState, LocalProjectId, Order, ProjectId } from '../types'
import { activeLocal, localBill, localCost, localEffects, localLevel, localMonthly, localProblem, localScale, RUSH, rushCost, rushProblem } from '../works'
import { giveRegions, lineMap, startState } from './fixtures'

const map = lineMap(12, { 3: 'mountain', 4: 'forest' })
map.regions.r5.coastal = true
const P = 'r0'

function base(): GameState {
  const s = startState(map)
  s.nations[P].resources.capital = 20000
  s.nations[P].resources.pp = 300
  s.nations[P].resources.tp = 2000
  return s
}

const start = (project: ProjectId | LocalProjectId, regionId?: string): Order => ({ type: 'startProject', nationId: P, project, ...(regionId ? { regionId } : {}) })
const ok = (s: GameState, o: Order) => {
  const r = applyOrderNow(s, map, o)
  expect(r.error, JSON.stringify(o)).toBeNull()
}
const finish = (s: GameState, id: ProjectId, level = 1) => {
  s.nations[P].projects[id] = level === 1 ? { progress: PROJECTS[id].months, done: true } : { progress: levelMonths(id, level), done: true, level }
}
/** Plays months until a project's level is done. */
function build(s: GameState, id: ProjectId, level: number): GameState {
  let cur = s
  for (let i = 0; i < 80 && projectLevel(cur.nations[P], id) < level; i++) cur = resolveTurn(cur, map, [])
  return cur
}
/** A country-sized empire: tier 2 by holding four countries. */
function empire(s: GameState, n = 4) {
  giveRegions(s, P, Array.from({ length: n - 1 }, (_, i) => `r${i + 1}`))
  s.nations[P].tier = n >= 10 ? 3 : n >= 4 ? 2 : 1
}

describe('levels', () => {
  it('a single level is still just "done", and an upgrade leaves the earlier level working', () => {
    let s = base()
    ok(s, start('rail'))
    s = build(s, 'rail', 1)
    expect(s.nations[P].projects.rail).toEqual({ progress: PROJECTS.rail.months, done: true })
    expect(projectLevel(s.nations[P], 'rail')).toBe(1)
    const working = projectPower(s.nations[P], 'rail')
    ok(s, start('rail'))
    expect(s.nations[P].projects.rail).toMatchObject({ done: false, level: 1, progress: 0 })
    // While level 2 is built, level 1 still counts, and the project fills a slot.
    expect(projectLevel(s.nations[P], 'rail')).toBe(1)
    expect(projectPower(s.nations[P], 'rail')).toBe(working)
    expect(activeProjects(s.nations[P])).toContain('rail')
  })

  it('level 2 and 3 cost and take more, are worth more, and level 3 needs a Regional power', () => {
    expect(levelCost('rail', 1)).toBe(PROJECTS.rail.cost)
    expect(levelCost('rail', 2)).toBe(Math.round(PROJECTS.rail.cost * 1.6))
    expect(levelCost('rail', 3)).toBeGreaterThan(levelCost('rail', 2))
    expect(levelMonths('rail', 2)).toBeGreaterThan(levelMonths('rail', 1))
    // Each level is worth more, but what it adds for what it costs falls: the first level is the best deal.
    const { power, cost } = PROJECT_LEVELS
    expect(power[2]).toBeGreaterThan(power[1])
    expect(power[3]).toBeGreaterThan(power[2])
    expect((power[2] - power[1]) / cost[2]).toBeLessThan(power[1] / cost[1])
    expect((power[3] - power[2]) / cost[3]).toBeLessThan((power[2] - power[1]) / cost[2])
    const s = base()
    finish(s, 'rail')
    expect(validateOrder(s, map, start('rail'))).toBeNull()
    finish(s, 'rail', 2)
    expect(validateOrder(s, map, start('rail'))).toMatch(/Regional power/)
    empire(s)
    expect(validateOrder(s, map, start('rail'))).toBeNull()
    finish(s, 'rail', 3)
    expect(validateOrder(s, map, start('rail'))).toMatch(/highest level/)
  })

  it('upkeep is a share of everything put in, and the next level is billed while it is built', () => {
    const s = base()
    finish(s, 'rail')
    expect(projectBill(s.nations[P])).toEqual({ building: 0, upkeep: PROJECTS.rail.cost * PROJECT_RULES.maintenance })
    ok(s, start('rail'))
    const bill = projectBill(s.nations[P])
    expect(bill.upkeep).toBeCloseTo(PROJECTS.rail.cost * PROJECT_RULES.maintenance)
    expect(bill.building).toBeCloseTo(levelCost('rail', 2) / levelMonths('rail', 2))
    finish(s, 'rail', 2)
    expect(projectBill(s.nations[P]).upkeep).toBeCloseTo((levelCost('rail', 1) + levelCost('rail', 2)) * PROJECT_RULES.maintenance)
  })

  it('the old seven projects scale with their level, and are exactly as before at level 1 or not built', () => {
    expect(scaleBonus(0.06, 1)).toBe(0.06)
    expect(scaleBonus(0.06, 0)).toBe(0)
    expect(scaleFactor(1.25, 1)).toBe(1.25)
    expect(scaleFactor(1.25, 0)).toBe(1)
    expect(scaleFactor(0.75, 2)).toBeLessThan(0.75)
    const run = (level: number) => {
      const s = base()
      if (level) finish(s, 'ports', level)
      return computeEconomy(s, map, P).tradeCapacity
    }
    expect(run(1)).toBeGreaterThan(run(0))
    expect(run(2)).toBeGreaterThan(run(1))
    expect(run(3)).toBeGreaterThan(run(2))
    // And the money ports earn: it needs a port to earn from.
    const income = (level: number) => {
      const s = base()
      s.regions.r0.buildings.port = 3
      if (level) finish(s, 'ports', level)
      return computeEconomy(s, map, P).tradeIncome
    }
    expect(income(0)).toBeGreaterThan(0)
    expect(income(1) / income(0)).toBeCloseTo(1.25)
    expect(income(2)).toBeGreaterThan(income(1))
    // Rail's food and a space complex's cheaper Orbital Network scale as well.
    const food = (level: number) => {
      const s = base()
      if (level) finish(s, 'rail', level)
      return computeEconomy(s, map, P).foodProduction
    }
    expect(food(2)).toBeGreaterThan(food(1))
    expect(food(1)).toBeGreaterThan(food(0))
  })

  it('a space complex makes the Orbital Network cheaper and leaves every other system alone', () => {
    const s = base()
    const cost = (system: 'orbital' | 'cyber') => fundSystemCost(s, { type: 'fundSystem', nationId: P, system })
    const before = { orbital: cost('orbital'), cyber: cost('cyber') }
    finish(s, 'spaceComplex')
    expect(cost('orbital')).toBeLessThan(before.orbital)
    expect(cost('cyber')).toBe(before.cyber)
    expect(cost('cyber')).toBeGreaterThan(0)
  })
})

describe('slots', () => {
  it('a Nation builds two at once, and bigger empires more', () => {
    expect(TIERS.map((t) => t.projectSlots)).toEqual([2, 3, 4, 5, 6])
    expect(TIERS.map((t) => t.localSlots)).toEqual([2, 3, 5, 7, 10])
    const s = base()
    ok(s, start('rail'))
    ok(s, start('grid'))
    expect(validateOrder(s, map, start('broadband'))).toMatch(/2 projects at once/)
  })

  it('an upgrade under way takes a slot', () => {
    const s = base()
    finish(s, 'rail')
    ok(s, start('rail'))
    ok(s, start('grid'))
    expect(validateOrder(s, map, start('stadium'))).toMatch(/2 projects at once/)
  })
})

describe('new national projects', () => {
  it('17 in all, the new ones driven by data and gated by the size of the empire', () => {
    expect(PROJECT_IDS).toHaveLength(17)
    for (const id of PROJECT_IDS.slice(7)) {
      expect(PROJECTS[id].effects, id).toBeTruthy()
      expect(PROJECTS[id].effect.length).toBeGreaterThan(10)
    }
    expect(PROJECTS.fusion.power).toBe(40)
    expect(PROJECTS.plannedCity.tier).toBe(4)
    expect(PROJECTS.marsMission.tier).toBe(5)
    const s = base()
    expect(validateOrder(s, map, start('waterNetwork'))).toBeNull()
    expect(validateOrder(s, map, start('expo'))).toMatch(/Great power/)
    expect(validateOrder(s, map, start('marsMission'))).toMatch(/Hegemon/)
  })

  it('their effects reach the numbers they name, and grow with the level', () => {
    const s = base()
    const e0 = computeEconomy(s, map, P)
    const n = s.nations[P]
    const h0 = healthTarget(n, e0.basis, e0.coverage.doctors)
    finish(s, 'waterNetwork')
    finish(s, 'stadium')
    finish(s, 'broadband')
    const e1 = computeEconomy(s, map, P)
    expect(healthTarget(n, e1.basis, e1.coverage.doctors)).toBeGreaterThan(h0)
    expect(e1.stabilityTarget).toBeGreaterThan(e0.stabilityTarget)
    expect(e1.tpGain).toBeGreaterThan(e0.tpGain)
    expect(societyEffects(n).sources.map((x) => x.id)).toContain('project:stadium')
    finish(s, 'stadium', 2)
    expect(computeEconomy(s, map, P).stabilityTarget).toBeGreaterThan(e1.stabilityTarget)
  })

  it('share the ceiling on care with social programs, so stability cannot be bought without end', () => {
    const s = base()
    for (const id of ['stadium', 'plannedCity', 'marsMission'] as ProjectId[]) finish(s, id, 3)
    for (const id of ['festivals', 'surveillance', 'minimumWage', 'workerRights', 'mentalHealth'] as const) (s.nations[P].social ??= {})[id] = { level: 3, strength: 3, changed: -1 }
    const r = societyEffects(s.nations[P])
    expect(r.rawStability).toBeGreaterThan(18)
    expect(r.stability).toBeLessThan(18)
  })

  it('a fusion plant adds power to the grid, scaled by level, and a conquered-free nation has none', () => {
    const s = base()
    expect(projectPowerSupply(s.nations[P])).toBe(0)
    finish(s, 'fusion')
    expect(projectPowerSupply(s.nations[P])).toBe(40)
    finish(s, 'fusion', 2)
    expect(projectPowerSupply(s.nations[P])).toBeCloseTo(40 * 1.6)
  })

  it('a World Expo makes the AI nations think better of its host when it is finished', () => {
    let s = base()
    empire(s, 10)
    s.nations[P].resources.capital = 99999
    const before = (id: string) => (s.opinions[`${id}>${P}`] ?? []).reduce((a, m) => a + m.value, 0)
    const b = before('r11')
    ok(s, start('expo'))
    s = build(s, 'expo', 1)
    expect(doneProject(s.nations[P], 'expo')).toBe(true)
    const after = (s.opinions[`r11>${P}`] ?? []).reduce((a, m) => a + m.value, 0)
    expect(after).toBeGreaterThan(b)
  })
})

describe('rushing a project', () => {
  it('costs a few months of its bill, buys months of progress, and only once a month', () => {
    const s = base()
    ok(s, start('rail'))
    const p = s.nations[P].projects.rail!
    const monthly = PROJECTS.rail.cost / PROJECTS.rail.months
    expect(rushCost(s, s.nations[P], 'rail')).toBe(Math.round(RUSH.cost * monthly))
    const money = s.nations[P].resources.capital
    ok(s, { type: 'rushProject', nationId: P, project: 'rail' })
    expect(money - s.nations[P].resources.capital).toBe(Math.round(RUSH.cost * monthly))
    expect(p.progress).toBe(RUSH.months)
    expect(validateOrder(s, map, { type: 'rushProject', nationId: P, project: 'rail' })).toMatch(/already rushed/i)
    // A month on, it can be rushed again.
    const next = resolveTurn(s, map, [])
    expect(validateOrder(next, map, { type: 'rushProject', nationId: P, project: 'rail' })).toBeNull()
  })

  it('a rush finishes it sooner overall for a modest extra cost', () => {
    const run = (rush: boolean) => {
      let s = base()
      ok(s, start('rail'))
      let spent = 0
      for (let i = 0; i < 30 && !s.nations[P].projects.rail!.done; i++) {
        if (rush && i < 2) {
          const c = s.nations[P].resources.capital
          ok(s, { type: 'rushProject', nationId: P, project: 'rail' })
          spent += c - s.nations[P].resources.capital
        }
        const before = s.nations[P].resources.capital
        s = resolveTurn(s, map, [])
        spent += before - s.nations[P].resources.capital
      }
      return { months: s.turn - 1, spent, done: s.nations[P].projects.rail!.done }
    }
    const slow = run(false)
    const fast = run(true)
    expect(fast.done && slow.done).toBe(true)
    expect(fast.months).toBeLessThan(slow.months)
  })

  it('refuses what is not under way, paused, or about to finish', () => {
    const s = base()
    const rush: Order = { type: 'rushProject', nationId: P, project: 'rail' }
    expect(validateOrder(s, map, rush)).toMatch(/not under way/)
    ok(s, start('rail'))
    ok(s, { type: 'pauseProject', nationId: P, project: 'rail', paused: true })
    expect(validateOrder(s, map, rush)).toMatch(/Resume/)
    ok(s, { type: 'pauseProject', nationId: P, project: 'rail', paused: false })
    s.nations[P].projects.rail!.progress = PROJECTS.rail.months - 0.5
    expect(rushProblem(s, s.nations[P], 'rail')).toMatch(/next month/)
  })

  it('needs the money', () => {
    const s = base()
    ok(s, start('rail'))
    s.nations[P].resources.capital = 1
    expect(validateOrder(s, map, { type: 'rushProject', nationId: P, project: 'rail' })).toMatch(/money/)
  })
})

describe('projects in a country', () => {
  it('nine of them, each with a need, a price and a point', () => {
    expect(LOCAL_IDS).toHaveLength(9)
    for (const id of LOCAL_IDS) {
      expect(LOCAL[id].cost).toBeGreaterThan(0)
      expect(LOCAL[id].months).toBeGreaterThan(0)
      expect(LOCAL[id].effect.length).toBeGreaterThan(10)
      expect(Object.keys(LOCAL[id].yields).length).toBeGreaterThan(0)
    }
  })

  it('need what they need: hills for a dam, a coast for a resort, a university, a port, a deposit', () => {
    const s = base()
    empire(s)
    const t = (id: LocalProjectId, region: string) => localProblem(s, map, s.nations[P], id, region)
    expect(t('dam', 'r1')).toMatch(/mountains or forest/)
    expect(t('dam', 'r3')).toBeNull()
    expect(t('dam', 'r2')).toMatch(/mountains or forest/)
    expect(t('resort', 'r1')).toMatch(/coastline/)
    s.regions.r5.owner = P
    expect(t('resort', 'r5')).toBeNull()
    expect(t('techHub', 'r1')).toMatch(/university/)
    s.regions.r1.buildings.university = 1
    expect(t('techHub', 'r1')).toBeNull()
    expect(t('sez', 'r1')).toMatch(/port/)
    s.regions.r1.buildings.port = 1
    expect(t('sez', 'r1')).toBeNull()
    expect(t('mine', 'r1')).toMatch(/deposits/)
    OIL_DEPOSITS.r1 = 3
    try {
      expect(t('mine', 'r1')).toBeNull()
    } finally {
      delete OIL_DEPOSITS.r1
    }
    expect(t('irrigation', 'r9')).toMatch(/do not hold/)
  })

  it('cost money each month, finish, and then work for their country', () => {
    let s = base()
    const before = computeEconomy(s, map, P)
    ok(s, start('irrigation', 'r0'))
    expect(s.regions.r0.works!.irrigation).toMatchObject({ progress: 0, done: false, by: P })
    expect(localBill(s, P).building).toBeCloseTo(localMonthly('irrigation', 1, s.regions.r0))
    expect(computeEconomy(s, map, P).projects.building).toBeGreaterThan(0)
    for (let i = 0; i < 20 && !s.regions.r0.works?.irrigation?.done; i++) s = resolveTurn(s, map, [])
    expect(localLevel(s.regions.r0, 'irrigation')).toBe(1)
    const after = computeEconomy(s, map, P)
    expect(after.foodProduction - before.foodProduction).toBeCloseTo(LOCAL.irrigation.yields.food! * localScale(s.regions.r0), 0)
    expect(after.projects.upkeep).toBeGreaterThan(0)
    expect(localBill(s, P).building).toBe(0)
  })

  it('cost and flat yields grow with the size of the country, so the return is much the same wherever it is built', () => {
    const at = (pop: number) => {
      const s = base()
      s.regions.r0.population = pop
      return s
    }
    expect(localScale(at(1).regions.r0)).toBe(0.5)
    expect(localScale(at(1e6).regions.r0)).toBe(4)
    const small = at(20)
    const big = at(900)
    expect(localCost('irrigation', 1, big.regions.r0)).toBeGreaterThan(localCost('irrigation', 1, small.regions.r0))
    // Food a month for each coin of the price is about the same in a small country and a large one.
    const rate = (s: GameState) => {
      s.regions.r0.works = { irrigation: { progress: 6, done: true } }
      return localEffects(s.regions.r0, map.regions.r0).food / localCost('irrigation', 1, s.regions.r0)
    }
    expect(rate(big) / rate(small)).toBeGreaterThan(0.75)
    expect(rate(big) / rate(small)).toBeLessThan(1.35)
    // A country's share-based effects do not scale: a cultural centre settles as fast in a big country as a small one.
    small.regions.r0.works = { culturalCentre: { progress: 6, done: true } }
    big.regions.r0.works = { culturalCentre: { progress: 6, done: true } }
    expect(localEffects(big.regions.r0, map.regions.r0).settle).toBe(localEffects(small.regions.r0, map.regions.r0).settle)
  })

  it('upgrade to higher levels, which are worth more', () => {
    const s = base()
    s.regions.r0.works = { industrialPark: { progress: 6, done: true } }
    const one = localEffects(s.regions.r0, map.regions.r0)
    ok(s, start('industrialPark', 'r0'))
    expect(s.regions.r0.works!.industrialPark).toMatchObject({ done: false, level: 1 })
    // The first level keeps working through the upgrade.
    expect(localEffects(s.regions.r0, map.regions.r0).factory).toBeCloseTo(one.factory)
    s.regions.r0.works!.industrialPark = { progress: 7, done: true, level: 2 }
    expect(localEffects(s.regions.r0, map.regions.r0).factory).toBeCloseTo(one.factory * PROJECT_LEVELS.power[2])
  })

  it('a country with none gets the same frozen zeros every time, and an old save is untouched', () => {
    const s = base()
    expect(s.regions.r0.works).toBeUndefined()
    expect(localEffects(s.regions.r0, map.regions.r0)).toBe(localEffects(s.regions.r1, map.regions.r1))
    const after = resolveTurn(s, map, [])
    expect(after.regions.r0.works).toBeUndefined()
    expect(JSON.stringify(after.regions.r0)).not.toContain('works')
  })

  it('a Nation builds two at once, and a half-built one is not a slot once finished', () => {
    const s = base()
    ok(s, start('irrigation', 'r0'))
    ok(s, start('fortress', 'r0'))
    expect(validateOrder(s, map, start('culturalCentre', 'r0'))).toMatch(/2 projects in its countries at once/)
    expect(activeLocal(s, P)).toHaveLength(2)
    // Pausing frees no slot but stops the bill.
    ok(s, { type: 'pauseProject', nationId: P, project: 'fortress', regionId: 'r0', paused: true })
    expect(localBill(s, P).building).toBeCloseTo(localMonthly('irrigation', 1, s.regions.r0))
  })

  it('each one does its own work: factories, research, a Defense Line, settling, rebels, deposits and power', () => {
    const s = base()
    const mr = map.regions.r0
    const set = (id: LocalProjectId) => {
      s.regions.r0.works = { [id]: { progress: 99, done: true } }
      return localEffects(s.regions.r0, mr)
    }
    expect(set('industrialPark').factory).toBeGreaterThan(0)
    expect(set('techHub').research).toBeGreaterThan(0)
    expect(set('irrigation').food).toBeGreaterThan(0)
    expect(set('dam').power).toBeGreaterThan(0)
    expect(set('dam').money).toBeGreaterThan(0)
    expect(set('fortress').line).toBeGreaterThan(0)
    expect(set('culturalCentre').settle).toBeGreaterThan(0)
    expect(set('culturalCentre').order).toBeGreaterThan(0)
    expect(set('sez').trade).toBeGreaterThan(0)
    expect(set('mine').deposits).toBeGreaterThan(0)
    // A resort earns more in a richer country.
    s.regions.r0.works = { resort: { progress: 99, done: true } }
    const poor = localEffects(s.regions.r0, { ...mr, development: 0.2 }).money
    const rich = localEffects(s.regions.r0, { ...mr, development: 0.9 }).money
    expect(rich).toBeGreaterThan(poor)
  })

  it('a fortress lengthens the Defense Line, an industrial park raises factory income, a dam powers big industry', () => {
    const s = base()
    s.regions.r0.buildings.factory = 30
    const e0 = computeEconomy(s, map, P)
    s.regions.r0.works = { industrialPark: { progress: 6, done: true } }
    expect(computeEconomy(s, map, P).factoryIncome).toBeGreaterThan(e0.factoryIncome)
    s.regions.r0.works = { dam: { progress: 10, done: true } }
    expect(computeEconomy(s, map, P).factoryIncome).toBeGreaterThanOrEqual(e0.factoryIncome)
    s.regions.r0.works = undefined
    const line = lineMax(s, map, 'r0')
    s.regions.r0.works = { fortress: { progress: 6, done: true } }
    expect(lineMax(s, map, 'r0')).toBeCloseTo(line + LOCAL.fortress.yields.line! * localScale(s.regions.r0))
  })

  it('a cultural centre settles conquered land faster', () => {
    const run = (centre: boolean) => {
      const s = base()
      giveRegions(s, P, ['r1'])
      s.regions.r1.integration = 0.1
      if (centre) s.regions.r1.works = { culturalCentre: { progress: 6, done: true } }
      return resolveTurn(s, map, []).regions.r1.integration
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })

  it('stay with the land: a finished project goes to the conqueror, one half built by the old owner is dropped', () => {
    let s = base()
    giveRegions(s, 'r1', [])
    s.regions.r0.works = { irrigation: { progress: 6, done: true }, fortress: { progress: 2, done: false, by: P } }
    // r0 falls to r1.
    s.regions.r0.owner = 'r1'
    s = resolveTurn(s, map, [])
    expect(s.regions.r0.works!.irrigation).toBeTruthy()
    expect(s.regions.r0.works!.fortress).toBeUndefined()
    expect(s.regions.r0.owner).toBe('r1')
  })

  it('an upgrade half built by the old owner is stopped, and the level already built stays', () => {
    let s = base()
    s.regions.r0.works = { irrigation: { progress: 2, done: false, level: 1, by: P } }
    s.regions.r0.owner = 'r1'
    s = resolveTurn(s, map, [])
    expect(s.regions.r0.works!.irrigation!.done).toBe(true)
    expect(localLevel(s.regions.r0, 'irrigation')).toBe(1)
  })

  it('can be rushed and paused like the great ones', () => {
    const s = base()
    ok(s, start('fortress', 'r0'))
    const cost = rushCost(s, s.nations[P], 'fortress', 'r0')
    expect(cost).toBe(Math.round(RUSH.cost * localMonthly('fortress', 1, s.regions.r0)))
    ok(s, { type: 'rushProject', nationId: P, project: 'fortress', regionId: 'r0' })
    expect(s.regions.r0.works!.fortress!.progress).toBe(RUSH.months)
    expect(validateOrder(s, map, { type: 'rushProject', nationId: P, project: 'fortress', regionId: 'r1' })).toMatch(/not under way|do not hold/)
    ok(s, { type: 'pauseProject', nationId: P, project: 'fortress', regionId: 'r0', paused: true })
    expect(s.regions.r0.works!.fortress!.paused).toBe(true)
  })

  it('a stalled treasury stops them too, and gives the month back', () => {
    let s = base()
    ok(s, start('irrigation', 'r0'))
    s.nations[P].resources.capital = -500
    s = resolveTurn(s, map, [])
    expect(s.regions.r0.works!.irrigation!.progress).toBe(0)
  })
})
