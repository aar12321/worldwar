/**
 * Relationships in natural bot play: all-bot worlds (the player's seat too, which answers its inbox), events off.
 * Not a test file; `relationsSim.test.ts` runs it when asked for (VITE_RELSIM=1) and writes RELSIM lines.
 * It counts what the rivals do in the desk, and checks the world stays sane: opinions in range, nobody pinned at the ends,
 * no nation hoarding alliances.
 */
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { opinionOf } from '../../ai/opinion'
import { createInitialState } from '../../data/startingNations'
import { RELATIONS } from '../../data/relations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { alliesOf } from '../helpers'
import { resolveTurn } from '../resolveTurn'
import type { Difficulty, GameState, Order } from '../types'

export interface RelSimRun {
  difficulty: Difficulty
  seed: number
  months: number
  on: boolean
  acts: Record<string, number>
  requestsMade: number
  requestsAnswered: number
  plansMade: number
  embassies: number
  programs: number
  alliancesEnd: number
  maxAllies: number
  /** Opinions at the end across every pair of living nations, and across rival to player. */
  pairs: { n: number; mean: number; p5: number; p95: number; atTop: number; atBottom: number }
  toPlayer: { n: number; mean: number; p5: number; p95: number; atTop: number; atBottom: number }
  hash: string
}

function stats(values: number[]) {
  const v = [...values].sort((a, b) => a - b)
  const at = (q: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor(q * v.length)))] ?? 0
  return { n: v.length, mean: Math.round((v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)) * 10) / 10, p5: at(0.05), p95: at(0.95), atTop: v.filter((x) => x >= 90).length, atBottom: v.filter((x) => x <= -90).length }
}

export function relationsBotRun(difficulty: Difficulty, seed: number, months: number, on = true): RelSimRun {
  const { map } = getWorld()
  const was = RELATIONS.on
  RELATIONS.on = on
  try {
    let s: GameState = createInitialState(map, { goal: 'classic', victoryShare: 2, playerRegionId: 'poland', seed, difficulty })
    s.nextEventTurn = 99999
    const acts: Record<string, number> = {}
    let requestsMade = 0
    let requestsAnswered = 0
    let plansMade = 0
    let maxAllies = 0
    for (let i = 0; i < months && s.outcome === 'playing'; i++) {
      if (s.pendingEvent) s = applyEventChoice(s, map, 0)
      const orders: Order[] = [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)]
      for (const o of orders) if (o.type === 'relate') acts[o.act] = (acts[o.act] ?? 0) + 1
      const before = s.relations?.requests.length ?? 0
      const plansBefore = s.relations?.plans.length ?? 0
      s = resolveTurn(s, map, orders)
      requestsMade += orders.filter((o) => o.type === 'relate' && o.act === 'ask').length
      requestsAnswered += orders.filter((o) => o.type === 'relate' && o.act === 'answer').length
      void before
      plansMade += orders.filter((o) => o.type === 'relate' && o.act === 'warPlan').length
      void plansBefore
      for (const n of Object.values(s.nations)) if (n.alive) maxAllies = Math.max(maxAllies, alliesOf(s, n.id).length)
    }
    const alive = Object.values(s.nations).filter((n) => n.alive)
    const ids = alive.map((n) => n.id)
    const pairOps: number[] = []
    // Sample pairs: every nation toward the ten after it in id order, to keep the sim quick.
    for (let i = 0; i < ids.length; i++) for (let k = 1; k <= 10; k++) pairOps.push(opinionOf(s, map, ids[i], ids[(i + k) % ids.length]))
    const toPlayer = ids.filter((id) => id !== s.playerId).map((id) => opinionOf(s, map, id, s.playerId))
    return {
      difficulty,
      seed,
      months,
      on,
      acts,
      requestsMade,
      requestsAnswered,
      plansMade,
      embassies: s.relations?.embassies.length ?? 0,
      programs: s.relations?.programs.length ?? 0,
      alliancesEnd: s.alliances.length,
      maxAllies,
      pairs: stats(pairOps),
      toPlayer: stats(toPlayer),
      hash: String(JSON.stringify(s).length),
    }
  } finally {
    RELATIONS.on = was
  }
}
