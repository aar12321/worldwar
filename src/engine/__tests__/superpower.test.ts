import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { addOpinion, opinionOf, storedOpinion } from '../../ai/opinion'
import { evaluateProposal } from '../../ai/diplomat'
import { COALITION, THREAT } from '../../data/coalition'
import { NUCLEAR, falloutFactor } from '../../data/nuclear'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { blocsOf } from '../blocs'
import { absDay, daysInMonth } from '../calendar'
import { activePlans, jointTarget, leadersOf, pressureOf, threatOf, worldReaction } from '../coalition'
import { worldTension } from '../crises'
import { integrationFactor } from '../economy'
import { atWar, enemiesOf, pairKey } from '../helpers'
import { advanceDay, startLive } from '../live'
import { aiNuclearOrder, buildWarheadProblem, detonate, leadingFactions, nukeProblem, nukeThrough, runNuclear, warheadsOf } from '../nuclear'
import { isMonthEndOrder, orderCost, validateOrder } from '../orders'
import { applyOrderNow, resolveTurn, runMonth } from '../resolveTurn'
import { createRng } from '../rng'
import type { GameState, NationId, Order, Tier } from '../types'
import { updateTiers } from '../empire'
import { advise } from '../advisor'
import { normalizeGame } from '../migrate'
import { confirmFor } from '../../ui/confirmRules'
import { lineMap, setMilitary, startState } from './fixtures'

const line = lineMap(10)

/** A small world where r0 is a Superpower with the technology, a factory and one warhead, at war with r1. */
function nuclearWorld(difficulty: 'easy' | 'normal' | 'hard' = 'normal') {
  const s = startState(line, 'r0', 3)
  s.settings.difficulty = difficulty
  const me = s.nations.r0
  me.tier = 4
  me.techs.push('frontier_hypersonic')
  me.resources.capital = 5000
  me.resources.steel = 500
  me.resources.tp = 500
  me.resources.pp = 500
  s.regions.r0.buildings.factory = 1
  me.nuclear = { warheads: 1, building: [] }
  s.wars.push('r0|r1')
  // r1 is a developed country with an army, a fortress and a shield.
  const r1 = s.regions.r1
  r1.buildings = { factory: 3, farm: 2, university: 2, barracks: 2, port: 0, civic: 1, hospital: 1 }
  r1.population = 40
  r1.line = 6
  setMilitary(s, 'r1', { infantry: 20, armor: 8, artillery: 4 })
  return s
}

describe('nuclear weapons: who may build and fire them', () => {
  it('need a Superpower, the technology, a factory and a warhead', () => {
    const s = nuclearWorld()
    const fire: Order = { type: 'nuke', nationId: 'r0', target: 'r1' }
    expect(validateOrder(s, line, fire)).toBeNull()
    s.nations.r0.tier = 3 as Tier
    expect(validateOrder(s, line, fire)).toMatch(/Needs a Superpower/)
    expect(validateOrder(s, line, { type: 'buildWarhead', nationId: 'r0' })).toMatch(/Needs a Superpower/)
    s.nations.r0.tier = 4
    s.nations.r0.techs = s.nations.r0.techs.filter((t) => t !== NUCLEAR.tech)
    expect(validateOrder(s, line, fire)).toMatch(/Hypersonic/)
    s.nations.r0.techs.push(NUCLEAR.tech)
    s.nations.r0.nuclear!.warheads = 0
    expect(validateOrder(s, line, fire)).toMatch(/no warhead/)
  })

  it('may only be fired at a country of a nation you are at war with', () => {
    const s = nuclearWorld()
    expect(validateOrder(s, line, { type: 'nuke', nationId: 'r0', target: 'r2' })).toMatch(/at war/)
    expect(validateOrder(s, line, { type: 'nuke', nationId: 'r0', target: 'r0' })).toMatch(/at war/)
    // A puppet is not a target.
    s.nations.r1.overlord = 'r0'
    expect(validateOrder(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' })).toMatch(/puppet/)
  })

  it('wait between launches, and one a time in a month', () => {
    const s = nuclearWorld()
    s.nations.r0.nuclear!.warheads = 3
    expect(nukeProblem(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' }, [{ type: 'nuke', nationId: 'r0', target: 'r1' }])).toMatch(/One warhead/)
    s.nations.r0.nuclear!.last = s.turn - 1
    expect(validateOrder(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' })).toMatch(/launch crews/)
  })

  it('a warhead is built over months with money, steel and research, one at a time, up to a few in store', () => {
    const s = nuclearWorld()
    const n = s.nations.r0
    n.nuclear = undefined
    const order: Order = { type: 'buildWarhead', nationId: 'r0' }
    expect(orderCost(s, order)).toMatchObject({ capital: NUCLEAR.money, steel: NUCLEAR.steel, tp: NUCLEAR.research })
    const before = { ...n.resources }
    expect(applyOrderNow(s, line, order).error).toBeNull()
    expect(n.resources.capital).toBe(before.capital - NUCLEAR.money)
    expect(n.resources.steel).toBe(before.steel - NUCLEAR.steel)
    expect(n.resources.tp).toBe(before.tp - NUCLEAR.research)
    expect(n.nuclear!.building).toEqual([s.turn + NUCLEAR.months])
    expect(validateOrder(s, line, order)).toMatch(/already being built/)
    // It comes off the line after its months, and costs to keep.
    for (let i = 0; i < NUCLEAR.months; i++) {
      expect(warheadsOf(n)).toBe(0)
      s.turn++
      runNuclear(s)
    }
    expect(warheadsOf(n)).toBe(1)
    const money = n.resources.capital
    runNuclear(s)
    expect(n.resources.capital).toBeCloseTo(money - NUCLEAR.upkeep, 5)
    n.nuclear!.warheads = NUCLEAR.maxStock
    expect(buildWarheadProblem(s, { type: 'buildWarhead', nationId: 'r0' }, [])).toMatch(/arsenal is full/)
  })

  it('takes research too: no research, no warhead', () => {
    const s = nuclearWorld()
    s.nations.r0.resources.tp = NUCLEAR.research - 1
    expect(validateOrder(s, line, { type: 'buildWarhead', nationId: 'r0' })).toMatch(/Not enough research/)
  })

  it('waits for the month end in a turn game and flies at once in a live game', () => {
    const s = nuclearWorld()
    expect(isMonthEndOrder(s, 'nuke')).toBe(true)
    expect(isMonthEndOrder(s, 'buildWarhead')).toBe(false)
    const live = startLive(structuredClone(s))
    expect(isMonthEndOrder(live, 'nuke')).toBe(false)
  })
})

describe('what a warhead does to the country it hits', () => {
  it('destroys its army and infrastructure and most of its people, and cripples its output for years', () => {
    const s = nuclearWorld()
    const before = s.regions.r1.population
    expect(applyOrderNow(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' }).error).toBeNull()
    const r = s.regions.r1
    // The turn game: it falls at once when applied directly.
    expect(Object.values(r.buildings).every((v) => v === 0)).toBe(true)
    expect(r.population).toBeCloseTo(before * (1 - NUCLEAR.people), 5)
    expect(r.line).toBe(NUCLEAR.lineFloor)
    expect(r.sabotaged).toBeGreaterThanOrEqual(NUCLEAR.factoryMonths)
    expect(r.fallout).toBe(NUCLEAR.falloutMonths)
    expect(r.rebels).toBeGreaterThanOrEqual(NUCLEAR.rebels)
    const army = s.nations.r1.military.units
    expect(army.infantry).toBeCloseTo(20 * (1 - NUCLEAR.armyCore), 5)
    expect(army.armor).toBeCloseTo(8 * (1 - NUCLEAR.armyCore), 5)
    expect(s.nations.r0.nuclear!.warheads).toBe(0)
    expect(s.nations.r0.nuclear!.fired).toBe(1)
    // The ruins produce a tenth of what they did, and heal as the months pass.
    expect(integrationFactor(r)).toBeCloseTo(integrationFactor({ ...r, fallout: undefined }) * NUCLEAR.falloutOutput, 5)
    expect(falloutFactor(NUCLEAR.falloutMonths / 2)).toBeCloseTo(NUCLEAR.falloutOutput + (1 - NUCLEAR.falloutOutput) / 2, 5)
    for (let i = 0; i < NUCLEAR.falloutMonths; i++) runNuclear(s)
    expect(r.fallout).toBeUndefined()
    expect(integrationFactor(r)).toBe(integrationFactor({ ...r, fallout: undefined }))
  })

  it('leaves a country that is part of a large nation its other armies, and hits the capital hardest', () => {
    const s = nuclearWorld()
    for (const id of ['r2', 'r3', 'r4']) s.regions[id].owner = 'r1'
    const r1 = s.nations.r1
    expect(r1.capital).toBe('r1')
    // A part of a bigger nation: only a share of the army stood there.
    const part = structuredClone(s)
    detonate(part, line, createRng(1, 1), 'r0', 'r2')
    expect(part.nations.r1.military.units.infantry).toBeCloseTo(20 * (1 - NUCLEAR.armyPart), 5)
    const cap = structuredClone(s)
    detonate(cap, line, createRng(1, 1), 'r0', 'r1')
    expect(cap.nations.r1.military.units.infantry).toBeCloseTo(20 * (1 - NUCLEAR.armyCore), 5)
  })

  it('is stopped only in part by an Interceptor Shield', () => {
    expect(nukeThrough(0)).toBe(1)
    expect(nukeThrough(3)).toBeCloseTo(1 - 0.5 * NUCLEAR.intercept, 5)
    const s = nuclearWorld()
    s.nations.r1.systems.shield = 3
    const before = s.regions.r1.population
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    const through = nukeThrough(3)
    expect(through).toBeGreaterThan(0.7)
    expect(s.regions.r1.population).toBeCloseTo(before * (1 - NUCLEAR.people * through), 5)
    // A quarter of the buildings still stand, and the line does not quite reach the floor.
    expect(s.regions.r1.buildings.factory).toBe(Math.floor(3 * (1 - through)))
    expect(s.regions.r1.line).toBeGreaterThanOrEqual(NUCLEAR.lineFloor)
    expect(s.nations.r1.military.units.infantry).toBeGreaterThan(20 * (1 - NUCLEAR.armyCore))
  })

  it('leaves the country open to be taken, and the nation can fall to the next attack', () => {
    const s = nuclearWorld()
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    setMilitary(s, 'r0', { infantry: 16, armor: 4 })
    const result = applyOrderNow(s, line, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin', stance: 'assault' })
    expect(result.error).toBeNull()
    expect(result.battle?.captured).toBe(true)
    expect(s.regions.r1.owner).toBe('r0')
    expect(s.nations.r1.alive).toBe(false)
  })
})

describe('what the world does about it', () => {
  it('brands the attacker, turns every nation against it, shakes the world and cuts off trade', () => {
    const s = nuclearWorld()
    const tension = worldTension(s)
    const infamy = s.infamy.r0 ?? 0
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    expect(s.infamy.r0).toBe(Math.min(100, infamy + NUCLEAR.infamy))
    for (const id of ['r2', 'r3', 'r5', 'r9']) {
      expect(opinionOf(s, line, id, 'r0')).toBeLessThanOrEqual(-35)
      expect(s.sanctions.some((x) => x.from === id && x.to === 'r0' && x.until >= s.turn + NUCLEAR.sanctionsMonths)).toBe(true)
    }
    // The victim's grievance is the deepest of all.
    const stored = (id: string) => storedOpinion(s, id, 'r0').reduce((sum, m) => sum + m.value, 0)
    expect(stored('r1')).toBeLessThan(stored('r2'))
    expect(stored('r2')).toBe(NUCLEAR.opinion)
    expect(worldTension(s)).toBeGreaterThanOrEqual(Math.min(100, tension + NUCLEAR.tension - 1))
    expect(s.nukeLast).toBe(s.turn)
    // The tension fades month by month.
    const shock = s.shock!
    runNuclear(s)
    expect(s.shock!).toBeCloseTo(shock * (1 - NUCLEAR.tensionFade), 5)
    for (let i = 0; i < 120; i++) runNuclear(s)
    expect(s.shock).toBeUndefined()
  })

  it('forces the two strongest alliance blocs to declare war on the attacker', () => {
    const s = nuclearWorld()
    // Three blocs: r2+r3 (strong), r4+r5 (middling), r6+r7 (weak). r8 and r9 are alone.
    for (const [a, b] of [['r2', 'r3'], ['r4', 'r5'], ['r6', 'r7']]) s.alliances.push(pairKey(a, b))
    setMilitary(s, 'r2', { infantry: 30 })
    setMilitary(s, 'r3', { infantry: 20 })
    setMilitary(s, 'r4', { infantry: 12 })
    setMilitary(s, 'r5', { infantry: 6 })
    setMilitary(s, 'r6', { infantry: 3 })
    setMilitary(s, 'r7', { infantry: 2 })
    setMilitary(s, 'r8', { infantry: 1 })
    expect(blocsOf(s)[0].members).toEqual(['r2', 'r3'])
    // r1 is the victim and already at war: it does not count.
    expect(leadingFactions(s, 'r0', 2, 'r1')).toEqual([['r2', 'r3'], ['r4', 'r5']])
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    for (const id of ['r2', 'r3', 'r4', 'r5']) expect(atWar(s, id, 'r0')).toBe(true)
    for (const id of ['r6', 'r7', 'r8', 'r9']) expect(atWar(s, id, 'r0')).toBe(false)
  })

  it('does not count the attacker\'s own friends, and falls back on single nations when there are too few blocs', () => {
    const s = nuclearWorld()
    s.alliances.push(pairKey('r0', 'r2'), pairKey('r2', 'r3'))
    setMilitary(s, 'r2', { infantry: 50 })
    for (const id of ['r4', 'r7', 'r8', 'r9']) setMilitary(s, id, { infantry: 1 })
    setMilitary(s, 'r5', { infantry: 9 })
    setMilitary(s, 'r6', { infantry: 7 })
    // The strong bloc is the attacker's own: it is skipped. r5 and r6, alone, are the leading factions.
    expect(leadingFactions(s, 'r0', 2, 'r1')).toEqual([['r5'], ['r6']])
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    expect(atWar(s, 'r5', 'r0') && atWar(s, 'r6', 'r0')).toBe(true)
    expect(atWar(s, 'r2', 'r0')).toBe(false)
  })

  it('respects the war limits of the nations that declare', () => {
    const s = nuclearWorld()
    s.alliances.push(pairKey('r2', 'r3'))
    setMilitary(s, 'r2', { infantry: 30 })
    setMilitary(s, 'r3', { infantry: 20 })
    // r2 already fights as many wars as it may.
    for (const id of ['r5', 'r6', 'r7']) s.wars.push(pairKey('r2', id))
    s.wars.sort()
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    expect(atWar(s, 'r2', 'r0')).toBe(false)
    expect(atWar(s, 'r3', 'r0')).toBe(true)
  })

  it('on Easy only the strongest faction goes to war', () => {
    const s = nuclearWorld('easy')
    s.alliances.push(pairKey('r2', 'r3'), pairKey('r4', 'r5'))
    setMilitary(s, 'r2', { infantry: 30 })
    setMilitary(s, 'r4', { infantry: 12 })
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    expect(atWar(s, 'r2', 'r0') && atWar(s, 'r3', 'r0')).toBe(true)
    expect(atWar(s, 'r4', 'r0') || atWar(s, 'r5', 'r0')).toBe(false)
  })

  it('does not drag another human into the war', () => {
    const s = nuclearWorld()
    s.humans.push('r2')
    s.alliances.push(pairKey('r2', 'r3'))
    setMilitary(s, 'r2', { infantry: 30 })
    setMilitary(s, 'r3', { infantry: 20 })
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    expect(atWar(s, 'r2', 'r0')).toBe(false)
    expect(atWar(s, 'r3', 'r0')).toBe(true)
  })

  it('a month in a turn game fires it, with all of this, when the orders resolve', () => {
    const s = nuclearWorld()
    s.alliances.push(pairKey('r2', 'r3'))
    setMilitary(s, 'r2', { infantry: 30 })
    const next = resolveTurn(s, line, [{ type: 'nuke', nationId: 'r0', target: 'r1' }])
    expect(next.regions.r1.fallout).toBeGreaterThan(0)
    expect(next.log.some((e) => /NUCLEAR STRIKE/.test(e.text))).toBe(true)
    expect(atWar(next, 'r2', 'r0')).toBe(true)
    expect(next.infamy.r0).toBeGreaterThan(50)
  })
})

describe('a nuclear strike in a live game', () => {
  const live = () => startLive(nuclearWorld())
  const days = (s: GameState, n: number) => {
    let cur = s
    const events = []
    for (let i = 0; i < n; i++) {
      const step = advanceDay(cur, line, {})
      cur = step.state
      events.push(...step.events)
    }
    return { cur, events }
  }

  it('flies for days with the whole world able to see it, and lands on its day', () => {
    const s = live()
    expect(applyOrderNow(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' }).error).toBeNull()
    expect(s.nukes).toHaveLength(1)
    const flight = s.nukes![0]
    expect(flight.lands - flight.launched).toBe(NUCLEAR.flightDays)
    expect(s.nations.r0.nuclear!.warheads).toBe(0)
    expect(s.regions.r1.fallout).toBeUndefined()
    expect(s.log.some((e) => /ALERT/.test(e.text))).toBe(true)
    const early = days(s, NUCLEAR.flightDays - 1)
    expect(early.cur.regions.r1.fallout).toBeUndefined()
    expect(early.cur.nukes).toHaveLength(1)
    const landed = days(s, NUCLEAR.flightDays)
    expect(landed.cur.nukes).toHaveLength(0)
    expect(landed.cur.regions.r1.fallout).toBeGreaterThan(0)
    expect(landed.events.some((e) => e.kind === 'nuke' && e.landed)).toBe(true)
  })

  it('is called off when the war ends first', () => {
    const s = live()
    applyOrderNow(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' })
    s.wars = []
    const { cur, events } = days(s, NUCLEAR.flightDays)
    expect(cur.regions.r1.fallout).toBeUndefined()
    expect(cur.infamy.r0 ?? 0).toBe(0)
    expect(events.some((e) => e.kind === 'nuke' && !e.landed && e.why === 'peace')).toBe(true)
  })

  it('is lost with the nation that fired it', () => {
    const s = live()
    applyOrderNow(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' })
    s.nations.r0.alive = false
    const { cur } = days(s, NUCLEAR.flightDays)
    expect(cur.regions.r1.fallout).toBeUndefined()
  })
})

describe('rivals and the bomb', () => {
  /** r2 is a Hard Superpower at war with r1, with a warhead, and r1 is a human. */
  function rivalWorld() {
    const s = nuclearWorld('hard')
    s.playerId = 'r5'
    s.humans = ['r5']
    s.nations.r0.isPlayer = false
    s.nations.r5.isPlayer = true
    s.nations.r0.aggression = 1
    s.wars = ['r0|r1']
    // r0 is a rival in dire straits: its force is a sliver of r1's.
    setMilitary(s, 'r0', { infantry: 1 })
    setMilitary(s, 'r1', { infantry: 20, armor: 8 })
    s.turn = 20
    return s
  }
  /** What the rival's own judgment says about the bomb, over many throws of its dice (the order is also a matter of chance). */
  const bombFor = (s: GameState, id: NationId, kind: 'nuke' | 'buildWarhead') => {
    for (let k = 0; k < 40; k++) {
      const o = aiNuclearOrder(s, line, id, createRng(s.seed, 1000 + k))
      if (o?.type === kind) return true
    }
    return false
  }
  /** The same through the whole planner: the rival's agenda is only one thing it does in a month, so it is tried over many months. */
  const planned = (s: GameState, id: NationId, kind: 'nuke' | 'buildWarhead') => {
    for (let t = 0; t < 80; t++) {
      const c = structuredClone(s)
      c.turn += t
      if (generateBotOrders(c, line, id).some((o) => o.type === kind)) return true
    }
    return false
  }
  const nukeOrders = (s: GameState, id: NationId) => bombFor(s, id, 'nuke')

  it('a desperate Hard rival fires it, and the planner includes the order', () => {
    expect(nukeOrders(rivalWorld(), 'r0')).toBe(true)
    expect(planned(rivalWorld(), 'r0', 'nuke')).toBe(true)
  })

  it('a rival that is not desperate or provoked does not', () => {
    const s = rivalWorld()
    setMilitary(s, 'r0', { infantry: 40, armor: 20 })
    setMilitary(s, 'r1', { infantry: 10 })
    expect(nukeOrders(s, 'r0')).toBe(false)
  })

  it('a provoked rival fires it, though it is not desperate', () => {
    const s = rivalWorld()
    setMilitary(s, 'r0', { infantry: 40, armor: 20 })
    setMilitary(s, 'r1', { infantry: 10 })
    ;(s.nations.r0.struckBy ??= {}).r1 = s.turn - 1
    expect(nukeOrders(s, 'r0')).toBe(true)
  })

  it('Medium and Easy rivals never do, and neither does a rival below Superpower', () => {
    for (const d of ['normal', 'easy'] as const) {
      const s = rivalWorld()
      s.settings.difficulty = d
      expect(nukeOrders(s, 'r0')).toBe(false)
    }
    const s = rivalWorld()
    s.nations.r0.tier = 3
    expect(nukeOrders(s, 'r0')).toBe(false)
  })

  it('never twice in three years, and not while the world is still shaken by the last bomb', () => {
    const s = rivalWorld()
    s.nukeLast = s.turn - 5
    expect(nukeOrders(s, 'r0')).toBe(false)
    const t = rivalWorld()
    t.nations.r0.nuclear!.last = t.turn - 20
    expect(nukeOrders(t, 'r0')).toBe(false)
  })

  it('builds the bomb only when rich, at war, and one at a time', () => {
    const s = rivalWorld()
    s.nations.r0.nuclear = undefined
    expect(bombFor(s, 'r0', 'buildWarhead')).toBe(true)
    expect(planned(s, 'r0', 'buildWarhead')).toBe(true)
    const poor = structuredClone(s)
    poor.nations.r0.resources.capital = 100
    expect(bombFor(poor, 'r0', 'buildWarhead')).toBe(false)
    const busy = structuredClone(s)
    busy.nations.r0.nuclear = { warheads: 0, building: [busy.turn + 2] }
    expect(bombFor(busy, 'r0', 'buildWarhead')).toBe(false)
    const peace = structuredClone(s)
    peace.wars = []
    expect(bombFor(peace, 'r0', 'buildWarhead')).toBe(false)
  })
})

describe('the threat a leading nation poses', () => {
  const { map } = getWorld()
  /** A world where the player holds `count` countries. */
  function leaderWorld(count: number, difficulty: 'easy' | 'normal' | 'hard', infamy = 0) {
    const s = createInitialState(map, { playerRegionId: 'germany', seed: 11, difficulty, goal: 'world' })
    s.nextEventTurn = 9999
    // Hand the player the countries nearest it.
    const home = map.regions.germany
    const near = Object.values(map.regions)
      .filter((r) => r.id !== 'germany')
      .sort((a, b) => (a.lat - home.lat) ** 2 + (a.lng - home.lng) ** 2 - ((b.lat - home.lat) ** 2 + (b.lng - home.lng) ** 2) || (a.id < b.id ? -1 : 1))
      .slice(0, count - 1)
    for (const r of near) {
      s.regions[r.id].owner = 'germany'
      s.nations[r.id].alive = false
    }
    updateTiers(s)
    s.infamy.germany = infamy
    return s
  }

  it('grows with the empire tier: Regional < Great < Superpower < Hegemon', () => {
    const scores: number[] = []
    const pressures: number[] = []
    for (const [count, tier] of [[4, 2], [10, 3], [25, 4], [60, 5]] as const) {
      const s = leaderWorld(count, 'hard')
      expect(s.nations.germany.tier).toBe(tier)
      const t = threatOf(s, map, 'germany')
      scores.push(t.score)
      pressures.push(t.pressure)
    }
    for (let i = 1; i < 4; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1])
      expect(pressures[i]).toBeGreaterThan(pressures[i - 1])
    }
    expect(pressures[3]).toBeLessThanOrEqual(THREAT.maxPressure)
    expect(pressures[0]).toBeLessThan(0.15)
  })

  it('grows with the share of the world and with a reputation for aggression, and has a level name', () => {
    const calm = threatOf(leaderWorld(10, 'hard', 0), map, 'germany')
    const feared = threatOf(leaderWorld(10, 'hard', 80), map, 'germany')
    expect(feared.score).toBeGreaterThan(calm.score + 20)
    expect(feared.level).toBeGreaterThan(calm.level)
    expect(feared.parts.some((p) => /aggression/.test(p.label))).toBe(true)
    expect(calm.parts.some((p) => /countries/.test(p.label))).toBe(true)
    expect(THREAT.levelNames).toContain(calm.levelName)
    expect(threatOf(leaderWorld(1, 'hard'), map, 'germany').level).toBe(0)
  })

  it('a lone nation is never a coalition\'s concern, however it is hated', () => {
    const s = leaderWorld(1, 'hard', 100)
    expect(threatOf(s, map, 'germany').score).toBeGreaterThan(30)
    expect(pressureOf(s, map, 'germany')).toBe(0)
  })

  it('is zero on Easy: they never band together', () => {
    const s = leaderWorld(60, 'easy', 80)
    const t = threatOf(s, map, 'germany')
    expect(t.rawPressure).toBeGreaterThan(0.9)
    expect(t.pressure).toBe(0)
    expect(pressureOf(s, map, 'germany')).toBe(0)
    expect(leadersOf(s, map)).toHaveLength(0)
  })

  it('Medium and Hard feel it, scaled by tier, and the panel says what each does', () => {
    for (const d of ['normal', 'hard'] as const) {
      const s = leaderWorld(25, d)
      expect(pressureOf(s, map, 'germany')).toBeGreaterThan(0.4)
      const view = worldReaction(s, map, 'germany')
      expect(view.stance).toBe(d === 'hard' ? 'coordinated' : 'defensive')
    }
    expect(worldReaction(leaderWorld(25, 'easy'), map, 'germany').stance).toBe('none')
  })
})

describe('rivals partnering against a leader, within their difficulty', () => {
  const { map } = getWorld()
  function superWorld(difficulty: 'easy' | 'normal' | 'hard', count = 25) {
    const s = createInitialState(map, { playerRegionId: 'germany', seed: 5, difficulty, goal: 'world' })
    s.nextEventTurn = 9999
    const home = map.regions.germany
    const near = Object.values(map.regions)
      .filter((r) => r.id !== 'germany')
      .sort((a, b) => (a.lat - home.lat) ** 2 + (a.lng - home.lng) ** 2 - ((b.lat - home.lat) ** 2 + (b.lng - home.lng) ** 2) || (a.id < b.id ? -1 : 1))
      .slice(0, count - 1)
    for (const r of near) {
      s.regions[r.id].owner = 'germany'
      s.nations[r.id].alive = false
    }
    updateTiers(s)
    s.turn = 40
    return s
  }
  /** One month of a turn game, with no surprise decision waiting afterwards. */
  const step = (s: GameState, orders: Order[]) => {
    const next = resolveTurn(s, map, orders)
    next.pendingEvent = null
    next.nextEventTurn = 9999
    return next
  }
  const neighborsOf = (s: GameState, id: NationId) => {
    const set = new Set<NationId>()
    for (const r of Object.values(s.regions)) {
      if (r.owner !== id) continue
      for (const nb of [...map.regions[r.id].neighbors, ...map.regions[r.id].seaLanes]) {
        const o = s.regions[nb]?.owner
        if (o && o !== id) set.add(o)
      }
    }
    return [...set].sort()
  }

  it('Easy rivals never form a plan or a coalition, whatever the player becomes', () => {
    let s = superWorld('easy', 25)
    for (let i = 0; i < 6; i++) {
      s = step(s, generateAllBotOrders(s, map))
    }
    expect(s.coalitions).toBeUndefined()
    expect(s.wars.some((w) => w.split('|').includes('germany'))).toBe(false)
  }, 120_000)

  it('Medium rivals make no plans, but two that border the leader are readier to ally', () => {
    const s = superWorld('normal', 25)
    const [a, b] = neighborsOf(s, 'germany').filter((id) => !s.humans.includes(id))
    const proposal = { kind: 'alliance' as const, id: 'p1', from: a, to: b, created: s.turn, expires: s.turn + 3 }
    const tally = (st: GameState) => {
      let yes = 0
      for (let i = 0; i < 120; i++) if (evaluateProposal(st, map, b, proposal, createRng(i, 9)).accept) yes++
      return yes
    }
    const without = structuredClone(s)
    without.nations.germany.tier = 1
    // Cool the two toward each other until they are about even on an alliance, so the difference shows.
    let mood = 0
    while (mood > -60 && tally(without) > 90) {
      mood -= 5
      addOpinion(without, b, a, `cool${mood}`, -5, 0)
      addOpinion(s, b, a, `cool${mood}`, -5, 0)
    }
    expect(tally(without)).toBeLessThan(110)
    expect(tally(s)).toBeGreaterThan(tally(without))
    // And no plan ever forms for Medium.
    let t = s
    for (let i = 0; i < 4; i++) t = step(t, generateAllBotOrders(t, map))
    expect(t.coalitions).toBeUndefined()
  }, 120_000)

  it('Hard rivals plan a joint strike on the leader: several fronts, one shared target, with warning', () => {
    let s = superWorld('hard', 25)
    const orders = generateAllBotOrders(s, map)
    s = step(s, orders)
    const plans = activePlans(s, 'germany')
    expect(plans).toHaveLength(1)
    const plan = plans[0]
    expect(plan.members.length).toBeGreaterThanOrEqual(2)
    expect(plan.members.length).toBeLessThanOrEqual(COALITION.fronts[4])
    expect(plan.focus.length).toBeGreaterThan(0)
    expect(plan.strikeTurn).toBe(plan.formed + 1 + COALITION.lead)
    expect(plan.strikeTurn - s.turn).toBe(COALITION.lead)
    expect(plan.strikeDay).toBeGreaterThanOrEqual(COALITION.day[0])
    // The leader sees it: the news, and the panel.
    expect(s.log.some((e) => /agreed to act together against Germany/.test(e.text))).toBe(true)
    const view = worldReaction(s, map, 'germany')
    expect(view.plan?.monthsLeft).toBe(COALITION.lead)
    expect(view.plan?.members).toEqual(plan.members)
    // Every member has its reason on paper, and stands in a treaty with the strongest.
    for (const m of plan.members) expect(s.casusBelli[`${m}|germany`]).toBeGreaterThanOrEqual(plan.strikeTurn)
    expect(blocsOf(s).some((b) => plan.members.every((m) => b.members.includes(m)))).toBe(true)
    // Each member can reach the shared target or one like it.
    for (const m of plan.members) expect(jointTarget(s, map, plan, m)).not.toBeNull()
  }, 120_000)

  it('then every member declares and attacks in the same month, at the same target', () => {
    let s = superWorld('hard', 25)
    s = step(s, generateAllBotOrders(s, map))
    const plan = activePlans(s, 'germany')[0]
    // The warning months pass quietly: nobody is at war with the leader yet.
    for (let i = 0; i < COALITION.lead; i++) {
      expect(s.wars.some((w) => w.split('|').includes('germany'))).toBe(false)
      expect(activePlans(s, 'germany')[0].id).toBe(plan.id)
      s = step(s, [])
    }
    expect(s.turn).toBe(plan.strikeTurn)
    const orders = generateAllBotOrders(s, map)
    const wars = orders.filter((o) => o.type === 'declareWar' && o.target === 'germany')
    const attacks = orders.filter((o) => o.type === 'attack' && o.joint === plan.id)
    expect(wars.length).toBeGreaterThanOrEqual(2)
    expect(attacks.length).toBeGreaterThanOrEqual(2)
    expect(new Set(attacks.map((o) => o.nationId)).size).toBe(attacks.length)
    for (const o of attacks) expect(s.regions[(o as Extract<Order, { type: 'attack' }>).target].owner).toBe('germany')
    const next = step(s, orders)
    const atWarNow = plan.members.filter((m) => atWar(next, m, 'germany'))
    expect(atWarNow.length).toBeGreaterThanOrEqual(2)
    expect(next.battles.filter((b) => b.defender.nationId === 'germany').length).toBeGreaterThanOrEqual(2)
    // It is a one-off: the plan closes, and the same rivals are not asked again at once.
    expect(activePlans(next, 'germany')).toHaveLength(0)
    expect(next.coalitionLast?.germany).toBe(plan.strikeTurn)
  }, 240_000)

  it('in a live game every attack of the strike leaves on the same day, announced in advance', () => {
    let s = startLive(superWorld('hard', 25))
    const month = (st: GameState) => {
      let cur = st
      const target = st.turn + 1
      while (cur.turn < target) {
        const last = (cur.day ?? 0) >= daysInMonth(cur.turn) - 1
        cur = advanceDay(cur, map, { planner: last ? (x) => generateAllBotOrders(x, map) : undefined }).state
        // No surprise decision stops the clock.
        cur.nextEventTurn = 9999
        cur.pendingEvent = null
        delete cur.pendingDay
      }
      return cur
    }
    s = month(s)
    const plan = activePlans(s, 'germany')[0]
    expect(plan).toBeDefined()
    // The rivals plan on the last day of the month the plan names, and their attacks leave in the next.
    while (s.turn < plan.strikeTurn + 1) s = month(s)
    // The month of the strike has begun: its attacks are scheduled, all on one day.
    const joint = (s.launches ?? []).filter((l) => l.order.joint === plan.id)
    const fought = joint.length + (s.armies ?? []).filter((a) => plan.members.includes(a.nationId)).length
    expect(fought).toBeGreaterThanOrEqual(2)
    if (joint.length >= 2) {
      expect(new Set(joint.map((l) => l.at)).size).toBe(1)
      expect(joint[0].at).toBe(absDay(s.turn, plan.strikeDay))
      expect(s.log.some((e) => /JOINT STRIKE/.test(e.text))).toBe(true)
    }
    // The members were all in the month's wars, started together.
    expect(plan.members.filter((m) => atWar(s, m, 'germany')).length).toBeGreaterThanOrEqual(2)
  }, 300_000)

  it('presses an ally\'s war against the leader', () => {
    const s = superWorld('hard', 25)
    s.turn = 3
    const [a, b] = neighborsOf(s, 'germany').filter((id) => !s.humans.includes(id))
    s.alliances.push(pairKey(a, b))
    s.wars.push(pairKey(a, 'germany'))
    s.wars.sort()
    s.nations[b].resources.pp = 300
    const wantsWar = (st: GameState) => {
      for (let t = 0; t < 40; t++) {
        const c = structuredClone(st)
        c.turn += t
        const orders = generateBotOrders(c, map, b)
        if (orders.some((o) => (o.type === 'declareWar' || o.type === 'buildCase' || o.type === 'operation') && o.target === 'germany')) return true
      }
      return false
    }
    expect(wantsWar(s)).toBe(true)
    const medium = structuredClone(s)
    medium.settings.difficulty = 'normal'
    // Medium rivals do not open a front of their own for an ally.
    const mediumDeclares = (() => {
      for (let t = 0; t < 40; t++) {
        const c = structuredClone(medium)
        c.turn += t
        if (generateBotOrders(c, map, b).some((o) => o.type === 'declareWar' && o.target === 'germany')) return true
      }
      return false
    })()
    expect(mediumDeclares).toBe(false)
  }, 200_000)
})

describe('turn and live agree, and nothing moves in games that do not use this', () => {
  it('a month without a nuclear program or a coalition leaves the new fields out', () => {
    const s = startState(line)
    const next = resolveTurn(s, line, [])
    for (const key of ['nukes', 'shock', 'nukeLast', 'coalitions', 'coalitionLast']) expect(key in next).toBe(false)
    expect(Object.values(next.regions).some((r) => 'fallout' in r)).toBe(false)
    expect(Object.values(next.nations).some((n) => 'nuclear' in n)).toBe(false)
  })

  it('runMonth and the live month make the same nuclear month', () => {
    const base = nuclearWorld()
    base.nations.r0.nuclear!.warheads = 1
    const turn = structuredClone(base)
    runMonth(turn, line, [{ type: 'nuke', nationId: 'r0', target: 'r1' }])
    // The ruins of a lone nation are taken by the rebels the same month: the nation has fallen, and its land is a free country.
    expect(turn.regions.r1.fallout).toBeGreaterThan(0)
    expect(turn.nations.r1.alive).toBe(false)
    expect(turn.regions.r1.owner).not.toBe('r1')
    expect(enemiesOf(turn, 'r0')).not.toContain('r1')
  })
})

describe('the warnings and the saves', () => {
  it('the advisor warns of a missile in the air, of an enemy with the bomb, and of a plan against you', () => {
    // Someone else's warhead is heading for r1, a country of the player.
    const s = startLive(nuclearWorld())
    s.playerId = 'r1'
    s.humans = ['r1']
    s.nations.r1.isPlayer = true
    s.nations.r0.isPlayer = false
    expect(applyOrderNow(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' }).error).toBeNull()
    const incoming = advise(s, line, 'r1').find((a) => a.id.startsWith('incoming-nuke'))
    expect(incoming).toBeDefined()
    expect(incoming!.urgency).toBe('now')
    expect(incoming!.title).toMatch(/nuclear missile/i)
    expect(incoming!.target).toEqual({ desk: 'diplomacy', nation: 'r0' })
    // Before it is fired, the bomb in an enemy's store is a warning too.
    const quiet = nuclearWorld()
    quiet.playerId = 'r1'
    quiet.humans = ['r1']
    expect(advise(quiet, line, 'r1').some((a) => a.id === 'enemy-bomb')).toBe(true)
    quiet.nations.r0.nuclear!.warheads = 0
    expect(advise(quiet, line, 'r1').some((a) => a.id === 'enemy-bomb')).toBe(false)
  })

  it('the advisor and the panel tell a Superpower about the coalition plan against it', () => {
    const s = startState(line, 'r0', 2)
    s.settings.difficulty = 'hard'
    s.nations.r0.tier = 4
    s.coalitions = [{ id: 'cp1', target: 'r0', members: ['r1', 'r2'], focus: ['r0'], formed: s.turn, strikeTurn: s.turn + 2, strikeDay: 5, threat: 60 }]
    const a = advise(s, line, 'r0').find((x) => x.id === 'coalition-plan')
    expect(a).toBeDefined()
    expect(a!.detail).toMatch(/same month/)
    expect(a!.target).toEqual({ desk: 'empire', tab: 'reaction' })
    const view = worldReaction(s, line, 'r0')
    expect(view.plan?.monthsLeft).toBe(2)
    expect(view.persuadable).toEqual(['r1', 'r2'])
    // A live game's rivals attack in the month after the one the plan names, on a day.
    s.settings.mode = 'live'
    expect(advise(s, line, 'r0').find((x) => x.id === 'coalition-plan')!.detail).toMatch(/same day/)
    expect(worldReaction(s, line, 'r0').plan?.monthsLeft).toBe(3)
  })

  it('a save keeps whole plans and drops broken ones, and a turn game carries no warheads in the air', () => {
    const s = startState(line, 'r0', 2)
    s.coalitions = [
      { id: 'ok', target: 'r0', members: ['r1'], focus: ['r0'], formed: 1, strikeTurn: 4, strikeDay: 5, threat: 50 },
      { id: 'broken', target: 'r0', members: 'oops' as unknown as string[], focus: [], formed: 1, strikeTurn: 4, strikeDay: 5, threat: 50 },
    ]
    s.nukes = [{ id: 'n1', nationId: 'r1', from: 'r1', target: 'r0', launched: 1, lands: 5 }]
    const loaded = normalizeGame(JSON.parse(JSON.stringify(s)), line)
    expect(loaded.coalitions!.map((p) => p.id)).toEqual(['ok'])
    expect('nukes' in loaded).toBe(false)
    const live = startLive(structuredClone(s))
    live.nukes = [{ id: 'n1', nationId: 'r1', from: 'r1', target: 'r0', launched: 1, lands: 5 }, { id: 'n2', nationId: 'r1', from: 'r1', target: 'nowhere', launched: 1, lands: 5 }]
    expect(normalizeGame(JSON.parse(JSON.stringify(live)), line).nukes!.map((f) => f.id)).toEqual(['n1'])
  })
})

describe('Medium rivals look for partners against a leader', () => {
  const { map } = getWorld()
  it('a neighbor of a Superpower proposes alliances to others that fear it, far more than when there is no leader', () => {
    const base = createInitialState(map, { playerRegionId: 'germany', seed: 5, difficulty: 'normal', goal: 'world' })
    base.nextEventTurn = 9999
    const home = map.regions.germany
    const near = Object.values(map.regions)
      .filter((r) => r.id !== 'germany')
      .sort((a, b) => (a.lat - home.lat) ** 2 + (a.lng - home.lng) ** 2 - ((b.lat - home.lat) ** 2 + (b.lng - home.lng) ** 2) || (a.id < b.id ? -1 : 1))
      .slice(0, 24)
    for (const r of near) {
      base.regions[r.id].owner = 'germany'
      base.nations[r.id].alive = false
    }
    updateTiers(base)
    base.turn = 40
    const leaderNeighbors = new Set<string>()
    for (const r of Object.values(base.regions)) {
      if (r.owner !== 'germany') continue
      for (const nb of [...map.regions[r.id].neighbors, ...map.regions[r.id].seaLanes]) if (base.regions[nb].owner !== 'germany') leaderNeighbors.add(base.regions[nb].owner)
    }
    const ids = [...leaderNeighbors].sort().filter((id) => !base.humans.includes(id)).slice(0, 4)
    const count = (st: GameState) => {
      let n = 0
      for (let t = 0; t < 30; t++) {
        const c = structuredClone(st)
        c.turn += t
        for (const id of ids) n += generateBotOrders(c, map, id).filter((o) => o.type === 'propose' && o.proposal.kind === 'alliance' && leaderNeighbors.has(o.target)).length
      }
      return n
    }
    const without = structuredClone(base)
    without.nations.germany.tier = 1
    expect(count(base)).toBeGreaterThan(count(without))
  }, 240_000)
})

describe('the confirmation spells out what a nuclear strike costs', () => {
  it('names the victim, the strongest blocs that will declare war, the sanctions and the reputation', () => {
    const s = nuclearWorld()
    s.alliances.push(pairKey('r2', 'r3'), pairKey('r4', 'r5'))
    setMilitary(s, 'r2', { infantry: 30 })
    setMilitary(s, 'r4', { infantry: 12 })
    const ask = confirmFor(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' })
    expect(ask).not.toBeNull()
    expect(ask!.danger).toBe(true)
    // A deliberate tick is required, under a red banner.
    expect(ask!.require).toMatch(/I understand/)
    expect(ask!.warning).toMatch(/cannot be undone/)
    expect(ask!.title).toMatch(/Launch a nuclear missile/)
    const text = ask!.points!.join('\n')
    expect(text).toMatch(/destroyed/)
    expect(text).toMatch(/reputation for aggression rises by 60/)
    expect(text).toMatch(/cuts off trade with you for 24 months/)
    expect(text).toMatch(/declare war on you at once/)
    expect(text).toContain(`${s.nations.r2.name} bloc (2 nations)`)
    expect(text).toContain(`${s.nations.r4.name} bloc (2 nations)`)
    expect(text).toMatch(/cannot be undone/)
    expect(text).toMatch(/lands when the month ends/)
    expect(confirmFor(startLive(structuredClone(s)), line, { type: 'nuke', nationId: 'r0', target: 'r1' })!.points!.join(' ')).toMatch(/flies for 5 days/)
    // A shield is mentioned honestly.
    s.nations.r1.systems.shield = 3
    expect(confirmFor(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' })!.points!.join(' ')).toMatch(/stops about 25%/)
  })
})

describe('edge cases of the world\'s answer', () => {
  it('with no bloc and no other power at all, nobody is forced and nothing breaks', () => {
    const s = nuclearWorld()
    for (const id of ['r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9']) s.nations[id].alive = false
    expect(leadingFactions(s, 'r0', 2, 'r1')).toEqual([])
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    expect(s.infamy.r0).toBe(NUCLEAR.infamy)
    expect(s.log.some((e) => /cannot go to war/.test(e.text))).toBe(true)
  })

  it('with only one bloc, the next strongest single nation makes up the second faction', () => {
    const s = nuclearWorld()
    for (const id of ['r4', 'r5', 'r6', 'r7', 'r8', 'r9']) setMilitary(s, id, { infantry: 1 })
    s.alliances.push(pairKey('r2', 'r3'))
    setMilitary(s, 'r2', { infantry: 30 })
    setMilitary(s, 'r6', { infantry: 8 })
    expect(leadingFactions(s, 'r0', 2, 'r1')).toEqual([['r2', 'r3'], ['r6']])
  })

  it('the victim\'s own allies are never counted among the factions, however strong', () => {
    const s = nuclearWorld()
    s.alliances.push(pairKey('r1', 'r2'), pairKey('r4', 'r5'))
    setMilitary(s, 'r2', { infantry: 60 })
    setMilitary(s, 'r4', { infantry: 12 })
    for (const id of ['r3', 'r6', 'r7', 'r8', 'r9']) setMilitary(s, id, { infantry: 1 })
    const f = leadingFactions(s, 'r0', 2, 'r1').flat()
    expect(f).not.toContain('r1')
    expect(f).not.toContain('r2')
    expect(f).toContain('r4')
  })

  it('cannot be fired at your own ally, even one at war with someone else', () => {
    const s = nuclearWorld()
    s.wars = []
    s.alliances.push(pairKey('r0', 'r1'))
    expect(validateOrder(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' })).toMatch(/at war/)
  })

  it('may be fired at another human in an online game, who is not dragged into other humans\' wars', () => {
    const s = nuclearWorld()
    s.humans = ['r0', 'r1']
    s.multiplayer = true
    expect(validateOrder(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' })).toBeNull()
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    expect(s.regions.r1.fallout).toBeGreaterThan(0)
  })

  it('a warhead in the air is called off when its target nation dies before it lands', () => {
    const s = startLive(nuclearWorld())
    applyOrderNow(s, line, { type: 'nuke', nationId: 'r0', target: 'r1' })
    s.nations.r1.alive = false
    let cur = s
    const events = []
    for (let i = 0; i < NUCLEAR.flightDays; i++) {
      const step = advanceDay(cur, line, {})
      cur = step.state
      events.push(...step.events)
    }
    expect(events.some((e) => e.kind === 'nuke' && !e.landed && e.why === 'changed')).toBe(true)
    expect(cur.infamy.r0 ?? 0).toBe(0)
  })

  it('a nation the strike destroys is gone from the wars and the treaties, and the aggressor keeps the reputation', () => {
    const s = nuclearWorld()
    s.alliances.push(pairKey('r1', 'r8'))
    const next = resolveTurn(s, line, [{ type: 'nuke', nationId: 'r0', target: 'r1' }])
    expect(next.nations.r1.alive).toBe(false)
    expect(next.wars.some((w) => w.split('|').includes('r1'))).toBe(false)
    expect(next.alliances.some((a) => a.split('|').includes('r1'))).toBe(false)
    expect(next.infamy.r0).toBeGreaterThanOrEqual(NUCLEAR.infamy - 5)
  })

  it('missile hunters catch some of a warhead, stealth takes it back, and neither is needed for the plain path', () => {
    const hunters = { hunt: 0.8, pierce: 0, jam: 0 } as never
    const stealth = { hunt: 0, pierce: 0.5, jam: 0 } as never
    const plain = nukeThrough(0)
    const hunted = nukeThrough(0, { defender: hunters, fighters: 4 })
    expect(plain).toBe(1)
    expect(hunted).toBeLessThan(plain)
    // Fighters catch a warhead far worse than a cruise missile: less than the plain hunting share.
    expect(hunted).toBeGreaterThan(1 - 0.8 * 0.95)
    expect(nukeThrough(0, { defender: hunters, attacker: stealth, fighters: 4 })).toBeGreaterThan(hunted)
    expect(nukeThrough(0, { defender: hunters, fighters: 0 })).toBe(1)
  })
})
