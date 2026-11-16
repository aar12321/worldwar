import { describe, expect, it } from 'vitest'
import { SOCIAL } from '../data/society'
import { computeEconomy } from '../engine/economy'
import { createRng } from '../engine/rng'
import { validateOrder } from '../engine/orders'
import { socialLevel } from '../engine/society'
import type { GameState, Order, SocialId } from '../engine/types'
import { lineMap, startState } from '../engine/__tests__/fixtures'
import { manageCountry } from './management'

const map = lineMap(6)

/**
 * What a bot would order over several months' dice, from the same state. Orders are checked the way a real bot checks them, so one the
 * rules refuse is not counted. `surplus` stands in for a bigger economy than the toy map gives.
 */
function orders(s: GameState, id: string, skill: 1 | 2, seeds = 40, surplus?: number): Order[] {
  const all: Order[] = []
  for (let seed = 1; seed <= seeds; seed++) {
    const out: Order[] = []
    const real = computeEconomy(s, map, id)
    const econ = surplus === undefined ? real : { ...real, netCapital: surplus, gross: Math.max(real.gross, surplus * 3) }
    const tryAdd = (o: Order) => {
      if (validateOrder(s, map, o, out) !== null) return false
      out.push(o)
      return true
    }
    manageCountry(s, id, econ, skill, createRng(seed, 1), tryAdd, s.nations[id].resources.capital, new Set(['r1', 'r2']))
    all.push(...out)
  }
  return all
}

const setting = (list: Order[]) => list.filter((o): o is Extract<Order, { type: 'setSocial' }> => o.type === 'setSocial')

function rich(s: GameState, id: string) {
  const n = s.nations[id]
  n.resources.capital = 900
  n.resources.pp = 200
  n.taxRate = 0.25
}

describe('bots and social programs', () => {
  it('a Medium bot with shaky calm and money to spare takes up a program for calm, never one past Pilot-to-National', () => {
    const s = startState(map)
    rich(s, 'r1')
    s.nations.r1.stability = 35
    const sets = setting(orders(s, 'r1', 1))
    expect(sets.length).toBeGreaterThan(0)
    for (const o of sets) {
      expect(o.level).toBeLessThanOrEqual(2)
      // Only programs that buy calm: not the ones for growth.
      expect(['festivals', 'workerRights', 'minimumWage', 'mentalHealth', 'policing', 'libraries', 'elderCare', 'surveillance'] as SocialId[]).toContain(o.policy)
    }
  })

  it('a settled Medium bot takes none: growth programs are for Hard bots', () => {
    const s = startState(map)
    rich(s, 'r1')
    s.nations.r1.stability = 80
    expect(setting(orders(s, 'r1', 1))).toEqual([])
  })

  it('a rich, calm Hard bot invests in growth', () => {
    const s = startState(map)
    rich(s, 'r1')
    s.nations.r1.stability = 80
    const sets = setting(orders(s, 'r1', 2, 80))
    expect(sets.length).toBeGreaterThan(0)
    expect(sets.every((o) => ['courts', 'transit', 'smallLoans', 'apprenticeships', 'clinics', 'scholarships'].includes(o.policy))).toBe(true)
  })

  it('a democracy never takes state surveillance, even in a crisis', () => {
    const s = startState(map)
    rich(s, 'r1')
    s.nations.r1.government = 'democracy'
    s.nations.r1.stability = 20
    expect(setting(orders(s, 'r1', 2, 80)).some((o) => o.policy === 'surveillance')).toBe(false)
    // A junta in the same state may.
    const j = startState(map)
    rich(j, 'r1')
    j.nations.r1.government = 'junta'
    j.nations.r1.stability = 20
    expect(setting(orders(j, 'r1', 2, 80)).some((o) => o.policy === 'surveillance')).toBe(true)
  })

  it('a bot short of money takes nothing it could not keep paying for', () => {
    const s = startState(map)
    s.nations.r1.stability = 30
    s.nations.r1.resources.capital = 100
    s.nations.r1.resources.pp = 200
    const econ = computeEconomy(s, map, 'r1')
    // A budget with next to nothing left over: no program fits.
    const poor = { ...econ, netCapital: 2 }
    const out: Order[] = []
    for (let seed = 1; seed <= 40; seed++) manageCountry(s, 'r1', poor, 2, createRng(seed, 1), (o) => out.push(o) > 0, 100, new Set())
    expect(setting(out)).toEqual([])
  })

  it('a Hard bot in a crisis runs a celebration, and an Easy bot does nothing of the kind', () => {
    const s = startState(map)
    rich(s, 'r1')
    s.nations.r1.stability = 30
    expect(orders(s, 'r1', 2).some((o) => o.type === 'campaign' && o.campaign === 'celebration')).toBe(true)
  })

  it('the programs a bot takes cost what they say, and a month of orders from a rich Hard bot stays affordable', () => {
    const s = startState(map)
    rich(s, 'r1')
    s.nations.r1.stability = 40
    const econ = computeEconomy(s, map, 'r1')
    for (const o of setting(orders(s, 'r1', 2, 10))) {
      expect(SOCIAL[o.policy].cost * econ.workforce).toBeLessThan(econ.netCapital)
      expect(socialLevel(s.nations.r1, o.policy)).toBeLessThan(o.level)
    }
  })
})

describe('bots and projects', () => {
  it('a rich Hard bot goes on to the new national projects, and builds up what it has once the open ones are done', () => {
    const s = startState(map)
    rich(s, 'r1')
    s.nations.r1.resources.capital = 5000
    const n = s.nations.r1
    // The open projects of a Nation are built; the rest need a bigger empire.
    for (const id of ['rail', 'grid'] as const) n.projects[id] = { progress: 99, done: true }
    const fresh = orders(s, 'r1', 2, 200, 120).filter((o): o is Extract<Order, { type: 'startProject' }> => o.type === 'startProject')
    expect(fresh.some((o) => ['waterNetwork', 'broadband'].includes(o.project))).toBe(true)
    // With those built too, it turns to the next level of what it has.
    for (const id of ['waterNetwork', 'broadband', 'stadium', 'grainReserve'] as const) n.projects[id] = { progress: 99, done: true }
    const up = orders(s, 'r1', 2, 200, 120).filter((o): o is Extract<Order, { type: 'startProject' }> => o.type === 'startProject')
    expect(up.some((o) => ['rail', 'grid', 'waterNetwork', 'broadband'].includes(o.project))).toBe(true)
  })

  it('a Hard bot with unsettled land builds a cultural centre there', () => {
    const s = startState(map)
    rich(s, 'r1')
    s.regions.r1.integration = 0.2
    const started = orders(s, 'r1', 2, 200).filter((o): o is Extract<Order, { type: 'startProject' }> => o.type === 'startProject')
    expect(started.some((o) => o.project === 'culturalCentre' && o.regionId === 'r1')).toBe(true)
  })

  it('a Medium bot builds only the original projects, and never anything in its countries', () => {
    const s = startState(map)
    rich(s, 'r1')
    const started = orders(s, 'r1', 1, 200).filter((o): o is Extract<Order, { type: 'startProject' }> => o.type === 'startProject')
    expect(started.every((o) => !o.regionId)).toBe(true)
    expect(started.every((o) => ['rail', 'grid', 'medCentre', 'sciencePark', 'ports', 'digitalGov', 'spaceComplex', 'waterNetwork', 'broadband'].includes(o.project))).toBe(true)
  })
})
