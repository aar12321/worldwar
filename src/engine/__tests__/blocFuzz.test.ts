import { describe, expect, it } from 'vitest'
import { BLOC } from '../../data/blocs'
import { blocOf } from '../bloc'
import { factionOf } from '../factions'
import { pairKey, totalUnits } from '../helpers'
import { advanceDay, startLive } from '../live'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { createRng } from '../rng'
import type { GameState, NationId, Order } from '../types'
import { UNIT_TYPES } from '../types'
import { map, setup } from './blocFixtures'

/** Random sequences of bloc orders, good and bad, in turn and live games: nothing throws, nothing goes negative, the rules hold. */

const MEMBERS: NationId[] = ['r0', 'r1', 'r5', 'r6']
const ROLES = ['arsenal', 'shield', 'breadbasket', 'spymaster', null, 'king'] as const
const GOALS = ['conquer', 'hold', 'arsenal', 'strike', 'grow', 'defend', 'outmatch', 'nonsense'] as const

function randomOrder(s: GameState, rng: ReturnType<typeof createRng>): Order {
  const who = MEMBERS[rng.int(0, MEMBERS.length - 1)]
  const f = factionOf(s, 'r0')
  const ops = f ? blocOf(f).ops : []
  const calls = f ? blocOf(f).calls : []
  const opId = ops.length && rng.chance(0.85) ? ops[rng.int(0, ops.length - 1)].id : 'op-missing'
  const target = `r${rng.int(0, 7)}`
  switch (rng.int(0, 7)) {
    case 0:
      return { type: 'blocRole', nationId: who, role: ROLES[rng.int(0, ROLES.length - 1)] as never }
    case 1:
      return { type: 'blocGoal', nationId: who, goal: GOALS[rng.int(0, GOALS.length - 1)] as never, ...(rng.chance(0.5) ? { target: MEMBERS[rng.int(0, 3)] } : {}) }
    case 2:
      return { type: 'blocCall', nationId: who, target }
    case 3:
      return { type: 'blocAnswer', nationId: who, callId: calls.length ? calls[rng.int(0, calls.length - 1)].id : 'bc0', join: rng.chance(0.6) }
    case 4:
      return { type: 'blocPlan', nationId: who, target, when: rng.int(-1, 50) }
    case 5: {
      const units: Record<string, number> = {}
      for (const k of ['infantry', 'armor', 'artillery', 'missile', 'bogus']) if (rng.chance(0.5)) units[k] = rng.chance(0.1) ? -3 : rng.chance(0.05) ? Number.NaN : rng.range(0, 14)
      return { type: 'blocCommit', nationId: who, opId, units }
    }
    case 6:
      return { type: 'blocCancel', nationId: who, opId }
    default:
      return { type: 'blocChat', nationId: who, text: rng.chance(0.1) ? '' : 'x'.repeat(rng.int(1, 200)) }
  }
}

function check(s: GameState, label: string) {
  for (const n of Object.values(s.nations)) for (const k of UNIT_TYPES) expect(Number.isFinite(n.military.units[k]) && n.military.units[k] >= -1e-9, `${label}: ${n.id} ${k} ${n.military.units[k]}`).toBe(true)
  for (const a of s.armies ?? []) for (const k of UNIT_TYPES) expect(Number.isFinite(a.units[k]) && a.units[k] >= -1e-9, `${label}: army ${a.id}`).toBe(true)
  for (const f of s.factions ?? []) {
    const b = f.bloc
    if (!b) continue
    const roles = Object.entries(b.roles).filter(([m]) => f.members.includes(m)).map(([, r]) => r)
    expect(new Set(roles).size, `${label}: roles unique`).toBe(roles.length)
    expect(b.ops.filter((o) => o.status === 'planned' || o.status === 'marching').length, `${label}: open operations`).toBeLessThanOrEqual(BLOC.maxOps)
    for (const o of b.ops) for (const m of Object.keys(o.pledges)) expect(f.members.includes(m), `${label}: pledge by a non-member`).toBe(true)
    expect(Number.isFinite(b.xp) && b.xp >= 0).toBe(true)
    expect(f.history.length).toBeLessThanOrEqual(Math.max(BLOC.feedMax, 40))
  }
}

function fourMembers(): GameState {
  const { s } = setup()
  const fid = factionOf(s, 'r0')!.id
  for (const m of ['r5', 'r6']) {
    const f = factionOf(s, 'r0')!
    f.members.push(m)
    f.ledger[m] = { stock: { money: 0, oil: 0, steel: 0, goods: 0, food: 0 }, units: { infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }, last: 0, joined: 0 }
    expect(f.id).toBe(fid)
  }
  s.wars.push(pairKey('r5', 'r2'))
  s.wars.sort()
  return s
}

describe('bloc fuzz', () => {
  it('turn games: 6 seeds x 120 random orders and 12 months; bloc orders alone never move a division', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = createRng(seed, 4242)
      let s = fourMembers()
      for (let i = 0; i < 120; i++) {
        const o = randomOrder(s, rng)
        const before = UNIT_TYPES.map((k) => MEMBERS.reduce((a, m) => a + s.nations[m].military.units[k], 0))
        const r = applyOrderNow(s, map, o)
        const after = UNIT_TYPES.map((k) => MEMBERS.reduce((a, m) => a + s.nations[m].military.units[k], 0))
        // Pledges, plans, calls and roles never move divisions by themselves (a joined war does not either).
        expect(after, `${seed}/${i} ${JSON.stringify(o)} ${r.error}`).toEqual(before)
        check(s, `seed ${seed} order ${i}`)
        if (i % 10 === 9) {
          s = resolveTurn(s, map, [randomOrder(s, rng), randomOrder(s, rng)])
          check(s, `seed ${seed} month ${i}`)
        }
      }
    }
  })

  it('live games: random orders between random days; the armies of operations always come home or are lost, never doubled', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const rng = createRng(seed, 777)
      let s = fourMembers()
      startLive(s)
      for (let i = 0; i < 90; i++) {
        applyOrderNow(s, map, randomOrder(s, rng))
        check(s, `live ${seed} order ${i}`)
        const days = rng.int(0, 4)
        for (let d = 0; d < days; d++) s = advanceDay(s, map).state
        check(s, `live ${seed} day ${i}`)
        // Divisions of the members, at home and on the march, never exceed what they had plus what training adds (bounded here).
        const total = MEMBERS.reduce((a, m) => a + totalUnits(s.nations[m].military.units), 0) + (s.armies ?? []).filter((a) => a.op).reduce((a, x) => a + totalUnits(x.units), 0)
        expect(total).toBeLessThan(4 * 14 + 40)
      }
    }
  })
})
