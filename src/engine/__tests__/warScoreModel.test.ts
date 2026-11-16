import { describe, expect, it } from 'vitest'
import { advanceDay, startLive } from '../live'
import { resolveTurn } from '../resolveTurn'
import type { BattleReport, GameState } from '../types'
import { transferRegion } from '../warfare'
import { clearWarScore, netWarScore, recordBattle, warBreakdown, warStanding, WARSCORE } from '../warscore'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'
import { withOldWarScore } from './oldWarScore'

const map = lineMap(6)

function war(): GameState {
  const s = startState(map)
  giveRegions(s, 'r0', ['r2', 'r3'])
  giveRegions(s, 'r1', ['r4', 'r5'])
  s.wars.push('r0|r1')
  s.warStarted['r0|r1'] = s.turn
  return s
}

const report = (att: string, def: string, o: Partial<BattleReport> & { attLoss?: number; defLoss?: number } = {}, region = 'r1'): BattleReport => {
  const z = { infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }
  return {
    id: 'b1',
    turn: 1,
    regionId: region,
    attacker: { nationId: att, units: z, losses: { ...z, infantry: o.attLoss ?? 1 } },
    defender: { nationId: def, units: z, losses: { ...z, infantry: o.defLoss ?? 2 } },
    rounds: [],
    winner: o.winner ?? 'attacker',
    captured: o.captured ?? false,
    modifiers: [],
  }
}

/** A real conquest: the region changes hands and the battle is written down, as resolveAttack does. */
function conquer(s: GameState, by: string, from: string, region: string, capital = false) {
  const was = s.regions[region].owner
  expect(was).toBe(from)
  transferRegion(s, map, region, by)
  recordBattle(s, report(by, from, { captured: true }, region), capital)
}

describe('war score follows the war, not just the battles won', () => {
  it('retaking land takes the lead away from the side that had it', () => {
    const s = war()
    conquer(s, 'r0', 'r1', 'r1')
    const ahead = netWarScore(s, 'r0', 'r1')
    expect(ahead).toBeGreaterThan(5)
    // r1 takes it back (and wins the battle).
    transferRegion(s, map, 'r1', 'r1')
    recordBattle(s, report('r1', 'r0', { captured: true }, 'r1'), false)
    expect(netWarScore(s, 'r0', 'r1')).toBeLessThan(ahead - WARSCORE.capture)
  })

  it('the lead from a conquest ends when the land is lost to rebels', () => {
    const s = war()
    conquer(s, 'r0', 'r1', 'r1')
    const ahead = netWarScore(s, 'r0', 'r1')
    s.regions.r1.owner = 'free-r1'
    expect(netWarScore(s, 'r0', 'r1')).toBeLessThan(ahead)
  })

  it('old victories fade as months go by with no fighting', () => {
    let s = war()
    s.nextEventTurn = 9999
    recordBattle(s, report('r0', 'r1', { defLoss: 20 }), false)
    const start = netWarScore(s, 'r0', 'r1')
    expect(start).toBeGreaterThan(10)
    for (let i = 0; i < 12; i++) s = resolveTurn(s, map, [])
    expect(netWarScore(s, 'r0', 'r1')).toBeLessThan(start * 0.7)
  })

  it('a side that keeps winning the battles but loses the land is shown behind', () => {
    const s = war()
    for (let i = 0; i < 6; i++) recordBattle(s, report('r0', 'r1', { winner: 'attacker' }), false)
    const wins = netWarScore(s, 'r0', 'r1')
    // r1 holds on to its land and takes two of r0's countries.
    s.regions.r2.owner = 'r1'
    s.regions.r3.owner = 'r1'
    s.occupied = { r2: 'r0', r3: 'r0' }
    expect(netWarScore(s, 'r0', 'r1')).toBeLessThan(wins - 10)
  })

  it('the capital counts for more than a country', () => {
    const a = war()
    conquer(a, 'r0', 'r1', 'r4')
    const b = war()
    conquer(b, 'r0', 'r1', 'r1', true)
    expect(netWarScore(b, 'r0', 'r1')).toBeGreaterThan(netWarScore(a, 'r0', 'r1'))
  })

  it('both sides at 100 earned do not cancel a real lead', () => {
    const s = war()
    s.warScore['r0>r1'] = 100
    s.warScore['r1>r0'] = 100
    s.occupied = { r4: 'r1' }
    s.regions.r4.owner = 'r0'
    expect(netWarScore(s, 'r0', 'r1')).toBeGreaterThan(0)
  })

  it('stays within -100 and 100 and is the exact opposite from the other side', () => {
    const s = war()
    s.warScore['r0>r1'] = 100
    s.occupied = { r1: 'r1', r4: 'r1', r5: 'r1' }
    for (const id of ['r1', 'r4', 'r5']) s.regions[id].owner = 'r0'
    expect(netWarScore(s, 'r0', 'r1')).toBe(100)
    expect(netWarScore(s, 'r1', 'r0')).toBe(-100)
  })

  it('ends with the war: peace wipes the record and the occupation', () => {
    const s = war()
    conquer(s, 'r0', 'r1', 'r1')
    clearWarScore(s, 'r0', 'r1')
    expect(netWarScore(s, 'r0', 'r1')).toBe(0)
    expect(s.occupied?.r1).toBeUndefined()
  })

  it('a joint army credits every faction member at war with the defender', () => {
    const s = war()
    s.wars.push('r2|r1')
    recordBattle(s, report('r0', 'r1', { defLoss: 5 }), false, ['r2'])
    expect(netWarScore(s, 'r2', 'r1')).toBeGreaterThan(0)
    expect(netWarScore(s, 'r0', 'r1')).toBe(netWarScore(s, 'r2', 'r1'))
  })

  it('a battle can only earn so much, and garrison militia farmed again and again does not pile up forever', () => {
    const s = war()
    recordBattle(s, report('r0', 'r1', { defLoss: 500 }), false)
    expect(netWarScore(s, 'r0', 'r1')).toBeLessThanOrEqual(WARSCORE.battleCap + WARSCORE.battleWin)
  })

  it('the old model is still there behind its switch: scores only grow and land does not move them', () => {
    const s = war()
    withOldWarScore(() => {
      conquer(s, 'r0', 'r1', 'r1')
      const ahead = netWarScore(s, 'r0', 'r1')
      expect(ahead).toBeGreaterThanOrEqual(WARSCORE.capture)
      transferRegion(s, map, 'r1', 'r1')
      expect(netWarScore(s, 'r0', 'r1')).toBe(ahead)
      expect(s.occupied).toBeUndefined()
    })
  })
})

describe('the breakdown and the standing', () => {
  it('the breakdown adds up to the score and names its parts', () => {
    const s = war()
    conquer(s, 'r0', 'r1', 'r1', true)
    conquer(s, 'r0', 'r1', 'r4')
    recordBattle(s, report('r1', 'r0', { winner: 'defender', attLoss: 4, defLoss: 1 }), false)
    const b = warBreakdown(s, map, 'r0', 'r1')
    expect(b.total).toBe(netWarScore(s, 'r0', 'r1'))
    const sum = b.parts.reduce((a, p) => a + p.points, 0)
    expect(Math.abs(sum - b.raw)).toBeLessThan(0.51)
    const ids = b.parts.map((p) => p.id)
    for (const id of ['battles', 'casualties', 'land', 'capital', 'missiles']) expect(ids).toContain(id)
    expect(b.parts.find((p) => p.id === 'capital')!.points).toBeGreaterThan(0)
  })

  it('who is winning is its own verdict: a big score with a collapsing home front is not "winning"', () => {
    const s = war()
    s.warScore['r0>r1'] = 40
    setMilitary(s, 'r0', { infantry: 10 })
    setMilitary(s, 'r1', { infantry: 10 })
    expect(warStanding(s, map, 'r0', 'r1').verdict).toBe('winning')
    s.nations.r0.stability = 12
    s.nations.r0.warWeariness = 55
    s.regions.r0.rebels = 8
    const v = warStanding(s, map, 'r0', 'r1')
    expect(v.verdict).not.toBe('winning')
    expect(v.reasons.join(' ')).toMatch(/unrest|stability|weary|rebel/i)
  })

  it('a lead in points does not hide that the army has been destroyed', () => {
    const s = war()
    s.warScore['r0>r1'] = 30
    setMilitary(s, 'r0', { infantry: 1 })
    setMilitary(s, 'r1', { infantry: 20 })
    expect(warStanding(s, map, 'r0', 'r1').verdict).not.toBe('winning')
  })

  it('works in a live game too', () => {
    const s = startLive(war())
    const step = advanceDay(s, map, { planner: () => [] })
    expect(netWarScore(step.state, 'r0', 'r1')).toBe(0)
  })
})
