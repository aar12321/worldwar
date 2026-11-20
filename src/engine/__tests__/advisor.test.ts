import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { advise } from '../advisor'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(3)
const ids = (list: ReturnType<typeof advise>) => list.map((a) => a.id)

describe('the advisor', () => {
  it('puts a famine above everything else', () => {
    const s = startState(map)
    s.nations.r0.foodShortage = true
    s.nations.r0.resources.food = 0
    const list = advise(s, map, 'r0')
    expect(list[0].id).toBe('starving')
    expect(list[0].urgency).toBe('now')
    expect(list[0].target).toMatchObject({ desk: 'economy', tab: 'country' })
  })

  it('warns how many months of food or money are left', () => {
    const s = startState(map)
    setMilitary(s, 'r0', { infantry: 120 })
    s.nations.r0.resources.food = 10
    s.nations.r0.resources.capital = 30
    const list = advise(s, map, 'r0', [], 12)
    expect(list.find((a) => a.id === 'food')?.title).toMatch(/Food runs out in \d+ month/)
    expect(list.find((a) => a.id === 'deficit')?.title).toMatch(/Money runs out in \d+ month/)
  })

  it('points at a cracked Defense Line when the odds are good', () => {
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 30, armor: 8, air: 5 })
    setMilitary(s, 'r1', { infantry: 2 })
    s.regions.r1.line = 1
    const press = advise(s, map, 'r0', [], 12).find((a) => a.id === 'press')
    expect(press?.urgency).toBe('now')
    expect(press?.target).toEqual({ desk: 'warRoom', region: 'r1' })
  })

  it('tells a weak attacker to build up instead', () => {
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 1 })
    setMilitary(s, 'r1', { infantry: 40, armor: 10 })
    const list = ids(advise(s, map, 'r0', [], 12))
    expect(list).toContain('outgunned')
    expect(list).toContain('threat')
    expect(list).not.toContain('press')
  })

  it('suggests the weakest neighbor only when it is clearly beatable', () => {
    const strong = startState(map)
    setMilitary(strong, 'r0', { infantry: 30, armor: 8 })
    setMilitary(strong, 'r1', { infantry: 1 })
    expect(advise(strong, map, 'r0', [], 12).find((a) => a.id === 'expand')?.target).toEqual({ desk: 'map', region: 'r1' })
    const weak = startState(map)
    setMilitary(weak, 'r0', { infantry: 1 })
    setMilitary(weak, 'r1', { infantry: 30 })
    expect(ids(advise(weak, map, 'r0', [], 12))).not.toContain('expand')
  })

  it('never returns more than the limit and never repeats an item', () => {
    const s = startState(map)
    const list = advise(s, map, 'r0', [], 3)
    expect(list.length).toBeLessThanOrEqual(3)
    expect(new Set(ids(list)).size).toBe(list.length)
  })

  it('says nothing for a dead nation', () => {
    const s = startState(map)
    s.nations.r1.alive = false
    expect(advise(s, map, 'r1')).toEqual([])
  })
})

describe('the advisor on the new systems', () => {
  it('warns about oil, goods and the market', () => {
    const s = startState(map)
    s.nations.r0.oilShortage = true
    s.nations.r0.goodsShortage = true
    const list = advise(s, map, 'r0', [], 12)
    expect(ids(list)).toContain('no-oil')
    expect(ids(list)).toContain('no-goods')
    expect(list.find((a) => a.id === 'no-oil')?.target).toMatchObject({ desk: 'economy', tab: 'market' })
  })

  it('says when the treasury is about to default', () => {
    const s = startState(map)
    s.nations.r0.inDebt = true
    s.nations.r0.debt = 200
    s.nations.r0.redMonths = 2
    expect(advise(s, map, 'r0', [], 12).find((a) => a.id === 'default')?.urgency).toBe('now')
  })

  it('reminds a democracy about an election it might lose', () => {
    const s = startState(map)
    s.nations.r0.government = 'democracy'
    s.nations.r0.nextElection = s.turn + 3
    s.nations.r0.stability = 40
    const e = advise(s, map, 'r0', [], 12).find((a) => a.id === 'election')
    expect(e?.title).toMatch(/3 months/)
    // The button opens Government on Laws, where the election and its bar are.
    expect(e?.target).toEqual({ desk: 'economy', tab: 'government', gov: 'constitution' })
    s.nations.r0.stability = 90
    expect(ids(advise(s, map, 'r0', [], 12))).not.toContain('election')
  })

  it('suggests growing a city and backing a business when there is money to spare', () => {
    const s = startState(map)
    s.regions.r0.population = 60
    s.nations.r0.resources.capital = 900
    const list = ids(advise(s, map, 'r0', [], 20))
    expect(list).toContain('city')
    expect(list).toContain('business')
  })
})

describe('the advisor on care for the people and projects', () => {
  const big = lineMap(8)
  const rich = () => {
    const s = startState(big)
    s.nations.r0.resources.capital = 900
    s.nations.r0.resources.pp = 100
    s.nations.r0.taxRate = 0.25
    return s
  }

  it('says why stability is slipping, and points at the breakdown', () => {
    const s = rich()
    s.nations.r0.stability = 25
    const list = advise(s, big, 'r0', [], 30)
    const unrest = list.find((a) => a.id === 'unrest')!
    expect(unrest.target).toEqual({ desk: 'economy', tab: 'people', section: 'overview' })
    expect(unrest.action).toBe('See why')
  })

  it('suggests spending on calm when stability is middling and nothing is being done about it', () => {
    const s = rich()
    s.nations.r0.stability = 50
    const hint = advise(s, big, 'r0', [], 30).find((a) => a.id === 'calm-programs')
    expect(hint?.target).toEqual({ desk: 'economy', tab: 'people', section: 'safety' })
    // Once a program is running the nudge goes quiet.
    s.nations.r0.social = { festivals: { level: 1, strength: 1, changed: -1 } }
    expect(ids(advise(s, big, 'r0', [], 30))).not.toContain('calm-programs')
  })

  it('suggests a celebration when calm is low and it is available, but not while one is running', () => {
    const s = rich()
    s.nations.r0.stability = 40
    expect(ids(advise(s, big, 'r0', [], 30))).toContain('celebration')
    s.nations.r0.campaigns = { celebration: { left: 3, cooldown: 10 } }
    expect(ids(advise(s, big, 'r0', [], 30))).not.toContain('celebration')
  })

  it('suggests a cultural centre for conquered land that is still settling', () => {
    const s = rich()
    s.regions.r1.owner = 'r0'
    s.regions.r1.integration = 0.2
    const hint = advise(s, big, 'r0', [], 30).find((a) => a.id === 'cultural-centre')
    expect(hint?.target).toMatchObject({ desk: 'economy', tab: 'projects', region: 'r1' })
    s.regions.r1.works = { culturalCentre: { progress: 1, done: false, by: 'r0' } }
    expect(ids(advise(s, big, 'r0', [], 30))).not.toContain('cultural-centre')
  })

  it('suggests building up a project once every open one is built', () => {
    // On the real map, where a country has a real surplus to spend.
    const world = getWorld().map
    const s = createInitialState(world, { playerRegionId: 'france', seed: 5, victoryShare: 0.4, goal: 'world', difficulty: 'normal' })
    s.nextEventTurn = 9999
    const n = s.nations[s.playerId]
    n.resources.capital = 3000
    for (const id of ['rail', 'grid', 'waterNetwork', 'stadium', 'broadband', 'grainReserve'] as const) n.projects[id] = { progress: 99, done: true }
    const list = advise(s, world, s.playerId, [], 40)
    expect(ids(list)).not.toContain('project')
    const up = list.find((a) => a.id === 'project-up')
    expect(up?.title).toMatch(/^Build up the /)
    expect(up?.target).toEqual({ desk: 'economy', tab: 'projects' })
    // Not with an empty purse.
    n.resources.capital = 100
    expect(ids(advise(s, world, s.playerId, [], 40))).not.toContain('project-up')
  })
})

describe('first-game goals', () => {
  it('are ticked off by what the player actually does', () => {
    let s = startState(map)
    s.nations.r0.resources.capital = 500
    s.nations.r0.resources.pp = 100
    expect(s.nations.r0.milestones ?? []).toEqual([])
    applyOrderNow(s, map, { type: 'build', nationId: 'r0', regionId: 'r0', building: 'farm' })
    applyOrderNow(s, map, { type: 'queueTrain', nationId: 'r0', unit: 'infantry' })
    applyOrderNow(s, map, { type: 'declareWar', nationId: 'r0', target: 'r1' })
    expect(s.nations.r0.milestones).toEqual(['build', 'train', 'war'])
    setMilitary(s, 'r0', { infantry: 40, armor: 10, air: 6 })
    setMilitary(s, 'r1', { infantry: 1 })
    s.regions.r1.line = 0.5
    applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin' })
    expect(s.nations.r0.milestones).toContain('win')
    expect(s.nations.r0.milestones).toContain('capture')
    s = resolveTurn(s, map, [])
    expect(s.nations.r1.milestones ?? []).toEqual([])
  })
})
