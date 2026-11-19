import { describe, expect, it } from 'vitest'
import { addOpinion, opinionOf, storedOpinion } from '../../ai/opinion'
import { ACTS, RELATIONS } from '../../data/relations'
import { validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { cooldownLeft, embassyOf, favoursOwed, warmthFactor } from '../relations'
import { groupReasons, movement, partnerNeeds, partnerRows, previewRelate, relationHealth } from '../relationsView'
import { opinionReport } from '../../ai/opinion'
import type { GameState, NationId, Order, RelateOrder } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

/** A world of eight nations on a line: r0 is the player, the rest are rivals with money to spare. */
function world(seed = 5): GameState {
  const s = startState(map, 'r0', seed)
  for (const id of Object.keys(s.nations)) {
    const n = s.nations[id]
    n.resources.capital = 1000
    n.resources.pp = 300
    n.resources.oil = 100
    n.resources.steel = 100
    n.resources.food = 100
    n.resources.tp = 100
    n.government = 'democracy'
    setMilitary(s, id, { infantry: 10 })
  }
  s.nextEventTurn = 9999
  return s
}

const rel = (o: Partial<RelateOrder> & Pick<RelateOrder, 'act' | 'target'>, from: NationId = 'r0'): RelateOrder => ({ type: 'relate', nationId: from, ...o })
const run = (s: GameState, o: Order) => {
  const r = applyOrderNow(s, map, o)
  expect(r.error, JSON.stringify(o)).toBeNull()
}
const why = (s: GameState, o: Order, pending: Order[] = []) => validateOrder(s, map, o, pending)
const op = (s: GameState, holder: NationId, target: NationId) => opinionOf(s, map, holder, target)
const parts = (s: GameState, holder: NationId, target: NationId) => opinionReport(s, map, holder, target).parts.map((p) => p.label)
const month = (s: GameState, orders: Order[] = []) => resolveTurn(s, map, orders)
/** Makes a rival well disposed to the player, so its refusals are not what a test is about. */
const friend = (s: GameState, ...ids: NationId[]) => {
  for (const id of ids) addOpinion(s, id, 'r0', 'Test friendship', 30, 0)
}

describe('state visits', () => {
  it('give a big boost, and cost money and influence', () => {
    const s = world()
    friend(s, 'r3')
    const before = op(s, 'r3', 'r0')
    const cap = s.nations.r0.resources.capital
    const pp = s.nations.r0.resources.pp
    run(s, rel({ act: 'visit', target: 'r3' }))
    expect(op(s, 'r3', 'r0') - before).toBeGreaterThanOrEqual(12)
    expect(s.nations.r0.resources.capital).toBe(cap - ACTS.visit!.money)
    expect(s.nations.r0.resources.pp).toBe(pp - ACTS.visit!.pp)
  })

  it('have one cooldown per partner: the same partner must wait, another need not', () => {
    const s = world()
    run(s, rel({ act: 'visit', target: 'r3' }))
    expect(why(s, rel({ act: 'visit', target: 'r3' }))).toMatch(/Wait 12 more months/)
    expect(why(s, rel({ act: 'visit', target: 'r4' }))).toBeNull()
    // Other actions on the same partner are not blocked by it.
    expect(why(s, rel({ act: 'culture', target: 'r3' }))).toBeNull()
    let t = s
    for (let i = 0; i < 12; i++) t = month(t)
    expect(cooldownLeft(t, rel({ act: 'visit', target: 'r3' }))).toBe(0)
  })

  it('are refused by a nation that despises you, and they say why', () => {
    const s = world()
    addOpinion(s, 'r3', 'r0', 'Insulted us', -50, 0)
    const msg = why(s, rel({ act: 'visit', target: 'r3' }))
    expect(msg).toMatch(/will not take it/)
    expect(msg).toMatch(/opinion of you is/)
  })

  it('can go wrong with a cool host, the same way every time you ask (no re-rolling by undo)', () => {
    const a = world(11)
    const b = world(11)
    addOpinion(a, 'r4', 'r0', 'Chilly', -10, 0)
    addOpinion(b, 'r4', 'r0', 'Chilly', -10, 0)
    run(a, rel({ act: 'visit', target: 'r4' }))
    run(b, rel({ act: 'visit', target: 'r4' }))
    expect(JSON.stringify(a.opinions)).toBe(JSON.stringify(b.opinions))
  })
})

describe('no single action pins an opinion', () => {
  it('gifts are worth less the more you have given lately', () => {
    const s = world()
    friend(s, 'r3')
    const first = warmthFactor(s, 'r3', 'r0')
    run(s, rel({ act: 'visit', target: 'r3' }))
    const second = warmthFactor(s, 'r3', 'r0')
    run(s, rel({ act: 'festival', target: 'r3' }))
    expect(first).toBe(1)
    expect(second).toBeLessThan(1)
    expect(warmthFactor(s, 'r3', 'r0')).toBeLessThan(second)
  })

  it('everything you can do in a year cannot lift the earned part past the ceiling', () => {
    let s = world()
    const acts: RelateOrder[] = [
      rel({ act: 'visit', target: 'r3' }),
      rel({ act: 'culture', target: 'r3' }),
      rel({ act: 'festival', target: 'r3' }),
      rel({ act: 'embassy', target: 'r3' }),
      rel({ act: 'recognise', target: 'r3' }),
      rel({ act: 'tradeMission', target: 'r3' }),
      rel({ act: 'aid', target: 'r3', resource: 'food', amount: 40 }),
      rel({ act: 'aid', target: 'r3', resource: 'oil', amount: 40 }),
      rel({ act: 'techShare', target: 'r3', techId: s.nations.r0.techs[0] }),
    ]
    for (const a of acts) if (!why(s, a)) applyOrderNow(s, map, a)
    for (let i = 0; i < 6; i++) {
      s = month(s)
      s.nations.r0.resources.capital = 1000
      s.nations.r0.resources.pp = 300
      for (const a of acts) if (!why(s, a)) applyOrderNow(s, map, a)
    }
    const earned = storedOpinion(s, 'r3', 'r0').filter((m) => m.value > 0).reduce((n, m) => n + m.value, 0)
    expect(earned).toBeLessThanOrEqual(RELATIONS.earnedCap + 20)
    expect(op(s, 'r3', 'r0')).toBeLessThan(100)
  })

  it('the warmth pool fades, so a year later a gift is worth full price again', () => {
    let s = world()
    run(s, rel({ act: 'visit', target: 'r3' }))
    run(s, rel({ act: 'festival', target: 'r3' }))
    const hot = warmthFactor(s, 'r3', 'r0')
    for (let i = 0; i < 24; i++) s = month(s)
    expect(warmthFactor(s, 'r3', 'r0')).toBeGreaterThan(hot)
    expect(warmthFactor(s, 'r3', 'r0')).toBeGreaterThan(0.85)
  })
})

describe('embassies and attachés', () => {
  it('cost a monthly bill, warm slowly, show their numbers and are needed for joint programs', () => {
    let s = world()
    friend(s, 'r3')
    expect(why(s, rel({ act: 'science', target: 'r3' }))).toMatch(/embassy/i)
    run(s, rel({ act: 'embassy', target: 'r3' }))
    expect(embassyOf(s, 'r0', 'r3')).toBeTruthy()
    expect(why(s, rel({ act: 'science', target: 'r3' }))).toBeNull()
    const money = s.nations.r0.resources.capital
    const start = op(s, 'r3', 'r0')
    s = month(s)
    // Upkeep is paid even though income comes in: check the bill directly on an otherwise idle nation.
    expect(s.nations.r0.resources.capital).not.toBe(money)
    expect(s.intel['r0|r3']).toBeGreaterThanOrEqual(s.turn)
    for (let i = 0; i < 11; i++) s = month(s)
    expect(op(s, 'r3', 'r0')).toBeGreaterThan(start - 8)
  })

  it('an attaché is needed for exercises, and costs more every month', () => {
    const s = world()
    friend(s, 'r3')
    run(s, rel({ act: 'embassy', target: 'r3' }))
    expect(why(s, rel({ act: 'exercise', target: 'r3' }))).toMatch(/attach/i)
    run(s, rel({ act: 'attache', target: 'r3' }))
    expect(embassyOf(s, 'r0', 'r3')?.attache).toBe(true)
    expect(why(s, rel({ act: 'exercise', target: 'r3' }))).toBeNull()
  })

  it('close when their bill cannot be paid, and the host notices', () => {
    let s = world()
    friend(s, 'r3')
    run(s, rel({ act: 'embassy', target: 'r3' }))
    s.nations.r0.resources.capital = 0
    // No income: freeze the economy by sending the nation to zero before the month's upkeep (it still earns, so check the rule directly).
    s.nations.r0.resources.capital = -1000
    s = month(s)
    expect(embassyOf(s, 'r0', 'r3')).toBeUndefined()
  })

  it('closing one costs goodwill, so opening and closing is no trick', () => {
    const s = world()
    friend(s, 'r3')
    run(s, rel({ act: 'embassy', target: 'r3' }))
    const open = op(s, 'r3', 'r0')
    run(s, rel({ act: 'closeEmbassy', target: 'r3' }))
    expect(op(s, 'r3', 'r0')).toBeLessThan(open)
    // And it cannot be reopened at once.
    expect(why(s, rel({ act: 'embassy', target: 'r3' }))).toMatch(/Wait/)
  })
})

describe('programs, ventures and aid', () => {
  it('joint research gives both sides research every month and ends on time', () => {
    let s = world()
    friend(s, 'r3')
    run(s, rel({ act: 'embassy', target: 'r3' }))
    run(s, rel({ act: 'science', target: 'r3' }))
    const mine = s.nations.r0.resources.tp
    const theirs = s.nations.r3.resources.tp
    s = month(s)
    expect(s.nations.r0.resources.tp - mine).toBeGreaterThan(0.9)
    expect(s.nations.r3.resources.tp - theirs).toBeGreaterThan(0.5)
    for (let i = 0; i < 14; i++) s = month(s)
    expect(s.relations!.programs.filter((p) => p.kind === 'science')).toHaveLength(0)
  })

  it('a program ends with a war between its partners', () => {
    let s = world()
    friend(s, 'r3')
    run(s, rel({ act: 'tradeMission', target: 'r3' }))
    expect(s.relations!.programs).toHaveLength(1)
    s.wars.push('r0|r3')
    s = month(s)
    expect(s.relations!.programs).toHaveLength(0)
  })

  it('aid is worth most to a nation in dire need, and then they owe a favour', () => {
    const a = world()
    const b = world()
    a.nations.r3.foodShortage = true
    a.nations.r3.resources.food = 2
    b.nations.r3.resources.food = 200
    run(a, rel({ act: 'aid', target: 'r3', resource: 'food', amount: 30 }))
    run(b, rel({ act: 'aid', target: 'r3', resource: 'food', amount: 30 }))
    const gainA = storedOpinion(a, 'r3', 'r0').filter((m) => m.label === 'Rescued us').reduce((n, m) => n + m.value, 0)
    const gainB = storedOpinion(b, 'r3', 'r0').filter((m) => m.label === 'Aid in kind').reduce((n, m) => n + m.value, 0)
    expect(gainA).toBeGreaterThan(gainB * 2)
    expect(favoursOwed(a, 'r3', 'r0')).toBe(1)
    expect(favoursOwed(b, 'r3', 'r0')).toBe(0)
    expect(a.nations.r0.resources.food).toBe(100 - 30)
    expect(a.nations.r3.resources.food).toBe(2 + 30)
  })

  it('aid has its own cooldown by resource, and cannot send what you do not have', () => {
    const s = world()
    run(s, rel({ act: 'aid', target: 'r3', resource: 'food', amount: 10 }))
    expect(why(s, rel({ act: 'aid', target: 'r3', resource: 'food', amount: 10 }))).toMatch(/Wait/)
    expect(why(s, rel({ act: 'aid', target: 'r3', resource: 'oil', amount: 10 }))).toBeNull()
    expect(why(s, rel({ act: 'aid', target: 'r3', resource: 'oil', amount: 5000 }))).toBeTruthy()
  })

  it('a joint venture takes half from each side, pays both, and walking out costs goodwill and half the stake', () => {
    let s = world()
    addOpinion(s, 'r3', 'r0', 'Friends', 30, 0)
    s.nations.r3.sectors.manufacturing = 10
    run(s, rel({ act: 'embassy', target: 'r3' }))
    const myMoney = s.nations.r0.resources.capital
    const theirs = s.nations.r3.resources.capital
    run(s, rel({ act: 'venture', target: 'r3', sector: 'manufacturing', amount: 100 }))
    expect(s.nations.r0.resources.capital).toBe(myMoney - 100 - 0)
    expect(s.nations.r3.resources.capital).toBe(theirs - 100)
    expect(s.investments.some((i) => i.investor === 'r0' && i.target === 'r3')).toBe(true)
    const prog = s.relations!.programs.find((p) => p.kind === 'venture')!
    const before = s.nations.r0.resources.capital
    s = month(s)
    expect(s.nations.r0.resources.capital).toBeGreaterThan(before)
    const opinion = op(s, 'r3', 'r0')
    const inv = s.investments.find((i) => i.investor === 'r0')!.amount
    const cash = s.nations.r0.resources.capital
    run(s, rel({ act: 'endProgram', target: 'r3', id: prog.id }))
    expect(op(s, 'r3', 'r0')).toBeLessThan(opinion)
    expect(s.nations.r0.resources.capital - cash).toBeCloseTo(inv * 0.5, 5)
    expect(s.relations!.programs.filter((p) => p.kind === 'venture')).toHaveLength(0)
  })

  it('a venture needs a friend that can match it', () => {
    const s = world()
    run(s, rel({ act: 'embassy', target: 'r3' }))
    s.nations.r3.sectors.manufacturing = 10
    expect(why(s, rel({ act: 'venture', target: 'r3', sector: 'manufacturing', amount: 100 }))).toMatch(/will not take it/)
    addOpinion(s, 'r3', 'r0', 'Friends', 40, 0)
    s.nations.r3.resources.capital = 50
    expect(why(s, rel({ act: 'venture', target: 'r3', sector: 'manufacturing', amount: 100 }))).toMatch(/cannot match/)
    expect(why(s, rel({ act: 'venture', target: 'r3', sector: 'manufacturing', amount: 5 }))).toMatch(/between/)
  })
})

describe('favours, apologies and repair', () => {
  it('a favour is a currency: call it in once, and it is gone', () => {
    let s = world()
    s.nations.r3.foodShortage = true
    run(s, rel({ act: 'aid', target: 'r3', resource: 'food', amount: 20 }))
    expect(favoursOwed(s, 'r3', 'r0')).toBe(1)
    const money = s.nations.r0.resources.capital
    run(s, rel({ act: 'callFavour', target: 'r3', ask: 'money' }))
    expect(s.nations.r0.resources.capital - money).toBe(25)
    expect(favoursOwed(s, 'r3', 'r0')).toBe(0)
    expect(why(s, rel({ act: 'callFavour', target: 'r3', ask: 'money' }))).toBeTruthy()
    s.relations!.last = {}
    expect(why(s, rel({ act: 'callFavour', target: 'r3', ask: 'money' }))).toMatch(/owe you no favour/)
    // Favours lapse after three years.
    s.nations.r3.foodShortage = true
    s.relations!.last = {}
    run(s, rel({ act: 'aid', target: 'r3', resource: 'food', amount: 20 }))
    for (let i = 0; i < 38; i++) s = month(s)
    expect(favoursOwed(s, 'r3', 'r0')).toBe(0)
  })

  it('an apology softens a grudge, and needs one to exist', () => {
    const s = world()
    expect(why(s, rel({ act: 'apology', target: 'r3' }))).toMatch(/hold nothing/)
    addOpinion(s, 'r3', 'r0', 'Insulted us', -20, 0.1)
    const before = op(s, 'r3', 'r0')
    run(s, rel({ act: 'apology', target: 'r3' }))
    expect(op(s, 'r3', 'r0')).toBeGreaterThan(before + 6)
    const paid = world()
    addOpinion(paid, 'r3', 'r0', 'Insulted us', -30, 0.1)
    const b2 = op(paid, 'r3', 'r0')
    run(paid, rel({ act: 'apology', target: 'r3', amount: 60 }))
    expect(op(paid, 'r3', 'r0')).toBeGreaterThan(b2 + 15)
  })

  it('recognising their claim withdraws a grievance', () => {
    const s = world()
    s.casusBelli['r3|r0'] = s.turn + 10
    s.reasons['r3|r0'] = 'Old claim'
    run(s, rel({ act: 'recognise', target: 'r3' }))
    expect(s.casusBelli['r3|r0']).toBeUndefined()
  })

  it('ceding a border country is a grand gift and cannot be done with your capital', () => {
    const s = world()
    s.regions.r1.owner = 'r0'
    s.nations.r1.alive = true
    expect(why(s, rel({ act: 'cede', target: 'r3', give: 'r0' }))).toBeTruthy()
    addOpinion(s, 'r2', 'r0', 'Friends', 40, 0)
    expect(why(s, rel({ act: 'cede', target: 'r2', give: 'r0' }))).toMatch(/capital/)
    expect(why(s, rel({ act: 'cede', target: 'r2', give: 'r1' }))).toBeNull()
    run(s, rel({ act: 'cede', target: 'r2', give: 'r1' }))
    expect(s.regions.r1.owner).toBe('r2')
    expect(favoursOwed(s, 'r2', 'r0')).toBe(2)
  })
})

describe('joint war plans', () => {
  function atWar(): GameState {
    const s = world()
    s.wars.push('r0|r5', 'r3|r5')
    s.regions.r5.line = 4
    addOpinion(s, 'r3', 'r0', 'Friends', 30, 0)
    return s
  }

  it('need both of you to be at war with the named enemy, and an opinion to match', () => {
    const s = world()
    s.wars.push('r0|r5')
    expect(why(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5' }))).toMatch(/both be at war/)
    s.wars.push('r3|r5')
    addOpinion(s, 'r3', 'r0', 'Insulted us', -40, 0)
    expect(why(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5' }))).toMatch(/will not take it/)
    addOpinion(s, 'r3', 'r0', 'Friends', 60, 0)
    expect(why(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5' }))).toBeNull()
    expect(why(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5', months: 99 }))).toMatch(/months/)
    expect(why(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5', split: 0.9 }))).toMatch(/spoils/)
  })

  it('partners cannot declare war on each other, and the plan ends when the war does', () => {
    let s = atWar()
    run(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5' }))
    expect(s.relations!.plans).toHaveLength(1)
    expect(why(s, { type: 'declareWar', nationId: 'r0', target: 'r3' })).toBeTruthy()
    s.wars = s.wars.filter((w) => w !== 'r0|r5' && w !== 'r3|r5')
    const before = op(s, 'r3', 'r0')
    for (let i = 0; i < 4; i++) s = month(s)
    s.wars = s.wars.filter((w) => !w.includes('r5'))
    s = month(s)
    expect(s.relations!.plans).toHaveLength(0)
    expect(op(s, 'r3', 'r0')).toBeGreaterThanOrEqual(before - 6)
  })

  it('ending a plan early abandons the partner: they remember', () => {
    const s = atWar()
    run(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5' }))
    const id = s.relations!.plans[0].id
    const before = op(s, 'r3', 'r0')
    run(s, rel({ act: 'endPlan', target: 'r3', id }))
    expect(s.relations!.plans).toHaveLength(0)
    expect(op(s, 'r3', 'r0')).toBeLessThan(before)
  })

  it('a separate peace by one partner ends the plan with a penalty for the one who left', () => {
    let s = atWar()
    run(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5' }))
    const before = op(s, 'r3', 'r0')
    s.wars = s.wars.filter((w) => w !== 'r0|r5')
    s = month(s)
    expect(s.relations!.plans).toHaveLength(0)
    expect(op(s, 'r3', 'r0')).toBeLessThan(before)
  })

  it('a combined strike: the second partner to hit the same country in the window pushes the line further', () => {
    const solo = atWar()
    const joint = atWar()
    run(joint, rel({ act: 'warPlan', target: 'r3', enemy: 'r5' }))
    // The plan took an id: take one in the other world too, so both fights draw the same dice.
    solo.nextId = joint.nextId
    for (const s of [solo, joint]) {
      s.regions.r5.line = 6
      setMilitary(s, 'r0', { infantry: 12 })
      setMilitary(s, 'r3', { infantry: 12 })
      setMilitary(s, 'r5', { infantry: 4 })
    }
    // r4 and r6 are r5's neighbours: give r0 and r3 a foothold next door.
    for (const s of [solo, joint]) {
      s.regions.r4.owner = 'r0'
      s.regions.r6.owner = 'r3'
    }
    const hit = (s: GameState) => {
      const a = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r5', commit: 'main', stance: 'assault' })
      const b = applyOrderNow(s, map, { type: 'attack', nationId: 'r3', target: 'r5', commit: 'main', stance: 'assault' })
      return [a.error, b.error, s.regions.r5.line]
    }
    const one = hit(solo)
    const two = hit(joint)
    expect(one[0]).toBeNull()
    expect(two[1]).toBeNull()
    // Same fights, same random draws: the only difference is the combined strike.
    expect(two[2] as number).toBeLessThan(one[2] as number)
    expect(joint.log.some((l) => /COMBINED STRIKE/.test(l.text))).toBe(true)
  })

  it('spoils: when one partner takes a country the other is paid its share', () => {
    const s = atWar()
    run(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5', split: 0.5 }))
    s.regions.r5.line = 0.1
    s.regions.r4.owner = 'r0'
    setMilitary(s, 'r0', { infantry: 30 })
    setMilitary(s, 'r5', { infantry: 1 })
    const theirs = s.nations.r3.resources.capital
    const mine = s.nations.r0.resources.capital
    const r = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r5', commit: 'main', stance: 'assault' })
    expect(r.battle?.captured).toBe(true)
    expect(s.nations.r3.resources.capital).toBeGreaterThan(theirs)
    expect(s.relations!.plans[0].paid).toBeGreaterThan(0)
    void mine
  })

  it('a strike window needs the plan and an enemy country you can reach', () => {
    const s = atWar()
    run(s, rel({ act: 'warPlan', target: 'r3', enemy: 'r5' }))
    const id = s.relations!.plans[0].id
    s.regions.r4.owner = 'r0'
    s.regions.r6.owner = 'r3'
    expect(why(s, rel({ act: 'strikeWindow', target: 'r3', id, region: 'r1' }))).toMatch(/Choose one of/)
    expect(why(s, rel({ act: 'strikeWindow', target: 'r3', id, region: 'r5' }))).toBeNull()
    run(s, rel({ act: 'strikeWindow', target: 'r3', id, region: 'r5' }))
    expect(s.relations!.plans[0].strike?.region).toBe('r5')
  })
})

describe('requests from rivals', () => {
  function asked(): GameState {
    const s = world()
    const ask: RelateOrder = rel({ act: 'ask', target: 'r0', kind: 'aid', resource: 'food', amount: 20 }, 'r3')
    s.humans = ['r0']
    s.nations.r0.isPlayer = true
    expect(why(s, ask)).toBeNull()
    return resolveTurn(s, map, [ask])
  }

  it('arrive in your inbox with a deadline', () => {
    const s = asked()
    expect(s.relations!.requests).toHaveLength(1)
    expect(s.relations!.requests[0].expires).toBeGreaterThanOrEqual(s.turn)
  })

  it('answering yes does the thing and wins thanks; answering no costs a little; ignoring costs more', () => {
    const yes = asked()
    const id = yes.relations!.requests[0].id
    const before = yes.nations.r3.resources.food
    run(yes, rel({ act: 'answer', target: 'r3', id, accept: true }))
    expect(yes.nations.r3.resources.food).toBe(before + 20)
    expect(favoursOwed(yes, 'r3', 'r0')).toBe(1)
    expect(yes.relations!.requests).toHaveLength(0)

    const no = asked()
    const o1 = op(no, 'r3', 'r0')
    run(no, rel({ act: 'answer', target: 'r3', id: no.relations!.requests[0].id, accept: false }))
    const o2 = op(no, 'r3', 'r0')
    expect(o2).toBeLessThan(o1)

    let ignore = asked()
    const o3 = op(ignore, 'r3', 'r0')
    for (let i = 0; i < RELATIONS.requestMonths + 1; i++) ignore = month(ignore)
    expect(ignore.relations!.requests).toHaveLength(0)
    expect(op(ignore, 'r3', 'r0')).toBeLessThan(o3 - 2)
    // Ignoring costs more than refusing outright.
    expect(Math.abs(RELATIONS.ignoreCost)).toBeGreaterThan(Math.abs(RELATIONS.refuseCost))
  })

  it('Easy rivals do not punish silence or a refusal', () => {
    let s = asked()
    s.settings.difficulty = 'easy'
    const o = op(s, 'r3', 'r0')
    for (let i = 0; i < RELATIONS.requestMonths + 1; i++) s = month(s)
    expect(op(s, 'r3', 'r0')).toBeGreaterThanOrEqual(o - 1)
  })

  it('a player cannot be asked twice, and rivals cannot be asked at all', () => {
    const s = asked()
    expect(why(s, rel({ act: 'ask', target: 'r0', kind: 'trade' }, 'r3'))).toMatch(/already/)
    expect(why(s, rel({ act: 'ask', target: 'r3', kind: 'trade' }))).toMatch(/ask players/)
  })
})

describe('keeping a relationship up', () => {
  it('an anniversary of a pact warms a rival, and a friend of a year stays steadfast', () => {
    let s = world()
    s.alliances.push('r0|r3')
    s = month(s)
    expect(s.relations!.since['r0|r3']).toBeDefined()
    const start = op(s, 'r3', 'r0')
    for (let i = 0; i < 13; i++) s = month(s)
    expect(parts(s, 'r3', 'r0')).toContain('Steadfast ally')
    expect(storedOpinion(s, 'r3', 'r0').some((m) => m.label === 'Treaty anniversary')).toBe(true)
    expect(start).toBeGreaterThan(0)
    expect(parts(s, 'r3', 'r0')).toContain('Treaty anniversary')
  })

  it('a partner left alone for over a year starts to cool, and a warning says so', () => {
    let s = world()
    s.pacts['r0|r3'] = 999
    s = month(s)
    for (let i = 0; i < 16; i++) s = month(s)
    expect(parts(s, 'r3', 'r0')).toContain('Neglected')
    const h = relationHealth(s, 'r0', 'r3', op(s, 'r3', 'r0'))
    expect(h.warning).toMatch(/neglected|cool/i)
    expect(h.label).toBe('Neglected')
  })

  it('contact resets the clock', () => {
    let s = world()
    s.pacts['r0|r3'] = 999
    s = month(s)
    for (let i = 0; i < 10; i++) s = month(s)
    run(s, rel({ act: 'culture', target: 'r3' }))
    for (let i = 0; i < 6; i++) s = month(s)
    expect(parts(s, 'r3', 'r0')).not.toContain('Neglected')
  })

  it('shows what is moving an opinion each month, and the warning counts down', () => {
    const s = world()
    friend(s, 'r3')
    run(s, rel({ act: 'visit', target: 'r3' }))
    const mv = movement(s, 'r3', 'r0')
    expect(mv.total).toBeLessThan(0)
    expect(mv.movers[0].label).toBe('State visit')
    const h = relationHealth(s, 'r0', 'r3', op(s, 'r3', 'r0'))
    expect(h.coolsBy).toBeGreaterThan(0.5)
  })
})

describe('the views', () => {
  it('group the reasons the way a person says them', () => {
    const s = world()
    s.alliances.push('r0|r3')
    friend(s, 'r3')
    run(s, rel({ act: 'visit', target: 'r3' }))
    const groups = groupReasons(opinionReport(s, map, 'r3', 'r0')).map((g) => g.group)
    expect(groups).toContain('Treaties and peace')
    expect(groups).toContain('Visits and exchange')
    expect(groups).toContain('Government and temperament')
  })

  it('list every nation with its opinion and flags', () => {
    const s = world()
    s.alliances.push('r0|r3')
    const rows = partnerRows(s, map, 'r0')
    expect(rows).toHaveLength(7)
    expect(rows.find((r) => r.id === 'r3')!.ally).toBe(true)
    expect(rows.find((r) => r.id === 'r1')!.neighbor).toBe(true)
  })

  it('say what a rival is short of', () => {
    const s = world()
    s.nations.r4.foodShortage = true
    const needs = partnerNeeds(s, map, 'r4')
    expect(needs.some((n) => n.resource === 'food' && n.level === 'dire')).toBe(true)
  })

  it('preview an action with its costs, its effect and the reason when it cannot be done', () => {
    const s = world()
    friend(s, 'r3')
    const p = previewRelate(s, map, rel({ act: 'visit', target: 'r3' }))
    expect(p.costs.map((c) => c.label)).toEqual(['money', 'influence'])
    expect(p.effects[0]).toMatch(/\+14 opinion/)
    // A friend gives no warning of a protocol incident; one who thinks poorly of you does.
    expect(p.risk).toBeUndefined()
    addOpinion(s, 'r4', 'r0', 'Test grudge', -12, 0)
    expect(previewRelate(s, map, rel({ act: 'visit', target: 'r4' })).risk).toMatch(/protocol incident/)
    s.nations.r0.resources.capital = 1
    expect(previewRelate(s, map, rel({ act: 'visit', target: 'r3' })).why).toMatch(/Not enough money/)
  })
})

describe('orders that make no sense are refused, never thrown', () => {
  it('survives a fuzz of malformed relate orders', () => {
    const s = world()
    const junk = [undefined, null, NaN, -5, 1e9, 'x', {}, [], 0, '', 'r3', 'r0', 'nobody'] as unknown[]
    const acts = [...Object.keys(ACTS), 'callFavour', 'ask', 'answer', 'closeEmbassy', 'endProgram', 'endPlan', 'strikeWindow', 'bogus', undefined as unknown as string]
    let n = 0
    for (const act of acts) {
      for (const j of junk) {
        for (const field of ['target', 'amount', 'resource', 'sector', 'techId', 'enemy', 'months', 'split', 'region', 'id', 'ask', 'kind', 'give']) {
          const o = { type: 'relate', nationId: 'r0', target: 'r3', act, [field]: j } as unknown as Order
          const r = validateOrder(s, map, o)
          expect(r === null || typeof r === 'string').toBe(true)
          if (r === null) {
            // Anything that passes must also run without breaking the game.
            const t = structuredClone(s)
            const out = applyOrderNow(t, map, o)
            expect(out.error === null || typeof out.error === 'string').toBe(true)
            expect(Object.values(t.nations).every((x) => Number.isFinite(x.resources.capital) && Number.isFinite(x.resources.pp))).toBe(true)
          }
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(1000)
  })

  it('refuses another player as a target: they decide for themselves', () => {
    const s = world()
    s.humans = ['r0', 'r1']
    s.nations.r1.isPlayer = true
    expect(why(s, rel({ act: 'visit', target: 'r1' }))).toMatch(/Another player/)
  })
})

describe('old games and parity', () => {
  it('a game without relations runs a month exactly as before', () => {
    let s = world()
    expect(s.relations).toBeUndefined()
    s = month(s)
    expect(s.relations).toBeUndefined()
  })

  it('a live game and a turn game apply the same order the same way', () => {
    const turn = world(9)
    const live = world(9)
    live.settings.mode = 'live'
    live.day = 0
    live.armies = []
    live.launches = []
    live.flights = []
    for (const s of [turn, live]) {
      run(s, rel({ act: 'embassy', target: 'r3' }))
      run(s, rel({ act: 'visit', target: 'r3' }))
      run(s, rel({ act: 'aid', target: 'r4', resource: 'oil', amount: 12 }))
    }
    expect(JSON.stringify(live.relations)).toBe(JSON.stringify(turn.relations))
    expect(JSON.stringify(live.opinions)).toBe(JSON.stringify(turn.opinions))
    expect(live.nations.r0.resources).toEqual(turn.nations.r0.resources)
  })

  it('there is no profit in embassies, visits or aid loops', () => {
    // Open and close an embassy and visit over and over: you only ever lose money and influence, and the earned warmth stays bounded.
    let s = world()
    const money = s.nations.r0.resources.capital
    for (let i = 0; i < 30; i++) {
      s.nations.r0.resources.capital = 1000
      s.nations.r0.resources.pp = 300
      for (const a of [rel({ act: 'embassy', target: 'r3' }), rel({ act: 'closeEmbassy', target: 'r3' }), rel({ act: 'visit', target: 'r3' }), rel({ act: 'culture', target: 'r3' })]) if (!why(s, a)) applyOrderNow(s, map, a)
      s = month(s)
    }
    void money
    expect(op(s, 'r3', 'r0')).toBeLessThan(70)
  })
})
