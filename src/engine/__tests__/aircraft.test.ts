import { describe, expect, it } from 'vitest'
import { generateBotOrders } from '../../ai/bot'
import { AIRCRAFT_BRANCH_IDS, AIRCRAFT_CAPS, AIRCRAFT_IDS, AIRCRAFT_NODES, AIRCRAFT_RULES, aircraftLines, type AircraftNodeId } from '../../data/aircraft'
import { tierSpec } from '../../data/empire'
import { MISSILE_PROGRAM } from '../../data/missiles'
import { TECH_BY_ID } from '../../data/techTree'
import { TRAINING, UNIT_SPECS } from '../../data/unitTypes'
import { REACH } from '../../data/war'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import {
  activeDevs, aircraftBill, aircraftEffects, aircraftPace, airReach, bomberBonus, devSlots, devView, finishedDevs, firstMonth, huntCover, monthSpend,
  pastDefenses, startAircraftDevProblem, wantedAircraft,
} from '../aircraft'
import { combatMods } from '../arms'
import { airSuperiority, resolveBattle, type Combatant } from '../combat'
import { computeEconomy } from '../economy'
import { emptyUnits, pairKey, totalUnits } from '../helpers'
import { advanceDay, startLive } from '../live'
import { militarySheet } from '../militaryStats'
import { MONTH_END_ORDERS, orderCost, validateOrder } from '../orders'
import { getsThrough } from '../missiles'
import { applyOrderNow, describeOrder, resolveTurn } from '../resolveTurn'
import { createRng } from '../rng'
import { runStrike } from '../systems'
import type { GameState, Nation, Order, UnitCounts } from '../types'
import { canAttackRegion, forecastAttack, resolveAttack } from '../warfare'
import { planTrip } from '../armies'
import { daysInMonth } from '../calendar'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(4)

/** Techs that open every development. */
const ALL_TECH = ['air_propeller', 'air_bombers', 'air_jets', 'air_radar', 'frontier_drones', 'cyber_warfare']

/** A state where r0 can develop anything it could afford: techs, money, research and size. */
function rich(tier: 1 | 2 | 3 | 4 | 5 = 3, m = map): GameState {
  const s = startState(m)
  const n = s.nations.r0
  n.techs.push(...ALL_TECH)
  n.tier = tier
  n.resources.capital = 5000
  n.resources.tp = 1000
  return s
}

const start = (node: AircraftNodeId): Extract<Order, { type: 'startAircraftDev' }> => ({ type: 'startAircraftDev', nationId: 'r0', node })
const pause = (node: AircraftNodeId, paused: boolean): Extract<Order, { type: 'pauseAircraftDev' }> => ({ type: 'pauseAircraftDev', nationId: 'r0', node, paused })

/** Marks developments finished, as a long program would have left them. */
function finish(n: Nation, ...ids: AircraftNodeId[]) {
  n.aircraft ??= {}
  for (const id of ids) n.aircraft[id] = { progress: AIRCRAFT_NODES[id].months, done: true }
}

const side = (units: Partial<UnitCounts>, n?: Nation): Combatant => ({
  units: { ...emptyUnits(), ...units },
  mods: n ? combatMods(n) : null,
  penalty: 1,
  penaltyNotes: [],
  sys: n ? { ...n.systems } : {},
  ...(n && aircraftEffects(n) ? { air: aircraftEffects(n)! } : {}),
})

/** Months at which a node finishes, working it alone with the nation paying month by month. */
function monthsToFinish(s0: GameState, id: AircraftNodeId, limit = 40): { state: GameState; months: number } {
  let s = s0
  for (let i = 1; i <= limit; i++) {
    s = resolveTurn(s, map, [])
    if (s.nations.r0.aircraft?.[id]?.done) return { state: s, months: i }
  }
  throw new Error('never finished')
}

describe('the aircraft tree is sound data', () => {
  it('has 16 developments in four branches of four, and each branch has a way in', () => {
    expect(AIRCRAFT_IDS).toHaveLength(16)
    expect(AIRCRAFT_BRANCH_IDS).toHaveLength(4)
    for (const b of AIRCRAFT_BRANCH_IDS) {
      const ids = AIRCRAFT_IDS.filter((id) => AIRCRAFT_NODES[id].branch === b)
      expect(ids).toHaveLength(4)
      expect(ids.some((id) => AIRCRAFT_NODES[id].requires.length === 0)).toBe(true)
    }
  })

  it('every prerequisite exists, the tree has no loops, and a node never opens before what it needs', () => {
    const depth = (id: AircraftNodeId, seen: AircraftNodeId[] = []): number => {
      expect(seen).not.toContain(id)
      const node = AIRCRAFT_NODES[id]
      return 1 + Math.max(0, ...node.requires.map((r) => (expect(AIRCRAFT_NODES[r], `${id} needs ${r}`).toBeDefined(), depth(r, [...seen, id]))))
    }
    for (const id of AIRCRAFT_IDS) {
      const node = AIRCRAFT_NODES[id]
      expect(depth(id)).toBeGreaterThanOrEqual(1)
      // A node is never in a lower tier than something it needs.
      for (const r of node.requires) expect(AIRCRAFT_NODES[r].tier).toBeLessThanOrEqual(node.tier)
    }
    // The deepest chain is long enough to be a real tree.
    expect(Math.max(...AIRCRAFT_IDS.map((id) => depth(id)))).toBeGreaterThanOrEqual(3)
  })

  it('names real technologies, real tiers, positive costs and at least one effect', () => {
    for (const id of AIRCRAFT_IDS) {
      const node = AIRCRAFT_NODES[id]
      expect(TECH_BY_ID[node.tech], `${id} tech`).toBeDefined()
      expect(node.tier).toBeGreaterThanOrEqual(1)
      expect(node.tier).toBeLessThanOrEqual(4)
      expect(node.money).toBeGreaterThan(0)
      expect(node.tp).toBeGreaterThan(0)
      expect(node.months).toBeGreaterThanOrEqual(3)
      expect(aircraftLines(node.effects).length).toBeGreaterThan(0)
      expect(node.name.length).toBeGreaterThan(3)
    }
  })

  it('later and stronger developments cost more and take longer than the ones they need', () => {
    for (const id of AIRCRAFT_IDS) for (const r of AIRCRAFT_NODES[id].requires) {
      expect(AIRCRAFT_NODES[id].money).toBeGreaterThan(AIRCRAFT_NODES[r].money)
      expect(AIRCRAFT_NODES[id].months).toBeGreaterThanOrEqual(AIRCRAFT_NODES[r].months)
    }
  })

  it('every effect a node asks for has plain words, and the lines say the real numbers', () => {
    expect(aircraftLines(AIRCRAFT_NODES.aam.effects)).toContain('Fighters attack +15%')
    expect(aircraftLines(AIRCRAFT_NODES.refuel.effects)).toContain('Airbase reach +2500 km')
    expect(aircraftLines({ hunt: 0 })).toEqual([])
  })

  it('gives slots by tier, one or two', () => {
    expect(AIRCRAFT_RULES.slots).toHaveLength(5)
    expect(Math.min(...AIRCRAFT_RULES.slots)).toBe(1)
    expect(Math.max(...AIRCRAFT_RULES.slots)).toBe(2)
    expect(devSlots({ tier: 1 })).toBe(1)
    expect(devSlots({ tier: 3 })).toBe(2)
  })
})

describe('what finished developments add up to', () => {
  it('nothing at all for a nation that never used them', () => {
    const s = startState(map)
    expect(s.nations.r0.aircraft).toBeUndefined()
    expect(aircraftEffects(s.nations.r0)).toBeUndefined()
    expect(finishedDevs(s.nations.r0)).toEqual([])
    expect(airReach(s.nations.r0)).toBe(REACH.airKm)
    expect(bomberBonus(undefined, { ...emptyUnits(), air: 5 })).toBe(1)
  })

  it('counts only finished work', () => {
    const s = startState(map)
    const n = s.nations.r0
    n.aircraft = { radar: { progress: 2, done: false }, aam: { progress: 4, done: true } }
    const fx = aircraftEffects(n)!
    expect(fx.fighterAttack).toBeCloseTo(0.15)
    expect(fx.fighterDefense).toBe(0)
    expect(fx.hunt).toBe(0)
    expect(fx.speed).toBeCloseTo(0.1)
  })

  it('adds the nodes up and holds the total to its cap', () => {
    const n = startState(map).nations.r0
    finish(n, 'radar', 'hunters', 'iads', 'loyal')
    // 0.08 + 0.25 + 0.25 + 0.08 is 0.66, above the cap.
    expect(AIRCRAFT_CAPS.hunt).toBe(0.6)
    expect(aircraftEffects(n)!.hunt).toBe(0.6)
    const all = startState(map).nations.r0
    finish(all, ...AIRCRAFT_IDS)
    const fx = aircraftEffects(all)!
    for (const [k, cap] of Object.entries(AIRCRAFT_CAPS)) expect(fx[k as keyof typeof fx]).toBeLessThanOrEqual(cap)
    expect(fx.airRange).toBe(6000)
    expect(fx.pierce).toBeCloseTo(0.35)
  })
})

describe('starting a development', () => {
  it('needs its technology, what it builds on, and a big enough empire, and says which', () => {
    const s = startState(map)
    const n = s.nations.r0
    n.resources.capital = 5000
    n.resources.tp = 500
    n.techs = []
    expect(validateOrder(s, map, start('radar'))).toMatch(/Needs Multirole Fighters/)
    n.techs.push('air_propeller', 'air_jets')
    expect(validateOrder(s, map, start('radar'))).toBeNull()
    expect(validateOrder(s, map, start('aam'))).toMatch(/Needs Radar network first/)
    finish(n, 'radar')
    // A single country is a Nation: the second tier of developments needs a Regional power.
    expect(validateOrder(s, map, start('aam'))).toMatch(/Regional power/)
    n.tier = 2
    expect(validateOrder(s, map, start('aam'))).toBeNull()
    expect(validateOrder(s, map, start('hunters'))).toBeNull()
    expect(validateOrder(s, map, { ...start('hunters'), node: 'nonsense' as AircraftNodeId })).toMatch(/Unknown/)
  })

  it('the tier gate follows the node: Great power for the third tier, Superpower for the fourth', () => {
    const s = rich(2)
    const n = s.nations.r0
    finish(n, 'wingmen', 'radar', 'swarm', 'hunters', 'aam')
    expect(validateOrder(s, map, start('loyal'))).toMatch(new RegExp(tierSpec(3).name))
    expect(validateOrder(s, map, start('iads'))).toMatch(new RegExp(tierSpec(3).name))
    n.tier = 3
    expect(validateOrder(s, map, start('loyal'))).toBeNull()
    finish(n, 'loyal')
    expect(validateOrder(s, map, start('autonomous'))).toMatch(new RegExp(tierSpec(4).name))
    n.tier = 4
    expect(validateOrder(s, map, start('autonomous'))).toBeNull()
  })

  it('costs the research on the day and begins at zero progress', () => {
    const s = rich(1)
    const before = s.nations.r0.resources.tp
    expect(orderCost(s, start('radar'))).toMatchObject({ tp: AIRCRAFT_NODES.radar.tp, capital: 0, pp: 0, steel: 0 })
    expect(applyOrderNow(s, map, start('radar')).error).toBeNull()
    expect(s.nations.r0.resources.tp).toBe(before - AIRCRAFT_NODES.radar.tp)
    expect(s.nations.r0.aircraft!.radar).toEqual({ progress: 0, done: false })
    expect(s.log.some((l) => l.text.includes('radar network'))).toBe(true)
  })

  it('applies at once, not at the month end, and reads well in the orders list', () => {
    expect(MONTH_END_ORDERS.has('startAircraftDev')).toBe(false)
    expect(MONTH_END_ORDERS.has('pauseAircraftDev')).toBe(false)
    const s = rich(1)
    expect(describeOrder(s, map, start('radar'))).toBe('Develop radar network')
    expect(describeOrder(s, map, pause('radar', true))).toBe('Pause developing radar network')
    expect(describeOrder(s, map, pause('radar', false))).toBe('Resume developing radar network')
  })

  it('cannot be paid for without the research or the first month of money', () => {
    const s = rich(1)
    s.nations.r0.resources.tp = AIRCRAFT_NODES.radar.tp - 1
    expect(validateOrder(s, map, start('radar'))).toMatch(/Not enough research/)
    s.nations.r0.resources.tp = 100
    s.nations.r0.resources.capital = firstMonth('radar') - 1
    expect(validateOrder(s, map, start('radar'))).toMatch(/for the first month/)
    s.nations.r0.resources.capital = firstMonth('radar')
    expect(validateOrder(s, map, start('radar'))).toBeNull()
  })

  it('has slots by tier: one at first, two as a Great power, counting orders waiting in the same batch', () => {
    const s = rich(1)
    expect(applyOrderNow(s, map, start('radar')).error).toBeNull()
    expect(validateOrder(s, map, start('coatings'))).toMatch(/1 aircraft project at once/)
    s.nations.r0.tier = 3
    expect(validateOrder(s, map, start('coatings'))).toBeNull()
    expect(applyOrderNow(s, map, start('coatings')).error).toBeNull()
    expect(validateOrder(s, map, start('dropTanks'))).toMatch(/2 aircraft projects at once/)
    // Orders in a batch count before any is executed.
    const t = rich(3)
    expect(validateOrder(t, map, start('coatings'), [start('radar')])).toBeNull()
    expect(validateOrder(t, map, start('dropTanks'), [start('radar'), start('coatings')])).toMatch(/at once/)
    expect(validateOrder(t, map, start('radar'), [start('radar')])).toMatch(/Already ordered/)
  })

  it('cannot start what is under way, on hold, or done', () => {
    const s = rich(3)
    expect(applyOrderNow(s, map, start('radar')).error).toBeNull()
    expect(validateOrder(s, map, start('radar'))).toMatch(/Already under way/)
    expect(applyOrderNow(s, map, pause('radar', true)).error).toBeNull()
    expect(validateOrder(s, map, start('radar'))).toMatch(/on hold/)
    finish(s.nations.r0, 'coatings')
    expect(validateOrder(s, map, start('coatings'))).toMatch(/Already developed/)
  })
})

describe('pausing and resuming', () => {
  it('frees the slot and the bill, keeps the progress, and takes a slot again on resume', () => {
    const s = rich(1)
    expect(applyOrderNow(s, map, start('radar')).error).toBeNull()
    let next = resolveTurn(s, map, [])
    const progress = next.nations.r0.aircraft!.radar!.progress
    expect(progress).toBeGreaterThan(0)
    expect(aircraftBill(next.nations.r0, 1)).toBeGreaterThan(0)
    expect(applyOrderNow(next, map, pause('radar', true)).error).toBeNull()
    expect(activeDevs(next.nations.r0)).toEqual([])
    expect(aircraftBill(next.nations.r0, 1)).toBe(0)
    // The slot is free for something else.
    expect(validateOrder(next, map, start('coatings'))).toBeNull()
    const idle = resolveTurn(next, map, [])
    expect(idle.nations.r0.aircraft!.radar!.progress).toBe(progress)
    expect(idle.nations.r0.aircraft!.radar!.paused).toBe(true)
    // Resume only with a free slot.
    expect(applyOrderNow(idle, map, start('coatings')).error).toBeNull()
    expect(validateOrder(idle, map, pause('radar', false))).toMatch(/at once/)
    idle.nations.r0.tier = 3
    expect(validateOrder(idle, map, pause('radar', false))).toBeNull()
    next = idle
    expect(applyOrderNow(next, map, pause('radar', false)).error).toBeNull()
    expect(next.nations.r0.aircraft!.radar!.paused).toBeUndefined()
    expect(activeDevs(next.nations.r0)).toContain('radar')
  })

  it('refuses a pause that is already in force, or for work that is not under way', () => {
    const s = rich(3)
    expect(validateOrder(s, map, pause('radar', true))).toMatch(/not under way/)
    applyOrderNow(s, map, start('radar'))
    expect(validateOrder(s, map, pause('radar', false))).toMatch(/Not on hold/)
    applyOrderNow(s, map, pause('radar', true))
    expect(validateOrder(s, map, pause('radar', true))).toMatch(/Already on hold/)
    finish(s.nations.r0, 'coatings')
    expect(validateOrder(s, map, pause('coatings', true))).toMatch(/not under way/)
  })
})

describe('the monthly work', () => {
  it('takes about the months it says, the money in all is paid, and the effect arrives only at the end', () => {
    const base = rich(1)
    const withDev = structuredClone(base)
    expect(applyOrderNow(withDev, map, start('dropTanks')).error).toBeNull()
    const node = AIRCRAFT_NODES.dropTanks
    const pace = aircraftPace(withDev.nations.r0, 1)
    expect(pace).toBeCloseTo(1)
    // Mid-way nothing has changed for battles.
    const mid = resolveTurn(withDev, map, [])
    expect(mid.nations.r0.aircraft!.dropTanks!.done).toBe(false)
    expect(aircraftEffects(mid.nations.r0)).toBeUndefined()
    const { state, months } = monthsToFinish(withDev, 'dropTanks')
    expect(months).toBeGreaterThanOrEqual(node.months)
    expect(months).toBeLessThanOrEqual(node.months + 2)
    expect(aircraftEffects(state.nations.r0)!.landing).toBeCloseTo(0.15)
    // The same game without the work, as long: the treasury differs by exactly what the development cost (the research was paid up front).
    let plain = base
    for (let i = 0; i < months; i++) plain = resolveTurn(plain, map, [])
    expect(plain.nations.r0.resources.capital - state.nations.r0.resources.capital).toBeCloseTo(node.money, 4)
    // And nothing more is owed afterwards.
    expect(aircraftBill(state.nations.r0, 1)).toBe(0)
    expect(state.log.some((l) => l.text.includes('finished developing drop tanks'))).toBe(true)
  })

  it('shows the work as its own line in the money report, and nothing for a nation without any', () => {
    const s = rich(1)
    const quiet = computeEconomy(s, map, 'r0')
    expect(quiet.aircraftBill).toBe(0)
    expect(quiet.lines.some((l) => l.label === 'Aircraft development')).toBe(false)
    applyOrderNow(s, map, start('dropTanks'))
    const e = computeEconomy(s, map, 'r0')
    expect(e.aircraftBill).toBeGreaterThan(0)
    const line = e.lines.find((l) => l.label === 'Aircraft development')!
    expect(line.amount).toBeCloseTo(-e.aircraftBill)
    expect(line.kind).toBe('cost')
    expect(e.netCapital).toBeCloseTo(quiet.netCapital - e.aircraftBill)
  })

  it('goes faster with engineers and the speed developments, and a month never overshoots what is left', () => {
    const n = startState(map).nations.r0
    expect(aircraftPace(n, 1)).toBe(1)
    finish(n, 'aam')
    expect(aircraftPace(n, 1)).toBeCloseTo(1.1)
    expect(aircraftPace(n, 0.5)).toBeCloseTo(0.55)
    // The last month costs only what is left.
    const last = monthSpend('radar', AIRCRAFT_NODES.radar.months - 0.5, 1)
    expect(last.gain).toBeCloseTo(0.5)
    expect(last.money).toBeCloseTo(AIRCRAFT_NODES.radar.money * 0.5 / AIRCRAFT_NODES.radar.months)
    // Whatever the pace, the money in all is the same.
    let spent = 0
    let progress = 0
    while (progress < AIRCRAFT_NODES.hunters.months - 1e-9) {
      const m = monthSpend('hunters', progress, 0.7)
      spent += m.money
      progress += m.gain
    }
    expect(spent).toBeCloseTo(AIRCRAFT_NODES.hunters.money)
  })

  it('stalls, and costs nothing, while the treasury is in the red', () => {
    const base = rich(1)
    const stalled = structuredClone(base)
    applyOrderNow(stalled, map, start('dropTanks'))
    for (const s of [base, stalled]) s.nations.r0.resources.capital = -2000
    const a = resolveTurn(base, map, [])
    const b = resolveTurn(stalled, map, [])
    expect(b.nations.r0.aircraft!.dropTanks!.progress).toBe(0)
    // The month's bill was charged in the economy and given back: the same treasury as the nation with no development.
    expect(b.nations.r0.resources.capital).toBeCloseTo(a.nations.r0.resources.capital, 6)
  })

  it('leaves a nation that never uses it without the field, and the others unaffected by one that does', () => {
    const a = rich(1)
    applyOrderNow(a, map, start('dropTanks'))
    let s = a
    for (let i = 0; i < 4; i++) s = resolveTurn(s, map, [])
    expect(Object.entries(s.nations).filter(([, n]) => 'aircraft' in n).map(([id]) => id)).toEqual(['r0'])
    // Another nation's month is the same whether or not r0 is developing aircraft.
    const plain = rich(1)
    let p = plain
    for (let i = 0; i < 4; i++) p = resolveTurn(p, map, [])
    expect(JSON.stringify(s.nations.r1)).toBe(JSON.stringify(p.nations.r1))
  })
})

describe('turn and live games develop the same', () => {
  it('six months in turns and in live mode leave the same treasury, progress and finished work', () => {
    const base = rich(3)
    const prepare = (s: GameState) => {
      expect(applyOrderNow(s, map, start('radar')).error).toBeNull()
      expect(applyOrderNow(s, map, start('coatings')).error).toBeNull()
      return s
    }
    let turn = prepare(structuredClone(base))
    for (let i = 0; i < 6; i++) turn = resolveTurn(turn, map, [])
    let live = prepare(startLive(structuredClone(base)))
    const target = live.turn + 6
    while (live.turn < target) live = advanceDay(live, map, { monthOrders: (live.day ?? 0) >= daysInMonth(live.turn) - 1 ? [] : undefined, planner: () => [] }).state
    expect(live.turn).toBe(turn.turn)
    expect(live.nations.r0.aircraft).toEqual(turn.nations.r0.aircraft)
    expect(live.nations.r0.resources.capital).toBeCloseTo(turn.nations.r0.resources.capital, 6)
    expect(turn.nations.r0.aircraft!.radar!.done).toBe(true)
  })
})

describe('the stat sheet and battles read the same numbers', () => {
  it('fighters, bombers and drones gain attack and defense from finished developments only', () => {
    const s = rich(3)
    const n = s.nations.r0
    setMilitary(s, 'r0', { infantry: 4, fighter: 3, air: 2, drone: 2 })
    const before = militarySheet(s, 'r0')
    finish(n, 'radar', 'aam', 'coatings', 'wingmen')
    const after = militarySheet(s, 'r0')
    const f = (sheet: typeof before, u: 'fighter' | 'air' | 'drone') => sheet.units.find((l) => l.unit === u)!
    // Bonuses add to the technology's, so each development moves the number by its share of the unit's base.
    const moved = (u: 'fighter' | 'air' | 'drone', key: 'attack' | 'defense') => (f(after, u)[key] - f(before, u)[key]) / (key === 'attack' ? f(before, u).baseAttack : f(before, u).baseDefense)
    expect(moved('fighter', 'attack')).toBeCloseTo(0.15)
    expect(moved('fighter', 'defense')).toBeCloseTo(0.1)
    expect(moved('air', 'defense')).toBeCloseTo(0.1)
    expect(moved('air', 'attack')).toBeCloseTo(0)
    expect(moved('drone', 'attack')).toBeCloseTo(0.12)
    expect(moved('drone', 'defense')).toBeCloseTo(0.1)
    // Other units are untouched, and so is the nation's strength by exactly the air arm.
    expect(f(after, 'fighter').count).toBe(3)
    expect(after.units.find((l) => l.unit === 'infantry')!.attack).toBe(before.units.find((l) => l.unit === 'infantry')!.attack)
    expect(after.totalPower).toBeGreaterThan(before.totalPower)
  })

  it('shows each development as a source of the bonus, adding up to the number', () => {
    const s = rich(3)
    const n = s.nations.r0
    setMilitary(s, 'r0', { fighter: 3 })
    finish(n, 'radar', 'aam', 'hunters')
    const line = militarySheet(s, 'r0').units.find((l) => l.unit === 'fighter')!
    const dev = line.sources.filter((x) => x.kind === 'aircraft')
    expect(dev.map((x) => x.label)).toEqual(['Development: Radar network', 'Development: Long-range air-to-air missiles', 'Development: Missile-hunter fighters'])
    expect(dev.reduce((sum, x) => sum + x.attack, 0)).toBeCloseTo(0.15)
    expect(dev.reduce((sum, x) => sum + x.defense, 0)).toBeCloseTo(0.15)
  })

  it('attack and defense on the sheet equal what a battle uses (the combat modifiers), drill included', () => {
    const s = rich(3)
    const n = s.nations.r0
    finish(n, 'radar', 'aam', 'stealthBombers', 'coatings', 'wingmen', 'swarm')
    n.military.drill.fighter = 2
    setMilitary(s, 'r0', { fighter: 3, air: 2, drone: 2 })
    const sheet = militarySheet(s, 'r0')
    const mods = combatMods(n)
    for (const u of ['fighter', 'air', 'drone'] as const) {
      const line = sheet.units.find((l) => l.unit === u)!
      const drill = 1 + (n.military.drill[u] ?? 0) * TRAINING.bonusPerLevel
      expect(line.attack).toBeCloseTo(UNIT_SPECS[u].attack * (1 + mods.unitAttack[u]) * drill, 10)
      expect(line.defense).toBeCloseTo(UNIT_SPECS[u].defense * (1 + mods.unitDefense[u]) * drill, 10)
    }
    // Better fighters rule the air more, in the same arithmetic battles use.
    const mine = side({ fighter: 3, air: 2 }, n)
    mine.drill = { ...n.military.drill }
    const theirs = side({ fighter: 3 })
    expect(airSuperiority(mine, theirs)).toBeGreaterThan(0.5)
    const plain = startState(map).nations.r0
    expect(airSuperiority(side({ fighter: 3 }, plain), theirs)).toBeCloseTo(0.5)
  })

  it('military power, which the AI and diplomacy read, rises with the developments', () => {
    const s = rich(3)
    setMilitary(s, 'r0', { fighter: 6, air: 4 })
    const before = militarySheet(s, 'r0').totalPower
    finish(s.nations.r0, 'radar', 'aam', 'payload', 'dropTanks')
    expect(militarySheet(s, 'r0').totalPower).toBeGreaterThan(before)
  })
})

describe('missile hunters: a real counter to missiles', () => {
  const defenderFx = () => {
    const n = startState(map).nations.r1
    finish(n, 'radar', 'hunters', 'iads')
    return aircraftEffects(n)!
  }

  it('shoot down part of a salvo, more with a bigger wing at home, up to a full wing of three', () => {
    const fx = defenderFx()
    expect(fx.hunt).toBeCloseTo(0.58, 10)
    const plain = getsThrough(0, 'cruise')
    expect(plain).toBe(1)
    const one = getsThrough(0, 'cruise', { defender: fx, fighters: 1 })
    const two = getsThrough(0, 'cruise', { defender: fx, fighters: 2 })
    const wing = getsThrough(0, 'cruise', { defender: fx, fighters: AIRCRAFT_RULES.huntWing })
    const huge = getsThrough(0, 'cruise', { defender: fx, fighters: 30 })
    expect(one).toBeLessThan(plain)
    expect(two).toBeLessThan(one)
    expect(wing).toBeLessThan(two)
    expect(huge).toBeCloseTo(wing, 10)
    expect(huntCover(fx, 1.5)).toBeCloseTo(0.58 / 2)
    // No fighters at home, no cover, however many developments.
    expect(getsThrough(0, 'cruise', { defender: fx, fighters: 0 })).toBe(plain)
    // Developments without hunters add nothing here.
    const quiet = startState(map).nations.r1
    finish(quiet, 'coatings')
    expect(getsThrough(0, 'cruise', { defender: aircraftEffects(quiet), fighters: 9 })).toBe(plain)
  })

  it('stack with the shield: what each stops compounds, never adds past the whole salvo', () => {
    const fx = defenderFx()
    const shielded = getsThrough(3, 'cruise')
    expect(shielded).toBeCloseTo(0.25)
    const both = getsThrough(3, 'cruise', { defender: fx, fighters: 3 })
    expect(both).toBeCloseTo(0.25 * (1 - 0.58 * AIRCRAFT_RULES.huntVs.cruise), 10)
    expect(both).toBeGreaterThanOrEqual(0.05)
    // A shield alone is exactly what it was before this feature existed.
    expect(getsThrough(2, 'tactical')).toBeCloseTo(1 - (1 - 0.65) * 1, 10)
  })

  it('catch slow low flyers best and heavy ballistic warheads least', () => {
    const fx = defenderFx()
    const through = (k: 'cruise' | 'tactical' | 'hypersonic' | 'ballistic') => getsThrough(0, k, { defender: fx, fighters: 3 })
    expect(through('cruise')).toBeLessThan(through('tactical'))
    expect(through('tactical')).toBeLessThan(through('hypersonic'))
    expect(through('hypersonic')).toBeLessThan(through('ballistic'))
    expect(through('ballistic')).toBeLessThan(1)
  })

  it('are blinded by electronic warfare and fooled by stealth', () => {
    const fx = defenderFx()
    const attacker = startState(map).nations.r0
    const hunted = (a?: ReturnType<typeof aircraftEffects>) => getsThrough(0, 'cruise', { attacker: a, defender: fx, fighters: 3 })
    const base = hunted()
    finish(attacker, 'coatings', 'ew')
    const jammed = hunted(aircraftEffects(attacker))
    expect(jammed).toBeGreaterThan(base)
    finish(attacker, 'stealthBombers')
    const stealthy = hunted(aircraftEffects(attacker))
    expect(stealthy).toBeGreaterThan(jammed)
    finish(attacker, 'blackout')
    expect(hunted(aircraftEffects(attacker))).toBeGreaterThan(stealthy)
    // Stealth also helps against a plain shield, with no hunters at all.
    expect(getsThrough(3, 'cruise', { attacker: aircraftEffects(attacker), fighters: 0 })).toBeGreaterThan(getsThrough(3, 'cruise'))
  })

  it('compose as described: the shield, then the hunters, both cut by the attacker', () => {
    const attacker = startState(map).nations.r0
    finish(attacker, 'coatings', 'stealthBombers', 'ew')
    const a = aircraftEffects(attacker)!
    const d = defenderFx()
    // shield 0.5 stops, hunters 0.58*1.0 scaled by (1 - jam 0.2), both cut by (1 - pierce 0.15)
    const expected = (1 - 0.5 * (1 - 0.15)) * (1 - Math.min(0.95, 0.58 * (1 - 0.2)) * (1 - 0.15))
    expect(pastDefenses(0.5, a, d, 3)).toBeCloseTo(expected, 10)
    expect(pastDefenses(0.5, undefined, undefined, 3)).toBeCloseTo(0.5, 10)
  })

  const strikeWorld = (hunters: boolean, fighters: number) => {
    const s = startState(map)
    s.wars.push('r0|r3')
    s.regions.r0.buildings.factory = 1
    s.regions.r3.line = 10
    setMilitary(s, 'r0', { infantry: 10 })
    s.nations.r0.arsenal = { cruise: 6 }
    setMilitary(s, 'r3', { infantry: 4, fighter: fighters })
    if (hunters) finish(s.nations.r3, 'radar', 'hunters', 'iads')
    return s
  }
  const salvo = { type: 'strike', nationId: 'r0', target: 'r3', weapon: 'missile', kind: 'cruise', count: 6 } as const

  it('really cut the damage of a missile strike on the defender, and tell the player why', () => {
    const open = strikeWorld(false, 4)
    const guarded = strikeWorld(true, 4)
    const empty = strikeWorld(true, 0)
    for (const s of [open, guarded, empty]) runStrike(s, map, salvo)
    expect(open.regions.r3.line).toBeLessThan(guarded.regions.r3.line)
    // With no fighters at home the hunters have nothing to fly.
    expect(empty.regions.r3.line).toBe(open.regions.r3.line)
    expect(guarded.log.some((l) => /shield and fighters stopped/.test(l.text))).toBe(true)
    expect(open.log.some((l) => /shield (and fighters )?stopped/.test(l.text))).toBe(false)
  })

  // An attack carries only the missiles it names, so this one names all six.
  it('also blunt hypersonic batteries that join an attack, and the forecast agrees with the fight', () => {
    const make = (hunters: boolean) => {
      const s = startState(map)
      s.wars.push('r0|r1')
      setMilitary(s, 'r0', { infantry: 20, missile: 6 })
      setMilitary(s, 'r1', { infantry: 3, fighter: 4 })
      s.regions.r1.line = 12
      if (hunters) finish(s.nations.r1, 'radar', 'hunters', 'iads')
      return s
    }
    const open = make(false)
    const guarded = make(true)
    const a = resolveAttack(open, map, 'r0', 'r1', createRng(1, 1), 'main', 'assault', 6)!.report
    const b = resolveAttack(guarded, map, 'r0', 'r1', createRng(1, 1), 'main', 'assault', 6)!.report
    const cut = (r: typeof a) => Number(/cut the Defense Line by ([\d.]+)/.exec(r.modifiers.find((m) => m.startsWith('Hypersonic batteries'))!)![1])
    expect(cut(b)).toBeLessThan(cut(a))
    // The forecast reads the same defenses: more line damage against the open country.
    const fo = forecastAttack(make(false), map, 'r0', 'r1', 'main', 'assault', 8, 6)!
    const fg = forecastAttack(make(true), map, 'r0', 'r1', 'main', 'assault', 8, 6)!
    expect(fg.lineDamage).toBeLessThan(fo.lineDamage)
  })
})

describe('what developments do in a fight', () => {
  const run = (att: Combatant, def: Combatant, runs = 30) => {
    let toDef = 0
    let toAtt = 0
    for (let i = 0; i < runs; i++) {
      const out = resolveBattle({ attacker: att, defender: def, terrain: 'plains', coastal: false }, createRng(21, i))
      toDef += totalUnits(out.defenderLosses)
      toAtt += totalUnits(out.attackerLosses)
    }
    return { toDef: toDef / runs, toAtt: toAtt / runs }
  }
  const dev = (...ids: AircraftNodeId[]) => {
    const n = startState(map).nations.r0
    finish(n, ...ids)
    return n
  }

  it('without developments a battle is exactly as before (the plain path is untouched)', () => {
    const a = side({ infantry: 5, air: 3, drone: 2 })
    const b = side({ infantry: 5, fighter: 3 })
    const out = resolveBattle({ attacker: a, defender: b, terrain: 'plains', coastal: false }, createRng(3, 3))
    const same = resolveBattle({ attacker: { ...a }, defender: { ...b }, terrain: 'plains', coastal: false }, createRng(3, 3))
    expect(same).toEqual(out)
  })

  it('stealthy bombers keep more of their strength when the enemy rules the air', () => {
    const stealth = dev('coatings', 'stealthBombers', 'ew', 'blackout')
    const bombers = { infantry: 2, air: 8 }
    const enemy = { infantry: 6, fighter: 8 }
    const plain = run(side(bombers), side(enemy))
    const sneaky = run({ ...side(bombers, stealth), mods: null }, side(enemy))
    expect(sneaky.toDef).toBeGreaterThan(plain.toDef)
  })

  it('electronic warfare blinds the enemy fighters, so the air war tilts', () => {
    const ew = dev('coatings', 'ew', 'stealthBombers', 'blackout')
    const mine = side({ fighter: 4 }, ew)
    const theirs = side({ fighter: 4 })
    expect(airSuperiority(side({ fighter: 4 }), theirs)).toBeCloseTo(0.5)
    expect(airSuperiority({ ...mine, mods: null }, theirs)).toBeGreaterThan(0.55)
    // And the enemy's own electronic war works against me, the same way.
    expect(airSuperiority(theirs, { ...mine, mods: null })).toBeLessThan(0.45)
  })

  it('stealth makes a shield stop less of drones and missiles', () => {
    const stealth = dev('coatings', 'stealthBombers', 'ew', 'blackout')
    const shield = { ...side({ infantry: 8 }), sys: { shield: 3 } as Combatant['sys'] }
    const force = { infantry: 6, drone: 5, missile: 4 }
    const plain = run(side(force), shield)
    const sneaky = run({ ...side(force, stealth), mods: null }, shield)
    expect(sneaky.toDef).toBeGreaterThan(plain.toDef)
  })

  it('hunter fighters shoot down enemy drones and missiles in a fight', () => {
    const hunters = dev('radar', 'hunters', 'iads')
    const force = { infantry: 6, drone: 5, missile: 4 }
    const open = run(side(force), side({ infantry: 8, fighter: 3 }))
    const guarded = run(side(force), { ...side({ infantry: 8, fighter: 3 }, hunters), mods: null })
    expect(guarded.toDef).toBeLessThan(open.toDef)
    // The opening strike round does less damage to the defenders.
    const round = (def: Combatant) => resolveBattle({ attacker: side(force), defender: def, terrain: 'plains', coastal: false }, createRng(4, 4)).rounds[0]
    expect(round({ ...side({ infantry: 8, fighter: 3 }, hunters), mods: null }).attackerDamage).toBeLessThan(round(side({ infantry: 8, fighter: 3 })).attackerDamage)
    // And with no fighters in the fight there is nothing to hunt with.
    const none = run(side(force), { ...side({ infantry: 8 }, hunters), mods: null })
    expect(none.toDef).toBeCloseTo(run(side(force), side({ infantry: 8 })).toDef, 8)
  })

  it('swarm autonomy keeps drones alive against enemy fighters', () => {
    const swarm = dev('wingmen', 'swarm')
    const force = { infantry: 3, drone: 8 }
    const enemy = { infantry: 3, fighter: 8 }
    const plain = run(side(force), side(enemy))
    const nimble = run({ ...side(force, swarm), mods: null }, side(enemy))
    expect(nimble.toDef).toBeGreaterThan(plain.toDef)
  })
})

describe('reach, landings and payload', () => {
  /** Two countries across an ocean, `km` apart, r0 with a factory for an airbase and fighters to fly. */
  function ocean(km: number) {
    const m = lineMap(2)
    m.regions.r0.neighbors = []
    m.regions.r1.neighbors = []
    m.regions.r0.coastal = true
    m.regions.r1.coastal = true
    m.regions.r1.lng = km / 111.19
    const s = startState(m)
    s.wars.push('r0|r1')
    s.regions.r0.buildings.factory = 1
    s.regions.r0.buildings.port = 0
    setMilitary(s, 'r0', { infantry: 20, fighter: 2, air: 2 })
    setMilitary(s, 'r1', { infantry: 2 })
    s.nations.r0.resources.capital = 5000
    return { m, s }
  }

  it('aerial refuelling carries airbase reach beyond 7000 km, for the check and the march alike', () => {
    const { m, s } = ocean(8500)
    expect(canAttackRegion(s, m, 'r0', 'r1').ok).toBe(false)
    expect(planTrip(s, m, 'r0', 'r1')).toBeNull()
    expect(validateOrder(s, m, { type: 'attack', nationId: 'r0', target: 'r1' })).toMatch(/Out of reach/)
    finish(s.nations.r0, 'dropTanks', 'refuel')
    expect(airReach(s.nations.r0)).toBe(REACH.airKm + 2500)
    expect(canAttackRegion(s, m, 'r0', 'r1')).toMatchObject({ ok: true, via: 'air', bySea: true })
    expect(planTrip(s, m, 'r0', 'r1')).toMatchObject({ via: 'air', from: 'r0' })
    expect(validateOrder(s, m, { type: 'attack', nationId: 'r0', target: 'r1' })).toBeNull()
    // Still not unlimited.
    const far = ocean(10500)
    finish(far.s.nations.r0, 'dropTanks', 'refuel')
    expect(canAttackRegion(far.s, far.m, 'r0', 'r1').ok).toBe(false)
    finish(far.s.nations.r0, 'payload', 'strategic')
    expect(airReach(far.s.nations.r0)).toBe(REACH.airKm + 6000)
    expect(canAttackRegion(far.s, far.m, 'r0', 'r1').ok).toBe(true)
  })

  it('drop tanks and ground crews cut the landing penalty of an attack by air, and only by air', () => {
    const penalty = (s: GameState, m: ReturnType<typeof lineMap>) => {
      const r = resolveAttack(s, m, 'r0', 'r1', createRng(2, 2))!.report
      const note = r.modifiers.find((x) => x.startsWith('Attacker: amphibious assault'))!
      return Number(/-(\d+)%/.exec(note)![1])
    }
    const a = ocean(5000)
    const b = ocean(5000)
    finish(b.s.nations.r0, 'dropTanks')
    const plain = penalty(a.s, a.m)
    expect(plain).toBe(40)
    expect(penalty(b.s, b.m)).toBe(34)
    // By sea the same development does nothing: a fleet lands as it always did.
    const sea = ocean(5000)
    sea.s.regions.r0.buildings.port = 1
    setMilitary(sea.s, 'r0', { infantry: 20, naval: 6 })
    finish(sea.s.nations.r0, 'dropTanks')
    expect(canAttackRegion(sea.s, sea.m, 'r0', 'r1').via).toBe('fleet')
    expect(penalty(sea.s, sea.m)).toBe(40)
  })

  it('heavy payload bays make a bomber-heavy attack push the Defense Line back harder', () => {
    const fx = (id: AircraftNodeId) => {
      const n = startState(map).nations.r0
      finish(n, id)
      return aircraftEffects(n)!
    }
    const bombers = { ...emptyUnits(), air: 5, infantry: 15 }
    expect(bomberBonus(fx('payload'), bombers)).toBeCloseTo(1.25)
    // A smaller share of bombers earns a smaller bonus; none earns nothing.
    expect(bomberBonus(fx('payload'), { ...emptyUnits(), air: 2, infantry: 18 })).toBeCloseTo(1 + 0.25 * (0.1 / 0.25))
    expect(bomberBonus(fx('payload'), { ...emptyUnits(), infantry: 20 })).toBe(1)
    expect(bomberBonus(fx('dropTanks'), bombers)).toBe(1)
    // In a real fight the line falls further.
    const make = (payload: boolean) => {
      const s = startState(map)
      s.wars.push('r0|r1')
      setMilitary(s, 'r0', { infantry: 7, air: 5, fighter: 2 })
      setMilitary(s, 'r1', { infantry: 6 })
      s.regions.r1.line = 12
      if (payload) finish(s.nations.r0, 'payload')
      return s
    }
    // Payload bays also add bomber attack; take that away for this check so only the push on the line differs.
    const bays = AIRCRAFT_NODES.payload.effects
    AIRCRAFT_NODES.payload.effects = { bomberLine: bays.bomberLine }
    try {
      const plain = resolveAttack(make(false), map, 'r0', 'r1', createRng(1, 1))!.report
      const heavy = resolveAttack(make(true), map, 'r0', 'r1', createRng(1, 1))!.report
      expect(plain.winner).toBe('attacker')
      expect(plain.lineAfter ?? 0).toBeGreaterThan(0)
      expect(heavy.lineAfter ?? 0).toBeLessThan(plain.lineAfter ?? 0)
      // The battle itself was the same fight.
      expect(heavy.rounds).toEqual(plain.rounds)
    } finally {
      AIRCRAFT_NODES.payload.effects = bays
    }
  })
})

describe('the missile program is not touched', () => {
  it('still has the same three levels', () => {
    expect(MISSILE_PROGRAM.maxLevel).toBe(3)
  })
})

describe('the AI', () => {
  const warring = (hard = true) => {
    const s = createInitialState(getWorld().map, { playerRegionId: 'france', seed: 5, difficulty: hard ? 'hard' : 'normal', goal: 'classic', victoryShare: 2 })
    return s
  }

  it('picks nothing in peace, nothing without planes, and nothing it cannot pay for', () => {
    const s = rich(3)
    const n = s.nations.r0
    setMilitary(s, 'r0', { infantry: 5, fighter: 3 })
    expect(wantedAircraft(s, n, [])).toBeNull()
    s.wars.push('r0|r1')
    expect(wantedAircraft(s, n, ['r1'])).toBe('radar')
    setMilitary(s, 'r0', { infantry: 5 })
    expect(wantedAircraft(s, n, ['r1'])).toBeNull()
    setMilitary(s, 'r0', { infantry: 5, fighter: 3 })
    n.resources.capital = 50
    expect(wantedAircraft(s, n, ['r1'])).toBeNull()
  })

  it('goes for interceptors when the enemy holds missiles, and for a war path otherwise', () => {
    const s = rich(3)
    const n = s.nations.r0
    setMilitary(s, 'r0', { infantry: 5, fighter: 3 })
    s.wars.push('r0|r1')
    finish(n, 'radar')
    // Without missiles the war path wants better fighters first, then stealth.
    expect(wantedAircraft(s, n, ['r1'])).toBe('aam')
    // With missiles on the other side, the missile hunters come first.
    s.nations.r1.arsenal = { cruise: 4 }
    expect(wantedAircraft(s, n, ['r1'])).toBe('hunters')
    finish(n, 'hunters')
    expect(wantedAircraft(s, n, ['r1'])).toBe('aam')
    // A recent strike counts as a threat even with the enemy's stock spent.
    s.nations.r1.arsenal = {}
    n.struckBy = { r1: s.turn }
    finish(n, 'aam')
    expect(wantedAircraft(s, n, ['r1'])).toBe('iads')
  })

  it('never picks something the rules would refuse, and fills its slots, then waits', () => {
    const s = rich(1)
    const n = s.nations.r0
    setMilitary(s, 'r0', { infantry: 5, fighter: 3 })
    s.wars.push('r0|r1')
    const first = wantedAircraft(s, n, ['r1'])!
    expect(startAircraftDevProblem(s, n, start(first), [])).toBeNull()
    expect(applyOrderNow(s, map, start(first)).error).toBeNull()
    // One slot: nothing more until it finishes.
    expect(wantedAircraft(s, n, ['r1'])).toBeNull()
  })

  it('a Hard bot at war starts a development, a Medium bot does not, and a Hard bot at peace does not', () => {
    const find = (hard: boolean, war: boolean) => {
      const s = warring(hard)
      const bot = Object.values(s.nations).find((x) => x.alive && !x.isPlayer && x.id === 'germany')!
      bot.techs.push(...ALL_TECH)
      bot.resources.capital = 3000
      bot.resources.tp = 500
      bot.military.units.fighter = 4
      // Its missile program is already raised, so that is not what it spends its attention on.
      bot.missileProgram = 2
      if (war) s.wars.push(pairKey('germany', 'france'))
      let seen = 0
      for (let t = 0; t < 40; t++) {
        s.turn = 1 + t
        seen += generateBotOrders(s, getWorld().map, bot.id).filter((o) => o.type === 'startAircraftDev').length
      }
      return seen
    }
    expect(find(true, true)).toBeGreaterThan(0)
    expect(find(false, true)).toBe(0)
    expect(find(true, false)).toBe(0)
  })
})

describe('views for the screen', () => {
  it('say what state each node is in and why one cannot start', () => {
    const s = rich(2)
    const n = s.nations.r0
    expect(devView(s, n, 'radar').status).toBe('ready')
    expect(devView(s, n, 'aam').status).toBe('locked')
    expect(devView(s, n, 'aam').problem).toMatch(/Radar network first/)
    applyOrderNow(s, map, start('radar'))
    expect(devView(s, n, 'radar')).toMatchObject({ status: 'active', progress: 0 })
    expect(devView(s, n, 'radar').monthsLeft).toBe(AIRCRAFT_NODES.radar.months)
    applyOrderNow(s, map, pause('radar', true))
    expect(devView(s, n, 'radar').status).toBe('paused')
    finish(n, 'coatings')
    expect(devView(s, n, 'coatings').status).toBe('done')
  })
})
