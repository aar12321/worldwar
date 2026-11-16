/**
 * Combat sweep: what wins against what, measured on the real `resolveBattle` with fixed dice. NOT a test file (the name does not end
 * in .test.ts), so the normal suite never runs it; `combatMatrix.test.ts` pins the rules it found. See docs/WAR_STATUS.md.
 *
 *   // src/engine/__tests__/x.scratch.test.ts   (delete it afterwards)
 *   import { it } from 'vitest'
 *   import { printMatrix, printCurve } from './combatMatrix.sweep'
 *   it('sweep', () => { printCurve(); printMatrix() }, 600_000)
 */
import { UNIT_SPECS } from '../../data/unitTypes'
import { resolveBattle, type Combatant } from '../combat'
import { emptyUnits, totalUnits } from '../helpers'
import { createRng } from '../rng'
import type { Terrain, UnitCounts, UnitType } from '../types'
import { UNIT_TYPES } from '../types'

export const units = (o: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...o })

const side = (u: Partial<UnitCounts>): Combatant => ({ units: units(u), mods: null, penalty: 1, penaltyNotes: [] })

export interface FightStats {
  win: number
  attLoss: number
  defLoss: number
  attLossFrac: number
  defLossFrac: number
}

/** Plays `a` against `d` on `terrain` many times on fixed dice. */
export function fight(a: Partial<UnitCounts>, d: Partial<UnitCounts>, terrain: Terrain = 'plains', runs = 200, coastal = false): FightStats {
  let win = 0
  let al = 0
  let dl = 0
  for (let i = 0; i < runs; i++) {
    const out = resolveBattle({ attacker: side(a), defender: side(d), terrain, coastal }, createRng(777, i))
    if (out.winner === 'attacker') win++
    al += totalUnits(out.attackerLosses)
    dl += totalUnits(out.defenderLosses)
  }
  const ta = Math.max(0.01, totalUnits(units(a)))
  const td = Math.max(0.01, totalUnits(units(d)))
  return { win: win / runs, attLoss: al / runs, defLoss: dl / runs, attLossFrac: al / runs / ta, defLossFrac: dl / runs / td }
}

/** The money one division of this kind costs to raise, counting steel at 1.8 (the market base) and a soldier at 0.12. */
export const costOf = (k: UnitType) => UNIT_SPECS[k].capitalCost + UNIT_SPECS[k].steel * 1.8 + UNIT_SPECS[k].manpowerCost * 0.12

/** A force of `k` that costs `budget`. */
export const worth = (k: UnitType, budget: number): Partial<UnitCounts> => ({ [k]: budget / costOf(k) })

/** The win chance as one side's size grows: how sharp is the step from sure loss to sure win? Infantry against ten defending infantry. */
export function winCurve(terrain: Terrain = 'plains'): { n: number; ratio: number; win: number }[] {
  const out: { n: number; ratio: number; win: number }[] = []
  for (let n = 6; n <= 26; n += 1) {
    const f = fight({ infantry: n }, { infantry: 10 }, terrain, 300)
    out.push({ n, ratio: n / 10, win: f.win })
  }
  return out
}

export function printCurve() {
  const rows = winCurve()
  console.log('attacking infantry vs 10 defending infantry (plains)\n' + rows.map((r) => `${String(r.n).padStart(3)} divisions  ${(r.win * 100).toFixed(0).padStart(4)}%`).join('\n'))
}

const KINDS: UnitType[] = ['infantry', 'armor', 'artillery', 'fighter', 'air', 'drone', 'robot']

/** Equal-money armies of one kind against each other, attacking on each terrain, and the real mixes against pure forces. */
export function matrix(budget = 300, terrain: Terrain = 'plains') {
  const rows: { a: string; d: string; win: number }[] = []
  for (const a of KINDS) for (const d of KINDS) rows.push({ a, d, win: fight(worth(a, budget), worth(d, budget), terrain, 100).win })
  return rows
}

export function printMatrix(budget = 300) {
  for (const terrain of ['plains', 'mountain', 'urban'] as Terrain[]) {
    const rows = matrix(budget, terrain)
    const head = '            ' + KINDS.map((k) => k.slice(0, 5).padStart(6)).join('')
    const lines = KINDS.map((a) => a.padEnd(12) + KINDS.map((d) => `${(rows.find((r) => r.a === a && r.d === d)!.win * 100).toFixed(0)}%`.padStart(6)).join(''))
    console.log(`equal money (${budget}), attacker rows vs defender columns, ${terrain}\n${head}\n${lines.join('\n')}`)
  }
  void UNIT_TYPES
}

const TERRAIN_LIST: Terrain[] = ['plains', 'forest', 'mountain', 'desert', 'urban']

/** A typical defending army and a typical attacking army, to measure single kinds against. */
export const STANDARD_DEFENCE: Partial<UnitCounts> = { infantry: 10, armor: 3, artillery: 2, fighter: 2 }
export const STANDARD_ATTACK: Partial<UnitCounts> = { infantry: 12, armor: 5, artillery: 3, fighter: 2, air: 2 }

/** Money a pure force of `kind` needs to win half its attacks against the standard defence (bisection on size). */
export function budgetToWin(kind: UnitType, terrain: Terrain, target = STANDARD_DEFENCE, runs = 120): number {
  let lo = 20
  let hi = 4000
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    if (fight(worth(kind, mid), target, terrain, runs, true).win >= 0.5) hi = mid
    else lo = mid
  }
  return Math.round(hi)
}

/** Money a pure force of `kind` needs to hold half the time against the standard attack. */
export function budgetToHold(kind: UnitType, terrain: Terrain, attack = STANDARD_ATTACK, runs = 120): number {
  let lo = 20
  let hi = 4000
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    if (1 - fight(attack, worth(kind, mid), terrain, runs, true).win >= 0.5) hi = mid
    else lo = mid
  }
  return Math.round(hi)
}

/** Recipes: the share of the money each kind gets. */
export const RECIPES: Record<string, Partial<Record<UnitType, number>>> = {
  'pure infantry': { infantry: 1 },
  'infantry + guns': { infantry: 0.7, artillery: 0.3 },
  'infantry + tanks': { infantry: 0.6, armor: 0.4 },
  'combined arms': { infantry: 0.4, armor: 0.3, air: 0.15, fighter: 0.15 },
  'armoured': { infantry: 0.2, armor: 0.5, air: 0.15, fighter: 0.15 },
  'air power': { infantry: 0.3, armor: 0.1, air: 0.35, fighter: 0.25 },
  'gunline': { infantry: 0.4, armor: 0.1, artillery: 0.35, fighter: 0.15 },
  'robots': { robot: 0.6, infantry: 0.2, armor: 0.1, fighter: 0.1 },
  'drone mix': { infantry: 0.5, drone: 0.3, armor: 0.1, fighter: 0.1 },
}

const mix = (recipe: Partial<Record<UnitType, number>>, budget: number): Partial<UnitCounts> => {
  const out: Partial<UnitCounts> = {}
  for (const [k, share] of Object.entries(recipe)) out[k as UnitType] = (budget * (share as number)) / costOf(k as UnitType)
  return out
}

/** Money a recipe needs to win half its attacks, against the standard defence on `terrain`. */
export function recipeToWin(recipe: Partial<Record<UnitType, number>>, terrain: Terrain, target = STANDARD_DEFENCE, runs = 120): number {
  let lo = 20
  let hi = 4000
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    if (fight(mix(recipe, mid), target, terrain, runs, true).win >= 0.5) hi = mid
    else lo = mid
  }
  return Math.round(hi)
}

export function printRecipes() {
  const head = 'money to win 50% vs standard defence'.padEnd(38) + TERRAIN_LIST.map((t) => t.padStart(9)).join('')
  console.log(head + '\n' + Object.entries(RECIPES).map(([name, r]) => name.padEnd(38) + TERRAIN_LIST.map((t) => String(recipeToWin(r, t)).padStart(9)).join('')).join('\n'))
}

export interface Efficiency {
  kind: UnitType
  terrain: Terrain
  attack: number
  defence: number
}

/** The cost-efficiency table: lower is better. A kind that is far lower than the rest everywhere dominates; far higher everywhere is dominated. */
export function efficiencyTable(kinds: UnitType[] = ['infantry', 'armor', 'artillery', 'fighter', 'air', 'drone', 'robot']): Efficiency[] {
  const out: Efficiency[] = []
  for (const kind of kinds) for (const terrain of TERRAIN_LIST) out.push({ kind, terrain, attack: budgetToWin(kind, terrain), defence: budgetToHold(kind, terrain) })
  return out
}

export function printEfficiency() {
  const rows = efficiencyTable()
  for (const what of ['attack', 'defence'] as const) {
    const head = `money to ${what === 'attack' ? 'win' : 'hold'} 50%`.padEnd(24) + TERRAIN_LIST.map((t) => t.padStart(9)).join('')
    const lines = [...new Set(rows.map((r) => r.kind))].map((k) => `${what} ${k}`.padEnd(24) + TERRAIN_LIST.map((t) => String(rows.find((r) => r.kind === k && r.terrain === t)![what]).padStart(9)).join(''))
    console.log(`${head}\n${lines.join('\n')}`)
  }
}
