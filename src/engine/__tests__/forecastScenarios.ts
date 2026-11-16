import type { Stance } from '../../data/war'
import { attackPool } from '../deploy'
import { forecastPlan, type AttackPlan } from '../forecast'
import { createRng } from '../rng'
import type { GameState, Terrain, UnitCounts } from '../types'
import { UNIT_TYPES } from '../types'
import { resolveAttack } from '../warfare'
import { lineMap, setMilitary, startState } from './fixtures'

const TERRAINS: Terrain[] = ['plains', 'forest', 'mountain', 'desert', 'urban']
const STANCE_LIST: Stance[] = ['assault', 'blitz', 'siege']

export interface Scenario {
  s: GameState
  plan: AttackPlan
  map: ReturnType<typeof lineMap>
  name: string
}

export function scenario(i: number): Scenario {
  const r = createRng(4242, i)
  const terrain = TERRAINS[i % TERRAINS.length]
  const map = lineMap(6, { 1: terrain })
  const s = startState(map)
  s.wars.push('r0|r1')
  s.nations.r0.resources.capital = 5000
  const pick = (max: number, p = 0.6) => (r.chance(p) ? Math.round(r.range(0, max) * 10) / 10 : 0)
  const mine: Partial<UnitCounts> = { infantry: pick(30, 0.9), armor: pick(14), artillery: pick(9), fighter: pick(7), air: pick(6), drone: pick(8, 0.3), robot: pick(5, 0.25), missile: r.chance(0.3) ? r.int(2, 8) : 0 }
  const theirs: Partial<UnitCounts> = { infantry: pick(30, 0.9), armor: pick(12), artillery: pick(8), fighter: pick(6), air: pick(5), drone: pick(6, 0.2), robot: pick(4, 0.2) }
  setMilitary(s, 'r0', mine)
  setMilitary(s, 'r1', theirs)
  for (const k of UNIT_TYPES) {
    s.nations.r0.military.drill[k] = r.int(0, 3)
    s.nations.r1.military.drill[k] = r.int(0, 3)
    s.nations.r0.military.weapons[k] = r.int(0, 2)
  }
  if (r.chance(0.2)) s.nations.r0.oilShortage = true
  if (r.chance(0.15)) s.nations.r1.oilShortage = true
  if (r.chance(0.25)) s.nations.r1.systems = { ...s.nations.r1.systems, shield: r.int(1, 3), cyber: r.int(0, 2), ai: 0, quantum: 0, orbital: 0, nano: r.int(0, 2) }
  if (r.chance(0.25)) s.nations.r0.systems = { ...s.nations.r0.systems, ai: r.int(1, 3), cyber: r.int(0, 3), shield: 0, quantum: 0, orbital: 0, nano: r.int(0, 2) }
  const stance = STANCE_LIST[Math.floor(r.range(0, 3))]
  const named = r.chance(0.5)
  const plan: AttackPlan = { target: 'r1', stance, missiles: mine.missile ? r.int(0, Math.floor(mine.missile)) : 0 }
  if (named) {
    const pool = attackPool(s, 'r0')
    const u: Partial<UnitCounts> = {}
    for (const k of UNIT_TYPES) if (k !== 'missile' && pool[k] > 0) u[k] = Math.round(pool[k] * r.range(0.2, 1) * 10) / 10
    plan.units = u
  } else if (r.chance(0.5)) plan.share = Math.round(r.range(0.2, 1) * 20) / 20
  else plan.commit = (['probe', 'main', 'allin'] as const)[Math.floor(r.range(0, 3))]
  // Most of the scenarios are tuned to a contested fight (the defender's infantry is found by bisection on the forecast, which only picks
  // the scenario: the simulation below judges it independently). The rest are left as drawn, lopsided or not.
  if (i % 4 !== 3) {
    const aim = 0.15 + 0.7 * r.next()
    let lo = 0
    let hi = 120
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2
      s.nations.r1.military.units.infantry = mid
      const f = forecastPlan(s, map, 'r0', plan, 48, false)
      if (!f) break
      if (f.winChance > aim) lo = mid
      else hi = mid
    }
    s.nations.r1.military.units.infantry = Math.round(((lo + hi) / 2) * 10) / 10
  }
  return { s, plan, map, name: `#${i} ${terrain} ${stance}${named ? ' named' : plan.share ? ' share' : ' ' + plan.commit}` }
}

export function simulate(sc: Scenario, runs: number): number {
  let wins = 0
  for (let j = 0; j < runs; j++) {
    const c = structuredClone(sc.s)
    const res = resolveAttack(c, sc.map, 'r0', 'r1', createRng(31337 + j, j * 7 + 1), sc.plan.commit ?? 'main', sc.plan.stance, sc.plan.missiles, undefined, sc.plan.share, sc.plan.units)
    if (res?.report.winner === 'attacker') wins++
  }
  return wins / runs
}

