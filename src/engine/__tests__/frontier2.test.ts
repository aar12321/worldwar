import { describe, expect, it } from 'vitest'
import { FRONTIER, NANO_LESS_DAMAGE, SHIELD_STOPS, SYSTEM_SPECS, systemsCost } from '../../data/systems'
import { UNIT_SPECS } from '../../data/unitTypes'
import { interceptFactor, jamFactor, resolveBattle, sidePower, type Combatant } from '../combat'
import { createRng } from '../rng'
import { canUseUnit, emptyUnits, maxAttacks, totalUnits } from '../helpers'
import { orderCost, validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { forecastAttack, resolveAttack } from '../warfare'
import { runStrike, systemUpkeep } from '../systems'
import type { GameState, UnitCounts } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const even = { infantry: 1, armor: 1, artillery: 1, fighter: 1, air: 1, naval: 1, drone: 1, robot: 1, missile: 1 }
const side = (units: Partial<UnitCounts>, sys: Combatant['sys'] = {}): Combatant => ({ units: { ...emptyUnits(), ...units }, mods: null, penalty: 1, penaltyNotes: [], sys })

/** Plays a battle many times on different seeds and returns the average losses of each side. */
function average(att: Combatant, def: Combatant, runs = 40) {
  let a = 0
  let d = 0
  let wins = 0
  for (let i = 0; i < runs; i++) {
    const out = resolveBattle({ attacker: att, defender: def, terrain: 'plains', coastal: false }, createRng(11, i))
    a += totalUnits(out.attackerLosses)
    d += totalUnits(out.defenderLosses)
    if (out.winner === 'attacker') wins++
  }
  return { att: a / runs, def: d / runs, wins: wins / runs }
}

describe('the new units', () => {
  it('exist, need no soldiers, and need their technology', () => {
    for (const u of ['drone', 'robot', 'missile'] as const) {
      expect(UNIT_SPECS[u].manpowerCost).toBe(0)
      expect(UNIT_SPECS[u].requiresBuilding).toBe('factory')
    }
    const s = startState(lineMap(3))
    expect(canUseUnit(s.nations.r0, 'drone')).toBe(false)
    s.nations.r0.techs.push('frontier_drones', 'frontier_robotics', 'frontier_hypersonic')
    expect(canUseUnit(s.nations.r0, 'drone') && canUseUnit(s.nations.r0, 'robot') && canUseUnit(s.nations.r0, 'missile')).toBe(true)
  })

  it('can be trained without any soldiers, and cost steel and money', () => {
    const s = startState(lineMap(3))
    const n = s.nations.r0
    n.techs.push('frontier_drones', 'frontier_robotics')
    n.militaryPool = 0
    n.resources.capital = 500
    n.resources.steel = 50
    s.regions.r0.buildings.factory = 2
    const order = { type: 'queueTrain', nationId: 'r0', unit: 'robot' } as const
    expect(validateOrder(s, lineMap(3), order)).toBeNull()
    expect(orderCost(s, order)).toMatchObject({ capital: 30, manpower: 0, steel: 4 })
  })
})

describe('what each new weapon does and what stops it', () => {
  it('drones take the first losses, so the soldiers behind them live', () => {
    const att = side({ infantry: 6, drone: 6 })
    const def = side({ infantry: 8, armor: 2 })
    const out = resolveBattle({ attacker: att, defender: def, terrain: 'plains', coastal: false }, createRng(3, 1))
    expect(out.attackerLosses.drone).toBeGreaterThan(0)
    expect(out.attackerLosses.drone).toBeGreaterThan(out.attackerLosses.infantry)
  })

  it('drones are deadly to an army of tanks and guns, and fighters and shields shoot them down', () => {
    const heavy = side({ armor: 4, artillery: 4 })
    const light = side({ infantry: 8 })
    expect(sidePower({ ...side({ drone: 6 }), droneBonus: 1.5 }, even, 'plains', false, false)).toBeGreaterThan(sidePower(side({ drone: 6 }), even, 'plains', false, false))
    const vsHeavy = average(side({ drone: 8 }), heavy)
    const vsLight = average(side({ drone: 8 }), light)
    expect(vsHeavy.def / totalUnits(heavy.units)).toBeGreaterThan(vsLight.def / totalUnits(light.units))
    const free = average(side({ drone: 8 }), side({ infantry: 8 }))
    const fighters = average(side({ drone: 8 }), side({ infantry: 8, fighter: 3 }))
    expect(fighters.att).toBeGreaterThan(free.att)
    const shield = average(side({ drone: 8 }), side({ infantry: 8 }, { shield: 3 }))
    expect(shield.def).toBeLessThan(free.def)
  })

  it('an Interceptor Shield stops a growing share of missiles', () => {
    expect(SHIELD_STOPS).toEqual([0, 0.2, 0.35, 0.5])
    expect(interceptFactor(3)).toBeCloseTo(0.5)
    const open = average(side({ missile: 6, infantry: 4 }), side({ infantry: 8 }))
    const shielded = average(side({ missile: 6, infantry: 4 }), side({ infantry: 8 }, { shield: 3 }))
    expect(shielded.def).toBeLessThan(open.def)
  })

  it('a higher Cyber Command jams drones and robots, and an equal one does not', () => {
    expect(jamFactor(0, 2)).toBeCloseTo(0.8)
    expect(jamFactor(2, 2)).toBe(1)
    expect(jamFactor(3, 0)).toBe(1)
    expect(jamFactor(0, 3)).toBeCloseTo(0.7)
    const robots = average(side({ robot: 8 }), side({ infantry: 8 }))
    const hacked = average(side({ robot: 8 }), side({ infantry: 8 }, { cyber: 3 }))
    expect(hacked.def).toBeLessThan(robots.def)
    const parity = average(side({ robot: 8 }, { cyber: 3 }), side({ infantry: 8 }, { cyber: 3 }))
    expect(parity.def).toBeCloseTo(robots.def, 1)
  })

  it('nano-armor takes damage away and brings part of the losses back', () => {
    expect(NANO_LESS_DAMAGE[3]).toBeCloseTo(0.22)
    const plain = average(side({ infantry: 8 }), side({ infantry: 8 }))
    const nano = average(side({ infantry: 8 }), side({ infantry: 8 }, { nano: 3 }))
    expect(nano.def).toBeLessThan(plain.def)
  })

  it('missiles strike first, in their own opening round, and only when somebody has them', () => {
    const none = resolveBattle({ attacker: side({ infantry: 5 }), defender: side({ infantry: 5 }), terrain: 'plains', coastal: false }, createRng(1, 1))
    expect(none.rounds.some((r) => r.name === 'Missile & Drone Strike')).toBe(false)
    const strike = resolveBattle({ attacker: side({ infantry: 5, missile: 3 }), defender: side({ infantry: 5 }), terrain: 'plains', coastal: false }, createRng(1, 1))
    expect(strike.rounds[0].name).toBe('Missile & Drone Strike')
    expect(strike.rounds[0].attackerDamage).toBeGreaterThan(0)
  })

  it('battery strikes crack the Defense Line directly, and a shield blunts them', () => {
    const map = lineMap(3)
    const make = (shield: number) => {
      const s = startState(map)
      s.wars.push('r0|r1')
      setMilitary(s, 'r0', { infantry: 20, missile: 4 })
      setMilitary(s, 'r1', { infantry: 3 })
      s.nations.r1.systems.shield = shield
      s.regions.r1.line = 12
      return s
    }
    const open = make(0)
    const shielded = make(3)
    const a = resolveAttack(open, map, 'r0', 'r1', createRng(1, 1))!.report
    const b = resolveAttack(shielded, map, 'r0', 'r1', createRng(1, 1))!.report
    // The same fight, but the shield stops part of the salvo, so less of the line is gone.
    expect(a.lineAfter ?? 0).toBeLessThan(b.lineAfter ?? 0)
    expect(a.modifiers.some((m) => m.startsWith('Hypersonic batteries cut'))).toBe(true)
  })

  it('robot losses do not add war weariness', () => {
    const map = lineMap(3)
    const run = (units: Partial<UnitCounts>) => {
      const s = startState(map)
      s.wars.push('r0|r1')
      setMilitary(s, 'r0', units)
      setMilitary(s, 'r1', { infantry: 12 })
      resolveAttack(s, map, 'r0', 'r1', createRng(2, 2))
      return s.nations.r0.warWeariness
    }
    expect(run({ robot: 10 })).toBeLessThan(run({ infantry: 10 }))
  })
})

describe('systems', () => {
  it('need their technology, can be bought several levels at once, and cost upkeep', () => {
    const map = lineMap(3)
    const s = startState(map)
    s.nations.r0.resources.capital = 2000
    const order = { type: 'fundSystem', nationId: 'r0', system: 'shield', levels: 3 } as const
    expect(validateOrder(s, map, order)).toMatch(/Needs/)
    s.nations.r0.techs.push('frontier_missile_defense')
    expect(validateOrder(s, map, order)).toBeNull()
    const next = structuredClone(s)
    expect(applyOrderNow(next, map, order).error).toBeNull()
    expect(next.nations.r0.systems.shield).toBe(3)
    expect(next.nations.r0.resources.capital).toBe(2000 - systemsCost('shield', 0, 3))
    expect(systemUpkeep(next.nations.r0)).toBe(3 * SYSTEM_SPECS.shield.upkeep)
    expect(validateOrder(next, map, { ...order, levels: 1 })).toMatch(/highest/)
  })

  it('AI Battle Command adds attacks a month and exact odds', () => {
    const map = lineMap(3)
    const s = startState(map)
    s.wars.push('r0|r1')
    setMilitary(s, 'r0', { infantry: 20 })
    const before = maxAttacks(s, 'r0')
    expect(forecastAttack(s, map, 'r0', 'r1', 'main', 'assault')?.exact).toBe(false)
    s.nations.r0.systems.ai = 2
    expect(maxAttacks(s, 'r0')).toBe(before + 2)
    expect(forecastAttack(s, map, 'r0', 'r1', 'main', 'assault')?.exact).toBe(true)
  })

  it('Nano-medicine calms the people', () => {
    const s = startState(lineMap(3))
    const before = (s2: GameState) => resolveTurn(s2, lineMap(3), []).nations.r0.stability
    const plain = before(s)
    s.nations.r0.systems.nano = 3
    expect(before(s)).toBeGreaterThanOrEqual(plain)
  })
})

describe('strikes from afar', () => {
  const map = lineMap(4)
  const setup = (): GameState => {
    const s = startState(map)
    s.wars.push('r0|r3')
    s.nations.r0.resources.capital = 500
    s.nations.r0.resources.pp = 100
    s.regions.r0.buildings.factory = 1
    s.regions.r3.line = 10
    return s
  }
  it('a hypersonic salvo needs batteries and a war, and cuts the line and the factories', () => {
    const s = setup()
    const order = { type: 'strike', nationId: 'r0', target: 'r3', weapon: 'missile' } as const
    expect(validateOrder(s, map, order)).toMatch(/hypersonic battery/)
    setMilitary(s, 'r0', { infantry: 10, missile: 4 })
    expect(validateOrder(s, map, order)).toBeNull()
    const next = resolveTurn(s, map, [order])
    expect(next.regions.r3.line).toBeLessThan(10)
    expect(next.regions.r3.sabotaged).toBeGreaterThan(0)
    expect(next.log.some((l) => l.text.includes('Hypersonic missiles'))).toBe(true)
    expect(validateOrder({ ...s, nations: { ...s.nations } }, map, { ...order, target: 'r1' })).toMatch(/at war/)
  })

  it('a shield stops part of it', () => {
    const open = setup()
    const shielded = setup()
    for (const s of [open, shielded]) setMilitary(s, 'r0', { infantry: 10, missile: 4 })
    shielded.nations.r3.systems.shield = 3
    runStrike(open, map, { type: 'strike', nationId: 'r0', target: 'r3', weapon: 'missile' })
    runStrike(shielded, map, { type: 'strike', nationId: 'r0', target: 'r3', weapon: 'missile' })
    expect(open.regions.r3.line).toBeLessThan(shielded.regions.r3.line)
  })

  it('the orbital strike needs the network, is once a year, and shames the sender', () => {
    const s = setup()
    s.regions.r3.buildings.factory = 3
    const order = { type: 'strike', nationId: 'r0', target: 'r3', weapon: 'orbital' } as const
    expect(validateOrder(s, map, order)).toMatch(/Orbital Network/)
    s.nations.r0.systems.orbital = 2
    expect(validateOrder(s, map, order)).toBeNull()
    const next = resolveTurn(s, map, [order])
    expect(next.regions.r3.line).toBeLessThan(10 - FRONTIER.orbitalLine + 1)
    expect(next.regions.r3.buildings.factory).toBe(2)
    expect(next.infamy.r0).toBeGreaterThan(0)
    expect(validateOrder(next, map, order)).toMatch(/recharges/)
    next.turn += FRONTIER.orbitalCooldown
    expect(validateOrder(next, map, order)).toBeNull()
  })

  it('an Orbital Network watches every enemy', () => {
    const s = setup()
    s.nations.r0.systems.orbital = 1
    const next = resolveTurn(s, map, [])
    expect((next.intel['r0|r3'] ?? 0) >= next.turn).toBe(true)
  })
})
