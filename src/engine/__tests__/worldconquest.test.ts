import { describe, expect, it } from 'vitest'
import { EMPIRE } from '../../data/war'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { checkOutcome, holdsTheWorld, humanStatus } from '../victory'
import { maxWars } from '../helpers'
import { validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import { transferRegion } from '../warfare'
import { lineMap, setMilitary } from './fixtures'

const map = lineMap(6)
const fresh = () => {
  const s = createInitialState(map, { playerRegionId: 'r0', seed: 1 })
  s.nextEventTurn = 9999
  return s
}

describe('World Conquest', () => {
  it('is the goal of a new game', () => {
    expect(fresh().settings.goal).toBe('world')
  })

  it('is not won by taking a few countries or a share of the people', () => {
    const s = fresh()
    for (const id of ['r1', 'r2', 'r3']) s.regions[id].owner = 'r0'
    for (const id of ['r1', 'r2', 'r3']) s.nations[id].alive = false
    expect(checkOutcome(s)).toBe('playing')
  })

  it('is won when every other country is yours or a puppet of yours, however deep', () => {
    const s = fresh()
    for (const id of ['r1', 'r2']) {
      s.regions[id].owner = 'r0'
      s.nations[id].alive = false
    }
    s.nations.r3.overlord = 'r0'
    s.nations.r4.overlord = 'r3'
    expect(holdsTheWorld(s, 'r0')).toBe(false)
    s.nations.r5.overlord = 'r4'
    expect(holdsTheWorld(s, 'r0')).toBe(true)
    expect(checkOutcome(s)).toBe('victory')
    expect(s.winner).toBe('r0')
    expect(humanStatus(s, 'r0')).toBe('won')
  })

  it('lets a bigger empire fight more wars at once', () => {
    const s = fresh()
    expect(maxWars(s, 'r0')).toBe(3)
    const big = createInitialState(getWorld().map, { playerRegionId: Object.keys(getWorld().map.regions)[0], seed: 2 })
    const me = big.playerId
    for (const id of Object.keys(big.regions).slice(1, 40)) big.regions[id].owner = me
    expect(maxWars(big, me)).toBeGreaterThan(3)
    expect(maxWars(big, me)).toBeLessThanOrEqual(EMPIRE.maxWarsCap)
  })

  it('a nation whose capital falls with no army left surrenders whole', () => {
    const s = fresh()
    s.nations.r3.capital = 'r3'
    s.regions.r4.owner = 'r3'
    setMilitary(s, 'r3', { infantry: 0.5 })
    transferRegion(s, map, 'r3', 'r0')
    expect(s.regions.r4.owner).toBe('r0')
    expect(s.nations.r3.alive).toBe(false)
  })

  it('a nation that still has an army fights on after losing its capital', () => {
    const s = fresh()
    s.regions.r4.owner = 'r3'
    setMilitary(s, 'r3', { infantry: 30 })
    transferRegion(s, map, 'r3', 'r0')
    expect(s.regions.r4.owner).toBe('r3')
    expect(s.nations.r3.alive).toBe(true)
  })

  it('a puppet can be annexed once it has served, for influence', () => {
    const s = fresh()
    s.nations.r2.overlord = 'r0'
    s.nations.r2.overlordSince = s.turn
    s.nations.r0.resources.pp = 100
    const order = { type: 'annexPuppet', nationId: 'r0', target: 'r2' } as const
    expect(validateOrder(s, map, order)).toMatch(/must serve/)
    s.turn += EMPIRE.annexMonths
    expect(validateOrder(s, map, order)).toBeNull()
    const next = resolveTurn(s, map, [order])
    expect(next.regions.r2.owner).toBe('r0')
    expect(next.nations.r2.alive).toBe(false)
  })

  it('every country on the real map can be reached from every other, by land or sea', () => {
    const { map: world } = getWorld()
    const ids = Object.keys(world.regions)
    const seen = new Set<string>([ids[0]])
    const queue = [ids[0]]
    while (queue.length) {
      const at = queue.pop()!
      for (const n of [...world.regions[at].neighbors, ...world.regions[at].seaLanes]) {
        if (!seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
      }
    }
    expect(ids.filter((id) => !seen.has(id))).toEqual([])
  })
})
