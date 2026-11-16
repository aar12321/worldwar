import { LIVE } from '../data/live'
import { UNIT_SPECS } from '../data/unitTypes'
import { COMMITS, WAR } from '../data/war'
import { freeUnits } from './deployment'
import { emptyUnits, totalUnits } from './helpers'
import type { GameState, NationId, Order, UnitCounts, UnitType } from './types'
import { UNIT_TYPES } from './types'

/**
 * Choosing an attack force unit by unit. Everything about "how many of what can I send" lives here, so the order check, the fight,
 * the live army, the forecast and the War Room all read the same numbers.
 *
 * The rules:
 * - Only the reserve can be sent: forces on station (patrols, screens, garrisons) are not in the pool.
 * - Missiles are never part of `units`: they are fired by name (`missiles`) and used up.
 * - In a turn game the soldiers stay in the military after an attack (only their losses leave), so a unit sent by name is spent for the
 *   month: it cannot be sent again until the turn ends. A live army physically leaves, and a guard (LIVE.homeGuard) always stays home.
 * - A unit queued in an earlier order this month is spoken for, too.
 */

export type AttackOrder = Extract<Order, { type: 'attack' }>

/** The kinds of unit that can be chosen one by one (every kind but missiles). */
export const SENDABLE: UnitType[] = UNIT_TYPES.filter((k) => k !== 'missile')

const tenth = (v: number) => Math.floor(v * 10 + 1e-9) / 10

/** A tidy copy of a chosen force: only the sendable kinds, rounded down to a tenth of a division, nothing below it. */
export function cleanUnits(units: Partial<UnitCounts> | undefined): UnitCounts {
  const out = emptyUnits()
  if (!units) return out
  for (const k of SENDABLE) {
    const v = Number(units[k] ?? 0)
    if (Number.isFinite(v) && v > 0) out[k] = tenth(v)
  }
  return out
}

/** Only the kinds that are actually sent, as an order carries them. */
export function compactUnits(units: Partial<UnitCounts>): Partial<UnitCounts> {
  const c = cleanUnits(units)
  const out: Partial<UnitCounts> = {}
  for (const k of SENDABLE) if (c[k] > 0) out[k] = c[k]
  return out
}

/** The share of the reserve an attack sending `units` is: what it leaves behind as exposure, and what the battle report names. */
export function shareOf(units: UnitCounts, pool: UnitCounts): number {
  return Math.min(1, totalUnits(units) / Math.max(0.1, totalUnits(pool)))
}

/**
 * The divisions of each kind a new attack could send right now, after forces on station, what this month's earlier attacks spent and
 * the orders already queued. In a live game the home guard stays back.
 */
export function attackPool(s: GameState, nationId: NationId, pending: Order[] = [], live = false): UnitCounts {
  const n = s.nations[nationId]
  if (!n) return emptyUnits()
  const free = freeUnits(s, nationId)
  const sent = n.military.sent
  // A share-sized attack this month (the presets) spent part of everyone; a named one spent exactly what it named.
  const byShare = Math.max(0, Math.min(1, n.military.exposed - (sent ? totalUnits(sent) / Math.max(0.1, totalUnits(free)) : 0)))
  const keep = live ? 1 - LIVE.homeGuard : 1 - byShare
  const out = emptyUnits()
  for (const k of SENDABLE) out[k] = free[k] * keep - (sent?.[k] ?? 0)
  for (const p of pending) {
    if (p.type !== 'attack' || p.nationId !== nationId) continue
    if (p.units) {
      const u = cleanUnits(p.units)
      for (const k of SENDABLE) out[k] -= u[k]
    } else {
      const share = Math.min(1, p.share ?? COMMITS[p.commit ?? 'main'].share)
      for (const k of SENDABLE) out[k] -= free[k] * share
    }
  }
  for (const k of SENDABLE) out[k] = Math.max(0, tenth(out[k]))
  return out
}

/** Why a named force cannot be sent, in words a player can act on, or null when it can. */
export function unitsProblem(s: GameState, o: AttackOrder, pending: Order[], live: boolean): string | null {
  const raw = o.units
  if (!raw || typeof raw !== 'object') return 'Choose the units to send'
  for (const k of Object.keys(raw)) {
    if (k === 'missile') {
      if (Number(raw.missile ?? 0) > 0) return 'Missiles are fired separately: set how many in the missile box'
      continue
    }
    if (!SENDABLE.includes(k as UnitType)) return `Unknown unit: ${k}`
  }
  for (const k of SENDABLE) {
    const v = raw[k]
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 'Every unit count must be a positive number'
  }
  const units = cleanUnits(raw)
  const total = totalUnits(units)
  if (total < WAR.minForce) return `Send at least ${WAR.minForce} of a division`
  const pool = attackPool(s, o.nationId, pending.filter((p) => p !== o), live)
  for (const k of SENDABLE) {
    if (units[k] > pool[k] + 1e-9) {
      const name = UNIT_SPECS[k].name.toLowerCase()
      return pool[k] <= 0 ? `You have no ${name} free to send` : `You only have ${pool[k]} ${name} free to send`
    }
  }
  return null
}

export interface DeployBill {
  /** Money a month the force costs to keep. It is paid whether the force fights or stays home: this shows how much of the bill is out there. */
  upkeep: number
  oil: number
  food: number
  divisions: number
}

export function deployBill(units: UnitCounts): DeployBill {
  let upkeep = 0
  let oil = 0
  let food = 0
  for (const k of UNIT_TYPES) {
    const v = units[k] ?? 0
    upkeep += v * UNIT_SPECS[k].upkeep
    oil += v * UNIT_SPECS[k].oil
    food += v * UNIT_SPECS[k].food
  }
  return { upkeep, oil, food, divisions: totalUnits(units) }
}

/** What stays at home when `units` leave: the military's units less what is sent. Forces on station stay where they are. */
export function remainder(s: GameState, nationId: NationId, units: UnitCounts): UnitCounts {
  const home = s.nations[nationId]?.military.units ?? emptyUnits()
  const out = emptyUnits()
  for (const k of UNIT_TYPES) out[k] = Math.max(0, home[k] - (units[k] ?? 0))
  return out
}

/** What a unit of each kind is worth to raise, in infantry divisions (money, steel at the market's base price, and soldiers). The planner uses it so a tank is not thrown away as freely as a rifleman. */
const raise = (k: UnitType) => UNIT_SPECS[k].capitalCost + UNIT_SPECS[k].steel * 1.8 + UNIT_SPECS[k].manpowerCost * 0.12
export function worthOf(units: Partial<UnitCounts>): number {
  let sum = 0
  for (const k of UNIT_TYPES) sum += (units[k] ?? 0) * raise(k)
  return sum / raise('infantry')
}

/** The units that share `f` of every free kind sends, in whole divisions (tenths when less than one is free). */
export function shareOfPool(pool: UnitCounts, f: number): UnitCounts {
  const out = { ...pool }
  // Whole divisions when a kind has one or more free, tenths below that: a stepper moves in ones, so the quick buttons land on its steps.
  const part = (v: number) => (v >= 1 ? Math.min(Math.floor(v + 1e-9), Math.round(v * f + 1e-9)) : tenth(v * f))
  for (const k of SENDABLE) out[k] = f >= 1 ? (pool[k] >= 1 ? Math.floor(pool[k] + 1e-9) : tenth(pool[k])) : part(pool[k])
  out.missile = 0
  return out
}
