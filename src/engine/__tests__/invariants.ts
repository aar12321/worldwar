import { expect } from 'vitest'
import type { GameState } from '../types'
import { SKILL_KEYS } from '../types'

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
}
