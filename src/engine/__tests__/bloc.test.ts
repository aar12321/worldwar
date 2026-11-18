import { describe, expect, it } from 'vitest'
import { BLOC } from '../../data/blocs'
import { blocOf, forecastOp, goalChoices, goalProgress, levelOf, migrateBlocs } from '../bloc'
import { shieldFactor } from '../blocCombat'
import { factionOf } from '../factions'
import { pairKey, totalUnits } from '../helpers'
import { advanceDay, startLive } from '../live'
import { normalizeGame } from '../migrate'
import { validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { UNIT_TYPES } from '../types'
import { giveRegions } from './fixtures'
import { bad, map, ok, setup, unitsOf, world } from './blocFixtures'

describe('a bloc is founded with its layer, and the old pool is closed', () => {
  it('a new faction carries a fresh bloc; pooling and voting are refused with the new way to do it', () => {
    const { s, f } = setup()
    expect(f().bloc).toEqual({ xp: 0, roles: {}, done: 0, failed: 0, calls: [], ops: [], record: {} })
    expect(bad(s, { type: 'factionContribute', nationId: 'r0', gift: { stock: { money: 10 } } })).toMatch(/pledge/)
    expect(bad(s, { type: 'factionWithdraw', nationId: 'r0', gift: { stock: { money: 10 } } })).toMatch(/shared back/)
    expect(bad(s, { type: 'factionPropose', nationId: 'r0', proposal: { kind: 'war', target: 'r5' } })).toMatch(/call/)
  })

  it('with the layer switched off a faction is the old one, with no bloc', () => {
    BLOC.on = false
    try {
      const s = world()
      ok(s, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
      expect(factionOf(s, 'r0')!.bloc).toBeUndefined()
      expect(bad(s, { type: 'factionContribute', nationId: 'r0', gift: { stock: { money: 10 } } })).toBeNull()
      expect(bad(s, { type: 'blocChat', nationId: 'r0', text: 'hi' })).toMatch(/switched off/)
    } finally {
      BLOC.on = true
    }
  })
})

describe('operations', () => {
  it('planning: needs an enemy a member can reach, a D-Day in range, and at most two at once; costs influence', () => {
    const { s, f } = setup()
    expect(bad(s, { type: 'blocPlan', nationId: 'r0', target: 'r6', when: 1 })).toMatch(/No member is at war/)
    expect(bad(s, { type: 'blocPlan', nationId: 'r0', target: 'r0', when: 1 })).toMatch(/A member holds it/)
    expect(bad(s, { type: 'blocPlan', nationId: 'r0', target: 'r3', when: 1 })).toMatch(/reach/)
    expect(bad(s, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 0 })).toMatch(/1 to 3 months/)
    expect(bad(s, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 4 })).toMatch(/1 to 3 months/)
    const pp = s.nations.r0.resources.pp
    ok(s, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 1 })
    expect(s.nations.r0.resources.pp).toBe(pp - BLOC.planInfluence)
    expect(bad(s, { type: 'blocPlan', nationId: 'r1', target: 'r2', when: 1 })).toMatch(/already targets/)
    const op = blocOf(f()).ops[0]
    expect(op).toMatchObject({ by: 'r0', target: 'r2', enemy: 'r2', status: 'planned', dday: s.turn + 1 })
    // A third operation is refused while two are open (the second here is queued in the same month).
    const queued: Order = { type: 'blocPlan', nationId: 'r1', target: 'r2', when: 2 }
    blocOf(f()).ops[0].target = 'r9'
    expect(validateOrder(s, map, { type: 'blocPlan', nationId: 'r1', target: 'r2', when: 2 }, [queued])).toMatch(/2 operations at a time/)
  })

  it('pledging: from your own army, never more than you have; zero withdraws it; a non-member cannot', () => {
    const { s, f } = setup()
    ok(s, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 1 })
    const id = blocOf(f()).ops[0].id
    expect(bad(s, { type: 'blocCommit', nationId: 'r0', opId: id, units: { infantry: 11 } })).toMatch(/You have 10 infantry/)
    expect(bad(s, { type: 'blocCommit', nationId: 'r0', opId: id, units: { missile: 1 } as never })).toMatch(/Unknown/)
    expect(bad(s, { type: 'blocCommit', nationId: 'r0', opId: id, units: { infantry: -1 } })).toMatch(/Invalid/)
    expect(bad(s, { type: 'blocCommit', nationId: 'r6', opId: id, units: { infantry: 1 } })).toMatch(/not in a bloc/)
    ok(s, { type: 'blocCommit', nationId: 'r0', opId: id, units: { infantry: 6, armor: 2 } })
    expect(blocOf(f()).ops[0].pledges.r0).toEqual({ infantry: 6, armor: 2 })
    // Pledging moves nothing yet: the divisions stay home until D-Day.
    expect(s.nations.r0.military.units.infantry).toBe(10)
    ok(s, { type: 'blocCommit', nationId: 'r0', opId: id, units: {} })
    expect(blocOf(f()).ops[0].pledges.r0).toBeUndefined()
  })

  it('a turn game: on D-Day both members fight as one force over r1 border, with combined arms; what survives goes home by what each sent', () => {
    const { s: s0, f: f0 } = setup()
    ok(s0, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 1 })
    const id = blocOf(f0()).ops[0].id
    let s = resolveTurn(s0, map, [])
    // Not yet: D-Day is the end of next month.
    expect(blocOf(factionOf(s, 'r0')).ops[0].status).toBe('planned')
    const orders: Order[] = [
      { type: 'blocCommit', nationId: 'r0', opId: id, units: { infantry: 8, armor: 3 } },
      { type: 'blocCommit', nationId: 'r1', opId: id, units: { infantry: 6 } },
    ]
    const before = { r0: totalUnits(s.nations.r0.military.units), r1: totalUnits(s.nations.r1.military.units), r5: totalUnits(s.nations.r5.military.units) }
    const xp = blocOf(factionOf(s, 'r0')).xp
    s = resolveTurn(s, map, orders)
    const op = blocOf(factionOf(s, 'r0')).ops.find((o) => o.id === id)!
    expect(op.status).toBe('done')
    const r = op.result!
    expect(r.failed).toBeUndefined()
    expect(r.lead).toBe('r1')
    expect(Object.keys(r.members).sort()).toEqual(['r0', 'r1'])
    expect(r.members.r0.sent).toBeCloseTo(11)
    expect(r.members.r1.sent).toBeCloseTo(6)
    expect(r.bonus).toBeCloseTo(BLOC.perMember)
    const report = s.battles.find((b) => b.id === r.battleId)!
    expect(report.modifiers.join(' ')).toMatch(/Bloc operation of Iron Pact/)
    expect(report.modifiers.join(' ')).toMatch(/combined arms of the bloc \(\+8%\)/)
    // Each member is down by exactly what the report says it lost (nothing else touched the armies but the economy's training).
    for (const m of ['r0', 'r1'] as const) expect(before[m] - totalUnits(s.nations[m].military.units)).toBeCloseTo(r.members[m].lost, 5)
    expect(r.won).toBe(true)
    expect(r.captured).toBe(true)
    // The country goes to the member who sent the most.
    expect(r.owner).toBe('r0')
    expect(s.regions.r2.owner).toBe('r0')
    expect(blocOf(factionOf(s, 'r0')).xp).toBeGreaterThanOrEqual(xp + BLOC.opCapturePrestige)
    expect(factionOf(s, 'r0')!.history.some((h) => h.kind === 'op' && /OPERATION CAPTURED/.test(h.text))).toBe(true)
    expect(blocOf(factionOf(s, 'r0')).record.r0).toMatchObject({ ops: 1 })
  })

  it('a member not at war with the target is left out, and with nobody pledged the operation does not go ahead', () => {
    const { s: s0, f } = setup()
    ok(s0, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 1 })
    const id = blocOf(f()).ops[0].id
    s0.wars = s0.wars.filter((w) => w !== pairKey('r0', 'r2'))
    ok(s0, { type: 'blocCommit', nationId: 'r0', opId: id, units: { infantry: 5 } })
    const fc = forecastOp(s0, map, f(), blocOf(f()).ops[0])
    expect(fc.dropped.r0).toMatch(/not at war/)
    expect(fc.fighters).toEqual([])
    let s = resolveTurn(s0, map, [])
    s = resolveTurn(s, map, [])
    const op = blocOf(factionOf(s, 'r0')).ops.find((o) => o.id === id)!
    expect(op.result?.failed).toMatch(/nobody sent/)
    expect(s.nations.r0.military.units.infantry).toBeGreaterThanOrEqual(9.9)
  })

  it('combined arms is what the members bring: the bonus grows with fighters and the forecast shows it', () => {
    const { s, f } = setup()
    ok(s, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 1 })
    const op = blocOf(f()).ops[0]
    op.pledges = { r1: { infantry: 3 } }
    const one = forecastOp(s, map, f(), op)
    expect(one.bonus).toBe(0)
    op.pledges = { r1: { infantry: 3 }, r0: { infantry: 3 } }
    const two = forecastOp(s, map, f(), op)
    expect(two.bonus).toBeCloseTo(BLOC.perMember)
    expect(two.winChance).toBeGreaterThanOrEqual(one.winChance)
  })
})

describe('live operations march to arrive on D-Day', () => {
  it('sets out in time, arrives on D-Day, fights once and shares the survivors back', () => {
    const { s: s0, f: f0 } = setup()
    startLive(s0)
    ok(s0, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 10 })
    const op0 = blocOf(f0()).ops[0]
    expect(op0.dday).toBe(10)
    ok(s0, { type: 'blocCommit', nationId: 'r0', opId: op0.id, units: { infantry: 8, armor: 3 } })
    ok(s0, { type: 'blocCommit', nationId: 'r1', opId: op0.id, units: { infantry: 6, armor: 1 } })
    const total0 = unitsOf(s0, ['r0', 'r1'])
    let s = s0
    let launched: number | null = null
    let fought: number | null = null
    for (let d = 0; d < 20; d++) {
      const step = advanceDay(s, map)
      s = step.state
      for (const e of step.events) {
        if (e.kind === 'launched' && e.army.op) {
          launched = s.day!
          expect(Object.keys(e.army.op.from).sort()).toEqual(['r0', 'r1'])
          expect(e.army.end).toBe(op0.dday)
          // The divisions left both armies.
          expect(unitsOf(s, ['r0', 'r1']) + totalUnits(e.army.units)).toBeCloseTo(total0, 5)
        }
        if (e.kind === 'battle' && s.armies?.some((a) => a.id === e.armyId && a.op)) fought = s.day!
        if (e.kind === 'battle' && !s.armies?.some((a) => a.id === e.armyId) && e.destroyed) fought = s.day!
      }
    }
    expect(launched).not.toBeNull()
    expect(fought).toBe(10)
    const op = blocOf(factionOf(s, 'r0')).ops.find((o) => o.id === op0.id)!
    expect(op.status).toBe('done')
    expect(s.armies?.some((a) => a.op)).toBe(false)
    // Home again: each member has back what it sent less what the report says it lost.
    const lost = op.result!.members.r0.lost + op.result!.members.r1.lost
    expect(unitsOf(s, ['r0', 'r1'])).toBeCloseTo(total0 - lost, 5)
  })

  it('a bloc army cannot be recalled by one member', () => {
    const { s, f } = setup()
    startLive(s)
    ok(s, { type: 'blocPlan', nationId: 'r0', target: 'r2', when: 5 })
    ok(s, { type: 'blocCommit', nationId: 'r1', opId: blocOf(f()).ops[0].id, units: { infantry: 6 } })
    let g = s
    for (let d = 0; d < 4; d++) g = advanceDay(g, map).state
    const a = g.armies!.find((x) => x.op)!
    expect(a).toBeTruthy()
    expect(bad(g, { type: 'recall', nationId: a.nationId, armyId: a.id } as Order)).toMatch(/answers to the bloc/)
  })
})

describe('calls to arms', () => {
  it('a member that goes to war calls the others in; one click joins (a war of its own, prestige) or declines', () => {
    const { s: s0, f } = setup()
    s0.wars = s0.wars.filter((w) => w !== pairKey('r1', 'r2'))
    s0.warStarted[pairKey('r0', 'r2')] = s0.turn
    let s = resolveTurn(s0, map, [])
    const call = blocOf(factionOf(s, 'r0')).calls[0]
    expect(call).toMatchObject({ by: 'r0', target: 'r2', auto: true })
    expect(bad(s, { type: 'blocAnswer', nationId: 'r0', callId: call.id, join: true })).toMatch(/your own call/)
    const xp = blocOf(factionOf(s, 'r0')).xp
    s = resolveTurn(s, map, [{ type: 'blocAnswer', nationId: 'r1', callId: call.id, join: true }])
    expect(s.wars).toContain(pairKey('r1', 'r2'))
    expect(blocOf(factionOf(s, 'r0')).xp).toBe(xp + BLOC.joinPrestige)
    expect(blocOf(factionOf(s, 'r0')).record.r1.joined).toBe(1)
    expect(f().id).toBe(factionOf(s, 'r0')!.id)
  })

  it('only the leader calls, only against an enemy it is at war with, and once', () => {
    const { s } = setup()
    expect(bad(s, { type: 'blocCall', nationId: 'r1', target: 'r2' })).toMatch(/Only the leader/)
    expect(bad(s, { type: 'blocCall', nationId: 'r0', target: 'r6' })).toMatch(/Declare war/)
    expect(bad(s, { type: 'blocCall', nationId: 'r0', target: 'r2' })).toMatch(/Every member is already at war/)
    s.wars = s.wars.filter((w) => w !== pairKey('r1', 'r2'))
    ok(s, { type: 'blocCall', nationId: 'r0', target: 'r2' })
    expect(bad(s, { type: 'blocCall', nationId: 'r0', target: 'r2' })).toMatch(/already been called/)
  })

  it('Mutual Defence (level 4): a rival member joins the call at once', () => {
    const { s: s0 } = setup()
    s0.humans = ['r0']
    s0.nations.r1.isPlayer = false
    s0.wars = s0.wars.filter((w) => w !== pairKey('r1', 'r2'))
    blocOf(factionOf(s0, 'r0')).xp = BLOC.levels[3]
    const s = { ...s0 }
    ok(s, { type: 'blocCall', nationId: 'r0', target: 'r2' })
    expect(s.wars).toContain(pairKey('r1', 'r2'))
  })
})

describe('roles, perks, objectives', () => {
  it('a role is held by one member at a time and pays every month; the Shield defends harder', () => {
    const { s: s0 } = setup()
    ok(s0, { type: 'blocRole', nationId: 'r0', role: 'arsenal' })
    expect(bad(s0, { type: 'blocRole', nationId: 'r1', role: 'arsenal' })).toMatch(/already the Arsenal/)
    ok(s0, { type: 'blocRole', nationId: 'r1', role: 'shield' })
    expect(shieldFactor(s0, 'r1')).toBeCloseTo(1 + BLOC.shieldDefense)
    expect(shieldFactor(s0, 'r0')).toBe(1)
    const a = structuredClone(s0)
    delete factionOf(a, 'r0')!.bloc!.roles.r0
    const withRole = resolveTurn(s0, map, [])
    const without = resolveTurn(a, map, [])
    expect(withRole.nations.r0.resources.steel - without.nations.r0.resources.steel).toBeCloseTo(BLOC.roleIncome.arsenal.steel!, 5)
  })

  it('perks unlock with prestige: Common Market pays each member at level 2', () => {
    const { s: s0 } = setup()
    expect(levelOf(BLOC.levels[1])).toBe(2)
    const a = structuredClone(s0)
    blocOf(factionOf(a, 'r0')).xp = BLOC.levels[1]
    const lv2 = resolveTurn(a, map, [])
    const lv1 = resolveTurn(s0, map, [])
    expect(lv2.nations.r1.resources.capital - lv1.nations.r1.resources.capital).toBeCloseTo(Math.min(BLOC.market.max, BLOC.market.per), 5)
  })

  it('a season objective starts by itself; taking countries meets Take new ground: prestige and influence for all', () => {
    const { s: s0 } = setup()
    let s = resolveTurn(s0, map, [])
    const g = blocOf(factionOf(s, 'r0')).goal!
    expect(g.kind).toBe('conquer')
    expect(g.since).toBe(s.turn)
    // The leader can change it in the season's first month, to one on offer.
    expect(bad(s, { type: 'blocGoal', nationId: 'r1', goal: 'strike' })).toMatch(/Only the leader/)
    expect(bad(s, { type: 'blocGoal', nationId: 'r0', goal: 'grow' })).toMatch(/not on offer/)
    expect(bad(s, { type: 'blocGoal', nationId: 'r0', goal: 'strike' })).toBeNull()
    s.regions.r3.owner = 'r0'
    s.regions.r4.owner = 'r1'
    expect(goalProgress(s, factionOf(s, 'r0')!, g).met).toBe(true)
    const pp = s.nations.r1.resources.pp
    const xp = blocOf(factionOf(s, 'r0')).xp
    s = resolveTurn(s, map, [])
    const b = blocOf(factionOf(s, 'r0'))
    expect(b.done).toBe(1)
    expect(b.xp).toBe(xp + BLOC.goalPrestige)
    expect(s.nations.r1.resources.pp).toBeGreaterThanOrEqual(pp + BLOC.goalInfluence)
    expect(s.factions![0].history.some((h) => h.kind === 'goal' && /OBJECTIVE MET/.test(h.text))).toBe(true)
  })

  it('Defend a member fails the month that member loses a country', () => {
    const { s: s0 } = setup()
    giveRegions(s0, 'r0', ['r5'])
    s0.nations.r5.alive = true
    let s = resolveTurn(s0, map, [])
    const choice = goalChoices(s, factionOf(s, 'r0')!).find((c) => c.kind === 'defend')!
    expect(choice).toBeTruthy()
    s = resolveTurn(s, map, [{ type: 'blocGoal', nationId: 'r0', goal: 'defend', target: choice.target }])
    expect(blocOf(factionOf(s, 'r0')).goal).toMatchObject({ kind: 'defend', target: choice.target })
    expect(choice.target).toBe('r0')
    const lose = 'r5'
    s.regions[lose].owner = 'r2'
    s = resolveTurn(s, map, [])
    expect(blocOf(factionOf(s, 'r0')).failed).toBe(1)
  })
})

describe('the feed', () => {
  it('a message is trimmed and kept; an empty or long one is refused', () => {
    const { s, f } = setup()
    expect(bad(s, { type: 'blocChat', nationId: 'r0', text: '   ' })).toMatch(/Write/)
    expect(bad(s, { type: 'blocChat', nationId: 'r0', text: 'x'.repeat(BLOC.chatMax + 1) })).toMatch(/under/)
    ok(s, { type: 'blocChat', nationId: 'r1', text: '  hold   the   north  ' })
    expect(f().history.at(-1)).toMatchObject({ text: 'hold the north', by: 'r1', kind: 'chat' })
  })
})

describe('old saves', () => {
  it('a pool is shared back by the ledger, contracts return their collateral, votes are dropped; it runs once', () => {
    BLOC.on = false
    let s: GameState
    try {
      s = world()
      ok(s, { type: 'factionFound', nationId: 'r0', name: 'Old Pact' })
      ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
      const f = factionOf(s, 'r0')!
      if (!f.members.includes('r1')) ok(s, { type: 'factionJoin', nationId: 'r1', factionId: f.id })
      ok(s, { type: 'factionContribute', nationId: 'r0', gift: { stock: { money: 300, oil: 30 }, units: { infantry: 6 } } })
      ok(s, { type: 'factionContribute', nationId: 'r1', gift: { stock: { money: 100 }, units: { infantry: 2, armor: 2 } } })
    } finally {
      BLOC.on = true
    }
    const f = factionOf(s, 'r0')!
    f.contracts.push({ id: 'fc1', member: 'r1', supply: { oil: 5 }, pay: {}, start: 0, months: 6, collateral: 40, from: 1, until: 6, held: 40 })
    f.proposals.push({ id: 'fp1', kind: 'war', by: 'r0', created: 1, expires: 3, target: 'r5', votes: { r0: 'yes' } })
    const before = { r0: { ...s.nations.r0.resources }, r1: { ...s.nations.r1.resources }, u0: { ...s.nations.r0.military.units }, u1: { ...s.nations.r1.military.units } }
    const json = JSON.parse(JSON.stringify(s)) as GameState
    const g = normalizeGame(json, map)
    const nf = factionOf(g, 'r0')!
    expect(nf.bloc).toBeDefined()
    expect(g.nations.r0.resources.capital - before.r0.capital).toBeCloseTo(300, 5)
    expect(g.nations.r1.resources.capital - before.r1.capital).toBeCloseTo(100 + 40, 5)
    expect(g.nations.r0.resources.oil - before.r0.oil).toBeCloseTo(30, 5)
    expect(g.nations.r0.military.units.infantry - before.u0.infantry).toBeCloseTo(6, 5)
    expect(g.nations.r1.military.units.armor - before.u1.armor).toBeCloseTo(2, 5)
    expect(nf.pool.stock.money).toBe(0)
    expect(UNIT_TYPES.every((k) => nf.pool.units[k] === 0)).toBe(true)
    expect(nf.contracts).toEqual([])
    expect(nf.proposals).toEqual([])
    // A second load changes nothing.
    const again = normalizeGame(JSON.parse(JSON.stringify(g)), map)
    expect(again.nations.r0.resources.capital).toBe(g.nations.r0.resources.capital)
    expect(again.factions![0].history.length).toBe(g.factions![0].history.length)
    migrateBlocs(again)
    expect(again.nations.r1.military.units.armor).toBe(g.nations.r1.military.units.armor)
  })

  it('a damaged bloc in a save is reset, not left half there', () => {
    const { s } = setup()
    const json = JSON.parse(JSON.stringify(s)) as GameState
    ;(json.factions![0] as unknown as { bloc: unknown }).bloc = { xp: 'lots' }
    const g = normalizeGame(json, map)
    expect(g.factions![0].bloc).toEqual({ xp: 0, roles: {}, done: 0, failed: 0, calls: [], ops: [], record: {} })
  })
})
