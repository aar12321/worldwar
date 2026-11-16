import { describe, expect, it } from 'vitest'
import { manageSpace } from '../../ai/space'
import { COMPANIES, DOMESTIC, MINES, MISSIONS, MISSION_IDS, NODES, NODE_IDS, PAD, ROCKETS, SPACE, type BodyId, type MineId, type MissionId, type NodeId, type SpaceAction } from '../../data/space'
import { advise } from '../advisor'
import { daysInMonth } from '../calendar'
import { computeEconomy } from '../economy'
import { advanceDay, startLive } from '../live'
import { applyOrderNow, describeOrder, resolveTurn } from '../resolveTurn'
import { validateOrder, orderCost } from '../orders'
import { companiesFor, freeEngineers, industryNow, newSpace, oddsFor, padSlots, quote, spaceProblem, talentCap } from '../space'
import { discoveryBonus, spaceBill, spaceEffects, spaceYield } from '../spaceEffects'
import type { GameState, Order } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(8)

/** A one-nation test world with the technology the program needs and plenty of money, research and influence. */
function world(seed = 4): GameState {
  const s = startState(map, 'r0', seed)
  const n = s.nations.r0
  n.techs.push('air_propeller', 'air_jets')
  n.resources.capital = 20000
  n.resources.tp = 2000
  n.resources.pp = 200
  n.resources.steel = 500
  // A country big enough that its people can spare a few dozen specialists.
  s.regions.r0.population = 400
  return s
}

const order = (a: SpaceAction): Order => ({ type: 'space', nationId: 'r0', action: a })
function go(s: GameState, a: SpaceAction): string | null {
  return applyOrderNow(s, map, order(a)).error
}
function must(s: GameState, a: SpaceAction) {
  const err = go(s, a)
  if (err) throw new Error(`${JSON.stringify(a)}: ${err}`)
}
function months(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = resolveTurn(s, map, [])
  return s
}
const sp = (s: GameState) => s.nations.r0.space!

/** Gives the agency everything an in-house flight of this kind needs, skipping the years it takes to earn it. */
function equip(s: GameState, kind: MissionId, extra: Partial<ReturnType<typeof newSpace>> = {}) {
  const n = s.nations.r0
  const spec = MISSIONS[kind]
  s.space ??= { claims: {}, launches: 0 }
  const a = (n.space ??= newSpace())
  a.engineers = 40
  a.astronauts = 6
  a.exp = 900
  a.pads = 3
  for (const r of Object.keys(ROCKETS)) a.rockets[r as keyof typeof ROCKETS] = 1
  a.hangar[spec.rocket] = 1
  for (const r of spec.requires) a.done[r] = 1
  Object.assign(a, extra)
  return a
}

describe('the space program: a nation that never uses it is untouched', () => {
  it('has no space state, no budget line and no world record after a year', () => {
    let s = world()
    const before = computeEconomy(s, map, 'r0')
    s = months(s, 12)
    expect(s.nations.r0.space).toBeUndefined()
    expect(s.space).toBeUndefined()
    expect(JSON.stringify(s)).not.toContain('"space"')
    const e = computeEconomy(s, map, 'r0')
    expect(e.lines.some((l) => l.label.startsWith('Space'))).toBe(false)
    expect(e.space.bill.total).toBe(0)
    expect(before.coverage.engineers).toBeGreaterThan(0)
  })

  it('an old save with no space fields plays on', () => {
    const s = JSON.parse(JSON.stringify(world()))
    delete s.space
    for (const n of Object.values(s.nations) as { space?: unknown }[]) delete n.space
    const t = months(s as GameState, 3)
    expect(t.turn).toBe(s.turn + 3)
    expect(t.nations.r0.space).toBeUndefined()
  })

  it('is locked until the nation knows Fifth-Generation Fighters', () => {
    const s = world()
    s.nations.r0.techs = []
    expect(go(s, { kind: 'hire', role: 'engineer', count: 2 })).toMatch(/Fifth-Generation/)
    expect(s.nations.r0.space).toBeUndefined()
  })
})

describe('talent: engineers and astronauts come out of the people', () => {
  it('hiring is capped by the specialists the people can spare, and costs money up front and every month', () => {
    const s = world()
    const e = computeEconomy(s, map, 'r0')
    const cap = talentCap(s.nations.r0, e.workforce)
    expect(cap).toBeGreaterThanOrEqual(2)
    expect(go(s, { kind: 'hire', role: 'engineer', count: cap + 1 })).toMatch(/can spare/)
    const money = s.nations.r0.resources.capital
    must(s, { kind: 'hire', role: 'engineer', count: 4 })
    expect(s.nations.r0.resources.capital).toBeCloseTo(money - 4 * SPACE.hireEngineer, 6)
    const bill = spaceBill(sp(s))
    expect(bill.staff).toBeCloseTo(4 * SPACE.salaryEngineer, 6)
    // The monthly bill is a real line of the budget.
    const line = computeEconomy(s, map, 'r0').lines.find((l) => l.label === 'Space program')
    expect(line?.amount).toBeCloseTo(-bill.total, 6)
  })

  it('a bigger agency takes engineers from the factories, and a better schooled nation can spare more', () => {
    const s = world()
    const base = computeEconomy(s, map, 'r0').coverage.engineers
    const cap = talentCap(s.nations.r0, computeEconomy(s, map, 'r0').workforce)
    must(s, { kind: 'hire', role: 'engineer', count: cap })
    const after = computeEconomy(s, map, 'r0').coverage.engineers
    expect(after).toBeLessThan(base)
    const rich = world()
    rich.nations.r0.people.skills = { ...rich.nations.r0.people.skills, engineers: rich.nations.r0.people.skills.engineers * 3 }
    expect(talentCap(rich.nations.r0, computeEconomy(rich, map, 'r0').workforce)).toBeGreaterThan(cap)
  })

  it('staff on a flight cannot be dismissed, and a crewed flight needs astronauts that are free', () => {
    const s = world()
    equip(s, 'crew_orbit', { engineers: 12, astronauts: 2 })
    must(s, { kind: 'launch', mission: 'crew_orbit', mode: 'house' })
    expect(freeEngineers(sp(s))).toBe(12 - MISSIONS.crew_orbit.engineers)
    expect(go(s, { kind: 'dismiss', role: 'astronaut', count: 1 })).toMatch(/not on a flight/)
    expect(go(s, { kind: 'dismiss', role: 'engineer', count: 12 })).toMatch(/not on a flight/)
    must(s, { kind: 'dismiss', role: 'engineer', count: 2 })
  })
})

describe('rockets: develop once, then build every one that flies', () => {
  it('each class needs the one before it, enough engineers and a launch site', () => {
    const s = world()
    must(s, { kind: 'hire', role: 'engineer', count: 8 })
    expect(go(s, { kind: 'develop', rocket: 'orbital' })).toMatch(/sounding rocket first/)
    expect(go(s, { kind: 'build', rocket: 'sounding' })).toMatch(/Develop the sounding/)
    must(s, { kind: 'develop', rocket: 'sounding' })
    expect(go(s, { kind: 'develop', rocket: 'sounding' })).toMatch(/already developing/)
    let t = months(s, ROCKETS.sounding.devMonths + 1)
    expect(sp(t).rockets.sounding).toBe(1)
    expect(go(t, { kind: 'build', rocket: 'sounding' })).toMatch(/launch site of level 1|no free place/)
    must(t, { kind: 'pad' })
    t = months(t, PAD.months[1] + 1)
    expect(sp(t).pads).toBe(1)
    const steel = t.nations.r0.resources.steel
    must(t, { kind: 'build', rocket: 'sounding' })
    expect(t.nations.r0.resources.steel).toBe(steel - ROCKETS.sounding.steel)
    t = months(t, 2)
    expect(sp(t).hangar.sounding).toBe(1)
  })

  it('a heavy rocket needs more engineers than a small team has, and the biggest pad needs the national launch complex', () => {
    const s = world()
    equip(s, 'lunar_probe', { engineers: 5, pads: 2 })
    delete sp(s).rockets.heavy
    expect(go(s, { kind: 'develop', rocket: 'heavy' })).toMatch(/Needs 12 engineers/)
    expect(go(s, { kind: 'pad' })).toMatch(/launch complex/)
    s.nations.r0.projects.spaceComplex = { progress: 0, done: true }
    sp(s).engineers = 20
    expect(go(s, { kind: 'pad' })).toBeNull()
  })

  it('a rocket that is developed to a higher level launches more reliably', () => {
    const s = world()
    equip(s, 'sounding_test', { exp: 0, pads: 1 })
    const spec = MISSIONS.sounding_test
    const lo = oddsFor(s, s.nations.r0, spec, 'house', undefined, 'sounding').launch
    sp(s).rockets.sounding = 3
    const hi = oddsFor(s, s.nations.r0, spec, 'house', undefined, 'sounding').launch
    expect(hi).toBeCloseTo(lo + 0.08, 6)
  })
})

describe('the launch complex project and the Orbital Network are part of the program, not copies of it', () => {
  it('the national space launch complex adds a place on the pad, makes rockets 10% cheaper and opens the biggest pad', () => {
    const s = world()
    equip(s, 'sounding_test', { pads: 1 })
    const n = s.nations.r0
    const places = padSlots(n)
    const price = quote(s, n, 'sat_comms', 'house').rocketCost
    n.projects.spaceComplex = { progress: 0, done: true }
    expect(padSlots(n)).toBe(places + 1)
    expect(quote(s, n, 'sat_comms', 'house').rocketCost).toBeCloseTo(price * 0.9, 6)
    // The project still does what it always did for the Orbital Network.
    n.techs.push('frontier_space')
    expect(orderCost(s, { type: 'fundSystem', nationId: 'r0', system: 'orbital' }).capital).toBeLessThan(200)
  })

  it('a full launch site leaves no place for another flight until one finishes', () => {
    const s = world()
    equip(s, 'sat_comms', { pads: 1 })
    sp(s).hangar.orbital = 3
    must(s, { kind: 'launch', mission: 'sat_comms', mode: 'house' })
    expect(go(s, { kind: 'launch', mission: 'sat_weather', mode: 'house' })).toMatch(/no free place/)
    expect(go(s, { kind: 'build', rocket: 'orbital' })).toMatch(/no free place/)
  })
})

describe('missions: phases, rolls and rewards', () => {
  it('a sounding rocket flies in two months and teaches the agency', () => {
    let s = world()
    equip(s, 'sounding_test', { exp: 0 })
    must(s, { kind: 'launch', mission: 'sounding_test', mode: 'house' })
    expect(sp(s).hangar.sounding ?? 0).toBe(0)
    expect(sp(s).missions[0].phase).toBe('build')
    s = months(s, 1)
    expect(sp(s).missions[0].phase).toBe('launch')
    s = months(s, 1)
    if (sp(s).done.sounding_test) expect(sp(s).exp).toBe(MISSIONS.sounding_test.gain)
    else expect(sp(s).exp).toBe(Math.round(MISSIONS.sounding_test.gain * SPACE.failExp))
    expect(sp(s).missions).toHaveLength(0)
  })

  it('long missions pass through build, launch, transit and arrival, and take as many months as the table says', () => {
    let s = world()
    equip(s, 'lunar_probe')
    must(s, { kind: 'launch', mission: 'lunar_probe', mode: 'house' })
    const seen: string[] = []
    let n = 0
    while (sp(s).missions.length && n < 40) {
      seen.push(sp(s).missions[0].phase)
      s = months(s, 1)
      n++
    }
    // Either it flew all the way, or it failed on the pad or on arrival: the phases it went through are always in order.
    const order = ['build', 'launch', 'transit', 'arrival']
    const idx = seen.map((p) => order.indexOf(p))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(new Set(seen).has('build')).toBe(true)
    const [b, l, t, a] = MISSIONS.lunar_probe.months
    if (sp(s).done.lunar_probe) expect(n).toBe(b + l + t + a)
    else expect(n).toBeLessThanOrEqual(b + l + t + a)
  })

  it('the same seed gives the same flight, and different seeds give different ones', () => {
    const outcome = (seed: number) => {
      let s = world(seed)
      equip(s, 'mars_lander')
      must(s, { kind: 'launch', mission: 'mars_lander', mode: 'house' })
      s = months(s, 40)
      return JSON.stringify([sp(s).done, sp(s).failures, sp(s).events.map((e) => e.text)])
    }
    expect(outcome(7)).toBe(outcome(7))
    const all = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) all.add(outcome(seed))
    expect(all.size).toBeGreaterThan(1)
  }, 60_000)

  it('failures lose the rocket and payload, cost standing, and a crewed failure kills astronauts', () => {
    // Find seeds that fail at the launch pad and on arrival, among many.
    let launchFail: GameState | null = null
    let arriveFail: GameState | null = null
    for (let seed = 1; seed <= 200 && (!launchFail || !arriveFail); seed++) {
      let s = world(seed)
      equip(s, 'lunar_landing', { prestige: 50 })
      must(s, { kind: 'launch', mission: 'lunar_landing', mode: 'house' })
      const events0 = sp(s).events.length
      s = months(s, 22)
      const text = sp(s).events.slice(0, sp(s).events.length - events0).map((e) => e.text).join(' ')
      if (sp(s).done.lunar_landing) continue
      if (/on the launch pad/.test(text)) launchFail ??= s
      else if (/on arrival/.test(text)) arriveFail ??= s
    }
    expect(launchFail).not.toBeNull()
    expect(arriveFail).not.toBeNull()
    for (const f of [launchFail!, arriveFail!]) {
      expect(sp(f).failures).toBe(1)
      expect(sp(f).prestige).toBeLessThan(50)
      expect(sp(f).hangar.heavy ?? 0).toBe(0)
      expect(sp(f).astronauts).toBeLessThan(6)
      expect(sp(f).exp).toBeGreaterThan(900)
      expect(sp(f).bodies.moon?.landed).toBeUndefined()
    }
    // The dead are mourned: against the same country that flew nothing, stability is lower.
    const calm = months(world(), 22)
    expect(launchFail!.nations.r0.stability).toBeLessThan(calm.nations.r0.stability)
    expect(arriveFail!.nations.r0.stability).toBeLessThan(calm.nations.r0.stability)
    // A whole crew is lost on arrival; half the crew on the pad.
    expect(sp(arriveFail!).astronauts).toBe(6 - MISSIONS.lunar_landing.crew)
    expect(sp(launchFail!).astronauts).toBe(6 - Math.ceil(MISSIONS.lunar_landing.crew * SPACE.launchCrewLoss))
  })

  it('missions are gated by what came before and by experience', () => {
    const s = world()
    const a = equip(s, 'lunar_landing')
    expect(go(s, { kind: 'launch', mission: 'lunar_landing', mode: 'house' })).toBeNull()
    const t = world()
    equip(t, 'lunar_landing')
    delete sp(t).done.lunar_probe
    expect(go(t, { kind: 'launch', mission: 'lunar_landing', mode: 'house' })).toMatch(/First fly: Lunar probe/)
    const u = world()
    equip(u, 'lunar_landing', { exp: 30 })
    expect(go(u, { kind: 'launch', mission: 'lunar_landing', mode: 'house' })).toMatch(/Needs 140 experience/)
    // Outsourcing skips the experience, not the ladder.
    expect(a.exp).toBeGreaterThan(0)
    expect(quote(u, u.nations.r0, 'lunar_landing', 'outsource', 'apex', 10).problem).toMatch(/cannot fly a heavy-lift/)
  })

  it('a satellite works for years: trade, research, calm and intelligence on enemies', () => {
    const fly = (kind: 'sat_comms' | 'sat_weather' | 'sat_recon') => {
      for (let seed = 1; seed <= 40; seed++) {
        let s = world(seed)
        if (kind === 'sat_recon') s.wars.push('r0|r1')
        equip(s, kind)
        must(s, { kind: 'launch', mission: kind, mode: 'house' })
        s = months(s, MISSIONS[kind].months.reduce((a, b) => a + b, 0) + 1)
        if (sp(s).done[kind]) return s
      }
      throw new Error('no seed flew')
    }
    const base = computeEconomy(world(), map, 'r0')
    const comms = fly('sat_comms')
    expect(sp(comms).sats.some((x) => x.kind === 'comms')).toBe(true)
    expect(computeEconomy(comms, map, 'r0').tradeCapacity).toBeGreaterThan(base.tradeCapacity)
    // It wears out.
    expect(sp(months(comms, SPACE.satLife + 2)).sats).toHaveLength(0)
    // A weather satellite calms the country; a reconnaissance satellite sees an enemy at war.
    const weather = fly('sat_weather')
    expect(spaceEffects(weather.nations.r0).policy.stability ?? 0).toBeGreaterThan(spaceEffects(comms.nations.r0).policy.stability ?? 0)
    const recon = months(fly('sat_recon'), 1)
    expect(recon.intel['r0|r1'] ?? 0).toBeGreaterThanOrEqual(recon.turn)
  })

  it('a level of Orbital Network makes satellites work harder and launch safer', () => {
    const s = world()
    equip(s, 'sat_comms', { exp: 0 })
    sp(s).sats.push({ kind: 'comms', until: 999 })
    const plain = spaceEffects(s.nations.r0).policy.trade ?? 0
    const o0 = oddsFor(s, s.nations.r0, MISSIONS.sat_comms, 'house', undefined, 'orbital').arrival
    s.nations.r0.systems.orbital = 2
    expect(spaceEffects(s.nations.r0).policy.trade ?? 0).toBeCloseTo(plain * 1.5, 6)
    expect(oddsFor(s, s.nations.r0, MISSIONS.sat_comms, 'house', undefined, 'orbital').arrival).toBeCloseTo(o0 + 0.04, 6)
  })

  it('landing on a world unlocks the claim, and only the first claim stands', () => {
    const s = world()
    equip(s, 'outpost_moon')
    expect(go(s, { kind: 'claim', body: 'moon' })).toMatch(/Land on The Moon first/)
    sp(s).bodies.moon = { surveyed: true, landed: true }
    must(s, { kind: 'claim', body: 'moon' })
    expect(s.space!.claims.moon?.owner).toBe('r0')
    expect(go(s, { kind: 'claim', body: 'moon' })).toBe('Already yours')
    // A rival who landed too is too late.
    const rival = s.nations.r1
    rival.techs.push('air_propeller', 'air_jets')
    ;(rival.space = newSpace()).bodies.moon = { landed: true, surveyed: true }
    expect(spaceProblem(s, rival, { kind: 'claim', body: 'moon' }, 10)).toMatch(/claimed it first/)
    // And only the holder can build there.
    expect(go(s, { kind: 'launch', mission: 'outpost_moon', mode: 'house' })).toBeNull()
  })
})

describe('a treasury in the red stops the work, not the pay', () => {
  it('rockets, development and in-house payloads wait for money, and the month costs nothing extra', () => {
    let s = world()
    equip(s, 'sat_comms', { exp: 50 })
    must(s, { kind: 'launch', mission: 'sat_comms', mode: 'house' })
    must(s, { kind: 'develop', rocket: 'orbital' })
    const before = JSON.stringify([sp(s).missions, sp(s).dev])
    s.nations.r0.resources.capital = -4000
    s = months(s, 3)
    expect(JSON.stringify([sp(s).missions, sp(s).dev])).toBe(before)
    // Pay for it again and the work resumes.
    s.nations.r0.resources.capital = 4000
    s = months(s, 1)
    expect(JSON.stringify([sp(s).missions, sp(s).dev])).not.toBe(before)
  })
})

describe('in-house against a private company', () => {
  it('a company costs a premium over what the flight costs in-house, builds no experience, and is faster to build', () => {
    const s = world()
    equip(s, 'sat_comms', { exp: 50 })
    const house = quote(s, s.nations.r0, 'sat_comms', 'house')
    const out = quote(s, s.nations.r0, 'sat_comms', 'outsource', 'apex')
    expect(out.problem).toBeNull()
    expect(house.problem).toBeNull()
    const inhouse = house.payload + house.rocketCost
    expect(out.price).toBeGreaterThan(inhouse * 1.5)
    expect(out.months[0]).toBeLessThan(house.months[0])
    const exp = sp(s).exp
    const money = s.nations.r0.resources.capital
    must(s, { kind: 'launch', mission: 'sat_comms', mode: 'outsource', company: 'apex' })
    expect(s.nations.r0.resources.capital).toBeCloseTo(money - out.price, 6)
    expect(sp(s).hangar.orbital).toBe(1)
    const t = months(s, 12)
    expect(sp(t).exp).toBe(exp)
  })

  it('a company can fly a mission for a nation with no agency at all, once it has flown the first test', () => {
    const s = world()
    must(s, { kind: 'launch', mission: 'sounding_test', mode: 'outsource', company: 'meridian' })
    const t = months(s, 3)
    expect(sp(t).missions).toHaveLength(0)
    expect(sp(t).exp).toBe(0)
  })

  it('in-house flying overtakes the companies as experience, pads and discoveries accumulate', () => {
    const s = world()
    equip(s, 'lunar_landing', { exp: 0 })
    const spec = MISSIONS.lunar_landing
    const co = companiesFor(s, s.nations.r0).find((c) => c.id === 'titan')!
    const outsourced = oddsFor(s, s.nations.r0, spec, 'outsource', 'titan', 'heavy')
    const green = oddsFor(s, s.nations.r0, spec, 'house', undefined, 'heavy')
    expect(green.total).toBeLessThan(outsourced.total + 0.05)
    expect(co.reliability).toBeGreaterThan(0.8)
    sp(s).exp = 800
    sp(s).rockets.heavy = 3
    sp(s).discoveries = ['avionics', 'deep_comms', 'methalox', 'life_support', 'closed_loop']
    const vet = oddsFor(s, s.nations.r0, spec, 'house', undefined, 'heavy')
    expect(vet.total).toBeGreaterThan(outsourced.total)
  })

  it('companies get better and cheaper as the world flies more rockets', () => {
    const s = world()
    const early = companiesFor(s, s.nations.r0).find((c) => c.id === 'apex')!
    s.turn = 200
    s.space = { claims: {}, launches: 80 }
    const late = companiesFor(s, s.nations.r0).find((c) => c.id === 'apex')!
    expect(late.reliability).toBeGreaterThan(early.reliability)
    expect(late.price).toBeLessThan(early.price)
    expect(late.ceiling).toBeGreaterThan(early.ceiling)
    expect(industryNow(s)).toBeGreaterThan(100)
    // A deep-space company does not exist at first.
    expect(companiesFor(world(), world().nations.r0).find((c) => c.id === 'helios')!.open).toBe(false)
    expect(Object.keys(COMPANIES).length).toBeGreaterThanOrEqual(4)
  })

  it('money paid to a company feeds the technology sector at home, more so for a firm of your own', () => {
    const s = world()
    expect(companiesFor(s, s.nations.r0).some((c) => c.domestic)).toBe(false)
    s.nations.r0.sectors.technology = 3
    expect(companiesFor(s, s.nations.r0).some((c) => c.domestic)).toBe(true)
    equip(s, 'sat_comms')
    const before = s.nations.r0.sectors.technology
    must(s, { kind: 'launch', mission: 'sat_comms', mode: 'outsource', company: DOMESTIC.id })
    expect(s.nations.r0.sectors.technology).toBeGreaterThan(before)
  })

  it('order plumbing: cost, validation and the order list all know the new orders', () => {
    const s = world()
    equip(s, 'sat_comms')
    const o = order({ kind: 'launch', mission: 'sat_comms', mode: 'outsource', company: 'apex' })
    expect(orderCost(s, o).capital).toBe(quote(s, s.nations.r0, 'sat_comms', 'outsource', 'apex').price)
    expect(orderCost(s, order({ kind: 'research', node: 'reusable' })).tp).toBe(NODES.reusable.tp)
    expect(orderCost(s, order({ kind: 'claim', body: 'moon' })).pp).toBe(SPACE.claimCost)
    expect(orderCost(s, order({ kind: 'build', rocket: 'heavy' })).steel).toBe(ROCKETS.heavy.steel)
    expect(validateOrder(s, map, o)).toBeNull()
    expect(describeOrder(s, map, o)).toMatch(/Hire a company to fly the communications satellite/)
    s.nations.r0.resources.capital = 5
    expect(validateOrder(s, map, o)).toMatch(/Not enough money/)
  })
})

describe('samples, labs and discoveries', () => {
  it('a discovery needs a lab bench, its samples, research and prerequisites, and uses them up', () => {
    let s = world()
    equip(s, 'sounding_test')
    expect(go(s, { kind: 'research', node: 'isru' })).toMatch(/Build the labs first/)
    must(s, { kind: 'lab' })
    s = months(s, 7)
    expect(sp(s).labs).toBe(1)
    expect(go(s, { kind: 'research', node: 'isru' })).toMatch(/Needs 2 lunar regolith/)
    expect(go(s, { kind: 'research', node: 'methalox' })).toMatch(/Needs labs of level 2|First discover/)
    sp(s).samples.regolith = 3
    const tp = s.nations.r0.resources.tp
    must(s, { kind: 'research', node: 'isru' })
    expect(sp(s).samples.regolith).toBe(1)
    expect(s.nations.r0.resources.tp).toBe(tp - NODES.isru.tp)
    // One bench, one discovery at a time.
    expect(go(s, { kind: 'research', node: 'avionics' })).toMatch(/can work on 1 at a time/)
    s = months(s, Math.ceil(NODES.isru.months / 1.0) + 1)
    expect(sp(s).discoveries).toContain('isru')
    expect(go(s, { kind: 'research', node: 'isru' })).toMatch(/Already discovered/)
  })

  it('every discovery is reachable: prerequisites are real and acyclic, and the effect says what it does', () => {
    for (const id of NODE_IDS) {
      const spec = NODES[id]
      expect(spec.says.length).toBeGreaterThan(10)
      for (const r of spec.requires) expect(NODES[r]).toBeDefined()
      expect(Object.keys(spec.effect).length).toBeGreaterThan(0)
    }
    // Walk the graph: each node's prerequisites come from lower in the order of discovery.
    const done = new Set<NodeId>()
    let progress = true
    while (progress) {
      progress = false
      for (const id of NODE_IDS) {
        if (done.has(id) || !NODES[id].requires.every((r) => done.has(r))) continue
        done.add(id)
        progress = true
      }
    }
    expect(done.size).toBe(NODE_IDS.length)
    // Every sample kind is needed somewhere, so every kind of mission feeds the labs.
    const kinds = new Set(NODE_IDS.flatMap((id) => Object.keys(NODES[id].samples ?? {})))
    expect(kinds.size).toBe(5)
  })

  it('discoveries change the economy and the program: cheaper rockets, safer launches, output, health, a new technology', () => {
    const s = world()
    equip(s, 'lunar_probe')
    const e0 = computeEconomy(s, map, 'r0')
    const cost0 = quote(s, s.nations.r0, 'lunar_probe', 'house').rocketCost
    const odds0 = oddsFor(s, s.nations.r0, MISSIONS.lunar_probe, 'house', undefined, 'heavy').launch
    sp(s).discoveries = ['reusable', 'methalox', 'avionics', 'composites', 'microgravity', 'exotic_matter']
    expect(quote(s, s.nations.r0, 'lunar_probe', 'house').rocketCost).toBeLessThan(cost0 * 0.85)
    expect(oddsFor(s, s.nations.r0, MISSIONS.lunar_probe, 'house', undefined, 'heavy').launch).toBeCloseTo(odds0 + 0.05, 6)
    const e1 = computeEconomy(s, map, 'r0')
    expect(e1.factoryIncome).toBeGreaterThan(e0.factoryIncome)
    expect(spaceEffects(s.nations.r0).health).toBeCloseTo(0.025, 6)
    expect(discoveryBonus(sp(s)).output).toBeCloseTo(0.035, 6)
  })

  it('a discovery can teach a new technology the nation did not have', () => {
    let s = world()
    equip(s, 'sounding_test')
    sp(s).labs = 3
    sp(s).discoveries = ['composites', 'quantum_comms', 'life_support', 'microgravity', 'avionics', 'deep_comms']
    sp(s).samples.exotica = 4
    expect(s.nations.r0.techs).not.toContain('frontier_nano')
    must(s, { kind: 'research', node: 'exotic_matter' })
    s = months(s, Math.ceil(NODES.exotic_matter.months / 1.4) + 1)
    expect(s.nations.r0.techs).toContain('frontier_nano')
  })

  it('missions bring home the samples their table promises', () => {
    let found = false
    for (let seed = 1; seed <= 30 && !found; seed++) {
      let s = world(seed)
      equip(s, 'mars_lander')
      must(s, { kind: 'launch', mission: 'mars_lander', mode: 'house' })
      s = months(s, 30)
      if (sp(s).done.mars_lander) {
        expect(sp(s).samples.martian).toBe(4)
        expect(sp(s).samples.ice).toBe(2)
        expect(sp(s).bodies.mars?.landed).toBe(true)
        found = true
      }
    }
    expect(found).toBe(true)
  })
})

describe('outposts and mining: a long investment', () => {
  const claimed = (body: BodyId, discoveries: NodeId[] = ['isru']) => {
    const s = world()
    const a = equip(s, 'sounding_test')
    // Only the outpost: no staff, no launch site, no rockets, so the comparison is the mine and its outpost alone.
    Object.assign(a, { engineers: 0, astronauts: 0, pads: 0, hangar: {}, rockets: {}, exp: 900 })
    a.discoveries = [...discoveries]
    s.space!.claims[body] = { owner: 'r0', turn: 0 }
    a.bodies[body] = { surveyed: true, landed: true, outpost: { level: 1, mines: {}, unsupplied: 0 } }
    return s
  }

  it('a mine needs the outpost, the discovery, experience and a free place, and takes years to build', () => {
    let s = claimed('asteroids', [])
    expect(go(s, { kind: 'mine', body: 'asteroids', mine: 'metals' })).toMatch(/resource use/)
    sp(s).discoveries = ['isru']
    sp(s).exp = 10
    expect(go(s, { kind: 'mine', body: 'asteroids', mine: 'metals' })).toMatch(/Needs 140 experience/)
    sp(s).exp = 900
    expect(go(s, { kind: 'mine', body: 'asteroids', mine: 'water' })).toMatch(/has none of that/)
    must(s, { kind: 'mine', body: 'asteroids', mine: 'metals' })
    expect(go(s, { kind: 'mine', body: 'asteroids', mine: 'rareMetals' })).toMatch(/can run 1 mine/)
    s = months(s, MINES.metals.months - 2)
    expect(spaceYield(sp(s)).steel).toBe(0)
    s = months(s, 4)
    expect(sp(s).bodies.asteroids!.outpost!.mines.metals!.level).toBe(1)
    expect(spaceYield(sp(s)).steel).toBeGreaterThan(5)
  })

  it('mined steel, oil and money flow into the national economy and show on the budget', () => {
    const s = claimed('asteroids')
    sp(s).bodies.asteroids!.outpost!.mines.metals = { level: 1 }
    sp(s).bodies.asteroids!.outpost!.mines.rareMetals = { level: 1 }
    sp(s).bodies.asteroids!.outpost!.level = 2
    const none = claimed('asteroids')
    const e = computeEconomy(s, map, 'r0')
    const f = computeEconomy(none, map, 'r0')
    expect(e.steelProduction).toBeGreaterThan(f.steelProduction + 5)
    expect(e.space.income).toBeGreaterThan(5)
    expect(e.lines.find((l) => l.label === 'Space mining')?.amount).toBeCloseTo(e.space.income, 6)
    // The steel arrives.
    const steel = s.nations.r0.resources.steel
    const t = months(s, 1)
    expect(t.nations.r0.resources.steel).toBeGreaterThan(steel + 5)
  })

  it('helium-3 powers the grid, and a fusion plant multiplies it', () => {
    const s = claimed('moon')
    const op = sp(s).bodies.moon!.outpost!
    op.level = 2
    op.mines.helium3 = { level: 2 }
    const without = spaceEffects(s.nations.r0)
    expect(without.power).toBeGreaterThan(5)
    expect(without.policy.output ?? 0).toBeLessThan(0.001)
    s.nations.r0.projects.fusion = { progress: 0, done: true }
    const withPlant = spaceEffects(s.nations.r0)
    expect(withPlant.policy.output ?? 0).toBeGreaterThan(0.008)
    expect(withPlant.policy.factory ?? 0).toBeGreaterThan(0.01)
  })

  it('an outpost the treasury cannot supply goes quiet, then shrinks', () => {
    let s = claimed('mars')
    const op = sp(s).bodies.mars!.outpost!
    op.level = 2
    op.mines.metals = { level: 1 }
    s.nations.r0.resources.capital = -5000
    s = months(s, 1)
    expect(sp(s).bodies.mars!.outpost!.unsupplied).toBeGreaterThan(0)
    expect(spaceYield(sp(s)).steel).toBe(0)
    s.nations.r0.resources.capital = -5000
    s = months(s, SPACE.starveMonths)
    expect(sp(s).bodies.mars!.outpost!.level).toBe(1)
  })

  /** Compares a nation that built the mine with an identical one that never went to space. Returns the month the builder is level. */
  function breakEven(body: BodyId, mine: MineId, discoveries: NodeId[], horizon: number) {
    const value = (s: GameState) => s.nations.r0.resources.capital + (s.nations.r0.resources.steel + s.nations.r0.resources.oil * 1.1) * 1.7
    let a = claimed(body, discoveries)
    let z = world()
    const payload = MISSIONS[`outpost_${body}` as MissionId].payload
    a.nations.r0.resources.capital -= payload
    must(a, { kind: 'mine', body, mine })
    for (let i = 1; i <= horizon; i++) {
      a = resolveTurn(a, map, [])
      z = resolveTurn(z, map, [])
      if (value(a) >= value(z)) return i
    }
    return Infinity
  }

  it('is a long-term investment: mining a metal asteroid pays back the outpost and the mine in about a decade, not in a year', () => {
    const base = breakEven('asteroids', 'metals', ['isru'], 220)
    expect(base).toBeGreaterThan(84)
    expect(base).toBeLessThan(200)
  }, 60_000)

  it('discoveries shorten the payback, but never to a quick profit', () => {
    const base = breakEven('asteroids', 'metals', ['isru'], 220)
    const lab = breakEven('asteroids', 'metals', ['isru', 'asteroid_metallurgy', 'propellant', 'automation', 'life_support', 'closed_loop'], 220)
    expect(lab).toBeLessThan(base)
    expect(lab).toBeGreaterThan(48)
  }, 60_000)
})

describe('the AI runs a space program inside its means', () => {
  /** Drives a nation's program the way the bot does, a few decisions a month. */
  function drive(skill: 1 | 2, months: number, seed = 3) {
    let s = world(seed)
    const n = s.nations.r0
    n.resources.capital = 700
    n.resources.tp = 300
    n.resources.pp = 80
    let low = Infinity
    for (let i = 0; i < months; i++) {
      for (let k = 0; k < 3; k++) {
        const e = computeEconomy(s, map, 'r0')
        manageSpace(s, 'r0', e, skill, (o) => !applyOrderNow(s, map, o).error, s.nations.r0.resources.capital - 100)
      }
      s.nations.r0.resources.tp += 3
      s.nations.r0.resources.pp += 1
      s = resolveTurn(s, map, [])
      low = Math.min(low, s.nations.r0.resources.capital)
    }
    return { s, low }
  }

  it('a Medium rival builds a modest program: satellites, nothing past Earth orbit, and never goes broke', () => {
    const { s, low } = drive(1, 120)
    expect(low).toBeGreaterThan(0)
    const a = sp(s)
    expect(a.engineers).toBeGreaterThan(0)
    expect(a.pads).toBeGreaterThan(0)
    expect(a.done.sounding_test).toBeGreaterThan(0)
    for (const id of MISSION_IDS) if (MISSIONS[id].body) expect(a.done[id] ?? 0).toBe(0)
    expect(computeEconomy(s, map, 'r0').netCapital).toBeGreaterThan(-5)
  }, 120_000)

  it('a Hard rival goes further and still stays solvent, with income never driven into the red by its program', () => {
    const { s, low } = drive(2, 160)
    expect(low).toBeGreaterThan(0)
    expect(Object.keys(sp(s).done).length).toBeGreaterThanOrEqual(3)
    const e = computeEconomy(s, map, 'r0')
    expect(e.space.bill.total).toBeLessThan(e.gross * 0.45)
    expect(e.netCapital).toBeGreaterThan(-10)
  }, 180_000)

  it('a nation without the technology, or in the red, does nothing', () => {
    const s = world()
    s.nations.r0.techs = []
    const e = computeEconomy(s, map, 'r0')
    expect(manageSpace(s, 'r0', e, 2, () => true, 1000)).toBe(0)
    const t = world()
    t.nations.r0.resources.capital = 20
    expect(manageSpace(t, 'r0', computeEconomy(t, map, 'r0'), 2, () => { throw new Error('should not order') }, 1000)).toBe(0)
  })

  it('a rival that lands first claims the world before you can', () => {
    const s = world()
    const rival = s.nations.r1
    rival.techs.push('air_propeller', 'air_jets')
    rival.resources.pp = 100
    ;(rival.space = newSpace()).bodies.moon = { landed: true, surveyed: true }
    rival.space!.engineers = 4
    s.space = { claims: {}, launches: 0 }
    const e = computeEconomy(s, map, 'r1')
    rival.resources.capital = 3000
    manageSpace(s, 'r1', e, 2, (o) => !applyOrderNow(s, map, o).error, 2000)
    expect(s.space.claims.moon?.owner).toBe('r1')
    equip(s, 'lunar_landing')
    sp(s).bodies.moon = { landed: true, surveyed: true }
    expect(go(s, { kind: 'claim', body: 'moon' })).toMatch(/claimed it first/)
  })
})

describe('turn and live months are the same month, space included', () => {
  it('a program run for a year in live mode ends where the same program in turns does', () => {
    const base = world()
    equip(base, 'sat_comms', { pads: 1 })
    sp(base).labs = 1
    sp(base).samples.regolith = 3
    const prep = (s: GameState) => {
      for (const a of [{ kind: 'launch', mission: 'sat_comms', mode: 'house' }, { kind: 'research', node: 'isru' }, { kind: 'develop', rocket: 'heavy' }, { kind: 'pad' }] as SpaceAction[]) must(s, a)
      return s
    }
    // The same seeded flights fly in both.
    let turn = prep(structuredClone(base))
    for (let i = 0; i < 12; i++) turn = resolveTurn(turn, map, [])
    let live = prep(startLive(structuredClone(base)))
    const target = live.turn + 12
    while (live.turn < target) {
      const last = (live.day ?? 0) >= daysInMonth(live.turn) - 1
      live = advanceDay(live, map, { monthOrders: last ? [] : undefined }).state
    }
    expect(live.nations.r0.space).toEqual(turn.nations.r0.space)
    expect(live.nations.r0.resources).toEqual(turn.nations.r0.resources)
    expect(live.space).toEqual(turn.space)
  }, 60_000)
})

describe('the advisor and the screen read the same state', () => {
  it('asks for a claim when you have landed, and reminds you of samples waiting', () => {
    const s = world()
    equip(s, 'sounding_test')
    sp(s).labs = 1
    sp(s).samples.regolith = 2
    sp(s).bodies.moon = { landed: true, surveyed: true }
    const ids = advise(s, map, 'r0', [], 40).map((a) => a.id)
    expect(ids).toContain('space-claim-moon')
    expect(ids).toContain('space-samples')
    expect(advise(s, map, 'r0', [], 40).find((a) => a.id === 'space-claim-moon')?.target).toEqual({ desk: 'economy', tab: 'space' })
  })

  it('every mission and body in the tables is internally consistent', () => {
    for (const id of MISSION_IDS) {
      const m = MISSIONS[id]
      expect(ROCKETS[m.rocket]).toBeDefined()
      for (const r of m.requires) expect(MISSIONS[r]).toBeDefined()
      expect(m.months[0]).toBeGreaterThan(0)
      expect(m.arrival).toBeGreaterThan(0.4)
      if (m.stage === 'outpost') expect(id).toBe(`outpost_${m.body}`)
    }
    // Harder missions never need less experience than what they require.
    for (const id of MISSION_IDS) for (const r of MISSIONS[id].requires) expect(MISSIONS[id].exp).toBeGreaterThanOrEqual(MISSIONS[r].exp)
  })
})
