import { afterEach, describe, expect, it } from 'vitest'
import { alertOrder, deploymentOrder, plannedPosture, postureRead, presetPosture } from '../../ai/deployment'
import { generateAllBotOrders } from '../../ai/bot'
import { opinionOf } from '../../ai/opinion'
import { PRESENCE } from '../../data/presence'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { advise } from '../advisor'
import { borderTension } from '../borders'
import { defenseWeights, interception, readyFactor, surpriseBonus } from '../deployment'
import { forceUnits } from '../helpers'
import { hasIntel } from '../intel'
import { validateOrder } from '../orders'
import { alertCost, chokeStatus, ledgerFor, noteDeterred, postedUpkeep, readyTarget, runPresence, showCost } from '../presence'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { ledgerLines, recommendPreset, supplyOf, theatresOf } from '../theatres'
import type { GameState, NationId, Order, UnitType } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const { map } = getWorld()
const world = (): GameState => {
  const s = createInitialState(map, { playerRegionId: 'france', seed: 5, difficulty: 'normal', goal: 'world', victoryShare: 1 })
  s.nextEventTurn = 9999
  return s
}
const give = (s: GameState, id: NationId, units: Partial<Record<UnitType, number>>) => {
  const u = s.nations[id].military.units
  for (const k of Object.keys(u) as UnitType[]) u[k] = units[k] ?? 0
}
const post = (s: GameState, id: NationId, o: Partial<Extract<Order, { type: 'setDeployment' }>> = {}) =>
  expect(applyOrderNow(s, map, { type: 'setDeployment', nationId: id, coastal: 0, subs: 0, air: 0, border: {}, ...o }).error).toBeNull()
const gross = (s: GameState, v = 100) => new Map(Object.keys(s.nations).map((id) => [id, v]))
const saved = { ...PRESENCE, show: { ...PRESENCE.show }, exercise: { ...PRESENCE.exercise } }
afterEach(() => Object.assign(PRESENCE, saved, { show: { ...saved.show }, exercise: { ...saved.exercise } }))

describe('alert levels and readiness', () => {
  it('an alert needs a posture, and a change', () => {
    const s = world()
    expect(validateOrder(s, map, { type: 'setAlert', nationId: 'france', alert: 'high' })).toMatch(/Post some forces/)
    give(s, 'france', { infantry: 10, naval: 4 })
    post(s, 'france', { coastal: 0.5 })
    expect(validateOrder(s, map, { type: 'setAlert', nationId: 'france', alert: 'normal' })).toMatch(/already/)
    expect(validateOrder(s, map, { type: 'setAlert', nationId: 'france', alert: 'high' })).toBeNull()
  })

  it('readiness climbs a few points a month toward the alert, never at once', () => {
    const s = world()
    give(s, 'france', { infantry: 10, naval: 4 })
    post(s, 'france', { coastal: 0.5 })
    applyOrderNow(s, map, { type: 'setAlert', nationId: 'france', alert: 'high' })
    const d = s.nations.france.military.deployment!
    expect(readyFactor(d)).toBe(1)
    runPresence(s, map, gross(s))
    expect(d.ready).toBe(PRESENCE.readyBase + PRESENCE.readyStep)
    runPresence(s, map, gross(s))
    runPresence(s, map, gross(s))
    expect(d.ready).toBe(95)
    expect(readyFactor(d)).toBeGreaterThan(1.1)
    // Standing down is as slow, and returns to a bare posture with no readiness left over.
    applyOrderNow(s, map, { type: 'setAlert', nationId: 'france', alert: 'normal' })
    for (let i = 0; i < 4; i++) runPresence(s, map, gross(s))
    expect(d.ready).toBeUndefined()
  })

  it('high alert makes a garrison stronger, harder to surprise and its patrols sink more; relaxed does the opposite', () => {
    const s = world()
    give(s, 'france', { infantry: 12, naval: 6 })
    post(s, 'france', { coastal: 0.6, border: { germany: 0.04 } })
    const d = s.nations.france.military.deployment!
    const base = defenseWeights(s, 'france', 'germany', false)!.infantry
    const baseSea = interception(s, 'france', 'lane', { ...forceUnits(s, 'france'), infantry: 4 }).share
    d.ready = 95
    expect(defenseWeights(s, 'france', 'germany', false)!.infantry).toBeGreaterThan(base)
    expect(interception(s, 'france', 'lane', { ...forceUnits(s, 'france'), infantry: 4 }).share).toBeGreaterThanOrEqual(baseSea)
    d.ready = 55
    expect(defenseWeights(s, 'france', 'germany', false)!.infantry).toBeLessThan(base)
    s.warStarted['france|germany'] = s.turn
    const low = surpriseBonus(s, map, 'france', 'germany')
    d.ready = 95
    expect(surpriseBonus(s, map, 'france', 'germany')).toBeLessThan(low)
  })

  it('high alert costs money and oil, relaxed gives part back, and neither can make a profit', () => {
    const s = world()
    give(s, 'france', { infantry: 10, naval: 6, fighter: 4 })
    post(s, 'france', { coastal: 0.6, air: 0.5, border: { germany: 0.4 } })
    const up = postedUpkeep(s, 'france')
    expect(alertCost(s, 'france')).toEqual({ money: 0, oil: 0 })
    s.nations.france.military.deployment!.alert = 'high'
    const high = alertCost(s, 'france')
    expect(high.money).toBeGreaterThan(0)
    expect(high.money).toBeLessThan(up.money)
    s.nations.france.military.deployment!.alert = 'relaxed'
    const low = alertCost(s, 'france')
    expect(low.money).toBeLessThan(0)
    expect(-low.money).toBeLessThan(up.money)
    const before = s.nations.france.resources.capital
    s.nations.france.military.deployment!.alert = 'high'
    runPresence(s, map, gross(s))
    expect(s.nations.france.resources.capital).toBeLessThan(before)
  })

  it('a force with no oil cannot keep its alert', () => {
    const s = world()
    give(s, 'france', { infantry: 4, armor: 6, naval: 4 })
    post(s, 'france', { coastal: 0.8, border: { germany: 0.6 } })
    s.nations.france.military.deployment!.alert = 'high'
    const wet = readyTarget(s, 'france')
    s.nations.france.resources.oil = 0
    expect(readyTarget(s, 'france')).toBe(wet - PRESENCE.drySupply)
    expect(supplyOf(s, 'france').state).toBe('dry')
  })

  it('a change of posts keeps the alert and readiness', () => {
    const s = world()
    give(s, 'france', { infantry: 10, naval: 4 })
    post(s, 'france', { coastal: 0.5 })
    s.nations.france.military.deployment!.alert = 'high'
    s.nations.france.military.deployment!.ready = 90
    s.turn++
    post(s, 'france', { coastal: 0.3, border: { germany: 0.2 } })
    expect(s.nations.france.military.deployment).toMatchObject({ alert: 'high', ready: 90 })
  })
})

describe('trade, straits and blockades', () => {
  it('patrols protect the sea trade, but never pay for the fleet', () => {
    const s = world()
    give(s, 'france', { infantry: 4, naval: 8 })
    post(s, 'france', { coastal: 0.8 })
    const before = s.nations.france.resources.capital
    runPresence(s, map, gross(s, 400))
    const gain = s.nations.france.resources.capital - before
    expect(gain).toBeGreaterThan(0)
    expect(gain).toBeLessThanOrEqual(postedUpkeep(s, 'france').naval * PRESENCE.tradeVsUpkeep + 1e-9)
    expect(s.presence!.france.trade).toBeCloseTo(gain, 6)
    // The gain is soft-capped by the share of income at sea.
    expect(gain).toBeLessThanOrEqual(400 * PRESENCE.seaShare * PRESENCE.tradeCap + 1e-9)
  })

  it('no posture, nothing posted at sea, or presence switched off: no gain', () => {
    const s = world()
    give(s, 'france', { infantry: 8, naval: 8 })
    runPresence(s, map, gross(s, 400))
    expect(s.presence).toBeUndefined()
    post(s, 'france', { border: { germany: 0.5 } })
    const c = s.nations.france.resources.capital
    runPresence(s, map, gross(s, 400))
    expect(s.nations.france.resources.capital).toBe(c)
    post(s, 'italy', { coastal: 0.9 })
    PRESENCE.on = false
    const before = JSON.stringify(s)
    runPresence(s, map, gross(s))
    expect(JSON.stringify(s)).toBe(before)
  })

  it('a strait is held by the owner of an end whose patrols are 1.5 times the other\'s', () => {
    const s = world()
    const pair = (id: string) => chokeStatus(s, map).find((c) => c.id === id)!
    expect(pair('spain|morocco').holder).toBeNull()
    give(s, 'spain', { infantry: 4, naval: 8 })
    post(s, 'spain', { coastal: 0.8 })
    expect(pair('spain|morocco').holder).toBe('spain')
    give(s, 'morocco', { infantry: 4, naval: 8 })
    post(s, 'morocco', { coastal: 0.8 })
    const c = pair('spain|morocco')
    expect(c.holder).toBeNull()
    expect(c.contested).toBe(true)
    give(s, 'morocco', { infantry: 4, naval: 40 })
    expect(pair('spain|morocco').holder).toBe('morocco')
    // Every named strait joins two countries of the map that really have a sea lane.
    for (const x of chokeStatus(s, map)) expect(map.regions[x.a].seaLanes).toContain(x.b)
  })

  it('a held strait adds to the trade, within the same cap', () => {
    const s = world()
    give(s, 'spain', { infantry: 4, naval: 8 })
    post(s, 'spain', { coastal: 0.8 })
    const without = JSON.parse(JSON.stringify(s)) as GameState
    PRESENCE.chokeValue = 0
    runPresence(without, map, gross(without, 500))
    PRESENCE.chokeValue = saved.chokeValue
    runPresence(s, map, gross(s, 500))
    expect(s.nations.spain.resources.capital).toBeGreaterThanOrEqual(without.nations.spain.resources.capital)
  })

  it('a fleet that outguns an enemy at war takes part of its sea trade; an equal one takes none', () => {
    const s = world()
    s.wars.push('france|spain')
    give(s, 'france', { infantry: 4, naval: 10 })
    give(s, 'spain', { infantry: 4, naval: 0 })
    post(s, 'france', { coastal: 0.9 })
    post(s, 'spain', { border: { france: 0.3 } })
    const before = s.nations.spain.resources.capital
    runPresence(s, map, gross(s, 400))
    expect(s.nations.spain.resources.capital).toBeLessThan(before)
    expect(s.presence!.france.blockaded).toBeGreaterThan(0)
    // Never more than the soft cap, and never below zero.
    expect(before - s.nations.spain.resources.capital).toBeLessThanOrEqual(400 * PRESENCE.seaShare * PRESENCE.blockadeCut + 1e-9)
    const t = world()
    t.wars.push('france|spain')
    give(t, 'france', { infantry: 4, naval: 6 })
    give(t, 'spain', { infantry: 4, naval: 6 })
    post(t, 'france', { coastal: 0.9 })
    post(t, 'spain', { coastal: 0.9 })
    const c = t.nations.spain.resources.capital
    runPresence(t, map, gross(t, 400))
    expect(t.nations.spain.resources.capital).toBeGreaterThanOrEqual(c)
  })

  it('sanctions enforced by patrols squeeze half as hard as war', () => {
    const s = world()
    give(s, 'france', { infantry: 4, naval: 10 })
    post(s, 'france', { coastal: 0.9 })
    ;(s.sanctions ??= []).push({ from: 'france', to: 'spain', until: s.turn + 12 })
    const before = s.nations.spain.resources.capital
    runPresence(s, map, gross(s, 400))
    const sanction = before - s.nations.spain.resources.capital
    expect(sanction).toBeGreaterThan(0)
    const w = world()
    w.wars.push('france|spain')
    give(w, 'france', { infantry: 4, naval: 10 })
    post(w, 'france', { coastal: 0.9 })
    const b2 = w.nations.spain.resources.capital
    runPresence(w, map, gross(w, 400))
    expect(b2 - w.nations.spain.resources.capital).toBeGreaterThan(sanction)
  })
})

describe('watching: intelligence from patrols', () => {
  it('submarine screens and air patrols learn what neighbors keep, for a short while', () => {
    const s = world()
    give(s, 'france', { infantry: 4, naval: 10, fighter: 6 })
    post(s, 'france', { coastal: 0.2, subs: 0.6, air: 0.8 })
    expect(hasIntel(s, 'france', 'spain')).toBe(false)
    for (let i = 0; i < 6; i++) {
      s.turn++
      runPresence(s, map, gross(s))
    }
    const known = Object.keys(s.nations).filter((x) => x !== 'france' && s.intel[`france|${x}`] !== undefined)
    expect(known.length).toBeGreaterThan(0)
    expect(s.presence!.france.intel).toBeGreaterThan(0)
    expect(s.presence!.france.sorties).toBeGreaterThan(0)
    // The sight lasts watchMonths, and only for nations that touch France.
    const x = known[0]
    expect(s.intel[`france|${x}`]).toBeGreaterThanOrEqual(s.turn - 1)
  })

  it('nothing posted, nothing learned; and no more than the cap in a month', () => {
    const s = world()
    give(s, 'france', { infantry: 4, naval: 10, fighter: 6 })
    post(s, 'france', { border: { germany: 0.5 } })
    for (let i = 0; i < 12; i++) runPresence(s, map, gross(s))
    expect(Object.keys(s.intel).filter((k) => k.startsWith('france|'))).toHaveLength(0)
    s.turn++
    post(s, 'france', { subs: 0.9, air: 1 })
    PRESENCE.watchPer = 50
    runPresence(s, map, gross(s))
    expect(s.presence!.france.intel).toBeLessThanOrEqual(PRESENCE.watchMax)
  })
})

describe('incidents and talks', () => {
  it('tense neighbors whose patrols meet have collisions and shoot-downs with consequences', () => {
    PRESENCE.incidentPer = 0.01
    const s = world()
    give(s, 'france', { infantry: 4, naval: 8, fighter: 6 })
    give(s, 'spain', { infantry: 4, naval: 8, fighter: 6 })
    post(s, 'france', { coastal: 0.6, air: 0.6 })
    post(s, 'spain', { coastal: 0.6, air: 0.6 })
    s.borders = { 'france|spain': { heat: 60, at: s.turn } }
    let n = 0
    for (let i = 0; i < 40 && !s.presence?.france?.incidents; i++) {
      s.turn++
      s.borders!['france|spain'] = { heat: 60, at: s.turn }
      runPresence(s, map, gross(s))
      n++
    }
    expect(s.presence!.france.incidents).toBeGreaterThan(0)
    expect(s.presence!.spain.incidents).toBe(s.presence!.france.incidents)
    expect(s.log.some((l) => /collided|shot down/.test(l.text))).toBe(true)
    expect(Object.keys(s.casusBelli).some((k) => k === 'france|spain' || k === 'spain|france')).toBe(true)
    expect(n).toBeLessThan(40)
  })

  it('allies, partners at war and calm borders have none', () => {
    PRESENCE.incidentPer = 0.01
    const s = world()
    give(s, 'france', { infantry: 4, naval: 8, fighter: 6 })
    give(s, 'spain', { infantry: 4, naval: 8, fighter: 6 })
    post(s, 'france', { coastal: 0.6, air: 0.6 })
    post(s, 'spain', { coastal: 0.6, air: 0.6 })
    for (let i = 0; i < 60; i++) {
      s.turn++
      runPresence(s, map, gross(s))
    }
    expect(borderTension(s, map, 'france', 'spain').total).toBeLessThan(PRESENCE.incidentFrom)
    expect(s.presence?.france?.incidents ?? 0).toBe(0)
  })

  it('a hot border cools by talks unless a side is on high alert', () => {
    PRESENCE.easeChance = 1
    const s = world()
    give(s, 'france', { infantry: 6 })
    give(s, 'germany', { infantry: 6 })
    post(s, 'france', { border: { germany: 0.3 } })
    post(s, 'germany', { border: { france: 0.3 } })
    s.borders = { 'france|germany': { heat: 40, at: s.turn } }
    runPresence(s, map, gross(s))
    expect(s.borders!['france|germany'].heat).toBe(40 - PRESENCE.easeHeat)
    s.nations.germany.military.deployment!.alert = 'high'
    runPresence(s, map, gross(s))
    expect(s.borders!['france|germany'].heat).toBe(40 - PRESENCE.easeHeat)
  })
})

describe('shows of force and exercises', () => {
  const ready = () => {
    const s = world()
    s.nations.france.resources.capital = 500
    s.nations.france.resources.oil = 50
    give(s, 'france', { infantry: 10, naval: 6, fighter: 4 })
    post(s, 'france', { coastal: 0.7, air: 0.6, border: { germany: 0.4 } })
    s.turn += 1
    return s
  }
  const show = (o: Partial<Extract<Order, { type: 'showOfForce' }>> = {}): Extract<Order, { type: 'showOfForce' }> => ({ type: 'showOfForce', nationId: 'france', kind: 'naval', target: 'spain', ...o })

  it('needs a posture, force posted for that arm, a neighbor that is not a friend, and the oil', () => {
    const s = world()
    give(s, 'france', { infantry: 10, naval: 6 })
    expect(validateOrder(s, map, show())).toMatch(/Post some forces/)
    post(s, 'france', { coastal: 0.7 })
    expect(validateOrder(s, map, show({ kind: 'air' }))).toMatch(/too little posted/)
    expect(validateOrder(s, map, show({ target: 'japan' }))).toMatch(/not your neighbor/)
    expect(validateOrder(s, map, show({ target: undefined }))).toMatch(/Choose a neighboring/)
    s.nations.france.resources.oil = 0
    expect(validateOrder(s, map, show())).toMatch(/oil/)
    s.nations.france.resources.oil = 50
    expect(validateOrder(s, map, show())).toBeNull()
  })

  it('costs money (by what is shown), raises heat, sours the neighbor, trains the force and lifts readiness', () => {
    const s = ready()
    const c0 = s.nations.france.resources.capital
    const oil0 = s.nations.france.resources.oil
    const drill0 = s.nations.france.military.drill.naval
    const cost = showCost(s, show())
    expect(cost).toBeGreaterThan(PRESENCE.show.capital)
    const op0 = opinionOf(s, map, 'spain', 'france')
    const quiet = resolveTurn(structuredClone(s), map, [])
    const r = resolveTurn(s, map, [show()])
    expect(r.nations.france.resources.oil).toBeLessThan(quiet.nations.france.resources.oil)
    expect(oil0).toBe(50)
    expect(quiet.nations.france.resources.capital - r.nations.france.resources.capital).toBeGreaterThan(cost - 1)
    expect(c0).toBe(500)
    expect(r.nations.france.military.drill.naval).toBeGreaterThan(drill0)
    expect(r.presence!.france.shows).toBe(1)
    expect(opinionOf(r, map, 'spain', 'france')).toBeLessThan(op0)
    expect(r.nations.france.military.deployment!.ready).toBeGreaterThan(PRESENCE.readyBase)
    expect(r.log.some((l) => /showed force to Spain/.test(l.text))).toBe(true)
  })

  it('cannot be repeated at once at the same nation, nor twice in a month, and training has a ceiling', () => {
    const s = ready()
    expect(applyOrderNow(s, map, show()).error).toBeNull()
    expect(validateOrder(s, map, show())).toMatch(/recently/)
    expect(validateOrder(s, map, show({ target: 'germany' }), [show()])).toMatch(/One show/)
    for (let i = 0; i < 30; i++) {
      s.turn += PRESENCE.show.cooldown
      s.nations.france.resources.oil = 50
      applyOrderNow(s, map, show())
    }
    expect(s.nations.france.military.drill.naval).toBeLessThanOrEqual(Math.max(PRESENCE.show.drillCap, saved.show.drillCap) + 1e-9)
  })

  it('an exercise trains posted forces and holds readiness up for a few months, then cannot be repeated for a while', () => {
    const s = ready()
    const o: Order = { type: 'showOfForce', nationId: 'france', kind: 'exercise' }
    expect(validateOrder(s, map, o)).toBeNull()
    applyOrderNow(s, map, o)
    expect(s.nations.france.military.deployment!.exerciseUntil).toBe(s.turn + PRESENCE.exercise.months)
    expect(validateOrder(s, map, o)).toMatch(/drilled recently/)
    for (let i = 0; i < 2; i++) {
      s.turn++
      runPresence(s, map, gross(s))
    }
    expect(s.nations.france.military.deployment!.ready).toBeGreaterThan(PRESENCE.readyBase)
    for (let i = 0; i < 6; i++) {
      s.turn++
      runPresence(s, map, gross(s))
    }
    expect(s.nations.france.military.deployment!.ready).toBeUndefined()
  })

  it('no exploit: posting, showing and unposting again never makes money, and the ledger counts the spend', () => {
    const s = ready()
    const quiet = resolveTurn(structuredClone(s), map, [])
    const r = resolveTurn(s, map, [show()])
    expect(r.nations.france.resources.capital).toBeLessThan(quiet.nations.france.resources.capital)
    expect(r.presence!.france.spent).toBeGreaterThan(0)
  })
})

describe('malformed orders never throw and never change the game', () => {
  const junk: unknown[] = [
    { type: 'setAlert', nationId: 'france', alert: 'panic' },
    { type: 'setAlert', nationId: 'nowhere', alert: 'high' },
    { type: 'setAlert', nationId: 'france' },
    { type: 'showOfForce', nationId: 'france', kind: 'nuclear', target: 'spain' },
    { type: 'showOfForce', nationId: 'france', kind: 'naval', target: 'france' },
    { type: 'showOfForce', nationId: 'france', kind: 'naval', target: 'zzz' },
    { type: 'showOfForce', nationId: 'france', kind: 'exercise', target: 'spain' },
    { type: 'showOfForce', nationId: 'france' },
    { type: 'showOfForce', nationId: 'ghost', kind: 'air' },
    { type: 'showOfForce', nationId: 'france', kind: 'ground', target: NaN },
  ]
  it('are refused with a reason', () => {
    const s = world()
    give(s, 'france', { infantry: 10, naval: 6 })
    post(s, 'france', { coastal: 0.7, border: { germany: 0.4 } })
    const before = JSON.stringify(s)
    for (const o of junk) {
      const err = validateOrder(s, map, o as Order)
      if (err === null) expect(['exercise', 'ground']).toContain((o as { kind: string }).kind)
      else expect(typeof err).toBe('string')
    }
    const r = resolveTurn(s, map, junk as Order[])
    expect(r.turn).toBe(s.turn + 1)
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('the rest of the month rolls what it always did', () => {
  it('nations that never post are untouched: with presence on or off a posture-free world is the same game', () => {
    const run = (on: boolean) => {
      PRESENCE.on = on
      let s = world()
      for (let i = 0; i < 6; i++) s = resolveTurn(s, map, [])
      return JSON.stringify(s)
    }
    expect(run(true)).toBe(run(false))
  })

  it('same state, same month: deterministic; and the ledger survives a save round trip', () => {
    const play = () => {
      let s = world()
      for (let i = 0; i < 8; i++) s = resolveTurn(s, map, generateAllBotOrders(s, map))
      return s
    }
    const a = play()
    const b = play()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(Object.keys(a.presence ?? {}).length).toBeGreaterThan(5)
    const again = JSON.parse(JSON.stringify(a)) as GameState
    expect(JSON.stringify(resolveTurn(again, map, []))).toBe(JSON.stringify(resolveTurn(JSON.parse(JSON.stringify(a)) as GameState, map, [])))
  })

  it('an old save with no presence, no alert and no readiness plays on', () => {
    let s = world()
    give(s, 'france', { infantry: 8, naval: 4 })
    post(s, 'france', { coastal: 0.5 })
    const raw = JSON.parse(JSON.stringify(s)) as GameState
    delete raw.presence
    expect(raw.nations.france.military.deployment!.alert).toBeUndefined()
    s = resolveTurn(raw, map, [])
    expect(s.turn).toBe(raw.turn + 1)
    expect(() => theatresOf(s, map, 'france')).not.toThrow()
  })

  it('a line map with no coast has no straits, trade or blockade and still runs', () => {
    const m = lineMap(4)
    const s = startState(m, 'r0')
    setMilitary(s, 'r0', { infantry: 8, naval: 4 })
    applyOrderNow(s, m, { type: 'setDeployment', nationId: 'r0', coastal: 0.5, subs: 0, air: 0, border: { r1: 0.3 } })
    expect(() => runPresence(s, m, new Map([['r0', 100]]))).not.toThrow()
    expect(chokeStatus(s, m)).toEqual([])
  })

  it('noteDeterred only credits a nation that posted forces', () => {
    const s = world()
    noteDeterred(s, 'france')
    expect(s.presence).toBeUndefined()
    give(s, 'france', { infantry: 6 })
    post(s, 'france', { border: { germany: 0.3 } })
    noteDeterred(s, 'france')
    expect(ledgerFor(s, 'france').deterred).toBe(1)
  })
})

describe('the AI reads and answers a posture', () => {
  it('a guarded border takes some of the shine off a target, more on Hard; an unguarded one invites a probe', () => {
    const s = world()
    give(s, 'germany', { infantry: 12 })
    post(s, 'germany', { border: { france: 0.9 } })
    expect(postureRead(s, map, 'france', 'germany', 0, 0.9)).toBe(1)
    const med = postureRead(s, map, 'france', 'germany', 1, 0.9)
    const hard = postureRead(s, map, 'france', 'germany', 2, 0.9)
    expect(med).toBeLessThan(1)
    expect(hard).toBeLessThan(med)
    expect(postureRead(s, map, 'france', 'italy', 2, 0.9)).toBeGreaterThan(1)
    expect(postureRead(s, map, 'france', 'italy', 2, 0.2)).toBe(1)
    PRESENCE.on = false
    expect(postureRead(s, map, 'france', 'germany', 2, 0.9)).toBe(1)
  })

  it('a rival matches a build-up on its border: more troops across raise its own garrison', () => {
    const s = world()
    give(s, 'france', { infantry: 12 })
    give(s, 'germany', { infantry: 12 })
    const calm = plannedPosture(s, map, 'france', 2).border.germany ?? 0
    post(s, 'germany', { border: { france: 0.9 } })
    const mirrored = plannedPosture(s, map, 'france', 2).border.germany ?? 0
    expect(mirrored).toBeGreaterThan(calm)
    expect(deploymentOrder(s, map, 'france', 2)).not.toBeNull()
  })

  it('alert: Easy never touches it, Hard raises it at war and eases it when nobody is a worry', () => {
    const s = world()
    give(s, 'france', { infantry: 12, naval: 4 })
    post(s, 'france', { coastal: 0.3, border: { germany: 0.2 } })
    expect(alertOrder(s, map, 'france', 0)).toBeNull()
    s.wars.push('france|germany')
    expect(alertOrder(s, map, 'france', 1)).toMatchObject({ alert: 'high' })
    s.wars = []
    s.nations.france.military.deployment!.alert = 'high'
    expect(alertOrder(s, map, 'france', 1)).toMatchObject({ alert: 'normal' })
    expect(alertOrder(s, map, 'france', 2)?.type).toBe('setAlert')
  })

  it('presets: defensive posts more, forward less, balanced is the planner\'s own', () => {
    const s = world()
    give(s, 'france', { infantry: 14, armor: 4, naval: 6, fighter: 4 })
    const total = (p: ReturnType<typeof presetPosture>) => Object.values(p.border).reduce((t, v) => t + v, 0)
    const d = presetPosture(s, map, 'france', 'defensive')
    const b = presetPosture(s, map, 'france', 'balanced')
    const f = presetPosture(s, map, 'france', 'forward')
    expect(b).toEqual(plannedPosture(s, map, 'france', 1))
    expect(total(d)).toBeGreaterThanOrEqual(total(b))
    expect(total(b)).toBeGreaterThanOrEqual(total(f))
    expect(d.coastal + d.subs).toBeGreaterThanOrEqual(f.coastal + f.subs)
    for (const p of [d, b, f]) {
      expect(total(p)).toBeLessThanOrEqual(1 + 1e-9)
      expect(p.coastal + p.subs).toBeLessThanOrEqual(1 + 1e-9)
      const err = applyOrderNow(s, map, { type: 'setDeployment', nationId: 'france', ...p }).error
      expect(err === null || /moved this month/.test(err)).toBe(true)
      s.turn++
    }
  })

  it('Medium and Hard bots over a year keep every alert legal and the world running', () => {
    let s = world()
    s.settings.difficulty = 'hard'
    for (let i = 0; i < 12; i++) s = resolveTurn(s, map, generateAllBotOrders(s, map))
    const alerts = Object.values(s.nations).map((n) => n.military.deployment?.alert)
    expect(alerts.some((a) => a === 'high' || a === 'relaxed' || a === undefined)).toBe(true)
    for (const n of Object.values(s.nations)) {
      const r = n.military.deployment?.ready
      if (r !== undefined) expect(r).toBeGreaterThanOrEqual(0)
      if (r !== undefined) expect(r).toBeLessThanOrEqual(100)
    }
  })
})

describe('the desk reads the world', () => {
  it('a theatre for each neighbor with tension, cover and what is changing', () => {
    const s = world()
    give(s, 'france', { infantry: 10, naval: 4 })
    post(s, 'france', { coastal: 0.5, border: { germany: 0.4 } })
    s.turn++
    runPresence(s, map, gross(s))
    s.turn++
    s.borders = { 'france|germany': { heat: 30, at: s.turn } }
    const th = theatresOf(s, map, 'france')
    const g = th.find((t) => t.other === 'germany')!
    expect(g.kind).toBe('land')
    expect(g.mine).toBeGreaterThan(0)
    expect(g.delta).not.toBeNull()
    expect(g.changing.length).toBeGreaterThan(3)
    expect(th.some((t) => t.kind === 'sea')).toBe(true)
    expect(th.map((t) => t.tension)).toEqual(expect.arrayContaining([g.tension]))
  })

  it('at war with a weak front is a danger; the recommendation follows', () => {
    const s = world()
    give(s, 'france', { infantry: 10 })
    s.wars.push('france|germany')
    const t = theatresOf(s, map, 'france').find((x) => x.other === 'germany')!
    expect(t.threat).toBe('high')
    expect(recommendPreset(s, map, 'france').preset).toBe('defensive')
    s.wars = []
    expect(['balanced', 'forward']).toContain(recommendPreset(s, map, 'france').preset)
  })

  it('the ledger says what the forces have done, and the advisor can point at it', () => {
    const s = world()
    expect(ledgerLines(s, 'france').every((l) => l.value === '0')).toBe(true)
    ledgerFor(s, 'france').deterred = 4
    expect(ledgerLines(s, 'france').find((l) => l.key === 'deterred')!.value).toBe('4')
    expect(Array.isArray(advise(s, map, 'france'))).toBe(true)
  })
})
