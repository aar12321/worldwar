import { expect } from 'vitest'
import { CAMPAIGNS } from '../../data/society'
import { MISSILE_PROGRAM } from '../../data/missiles'
import { MW } from '../../data/missileWar'
import { LOCAL_IDS } from '../../data/localProjects'
import { PROJECT_IDS } from '../../data/projects'
import { levelMonths } from '../industry'
import { localMonths } from '../works'
import type { GameState, ProjectState } from '../types'
import { SKILL_KEYS } from '../types'

const real = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/**
 * Every number the statecraft systems keep stays real and in its range. Returns a plain list of what is wrong, so a long
 * simulation can print it instead of stopping at the first (the balance sweep does); `checkInvariants` turns it into a failure.
 */
export function invariantProblems(s: GameState): string[] {
  const bad: string[] = []
  const check = (ok: boolean, what: string) => {
    if (!ok) bad.push(what)
  }
  // The missile war: tension in range, rounds and levels sane, reports capped.
  check(s.missileTension === undefined || (real(s.missileTension) && s.missileTension > 0 && s.missileTension <= 100), `tension ${s.missileTension}`)
  check((s.salvos?.length ?? 0) <= MW.keepSalvos, `salvo reports ${s.salvos?.length}`)
  for (const n of Object.values(s.nations)) {
    const w = n.missileWar
    if (!w) continue
    check(w.interceptors === undefined || (real(w.interceptors) && w.interceptors >= 0), `${n.id} interceptors ${w.interceptors}`)
    check((w.radar ?? 0) <= MW.radarMax && (w.mobile ?? 0) <= MW.mobileMax, `${n.id} radar/mobile level`)
    for (const [r, lvl] of Object.entries(w.batteries ?? {})) check(Number.isInteger(lvl) && lvl >= 1 && lvl <= MW.batteryMax, `${n.id} battery in ${r}: ${lvl}`)
    for (const k of Object.keys(w.ledger ?? {}) as (keyof NonNullable<typeof w.ledger>)[]) check(real(w.ledger![k]) && w.ledger![k] >= -1e-9, `${n.id} ledger ${k}`)
  }
  const resources = ['capital', 'food', 'pp', 'tp', 'oil', 'steel', 'goods'] as const
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
    const id = n.id
    for (const k of resources) check(real(n.resources[k]), `${id} ${k} is ${n.resources[k]}`)
    // Everything but money cannot go below nothing (money can: that is debt).
    for (const k of ['food', 'pp', 'tp', 'oil', 'steel', 'goods'] as const) check(n.resources[k] >= -1e-6, `${id} ${k} is ${n.resources[k]}`)
    check(real(n.stability) && n.stability >= 0 && n.stability <= 100, `${id} stability ${n.stability}`)
    check(real(n.warWeariness) && n.warWeariness >= 0 && n.warWeariness <= 60, `${id} weariness ${n.warWeariness}`)
    check(real(n.debt) && n.debt >= 0, `${id} debt ${n.debt}`)
    check(real(n.militaryPool) && n.militaryPool >= -1e-6, `${id} manpower ${n.militaryPool}`)
    check(n.taxRate >= 0 && n.taxRate <= 0.6, `${id} tax ${n.taxRate}`)
    for (const k of Object.keys(n.military.units) as (keyof typeof n.military.units)[]) check(real(n.military.units[k]) && n.military.units[k] >= -1e-9, `${id} units ${k} ${n.military.units[k]}`)

    // Social programs: levels are whole numbers 0-3, strength moves between 0 and 3.
    for (const [pid, p] of Object.entries(n.social ?? {})) {
      if (!p) continue
      check(Number.isInteger(p.level) && p.level >= 0 && p.level <= 3, `${id} social ${pid} level ${p.level}`)
      check(real(p.strength) && p.strength >= -1e-9 && p.strength <= 3 + 1e-9, `${id} social ${pid} strength ${p.strength}`)
    }
    for (const [cid, c] of Object.entries(n.campaigns ?? {})) {
      if (!c) continue
      const spec = CAMPAIGNS[cid as keyof typeof CAMPAIGNS]
      check(!!spec && Number.isInteger(c.left) && c.left >= 0 && c.left <= spec.months, `${id} campaign ${cid} left ${c.left}`)
      check(!!spec && Number.isInteger(c.cooldown) && c.cooldown >= 0 && c.cooldown <= spec.cooldown, `${id} campaign ${cid} cooldown ${c.cooldown}`)
    }

    // National projects: progress never passes the months the level takes, and a level is at most 3.
    for (const pid of PROJECT_IDS) {
      const p = n.projects?.[pid] as ProjectState | undefined
      if (!p) continue
      const built = p.level ?? (p.done ? 1 : 0)
      check(built >= 0 && built <= 3, `${id} project ${pid} level ${built}`)
      check(real(p.progress) && p.progress >= 0, `${id} project ${pid} progress ${p.progress}`)
      if (!p.done) check(p.progress <= levelMonths(pid, built + 1) + 1e-9 && built + 1 <= 3, `${id} project ${pid} progress ${p.progress} over ${levelMonths(pid, built + 1)} (level ${built + 1})`)
    }

    // Missiles: stock never negative, the program 0-3, and a month's building within its capacity.
    for (const [k, v] of Object.entries(n.arsenal ?? {})) check(real(v) && v >= -1e-9, `${id} arsenal ${k} ${v}`)
    const level = n.missileProgram ?? 0
    check(Number.isInteger(level) && level >= 0 && level <= MISSILE_PROGRAM.maxLevel, `${id} missile program ${level}`)
    if (n.missileBuilt) check(Number.isInteger(n.missileBuilt.count) && n.missileBuilt.count >= 0 && n.missileBuilt.count <= MISSILE_PROGRAM.capacity[Math.max(0, Math.min(3, level))], `${id} built ${n.missileBuilt.count} in a month at program level ${level}`)
  }

  for (const r of Object.values(s.regions)) {
    check(real(r.population) && r.population > 0, `${r.id} population ${r.population}`)
    check(real(r.line) && r.line >= 0, `${r.id} line ${r.line}`)
    check(real(r.rebels) && r.rebels >= 0, `${r.id} rebels ${r.rebels}`)
    check(real(r.integration) && r.integration >= 0 && r.integration <= 1 + 1e-9, `${r.id} integration ${r.integration}`)
    check(Number.isInteger(r.sabotaged) && r.sabotaged >= 0, `${r.id} sabotaged ${r.sabotaged}`)
    for (const [k, v] of Object.entries(r.buildings)) check(Number.isInteger(v) && v >= 0, `${r.id} building ${k} ${v}`)
    for (const lid of LOCAL_IDS) {
      const p = r.works?.[lid]
      if (!p) continue
      const built = p.level ?? (p.done ? 1 : 0)
      check(built >= 0 && built <= 3, `${r.id} works ${lid} level ${built}`)
      check(real(p.progress) && p.progress >= 0, `${r.id} works ${lid} progress ${p.progress}`)
      if (!p.done) check(p.progress <= localMonths(lid, built + 1) + 1e-9 && built + 1 <= 3, `${r.id} works ${lid} progress ${p.progress}`)
    }
  }
  return bad
}

/** Every new number stays in its range and is a real number. */
export function checkInvariants(s: GameState) {
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
    const p = n.people
    const sum = SKILL_KEYS.reduce((a, k) => a + p.skills[k], 0)
    expect(sum, n.id).toBeCloseTo(1, 5)
    for (const k of SKILL_KEYS) expect(p.skills[k] >= 0 && Number.isFinite(p.skills[k]), `${n.id} ${k}`).toBe(true)
    expect(p.schooling >= 0 && p.schooling <= 0.98, `${n.id} schooling ${p.schooling}`).toBe(true)
    expect(p.health >= 0 && p.health <= 0.98, `${n.id} health`).toBe(true)
    expect(p.unemployment >= 0.01 - 1e-9 && p.unemployment <= 0.45 + 1e-9, `${n.id} unemployment ${p.unemployment}`).toBe(true)
    expect(n.bank.inflation >= -5 && n.bank.inflation <= 60, `${n.id} inflation`).toBe(true)
    expect(n.bank.currency >= 0.6 - 1e-9 && n.bank.currency <= 1.6 + 1e-9, `${n.id} currency`).toBe(true)
    expect(n.bank.fund >= 0, `${n.id} fund`).toBe(true)
    expect(Math.abs(n.debt - n.bonds.reduce((a, b) => a + b.amount, 0)) < 1e-6, `${n.id} debt`).toBe(true)
    expect(Number.isFinite(n.resources.capital), `${n.id} money`).toBe(true)
    expect(n.tier >= 1 && n.tier <= 5, `${n.id} tier`).toBe(true)
  }
  expect(invariantProblems(s)).toEqual([])
}
