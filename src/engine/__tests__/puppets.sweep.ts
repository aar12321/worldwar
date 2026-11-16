/**
 * Puppet sweep: twin worlds on the real map, bots in every seat (the master's included), and one extra step each month for the master:
 * a scripted way of ruling its puppet. NOT a test file (the name does not end in .test.ts), so the normal suite never runs it. See
 * docs/BALANCE.md, "Puppet states", for the numbers it produced and how to re-run it:
 *
 *   // src/engine/__tests__/x.scratch.test.ts   (delete it afterwards)
 *   import { it } from 'vitest'
 *   import { puppetSweep, printPuppetSweep } from './puppets.sweep'
 *   it('puppets', () => { printPuppetSweep(puppetSweep({ seeds: [11, 12, 13], months: 60 })) }, 3_600_000)
 */
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { computeEconomy } from '../economy'
import { empireCount } from '../empire'
import { validateOrder } from '../orders'
import { bindPuppet, extraction } from '../puppets'
import { resolveTurn } from '../resolveTurn'
import { transferRegion } from '../warfare'
import type { Difficulty, GameState, Order } from '../types'

export type Policy = 'none' | 'conquest' | 'default' | 'squeeze' | 'balanced' | 'invest'

export interface Row {
  policy: Policy
  seed: number
  /** Master's gross income a month at month 60, and its change against the twin with no puppet at all. */
  gross: number
  /** Money-equivalent of everything the puppet paid in, summed over the run. */
  tribute: number
  /** Loyalty at the end, or the month it broke free (negative). */
  loyalty: number
  freedMonth: number | null
  /** The puppet's land, as countries, and what the master's tier count made of it. */
  countries: number
  count: number
  /** Master's treasury plus debt at the end. */
  wealth: number
  influenceSpent: number
}

const MASTER = 'france'
const PUPPET = 'spain'

function script(s: GameState, policy: Policy, map: ReturnType<typeof getWorld>['map']): Order[] {
  const p = s.nations[PUPPET]
  if (!p?.alive || p.overlord !== MASTER) return []
  const t = { type: 'governPuppet' as const, nationId: MASTER, target: PUPPET }
  const one = (patch: Extract<Order, { type: 'governPuppet' }>['patch']): Order[] => {
    const o: Order = { ...t, patch }
    return validateOrder(s, map, o) === null ? [o] : []
  }
  if (policy === 'squeeze') {
    if (s.turn % 3 === 1) return one({ taxRate: 0.45, draftRate: 0.2, tribute: { form: 'money', share: 0.3 } })
    if (s.turn % 3 === 2) return one({ law: { id: 'conscription_act', on: true } })
  }
  if (policy === 'balanced') {
    if (s.turn % 4 === 1) return one({ taxRate: 0.25, tribute: { form: 'money', share: 0.2 } })
    if ((p.loyalty ?? 60) < 55 && s.turn % 4 === 3) return one({ aid: 80 })
  }
  if (policy === 'invest') {
    if (s.turn % 6 === 1) return one({ taxRate: 0.2, draftRate: 0.04, tribute: { form: 'money', share: 0.16 }, spending: { housing: 2 } })
    if ((p.loyalty ?? 60) < 70 && s.turn % 6 === 4) return one({ aid: 100 })
  }
  return []
}

function run(policy: Policy, seed: number, months: number, difficulty: Difficulty): Row {
  const { map } = getWorld()
  let s: GameState = createInitialState(map, { playerRegionId: MASTER, seed, difficulty, goal: 'classic', victoryShare: 2 })
  s.nextEventTurn = 99999
  if (policy === 'conquest') {
    for (const r of Object.values(s.regions).filter((x) => x.owner === PUPPET)) transferRegion(s, map, r.id, MASTER, false)
  } else if (policy !== 'none') bindPuppet(s, PUPPET, MASTER)
  let tribute = 0
  let freedMonth: number | null = null
  let influence = 0
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s.pendingEvent = null
    const rule = policy === 'none' || policy === 'conquest' ? [] : script(s, policy, map)
    const ppBefore = s.nations[MASTER].resources.pp
    if (s.nations[PUPPET]?.overlord === MASTER && s.nations[PUPPET].loyalty !== undefined) tribute += extraction(s, map, MASTER).total
    const orders = [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true), ...rule]
    s = resolveTurn(s, map, orders)
    void ppBefore
    influence += rule.length
    if (freedMonth === null && policy !== 'none' && policy !== 'conquest' && s.nations[PUPPET]?.overlord !== MASTER) freedMonth = i + 1
  }
  const m = s.nations[MASTER]
  const mine = Object.values(s.regions).filter((r) => r.owner === PUPPET).length
  return {
    policy,
    seed,
    gross: m.alive ? computeEconomy(s, map, MASTER).gross : 0,
    tribute,
    loyalty: s.nations[PUPPET]?.loyalty ?? -1,
    freedMonth,
    countries: mine,
    count: m.alive ? empireCount(s, MASTER) : 0,
    wealth: m.alive ? m.resources.capital - m.debt : 0,
    influenceSpent: influence,
  }
}

export function puppetSweep(opts: { seeds: number[]; months: number; difficulty?: Difficulty; policies?: Policy[] }): Row[] {
  const rows: Row[] = []
  for (const seed of opts.seeds) for (const policy of opts.policies ?? (['none', 'conquest', 'default', 'squeeze', 'balanced', 'invest'] as Policy[])) rows.push(run(policy, seed, opts.months, opts.difficulty ?? 'normal'))
  return rows
}

export function printPuppetSweep(rows: Row[]) {
  const by = new Map<Policy, Row[]>()
  for (const r of rows) by.set(r.policy, [...(by.get(r.policy) ?? []), r])
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const lines = ['policy | gross | tribute (sum) | loyalty | freed (runs) | count | wealth']
  for (const [policy, rs] of by)
    lines.push(
      `${policy} | ${mean(rs.map((r) => r.gross)).toFixed(0)} | ${mean(rs.map((r) => r.tribute)).toFixed(0)} | ${mean(rs.filter((r) => r.loyalty >= 0).map((r) => r.loyalty)).toFixed(0)} | ${rs.filter((r) => r.freedMonth !== null).length}/${rs.length} | ${mean(rs.map((r) => r.count)).toFixed(1)} | ${mean(rs.map((r) => r.wealth)).toFixed(0)}`,
    )
  console.log(lines.join('\n'))
  console.log(JSON.stringify(rows, null, 1))
}
