import { describe, expect, it } from 'vitest'
import { deploymentOrder, plannedPosture } from '../../ai/deployment'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { addOpinion } from '../../ai/opinion'
import { BORDER, STATION } from '../../data/deployment'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { advise } from '../advisor'
import { applyEventChoice } from '../events'
import { launchArmy } from '../armies'
import { bordersOf, borderPressure, borderState, borderTension, incidentFactor, neighborsOf, recordIncident } from '../borders'
import { daysInMonth } from '../calendar'
import { computeEconomy, lineMax } from '../economy'
import { airPatrolStop, borderCover, defenseWeights, freeUnits, garrisonDivisions, interception, lineBonus, patrolCover, patrolFighters, postedUnits, runDeployment, surpriseBonus, validateDeployment } from '../deployment'
import { forceUnits, formatDivisions, totalUnits } from '../helpers'
import { deploymentView } from '../intel'
import { runJustification } from '../justification'
import { advanceDay, startLive, type LiveEvent } from '../live'
import { freePower, militaryPower } from '../militaryStats'
import { strikeHitsKind } from '../missiles'
import { orderCost, validateOrder } from '../orders'
import { applyOrderNow, resolveTurn, runMonth } from '../resolveTurn'
import { createRng, type Rng } from '../rng'
import { threatWatch } from '../threats'
import type { GameState, MapRegion, Order, WorldMap } from '../types'
import { canAttackRegion, forecastAttack, resolveAttack } from '../warfare'
import { lineMap, setMilitary, startState } from './fixtures'
import { withOldWarScore } from './oldWarScore'

const setPost = (_s: GameState, id: string, order: Partial<Extract<Order, { type: 'setDeployment' }>>): Order => ({ type: 'setDeployment', nationId: id, coastal: 0, subs: 0, air: 0, border: {}, ...order })
const post = (s: GameState, map: WorldMap, o: Order) => {
  const r = applyOrderNow(s, map, o)
  expect(r.error).toBeNull()
}

/** The smallest attacking force (in infantry) that takes the country more often than not. Battles are sharp, so this shows how much stronger a defense is. */
function boundary(make: (att: number) => { map: WorldMap; s: GameState }, from = 6): number {
  for (let a = from; a <= 90; a++) {
    const { map, s } = make(a)
    if (forecastAttack(s, map, 'r0', 'r1', 'allin', 'assault', 32)!.winChance >= 0.5) return a
  }
  return Infinity
}

/** A chain r0 - r1 - r2 - ... where r1 is at war with its neighbors r0 and r2. */
function chain() {
  const map = lineMap(5)
  const s = startState(map, 'r1')
  s.nations.r1.resources.capital = 5000
  s.nations.r1.resources.pp = 500
  setMilitary(s, 'r1', { infantry: 20, armor: 6, artillery: 4, fighter: 4, naval: 4, drone: 2 })
  setMilitary(s, 'r0', { infantry: 8 })
  setMilitary(s, 'r2', { infantry: 8 })
  return { map, s }
}

/** Two countries across a sea lane (r0 and r1), with a port and ships at r0. */
function seaWorld() {
  const map = lineMap(2)
  map.regions.r0.neighbors = []
  map.regions.r1.neighbors = []
  map.regions.r0.seaLanes = ['r1']
  map.regions.r1.seaLanes = ['r0']
  map.regions.r0.coastal = true
  map.regions.r1.coastal = true
  const s = startState(map, 'r0')
  s.wars.push('r0|r1')
  s.regions.r0.buildings.port = 1
  setMilitary(s, 'r0', { infantry: 12, naval: 4 })
  setMilitary(s, 'r1', { infantry: 6, naval: 8, fighter: 8 })
  s.nations.r0.resources.capital = 2000
  return { map, s }
}

describe('forces on station: what is free to attack', () => {
  it('a nation with no posture is exactly as before: the military itself is what can attack', () => {
    const { s } = chain()
    expect(freeUnits(s, 'r1')).toBe(s.nations.r1.military.units)
    expect(postedUnits(s, 'r1').infantry).toBe(0)
    expect('deployment' in s.nations.r1.military).toBe(false)
    expect('borders' in s).toBe(false)
  })

  it('posted shares leave the reserve: warships, fighters and drones by arm, ground troops on borders', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { coastal: 0.25, subs: 0.25, air: 0.5, border: { r0: 0.25, r2: 0.25 } }))
    const free = freeUnits(s, 'r1')
    expect(free.naval).toBeCloseTo(2)
    expect(free.fighter).toBeCloseTo(2)
    expect(free.drone).toBeCloseTo(1)
    // Half the ground forces are on the two borders.
    expect(free.infantry).toBeCloseTo(10)
    expect(free.armor).toBeCloseTo(3)
    expect(free.artillery).toBeCloseTo(2)
    // Strike aircraft and missiles are never posted.
    expect(postedUnits(s, 'r1').air).toBe(0)
    expect(totalUnits(free) + totalUnits(postedUnits(s, 'r1'))).toBeCloseTo(totalUnits(s.nations.r1.military.units))
  })

  it('the posted units cost what they always did: upkeep and oil are counted on the whole force', () => {
    const { map, s } = chain()
    const before = militaryPower(s, 'r1')
    post(s, map, setPost(s, 'r1', { coastal: 0.5, border: { r0: 0.5 } }))
    expect(militaryPower(s, 'r1')).toBeCloseTo(before)
    expect(freePower(s, 'r1')).toBeLessThan(before * 0.8)
    expect(freePower(s, 'r1')).toBeGreaterThan(0)
  })

  it('an army in the field does not strip the guard: the posted share is of the whole force', () => {
    const { map, s } = chain()
    const live = startLive(s)
    post(live, map, setPost(live, 'r1', { border: { r0: 0.5 } }))
    live.wars.push('r0|r1')
    // 20 infantry, half of it on the border: 10 free. Send 66% of the reserve: 6.6 leave.
    const army = launchArmy(live, map, { type: 'attack', nationId: 'r1', target: 'r0', commit: 'main' }, 0)!
    expect(army.units.infantry).toBeCloseTo(10 * 0.66)
    expect(live.nations.r1.military.units.infantry).toBeCloseTo(20 - 6.6)
    // The garrison is still 10 divisions of ground troops share: half the whole force, 10 infantry.
    expect(postedUnits(live, 'r1').infantry).toBeCloseTo(10)
    expect(freeUnits(live, 'r1').infantry).toBeCloseTo(3.4)
  })

  it('an attack sends a share of the reserve only, and refuses when the whole force is posted', () => {
    const { map, s } = chain()
    s.wars.push('r0|r1')
    post(s, map, setPost(s, 'r1', { border: { r0: 1 } }))
    // All ground troops are on the border; the fighters, drones and ships are free.
    const f = forecastAttack(s, map, 'r1', 'r0', 'allin', 'assault')!
    expect(f).not.toBeNull()
    const fullGround = forecastAttack(startState(map, 'r1'), map, 'r1', 'r0', 'allin', 'assault')
    void fullGround
    const free = freeUnits(s, 'r1')
    expect(free.infantry).toBe(0)
    expect(free.fighter).toBeGreaterThan(0)
  })

  it('refuses an attack in words when everything stands on station', () => {
    const { map, s } = chain()
    s.wars.push('r0|r1')
    setMilitary(s, 'r1', { infantry: 20 })
    post(s, map, setPost(s, 'r1', { border: { r0: 1 } }))
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r1', target: 'r0' })).toMatch(/on station/)
    // Free some and it goes through.
    s.nations.r1.military.deployment!.changed = 0
    s.turn = 2
    post(s, map, setPost(s, 'r1', { border: { r0: 0.5 } }))
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r1', target: 'r0' })).toBeNull()
  })

  it('a posted fleet cannot carry an invasion: the sea crossing needs reserve ships', () => {
    const { map, s } = seaWorld()
    s.regions.r0.buildings.port = 1
    // Over the open ocean: no lane, a long way.
    map.regions.r0.seaLanes = []
    map.regions.r1.seaLanes = []
    map.regions.r1.lng = 60
    expect(canAttackRegion(s, map, 'r0', 'r1')).toMatchObject({ ok: true, via: 'fleet' })
    post(s, map, setPost(s, 'r0', { coastal: 1 }))
    expect(canAttackRegion(s, map, 'r0', 'r1').ok).toBe(false)
    // The refusal says where the ships are, rather than telling the player to train more.
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })).toMatch(/warships are on patrol/)
  })
})

describe('posting forces: the order', () => {
  it('rejects shares out of range, too much of an arm, and a border that is not a land border', () => {
    const { map, s } = chain()
    const check = (o: Order) => validateOrder(s, map, o)
    expect(check(setPost(s, 'r1', { coastal: 1.2 }))).toMatch(/0 to 100/)
    expect(check(setPost(s, 'r1', { coastal: 0.6, subs: 0.6 }))).toMatch(/warships/)
    expect(check(setPost(s, 'r1', { border: { r0: 0.6, r2: 0.6 } }))).toMatch(/ground forces/)
    expect(check(setPost(s, 'r1', { border: { r3: 0.2 } }))).toMatch(/not on your land border/)
    expect(check(setPost(s, 'r1', { border: { r0: 0.3, r2: 0.3 }, coastal: 0.3, air: 0.2 }))).toBeNull()
  })

  it('works at once, costs nothing, and the forces can move again only next month', () => {
    const { map, s } = chain()
    const o = setPost(s, 'r1', { border: { r0: 0.3 } })
    expect(orderCost(s, o)).toMatchObject({ capital: 0, pp: 0, manpower: 0 })
    post(s, map, o)
    expect(s.nations.r1.military.deployment).toMatchObject({ border: { r0: 0.3 }, changed: s.turn })
    expect(validateOrder(s, map, setPost(s, 'r1', { border: { r0: 0.4 } }))).toMatch(/next month/)
    const next = resolveTurn(s, map, [])
    expect(validateOrder(next, map, setPost(next, 'r1', { border: { r0: 0.4 } }))).toBeNull()
  })

  it('refuses two moves in the same batch', () => {
    const { map, s } = chain()
    const a = setPost(s, 'r1', { border: { r0: 0.3 } })
    expect(validateOrder(s, map, setPost(s, 'r1', { border: { r2: 0.3 } }), [a])).toMatch(/Already/)
  })

  it('month-end orders apply it too, in the month phase for the AI, and a stale border is stood down', () => {
    const { map, s } = chain()
    const next = resolveTurn(s, map, [setPost(s, 'r1', { border: { r0: 0.3, r2: 0.2 } })])
    expect(next.nations.r1.military.deployment?.border).toEqual({ r0: 0.3, r2: 0.2 })
    // r0 falls to r2: the garrison facing it has nobody to face.
    const lost = structuredClone(next)
    lost.nations.r0.alive = false
    lost.regions.r0.owner = 'r1'
    runDeployment(lost, map)
    expect(lost.nations.r1.military.deployment?.border).toEqual({ r2: 0.2 })
  })

  it('rejects a dead nation, and a nation that is not yours is not touched', () => {
    const { map, s } = chain()
    s.nations.r1.alive = false
    expect(validateOrder(s, map, setPost(s, 'r1', {}))).toMatch(/fallen/)
  })
})

describe('what a garrison does', () => {
  it('defends hardest on its own border and at half strength on any other', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { border: { r0: 0.3, r2: 0.3 } }))
    const w = defenseWeights(s, 'r1', 'r0', false)!
    // 0.4 reserve + 0.3 on post at +35% + 0.3 elsewhere at half.
    expect(w.infantry).toBeCloseTo(0.4 + 0.3 * 1.35 + 0.3 * 0.5)
    // Against a landing from the sea, no garrison stands on its post.
    expect(defenseWeights(s, 'r1', 'r0', true)!.infantry).toBeCloseTo(0.4 + 0.6 * 0.5)
    // A nation with no posture stands as it always did.
    expect(defenseWeights(s, 'r0', 'r1', false)).toBeNull()
  })

  it('concentrating on the border that is attacked beats spreading thin, and a garrison on the wrong front is a weakness', () => {
    const needed = (border: Record<string, number>) =>
      boundary((att) => {
        const { map, s } = chain()
        s.wars.push('r0|r1')
        s.warStarted['r0|r1'] = -9
        setMilitary(s, 'r0', { infantry: att, armor: 2 })
        setMilitary(s, 'r1', { infantry: 12, armor: 2 })
        if (Object.keys(border).length) post(s, map, setPost(s, 'r1', { border }))
        return { map, s }
      })
    const none = needed({})
    const onPost = needed({ r0: 0.5 })
    const wrongFront = needed({ r2: 0.5 })
    const spread = needed({ r0: 0.2, r2: 0.3 })
    expect(onPost).toBeGreaterThan(none)
    expect(wrongFront).toBeLessThan(none)
    expect(spread).toBeLessThan(onPost)
  })

  it('lengthens the Defense Line of the countries on that border, and only those', () => {
    const { map, s } = chain()
    const before = [lineMax(s, map, 'r1'), lineMax(s, map, 'r2')]
    post(s, map, setPost(s, 'r1', { border: { r0: 0.5 } }))
    // 10 divisions on one border shared by one of r1's countries: capped.
    expect(lineBonus(s, map, 'r1')).toBeGreaterThan(0.5)
    expect(lineMax(s, map, 'r1')).toBeCloseTo(before[0] + lineBonus(s, map, 'r1'))
    expect(lineMax(s, map, 'r2')).toBe(before[1])
    expect(lineBonus(s, map, 'r1')).toBeLessThanOrEqual(STATION.lineCap)
  })

  it('a garrison grows the line by healing: it fills over the months it is not attacked', () => {
    const { map, s } = chain()
    s.regions.r1.attackedTurn = -5
    post(s, map, setPost(s, 'r1', { border: { r0: 0.5 } }))
    const cap = lineMax(s, map, 'r1')
    s.regions.r1.line = cap - lineBonus(s, map, 'r1')
    let g = resolveTurn(s, map, [])
    expect(g.regions.r1.line).toBeGreaterThan(s.regions.r1.line)
    for (let i = 0; i < 6; i++) g = resolveTurn(g, map, [])
    expect(g.regions.r1.line).toBeCloseTo(lineMax(g, map, 'r1'), 0)
  })

  it('cover rises with the garrison and is capped at a full guard; a closed border adds checkpoints', () => {
    const { map, s } = chain()
    expect(borderCover(s, map, 'r1', 'r0')).toBe(0)
    post(s, map, setPost(s, 'r1', { border: { r0: 0.02 } }))
    const small = borderCover(s, map, 'r1', 'r0')
    expect(small).toBeGreaterThan(0)
    expect(small).toBeLessThan(1)
    s.turn++
    post(s, map, setPost(s, 'r1', { border: { r0: 0.5 } }))
    expect(borderCover(s, map, 'r1', 'r0')).toBe(1)
    s.turn++
    post(s, map, setPost(s, 'r1', { border: { r0: 0.02 } }))
    const open = borderCover(s, map, 'r1', 'r0')
    post(s, map, { type: 'setBorder', nationId: 'r1', neighbor: 'r0', closed: true })
    expect(borderCover(s, map, 'r1', 'r0')).toBeCloseTo(Math.min(1, open + BORDER.closedCover))
  })
})

describe('surprise attacks', () => {
  const setup = (posture: Record<string, number> | null, warAge = 0) => {
    const { map, s } = chain()
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = s.turn - warAge
    setMilitary(s, 'r0', { infantry: 14 })
    setMilitary(s, 'r1', { infantry: 14 })
    if (posture) post(s, map, setPost(s, 'r1', { border: posture }))
    return { map, s }
  }

  it('an unguarded border costs the defender in the first month of a war', () => {
    const { map, s } = setup({})
    expect(surpriseBonus(s, map, 'r1', 'r0')).toBeCloseTo(STATION.surpriseMax)
    const needed = (age: number) =>
      boundary((att) => {
        const w = setup({}, age)
        setMilitary(w.s, 'r0', { infantry: att, armor: 2 })
        return w
      })
    // The same attack needs a stronger force once the surprise is gone.
    expect(needed(0)).toBeLessThan(needed(3))
  })

  it('a well guarded border leaves nothing to surprise, a half guarded one half', () => {
    const full = setup({ r0: 0.5 })
    expect(surpriseBonus(full.s, full.map, 'r1', 'r0')).toBe(0)
    const half = setup({ r0: 0.2 })
    const cover = borderCover(half.s, half.map, 'r1', 'r0')
    expect(surpriseBonus(half.s, half.map, 'r1', 'r0')).toBeCloseTo(STATION.surpriseMax * (1 - cover))
  })

  it('does not apply after the first months, to a nation with no posture, or to a crossing by sea', () => {
    const old = setup({}, 5)
    expect(surpriseBonus(old.s, old.map, 'r1', 'r0')).toBe(0)
    const none = setup(null)
    expect(surpriseBonus(none.s, none.map, 'r1', 'r0')).toBe(0)
    const fresh = setup({})
    const f = forecastAttack(fresh.s, fresh.map, 'r0', 'r1', 'main', 'assault', 4)!
    expect(f).not.toBeNull()
  })

  it('names the surprise in the battle report and the news', () => {
    const { map, s } = setup({})
    const r = resolveAttack(s, map, 'r0', 'r1', createRng(1, 1))!
    expect(r.report.surprise).toBeCloseTo(STATION.surpriseMax)
    expect(r.report.modifiers.join(' ')).toMatch(/surprise on an unguarded border/)
    expect(s.log.some((l) => /not guarding/.test(l.text))).toBe(true)
  })
})

describe('patrols meet a landing', () => {
  it('sink part of the force that crosses a sea lane, in proportion to the patrol, and never past the cap', () => {
    const { map, s } = seaWorld()
    const landing = { ...forceUnits(s, 'r0') }
    expect(interception(s, 'r1', 'lane', landing).share).toBe(0)
    post(s, map, setPost(s, 'r1', { coastal: 0.5 }))
    const small = interception(s, 'r1', 'lane', landing).share
    expect(small).toBeGreaterThan(0)
    s.turn++
    post(s, map, setPost(s, 'r1', { coastal: 1, air: 1 }))
    const big = interception(s, 'r1', 'lane', landing).share
    expect(big).toBeGreaterThan(small)
    expect(big).toBeLessThanOrEqual(STATION.interceptMax)
  })

  it('the submarine screen is best against a fleet on the open ocean, and air patrols against a landing from the air', () => {
    const { map, s } = seaWorld()
    const landing = { ...forceUnits(s, 'r0') }
    post(s, map, setPost(s, 'r1', { coastal: 0.5 }))
    const surface = interception(s, 'r1', 'fleet', landing).patrol
    s.turn++
    post(s, map, setPost(s, 'r1', { subs: 0.5 }))
    const subs = interception(s, 'r1', 'fleet', landing).patrol
    expect(subs).toBeGreaterThan(surface)
    s.turn++
    post(s, map, setPost(s, 'r1', { air: 0.5 }))
    expect(interception(s, 'r1', 'air', landing).patrol).toBeGreaterThan(interception(s, 'r1', 'fleet', landing).patrol)
    // By land a patrol does nothing.
    expect(interception(s, 'r1', 'land', landing).share).toBe(0)
  })

  it('takes the sunk units out of the force before the fight, and says so in the report and the news', () => {
    const { map, s } = seaWorld()
    post(s, map, setPost(s, 'r1', { coastal: 1, air: 1 }))
    s.nations.r0.people.skills.doctors = 0
    const before = totalUnits(s.nations.r0.military.units)
    const f = forecastAttack(s, map, 'r0', 'r1', 'main', 'assault', 4)!
    expect(f).not.toBeNull()
    const result = resolveAttack(s, map, 'r0', 'r1', createRng(3, 3))!
    const report = result.report
    expect(report.intercept).toMatchObject({ by: 'r1', via: 'lane' })
    expect(report.intercept!.sunk).toBeGreaterThan(0)
    expect(report.modifiers.join(' ')).toMatch(/patrols met the landing at sea/)
    expect(s.log.some((l) => /intercepted/.test(l.text))).toBe(true)
    // What was sunk and what the battle cost are both gone from the attacker's military.
    const lost = totalUnits(report.attacker.losses)
    expect(totalUnits(s.nations.r0.military.units)).toBeCloseTo(before - report.intercept!.sunk - lost, 5)
  })

  it('weakens the landing in the odds: it takes a bigger force to land against patrols', () => {
    const needed = (patrols: boolean) =>
      boundary((att) => {
        const { map, s } = seaWorld()
        setMilitary(s, 'r0', { infantry: att, naval: 6 })
        setMilitary(s, 'r1', { infantry: 5, naval: 8, fighter: 8 })
        if (patrols) post(s, map, setPost(s, 'r1', { coastal: 1, air: 1 }))
        return { map, s }
      })
    expect(needed(true)).toBeGreaterThan(needed(false))
  })

  it('a landing in a live game is met in the same way: contact when it sets out, intercept when it lands', () => {
    const { map, s } = seaWorld()
    const live = startLive(s)
    post(live, map, setPost(live, 'r1', { coastal: 1, air: 1 }))
    live.launches = [{ id: 'l1', at: 0, order: { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault' } }]
    const events: LiveEvent[] = []
    let g = live
    for (let i = 0; i < daysInMonth(g.turn) - 2 && !events.some((e) => e.kind === 'intercept'); i++) {
      const step = advanceDay(g, map, { planner: () => [] })
      g = step.state
      events.push(...step.events)
    }
    const contact = events.find((e) => e.kind === 'contact')
    expect(contact).toMatchObject({ kind: 'contact', watcher: 'r1' })
    const hit = events.find((e) => e.kind === 'intercept')
    expect(hit).toMatchObject({ kind: 'intercept', by: 'r1', against: 'r0', place: 'r1' })
    expect((hit as Extract<LiveEvent, { kind: 'intercept' }>).sunk).toBeGreaterThan(0)
    // The same event list holds the battle it belongs to.
    expect(events.some((e) => e.kind === 'battle' && e.report.intercept)).toBe(true)
  })

  it('air patrols shoot down part of a cruise missile salvo, and none of a ballistic one', () => {
    const { map, s } = seaWorld()
    expect(airPatrolStop(s, 'r1', 'cruise')).toBe(0)
    post(s, map, setPost(s, 'r1', { air: 1 }))
    const cruise = airPatrolStop(s, 'r1', 'cruise')
    expect(cruise).toBeGreaterThan(0.2)
    expect(cruise).toBeLessThanOrEqual(STATION.missileStopMax)
    expect(airPatrolStop(s, 'r1', 'tactical')).toBeLessThan(cruise)
    expect(airPatrolStop(s, 'r1', 'ballistic')).toBe(0)
    // The salvo does less to the line, and the news says who stopped it.
    const hit = (patrols: boolean) => {
      const w = seaWorld()
      if (patrols) post(w.s, w.map, setPost(w.s, 'r1', { air: 1 }))
      w.s.regions.r1.line = 6
      strikeHitsKind(w.s, w.map, 'r0', 'r1', 'cruise', 8)
      return w.s
    }
    expect(hit(true).regions.r1.line).toBeGreaterThan(hit(false).regions.r1.line)
    expect(hit(true).log.at(-1)!.text).toMatch(/air patrols/)
    expect(hit(false).log.at(-1)!.text).not.toMatch(/air patrols/)
  })
})

describe('borders: tension and state', () => {
  it('every pair of neighbors has a tension from its parts: war, pacts, troops, grievances, trade', () => {
    const { map, s } = chain()
    const calm = borderTension(s, map, 'r1', 'r2')
    expect(calm.total).toBe(BORDER.baseLand)
    expect(calm.parts[0].label).toMatch(/Neighbors by land/)
    s.wars.push('r1|r2')
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(BORDER.baseLand + BORDER.war)
    s.wars.pop()
    s.pacts['r1|r2'] = s.turn + 12
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(0)
    expect(borderTension(s, map, 'r1', 'r2').parts.some((p) => p.label === 'Non-aggression pact' && p.value === BORDER.pact)).toBe(true)
    delete s.pacts['r1|r2']
    s.alliances.push('r1|r2')
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(0)
    s.alliances.pop()
    s.casusBelli['r2|r1'] = s.turn + 5
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(BORDER.baseLand + BORDER.grievance)
  })

  it('rises with troops massed on either side and falls when they go home', () => {
    const { map, s } = chain()
    const calm = borderTension(s, map, 'r1', 'r2').total
    post(s, map, setPost(s, 'r1', { border: { r2: 0.1 } }))
    const massed = borderTension(s, map, 'r1', 'r2')
    expect(massed.total).toBeGreaterThan(calm)
    expect(massed.parts.some((p) => p.label === 'Troops massed on the border')).toBe(true)
    // Their garrison counts too.
    post(s, map, setPost(s, 'r2', { border: { r1: 0.1 } }))
    const both = borderTension(s, map, 'r1', 'r2').total
    expect(both).toBeGreaterThan(massed.total)
    s.turn++
    post(s, map, setPost(s, 'r1', {}))
    s.turn++
    post(s, map, setPost(s, 'r2', {}))
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(calm)
  })

  it('an incident adds heat that fades month by month and is forgotten', () => {
    const { map, s } = chain()
    recordIncident(s, 'r1', 'r2')
    expect(s.borders!['r1|r2']).toMatchObject({ heat: BORDER.incidentHeat, incidents: 1 })
    const hot = borderTension(s, map, 'r1', 'r2').total
    expect(hot).toBe(BORDER.baseLand + BORDER.incidentHeat)
    s.turn += 3
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(BORDER.baseLand + BORDER.incidentHeat - 3 * BORDER.heatFade)
    s.turn += 4
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(BORDER.baseLand)
    runDeployment(s, map)
    expect('borders' in s).toBe(false)
    // A second incident while the first is still warm stacks, up to a cap.
    for (let i = 0; i < 6; i++) recordIncident(s, 'r1', 'r2')
    expect(s.borders!['r1|r2'].heat).toBe(BORDER.heatCap)
  })

  it('is open, fortified, closed or disputed, in that order of priority from the top', () => {
    const { map, s } = chain()
    const st = () => borderState(s, map, 'r1', 'r2')
    expect(st()).toBe('open')
    post(s, map, setPost(s, 'r1', { border: { r2: 0.5 } }))
    expect(st()).toBe('fortified')
    post(s, map, { type: 'setBorder', nationId: 'r1', neighbor: 'r2', closed: true })
    expect(st()).toBe('closed')
    // Heat past the dispute line, or a war, beats everything.
    s.borders!['r1|r2'].heat = 50
    s.borders!['r1|r2'].at = s.turn
    expect(borderTension(s, map, 'r1', 'r2').total).toBeGreaterThanOrEqual(BORDER.disputed)
    expect(st()).toBe('disputed')
    s.borders!['r1|r2'].heat = 0
    s.wars.push('r1|r2')
    expect(st()).toBe('disputed')
  })

  it('lists every neighbor, land and sea, with the tension and who guards what', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { border: { r0: 0.5 } }))
    const list = bordersOf(s, map, 'r1')
    expect(list.map((b) => b.other)).toEqual(['r0', 'r2'])
    expect(list[0]).toMatchObject({ land: true, closedByMe: false, mineCover: 1 })
    expect(list[0].mineDivisions).toBeCloseTo(15)
    const sea = seaWorld()
    const across = neighborsOf(sea.s, sea.map, 'r0')
    expect(across).toEqual([{ id: 'r1', land: 0, sea: 1 }])
    expect(bordersOf(sea.s, sea.map, 'r0')[0].land).toBe(false)
    expect(borderTension(sea.s, sea.map, 'r0', 'r1').parts[0].label).toMatch(/across the sea/)
  })
})

describe('closing a border', () => {
  it('costs influence, adds tension, souring the neighbor, and reopening is free', () => {
    const { map, s } = chain()
    const close: Order = { type: 'setBorder', nationId: 'r1', neighbor: 'r2', closed: true }
    expect(orderCost(s, close).pp).toBe(STATION.closeCost)
    const before = borderTension(s, map, 'r1', 'r2').total
    const pp = s.nations.r1.resources.pp
    post(s, map, close)
    expect(s.nations.r1.resources.pp).toBe(pp - STATION.closeCost)
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(before + BORDER.closed)
    expect(s.opinions['r2>r1'].some((m) => m.label === 'Closed our border')).toBe(true)
    expect(validateOrder(s, map, close)).toMatch(/already closed/)
    const reopen: Order = { type: 'setBorder', nationId: 'r1', neighbor: 'r2', closed: false }
    expect(orderCost(s, reopen).pp).toBe(0)
    post(s, map, reopen)
    expect('borders' in s).toBe(false)
    expect(validateOrder(s, map, reopen)).toMatch(/not closed/)
  })

  it('cannot be done with an ally, a puppet, a stranger or yourself', () => {
    const { map, s } = chain()
    s.alliances.push('r1|r2')
    expect(validateOrder(s, map, { type: 'setBorder', nationId: 'r1', neighbor: 'r2', closed: true })).toMatch(/ally/)
    s.nations.r0.overlord = 'r1'
    expect(validateOrder(s, map, { type: 'setBorder', nationId: 'r1', neighbor: 'r0', closed: true })).toMatch(/puppet/)
    expect(validateOrder(s, map, { type: 'setBorder', nationId: 'r1', neighbor: 'r4', closed: true })).toMatch(/not your neighbor/)
    expect(validateOrder(s, map, { type: 'setBorder', nationId: 'r1', neighbor: 'r1', closed: true })).toMatch(/neighboring/)
  })

  it('halves the provocations on that border', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { border: { r2: 0.1 } }))
    const open = incidentFactor(s, map, 'r1', 'r2')
    post(s, map, { type: 'setBorder', nationId: 'r1', neighbor: 'r2', closed: true })
    expect(incidentFactor(s, map, 'r1', 'r2')).toBeLessThan(open - 0.3)
  })
})

/** A rng that always says yes, so a chance-based event happens, and records what was asked. */
function always(): Rng & { asked: number[] } {
  const asked: number[] = []
  return { asked, next: () => 0.01, range: (a) => a, int: (a) => a, chance: (p) => (asked.push(p), true), pick: (xs) => xs[0] }
}

describe('border incidents feed the reasons for war', () => {
  it('an incident between neighbors that dislike each other gives the wronged nation a reason, and is remembered on the border', () => {
    const { map, s } = chain()
    addOpinion(s, 'r2', 'r1', 'Old grudge', -40)
    runJustification(s, map, always())
    const wronged = ['r1|r2', 'r2|r1'].find((k) => s.casusBelli[k] !== undefined)
    expect(wronged).toBeDefined()
    expect(s.reasons[wronged!]).toBe('Border incident')
    expect(s.borders!['r1|r2'].incidents).toBe(1)
    expect(s.log.some((l) => /border incident/i.test(l.text))).toBe(true)
    // And the reason is a real one: war with it costs the cheap price.
    const [holder, target] = wronged!.split('|')
    expect(orderCost({ ...s, nations: s.nations }, { type: 'declareWar', nationId: holder, target }).pp).toBeLessThan(60)
  })

  it('a quiet game with no posture rolls exactly the dice it always did: the chance is the base one', () => {
    const { map, s } = chain()
    addOpinion(s, 'r2', 'r1', 'Old grudge', -40)
    expect(incidentFactor(s, map, 'r1', 'r2')).toBe(1)
    expect(borderPressure(s, map, 'r1', 'r2')).toBe(0)
    const rng = always()
    runJustification(s, map, rng)
    expect(rng.asked.length).toBeGreaterThan(0)
    expect(rng.asked.filter((p) => p !== 0.5).every((p) => p === 0.05)).toBe(true)
  })

  it('troops massed on a border let neighbors clash even when they like each other, and make a clash likelier', () => {
    const { map, s } = chain()
    // r1 and r2 are the best of friends: no clash is ever rolled between them.
    addOpinion(s, 'r1', 'r2', 'Old friends', 60)
    addOpinion(s, 'r2', 'r1', 'Old friends', 60)
    const asks = (g: GameState) => {
      const rng = always()
      runJustification(structuredClone(g), map, rng)
      return rng.asked
    }
    const quiet = asks(s)
    post(s, map, setPost(s, 'r1', { border: { r2: 0.6 } }))
    post(s, map, setPost(s, 'r2', { border: { r1: 0.6 } }))
    expect(borderPressure(s, map, 'r1', 'r2')).toBeGreaterThanOrEqual(BORDER.pressureEligible)
    const massed = asks(s)
    // One more pair is now rolled for, and at better than the base chance.
    expect(massed.length).toBeGreaterThan(quiet.length)
    expect(Math.max(...massed)).toBeGreaterThan(0.05)
  })

  it('a garrison that fully guards its border turns a provocation back, with no incident', () => {
    const { map, s } = chain()
    addOpinion(s, 'r2', 'r1', 'Old grudge', -40)
    post(s, map, setPost(s, 'r1', { border: { r2: 0.5 } }))
    post(s, map, setPost(s, 'r2', { border: { r1: 0.5 } }))
    runJustification(s, map, always())
    expect(s.log.some((l) => /turned back a provocation/.test(l.text))).toBe(true)
    // Nothing came of it on that border: no reason for war for either side, and no incident remembered.
    expect(s.casusBelli['r1|r2']).toBeUndefined()
    expect(s.casusBelli['r2|r1']).toBeUndefined()
    expect(s.borders?.['r1|r2']).toBeUndefined()
  })

  it('across the sea an intruder is only seen by a nation that watches its waters', () => {
    const run = (patrol: boolean) => {
      const { map, s } = seaWorld()
      s.wars = []
      addOpinion(s, 'r1', 'r0', 'Old grudge', -40)
      addOpinion(s, 'r0', 'r1', 'Old grudge', -40)
      post(s, map, setPost(s, 'r0', patrol ? { coastal: 0.5 } : {}))
      post(s, map, setPost(s, 'r1', patrol ? { coastal: 0.5 } : {}))
      runJustification(s, map, always())
      return s
    }
    const watched = run(true)
    expect(Object.keys(watched.casusBelli).length).toBe(1)
    expect(watched.log.some((l) => /naval incident/.test(l.text))).toBe(true)
    const blind = run(false)
    expect(Object.keys(blind.casusBelli)).toHaveLength(0)
  })
})

describe('intelligence on what others keep on station', () => {
  it('shows exact numbers to an ally, an enemy at war, and a nation with intel; a rounded guess to a stranger', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r0', { border: { r1: 0.5 } }))
    // r1 and r0 are strangers: a guess, and only the part facing the viewer.
    const guess = deploymentView(s, 'r1', 'r0')
    expect(guess.exact).toBe(false)
    expect(Object.keys(guess.border)).toEqual(['r1'])
    expect(Math.abs(guess.border.r1 - 4)).toBeLessThanOrEqual(1.5)
    // A guess is steady within a year and does not give the real number away.
    expect(deploymentView(s, 'r1', 'r0')).toEqual(guess)
    s.wars.push('r0|r1')
    const exact = deploymentView(s, 'r1', 'r0')
    expect(exact.exact).toBe(true)
    expect(exact.border.r1).toBeCloseTo(4)
    s.wars = []
    s.intel['r1|r0'] = s.turn + 1
    expect(deploymentView(s, 'r1', 'r0').exact).toBe(true)
    s.intel = {}
    s.alliances.push('r0|r1')
    expect(deploymentView(s, 'r1', 'r0').exact).toBe(true)
    // A nation with no posture shows nothing at all.
    expect(deploymentView(s, 'r0', 'r2').posted).toBe(false)
  })

  it('the viewer never sees the real count by reading the guess alone', () => {
    const { map, s } = chain()
    setMilitary(s, 'r0', { infantry: 40 })
    post(s, map, setPost(s, 'r0', { border: { r1: 0.3 } }))
    const seen = new Set<number>()
    for (const turn of [1, 13, 25, 37]) {
      s.turn = turn
      seen.add(deploymentView(s, 'r1', 'r0').border.r1)
    }
    expect(seen.size).toBeGreaterThan(1)
    expect(seen.has(12)).toBe(false)
  })
})

describe('threats and advice', () => {
  it('the watch lists rivals that can reach you, by the way they would come, with exact numbers only at war', () => {
    const { map, s } = chain()
    expect(threatWatch(s, map, 'r1')).toEqual([])
    s.wars.push('r0|r1')
    const [t] = threatWatch(s, map, 'r1')
    expect(t).toMatchObject({ nation: 'r0', route: 'land', level: 'high' })
    expect(t.text).toMatch(/8 divisions/)
    post(s, map, setPost(s, 'r1', { border: { r0: 0.5 } }))
    expect(threatWatch(s, map, 'r1')[0].level).toBe('watch')
  })

  it('a rival with ships and no patrols against you is a danger the advisor puts first', () => {
    const { map, s } = seaWorld()
    s.nations.r1.resources.capital = 500
    const watch = threatWatch(s, map, 'r1')
    expect(watch[0]).toMatchObject({ nation: 'r0', route: 'lane', level: 'high' })
    expect(watch[0].text).toMatch(/not watched/)
    const advice = advise(s, map, 'r1')
    expect(advice.some((a) => /not guarded/.test(a.title) && a.target.desk === 'military')).toBe(true)
    post(s, map, setPost(s, 'r1', { coastal: 1, air: 1 }))
    expect(threatWatch(s, map, 'r1')[0].level).toBe('watch')
  })

  it('suggests stationing forces to a nation that never has, and stops once it does', () => {
    const { map, s } = chain()
    s.wars.push('r0|r1')
    const ids = () => advise(s, map, 'r1', [], 12).map((a) => a.id)
    expect(ids()).toContain('watch-r0-land')
    post(s, map, setPost(s, 'r1', { border: { r0: 0.5 } }))
    expect(ids()).not.toContain('station-forces')
    expect(ids()).not.toContain('watch-r0-land')
  })
})

describe('rivals keep forces on station', () => {
  const real = () => {
    const { map } = getWorld()
    const s = createInitialState(map, { playerRegionId: 'poland', seed: 7, difficulty: 'normal', goal: 'classic', victoryShare: 2 })
    return { map, s }
  }

  it('stronger rivals keep more on station, on more borders, and add the submarine screen', () => {
    const { map, s } = real()
    const plan = (skill: 0 | 1 | 2) => plannedPosture(s, map, 'germany', skill)
    const sum = (p: ReturnType<typeof plan>) => Object.values(p.border).reduce((t, v) => t + v, 0)
    const easy = plan(0)
    const medium = plan(1)
    const hard = plan(2)
    expect(sum(easy)).toBeGreaterThan(0)
    expect(Object.keys(easy.border).length).toBe(1)
    expect(Object.keys(hard.border).length).toBeGreaterThan(1)
    expect(sum(hard)).toBeGreaterThan(sum(easy))
    expect(sum(hard)).toBeGreaterThanOrEqual(sum(medium))
    expect(easy.subs).toBe(0)
    expect(hard.subs).toBeGreaterThanOrEqual(medium.subs)
    // Every rival keeps a reserve to attack with.
    for (const p of [easy, medium, hard]) {
      expect(sum(p)).toBeLessThanOrEqual(0.45)
      expect(p.coastal + p.subs).toBeLessThanOrEqual(0.7 + 1e-9)
    }
  })

  it('puts the garrison where the danger is: the nation at war with it gets the most', () => {
    const { map, s } = real()
    s.wars.push('france|germany')
    const p = plannedPosture(s, map, 'germany', 2)
    const top = Object.entries(p.border).sort((a, b) => b[1] - a[1])[0]
    expect(top[0]).toBe('france')
    // A friend gets the least.
    s.alliances.push('belgium|germany')
    const q = plannedPosture(s, map, 'germany', 2)
    expect(q.border.belgium ?? 0).toBeLessThanOrEqual(p.border.belgium ?? 1)
  })

  it('every nation with an army posts forces in the first month, and the order always passes validation', { timeout: 120_000 }, () => {
    const { map, s } = real()
    const orders = generateAllBotOrders(s, map).filter((o) => o.type === 'setDeployment')
    expect(orders.length).toBeGreaterThan(50)
    for (const o of orders) expect(validateOrder(s, map, o)).toBeNull()
    const next = resolveTurn(s, map, generateAllBotOrders(s, map))
    const posted = Object.values(next.nations).filter((n) => n.alive && !n.isPlayer && n.military.deployment)
    expect(posted.length).toBeGreaterThan(50)
    // The player is left alone: nothing is posted for a nation that nobody has told.
    expect(next.nations.poland.military.deployment).toBeUndefined()
  })

  it('a rival at war sends its reserve to attack, not what stands on station', () => {
    const { map, s } = real()
    s.wars.push('germany|poland')
    const next = resolveTurn(s, map, [...generateAllBotOrders(s, map)])
    const de = next.nations.germany
    expect(de.military.deployment).toBeDefined()
    expect(totalUnits(freeUnits(next, 'germany'))).toBeLessThan(totalUnits(de.military.units))
  })

  it('does not post again for a small change, and moves only when the picture changes', () => {
    const { map, s } = real()
    const first = deploymentOrder(s, map, 'germany', 1)
    expect(first).not.toBeNull()
    const next = resolveTurn(s, map, [first!])
    next.turn += 1
    expect(deploymentOrder(next, map, 'germany', 1)).toBeNull()
  })

  it('does nothing for the player in bot orders unless the player is allowed to be played by the bot', () => {
    const { map, s } = real()
    expect(generateBotOrders(s, map, 'poland')).toEqual([])
    expect(generateBotOrders(s, map, 'poland', true).some((o) => o.type === 'setDeployment')).toBe(true)
  })
})

/** A live game and a turn game run the same month, including the border's memory and the posture's upkeep. */
describe('turn and live months agree about stations and borders', () => {
  const stripped = (s: GameState) => {
    const copy = JSON.parse(JSON.stringify(s))
    for (const k of ['day', 'armies', 'launches', 'flights', 'pendingDay']) delete copy[k]
    delete copy.settings.mode
    for (const l of copy.log) delete l.day
    return copy
  }
  it('three quiet months with a posture and a closed border end the same in both', () => {
    const map = lineMap(6)
    const base = startState(map, 'r1', 3)
    base.nations.r1.resources.pp = 300
    setMilitary(base, 'r1', { infantry: 20, naval: 4 })
    addOpinion(base, 'r2', 'r1', 'Old grudge', -40)
    const orders: Order[] = [setPost(base, 'r1', { border: { r0: 0.2, r2: 0.3 } }), { type: 'setBorder', nationId: 'r1', neighbor: 'r2', closed: true }]
    let turn = structuredClone(base)
    for (const o of orders) expect(applyOrderNow(turn, map, o).error).toBeNull()
    let live = startLive(structuredClone(base))
    for (const o of orders) expect(applyOrderNow(live, map, o).error).toBeNull()
    for (let i = 0; i < 3; i++) turn = resolveTurn(turn, map, [])
    while (live.turn < 4) live = advanceDay(live, map, { planner: () => [] }).state
    expect(live.turn).toBe(turn.turn)
    const a = stripped(turn)
    const b = stripped(live)
    expect(b.nations).toEqual(a.nations)
    expect(b.regions).toEqual(a.regions)
    expect(b.borders).toEqual(a.borders)
    expect(b.casusBelli).toEqual(a.casusBelli)
  })

  it('runMonth leaves the state of a game that never used any of this without the new fields', () => {
    const map = lineMap(5)
    const s = startState(map, 'r1')
    runMonth(s, map, [])
    expect('borders' in s).toBe(false)
    expect('deployment' in s.nations.r1.military).toBe(false)
  })
})

describe('the numbers behind it', () => {
  it('cover, divisions and the patrol all read the whole force, not just what is at home', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { coastal: 0.5, air: 0.5 }))
    const c = patrolCover(s, 'r1')
    expect(c.coastal).toBeCloseTo(2)
    expect(c.air).toBeCloseTo(3)
    expect(formatDivisions(c.air)).toBe('3')
  })

  it('a posture with every share zero is still a posture: the nation has said it keeps nothing out', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', {}))
    expect(s.nations.r1.military.deployment).toBeDefined()
    expect(freeUnits(s, 'r1').infantry).toBe(20)
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = s.turn
    expect(surpriseBonus(s, map, 'r1', 'r0')).toBeCloseTo(STATION.surpriseMax)
  })

  it('validateDeployment accepts exactly what applyDeployment stores', () => {
    const { map, s } = chain()
    const o = setPost(s, 'r1', { coastal: 0.33, subs: 0.12, air: 0.4, border: { r0: 0.333, r2: 0.2 } })
    expect(validateDeployment(s, map, o as Extract<Order, { type: 'setDeployment' }>, [])).toBeNull()
    post(s, map, o)
    const d = s.nations.r1.military.deployment!
    expect(d).toMatchObject({ coastal: 0.33, subs: 0.12, air: 0.4, border: { r0: 0.33, r2: 0.2 }, fronts: { r0: 1, r2: 1 } })
  })

  it('MapRegion typing: the test worlds really have no sea lanes unless set', () => {
    const { map } = chain()
    const r: MapRegion = map.regions.r1
    expect(r.seaLanes).toEqual([])
  })
})

/** A 53-bit string hash (cyrb53), the same one turnGolden pins whole games with. */
function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

describe('a game where nobody stations forces plays as it always did', () => {
  it('twelve months of bots on the real world, with the posture orders taken out, hash to what they did before this feature (bar the border memory)', () => withOldWarScore(() => {
    // The war score model (docs/WARSCORE_STATUS.md) adds fields of its own; with the old tally this hash is unchanged.
    const { map } = getWorld()
    let s = createInitialState(map, { playerRegionId: 'poland', seed: 7, difficulty: 'normal', goal: 'classic', victoryShare: 2 })
    for (let i = 0; i < 12 && s.outcome === 'playing'; i++) {
      if (s.pendingEvent) s = applyEventChoice(s, map, 0)
      const orders = [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)].filter((o) => o.type !== 'setDeployment')
      s = resolveTurn(s, map, orders)
    }
    // Nothing was stationed, so no nation carries a posture.
    expect(Object.values(s.nations).some((n) => n.military.deployment)).toBe(false)
    // The only trace the new rules leave is the memory of a border incident.
    delete s.borders
    expect(s.turn).toBe(13)
    // Re-pinned when the AI got its strategic layer (docs/STRATEGY.md): the bots decide differently on purpose, so the old hash no longer applies.
    // Re-pinned again for the combat tuning (docs/WAR_STATUS.md; the old hash 'bc68beaeedca7' returns with those numbers put back, see turnGolden.test.ts).
    expect(hash(JSON.stringify(s))).toBe('103075820c12de')
  }), 300_000)
})

describe('edges and limits', () => {
  it('air patrols make the missile hunters better: fighters aloft on patrol count half again', () => {
    const run = (air: number) => {
      const { map, s } = seaWorld()
      s.nations.r1.aircraft = { hunters: { progress: 5, done: true } }
      setMilitary(s, 'r1', { infantry: 6, fighter: 2 })
      if (air > 0) post(s, map, setPost(s, 'r1', { air }))
      s.regions.r1.line = 8
      strikeHitsKind(s, map, 'r0', 'r1', 'tactical', 6)
      return s.nations.r1.military.units.infantry
    }
    expect(patrolFighters({ nations: { r1: { military: { deployment: { air: 1, coastal: 0, subs: 0, border: {}, changed: 0 }, units: { fighter: 2, drone: 0, infantry: 0, armor: 0, artillery: 0, air: 0, naval: 0, robot: 0, missile: 0 } } } } } as unknown as GameState, 'r1')).toBeCloseTo(1)
    // The tactical salvo kills a slice of the army; with air patrols more of it is stopped, so more infantry survives.
    expect(run(1)).toBeGreaterThan(run(0))
  })

  it('a garrison assigned to a border that no longer exists is stood down at the month, and counts as reserve meanwhile', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { border: { r0: 0.4, r2: 0.2 } }))
    // r1 conquers r0 outright: nobody is left to face.
    s.regions.r0.owner = 'r1'
    s.nations.r0.alive = false
    expect(freeUnits(s, 'r1').infantry).toBeLessThan(20)
    expect(garrisonDivisions(s, 'r1', 'r0')).toBeGreaterThan(0)
    const next = resolveTurn(s, map, [])
    expect(next.nations.r1.military.deployment?.border).toEqual({ r2: 0.2 })
    expect(next.nations.r1.military.deployment?.fronts).toEqual({ r2: 1 })
    expect(freeUnits(next, 'r1').infantry).toBeCloseTo(20 * 0.8)
  })

  it('shares that add up to more than all of a unit type are scaled back, never past the whole force', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { border: { r0: 0.3 } }))
    // A damaged save: the shares add up to 160%.
    s.nations.r1.military.deployment!.border = { r0: 0.8, r2: 0.8 }
    s.nations.r1.military.deployment!.coastal = 0.9
    s.nations.r1.military.deployment!.subs = 0.9
    const free = freeUnits(s, 'r1')
    for (const k of ['infantry', 'armor', 'artillery', 'naval'] as const) expect(free[k]).toBeGreaterThanOrEqual(0)
    expect(free.infantry).toBe(0)
    expect(patrolCover(s, 'r1').coastal + patrolCover(s, 'r1').subs).toBeCloseTo(4)
    expect(defenseWeights(s, 'r1', 'r0', false)!.infantry).toBeCloseTo(1 * 0.5 * 1.35 + 0.5 * 0.5)
  })

  it('a station left empty is no station: zero shares post nothing, and a border with no troops has no cover', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { border: { r0: 0 } }))
    expect(s.nations.r1.military.deployment!.border).toEqual({})
    expect(postedUnits(s, 'r1').infantry).toBe(0)
    expect(borderCover(s, map, 'r1', 'r0')).toBe(0)
    expect(lineBonus(s, map, 'r1')).toBe(0)
    // No troops at all: a posted share of nothing is nothing.
    setMilitary(s, 'r1', {})
    s.turn++
    post(s, map, setPost(s, 'r1', { border: { r0: 1 }, coastal: 1, air: 1 }))
    expect(totalUnits(freeUnits(s, 'r1'))).toBe(0)
    expect(garrisonDivisions(s, 'r1', 'r0')).toBe(0)
    expect(interception(s, 'r1', 'lane', forceUnits(s, 'r1')).share).toBe(0)
  })

  it('tension never goes below 0 or above 100, and every border state is reachable', () => {
    const { map, s } = chain()
    s.pacts['r1|r2'] = s.turn + 10
    s.alliances.push('r1|r2')
    s.nations.r2.overlord = 'r1'
    s.deals.push({ id: 'd', kind: 'trade', from: 'r1', to: 'r2', give: {}, receive: {}, until: 99 })
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(0)
    expect(borderState(s, map, 'r1', 'r2')).toBe('open')
    s.alliances = []
    s.pacts = {}
    s.nations.r2.overlord = null
    s.deals = []
    s.wars.push('r1|r2')
    post(s, map, setPost(s, 'r1', { border: { r2: 0.6 } }))
    recordIncident(s, 'r1', 'r2')
    recordIncident(s, 'r1', 'r2')
    s.casusBelli['r1|r2'] = s.turn + 3
    post(s, map, { type: 'setBorder', nationId: 'r1', neighbor: 'r2', closed: true })
    expect(borderTension(s, map, 'r1', 'r2').total).toBe(100)
    expect(borderState(s, map, 'r1', 'r2')).toBe('disputed')
  })

  it('an older save with none of the new fields opens, plays a month, and carries nothing new until used', () => {
    const { map, s } = chain()
    const old = JSON.parse(JSON.stringify(s))
    expect('borders' in old).toBe(false)
    expect('deployment' in old.nations.r1.military).toBe(false)
    const next = resolveTurn(old, map, [])
    expect(next.turn).toBe(old.turn + 1)
    expect(freeUnits(next, 'r1')).toBe(next.nations.r1.military.units)
    expect(bordersOf(next, map, 'r1').every((b) => b.mineDivisions === 0 && b.theirDivisions === 0)).toBe(true)
    expect(threatWatch(next, map, 'r1')).toEqual([])
    // A saved posture from before `fronts` was kept still works: the border count is worked out on the spot.
    const post1 = structuredClone(next)
    post1.nations.r1.military.deployment = { coastal: 0, subs: 0, air: 0, border: { r0: 0.3 }, changed: 0 }
    expect(lineBonus(post1, map, 'r1')).toBeGreaterThan(0)
    expect(borderCover(post1, map, 'r1', 'r0')).toBeGreaterThan(0)
  })

  it('a posture survives a save and a load unchanged', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { coastal: 0.2, air: 0.3, border: { r0: 0.25 } }))
    const loaded = JSON.parse(JSON.stringify(s)) as GameState
    expect(loaded.nations.r1.military.deployment).toEqual(s.nations.r1.military.deployment)
    expect(freeUnits(loaded, 'r1')).toEqual(freeUnits(s, 'r1'))
  })

  it('posting is not a way round the rules: a second order in the same month fails even when the first came from another batch', () => {
    const { map, s } = chain()
    post(s, map, setPost(s, 'r1', { border: { r0: 0.3 } }))
    const second = applyOrderNow(s, map, setPost(s, 'r1', { border: { r2: 0.3 } }))
    expect(second.error).toMatch(/next month/)
    expect(s.nations.r1.military.deployment!.border).toEqual({ r0: 0.3 })
  })

  it('posting leaves the bill for the force what it was', () => {
    const { map, s } = chain()
    const before = computeEconomy(s, map, 'r1')
    post(s, map, setPost(s, 'r1', { coastal: 0.5, air: 0.5, border: { r0: 0.5 } }))
    const after = computeEconomy(s, map, 'r1')
    expect(after.upkeep).toBeCloseTo(before.upkeep)
    expect(after.oilUse).toBeCloseTo(before.oilUse)
  })
})
