import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { advanceDay } from '../live'
import { resolveTurn } from '../resolveTurn'
import type { GameState } from '../types'

export interface AttackRate {
  /** Battles one nation fought against another. Rebel uprisings are not counted: they need no order and no army. */
  battles: number
  /** Of those, the ones that took a country. */
  captures: number
}

/**
 * Plays `months` months on the real world with the AI in every seat, the player's included, and counts the battles fought.
 * Turn mode counts the reports a month's attacks produce; live mode counts the battle events armies produce as they arrive.
 * Both read the same plans from the same bots, so any gap between the two is the clock: marches, recalls, held-back launches.
 */
export function playAttacks(mode: 'turns' | 'live', opts: { seed: number; difficulty: 'easy' | 'normal' | 'hard'; months: number; player?: string }): AttackRate {
  const { map } = getWorld()
  let s: GameState = createInitialState(map, { playerRegionId: opts.player ?? 'china', seed: opts.seed, difficulty: opts.difficulty, goal: 'classic', victoryShare: 2, mode })
  const planner = (st: GameState, m: typeof map) => [...generateAllBotOrders(st, m), ...generateBotOrders(st, m, st.playerId, true)]
  const rate: AttackRate = { battles: 0, captures: 0 }
  if (mode === 'turns') {
    for (let i = 0; i < opts.months && s.outcome === 'playing'; i++) {
      if (s.pendingEvent) s = applyEventChoice(s, map, 0)
      s = resolveTurn(s, map, planner(s, map))
      for (const b of s.battles) {
        if (b.attacker.nationId === 'rebels') continue
        rate.battles++
        if (b.captured) rate.captures++
      }
    }
  } else {
    while (s.turn <= opts.months && s.outcome === 'playing') {
      if (s.pendingEvent) s = applyEventChoice(s, map, 0)
      const step = advanceDay(s, map, { planner })
      s = step.state
      for (const e of step.events) {
        if (e.kind !== 'battle') continue
        rate.battles++
        if (e.report.captured) rate.captures++
      }
    }
  }
  return rate
}
