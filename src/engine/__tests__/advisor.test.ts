import { describe, expect, it } from 'vitest'
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
    expect(list[0].target).toMatchObject({ desk: 'economy', tab: 'build' })
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
