import { describe, it } from 'vitest'
import { computeEconomy } from '../economy'
import { orderCost } from '../orders'
import type { Difficulty, Order } from '../types'
import { playWorld } from './strategySim'

/**
 * Opt-in measurement (not run by the suite): what bots spend on aircraft development, missiles, warheads and space, and how often nuclear
 * weapons are used, over whole all-bot games.
 *
 *   VITE_SPEND=hard VITE_SPEND_SEEDS=1,2,3 VITE_SPEND_MONTHS=120 npx vitest run src/engine/__tests__/botSpend.test.ts --silent=false
 *
 * Prints one SPEND line per game: for each kind of order the number of orders and the money they cost, the money all bots earned, and
 * the share the measured spending took of it.
 */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env
const suite = env.VITE_SPEND ? describe : describe.skip

suite('what bots spend on missiles, aircraft, warheads and space', () => {
  const difficulty = (env.VITE_SPEND ?? 'hard') as Difficulty
  const seeds = (env.VITE_SPEND_SEEDS ?? '1,2,3').split(',').map(Number)
  const months = Number(env.VITE_SPEND_MONTHS ?? 120)
  const KINDS: Order['type'][] = ['startAircraftDev', 'fundMissiles', 'buildMissiles', 'buildWarhead', 'nuke', 'strike', 'space']
  for (const seed of seeds)
    it(`${difficulty} seed ${seed}`, () => {
      const count: Record<string, number> = {}
      const money: Record<string, number> = {}
      let earned = 0
      const { result, state } = playWorld({
        seed,
        difficulty,
        months,
        probe: (s, orders) => {
          for (const o of orders) {
            if (!KINDS.includes(o.type)) continue
            count[o.type] = (count[o.type] ?? 0) + 1
            try {
              money[o.type] = (money[o.type] ?? 0) + orderCost(s, o).capital
            } catch {
              /* a cost that cannot be read now */
            }
          }
          for (const n of Object.values(s.nations)) if (n.alive && !n.isPlayer) earned += Math.max(0, computeEconomy(s, getMap(), n.id).gross)
        },
      })
      const spent = Object.values(money).reduce((a, b) => a + b, 0)
      console.log('SPEND ' + JSON.stringify({ difficulty, seed, months, count, money: Object.fromEntries(Object.entries(money).map(([k, v]) => [k, Math.round(v)])), earned: Math.round(earned), share: earned ? +(spent / earned).toFixed(4) : 0, alive: result.alive, nukesInAir: state.nukes?.length ?? 0, nukeLast: state.nukeLast ?? null }))
    }, 3_600_000)
})

import { getWorld } from '../../map/world'
function getMap() {
  return getWorld().map
}
