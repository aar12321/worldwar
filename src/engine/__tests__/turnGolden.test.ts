import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

/**
 * Turn mode must not change when the live mode is added. These hashes were taken from the game as it was before
 * the live mode, so any change to how a turn-based month resolves shows up here. If a rule is changed on purpose,
 * play the scenarios again and pin the new values.
 */

/** A 53-bit string hash (cyrb53). Plenty to notice any change in a saved game. */
function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** Bots play every nation, the player's included, for a number of months on the real world. */
function botWorld(seed: number, difficulty: 'easy' | 'normal' | 'hard', player: string, months: number) {
  const { map } = getWorld()
  let s: GameState = createInitialState(map, { playerRegionId: player, seed, difficulty, goal: 'classic', victoryShare: 2 })
  let battles = 0
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    const orders = [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)]
    s = resolveTurn(s, map, orders)
    battles += s.battles.length
  }
  return { s, battles }
}

/** A small map with a war: attacks made at once and at the end of the month, missile strikes, a capture. */
function smallWar() {
  const map = lineMap(8)
  const s = startState(map)
  s.wars.push('r0|r1', 'r0|r2', 'r0|r3')
  s.nations.r0.resources.capital = 3000
  s.nations.r0.resources.steel = 500
  s.regions.r0.buildings.factory = 1
  s.regions.r1.line = 3
  s.regions.r3.line = 6.4
  setMilitary(s, 'r0', { infantry: 16, armor: 6, artillery: 4, fighter: 3, missile: 14 })
  setMilitary(s, 'r1', { infantry: 3 })
  const log: unknown[] = []
  const now = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault' })
  expect(now.battle?.captured).toBe(true)
  log.push(now.error, now.battle)
  const orders: Order[] = [
    { type: 'strike', nationId: 'r0', target: 'r3', weapon: 'missile', count: 3 },
    { type: 'attack', nationId: 'r0', target: 'r2', commit: 'probe', stance: 'siege' },
  ]
  let cur = resolveTurn(s, map, orders)
  expect(cur.battles.length).toBe(1)
  log.push(cur.battles)
  for (let i = 0; i < 3; i++) cur = resolveTurn(cur, map, generateAllBotOrders(cur, map))
  return { state: cur, log }
}

describe('turn mode is unchanged by the live mode', () => {
  it('twelve months of bots on the real world', () => {
    const { s } = botWorld(7, 'normal', 'poland', 12)
    expect(s.turn).toBe(13)
    expect(hash(JSON.stringify(s))).toBe('3a443e620be73')
  }, 120_000)

  it('thirty months of Hard bots, with wars, battles and strikes', () => {
    const { s, battles } = botWorld(5, 'hard', 'china', 30)
    expect(battles).toBeGreaterThan(0)
    expect(hash(JSON.stringify(s))).toBe('ba5a5814cfbde')
  }, 240_000)

  it('a small war with attacks, strikes and a capture', () => {
    const { state, log } = smallWar()
    expect(hash(JSON.stringify(state))).toBe('11db90ca554233')
    expect(hash(JSON.stringify(log))).toBe('247536ba3819a')
  })

  it('a turn game carries none of the live fields', () => {
    const { state } = smallWar()
    for (const key of ['day', 'armies', 'launches', 'flights']) expect(key in state).toBe(false)
    expect('mode' in state.settings).toBe(false)
  })
})
