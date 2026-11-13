import { describe, expect, it } from 'vitest'
import { EVEN_BUDGET } from '../data/government'
import { DIFFICULTY } from '../data/difficulty'
import { createInitialState } from '../data/startingNations'
import { blocOf, blocsOf } from '../engine/blocs'
import { computeEconomy } from '../engine/economy'
import { applyEventChoice } from '../engine/events'
import { resolveTurn } from '../engine/resolveTurn'
import { createRng } from '../engine/rng'
import type { GameState, Order } from '../engine/types'
import { lineMap, setMilitary, startState } from '../engine/__tests__/fixtures'
import { getWorld } from '../map/world'
import { buildTurnContext, generateAllBotOrders, generateBotOrders, peaceTerms } from './bot'
import { manageCountry, wantedBudget, wantedCorporateTax } from './management'

const map = lineMap(6)

describe('the three tiers', () => {
  it('differ in what they manage, how many allies they keep, and whether they gang up on you', () => {
    expect(DIFFICULTY.easy.skill).toBe(0)
    expect(DIFFICULTY.normal.skill).toBe(1)
    expect(DIFFICULTY.hard.skill).toBe(2)
    expect(DIFFICULTY.easy.maxAlliances).toBeLessThan(DIFFICULTY.hard.maxAlliances)
    expect(DIFFICULTY.easy.coalitions).toBe(false)
    expect(DIFFICULTY.normal.coalitions && DIFFICULTY.hard.coalitions).toBe(true)
    expect(DIFFICULTY.normal.name).toBe('Medium')
    expect(DIFFICULTY.easy.playerGracePeriod).toBeGreaterThan(DIFFICULTY.hard.playerGracePeriod)
  })

  it('easy rivals never see a coalition against the player', () => {
    const s = startState(map)
    s.settings.difficulty = 'easy'
    expect(buildTurnContext(s, map).coalition).toBe(false)
  })
})

describe('bot management', () => {
  const orders = (s: GameState, id: string, skill: 1 | 2, seed = 1): Order[] => {
    const out: Order[] = []
    const econ = computeEconomy(s, map, id)
    const tryAdd = (o: Order) => {
      out.push(o)
      return true
    }
    manageCountry(s, id, econ, skill, createRng(seed, 1), tryAdd, s.nations[id].resources.capital, new Set(['r1', 'r2']))
    return out
  }

  it('picks a budget that fits the moment', () => {
    const s = startState(map)
    const n = s.nations.r1
    const econ = computeEconomy(s, map, 'r1')
    expect(wantedBudget({ ...n, stability: 30 }, econ, false).health).toBeGreaterThan(0.4)
    expect(wantedBudget(n, econ, true).military).toBeGreaterThan(0.4)
    expect(wantedBudget(n, econ, false).education).toBeGreaterThan(wantedBudget(n, econ, true).education - 0.01)
    const sum = Object.values(wantedBudget(n, econ, true)).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1)
    expect(wantedCorporateTax({ ...n, resources: { ...n.resources, capital: 500 } }, econ)).toBeLessThan(wantedCorporateTax({ ...n, resources: { ...n.resources, capital: 10 } }, econ))
  })

  it('a bot at war passes a war economy, and one in debt borrows only at the top tier', () => {
    const s = startState(map)
    s.wars = ['r1|r2']
    s.nations.r1.resources.pp = 80
    s.nations.r1.resources.capital = 400
    expect(orders(s, 'r1', 1).some((o) => o.type === 'enactLaw' && o.law === 'war_economy')).toBe(true)
    const poor = startState(map)
    poor.nations.r1.resources.capital = 5
    poor.nations.r1.taxRate = 0.05
    setMilitary(poor, 'r1', { infantry: 120 })
    expect(orders(poor, 'r1', 1).some((o) => o.type === 'issueBonds')).toBe(false)
    expect(orders(poor, 'r1', 2).some((o) => o.type === 'issueBonds')).toBe(true)
  })

  it('a bot with money to spare grows a city and backs a business', () => {
    const s = startState(map)
    s.regions.r1.population = 60
    s.nations.r1.resources.capital = 900
    const seen = new Set<string>()
    for (let seed = 1; seed <= 30; seed++) for (const o of orders(s, 'r1', 1, seed)) seen.add(o.type)
    expect(seen.has('developCity')).toBe(true)
    expect(seen.has('fundSector')).toBe(true)
    expect(seen.has('invest')).toBe(false)
    const hard = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) for (const o of orders(s, 'r1', 2, seed)) hard.add(o.type)
    expect(hard.has('invest')).toBe(true)
  })

  it('only the top tier turns a crushing win into a puppet', () => {
    const s = startState(map)
    s.warScore['r1>r2'] = 90
    expect(peaceTerms(s, map, 'r1', 'r2', 90, false, 1).puppet).toBeUndefined()
    expect(peaceTerms(s, map, 'r1', 'r2', 90, false, 2).puppet).toBe(true)
    s.nations.r2.overlord = 'r3'
    expect(peaceTerms(s, map, 'r1', 'r2', 90, false, 2).puppet).toBeUndefined()
  })

  it('easy bots keep the old basics and never touch the new levers', () => {
    const s = startState(map)
    s.settings.difficulty = 'easy'
    s.nations.r1.resources.capital = 900
    s.nations.r1.resources.pp = 90
    s.wars = ['r1|r2']
    const kinds = new Set<string>()
    for (let t = 1; t <= 20; t++) {
      s.turn = t
      for (const o of generateBotOrders(s, map, 'r1')) kinds.add(o.type)
    }
    for (const lever of ['developCity', 'setCityFocus', 'fundSector', 'issueBonds', 'invest', 'enactLaw', 'imposeSanctions']) expect(kinds.has(lever), lever).toBe(false)
  })
})

describe('alliance blocs', () => {
  it('are groups of allies, named for the strongest member', () => {
    const s = startState(map)
    s.alliances = ['r0|r1', 'r1|r2', 'r3|r4']
    setMilitary(s, 'r1', { infantry: 50 })
    const blocs = blocsOf(s)
    expect(blocs).toHaveLength(2)
    const big = blocs.find((b) => b.members.length === 3)!
    expect(big.members).toEqual(['r0', 'r1', 'r2'])
    expect(big.leader).toBe('r1')
    expect(big.name).toBe(`${s.nations.r1.name} bloc`)
    expect(blocOf(s, 'r4')?.members).toEqual(['r3', 'r4'])
    expect(blocOf(s, 'r5')).toBeNull()
    s.nations.r1.alive = false
    expect(blocsOf(s).every((b) => !b.members.includes('r1'))).toBe(true)
  })
})

describe('a world of tiers', () => {
  const { map: world } = getWorld()
  const play = (difficulty: 'easy' | 'normal' | 'hard', turns = 18) => {
    let s = createInitialState(world, { playerRegionId: 'bhutan', seed: 4, victoryShare: 0.4, difficulty })
    for (let i = 0; i < turns && s.outcome === 'playing'; i++) {
      if (s.pendingEvent) s = applyEventChoice(s, world, 0)
      s = resolveTurn(s, world, generateAllBotOrders(s, world))
    }
    const bots = Object.values(s.nations).filter((n) => n.alive && !n.isPlayer)
    const cityLevels = Object.values(s.regions).filter((r) => !s.nations[r.owner]?.isPlayer).reduce((sum, r) => sum + r.cities.reduce((a, c) => a + c.level, 0), 0)
    return {
      cityLevels,
      budgets: bots.filter((n) => BUDGETS.some((k) => Math.abs(n.budget[k] - EVEN_BUDGET[k]) > 0.04)).length,
      laws: bots.reduce((sum, n) => sum + n.laws.length, 0),
      debt: bots.filter((n) => n.debt > 0).length,
      investments: s.investments.length,
      alliances: s.alliances.length,
      blocs: blocsOf(s).length,
      sanctions: s.sanctions.length,
    }
  }
  const BUDGETS = ['military', 'education', 'health', 'infrastructure'] as const

  it('easy rivals leave their cities and budgets alone; medium and hard run them', () => {
    const easy = play('easy')
    const medium = play('normal')
    const hard = play('hard')
    expect(easy.budgets).toBe(0)
    expect(easy.investments).toBe(0)
    expect(medium.budgets).toBeGreaterThan(20)
    expect(hard.budgets).toBeGreaterThan(20)
    expect(medium.cityLevels).toBeGreaterThan(easy.cityLevels)
    expect(hard.cityLevels).toBeGreaterThan(easy.cityLevels)
    expect(medium.investments).toBe(0)
    expect(hard.investments + hard.sanctions + hard.debt).toBeGreaterThan(0)
  }, 120_000)

  it('rivals ally with one another and form blocs on every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const r = play(tier, 24)
      expect(r.alliances, tier).toBeGreaterThan(10)
      expect(r.blocs, tier).toBeGreaterThan(3)
    }
  }, 180_000)
})
