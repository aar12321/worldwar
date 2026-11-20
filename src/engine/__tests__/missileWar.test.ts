import { describe, expect, it, vi } from 'vitest'
import { DEALINGS } from '../../data/relations'
import { DOCTRINES, MW, rungOf } from '../../data/missileWar'
import { MISSILES, MISSILE_TYPES } from '../../data/missiles'
import { SHIELD_STOPS } from '../../data/systems'
import { clockOf } from '../calendar'
import { worldTension } from '../crises'
import { aircraftEffects, pastDefenses } from '../aircraft'
import { AIRCRAFT_RULES } from '../../data/aircraft'
import { advanceDay, startLive } from '../live'
import { getsThrough, launchSite, missileStock, strikeHitsKind, validateMissileStrike } from '../missiles'
import { answerShot, runFalseAlarms } from '../missileDoctrine'
import { raidForecast, strikeForecast } from '../missileForecast'
import { interceptorCap, interceptorsOf, ledgerOf, radarLevel, raidPlan, runMissileWar, salvoDefense, tensionOf, truceAnswer, trucePair, urbanShare } from '../missileWar'
import { orderCost, validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState, MissileType, Order } from '../types'
import { checkInvariants } from './invariants'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'
import { withOldMissiles } from './oldMissiles'

vi.setConfig({ testTimeout: 120_000 })

const map = lineMap(8)

/** r0 (rich, with a factory = a launch site) is at war with r1, r2 and r3; r1 has a factory, a line of 9 and an army. */
function war(): GameState {
  const s = startState(map)
  s.wars.push('r0|r1', 'r0|r2', 'r0|r3')
  const n = s.nations.r0
  n.resources.capital = 9000
  n.resources.steel = 900
  n.resources.oil = 300
  n.resources.tp = 500
  n.arsenal = { cruise: 40, tactical: 40, ballistic: 20, decoy: 40 }
  n.military.units.missile = 20
  s.regions.r0.buildings.factory = 2
  for (const id of ['r1', 'r2', 'r3']) {
    s.regions[id].buildings.factory = 2
    s.regions[id].line = 9
    s.regions[id].population = 20
  }
  setMilitary(s, 'r1', { infantry: 10, armor: 4, fighter: 2, air: 1 })
  setMilitary(s, 'r0', { infantry: 10, fighter: 2, air: 4, missile: 20 })
  return s
}
const ok = (s: GameState, o: Order) => expect(applyOrderNow(s, map, o).error, JSON.stringify(o)).toBeNull()
const fire = (kind: MissileType, count: number, target = 'r1', aim?: 'site'): Order => ({ type: 'strike', nationId: 'r0', target, weapon: 'missile', kind, count, ...(aim ? { aim } : {}) })
const give = (s: GameState, id: string, units: Partial<Record<'fighter' | 'air', number>>) => Object.assign(s.nations[id].military.units, units)

describe('every missile kind hurts people and the Defense Line', () => {
  const hit = (kind: MissileType, count: number, edit?: (s: GameState) => void) => {
    const s = war()
    edit?.(s)
    const r = s.regions.r1
    const before = { line: r.line, pop: r.population, stab: s.nations.r1.stability, infamy: s.infamy.r0 ?? 0 }
    const report = strikeHitsKind(s, map, 'r0', 'r1', kind, count)!
    return { s, report, dead: before.pop - r.population, pct: 1 - r.population / before.pop, line: before.line - r.line, stab: before.stab - s.nations.r1.stability, infamy: (s.infamy.r0 ?? 0) - before.infamy }
  }

  it('no kind is harmless: each one kills people and cuts the line', () => {
    for (const k of MISSILE_TYPES) {
      const r = hit(k, 8)
      expect(r.pct, k).toBeGreaterThan(0)
      expect(r.line, k).toBeGreaterThan(0)
      expect(r.report.dead, k).toBeCloseTo(r.dead, 9)
      expect(r.s.nations.r1.missileWar?.ledger?.lost, k).toBeCloseTo(r.dead, 9)
    }
  })

  it('ballistic kills the most per missile, tactical spares the civilians most of the real warheads', () => {
    const pct = (k: MissileType) => hit(k, 8).pct
    expect(pct('ballistic')).toBeGreaterThan(pct('hypersonic'))
    expect(pct('hypersonic')).toBeGreaterThan(pct('cruise'))
    expect(pct('cruise')).toBeGreaterThan(pct('tactical'))
    expect(pct('tactical')).toBeGreaterThan(pct('decoy'))
  })

  it('a salvo has a ceiling on the people it kills and the line it cuts', () => {
    for (const k of MISSILE_TYPES) {
      const spec = MISSILES[k]
      const r = hit(k, 500)
      expect(r.pct, k).toBeLessThanOrEqual(spec.peopleMax * (1 + spec.urban) + 1e-9)
      expect(r.line, k).toBeLessThanOrEqual(spec.lineMax + 1e-9)
    }
  })

  it('cities make it worse: the same salvo kills more where people live in cities', () => {
    const city = (id: string) => ({ id, name: id, level: 4, focus: 'trade' as never, port: false })
    const rural = hit('ballistic', 6, (s) => (s.regions.r1.cities = []))
    const urban = hit('ballistic', 6, (s) => (s.regions.r1.cities = [city('a'), city('b')]))
    expect(urbanShare(urban.s.regions.r1)).toBe(1)
    expect(urban.pct).toBeCloseTo(rural.pct * (1 + MISSILES.ballistic.urban), 9)
    expect(urban.infamy).toBeGreaterThan(rural.infamy)
  })

  it('the dead cost stability, add to war weariness, and earn a war-crime reputation scaled by kind', () => {
    const a = hit('ballistic', 8)
    expect(a.stab).toBeGreaterThan(0)
    expect(a.infamy).toBeGreaterThan(MISSILES.ballistic.infamy)
    expect(a.s.nations.r1.warWeariness).toBeGreaterThan(0)
    expect(a.s.opinions['r1>r0']?.some((m) => m.value < 0)).toBe(true)
    const c = hit('cruise', 8)
    expect(c.stab).toBeLessThan(a.stab)
    expect(c.infamy).toBeLessThan(a.infamy)
    // Decoys carry no war-crime charge.
    expect(hit('decoy', 8).infamy).toBe(0)
  })

  it('what it kills comes off the economy (fewer people in the country) and counts toward the war score', () => {
    const r = hit('ballistic', 10)
    expect(r.s.regions.r1.population).toBeLessThan(20)
    expect(r.s.warScore['r0>r1']).toBeGreaterThan(0)
    expect(r.s.warScore['r0>r1']).toBeLessThanOrEqual(MW.scoreMax + 1e-9)
    // Killing more civilians scores more.
    expect(hit('ballistic', 10).s.warScore['r0>r1']).toBeGreaterThan(hit('cruise', 2).s.warScore['r0>r1'])
  })

  it('secondary effects belong to the kind: fuel and airfields, army, buildings, factories', () => {
    const base = (k: MissileType, n = 8) => hit(k, n, (s) => {
      s.nations.r1.resources.oil = 100
      setMilitary(s, 'r1', { infantry: 10, fighter: 4, air: 2 })
    })
    const cruise = base('cruise')
    expect(cruise.s.nations.r1.resources.oil).toBeLessThan(100)
    expect(cruise.s.nations.r1.military.units.fighter).toBeLessThan(4)
    expect(base('tactical').s.nations.r1.military.units.infantry).toBeLessThan(10)
    expect(base('tactical').s.nations.r1.resources.oil).toBe(100)
    expect(hit('ballistic', 6, (s) => (s.regions.r1.buildings.factory = 4)).s.regions.r1.buildings.factory).toBeLessThan(4)
    expect(hit('cruise', 8).s.regions.r1.sabotaged).toBe(1)
    expect(hit('decoy', 8).s.regions.r1.sabotaged).toBe(0)
  })

  it('with the missile war switched off the old numbers return (light missiles harm no people, a tactical missile no line)', () => {
    withOldMissiles(() => {
      const c = hit('cruise', 8)
      expect(c.pct).toBe(0)
      expect(c.line).toBeCloseTo(2, 9)
      expect(hit('tactical', 10).line).toBe(0)
      expect(c.s.salvos).toBeUndefined()
      expect(c.s.missileTension).toBeUndefined()
    })
  })
})

describe('damage per money, by kind (the combat matrix)', () => {
  const cost = (k: MissileType) => {
    const m = MISSILES[k]
    return k === 'hypersonic' ? 55 + 7 : m.money + m.steel + m.oil
  }
  /** What one money buys against a 20-million, line-9 country with a level-3 shield, per kind, in the units each metric names. */
  const table = () => {
    const s = war()
    const region = s.regions.r1
    const rows = MISSILE_TYPES.map((k) => {
      const spec = MISSILES[k]
      const open = salvoDefense(s, 'r0', 'r1', 'r1', k, 1)
      s.nations.r1.systems.shield = 3
      const shielded = getsThrough(3, k)
      s.nations.r1.systems.shield = 0
      const lineOpen = Math.min(spec.lineMax, spec.line)
      const dead = spec.people * region.population * (1 + spec.urban * urbanShare(region))
      return { kind: k, cost: cost(k), linePerMoney: lineOpen / cost(k), deadPerMoney: dead / cost(k), armyPerMoney: spec.army / cost(k), sitePerMoney: spec.site / cost(k), shieldedLine: lineOpen * shielded, drainPerMoney: spec.drain / cost(k), speed: spec.km / spec.days, through: open.through }
    })
    return rows
  }

  it('every kind has a niche and no kind is best at everything', () => {
    const rows = table()
    const metrics = ['linePerMoney', 'deadPerMoney', 'armyPerMoney', 'sitePerMoney', 'shieldedLine', 'drainPerMoney', 'speed'] as const
    const wins = new Map<MissileType, string[]>()
    for (const m of metrics) {
      const best = rows.reduce((a, b) => (b[m] > a[m] ? b : a))
      wins.set(best.kind, [...(wins.get(best.kind) ?? []), m])
    }
    // Every kind wins at least one thing; nobody wins everything.
    for (const k of MISSILE_TYPES) expect(wins.get(k)?.length ?? 0, `${k} wins ${JSON.stringify([...wins])}`).toBeGreaterThanOrEqual(1)
    for (const [, w] of wins) expect(w.length).toBeLessThan(metrics.length)
    // And no kind is useless: every one does line and people damage for its money.
    for (const r of rows) {
      expect(r.linePerMoney, r.kind).toBeGreaterThan(0)
      expect(r.deadPerMoney, r.kind).toBeGreaterThan(0)
    }
  })

  it('no kind dominates another on every measure', () => {
    const rows = table()
    const metrics = ['linePerMoney', 'deadPerMoney', 'armyPerMoney', 'sitePerMoney', 'shieldedLine', 'drainPerMoney', 'speed'] as const
    for (const a of rows) for (const b of rows) if (a !== b) expect(metrics.some((m) => a[m] > b[m] + 1e-12), `${a.kind} vs ${b.kind}`).toBe(true)
  })
})

describe('interceptors: the shield is a store that runs dry', () => {
  it('a full store and no batteries or radar is the old rule exactly', () => {
    const s = war()
    s.nations.r1.systems.shield = 2
    for (const k of MISSILE_TYPES) expect(salvoDefense(s, 'r0', 'r1', 'r1', k, 4).through, k).toBeCloseTo(getsThrough(2, k), 12)
  })

  it('a shield level holds rounds, a battery adds rounds, and a nation with neither holds none', () => {
    const s = war()
    expect(interceptorCap(s.nations.r1)).toBe(0)
    s.nations.r1.systems.shield = 2
    expect(interceptorCap(s.nations.r1)).toBe(2 * MW.roundsPerShield)
    expect(interceptorsOf(s.nations.r1)).toBe(2 * MW.roundsPerShield)
    s.nations.r1.missileWar = { batteries: { r1: 2 } }
    expect(interceptorCap(s.nations.r1)).toBe(2 * MW.roundsPerShield + 2 * MW.roundsPerBattery)
  })

  it('a salvo spends the rounds and a big one runs the store dry, so more gets through', () => {
    const s = war()
    s.nations.r1.systems.shield = 1
    const cap = interceptorCap(s.nations.r1)
    const small = salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4).through
    const big = salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', cap * 3).through
    expect(big).toBeGreaterThan(small)
    strikeHitsKind(s, map, 'r0', 'r1', 'cruise', 5)
    expect(interceptorsOf(s.nations.r1)).toBe(cap - 5)
    expect(ledgerOf(s.nations.r1).interceptorsSpent).toBe(5)
    // A second salvo the same month meets a weaker shield.
    const second = salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 6)
    expect(second.coverage).toBeLessThan(1)
    expect(second.through).toBeGreaterThan(small)
    strikeHitsKind(s, map, 'r0', 'r1', 'cruise', 20)
    expect(interceptorsOf(s.nations.r1)).toBe(0)
    // With the store empty the shield stops almost nothing: only the floor remains.
    expect(salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4).through).toBeCloseTo(1, 9)
  })

  it('ballistic warheads draw more rounds than a cruise missile', () => {
    const s = war()
    s.nations.r1.systems.shield = 3
    strikeHitsKind(s, map, 'r0', 'r1', 'ballistic', 4)
    expect(ledgerOf(s.nations.r1).interceptorsSpent).toBe(4 * MISSILES.ballistic.drain)
  })

  it('decoys drain the store so that the real salvo behind them gets through', () => {
    const real = (decoys: number) => {
      const s = war()
      s.nations.r1.systems.shield = 3
      if (decoys) strikeHitsKind(s, map, 'r0', 'r1', 'decoy', decoys)
      const before = s.regions.r1.line
      strikeHitsKind(s, map, 'r0', 'r1', 'ballistic', 6)
      return before - s.regions.r1.line
    }
    const none = real(0)
    const wave = real(20)
    expect(wave).toBeGreaterThan(none * 1.2)
    // A decoy costs a fraction of an interceptor round.
    expect(MISSILES.decoy.money).toBeLessThan(MW.roundCost)
  })

  it('the store refills by half each month, and buying rounds fills it faster', () => {
    const s = war()
    s.nations.r1.systems.shield = 2
    strikeHitsKind(s, map, 'r0', 'r1', 'cruise', 16)
    expect(interceptorsOf(s.nations.r1)).toBe(0)
    runMissileWar(s)
    expect(interceptorsOf(s.nations.r1)).toBe(Math.ceil(16 * MW.regen))
    runMissileWar(s)
    expect(s.nations.r1.missileWar?.interceptors).toBeUndefined()
    expect(interceptorsOf(s.nations.r1)).toBe(16)
    // Buying: money per round, capped by the room in the store.
    strikeHitsKind(s, map, 'r0', 'r1', 'cruise', 10)
    s.nations.r1.resources.capital = 500
    const buy: Order = { type: 'missileDefense', nationId: 'r1', item: 'interceptors', count: 6 }
    expect(orderCost(s, buy).capital).toBe(6 * MW.roundCost)
    ok(s, buy)
    expect(interceptorsOf(s.nations.r1)).toBe(12)
    expect(validateOrder(s, map, { ...buy, count: 5 })).toMatch(/room for 4/)
    expect(validateOrder(s, map, { ...buy, count: 0 })).toMatch(/Buy between/)
    s.nations.r2.systems.shield = 0
    expect(validateOrder(s, map, { ...buy, nationId: 'r2' })).toMatch(/Needs an Interceptor Shield/)
  })

  it('batteries stop a share in their own country and radar cues them, and neither works without a shield or battery to cue', () => {
    const s = war()
    s.nations.r1.systems.shield = 1
    const plain = salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4).through
    s.nations.r1.missileWar = { batteries: { r1: 2 } }
    const withBat = salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4).through
    expect(withBat).toBeLessThan(plain)
    // A battery in another country does not cover this one.
    s.nations.r1.missileWar = { batteries: { r2: 3 } }
    expect(salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4).through).toBeCloseTo(plain, 12)
    s.nations.r1.missileWar = { radar: 3 }
    expect(radarLevel(s.nations.r1)).toBe(3)
    expect(salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4).through).toBeLessThan(plain)
    // Radar alone, with no rounds to cue, does nothing.
    s.nations.r1.systems.shield = 0
    expect(salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4).through).toBe(1)
  })

  it('finished aircraft developments count as airborne early warning, and hunters and a scramble add to a shield', () => {
    const s = war()
    s.nations.r1.systems.shield = 1
    s.nations.r1.aircraft = { radar: { done: true } } as never
    expect(radarLevel(s.nations.r1)).toBe(1)
    const cold = salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4)
    const hot = salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4, true)
    expect(hot.through).toBeLessThan(cold.through)
    expect(hot.stopped.fighters).toBeGreaterThan(cold.stopped.fighters)
    // No fighters at home, nothing to scramble.
    give(s, 'r1', { fighter: 0 })
    expect(salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4, true).through).toBeCloseTo(salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4).through, 9)
  })

  it('a scrambled wing counts one and a half times: a small wing of hunters covers more of the sky', () => {
    const s = war()
    s.nations.r1.systems.shield = 1
    s.nations.r1.aircraft = { hunters: { done: true } } as never
    give(s, 'r1', { fighter: 1 })
    const fx = aircraftEffects(s.nations.r1)
    const base = getsThrough(1, 'cruise')
    const hunted = AIRCRAFT_RULES.huntVs.cruise
    const cold = Math.max(0.05, pastDefenses(base, undefined, fx, 1, hunted))
    const hotHunters = Math.max(0.05, pastDefenses(base, undefined, fx, 1 * MW.scrambleWing, hunted))
    expect(salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4).through).toBeCloseTo(cold, 12)
    expect(salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 4, true).through).toBeCloseTo(hotHunters * (1 - Math.min(0.3, MW.scrambleStop * hunted)), 12)
    expect(hotHunters).toBeLessThan(cold)
  })

  it('the parts a salvo was stopped by add up to what was stopped', () => {
    const s = war()
    s.nations.r1.systems.shield = 2
    s.nations.r1.missileWar = { batteries: { r1: 1 }, radar: 2 }
    s.nations.r1.aircraft = { hunters: { done: true } } as never
    const d = salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 6, true)
    expect(d.stopped.shield + d.stopped.batteries + d.stopped.fighters + d.stopped.patrol).toBeCloseTo(1 - d.through, 9)
    for (const v of Object.values(d.stopped)) expect(v).toBeGreaterThanOrEqual(-1e-12)
  })

  it('the forecast shows the chance the real salvo then gets', () => {
    const s = war()
    s.nations.r1.systems.shield = 2
    const f = strikeForecast(s, map, 'r0', 'r1', 'ballistic', 6)!
    expect(f.chance).toBeCloseTo(salvoDefense(s, 'r0', 'r1', 'r1', 'ballistic', 6).through, 12)
    const line = s.regions.r1.line
    const pop = s.regions.r1.population
    const r = strikeHitsKind(s, map, 'r0', 'r1', 'ballistic', 6)!
    expect(line - s.regions.r1.line).toBeCloseTo(f.line, 9)
    expect(pop - s.regions.r1.population).toBeCloseTo(f.dead, 9)
    expect(r.hit).toBe(Math.round(6 * f.chance))
    expect(f.text).toMatch(/get through/)
  })
})

describe('counterforce: striking the launch sites', () => {
  const site = (kind: MissileType, count: number, edit?: (s: GameState) => void) => {
    const s = war()
    s.nations.r1.arsenal = { cruise: 20, tactical: 10 }
    s.nations.r1.military.units.missile = 10
    edit?.(s)
    const stock = missileStockTotal(s, 'r1')
    const r = strikeHitsKind(s, map, 'r0', 'r1', kind, count, { aim: 'site' })!
    return { s, r, stock, after: missileStockTotal(s, 'r1') }
  }
  const missileStockTotal = (s: GameState, id: string) => Object.values(s.nations[id].arsenal ?? {}).reduce((a, b) => a + b, 0) + s.nations[id].military.units.missile

  it('destroys a share of the enemy missiles in store and shuts the launch site', () => {
    const { s, r, stock, after } = site('tactical', 6)
    expect(after).toBeLessThan(stock * 0.8)
    expect(r.stock).toBeGreaterThan(5)
    expect(r.site).toBe(true)
    expect(ledgerOf(s.nations.r0).sitesHit).toBe(1)
    expect(s.nations.r1.missileWar?.down?.r1).toBeGreaterThanOrEqual(s.turn + 1)
    expect(r.aim).toBe('site')
  })

  it('a shut site cannot launch, and says so, until it reopens', () => {
    const { s } = site('tactical', 6)
    // r1 has factories only in r1; shut, it has no site to fire from.
    s.wars.push('r1|r0')
    s.nations.r1.arsenal = { cruise: 5 }
    const o: Order = { type: 'strike', nationId: 'r1', target: 'r0', weapon: 'missile', kind: 'cruise', count: 2 }
    expect(launchSite(s, map, 'r1', 'r0', 'cruise')).toBeNull()
    expect(validateOrder(s, map, o)).toMatch(/launch sites are shut/)
    for (let i = 0; i < MW.siteDownMax + 1; i++) {
      s.turn++
      runMissileWar(s)
    }
    expect(s.nations.r1.missileWar?.down).toBeUndefined()
    expect(launchSite(s, map, 'r1', 'r0', 'cruise')).toBe('r1')
  })

  it('does a share of the harm to people and the line that a strike on the country does, and no army, buildings or factory stop', () => {
    const country = (() => {
      const s = war()
      strikeHitsKind(s, map, 'r0', 'r1', 'tactical', 6)
      return s
    })()
    const { s } = site('tactical', 6)
    const dLine = 9 - s.regions.r1.line
    const cLine = 9 - country.regions.r1.line
    expect(dLine).toBeCloseTo(cLine * MW.siteHarm, 9)
    expect(20 - s.regions.r1.population).toBeCloseTo((20 - country.regions.r1.population) * MW.siteHarm, 9)
    expect(s.nations.r1.military.units.infantry).toBe(10)
    expect(country.nations.r1.military.units.infantry).toBeLessThan(10)
  })

  it('a shield stops part of it, and a strike that is shot down destroys nothing', () => {
    const open = site('tactical', 6)
    const shielded = site('tactical', 6, (s) => {
      s.nations.r1.systems.shield = 3
    })
    expect(shielded.stock - shielded.after).toBeLessThan(open.stock - open.after)
  })

  it('mobile launchers hide a share from it, and a recon sortie finds them again', () => {
    const base = site('tactical', 6)
    const hidden = site('tactical', 6, (s) => {
      s.nations.r1.missileWar = { mobile: 3 }
    })
    expect(hidden.stock - hidden.after).toBeLessThan((base.stock - base.after) * 0.5)
    const seen = site('tactical', 6, (s) => {
      s.nations.r1.missileWar = { mobile: 3 }
      s.nations.r0.missileWar = { seen: { r1: s.turn + 2 } }
    })
    expect(seen.stock - seen.after).toBeCloseTo(base.stock - base.after, 9)
    // Recon is an order: money, fighters or bombers at home, a war with the nation.
    const s = war()
    const recon: Order = { type: 'recon', nationId: 'r0', target: 'r1' }
    ok(s, recon)
    expect(s.nations.r0.missileWar?.seen?.r1).toBe(s.turn + MW.reconMonths)
    expect(validateOrder(s, map, recon)).toMatch(/already found/)
    expect(validateOrder(war(), map, { ...recon, target: 'r5' })).toMatch(/at war/)
    const s2 = war()
    setMilitary(s2, 'r0', { infantry: 4 })
    expect(validateOrder(s2, map, recon)).toMatch(/Needs fighters/)
  })

  it('the country needs a factory to be a site, and the order is refused otherwise', () => {
    const s = war()
    s.regions.r1.buildings.factory = 0
    expect(validateOrder(s, map, fire('tactical', 2, 'r1', 'site'))).toMatch(/No launch site/)
    s.regions.r1.buildings.factory = 1
    expect(validateOrder(s, map, fire('tactical', 2, 'r1', 'site'))).toBeNull()
    expect(validateMissileStrike(s, map, { ...(fire('tactical', 2) as Extract<Order, { type: 'strike' }>), aim: 'nonsense' as never }, [])).toMatch(/Choose what to aim at/)
  })

  it('kills no nuclear warheads, which sit in hardened silos', () => {
    const { s } = site('tactical', 10, (s) => {
      s.nations.r1.nuclear = { warheads: 3, building: [] }
    })
    expect(s.nations.r1.nuclear!.warheads).toBe(3)
  })
})

describe('bomber raids', () => {
  const raid = (aim?: 'site', share?: number): Extract<Order, { type: 'raid' }> => ({ type: 'raid', nationId: 'r0', target: 'r1', ...(aim ? { aim } : {}), ...(share ? { share } : {}) })

  it('fly out, meet fighters and batteries, lose aircraft and hit the country', () => {
    const s = war()
    s.nations.r1.missileWar = { batteries: { r1: 2 } }
    const plan = raidPlan(s, map, { nationId: 'r0', target: 'r1' })
    expect(plan.sent).toBeCloseTo(2, 5)
    expect(plan.loss).toBeGreaterThan(MW.raid.baseLoss)
    const air = s.nations.r0.military.units.air
    const line = s.regions.r1.line
    ok(s, raid())
    expect(s.nations.r0.military.units.air).toBeCloseTo(air - plan.sent * plan.loss, 9)
    expect(s.regions.r1.line).toBeLessThan(line)
    expect(s.salvos?.at(-1)?.weapon).toBe('raid')
    expect(ledgerOf(s.nations.r0).aircraftLost).toBeGreaterThan(0)
    expect(s.log.at(-1)?.text).toMatch(/raid by/)
  })

  it('escorts, stealth and fewer defenders cut the losses; batteries and more fighters raise them', () => {
    const loss = (edit: (s: GameState) => void) => {
      const s = war()
      edit(s)
      return raidPlan(s, map, { nationId: 'r0', target: 'r1' }).loss
    }
    const base = loss(() => {})
    expect(loss((s) => give(s, 'r0', { fighter: 0 }))).toBeGreaterThan(base)
    expect(loss((s) => give(s, 'r1', { fighter: 6 }))).toBeGreaterThan(base)
    expect(loss((s) => give(s, 'r1', { fighter: 0 }))).toBeLessThan(base)
    expect(loss((s) => (s.nations.r1.missileWar = { batteries: { r1: 3 } }))).toBeGreaterThan(base)
    expect(loss((s) => (s.nations.r0.aircraft = { coatings: { done: true }, stealthBombers: { done: true } } as never))).toBeLessThan(base)
    expect(loss((s) => give(s, 'r1', { fighter: 40 }))).toBeLessThanOrEqual(MW.raid.maxLoss)
  })

  it('aim at the launch sites: destroys the store and shuts the site; the forecast says what to expect', () => {
    const s = war()
    s.nations.r1.arsenal = { cruise: 20 }
    const f = raidForecast(s, map, 'r0', 'r1', 'site')!
    expect(f.stock).toBeGreaterThan(0.1)
    ok(s, raid('site'))
    expect(s.nations.r1.arsenal.cruise).toBeCloseTo(20 * (1 - f.stock), 9)
    expect(s.nations.r1.missileWar?.down?.r1).toBeGreaterThan(s.turn)
    expect(f.text).toMatch(/bomber divisions/)
  })

  it('is refused when it cannot fly: no peace raids, no bombers, no airbase in reach, once a month, not through a ceasefire', () => {
    const s = war()
    expect(validateOrder(s, map, { ...raid(), target: 'r5' })).toMatch(/at war/)
    setMilitary(s, 'r0', { infantry: 3 })
    expect(validateOrder(s, map, raid())).toMatch(/strike aircraft/)
    const s2 = war()
    expect(validateOrder(s2, map, raid(undefined, 5))).toMatch(/between 10% and 100%/)
    expect(validateOrder(s2, map, raid('nonsense' as never))).toMatch(/what to bomb/)
    s2.regions.r0.buildings.factory = 0
    expect(validateOrder(s2, map, raid())).toMatch(/Out of range/)
    const s3 = war()
    ok(s3, raid())
    expect(validateOrder(s3, map, raid())).toMatch(/needs? a month|crews/)
    const s5 = war()
    s5.regions.r1.buildings.factory = 0
    expect(validateOrder(s5, map, raid('site'))).toMatch(/No launch site/)
    expect(validateOrder(s5, map, raid())).toBeNull()
    const s4 = war()
    s4.truces = { 'r0|r1': s4.turn + 3 }
    expect(validateOrder(s4, map, raid())).toMatch(/ceasefire/)
    expect(validateOrder(s4, map, fire('cruise', 2))).toMatch(/ceasefire/)
  })

  it('in a turn game it waits for the month end; in a live game it flies at once', () => {
    const turn = war()
    const after = resolveTurn(turn, map, [raid()])
    expect(after.salvos?.some((r) => r.weapon === 'raid')).toBe(true)
    const live = startLive(war())
    ok(live, raid())
    expect(live.salvos?.at(-1)?.weapon).toBe('raid')
  })
})

describe('doctrine: retaliation, launch on warning, false alarms', () => {
  const doctrine = (s: GameState, id: string, d: 'hold' | 'retaliate' | 'warning') => ((s.nations[id].missileWar ??= {}).doctrine = d)

  it('a retaliating nation answers a strike once, never an answer', () => {
    const s = war()
    s.nations.r1.arsenal = { cruise: 20, tactical: 10 }
    doctrine(s, 'r1', 'retaliate')
    ok(s, fire('cruise', 4))
    const answer = s.salvos!.find((r) => r.from === 'r1')!
    expect(answer.auto).toBe(true)
    expect(answer.to).toBe('r0')
    expect(s.salvos!.filter((r) => r.from === 'r1')).toHaveLength(1)
    // r0 holds fire by default, so the exchange stops there.
    expect(s.salvos!.filter((r) => r.from === 'r0')).toHaveLength(1)
    const used = 30 - missileStock(s.nations.r1, 'cruise') - missileStock(s.nations.r1, 'tactical')
    expect(used).toBeLessThanOrEqual(MW.answerMax)
    // Two retaliating nations do not chain.
    const t = war()
    t.nations.r1.arsenal = { cruise: 20 }
    doctrine(t, 'r1', 'retaliate')
    doctrine(t, 'r0', 'retaliate')
    ok(t, fire('cruise', 4))
    expect(t.salvos!.length).toBe(2)
  })

  it('in a live game an automatic answer is never answered either, so two retaliating nations stop at two salvos', () => {
    let s = startLive(war())
    // r0 has a second launch site, so the counterforce answer that shuts its first one does not stop it answering.
    giveRegions(s, 'r0', ['r2'])
    s.regions.r2.buildings.factory = 2
    s.wars = ['r0|r1']
    s.nations.r1.arsenal = { cruise: 20 }
    doctrine(s, 'r1', 'retaliate')
    doctrine(s, 'r0', 'retaliate')
    ok(s, fire('cruise', 4))
    for (let i = 0; i < 12; i++) s = advanceDay(s, map, { planner: () => [] }).state
    expect(s.flights).toHaveLength(0)
    expect(s.salvos!.map((r) => [r.from, !!r.auto])).toEqual([['r0', false], ['r1', true]])
  })

  it('answers at the launch site that hit it, with counterforce, when that is a country with a factory', () => {
    const s = war()
    s.nations.r1.arsenal = { cruise: 20, tactical: 10 }
    doctrine(s, 'r1', 'retaliate')
    ok(s, fire('cruise', 4))
    const answer = s.salvos!.find((r) => r.from === 'r1')!
    expect(answer.region).toBe('r0')
    expect(answer.aim).toBe('site')
  })

  it('hold fire never answers, and no answer comes without missiles, a war or in a ceasefire', () => {
    const s = war()
    s.nations.r1.arsenal = { cruise: 20 }
    ok(s, fire('cruise', 4))
    expect(s.salvos!.some((r) => r.from === 'r1')).toBe(false)
    const t = war()
    doctrine(t, 'r1', 'retaliate')
    ok(t, fire('cruise', 4))
    expect(t.salvos!.some((r) => r.from === 'r1')).toBe(false)
  })

  it('launch on warning fires while the salvo is still in the air (live), only with radar', () => {
    const base = () => {
      const s = startLive(war())
      s.nations.r1.arsenal = { cruise: 20 }
      doctrine(s, 'r1', 'warning')
      return s
    }
    const blind = base()
    ok(blind, fire('ballistic', 4))
    expect(blind.flights).toHaveLength(1)
    const seeing = base()
    seeing.nations.r1.missileWar!.radar = 1
    ok(seeing, fire('ballistic', 4))
    expect(seeing.flights).toHaveLength(2)
    const answer = seeing.flights!.find((f) => f.nationId === 'r1')!
    expect(answer.auto).toBe(true)
    // It lands first or with the incoming one; either way, the answer was launched the same day.
    expect(answer.launched).toBe(seeing.flights!.find((f) => f.nationId === 'r0')!.launched)
    // An automatic answer is never answered by launch on warning.
    doctrine(seeing, 'r0', 'warning')
    seeing.nations.r0.missileWar!.radar = 3
    expect(seeing.flights).toHaveLength(2)
  })

  it('a false alarm needs a doctrine of warning, a war and missiles, and is more likely as tension rises and less with radar', () => {
    const rate = (tension: number, radar: number) => {
      let n = 0
      for (let seed = 0; seed < 300; seed++) {
        const s = war()
        s.seed = seed + 11
        s.nations.r1.arsenal = { cruise: 20 }
        s.missileTension = tension || undefined
        s.nations.r1.missileWar = { doctrine: 'warning', radar }
        runFalseAlarms(s, map)
        if (s.log.some((l) => /FALSE ALARM/.test(l.text))) n++
      }
      return n
    }
    const calm = rate(0, 0)
    expect(calm).toBeGreaterThan(0)
    expect(calm / 300).toBeLessThan(MW.falseAlarm * 3)
    expect(rate(90, 0)).toBeGreaterThan(calm * 2)
    expect(rate(90, 3)).toBeLessThan(rate(90, 0))
    const none = war()
    none.nations.r1.arsenal = { cruise: 20 }
    none.nations.r1.missileWar = { doctrine: 'hold' }
    none.missileTension = 100
    for (let i = 0; i < 50; i++) {
      none.turn++
      runFalseAlarms(none, map)
    }
    expect(none.log.some((l) => /FALSE ALARM/.test(l.text))).toBe(false)
    const peace = war()
    peace.wars = []
    peace.nations.r1.arsenal = { cruise: 20 }
    peace.nations.r1.missileWar = { doctrine: 'warning' }
    peace.missileTension = 100
    for (let i = 0; i < 50; i++) {
      peace.turn++
      runFalseAlarms(peace, map)
    }
    expect(peace.log.some((l) => /FALSE ALARM/.test(l.text))).toBe(false)
  })

  it('a false alarm costs reputation and raises tension, and is repeatable from the seed', () => {
    const run = () => {
      const s = war()
      s.nations.r1.arsenal = { cruise: 20 }
      s.nations.r1.missileWar = { doctrine: 'warning' }
      s.missileTension = 100
      for (let i = 0; i < 40 && !s.log.some((l) => /FALSE ALARM/.test(l.text)); i++) {
        s.turn++
        runFalseAlarms(s, map)
      }
      return s
    }
    const a = run()
    const b = run()
    expect(a.turn).toBe(b.turn)
    expect(JSON.stringify(a.salvos)).toBe(JSON.stringify(b.salvos))
    expect(a.infamy.r1).toBeGreaterThanOrEqual(MW.falseAlarmInfamy)
    expect(tensionOf(a)).toBeGreaterThan(90)
  })

  it('every doctrine is described, and unknown ones are refused', () => {
    for (const d of Object.values(DOCTRINES)) expect(d.blurb.length).toBeGreaterThan(20)
    const s = war()
    expect(validateOrder(s, map, { type: 'setDoctrine', nationId: 'r0', doctrine: 'chaos' as never })).toMatch(/Unknown doctrine/)
    ok(s, { type: 'setDoctrine', nationId: 'r0', doctrine: 'warning' })
    expect(s.nations.r0.missileWar?.doctrine).toBe('warning')
  })

  it('an answer shot is a legal order and spends no money', () => {
    const s = war()
    s.nations.r1.arsenal = { cruise: 20 }
    const shot = answerShot(s, map, 'r1', 'r0', 'r0')!
    expect(shot.count).toBeLessThanOrEqual(MW.answerMax)
    expect(validateOrder(s, map, shot)).toBeNull()
  })
})

describe('the escalation ladder and world tension', () => {
  it('strikes raise tension by kind, counterforce less, and the ladder has five rungs', () => {
    const t = (kind: MissileType, aim?: 'site') => {
      const s = war()
      strikeHitsKind(s, map, 'r0', 'r1', kind, 6, aim ? { aim } : {})
      return tensionOf(s)
    }
    expect(t('ballistic')).toBeGreaterThan(t('hypersonic'))
    expect(t('hypersonic')).toBeGreaterThan(t('cruise'))
    expect(t('tactical', 'site')).toBeLessThan(t('tactical'))
    expect(t('decoy')).toBeLessThan(t('cruise'))
    expect(MW.ladder).toHaveLength(5)
    expect(rungOf(0)).toBe(0)
    expect(rungOf(10)).toBe(1)
    expect(rungOf(55)).toBe(3)
    expect(rungOf(100)).toBe(4)
  })

  it('tension is capped, fades each month, faster when nobody fires, and feeds the world tension', () => {
    const s = war()
    const calm = worldTension(s)
    for (let i = 0; i < 40; i++) strikeHitsKind(s, map, 'r0', 'r1', 'ballistic', 6)
    expect(tensionOf(s)).toBe(100)
    expect(worldTension(s)).toBeGreaterThan(calm)
    s.turn++
    runMissileWar(s)
    expect(tensionOf(s)).toBe(100 - MW.tensionFade - MW.tensionQuietFade)
    for (let i = 0; i < 40; i++) {
      s.turn++
      runMissileWar(s)
    }
    expect(s.missileTension).toBeUndefined()
  })

  it('the world judges civilian deaths harder at the top of the ladder', () => {
    const infamy = (tension: number) => {
      const s = war()
      s.missileTension = tension
      strikeHitsKind(s, map, 'r0', 'r1', 'ballistic', 8)
      return s.infamy.r0
    }
    expect(infamy(60)).toBeGreaterThan(infamy(0))
  })

  it('a nuclear strike pushes it to the brink', async () => {
    const { detonate } = await import('../nuclear')
    const { createRng } = await import('../rng')
    const s = war()
    s.nations.r0.nuclear = { warheads: 1, building: [] }
    detonate(s, map, createRng(3, 0), 'r0', 'r1')
    expect(tensionOf(s)).toBeGreaterThanOrEqual(MW.nukeTension)
  })
})

describe('ceasefire and de-escalation', () => {
  const offer = (_s: GameState, target = 'r1'): Extract<Order, { type: 'missileTruce' }> => ({ type: 'missileTruce', nationId: 'r0', target })

  it('an AI rival refuses while the world is calm, accepts when the tension is up or it is losing the exchange', () => {
    const s = war()
    expect(validateOrder(s, map, offer(s))).toMatch(/sees no reason/)
    s.missileTension = MW.truceTension[1]
    expect(truceAnswer(s, 'r1').accepts).toBe(true)
    const t = war()
    t.nations.r1.missileWar = { ledger: { fired: 4, hits: 1, shotDown: 3, killed: 0, lost: 3, lineDealt: 0, lineTaken: 2, sitesHit: 0, stockDestroyed: 0, interceptorsSpent: 0, aircraftLost: 0 } }
    expect(validateOrder(t, map, offer(t))).toBeNull()
  })

  it('easy rivals accept sooner than hard ones', () => {
    const at = (d: 'easy' | 'normal' | 'hard') => {
      const s = war()
      s.settings.difficulty = d
      s.missileTension = 12
      return truceAnswer(s, 'r1').accepts
    }
    expect(at('easy')).toBe(true)
    expect(at('normal')).toBe(false)
    expect(at('hard')).toBe(false)
  })

  it('a ceasefire stops missiles, raids and warheads both ways, cools the world, and runs out', () => {
    const s = war()
    s.missileTension = 50
    ok(s, offer(s))
    expect(trucePair(s, 'r0', 'r1')).toBe(s.turn + MW.truceMonths)
    expect(tensionOf(s)).toBe(50 - MW.truceTensionDrop)
    expect(validateOrder(s, map, fire('cruise', 2))).toMatch(/ceasefire/)
    s.nations.r1.arsenal = { cruise: 5 }
    expect(validateOrder(s, map, { type: 'strike', nationId: 'r1', target: 'r0', weapon: 'missile', kind: 'cruise', count: 1 })).toMatch(/ceasefire/)
    s.nations.r0.nuclear = { warheads: 1, building: [] }
    expect(validateOrder(s, map, { type: 'nuke', nationId: 'r0', target: 'r1' })).toMatch(/ceasefire/)
    // Other enemies are not covered.
    expect(validateOrder(s, map, fire('cruise', 2, 'r2'))).toBeNull()
    expect(validateOrder(s, map, offer(s))).toMatch(/already holds/)
    s.turn += MW.truceMonths + 1
    runMissileWar(s)
    expect(s.truces).toBeUndefined()
    expect(validateOrder(s, map, fire('cruise', 2))).toBeNull()
  })

  it('lifting a ceasefire costs reputation, and there must be one to lift', () => {
    const s = war()
    s.missileTension = 50
    expect(validateOrder(s, map, { ...offer(s), lift: true })).toMatch(/no ceasefire/)
    ok(s, offer(s))
    ok(s, { ...offer(s), lift: true })
    expect(s.infamy.r0).toBe(MW.truceLiftInfamy)
    expect(trucePair(s, 'r0', 'r1')).toBeNull()
  })

  it('cannot be offered to a stranger or a nation you are not fighting; to another player it is an offer they answer (DEALINGS)', () => {
    const s = war()
    s.missileTension = 80
    s.humans.push('r1')
    s.nations.r1.isPlayer = true
    // Between two players it goes to their inbox (src/net/missileTruceOnline.test.ts); with DEALINGS off it is refused as before.
    expect(validateOrder(s, map, offer(s))).toBeNull()
    DEALINGS.on = false
    try {
      expect(validateOrder(s, map, offer(s))).toMatch(/Only AI rivals/)
    } finally {
      DEALINGS.on = true
    }
    expect(validateOrder(war(), map, { ...offer(s), target: 'zz' })).toMatch(/Unknown nation/)
    const t = war()
    t.missileTension = 80
    expect(validateOrder(t, map, offer(t, 'r5'))).toMatch(/not at war/)
  })
})

describe('a month of turn and live agree', () => {
  it('the same salvo does the same harm landing at the month end and landing in flight', () => {
    const setup = () => {
      const s = war()
      s.nations.r1.systems.shield = 2
      s.nations.r1.missileWar = { radar: 1, batteries: { r1: 1 } }
      return s
    }
    const turn = resolveTurn(setup(), map, [fire('cruise', 12), fire('ballistic', 3)])
    let live = startLive(setup())
    ok(live, fire('cruise', 12))
    ok(live, fire('ballistic', 3))
    for (let i = 0; i < 6; i++) live = advanceDay(live, map, { planner: () => [] }).state
    expect(live.flights).toHaveLength(0)
    // The month's economy heals lines and grows people after the salvos land, so compare what each salvo did, not the state after the month.
    const key = (g: GameState) => g.salvos!.map((r) => [r.kind, r.fired, r.hit, +r.line.toFixed(9), +r.dead.toFixed(9), r.interceptorsUsed])
    expect(key(live)).toEqual(key(turn))
    expect(ledgerOf(live.nations.r1).interceptorsSpent).toBe(ledgerOf(turn.nations.r1).interceptorsSpent)
    expect(clockOf(live)).toBeGreaterThan(0)
  })

  it('a scrambled wing really cuts the salvo that was scrambled against, and only that one', () => {
    let s = startLive(war())
    s.nations.r1.systems.shield = 1
    ok(s, fire('cruise', 6))
    const id = s.flights![0].id
    const plain = structuredClone(s)
    const scramble: Order = { type: 'scramble', nationId: 'r1', flightId: id }
    ok(s, scramble)
    expect(s.flights![0].scrambled).toBe(true)
    expect(validateOrder(s, map, scramble)).toMatch(/already scrambled/)
    for (const x of [s, plain]) for (let i = 0; i < 3; i++) Object.assign(x, advanceDay(x, map, { planner: () => [] }).state)
    expect(s.regions.r1.line).toBeGreaterThan(plain.regions.r1.line)
    expect(s.salvos![0].scrambled).toBe(true)
    // Turn games have no salvo in the air to scramble against.
    const t = war()
    expect(validateOrder(t, map, scramble)).toMatch(/only in a live game/)
    s = war()
    expect(validateOrder(startLive(s), map, scramble)).toMatch(/gone/)
  })
})

describe('fuzz: malformed missile-war orders never throw or break the state', () => {
  it('garbage in, a refusal or a sane result out', () => {
    const junk: unknown[] = [undefined, null, NaN, Infinity, -1, 0, 0.5, 1e9, '', 'x', {}, [], 'site', 'country', 'r1', 'r99', 'zz', true]
    const items = ['radar', 'interceptors', 'battery', 'mobile', 'nope']
    const pick = (i: number) => junk[i % junk.length]
    let n = 0
    for (let i = 0; i < 400; i++) {
      const s = war()
      const orders: Order[] = [
        { type: 'missileDefense', nationId: 'r0', item: items[i % 5] as never, count: pick(i) as never, regionId: pick(i * 7) as never },
        { type: 'setDoctrine', nationId: 'r0', doctrine: pick(i * 3) as never },
        { type: 'scramble', nationId: 'r0', flightId: pick(i * 5) as never },
        { type: 'raid', nationId: 'r0', target: pick(i * 11) as never, aim: pick(i * 13) as never, share: pick(i * 17) as never },
        { type: 'recon', nationId: 'r0', target: pick(i * 19) as never },
        { type: 'missileTruce', nationId: 'r0', target: pick(i * 23) as never, lift: pick(i * 29) as never },
        { type: 'strike', nationId: 'r0', target: pick(i * 31) as never, weapon: 'missile', kind: pick(i * 37) as never, count: pick(i * 41) as never, aim: pick(i * 43) as never },
      ]
      for (const o of orders) {
        let err: string | null | undefined
        expect(() => (err = validateOrder(s, map, o)), JSON.stringify(o)).not.toThrow()
        if (err === null) {
          expect(() => applyOrderNow(s, map, o), JSON.stringify(o)).not.toThrow()
          n++
        }
      }
      expect(() => checkInvariants(s)).not.toThrow()
      for (const nation of Object.values(s.nations)) {
        expect(Number.isFinite(nation.resources.capital)).toBe(true)
        expect(interceptorsOf(nation)).toBeGreaterThanOrEqual(0)
      }
    }
    expect(n).toBeGreaterThan(20)
  })
})

describe('the old rules return when the war is switched off', () => {
  it('no state is written that a game without the missile war would not have', () => {
    withOldMissiles(() => {
      const s = war()
      s.nations.r1.systems.shield = 2
      strikeHitsKind(s, map, 'r0', 'r1', 'cruise', 20)
      strikeHitsKind(s, map, 'r0', 'r1', 'cruise', 20)
      expect(s.nations.r1.missileWar).toBeUndefined()
      expect(s.salvos).toBeUndefined()
      expect(s.missileTension).toBeUndefined()
      expect(salvoDefense(s, 'r0', 'r1', 'r1', 'cruise', 40).through).toBeCloseTo(getsThrough(2, 'cruise'), 12)
    })
    expect(SHIELD_STOPS.length).toBeGreaterThan(0)
  })
})
