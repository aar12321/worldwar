import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

/**
 * Pins exactly how turn-based months resolve, so a change that was not meant to alter the rules (a refactor, a cache) shows up here.
 * First pinned before the live mode was added. Re-pinned after the review's rule fixes (combat, coups, money, diplomacy, markets),
 * which change results on purpose. If a rule is changed on purpose, play the scenarios again and pin the new values.
 * Re-pinned when nations got more project slots (two, not one, at the start): the bots build more at once. Checked before pinning:
 * with the old slot counts put back, the old hashes matched, so everything else added then (project levels, projects in a country,
 * social programs, campaigns) changes nothing for a nation that does not use it.
 * The Hard-bot world was pinned again when Hard bots learned to use social programs, campaigns, the new projects and projects in
 * their countries: a deliberate change of what they decide. The Normal-bot world did not move. Pinned again when missiles became a program with several kinds, and struck rivals began to answer.
 * The small-war scenario was pinned again when an attack stopped carrying a share of the missile stock by itself (the bug: mass-produced missiles all flew with the first attack). Its first attack now fires none of the 14 missiles, so 11 are left after the 3-missile strike instead of about 2. Checked: the strike's effect is identical (the target's line is 5.55 either way) and the second attack's line differs only by the changed random draws. The two bot-world pins did not move: no bot in them carried missiles into an attack.
 * The Hard-bot world was pinned once more when Hard bots at war began developing their aircraft (radar, ground crews, coatings: ten starts in
 * the thirty months, by India, Japan, Nigeria, Russia, the USA). Checked before pinning: with that one AI call turned off the old hash matched
 * again, so the aircraft rules themselves (stat bonuses, hunters, reach, the monthly bill and research paid at the start) change nothing for a
 * nation that has not started a development; the Normal-bot world and the small war did not move.
 * Pinned once more after the missile program began to pay its research (it was checked but never charged), which changes what Hard bots at war can afford.
 * Pinned again by the balance audit (docs/BALANCE.md) when the stability from projects in your countries (cultural centres) began to share the
 * one ceiling on care with the programs: a Hard bot that builds a centre feels a slightly smaller stability bonus. Checked before pinning: with that one
 * line put back the previous hash (83c1bd342788b) returned, so the audit's other changes (rushes scaled by the engineers, cruise missiles needing a few
 * to stop factories, the missile stores' ceiling, lines never healed by a strike, nonsense orders refused) move no bot game here.
 * Pinned again when Medium and Hard rivals learned to found and join factions, pay into them and vote (the bots' faction play uses its own random stream). Checked before pinning: with the faction play switched off, the previous hashes matched exactly (1d71ef7fbf0dc5 for the Normal world, and the Hard world's earlier pin after the aircraft and missile changes), so nothing else moved; a game that never founds a faction carries no `factions` field.
 * Pinned once more (Hard-bot world only) when rivals began running space programs: once they know Fifth-Generation Fighters, a Hard bot hires its first engineers, and that moves the state. Checked before pinning: with that one AI call (manageSpace) turned off, the previous hash matched again, so the space rules themselves change nothing for a nation that has no agency; the Normal-bot world and the small war did not move. Final pin of the Hard-bot world is the combination of factions, space and nuclear rivals (merged together; an accidental double-run of strikes in the order phases was removed first, and the small-war pin held).
 * Pinned again for Active Military (forces on station, borders): every bot now posts patrols and garrisons in its first month (a deliberate
 * change of what bots decide), keeps a smaller reserve to attack with, and its garrisons turn provocations back. Checked before pinning:
 * with the bots' posture orders taken out, the Normal-bot world hashes to its old pin exactly, once the memory of border incidents (the
 * new `borders` field) is dropped (see deployment.test.ts), and so did the Hard-bot world and the small war (which uses the same bots) against their pins from just before this change.
 * So nothing else moved: the new rules change nothing for a nation that has never posted forces.
 * Final pins (Normal and Hard worlds) are the combination of factions, space, nuclear rivals and active military merged together; the small-war pin held through every merge, which shows the combined rules add nothing for a nation that uses none of them.
 * Re-pinned (all three) when the AI got its strategic layer (src/ai/strategy.ts: postures, attacks and war targets chosen from the War Room's own
 * forecast, peace timing, missile kinds by target) and stale AI wars began to fizzle after a year: bots decide differently on purpose.
 * Checked before pinning: docs/STRATEGY.md has the measured effect (attacks at poor odds from 44% to under 1%, wars shorter, no stalled fronts).
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

describe('turn mode resolves exactly as pinned', () => {
  it('twelve months of bots on the real world', () => {
    const { s } = botWorld(7, 'normal', 'poland', 12)
    expect(s.turn).toBe(13)
    expect(hash(JSON.stringify(s))).toBe('f204c70c0058a')
  }, 120_000)

  it('thirty months of Hard bots, with wars, battles and strikes', () => {
    const { s, battles } = botWorld(5, 'hard', 'china', 30)
    expect(battles).toBeGreaterThan(0)
    expect(hash(JSON.stringify(s))).toBe('df245a2f24bc9')
  }, 240_000)

  it('a small war with attacks, strikes and a capture', () => {
    const { state, log } = smallWar()
    expect(hash(JSON.stringify(state))).toBe('1bb3d6aea64728')
    expect(hash(JSON.stringify(log))).toBe('165393dceefdcd')
  })

  it('a turn game carries none of the live fields', () => {
    const { state } = smallWar()
    for (const key of ['day', 'armies', 'launches', 'flights']) expect(key in state).toBe(false)
    expect('mode' in state.settings).toBe(false)
  })
})
