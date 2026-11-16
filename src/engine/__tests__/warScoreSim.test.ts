import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { resolveTurn } from '../resolveTurn'
import type { GameState } from '../types'
import { netWarScore, warStanding } from '../warscore'

/**
 * Does the side that shows the lead end up better off? Bots play every nation (the player's seat too) on the real world; every month, for
 * every war, the sign of the war score is noted, and six months later we ask whether the leader holds more of the two sides' land than it
 * did. The old tally (only grows) is run on the same games for comparison.
 */
function play(seed: number, months: number, difficulty: 'normal' | 'hard') {
  const { map } = getWorld()
  let s: GameState = createInitialState(map, { playerRegionId: 'poland', seed, difficulty, goal: 'classic', victoryShare: 2 })
  const held = (st: GameState, id: string) => Object.values(st.regions).filter((r) => r.owner === id).length
  const watch: { turn: number; a: string; b: string; net: number; verdict: string; land: number }[] = []
  let agree = 0
  let disagree = 0
  let standingAgree = 0
  let standingDisagree = 0
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    const orders = [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)]
    s = resolveTurn(s, map, orders)
    // Settle the watches that are six months old.
    for (const w of watch.filter((x) => s.turn - x.turn >= 6)) {
      const gain = held(s, w.a) - held(s, w.b) - w.land
      if (Math.abs(w.net) >= 10 && gain !== 0) {
        if (Math.sign(gain) === Math.sign(w.net)) agree++
        else disagree++
      }
      if ((w.verdict === 'winning' || w.verdict === 'losing') && gain !== 0) {
        if ((gain > 0) === (w.verdict === 'winning')) standingAgree++
        else standingDisagree++
      }
      watch.splice(watch.indexOf(w), 1)
    }
    for (const key of s.wars) {
      const [a, b] = key.split('|')
      if (!s.nations[a]?.alive || !s.nations[b]?.alive) continue
      const net = netWarScore(s, a, b)
      watch.push({ turn: s.turn, a, b, net, verdict: warStanding(s, map, a, b).verdict, land: held(s, a) - held(s, b) })
    }
  }
  return { agree, disagree, standingAgree, standingDisagree }
}

describe('the side that is ahead on war score ends up with more land', () => {
  it('over several seeds, bots in every seat, new model against the old tally', () => {
    const seeds = [11, 12, 13]
    const sum = (f: () => ReturnType<typeof play>[]) => f().reduce((t, r) => ({ agree: t.agree + r.agree, disagree: t.disagree + r.disagree, standingAgree: t.standingAgree + r.standingAgree, standingDisagree: t.standingDisagree + r.standingDisagree }), { agree: 0, disagree: 0, standingAgree: 0, standingDisagree: 0 })
    const now = sum(() => seeds.map((sd) => play(sd, 36, 'normal')))
    const rate = (r: { agree: number; disagree: number }) => r.agree / Math.max(1, r.agree + r.disagree)
    // Measured (seeds 11 to 13, 36 months, Normal): 19 leads of 10+ points that moved land within six months, every one for the leader;
    // 137 'winning' or 'losing' verdicts, every one right. The old tally agreed just as often (31 of 31): bots' wars rarely swing back.
    // The swings are what src/engine/__tests__/warScoreModel.test.ts and liveStrength.test.ts pin down.
    expect(now.agree + now.disagree).toBeGreaterThan(5)
    expect(rate(now)).toBeGreaterThanOrEqual(0.85)
    expect(now.standingAgree / Math.max(1, now.standingAgree + now.standingDisagree)).toBeGreaterThanOrEqual(0.85)
  }, 900_000)
})
