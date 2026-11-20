import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { MPROG } from '../../data/missileProgram'
import { AI_TRUCE } from '../../data/missileWar'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { pairKey } from '../helpers'
import { newProgram } from '../missileProgram'
import { resolveTurn } from '../resolveTurn'
import type { Difficulty, GameState, Order } from '../types'

/**
 * How often rivals offer missile ceasefires (AI_TRUCE) and put interceptor rounds on their program lines (MPROG.aiInterceptorLine) over
 * two years on the real world, bots in every seat (a bot plays the player's nation too, so it strikes and answers offers as a player
 * who plays the missile war would). Prints one line per run for docs/MISSILE_PROGRAM_STATUS.md. Seeds: VITE_AITRUCE_SEEDS (default "5").
 */
const people = (s: GameState, id: string) => Object.values(s.regions).filter((r) => r.owner === id).reduce((sum, r) => sum + r.population, 0)

/**
 * The stressed world of missileWarSim.test.ts: the eight most populous nations (India, the player's nation, among them) in two camps at war,
 * each with money, a level-3 charter, a store of missiles and a shield, and here also a program with an institute, a production plant and
 * interceptor works, its interceptor store emptied. The natural world rarely fires a missile in two years, and no rival program has a plant and works by then.
 */
function worldWar(s: GameState) {
  const big = Object.values(s.nations)
    .filter((n) => n.alive)
    .sort((a, b) => people(s, b.id) - people(s, a.id) || (a.id < b.id ? -1 : 1))
    .slice(0, 8)
  big.forEach((a, i) => big.forEach((b, j) => i < 4 && j >= 4 && s.wars.push(pairKey(a.id, b.id))))
  s.wars.sort()
  for (const n of big) {
    n.resources.capital += 3000
    n.resources.steel += 500
    n.resources.oil += 200
    n.missileProgram = 3
    n.arsenal = { cruise: 12, tactical: 12, ballistic: 6, decoy: 12 }
    n.military.units.missile = 8
    n.military.units.air = Math.max(n.military.units.air, 3)
    n.military.units.fighter = Math.max(n.military.units.fighter, 3)
    n.systems.shield = 2
    n.mprog = { ...newProgram(s), fac: { institute: 1, plant: 1, works: 1 } }
    // Deep in a missile war already: the interceptor stores were emptied by the salvos before the two years start.
    n.missileWar = { ...n.missileWar, interceptors: 0 }
  }
}

function play(difficulty: Difficulty, months: number, seed: number, stress = false) {
  const { map } = getWorld()
  let s: GameState = createInitialState(map, { playerRegionId: 'india', seed, difficulty, goal: 'classic', victoryShare: 2 })
  if (stress) worldWar(s)
  const r = { toPlayer: 0, toPlayerAccepted: 0, toPlayerDeclined: 0, toRivals: 0, lines: 0, rounds: 0, lineNations: new Set<string>(), maxOffersOnePair: 0, offerGapMin: Infinity, strikes: 0 }
  const offered = new Map<string, number[]>()
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    const bots = generateAllBotOrders(s, map)
    const player = generateBotOrders(s, map, s.playerId, true)
    const orders: Order[] = [...bots, ...player]
    for (const o of bots) {
      if (o.type === 'strike' || o.type === 'raid') r.strikes++
      if (o.type === 'missileTruce' && !o.lift) {
        if (o.target === s.playerId) {
          r.toPlayer++
          const k = `${o.nationId}>${o.target}`
          offered.set(k, [...(offered.get(k) ?? []), s.turn])
        } else r.toRivals++
      }
      if (o.type === 'missileProgram' && o.action.kind === 'produce' && o.action.missile === 'interceptor') {
        r.lines++
        r.rounds += o.action.count
        r.lineNations.add(o.nationId)
      }
    }
    for (const o of player) if (o.type === 'respond') {
      const p = s.proposals.find((x) => x.id === o.proposalId)
      if (p?.kind !== 'truce') continue
      if (o.accept) r.toPlayerAccepted++
      else r.toPlayerDeclined++
    }
    s = resolveTurn(s, map, orders)
  }
  for (const turns of offered.values()) {
    r.maxOffersOnePair = Math.max(r.maxOffersOnePair, turns.length)
    for (let i = 1; i < turns.length; i++) r.offerGapMin = Math.min(r.offerGapMin, turns[i] - turns[i - 1])
  }
  return { ...r, lineNations: r.lineNations.size, offerGapMin: Number.isFinite(r.offerGapMin) ? r.offerGapMin : null, tension: Math.round(s.missileTension ?? 0) }
}

const seeds = (import.meta.env.VITE_AITRUCE_SEEDS ?? '5').split(',').map(Number)

describe('rivals offer ceasefires and queue interceptor rounds, within bounds', () => {
  for (const [difficulty, stress] of [['normal', false], ['hard', false], ['normal', true], ['hard', true]] as [Difficulty, boolean][]) {
    for (const seed of seeds) {
      it(`${difficulty}${stress ? ', a world war of missiles' : ''}, seed ${seed}, 24 months`, () => {
        const r = play(difficulty, 24, seed, stress)
        console.info(`aiTruce ${difficulty}${stress ? ' stressed' : ''} seed ${seed}`, JSON.stringify(r))
        // No spam: never two offers to the player from one rival closer than the wait, and at most one in `every` months.
        if (r.offerGapMin !== null) expect(r.offerGapMin).toBeGreaterThanOrEqual(AI_TRUCE.every)
        expect(r.maxOffersOnePair).toBeLessThanOrEqual(Math.ceil(24 / AI_TRUCE.every))
        // Every answer the player's stand-in gave is counted once.
        expect(r.toPlayerAccepted + r.toPlayerDeclined).toBeLessThanOrEqual(r.toPlayer)
        // Lines: a batch a month at most per nation, and never more than the queue holds.
        expect(r.lines).toBeLessThanOrEqual(r.lineNations * 24)
        expect(r.rounds).toBeLessThanOrEqual(r.lines * 20)
      }, 900_000)
    }
  }

  it('switched off, rivals neither offer a player a ceasefire nor queue interceptor rounds', () => {
    const was = { t: AI_TRUCE.on, l: MPROG.aiInterceptorLine }
    AI_TRUCE.on = false
    MPROG.aiInterceptorLine = false
    try {
      const r = play('hard', 12, seeds[0], true)
      console.info('aiTruce hard stressed, switched off, 12 months', JSON.stringify(r))
      expect(r.toPlayer).toBe(0)
      expect(r.lines).toBe(0)
    } finally {
      AI_TRUCE.on = was.t
      MPROG.aiInterceptorLine = was.l
    }
  }, 900_000)
})
