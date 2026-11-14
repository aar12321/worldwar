import { describe, expect, it } from 'vitest'
import { LIVE } from '../../data/live'
import { WAR } from '../../data/war'
import { armyAt, greatCircle, planTrip, travelDays, tripSchedule } from '../armies'
import { absDay, clockOf } from '../calendar'
import { computeEconomy } from '../economy'
import { forceUnits, totalUnits } from '../helpers'
import { advanceDay, startLive, type LiveEvent } from '../live'
import { isMonthEndOrder, orderCost, validateOrder } from '../orders'
import { applyOrderNow } from '../resolveTurn'
import { advise } from '../advisor'
import { addUnitToMilitary } from '../training'
import type { GameState, Order, WorldMap } from '../types'
import { humanStatus } from '../victory'
import { killNation } from '../warfare'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)
const none = () => []

/** r0 (the player) is at war with its neighbor r1. */
function war(m: WorldMap = map) {
  const s = startLive(startState(m))
  s.wars.push('r0|r1')
  s.nations.r0.resources.capital = 3000
  s.nations.r0.resources.steel = 200
  setMilitary(s, 'r0', { infantry: 20, armor: 6, artillery: 4, fighter: 2, missile: 6 })
  setMilitary(s, 'r1', { infantry: 2 })
  s.regions.r1.line = 3
  return s
}
const attack = (extra: Partial<Extract<Order, { type: 'attack' }>> = {}, target = 'r1'): Order => ({ type: 'attack', nationId: 'r0', target, commit: 'main', stance: 'assault', ...extra })

/** Moves the game on by days, collecting what happened. */
function run(s: GameState, days: number, m: WorldMap = map) {
  const events: LiveEvent[] = []
  for (let i = 0; i < days; i++) {
    const step = advanceDay(s, m, { planner: none })
    s = step.state
    events.push(...step.events)
  }
  return { s, events }
}
const battles = (events: LiveEvent[]) => events.flatMap((e) => (e.kind === 'battle' ? [e] : []))
const total = (s: GameState, id = 'r0') => totalUnits(forceUnits(s, id))

describe('sending an army', () => {
  it('takes the units out of the military and sets out the next day, a short march away', () => {
    const s = war()
    const before = total(s)
    const result = applyOrderNow(s, map, attack())
    expect(result.error).toBeNull()
    const army = result.army!
    expect(s.armies).toHaveLength(1)
    expect(army.via).toBe('land')
    expect(army.bySea).toBe(false)
    expect(army.home).toBe('r0')
    expect(army.phase).toBe('outbound')
    expect(army.start).toBe(clockOf(s) + LIVE.musterDays)
    expect(army.end - army.start).toBe(travelDays(556, 'land'))
    // Two thirds of everything leaves; the rest stays home. Nothing is lost or made.
    expect(army.units.infantry).toBeCloseTo(20 * 0.66)
    expect(s.nations.r0.military.units.infantry).toBeCloseTo(20 * 0.34)
    expect(total(s)).toBeCloseTo(before)
    // Nothing has been fought yet.
    expect(s.battles).toHaveLength(0)
    expect(s.regions.r1.line).toBe(3)
    expect(s.nations.r0.military.exposed).toBe(0)
  })

  it('fights on arrival, rests a day, marches home, and the survivors rejoin the military', () => {
    const s = war()
    const start = total(s)
    const launched = applyOrderNow(s, map, attack({ missiles: 4 })).army!
    expect(launched.units.missile).toBe(4)
    expect(s.nations.r0.military.units.missile).toBe(2)
    const { s: after, events } = run(s, launched.end - clockOf(s))
    const fought = battles(events)
    expect(fought).toHaveLength(1)
    expect(fought[0].report.armyId).toBe(launched.id)
    expect(fought[0].report.attacker.nationId).toBe('r0')
    expect(fought[0].report.winner).toBe('attacker')
    // The war is won with the army still abroad, and the army is "fighting" for the day the show lasts.
    const army = after.armies![0]
    expect(army.phase).toBe('fighting')
    expect(army.end - army.start).toBe(LIVE.battleDays)
    // The carried missiles were all fired and used up.
    expect(army.units.missile).toBe(0)
    // Then it marches home, and arrives.
    const home = run(after, 10)
    expect(home.s.armies).toHaveLength(0)
    expect(home.events.some((e) => e.kind === 'home' && e.army.id === launched.id)).toBe(true)
    const lost = totalUnits(fought[0].report.attacker.losses)
    const missilesUsed = 4 - Math.min(4, fought[0].report.attacker.losses.missile)
    expect(total(home.s)).toBeCloseTo(start - lost - missilesUsed, 4)
    expect(home.s.nations.r0.military.units.missile).toBe(2)
  })

  it('takes the country when the army wins, on the day it arrives', () => {
    const s = war()
    s.regions.r1.line = 0.4
    const army = applyOrderNow(s, map, attack({ stance: 'blitz' })).army!
    const { s: after, events } = run(s, army.end - clockOf(s))
    expect(battles(events)[0].report.captured).toBe(true)
    expect(after.regions.r1.owner).toBe('r0')
    expect(after.armies![0].outcome).toBe('captured')
  })

  it('removes an army that is wiped out, and its units are gone for good', () => {
    const s = war()
    setMilitary(s, 'r0', { infantry: 3 })
    setMilitary(s, 'r1', { infantry: 300, armor: 100 })
    s.regions.r1.line = 6
    const army = applyOrderNow(s, map, attack({ commit: 'probe' })).army!
    const { s: after, events } = run(s, army.end - clockOf(s))
    const fight = battles(events)[0]
    expect(fight.report.winner).toBe('defender')
    expect(fight.destroyed).toBe(true)
    expect(after.armies).toHaveLength(0)
    expect(after.nations.r0.military.units.infantry).toBeLessThan(3 * 0.67 + 1e-9)
  })

  it('counts an army against the month, and the limit starts over with the month', () => {
    const s = war()
    // A strong defender, so the country is not taken and the same target stays open the next month.
    setMilitary(s, 'r1', { infantry: 60, armor: 20 })
    const limit = WAR.maxAttacksPerTurn
    for (let i = 0; i < limit; i++) expect(applyOrderNow(s, map, attack({ commit: 'probe' })).error).toBeNull()
    expect(validateOrder(s, map, attack({ commit: 'probe' }))).toMatch(/already sent/)
    // The next month it can send another.
    let cur = s
    while (cur.turn === 1) cur = advanceDay(cur, map, { planner: none }).state
    expect(validateOrder(cur, map, attack({ commit: 'probe' }))).toBeNull()
  })

  it('cannot send what is not at home', () => {
    const s = war()
    setMilitary(s, 'r0', {})
    expect(validateOrder(s, map, attack())).toMatch(/No troops at home/)
  })

  it('pays the stance cost once, when it sets out', () => {
    const s = war()
    const money = s.nations.r0.resources.capital
    const cost = orderCost(s, attack({ stance: 'blitz' })).capital
    expect(cost).toBeGreaterThan(0)
    applyOrderNow(s, map, attack({ stance: 'blitz' }))
    expect(s.nations.r0.resources.capital).toBeCloseTo(money - cost)
  })

  it('fights the home army and garrison of the defender, and not what it has sent out itself', () => {
    const s = war()
    // On Easy the defender does not call its army home when it sees ours coming, so only what is home defends.
    s.settings.difficulty = 'easy'
    setMilitary(s, 'r1', { infantry: 6 })
    // The defender has sent half of an army out: only what is home defends.
    s.armies!.push({ id: 'ax', nationId: 'r1', units: { infantry: 6, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }, commit: 'main', stance: 'assault', share: 0.5, via: 'land', bySea: false, home: 'r1', target: 'r0', phase: 'outbound', from: { lat: 0, lng: 5 }, to: { lat: 0, lng: 0 }, start: 50, end: 52, launched: 0 })
    const army = applyOrderNow(s, map, attack()).army!
    const { events } = run(s, army.end - clockOf(s))
    const side = battles(events).find((e) => e.armyId === army.id)!.report.defender
    expect(side.units.infantry).toBeLessThan(6 + 3)
  })
})

describe('roads, sea lanes, fleets and aircraft', () => {
  const sea = (setup: (m: WorldMap) => void) => {
    const m = lineMap(8)
    setup(m)
    const s = startLive(startState(m))
    s.wars.push('r0|r6')
    s.nations.r0.resources.capital = 3000
    setMilitary(s, 'r0', { infantry: 12, naval: 2, fighter: 2 })
    setMilitary(s, 'r6', { infantry: 2 })
    s.regions.r0.buildings.port = 1
    s.regions.r0.buildings.factory = 1
    return { m, s }
  }

  it('crosses a short sea lane from a port', () => {
    const { m, s } = sea((m) => {
      m.regions.r6.seaLanes = ['r0']
    })
    const trip = planTrip(s, m, 'r0', 'r6')!
    expect(trip.via).toBe('lane')
    expect(trip.bySea).toBe(true)
    expect(trip.from).toBe('r0')
    expect(trip.days).toBe(travelDays(trip.km, 'lane'))
    expect(trip.days).toBeGreaterThanOrEqual(LIVE.travel.lane.min)
    expect(trip.days).toBeLessThanOrEqual(LIVE.travel.lane.max)
  })

  it('sails a fleet to any coast in range', () => {
    const { m, s } = sea((m) => {
      m.regions.r6.coastal = true
    })
    const trip = planTrip(s, m, 'r0', 'r6')!
    expect(trip.via).toBe('fleet')
    expect(trip.bySea).toBe(true)
    expect(trip.days).toBe(travelDays(trip.km, 'fleet'))
  })

  it('flies from an airbase, and is the quickest', () => {
    const { m, s } = sea(() => {})
    const trip = planTrip(s, m, 'r0', 'r6')!
    expect(trip.via).toBe('air')
    expect(trip.days).toBeLessThanOrEqual(LIVE.travel.air.max)
    const road = lineMap(8)
    const walking = planTrip(startState(road), road, 'r0', 'r1')!
    expect(walking.via).toBe('land')
    expect(travelDays(trip.km, 'air')).toBeLessThan(travelDays(trip.km, 'fleet'))
  })

  it('leaves from the nearest country that qualifies, and the orders sail', () => {
    const { m, s } = sea((m) => {
      m.regions.r6.coastal = true
    })
    s.regions.r3.owner = 'r0'
    s.regions.r3.buildings.port = 1
    s.nations.r3.alive = false
    expect(planTrip(s, m, 'r0', 'r6')!.from).toBe('r3')
    const army = applyOrderNow(s, m, { type: 'attack', nationId: 'r0', target: 'r6', commit: 'main', stance: 'assault' }).army!
    expect(army.home).toBe('r3')
    const { s: after, events } = run(s, army.end - clockOf(s), m)
    expect(battles(events)).toHaveLength(1)
    expect(after.armies![0].phase === 'fighting' || after.regions.r6.owner === 'r0').toBe(true)
  })

  it('works out the days an army would be away, to show before it goes', () => {
    const trip = { via: 'land' as const, bySea: false, from: 'r0', km: 556, days: 2 }
    expect(tripSchedule(trip, 100)).toEqual({ leaves: 101, arrives: 103, homeBy: 106 })
  })
})

describe('on the road', () => {
  it('moves smoothly from the launch country to the target, along the shortest path', () => {
    const s = war()
    const army = applyOrderNow(s, map, attack()).army!
    expect(armyAt(army, army.start).progress).toBe(0)
    expect(armyAt(army, army.end).progress).toBe(1)
    const mid = armyAt(army, (army.start + army.end) / 2)
    expect(mid.progress).toBeCloseTo(0.5)
    expect(mid.lng).toBeGreaterThan(0)
    expect(mid.lng).toBeLessThan(5)
    expect(mid.alt).toBeGreaterThan(0)
    expect(armyAt(army, army.start - 5).progress).toBe(0)
    expect(greatCircle({ lat: 10, lng: 20 }, { lat: 10, lng: 20 }, 0.5)).toEqual({ lat: 10, lng: 20 })
    const half = greatCircle({ lat: 0, lng: 0 }, { lat: 0, lng: 90 }, 0.5)
    expect(half.lat).toBeCloseTo(0)
    expect(half.lng).toBeCloseTo(45)
  })

  it('can be recalled, and takes as long to get back as it has marched', () => {
    const s = war()
    const army = applyOrderNow(s, map, attack()).army!
    let cur = run(s, 2).s // one day into a two day march
    expect(validateOrder(cur, map, { type: 'recall', nationId: 'r0', armyId: army.id })).toBeNull()
    expect(applyOrderNow(cur, map, { type: 'recall', nationId: 'r0', armyId: army.id }).error).toBeNull()
    const back = cur.armies![0]
    expect(back.phase).toBe('returning')
    expect(back.outcome).toBe('recalled')
    expect(back.end - back.start).toBe(1)
    cur = run(cur, 2).s
    expect(cur.armies).toHaveLength(0)
    expect(cur.battles).toHaveLength(0)
    expect(total(cur)).toBeCloseTo(38)
    expect(cur.regions.r1.line).toBe(3)
  })

  it('is back at once if recalled before it has set out, and still counts as sent', () => {
    const s = war()
    const army = applyOrderNow(s, map, attack()).army!
    expect(applyOrderNow(s, map, { type: 'recall', nationId: 'r0', armyId: army.id }).error).toBeNull()
    expect(s.armies).toHaveLength(0)
    expect(total(s)).toBeCloseTo(38)
    expect(s.nations.r0.military.units.infantry).toBeCloseTo(20)
    expect(s.nations.r0.military.attacksThisTurn).toBe(1)
  })

  it('cannot be recalled by someone else, or once it is fighting or on its way home', () => {
    const s = war()
    const army = applyOrderNow(s, map, attack()).army!
    expect(validateOrder(s, map, { type: 'recall', nationId: 'r1', armyId: army.id })).toMatch(/not yours/)
    expect(validateOrder(s, map, { type: 'recall', nationId: 'r0', armyId: 'nope' })).toMatch(/not yours/)
    const fighting = run(s, army.end - clockOf(s)).s
    expect(validateOrder(fighting, map, { type: 'recall', nationId: 'r0', armyId: army.id })).toMatch(/fighting/)
    const home = run(fighting, 1).s
    expect(validateOrder(home, map, { type: 'recall', nationId: 'r0', armyId: army.id })).toMatch(/on its way home/)
    expect(validateOrder(startState(map), map, { type: 'recall', nationId: 'r0', armyId: 'a1' })).toMatch(/live game/)
  })

  it('turns back when peace is made, and does not fight', () => {
    const s = war()
    const army = applyOrderNow(s, map, attack()).army!
    const mid = run(s, 2).s
    mid.wars = []
    const { s: after, events } = run(mid, 1)
    expect(events.some((e) => e.kind === 'turnedBack' && e.why === 'peace')).toBe(true)
    expect(battles(events)).toHaveLength(0)
    expect(after.armies![0].phase).toBe('returning')
    expect(run(after, 5).s.armies).toHaveLength(0)
    expect(total(run(after, 5).s)).toBeCloseTo(38)
    expect(army.id).toBe(after.armies![0].id)
  })

  it('turns back when the country it was going for is already its own', () => {
    const s = war()
    applyOrderNow(s, map, attack())
    const mid = run(s, 2).s
    mid.regions.r1.owner = 'r0'
    const { events } = run(mid, 1)
    expect(events.some((e) => e.kind === 'turnedBack' && e.why === 'taken')).toBe(true)
    expect(battles(events)).toHaveLength(0)
  })

  it('is lost with its nation', () => {
    const s = war()
    applyOrderNow(s, map, attack())
    killNation(s, 'r0', 'r1')
    expect(s.armies).toHaveLength(0)
  })
})

describe('what an army in the field costs and means', () => {
  it('still costs the same upkeep, food and oil, since the units still exist', () => {
    const s = war()
    const before = computeEconomy(s, map, 'r0')
    applyOrderNow(s, map, attack())
    const after = computeEconomy(s, map, 'r0')
    expect(after.upkeep).toBeCloseTo(before.upkeep)
    expect(after.netFood).toBeCloseTo(before.netFood)
    expect(after.warBills.map((b) => b.amount)).toEqual(before.warBills.map((b) => b.amount))
  })

  it('a new recruit is green beside the whole force, the army abroad included', () => {
    const s = war()
    s.nations.r0.military.drill.infantry = 4
    applyOrderNow(s, map, attack())
    addUnitToMilitary(s, 'r0', 'infantry')
    // 4 * 20 / 21, not 4 * 6.8 / 7.8, because most of the infantry is out in the army.
    expect(s.nations.r0.military.drill.infantry).toBe(4)
    expect(s.nations.r0.military.units.infantry).toBeCloseTo(20 * 0.34 + 1)
  })

  it('a nation whose capital fell is not beaten while it has an army in the field', () => {
    const s = war()
    s.nations.r0.resources.capital = 0
    s.nations.r0.originalCapital = 'r2'
    s.regions.r2.owner = 'r1'
    s.nations.r2.alive = false
    s.trainingQueue = []
    s.regions.r3.owner = 'r0'
    setMilitary(s, 'r0', { infantry: 6 })
    applyOrderNow(s, map, attack({ commit: 'allin' }))
    expect(totalUnits(s.nations.r0.military.units)).toBeLessThan(0.1)
    expect(humanStatus(s, 'r0', map)).toBe('playing')
  })

  it('units that are away do not defend the home country', () => {
    const s = war()
    s.wars.push('r0|r2')
    setMilitary(s, 'r2', { infantry: 20, armor: 6 })
    setMilitary(s, 'r0', { infantry: 20 })
    const stay = structuredClone(s)
    applyOrderNow(s, map, attack({ commit: 'allin' }))
    expect(s.nations.r0.military.units.infantry).toBe(0)
    expect(stay.nations.r0.military.units.infantry).toBe(20)
  })
})

describe('hypersonic missiles in a live game', () => {
  const salvo = (count: number, target = 'r1'): Order => ({ type: 'strike', nationId: 'r0', target, weapon: 'missile', count })

  it('are not held for the month end', () => {
    expect(isMonthEndOrder(startState(map), 'strike')).toBe(true)
    expect(isMonthEndOrder(war(), 'strike')).toBe(false)
    expect(isMonthEndOrder(startState(map), 'respond')).toBe(true)
    expect(isMonthEndOrder(war(), 'respond')).toBe(false)
    expect(isMonthEndOrder(war(), 'setPolicy')).toBe(true)
  })

  it('leave at once, and land a day later', () => {
    const s = war()
    s.regions.r0.buildings.factory = 1
    s.regions.r1.line = 6.4
    expect(applyOrderNow(s, map, salvo(3)).error).toBeNull()
    expect(s.nations.r0.military.units.missile).toBe(3)
    expect(s.flights).toHaveLength(1)
    expect(s.flights![0].lands).toBe(clockOf(s) + LIVE.missileDays)
    expect(s.regions.r1.line).toBe(6.4)
    const { s: after, events } = run(s, 1)
    expect(after.flights).toHaveLength(0)
    expect(after.regions.r1.line).toBeLessThan(6.4)
    expect(events.find((e) => e.kind === 'missile')).toMatchObject({ landed: true })
  })

  it('can be fired again the same month, as long as there are missiles', () => {
    const s = war()
    s.regions.r0.buildings.factory = 1
    expect(applyOrderNow(s, map, salvo(3)).error).toBeNull()
    expect(applyOrderNow(s, map, salvo(3)).error).toBeNull()
    expect(validateOrder(s, map, salvo(1))).toMatch(/No missiles left|Needs hypersonic/)
    expect(s.flights).toHaveLength(2)
  })

  it('are wasted if the war ends while they fly', () => {
    const s = war()
    s.regions.r0.buildings.factory = 1
    s.regions.r1.line = 6.4
    applyOrderNow(s, map, salvo(3))
    s.wars = []
    const { s: after, events } = run(s, 1)
    expect(after.regions.r1.line).toBe(6.4)
    expect(events.find((e) => e.kind === 'missile')).toMatchObject({ landed: false })
  })

  it('an orbital strike still hits at once', () => {
    const s = war()
    s.nations.r0.systems.orbital = 1
    s.nations.r0.resources.pp = 100
    s.regions.r1.line = 6.4
    expect(applyOrderNow(s, map, { type: 'strike', nationId: 'r0', target: 'r1', weapon: 'orbital' }).error).toBeNull()
    expect(s.regions.r1.line).toBeLessThan(6.4)
    expect(s.flights).toHaveLength(0)
  })

  it('a shield stops part of a salvo', () => {
    const open = war()
    const shielded = war()
    shielded.nations.r1.systems.shield = 3
    for (const s of [open, shielded]) {
      s.regions.r0.buildings.factory = 1
      s.regions.r1.line = 6.4
      applyOrderNow(s, map, salvo(4))
    }
    expect(run(shielded, 1).s.regions.r1.line).toBeGreaterThan(run(open, 1).s.regions.r1.line)
  })

  it('a day of the clock is the same as a day of the calendar', () => {
    const s = war()
    expect(clockOf(s)).toBe(absDay(1, 0))
  })
})

describe('the advisor in a live game', () => {
  it('warns about an enemy army marching on you, with the days left, and points to the armies', () => {
    const s = war()
    s.armies!.push({ id: 'in1', nationId: 'r1', units: { infantry: 9, armor: 2, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }, commit: 'main', stance: 'assault', share: 0.66, via: 'land', bySea: false, home: 'r1', target: 'r0', phase: 'outbound', from: { lat: 0, lng: 5 }, to: { lat: 0, lng: 0 }, start: 0, end: 4, launched: 0 })
    const item = advise(s, map, 'r0', [], 20).find((a) => a.id === 'incoming-in1')!
    expect(item).toBeTruthy()
    expect(item.urgency).toBe('now')
    expect(item.detail).toMatch(/arrive in 4 days/)
    expect(item.target).toEqual({ desk: 'military', tab: 'armies' })
    // Your own armies are not a warning.
    expect(advise(startLive(startState(map)), map, 'r0', [], 20).some((a) => a.id.startsWith('incoming-'))).toBe(false)
  })
})
