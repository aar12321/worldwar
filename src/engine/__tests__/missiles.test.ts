import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { MISSILES, MISSILE_PROGRAM, MISSILE_TYPES, PROGRAM_MISSILES } from '../../data/missiles'
import { totalUnits } from '../helpers'
import { arsenalSize, buildRoom, getsThrough, launchSite, missileStock, recentAttackers, storageCap, strikeHitsKind } from '../missiles'
import { advanceDay, startLive } from '../live'
import { clockOf } from '../calendar'
import { orderCost, validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState, MissileType, Order } from '../types'
import { checkInvariants } from './invariants'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

/** r0 is at war with r1 and r2, has a factory (the launch site), and is rich. */
function war(): GameState {
  const s = startState(map)
  s.wars.push('r0|r1', 'r0|r2')
  const n = s.nations.r0
  n.resources.capital = 6000
  n.resources.steel = 800
  n.resources.oil = 200
  n.resources.tp = 500
  s.regions.r0.buildings.factory = 2
  s.regions.r1.buildings.factory = 3
  s.regions.r1.line = 9
  s.regions.r2.line = 9
  setMilitary(s, 'r1', { infantry: 10, armor: 4 })
  return s
}
const build = (kind: Exclude<MissileType, 'hypersonic'>, count: number): Order => ({ type: 'buildMissiles', nationId: 'r0', kind, count })
const fire = (kind: MissileType, count: number, target = 'r1'): Order => ({ type: 'strike', nationId: 'r0', target, weapon: 'missile', kind, count })
const ok = (s: GameState, o: Order) => expect(applyOrderNow(s, map, o).error, JSON.stringify(o)).toBeNull()

describe('the missile program', () => {
  it('four kinds, three program levels, each level unlocking a kind and a monthly capacity', () => {
    expect(MISSILE_TYPES).toHaveLength(4)
    expect(PROGRAM_MISSILES).toEqual(['cruise', 'tactical', 'ballistic'])
    expect(MISSILE_PROGRAM.maxLevel).toBe(3)
    expect(MISSILE_PROGRAM.capacity).toEqual([0, 5, 10, 18])
    for (const k of PROGRAM_MISSILES) expect(MISSILES[k].level).toBeGreaterThanOrEqual(1)
    expect(MISSILES.hypersonic.level).toBe(0)
  })

  it('each level costs money and research, and the last one cannot be raised', () => {
    const s = war()
    const n = s.nations.r0
    for (let level = 0; level < 3; level++) {
      const before = { capital: n.resources.capital, tp: n.resources.tp }
      ok(s, { type: 'fundMissiles', nationId: 'r0' })
      expect(n.missileProgram).toBe(level + 1)
      expect(before.capital - n.resources.capital).toBe(MISSILE_PROGRAM.money[level])
      expect(before.tp - n.resources.tp).toBe(MISSILE_PROGRAM.research[level])
    }
    expect(validateOrder(s, map, { type: 'fundMissiles', nationId: 'r0' })).toMatch(/at its best/)
  })

  it('needs the money and the research', () => {
    const s = war()
    s.nations.r0.resources.capital = 10
    expect(validateOrder(s, map, { type: 'fundMissiles', nationId: 'r0' })).toMatch(/money/)
    s.nations.r0.resources.capital = 6000
    s.nations.r0.resources.tp = 1
    expect(validateOrder(s, map, { type: 'fundMissiles', nationId: 'r0' })).toMatch(/research/)
  })

  it('a kind needs its program level, and the program builds only so many a month', () => {
    const s = war()
    expect(validateOrder(s, map, build('cruise', 1))).toMatch(/program at level 1/)
    s.nations.r0.missileProgram = 1
    expect(validateOrder(s, map, build('cruise', 5))).toBeNull()
    expect(validateOrder(s, map, build('cruise', 6))).toMatch(/can build 5 more/)
    expect(validateOrder(s, map, build('tactical', 1))).toMatch(/program at level 2/)
    expect(validateOrder(s, map, build('ballistic', 1))).toMatch(/program at level 3/)
    expect(validateOrder(s, map, build('cruise', 0))).toMatch(/how many/)
    expect(validateOrder(s, map, build('cruise', 1.5))).toMatch(/how many/)
    // The month's room is shared by the orders already waiting, and by what is already built.
    expect(validateOrder(s, map, build('cruise', 3), [build('cruise', 3)])).toMatch(/can build 2 more/)
    ok(s, build('cruise', 5))
    expect(buildRoom(s.nations.r0, s.turn)).toBe(0)
    expect(validateOrder(s, map, build('cruise', 1))).toMatch(/all it can this month/)
  })

  it('building costs money, steel and (for ballistic) oil, and adds to the arsenal', () => {
    const s = war()
    s.nations.r0.missileProgram = 3
    const n = s.nations.r0
    const before = { ...n.resources }
    ok(s, build('ballistic', 4))
    expect(before.capital - n.resources.capital).toBe(4 * MISSILES.ballistic.money)
    expect(before.steel - n.resources.steel).toBe(4 * MISSILES.ballistic.steel)
    expect(before.oil - n.resources.oil).toBe(4 * MISSILES.ballistic.oil)
    expect(n.arsenal?.ballistic).toBe(4)
    expect(missileStock(n, 'ballistic')).toBe(4)
    expect(orderCost(s, build('cruise', 10))).toMatchObject({ capital: 10 * MISSILES.cruise.money, steel: 10 * MISSILES.cruise.steel })
    n.resources.oil = 3
    expect(validateOrder(s, map, build('ballistic', 2))).toMatch(/oil/)
  })

  it('the stores hold only a few months of production: a stockpile has a ceiling', () => {
    const s = war()
    const n = s.nations.r0
    n.missileProgram = 1
    expect(storageCap(n)).toBe(MISSILE_PROGRAM.capacity[1] * MISSILE_PROGRAM.storageMonths)
    n.arsenal = { cruise: storageCap(n) - 2 }
    expect(validateOrder(s, map, build('cruise', 3))).toMatch(/room for 2 more/)
    expect(validateOrder(s, map, build('cruise', 2))).toBeNull()
    n.arsenal = { cruise: storageCap(n) - 10, tactical: 10 }
    expect(arsenalSize(n)).toBe(storageCap(n))
    expect(validateOrder(s, map, build('cruise', 1))).toMatch(/stores are full/)
    // Firing makes room again.
    n.arsenal.cruise = 0
    expect(validateOrder(s, map, build('cruise', 1))).toBeNull()
  })

  it('over a long peace the program stops where the stores are full', () => {
    let s = war()
    s.wars = []
    s.nations.r0.missileProgram = 3
    s.nations.r0.resources.capital = 1e6
    s.nations.r0.resources.steel = 1e5
    for (let i = 0; i < 24; i++) {
      s = resolveTurn(s, map, [build('cruise', Math.min(18, Math.max(1, storageCap(s.nations.r0) - arsenalSize(s.nations.r0))))])
      s.nations.r0.resources.capital = 1e6
      s.nations.r0.resources.steel = 1e5
    }
    expect(arsenalSize(s.nations.r0)).toBeLessThanOrEqual(storageCap(s.nations.r0))
    expect(arsenalSize(s.nations.r0)).toBeGreaterThan(storageCap(s.nations.r0) - 20)
  })
})

describe('firing missiles', () => {
  it('needs the kind in store, the range from a country with a factory, and a war', () => {
    const s = war()
    expect(validateOrder(s, map, fire('cruise', 1))).toMatch(/no cruise missiles/)
    s.nations.r0.arsenal = { cruise: 10 }
    expect(validateOrder(s, map, fire('cruise', 4))).toBeNull()
    expect(validateOrder(s, map, fire('cruise', 11))).toMatch(/Only 10/)
    // r7 is about 3900 km from r0's factory: beyond a cruise missile's 3500 km, within a ballistic one's 9000.
    s.wars.push('r0|r7')
    expect(launchSite(s, map, 'r0', 'r7', 'cruise')).toBeNull()
    expect(validateOrder(s, map, fire('cruise', 1, 'r7'))).toMatch(/Out of range/)
    s.nations.r0.arsenal = { cruise: 10, ballistic: 3 }
    expect(launchSite(s, map, 'r0', 'r7', 'ballistic')).toBe('r0')
    expect(validateOrder(s, map, fire('ballistic', 1, 'r7'))).toBeNull()
    expect(validateOrder(s, map, fire('cruise', 1, 'r5'))).toMatch(/at war/)
    s.regions.r0.buildings.factory = 0
    expect(validateOrder(s, map, fire('cruise', 1))).toMatch(/Out of range/)
  })

  it('salvos waiting for the month end share the stock', () => {
    const s = war()
    s.nations.r0.arsenal = { cruise: 6 }
    expect(validateOrder(s, map, fire('cruise', 4), [fire('cruise', 4)])).toMatch(/Only 2/)
    expect(validateOrder(s, map, fire('cruise', 2), [fire('cruise', 4)])).toBeNull()
    expect(validateOrder(s, map, fire('cruise', 1), [fire('cruise', 6)])).toMatch(/No cruise missiles left/)
  })

  it('every missile fired is used up, and the target remembers who struck', () => {
    const s = war()
    s.nations.r0.arsenal = { cruise: 10 }
    ok(s, fire('cruise', 4))
    expect(s.nations.r0.arsenal.cruise).toBe(6)
    expect(s.nations.r1.struckBy?.r0).toBe(s.turn)
    expect(recentAttackers(s, s.nations.r1)).toEqual(['r0'])
    // Not at war any more, or long ago: nobody to answer.
    s.wars = []
    expect(recentAttackers(s, s.nations.r1)).toEqual([])
  })
})

describe('in a live game', () => {
  it('each kind flies for its own days, lands with its own effect, and a shot-down salvo changes nothing', () => {
    const fly = (kind: MissileType, count: number) => {
      let s = startLive(war())
      s.nations.r0.arsenal = { cruise: 20, tactical: 20, ballistic: 20 }
      s.nations.r0.military.units.missile = 20
      ok(s, fire(kind, count))
      expect(s.flights).toHaveLength(1)
      expect(s.flights![0].lands).toBe(clockOf(s) + MISSILES[kind].days)
      expect(s.flights![0].kind).toBe(kind === 'hypersonic' ? undefined : kind)
      const line = s.regions.r1.line
      const army = totalUnits(s.nations.r1.military.units)
      const days = MISSILES[kind].days
      for (let i = 0; i < days - 1; i++) s = advanceDay(s, map, { planner: () => [] }).state
      expect(s.flights).toHaveLength(1)
      expect(s.regions.r1.line).toBe(line)
      s = advanceDay(s, map, { planner: () => [] }).state
      expect(s.flights).toHaveLength(0)
      return { line: line - s.regions.r1.line, army: army - totalUnits(s.nations.r1.military.units) }
    }
    expect(fly('cruise', 8).line).toBeCloseTo(2, 5)
    expect(fly('tactical', 10).army).toBeGreaterThan(0)
    expect(fly('hypersonic', 5).line).toBeCloseTo(3, 5)
    expect(fly('ballistic', 6).line).toBeCloseTo(6, 5)
  })
})

describe('what each kind does', () => {
  const hit = (kind: MissileType, count: number, edit?: (s: GameState) => void) => {
    const s = war()
    edit?.(s)
    const before = { line: s.regions.r1.line, army: totalUnits(s.nations.r1.military.units), pop: s.regions.r1.population, buildings: Object.values(s.regions.r1.buildings).reduce((a, b) => a + b, 0) }
    strikeHitsKind(s, map, 'r0', 'r1', kind, count)
    return {
      s,
      line: before.line - s.regions.r1.line,
      army: 1 - totalUnits(s.nations.r1.military.units) / before.army,
      pop: 1 - s.regions.r1.population / before.pop,
      buildings: before.buildings - Object.values(s.regions.r1.buildings).reduce((a, b) => a + b, 0),
    }
  }

  it('cruise missiles wear down the line and stop factories, and nothing else', () => {
    const r = hit('cruise', 8)
    expect(r.line).toBeCloseTo(2, 5)
    expect(r.s.regions.r1.sabotaged).toBe(1)
    expect(r.army).toBe(0)
    expect(r.pop).toBe(0)
    expect(r.buildings).toBe(0)
  })

  it('tactical missiles kill a slice of the army and leave the line alone', () => {
    const r = hit('tactical', 10)
    expect(r.army).toBeCloseTo(0.06, 5)
    expect(r.line).toBe(0)
    expect(r.s.regions.r1.sabotaged).toBe(0)
  })

  it('hypersonic missiles crack the line and stop factories for two months', () => {
    const r = hit('hypersonic', 5)
    expect(r.line).toBeCloseTo(3, 5)
    expect(r.s.regions.r1.sabotaged).toBe(2)
  })

  it('ballistic missiles break the line, destroy buildings and kill people, and the world resents it', () => {
    const r = hit('ballistic', 6, (s) => {
      s.regions.r1.buildings.factory = 4
    })
    expect(r.line).toBeCloseTo(6, 5)
    expect(r.buildings).toBe(2)
    expect(r.pop).toBeCloseTo(0.024, 5)
    expect(r.s.infamy.r0).toBeGreaterThanOrEqual(MISSILES.ballistic.infamy)
    expect(r.s.opinions['r1>r0']?.some((m) => m.value <= MISSILES.ballistic.opinion)).toBe(true)
  })

  it('a salvo has a ceiling however many are fired at once, and a line never falls below half a point', () => {
    expect(hit('cruise', 100).line).toBeCloseTo(MISSILES.cruise.lineMax, 5)
    expect(hit('tactical', 100).army).toBeCloseTo(MISSILES.tactical.armyMax, 5)
    expect(hit('ballistic', 100).pop).toBeCloseTo(MISSILES.ballistic.peopleMax, 5)
    const low = hit('hypersonic', 100, (s) => {
      s.regions.r1.line = 3
    })
    expect(low.s.regions.r1.line).toBeCloseTo(0.5, 5)
  })

  it('a strike never heals a line that a battle has already worn below half a point', () => {
    const r = hit('cruise', 8, (s) => {
      s.regions.r1.line = 0.2
    })
    expect(r.s.regions.r1.line).toBeLessThanOrEqual(0.2)
  })
})

describe('shields matter without nullifying', () => {
  it('each level stops a bigger share, cruise missiles are the easiest to shoot down and ballistic ones the hardest', () => {
    for (const k of MISSILE_TYPES) {
      let last = 1.01
      for (const shield of [0, 1, 2, 3]) {
        const through = getsThrough(shield, k)
        expect(through).toBeLessThan(last)
        last = through
      }
      expect(getsThrough(0, k)).toBe(1)
    }
    for (const shield of [1, 2, 3]) {
      expect(getsThrough(shield, 'cruise')).toBeLessThan(getsThrough(shield, 'hypersonic'))
      expect(getsThrough(shield, 'ballistic')).toBeGreaterThan(getsThrough(shield, 'hypersonic'))
    }
    // The best shield still lets a real share of the heavy missiles through, and never stops everything.
    expect(getsThrough(3, 'cruise')).toBeGreaterThanOrEqual(0.2)
    expect(getsThrough(3, 'ballistic')).toBeGreaterThanOrEqual(0.5)
  })

  it('one cruise missile shot down stops no factories, and it takes a few to get through a shield', () => {
    const stops = (kind: MissileType, count: number, shield: number) => {
      const s = war()
      s.nations.r1.systems.shield = shield
      strikeHitsKind(s, map, 'r0', 'r1', kind, count)
      return s.regions.r1.sabotaged > 0
    }
    expect(stops('cruise', 1, 0)).toBe(false)
    expect(stops('cruise', 2, 0)).toBe(false)
    expect(stops('cruise', 3, 0)).toBe(true)
    expect(stops('cruise', 3, 3)).toBe(false)
    expect(stops('cruise', 12, 3)).toBe(true)
    // The older weapon keeps its rule: a hypersonic missile stops factories through any shield.
    expect(stops('hypersonic', 1, 0)).toBe(true)
    expect(stops('hypersonic', 1, 3)).toBe(true)
    expect(stops('ballistic', 1, 3)).toBe(true)
  })

  it('the shield thins every effect of a salvo', () => {
    const run = (kind: MissileType, shield: number) => {
      const s = war()
      s.nations.r1.systems.shield = shield
      const before = { line: s.regions.r1.line, army: totalUnits(s.nations.r1.military.units), pop: s.regions.r1.population }
      strikeHitsKind(s, map, 'r0', 'r1', kind, 8)
      return { line: before.line - s.regions.r1.line, army: before.army - totalUnits(s.nations.r1.military.units), pop: before.pop - s.regions.r1.population }
    }
    expect(run('cruise', 2).line).toBeLessThan(run('cruise', 0).line)
    expect(run('cruise', 3).line).toBeGreaterThan(0)
    expect(run('tactical', 2).army).toBeLessThan(run('tactical', 0).army)
    expect(run('ballistic', 3).pop).toBeLessThan(run('ballistic', 0).pop)
  })
})

describe('what a missile costs against what it does', () => {
  /** Money for each point of Defense Line a kind takes off, through a shield of this level. */
  const perLinePoint = (kind: MissileType, shield: number) => MISSILES[kind].money / (MISSILES[kind].line * getsThrough(shield, kind))

  it('breaking a line with cruise missiles is never free: 20 money a point or more, and more again behind a shield', () => {
    expect(perLinePoint('cruise', 0)).toBeGreaterThanOrEqual(20)
    expect(perLinePoint('cruise', 2)).toBeGreaterThanOrEqual(2 * 20)
    expect(perLinePoint('cruise', 3)).toBeGreaterThanOrEqual(4 * 20)
    // Ballistic missiles are dearer per point, and what they add (buildings, people) is paid for in goodwill.
    expect(perLinePoint('ballistic', 0)).toBeGreaterThan(perLinePoint('cruise', 0))
    expect(MISSILES.ballistic.opinion).toBeLessThanOrEqual(-10)
    expect(MISSILES.ballistic.infamy).toBeGreaterThanOrEqual(3)
  })

  it('a full month of the best program takes a line of about ten points down to the floor only with a couple of months of income', () => {
    // 18 a month, 4.5 points. Ten points is two months of production and well over a hundred money.
    const monthly = MISSILE_PROGRAM.capacity[3] * MISSILES.cruise.line
    expect(monthly).toBeLessThanOrEqual(5)
    expect(MISSILE_PROGRAM.capacity[3] * MISSILES.cruise.money).toBeGreaterThanOrEqual(100)
    // The same month of ballistic missiles is a month of the economy for a large nation.
    expect(MISSILE_PROGRAM.capacity[3] * MISSILES.ballistic.money).toBeGreaterThanOrEqual(500)
  })

  it('missiles only crack the line: an army must still win the last half point', () => {
    const s = war()
    s.nations.r0.arsenal = { cruise: 400 }
    for (let i = 0; i < 40; i++) strikeHitsKind(s, map, 'r0', 'r1', 'cruise', 10)
    expect(s.regions.r1.line).toBeCloseTo(0.5, 5)
    expect(s.regions.r1.owner).toBe('r1')
  })
})

describe('rivals answer, but not without end', () => {
  it('a struck Hard rival with missiles fires back at the one who hit it, at most one salvo a month', () => {
    const s = war()
    s.settings.difficulty = 'hard'
    s.nations.r0.isPlayer = false
    s.nations.r0.arsenal = { cruise: 10 }
    s.nations.r1.arsenal = { cruise: 30 }
    s.regions.r1.buildings.factory = 3
    s.nations.r1.resources.capital = 3000
    ok(s, fire('cruise', 6))
    expect(s.nations.r1.struckBy?.r0).toBe(s.turn)
    const orders = generateAllBotOrders(s, map)
    const answers = orders.filter((o): o is Extract<Order, { type: 'strike' }> => o.type === 'strike' && o.nationId === 'r1' && o.weapon === 'missile')
    expect(answers).toHaveLength(1)
    expect(s.regions[answers[0].target].owner).toBe('r0')
    expect(answers[0].count).toBeLessThanOrEqual(6)
  })

  it('two Hard rivals trading missiles can fire only what they have and build: a year of war stays bounded', () => {
    let s = war()
    s.settings.difficulty = 'hard'
    s.nations.r0.isPlayer = false
    s.humans = []
    s.nextEventTurn = 9999
    for (const id of ['r0', 'r1']) {
      s.nations[id].arsenal = { cruise: 24 }
      s.nations[id].missileProgram = 2
      s.nations[id].resources.capital = 4000
      s.nations[id].resources.steel = 400
      s.regions[id].buildings.factory = 3
    }
    s.wars = ['r0|r1']
    let fired = 0
    let built = 0
    for (let i = 0; i < 12; i++) {
      const orders = generateAllBotOrders(s, map).filter((o) => o.nationId === 'r0' || o.nationId === 'r1')
      for (const o of orders) {
        if (o.type === 'strike' && o.weapon === 'missile') fired += o.count ?? 1
        if (o.type === 'buildMissiles') built += o.count
      }
      expect(orders.filter((o) => o.type === 'strike').length).toBeLessThanOrEqual(2 * 2)
      s = resolveTurn(s, map, orders)
      s.outcome = 'playing'
    }
    // Nothing is fired that was not in store or built, and each is capped by what the program can make.
    expect(fired).toBeLessThanOrEqual(2 * 24 + built)
    expect(built).toBeLessThanOrEqual(2 * 12 * MISSILE_PROGRAM.capacity[2])
    expect(s.nations.r0.arsenal?.cruise ?? 0).toBeGreaterThanOrEqual(0)
    checkInvariants(s)
  })
})

describe('missile numbers stay in range', () => {
  it('a month of building and firing keeps every count a whole, non-negative number', () => {
    let s = war()
    s.nations.r0.missileProgram = 3
    s.nations.r0.arsenal = { cruise: 3, tactical: 2, ballistic: 1 }
    s = resolveTurn(s, map, [build('cruise', 4), build('tactical', 3), fire('cruise', 5), fire('tactical', 4), fire('ballistic', 1)])
    const a = s.nations.r0.arsenal!
    expect(a.cruise).toBe(2)
    expect(a.tactical).toBe(1)
    expect(a.ballistic).toBe(0)
    expect(s.nations.r0.missileBuilt).toEqual({ turn: 1, count: 7 })
    checkInvariants(s)
  })

  it('totalUnits ignores the arsenal: cruise and ballistic missiles are not soldiers', () => {
    const s = war()
    s.nations.r0.arsenal = { cruise: 100, ballistic: 100 }
    expect(totalUnits(s.nations.r0.military.units)).toBeLessThan(100)
  })
})
