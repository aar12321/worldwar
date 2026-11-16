import { describe, expect, it } from 'vitest'
import { addOpinion } from '../../ai/opinion'
import readme from '../../../README.md?raw'
import help from '../../ui/Help.tsx?raw'
import types from '../types.ts?raw'
import { createInitialState } from '../../data/startingNations'
import { EVENTS } from '../../data/events'
import { COUP } from '../../data/government'
import { TECHS } from '../../data/techTree'
import { TRAITS, traitOf } from '../../data/traits'
import { EMPIRE, REACH } from '../../data/war'
import { getWorld } from '../../map/world'
import { CAUGHT_SPYING } from '../espionage'
import { combatMods } from '../arms'
import { resolveBattle, type Combatant } from '../combat'
import { computeEconomy } from '../economy'
import { updateTiers } from '../empire'
import { applyEventChoice, FIRST_EVENT_TURN, scheduleEvent } from '../events'
import { emptyUnits } from '../helpers'
import { runCrises } from '../crises'
import { runJustification } from '../justification'
import { nextWeaponLevel } from '../arms'
import { annexCost, validateOrder } from '../orders'
import { runPolitics } from '../politics'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { createRng } from '../rng'
import { resolveRebels } from '../warfare'
import type { GameState, UnitCounts } from '../types'
import { checkInvariants } from './invariants'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)
const units = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u })
const side = (u: Partial<UnitCounts>): Combatant => ({ units: units(u), mods: null, penalty: 1, penaltyNotes: [] })

describe('1. bonuses from many countries flatten out', () => {
  it('a big empire earns at most about a third more per worker than a single country', () => {
    const { map: world } = getWorld()
    const s = createInitialState(world, { playerRegionId: 'germany', seed: 3, difficulty: 'normal', goal: 'classic', victoryShare: 2 })
    const one = computeEconomy(s, world, 'germany')
    const perWorker = one.gross / one.workforce
    for (const count of [10, 25]) {
      const t = structuredClone(s)
      let held = 1
      for (const id of world.order) {
        if (held >= count) break
        if (t.regions[id].owner === 'germany') continue
        t.regions[id].owner = 'germany'
        held++
      }
      for (const r of Object.values(t.regions)) r.integration = 1
      updateTiers(t)
      const e = computeEconomy(t, world, 'germany')
      expect(e.gross / e.workforce / perWorker, `${count} countries`).toBeLessThan(1.3)
    }
  })
})

describe('3. a coup', () => {
  const coup = (s: GameState) => validateOrder(s, map, { type: 'operation', nationId: 'r0', op: 'coup', target: 'r1' })
  function plot() {
    const s = startState(map)
    s.nations.r0.agencies.foreign.level = 5
    s.nations.r0.resources.capital = 500
    s.nations.r0.resources.pp = 200
    s.nations.r1.stability = 30
    s.regions.r2.owner = 'r0'
    s.nations.r0.military.units.infantry = s.nations.r1.military.units.infantry + 5
    return s
  }
  it('is refused against a nation at war, and an annexation costs more for a bigger puppet', () => {
    const s = plot()
    expect(coup(s)).toBeNull()
    s.wars.push('r1|r3')
    expect(coup(s)).toMatch(/at war/)
    const small = annexCost(s, 'r1')
    s.regions.r4.owner = 'r1'
    s.regions.r5.owner = 'r1'
    expect(annexCost(s, 'r1')).toBeGreaterThan(small)
  })
})

describe('4. stability cannot be stacked into a free ride', () => {
  it('the first change of government is allowed at once, with no cooldown to wait out', () => {
    const s = startState(map)
    s.nations.r0.resources.pp = 100
    expect(s.nations.r0.lastReform).toBeLessThan(-24)
    const other = s.nations.r0.government === 'junta' ? 'monarchy' : 'junta'
    expect(validateOrder(s, map, { type: 'setGovernment', nationId: 'r0', government: other })).toBeNull()
  })

  it('a fallen junta is replaced by one at 30% stability, with loyalist rebels in the country', () => {
    let seen = 0
    for (let seed = 1; seed <= 60 && seen === 0; seed++) {
      const s = startState(map)
      giveRegions(s, 'r0', ['r1', 'r2'])
      s.nations.r0.government = 'junta'
      s.nations.r0.stability = 5
      s.nations.r0.laws = ['rationing']
      runPolitics(s, map, createRng(seed, 2))
      if (s.nations.r0.laws.length > 0) continue
      seen++
      expect(s.nations.r0.stability).toBe(COUP.stabilityAfter)
      expect(Object.values(s.regions).filter((r) => r.owner === 'r0').reduce((sum, r) => sum + r.rebels, 0)).toBeGreaterThanOrEqual(1)
    }
    expect(seen).toBe(1)
  })

  it('everything stacked together still cannot hold a 60% tax rate calm', () => {
    const s = startState(map)
    const n = s.nations.r0
    n.government = 'one_party'
    n.laws = ['martial_law', 'press_control', 'austerity'] as never
    n.techs = ['infra_propaganda', 'eco_schools']
    n.spending = { ...n.spending, health: 4, pensions: 2, housing: 2, jobless: 2 }
    n.people.health = 0.95
    n.taxRate = 0.6
    expect(computeEconomy(s, map, 'r0').stabilityTarget).toBeLessThan(60)
  })
})

describe('5. combat', () => {
  it('drones take about half as much again as their share of the losses', () => {
    let drones = 0
    let foot = 0
    for (let seed = 1; seed <= 20; seed++) {
      const out = resolveBattle({ attacker: side({ infantry: 30 }), defender: side({ infantry: 10, drone: 10 }), terrain: 'plains', coastal: false }, createRng(seed, 1))
      drones += out.defenderLosses.drone / 10
      foot += out.defenderLosses.infantry / 10
    }
    expect(drones / foot).toBeGreaterThan(1.2)
    expect(drones / foot).toBeLessThan(1.9)
  })

  it('rebels are fought by the garrison and a quarter of the army, not all of it', () => {
    const s = startState(map)
    giveRegions(s, 'r0', ['r1'])
    setMilitary(s, 'r0', { infantry: 40 })
    s.regions.r1.rebels = 2
    resolveRebels(s, map, createRng(1, 1))
    const fought = s.battles[s.battles.length - 1].defender.units.infantry
    expect(fought).toBeGreaterThan(40 * 0.25 - 1e-9)
    expect(fought).toBeLessThan(40 * 0.25 + 5)
  })

  it('nano-medicine does not turn a lost garrison into soldiers of the army', () => {
    const s = startState(map)
    s.wars.push('r0|r1')
    setMilitary(s, 'r0', { infantry: 30 })
    setMilitary(s, 'r1', {})
    s.nations.r1.systems.nano = 3
    s.regions.r1.line = 30
    expect(applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault' }).error).toBeNull()
    expect(s.nations.r1.military.units.infantry).toBe(0)
  })

  it('a token navy or air force cannot carry an army overseas: the rule is a twentieth of the military', () => {
    expect(REACH.carryShare).toBe(0.05)
    expect(help).toMatch(/at least a twentieth of your military/)
    expect(readme).toMatch(/at least a twentieth of your military/)
  })
})

describe('6. a breakaway nation starts clean', () => {
  function rebelState() {
    const s = startState(map)
    giveRegions(s, 'r0', ['r1'])
    // The old ruler owes money, is itself a puppet, and has Frontier systems, a wealth fund and a high tier.
    for (const id of ['r0', 'r1']) {
      const n = s.nations[id]
      n.alive = true
      n.bonds = [{ id: `bd-${id}`, amount: 300, rate: 0.01, due: 40, term: 36 }]
      n.debt = 300
      n.overlord = 'r5'
      n.systems.cyber = 3
      n.bank.fund = 500
      n.tier = 4
    }
    s.nations.r0.techs = [...s.nations.r0.techs, 'eco_schools']
    s.regions.r1.rebels = 60
    setMilitary(s, 'r0', { infantry: 1 })
    return s
  }
  it('a new nation owes nothing, has no master and starts at the bottom', () => {
    const s = rebelState()
    resolveRebels(s, map, createRng(1, 1))
    const free = s.nations[s.regions.r1.owner]
    expect(free.id).not.toBe('r0')
    expect(free.id).not.toBe('r1')
    expect(free.debt).toBe(0)
    expect(free.bonds).toEqual([])
    expect(free.overlord).toBeNull()
    expect(free.systems.cyber).toBe(0)
    expect(free.bank.fund).toBe(0)
    expect(free.tier).toBe(1)
    expect(free.techs.every((t) => s.nations.r0.techs.includes(t))).toBe(true)
    expect(free.techs.length).toBeLessThanOrEqual(s.nations.r0.techs.length)
    expect(s.wars).toContain(`${[free.id, 'r0'].sort().join('|')}`)
  })
  it('a nation brought back from the dead owes nothing and answers to no one either, and the war counts', () => {
    const s = rebelState()
    s.nations.r1.alive = false
    s.nations.r1.debt = 400
    s.nations.r1.bonds = [{ id: 'bd2', amount: 400, rate: 0.01, due: 40, term: 36 }]
    s.nations.r1.overlord = 'r0'
    resolveRebels(s, map, createRng(1, 1))
    const back = s.nations.r1
    expect(back.alive).toBe(true)
    expect(back.debt).toBe(0)
    expect(back.bonds).toEqual([])
    expect(back.overlord).toBeNull()
    expect(s.wars).toContain('r0|r1')
  })
})

describe('7. diplomacy rules', () => {
  it('a crisis does not boil into war between nations with a pact, or when a side is at its war limit', () => {
    const dispute = (s: GameState) => s.crises.push({ id: 'cr1', kind: 'dispute', nation: 'r1', rival: 'r0', area: 'Somewhere', stage: 2, next: s.turn, boil: 1, answered: [] })
    const pact = startState(map)
    pact.pacts['r0|r1'] = pact.turn + 10
    dispute(pact)
    runCrises(pact, map, createRng(1, 1))
    expect(pact.wars).not.toContain('r0|r1')
    const busy = startState(map)
    for (const e of ['r2', 'r3', 'r4']) busy.wars.push(`r0|${e}`)
    dispute(busy)
    runCrises(busy, map, createRng(1, 1))
    expect(busy.wars).not.toContain('r0|r1')
    const free = startState(map)
    dispute(free)
    runCrises(free, map, createRng(1, 1))
    expect(free.wars).toContain('r0|r1')
  })

  it('a case that is dropped says why', () => {
    const s = startState(map)
    s.cases.push({ holder: 'r0', target: 'r1', ready: s.turn + 3 })
    s.pacts['r0|r1'] = s.turn + 12
    runJustification(s, map, createRng(1, 1))
    expect(s.cases).toHaveLength(0)
    expect(s.log.some((l) => /was dropped: a non-aggression pact is in force/.test(l.text))).toBe(true)
  })
})

describe('8. weapons and generals', () => {
  it('the weapons gate reads the best single factory, not a sum of small ones', () => {
    const s = startState(map)
    giveRegions(s, 'r0', ['r1', 'r2', 'r3'])
    for (const id of ['r0', 'r1', 'r2', 'r3']) s.regions[id].buildings.factory = 1
    s.nations.r0.military.weapons.infantry = 1
    expect(nextWeaponLevel(s, 'r0', 'infantry').error).toMatch(/factory of level 2/)
    s.regions.r0.buildings.factory = 2
    expect(nextWeaponLevel(s, 'r0', 'infantry').error).toBeNull()
    // An academy's engineers stand in for a level of factory.
    s.regions.r0.buildings.factory = 1
    s.nations.r0.academy = 1
    expect(nextWeaponLevel(s, 'r0', 'infantry').error).toBeNull()
  })

  it('every kind of general does something real', () => {
    const base = startState(map)
    const mods = (trait: string) => {
      const s = structuredClone(base)
      s.nations.r0.generals = [{ id: 'g1', name: 'G', trait } as never]
      s.nations.r0.military.commanderId = 'g1'
      return s
    }
    const plain = combatMods(base.nations.r0)
    expect(combatMods(mods('stalwart').nations.r0).unitDefense.infantry).toBeGreaterThan(plain.unitDefense.infantry)
    expect(combatMods(mods('air_marshal').nations.r0).unitAttack.fighter).toBeGreaterThan(plain.unitAttack.fighter)
    expect(combatMods(mods('mountaineer').nations.r0).ignoreMountainPenalty).toBe(true)
    setMilitary(base, 'r0', { infantry: 20, armor: 6 })
    expect(computeEconomy(mods('logistician'), map, 'r0').upkeep).toBeLessThan(computeEconomy({ ...structuredClone(base), nations: base.nations }, map, 'r0').upkeep)
  })
})

describe('9. no dead content', () => {
  it('Spy Scandal can fire once agents have been caught', () => {
    const s = startState(map)
    const def = EVENTS.find((e) => e.id === 'spy_scandal')!
    expect(def.weight(s, 'r0')).toBe(0)
    addOpinion(s, 'r1', 'r0', CAUGHT_SPYING, -25, 0.4)
    expect(def.weight(s, 'r0')).toBeGreaterThan(0)
    expect(def.rivalCandidates!(s, 'r0')).toEqual(['r1'])
  })

  it('every country has a trait that exists', () => {
    const { map: world } = getWorld()
    for (const r of Object.values(world.regions)) expect(TRAITS[traitOf(r.id, r)], r.id).toBeDefined()
  })
})

describe('10. the words match the rules', () => {
  it('the annex wait, the first event and the puppet rule are told the way the engine has them', () => {
    expect(EMPIRE.annexMonths).toBe(12)
    expect(readme).toMatch(/after a year it can be \*\*annexed\*\*/)
    expect(help).toMatch(/After a year you can annex it/)
    expect(startState(map).nextEventTurn).toBe(9999)
    expect(createInitialState(map, { playerRegionId: 'r0', seed: 1, goal: 'classic', victoryShare: 2 }).nextEventTurn).toBe(FIRST_EVENT_TURN)
    expect(types).toMatch(new RegExp(`wait until turn ${FIRST_EVENT_TURN} \\(FIRST_EVENT_TURN\\)`))
    expect(help).toMatch(/Each country a puppet holds counts as half/)
  })
})

describe('11. markets', () => {
  function buyer() {
    const s = startState(map)
    s.regions.r0.buildings.port = 1
    s.nations.r0.resources.steel = 0
    s.nations.r0.resources.capital = 600
    s.nations.r0.autoBuy = ['steel']
    // Nothing of its own to make steel with, so only the market can fill the store.
    for (const r of Object.values(s.regions)) r.buildings.factory = 0
    for (const k of Object.keys(s.nations.r0.sectors) as (keyof typeof s.nations.r0.sectors)[]) s.nations.r0.sectors[k] = 0
    return s
  }
  it('steel on auto-buy is bought when the store runs low, and an embargo cuts what can be bought', () => {
    const open = resolveTurn(buyer(), map, []).nations.r0.resources.steel
    expect(open).toBeGreaterThan(0.5)
    const blocked = buyer()
    blocked.nations.r0.embargoedUntil = blocked.turn + 3
    expect(resolveTurn(blocked, map, []).nations.r0.resources.steel).toBeLessThan(open)
  })
})

describe('12. events', () => {
  /** A state in which every event has a reason to be offered. */
  function stirred() {
    const s = startState(lineMap(12))
    const m = lineMap(12)
    giveRegions(s, 'r0', ['r1', 'r2'])
    const n = s.nations.r0
    n.foodShortage = true
    n.stability = 30
    n.debt = 100
    n.bonds = [{ id: 'bd1', amount: 100, rate: 0.01, due: 40, term: 36 }]
    n.bank.inflation = 10
    n.people.migration = -1
    n.spending.health = 0
    n.spending.pensions = 2
    n.people.unemployment = 0.1
    n.tier = 4
    n.projects = { rail: { progress: 1, done: false } }
    s.regions.r1.buildings.port = 1
    s.wars.push('r5|r6', 'r0|r7')
    s.alliances.push('r0|r5')
    // A rival that knows something this nation could learn now.
    const learnable = TECHS.find((x) => !n.techs.includes(x.id) && x.requires.every((r) => n.techs.includes(r)))!
    s.nations.r8.techs = [...n.techs, learnable.id]
    addOpinion(s, 'r8', 'r0', CAUGHT_SPYING, -25, 0.4)
    addOpinion(s, 'r9', 'r0', 'Defied us', -30, 0.5)
    n.programs = { ...n.programs, creditSector: 'finance' as never }
    return { s, m }
  }

  it('each of the events can be offered, and choosing either way keeps every number in range', () => {
    const { s, m } = stirred()
    const fired = new Set<string>()
    for (let seed = 1; seed <= 1500 && fired.size < EVENTS.length; seed++) {
      const ev = scheduleEvent(s, m, 'r0', createRng(seed, 5))
      if (ev) fired.add(ev.eventId)
    }
    expect(EVENTS.map((e) => e.id).filter((id) => !fired.has(id))).toEqual([])
    for (const def of EVENTS) {
      for (const choice of [0, 1]) {
        const t = structuredClone(s)
        t.pendingEvent = { eventId: def.id, turn: t.turn, rivalId: def.needsRival ? 'r8' : null, regionId: def.needsRegion ? 'r2' : null }
        const after = applyEventChoice(t, m, choice)
        expect(Number.isFinite(after.nations.r0.resources.capital), `${def.id} ${choice}`).toBe(true)
        checkInvariants(after)
      }
    }
  }, 120_000)

  it('an event that costs money can push a poor nation into the red, and then into debt', () => {
    const s = startState(map)
    s.nations.r0.resources.capital = 0
    s.pendingEvent = { eventId: 'bread_riot', turn: s.turn, rivalId: null, regionId: null }
    const after = applyEventChoice(s, map, 1)
    expect(after.nations.r0.resources.capital).toBeLessThan(0)
    expect(resolveTurn(after, map, []).nations.r0.debtTurns).toBeGreaterThan(0)
  })
})
