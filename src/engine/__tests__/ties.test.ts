import { afterEach, describe, expect, it } from 'vitest'
import { addOpinion, coalitionActive, opinionReport } from '../../ai/opinion'
import { TIES, TRUST } from '../../data/relations'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { pairKey } from '../helpers'
import { monthsQuiet, relationLines } from '../relationParts'
import { groupReasons, movement, partnerRows, reasonGroup, relTier, topReasons } from '../relationsView'
import { resolveTurn } from '../resolveTurn'
import { peaceMonths, runTies, stakeIn, tieLines, tradeMonths, tradeWorth, trustReport } from '../ties'
import type { Deal, GameState, NationId } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

function world(seed = 5): GameState {
  const s = startState(map, 'r0', seed)
  for (const id of Object.keys(s.nations)) {
    const n = s.nations[id]
    n.resources.capital = 1000
    n.resources.pp = 300
    n.government = 'democracy'
    n.personality = 'honorable'
    setMilitary(s, id, { infantry: 10 })
  }
  s.nextEventTurn = 9999
  return s
}

const report = (s: GameState, holder: NationId, target: NationId, borders?: boolean) => opinionReport(s, map, holder, target, borders === undefined ? {} : { borders })
const line = (s: GameState, holder: NationId, target: NationId, label: string, borders?: boolean) => report(s, holder, target, borders).parts.find((p) => p.label === label)?.value
const trade = (s: GameState, a: NationId, b: NationId, give: Deal['give'], receive: Deal['receive'] = {}, until = 99): Deal => {
  const d: Deal = { id: `d${s.deals.length + 1}`, kind: 'trade', from: a, to: b, give, receive, until }
  s.deals.push(d)
  return d
}

afterEach(() => {
  TIES.on = true
})

describe('the starting mood: hostility is earned, not the default', () => {
  it('temperament is mildly positive for most and only a little cool for an expansionist', () => {
    const s = world()
    s.nations.r5.personality = 'expansionist'
    s.nations.r6.personality = 'trader'
    expect(line(s, 'r5', 'r0', 'Temperament')).toBe(TIES.temperament.expansionist)
    expect(line(s, 'r6', 'r0', 'Temperament')).toBe(TIES.temperament.trader)
    TIES.on = false
    expect(line(s, 'r5', 'r0', 'Temperament')).toBe(-6)
  })

  it('a neighbor is only a little uneasy, a treaty or a shared bloc settles it, trade halves it', () => {
    const s = world()
    expect(line(s, 'r1', 'r0', 'Border tensions', true)).toBe(TIES.border.base)
    s.nations.r1.personality = 'expansionist'
    expect(line(s, 'r1', 'r0', 'Border tensions', true)).toBe(TIES.border.expansionist)
    trade(s, 'r0', 'r1', { capital: 5 })
    expect(line(s, 'r1', 'r0', 'Border tensions', true)).toBe(Math.round(TIES.border.expansionist * TIES.border.tradeShare))
    s.pacts[pairKey('r0', 'r1')] = 99
    expect(line(s, 'r1', 'r0', 'Border tensions', true)).toBeUndefined()
    TIES.on = false
    expect(line(s, 'r1', 'r0', 'Border tensions', true)).toBe(-14)
  })

  it('a nation that starts big alarms nobody until it takes land (the old rule feared China and India from the first month)', () => {
    const { map: world } = getWorld()
    const s = createInitialState(world, { playerRegionId: 'china', seed: 1, difficulty: 'normal' })
    TIES.on = false
    expect(coalitionActive(s, world)).toBe(true)
    TIES.on = true
    expect(coalitionActive(s, world)).toBe(false)
    const neighbour = [...Object.keys(s.nations)].find((id) => world.regions.china.neighbors.includes(id) && s.nations[id]?.alive)!
    expect(opinionReport(s, world, neighbour, 'china').parts.some((p) => p.label === 'Fears your power')).toBe(false)
    // Taking land makes it earned.
    const taken = world.regions.china.neighbors.filter((id) => s.regions[id]).slice(0, TIES.fearAfterTaken)
    for (const id of taken) s.regions[id].owner = 'china'
    expect(coalitionActive(s, world)).toBe(true)
  })

  it('Easy has no coalition whoever asks (the desk used to show "Fears your power" on Easy)', () => {
    const { map: world } = getWorld()
    const s = createInitialState(world, { playerRegionId: 'china', seed: 1, difficulty: 'easy' })
    s.infamy.china = 90
    expect(coalitionActive(s, world)).toBe(false)
    TIES.on = false
    expect(coalitionActive(s, world)).toBe(true)
  })
})

describe('trade deals', () => {
  it('are worth more the bigger they are and the longer trade has run, up to a ceiling', () => {
    const s = world()
    trade(s, 'r0', 'r3', { food: 4 }, { capital: 4 })
    const small = line(s, 'r3', 'r0', 'Trade partners')!
    expect(small).toBeGreaterThanOrEqual(TIES.trade.base)
    s.deals = []
    trade(s, 'r0', 'r3', { oil: 40 }, { capital: 60 })
    const big = line(s, 'r3', 'r0', 'Trade partners')!
    expect(big).toBe(TIES.trade.base + TIES.trade.valueCap)
    expect(big).toBeGreaterThan(small)
    // Months of trade add to it, to a ceiling (a deal both can keep paying).
    s.deals = []
    trade(s, 'r0', 'r3', { capital: 20 }, { capital: 20 })
    let cur = s
    for (let i = 0; i < 30; i++) cur = resolveTurn(cur, map, [])
    expect(tradeMonths(cur, 'r0', 'r3')).toBeGreaterThan(20)
    expect(line(cur, 'r3', 'r0', 'Trade partners')).toBe(TIES.trade.base + TIES.trade.valueCap + TIES.trade.monthsCap)
  })

  it('count both ways, and the same between two rivals', () => {
    const s = world()
    trade(s, 'r4', 'r5', { food: 10 }, { capital: 10 })
    expect(line(s, 'r4', 'r5', 'Trade partners')).toBe(line(s, 'r5', 'r4', 'Trade partners'))
    expect(tradeWorth(s, 'r4', 'r5')).toBeCloseTo(10 * 1.3 + 10)
  })

  it('a renewed deal keeps the run going; a long gap ends it', () => {
    const s = world()
    const months = (from: number, to: number) => {
      for (let m = from; m <= to; m++) {
        s.turn = m
        runTies(s)
      }
    }
    trade(s, 'r0', 'r3', { capital: 5 }, {}, 99)
    months(10, 20)
    expect(tradeMonths(s, 'r0', 'r3')).toBe(10)
    s.deals = []
    months(21, 21)
    trade(s, 'r0', 'r3', { capital: 5 })
    months(22, 22)
    expect(tradeMonths(s, 'r0', 'r3')).toBe(12)
    s.deals = []
    months(23, 30)
    trade(s, 'r0', 'r3', { capital: 5 })
    months(31, 31)
    expect(tradeMonths(s, 'r0', 'r3')).toBe(0)
  })

  it('a contract that has not started yet is not trade', () => {
    const s = world()
    const d = trade(s, 'r0', 'r3', { capital: 5 })
    d.contract = { start: s.turn + 3, held: 0, poster: 'r0' }
    expect(line(s, 'r3', 'r0', 'Trade partners')).toBeUndefined()
  })

  it('a running trade deal is contact: it never leaves a partner feeling neglected (it did, after 12 months)', () => {
    const s = world()
    s.relations = { last: {}, soft: {}, embassies: [], programs: [], plans: [], favours: {}, requests: [], log: [], since: {}, contact: {} }
    trade(s, 'r3', 'r0', { capital: 5 })
    s.relations.contact[pairKey('r0', 'r3')] = 1
    s.turn = 40
    expect(monthsQuiet(s, 'r3', 'r0')).toBe(0)
    expect(relationLines(s, 'r3', 'r0').some((l) => l.label === 'Neglected')).toBe(false)
    TIES.on = false
    expect(relationLines(s, 'r3', 'r0').some((l) => l.label === 'Neglected')).toBe(true)
  })

  it('with ties off it is the old flat line', () => {
    const s = world()
    trade(s, 'r0', 'r3', { oil: 40 }, { capital: 60 })
    TIES.on = false
    expect(line(s, 'r3', 'r0', 'Trade partners')).toBe(10)
  })
})

describe('investment', () => {
  it('money in their businesses is a lasting line that grows with the stake, to a ceiling', () => {
    const s = world()
    s.investments = [{ id: 'i1', investor: 'r0', target: 'r3', sector: 'manufacturing', amount: 60 }]
    expect(line(s, 'r3', 'r0', 'Invests in our economy')).toBe(Math.round(60 / TIES.invest.per))
    s.investments[0].amount = 1000
    expect(line(s, 'r3', 'r0', 'Invests in our economy')).toBe(TIES.invest.cap)
    // It is about the investor: the host's view of itself and the reverse direction carry nothing.
    expect(line(s, 'r0', 'r3', 'Invests in our economy')).toBeUndefined()
  })

  it('the thanks for each new investment is small and capped (it used to be +12 each time, stacking to 60)', () => {
    const s = world()
    s.nations.r3.sectors.manufacturing = 100
    let cur = s
    for (let i = 0; i < 6; i++) cur = resolveTurn(cur, map, [{ type: 'invest', nationId: 'r0', target: 'r3', sector: 'manufacturing', amount: 40 }])
    Object.assign(s, cur)
    const thanks = line(s, 'r3', 'r0', 'Invested in our businesses') ?? 0
    expect(thanks).toBeGreaterThan(0)
    expect(thanks).toBeLessThanOrEqual(TIES.invest.thanksCap)
    expect(line(s, 'r3', 'r0', 'Invests in our economy')).toBeGreaterThan(0)
  })

  it('a joint venture stake counts in the venture line, not twice', () => {
    const s = world()
    s.investments = [{ id: 'i1', investor: 'r0', target: 'r3', sector: 'manufacturing', amount: 100 }]
    s.relations = { last: {}, soft: {}, embassies: [], programs: [{ id: 'rp1', kind: 'venture', a: 'r0', b: 'r3', start: s.turn, until: s.turn + 35, sector: 'manufacturing', host: 'r3', stake: 100 }], plans: [], favours: {}, requests: [], log: [], since: {}, contact: {} }
    expect(stakeIn(s, 'r0', 'r3')).toBe(0)
    expect(line(s, 'r3', 'r0', 'Invests in our economy')).toBeUndefined()
  })

  it('a bigger joint venture is worth more', () => {
    const s = world()
    const venture = (stake: number) => {
      s.relations = { last: {}, soft: {}, embassies: [], programs: [{ id: 'rp1', kind: 'venture', a: 'r0', b: 'r3', start: s.turn - 40, until: s.turn + 35, sector: 'manufacturing', host: 'r3', stake }], plans: [], favours: {}, requests: [], log: [], since: {}, contact: {} }
      return relationLines(s, 'r3', 'r0').find((l) => l.label === 'Joint venture')!.value
    }
    expect(venture(200)).toBeGreaterThan(venture(30))
    expect(venture(200)).toBeLessThanOrEqual(TIES.venture.max)
  })
})

describe('gifts', () => {
  it('stack only to a ceiling', () => {
    const s = world()
    let cur = s
    // A gift is always welcome: the rival accepts it at the month's end.
    for (let i = 0; i < 6; i++) cur = resolveTurn(cur, map, [{ type: 'propose', nationId: 'r0', target: 'r3', proposal: { kind: 'trade', terms: { give: { capital: 100 }, receive: {}, months: 0 } } }])
    Object.assign(s, cur)
    const gifts = line(s, 'r3', 'r0', 'Generous gifts') ?? 0
    expect(gifts).toBeGreaterThan(20)
    expect(gifts).toBeLessThanOrEqual(TIES.giftCap)
  })
})

describe('long peace', () => {
  it('builds between neighbors after a year without war, to a ceiling', () => {
    const s = world()
    s.turn = 1 + TIES.peace.after
    expect(line(s, 'r1', 'r0', 'Long peace', true)).toBeUndefined()
    s.turn = 1 + TIES.peace.after + 10
    expect(line(s, 'r1', 'r0', 'Long peace', true)).toBe(Math.round(10 * TIES.peace.step))
    s.turn = 200
    expect(line(s, 'r1', 'r0', 'Long peace', true)).toBe(TIES.peace.cap)
    // Distant nations that never met have nothing to celebrate.
    expect(line(s, 'r6', 'r0', 'Long peace', false)).toBeUndefined()
  })

  it('a war starts the clock again, and old enemies far apart count too', () => {
    const s = world()
    s.wars.push(pairKey('r0', 'r6'))
    s.turn = 5
    runTies(s)
    s.wars = []
    s.turn = 5 + TIES.peace.after + 5
    expect(peaceMonths(s, 'r0', 'r6')).toBe(TIES.peace.after + 5)
    expect(line(s, 'r6', 'r0', 'Long peace', false)).toBe(1)
  })
})

describe('the breakdown and the screens', () => {
  it('every tie shows in the reasons under a group a person would use', () => {
    expect(reasonGroup('Trade partners', 8)).toBe('Trade and investment')
    expect(reasonGroup('Invests in our economy', 5)).toBe('Trade and investment')
    expect(reasonGroup('Joint venture', 5)).toBe('Trade and investment')
    expect(reasonGroup('Long peace', 3)).toBe('Treaties and peace')
    expect(reasonGroup('Generous gifts', 10)).toBe('Aid and gifts')
    expect(reasonGroup('Faction partners', 12)).toBe('Bloc')
    expect(reasonGroup('Fears your power', -15)).toBe('Borders and power')
    expect(reasonGroup('Caught our spies', -25)).toBe('Grievances')
    const s = world()
    trade(s, 'r0', 'r3', { oil: 40 }, { capital: 60 })
    s.investments = [{ id: 'i1', investor: 'r0', target: 'r3', sector: 'manufacturing', amount: 60 }]
    const g = groupReasons(report(s, 'r3', 'r0'))
    expect(g.find((x) => x.group === 'Trade and investment')!.parts.map((p) => p.label).sort()).toEqual(['Invests in our economy', 'Trade partners'])
  })

  it('the headline names the biggest reasons first', () => {
    const s = world()
    trade(s, 'r0', 'r3', { oil: 40 }, { capital: 60 })
    addOpinion(s, 'r3', 'r0', 'Caught our spies', -25, 0.4)
    const top = topReasons(report(s, 'r3', 'r0'))
    expect(top[0].label).toBe('Caught our spies')
    expect(top.length).toBeLessThanOrEqual(3)
  })

  it('a growing tie shows as a rising trend', () => {
    const s = world()
    trade(s, 'r0', 'r3', { capital: 5 })
    runTies(s)
    expect(movement(s, 'r3', 'r0').movers.some((m) => m.label === 'Trade partners' && m.value > 0)).toBe(true)
    expect(tieLines(s, 'r3', 'r0', false)[0].step).toBeCloseTo(TIES.trade.perMonth)
  })

  it('rows carry tier, trust, trade value, power and distance for sorting', () => {
    const s = world()
    s.alliances.push(pairKey('r0', 'r2'))
    s.wars.push(pairKey('r0', 'r7'))
    trade(s, 'r0', 'r3', { capital: 10 })
    const rows = partnerRows(s, map, 'r0')
    const by = (id: string) => rows.find((r) => r.id === id)!
    expect(by('r2').tier).toBe('ally')
    expect(by('r7').tier).toBe('war')
    expect(by('r3').tradeValue).toBe(10)
    expect(by('r6').distance).toBeGreaterThan(by('r1').distance)
    expect(by('r3').trust!.total).toBeGreaterThan(by('r4').trust!.total)
    expect(relTier(30, false, false)).toBe('friendly')
    expect(relTier(-30, false, false)).toBe('hostile')
    expect(relTier(-10, false, false)).toBe('wary')
    expect(relTier(0, false, false)).toBe('neutral')
  })
})

describe('trust', () => {
  it('is untested at first, grows with a kept record, and falls with broken promises and aggression', () => {
    const s = world()
    expect(trustReport(s, 'r3', 'r0').total).toBe(TRUST.base)
    expect(trustReport(s, 'r3', 'r0').label).toBe('Untested')
    s.alliances.push(pairKey('r0', 'r3'))
    trade(s, 'r0', 'r3', { capital: 10 })
    addOpinion(s, 'r3', 'r0', 'Honored our deal', 10, 0.3)
    expect(trustReport(s, 'r3', 'r0').total).toBeGreaterThan(TRUST.base + 10)
    addOpinion(s, 'r4', 'r0', 'Broke our pact', -35, 0.3)
    s.infamy.r0 = 40
    const bad = trustReport(s, 'r4', 'r0')
    expect(bad.total).toBeLessThan(25)
    expect(bad.label).toBe('Distrusted')
    expect(bad.parts.map((p) => p.label)).toEqual(expect.arrayContaining(['Broken promises', 'Reputation for aggression']))
  })

  it('stays in 0 to 100', () => {
    const s = world()
    s.wars.push(pairKey('r0', 'r3'))
    s.infamy.r0 = 100
    addOpinion(s, 'r3', 'r0', 'Declared war on us', -60, 0.1)
    addOpinion(s, 'r3', 'r0', 'Caught our spies', -60, 0.1)
    expect(trustReport(s, 'r3', 'r0').total).toBe(0)
  })
})

describe('old saves', () => {
  it('a game without the ties field reads, plays a month and gains it only when there is a war or trade', () => {
    const s = world()
    expect(s.ties).toBeUndefined()
    const next = resolveTurn(s, map, [])
    expect(next.ties).toBeUndefined()
    next.wars.push(pairKey('r0', 'r5'))
    const after = resolveTurn(next, map, [])
    expect(after.ties?.fought[pairKey('r0', 'r5')]).toBe(next.turn)
  })
})
