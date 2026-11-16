import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { normalizeGame } from '../migrate'
import { validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import { checkOutcome, humanStatus } from '../victory'
import { lineMap, startState } from './fixtures'

/** A small world where r0 and r3 are played by people and the rest are AI. */
function twoHumans(seed = 1) {
  const map = lineMap(6)
  const s = createInitialState(map, { playerRegionId: 'r0', humans: ['r0', 'r3'], seed, victoryShare: 2, goal: 'classic' })
  s.nextEventTurn = 9999
  return { map, s }
}

describe('more than one human', () => {
  it('starts with every human flagged as a player', () => {
    const { s } = twoHumans()
    expect(s.humans).toEqual(['r0', 'r3'])
    expect(s.playerId).toBe('r0')
    expect(s.nations.r0.isPlayer).toBe(true)
    expect(s.nations.r3.isPlayer).toBe(true)
    expect(s.nations.r1.isPlayer).toBe(false)
  })

  it('a single player is the one-human case', () => {
    const s = startState(lineMap(4), 'r1')
    expect(s.humans).toEqual(['r1'])
    expect(s.winner).toBeNull()
    expect(s.eliminated).toEqual([])
  })

  it('never gives orders to a human nation', () => {
    const { map, s } = twoHumans()
    for (let i = 0; i < 6; i++) {
      const orders = generateAllBotOrders(s, map)
      expect(orders.some((o) => o.nationId === 'r0' || o.nationId === 'r3')).toBe(false)
      const next = resolveTurn(s, map, orders)
      Object.assign(s, next)
    }
  })

  it('gives each human a decision of their own, and no month waits for it', () => {
    const { map, s } = twoHumans()
    expect(s.multiplayer).toBe(true)
    s.nextEventTurn = 0
    const next = resolveTurn(s, map, [])
    // Nothing blocks: the single-player slot stays empty and the month moved on.
    expect(next.pendingEvent).toBeNull()
    expect(next.turn).toBe(s.turn + 1)
    const waiting = Object.keys(next.pendingEvents ?? {})
    expect(waiting.length).toBeGreaterThan(0)
    for (const id of waiting) expect(next.humans).toContain(id)
    expect(next.nextEventTurn).toBeGreaterThan(next.turn)
  })

  it('a decision nobody answers is made by the ministers, and the month still resolves', () => {
    const { map, s } = twoHumans()
    s.nextEventTurn = 0
    const next = resolveTurn(s, map, [])
    const after = resolveTurn(next, map, [])
    expect(after.turn).toBe(next.turn + 1)
    expect(Object.keys(after.pendingEvents ?? {})).toEqual([])
    expect(after.log.some((l) => l.text.includes('your ministers chose'))).toBe(true)
  })

  it('a player\'s own answer is used, only for their nation', () => {
    const { map, s } = twoHumans()
    s.nextEventTurn = 0
    const next = resolveTurn(s, map, [])
    const [id] = Object.keys(next.pendingEvents ?? {})
    const other = next.humans.find((h) => h !== id)!
    const orders = [{ type: 'eventChoice' as const, nationId: id, index: 1 }]
    expect(validateOrder(next, map, orders[0])).toBeNull()
    // A bad option and an order for a decision that is not there are refused.
    expect(validateOrder(next, map, { ...orders[0], index: 7 })).not.toBeNull()
    if (!next.pendingEvents?.[other]) expect(validateOrder(next, map, { type: 'eventChoice', nationId: other, index: 0 })).not.toBeNull()
    const after = resolveTurn(next, map, orders)
    expect(after.log.some((l) => l.text.includes('you chose') && l.nations?.includes(id))).toBe(true)
  })

  it('one human left never freezes the month (a fallen rival, or a room of one)', () => {
    const { map, s } = twoHumans()
    s.humans = ['r3']
    s.nextEventTurn = 0
    const next = resolveTurn(s, map, [])
    expect(next.pendingEvent).toBeNull()
    const again = resolveTurn(next, map, [])
    expect(again.turn).toBe(next.turn + 1)
    const solo = createInitialState(map, { playerRegionId: 'r0', seed: 2, victoryShare: 2, online: true })
    expect(solo.multiplayer).toBe(true)
    solo.nextEventTurn = 0
    expect(resolveTurn(solo, map, []).pendingEvent).toBeNull()
  })

  it('still schedules events with one human', () => {
    const map = lineMap(6)
    const s = startState(map, 'r0')
    s.nextEventTurn = 0
    const next = resolveTurn(s, map, [])
    expect(next.nextEventTurn).toBeGreaterThan(0)
  })

  it('the first human to reach the goal wins, and the game says who', () => {
    const { s } = twoHumans()
    s.settings.victoryShare = 0.25
    for (const id of ['r1', 'r2', 'r4']) s.regions[id].owner = 'r3'
    for (const region of Object.values(s.regions)) region.population = 100
    expect(humanStatus(s, 'r0')).toBe('playing')
    expect(checkOutcome(s)).toBe('victory')
    expect(s.winner).toBe('r3')
  })

  it('knocks a beaten human out without ending the game for the others', () => {
    const { s } = twoHumans()
    s.nations.r0.alive = false
    expect(humanStatus(s, 'r0')).toBe('lost')
    expect(checkOutcome(s)).toBe('playing')
    expect(s.humans).toEqual(['r3'])
    expect(s.eliminated).toEqual(['r0'])
    expect(s.nations.r0.isPlayer).toBe(false)
  })

  it('is lost only when every human is out', () => {
    const { s } = twoHumans()
    s.nations.r0.alive = false
    s.nations.r3.alive = false
    expect(checkOutcome(s)).toBe('defeat')
  })

  it('keeps humans separate in a resolved month', () => {
    const { map, s } = twoHumans(3)
    const next = resolveTurn(s, map, [
      { type: 'setPolicy', nationId: 'r0', taxRate: 0.3, draftRate: 0.05, corporateTax: 0.2, budget: s.nations.r0.budget },
      { type: 'setPolicy', nationId: 'r3', taxRate: 0.1, draftRate: 0.02, corporateTax: 0.1, budget: s.nations.r3.budget },
    ])
    expect(next.turn).toBe(s.turn + 1)
    expect(next.nations.r0.taxRate).toBeCloseTo(0.3)
    expect(next.nations.r3.taxRate).toBeCloseTo(0.1)
  })

  it('is deterministic: the same orders give the same month on every screen', () => {
    const a = twoHumans(7)
    const b = twoHumans(7)
    const orders = generateAllBotOrders(a.s, a.map)
    const one = resolveTurn(a.s, a.map, orders)
    const two = resolveTurn(b.s, b.map, generateAllBotOrders(b.s, b.map))
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
  })

  it('old saves open as one-human games', () => {
    const map = lineMap(4)
    const s = startState(map, 'r0') as unknown as Record<string, unknown>
    delete s.humans
    delete s.winner
    delete s.eliminated
    const fixed = normalizeGame(s as never, map)
    expect(fixed.humans).toEqual(['r0'])
    expect(fixed.winner).toBeNull()
    expect(fixed.eliminated).toEqual([])
  })
})
