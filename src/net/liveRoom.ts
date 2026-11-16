import { generateAllBotOrders, generateBotOrders } from '../ai/bot'
import { advanceDay, type LiveStep } from '../engine/live'
import { isMonthEndOrder, validateOrder } from '../engine/orders'
import { applyOrderNow } from '../engine/resolveTurn'
import type { Army, GameState, NationId, Order, WorldMap } from '../engine/types'

/**
 * The rules of a live game shared by several screens. Everything here is a pure function of the game and the orders, so the host
 * and every guest, given the same orders in the same order, reach the same game on every day.
 */

/** A seeded shuffle of the humans, so nobody gains from sending orders a moment sooner. */
export function humanOrder(seed: number, turn: number, ids: NationId[]): NationId[] {
  const key = (id: NationId) => {
    let h = 2166136261 ^ seed ^ Math.imul(turn, 2654435761)
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
    return h >>> 0
  }
  return [...ids].sort((a, b) => key(a) - key(b) || (a < b ? -1 : 1))
}

/** What a later order of the same kind replaces in the waiting list: an answer, a decision, a puppet's rules, a vote. */
function withoutReplaced(waiting: Order[], order: Order): Order[] {
  if (order.type === 'respond') return waiting.filter((o) => !(o.type === 'respond' && o.proposalId === order.proposalId))
  if (order.type === 'eventChoice') return waiting.filter((o) => o.type !== 'eventChoice')
  // A policy or a set of programs is a whole setting: the latest one is the one that counts.
  if (order.type === 'setPolicy' || order.type === 'setPrograms') return waiting.filter((o) => o.type !== order.type)
  if (order.type === 'governPuppet') return waiting.filter((o) => !(o.type === 'governPuppet' && o.target === order.target))
  if (order.type === 'factionVote') return waiting.filter((o) => !(o.type === 'factionVote' && o.proposalId === order.proposalId))
  return waiting
}

export interface CommandResult {
  state: GameState
  /** Why the order cannot be done, in words for the player. Null when it was done. */
  error: string | null
  /** A live attack that set out: the army. */
  army?: Army
  /** True when the order waits for the 1st of next month, false when it took effect now. */
  queued?: boolean
}

/** Why an order cannot be taken into a live game right now, or null. Changes nothing. */
export function checkCommand(prev: GameState, map: WorldMap, order: Order): string | null {
  const nation = (order as { nationId?: NationId } | null)?.nationId
  if (!order || typeof order.type !== 'string' || !nation || !prev.nations[nation]) return 'That order is not understood'
  if (!prev.humans.includes(nation)) return 'That nation is not played by a person'
  if (prev.eliminated.includes(nation) || !prev.nations[nation].alive) return 'Your nation has fallen. You are watching now.'
  if (prev.outcome !== 'playing') return 'The game is over'
  const waiting = prev.liveOrders?.[nation] ?? []
  try {
    return validateOrder(prev, map, order, isMonthEndOrder(prev, order.type) ? withoutReplaced(waiting, order) : waiting)
  } catch (e) {
    return `That order makes no sense (${e instanceof Error ? e.message : 'unknown error'})`
  }
}

/**
 * Takes one player's order into a live game. Orders that happen at once change the game now; the rest join that nation's list for
 * the 1st of the next month. `prev` is never changed.
 */
export function applyCommand(prev: GameState, map: WorldMap, order: Order): CommandResult {
  const bad = checkCommand(prev, map, order)
  if (bad) return { state: prev, error: bad }
  const nation = order.nationId
  const waiting = prev.liveOrders?.[nation] ?? []
  try {
    const s = structuredClone(prev)
    if (isMonthEndOrder(prev, order.type)) {
      ;(s.liveOrders ??= {})[nation] = [...withoutReplaced(waiting, order), order]
      return { state: s, error: null, queued: true }
    }
    const result = applyOrderNow(s, map, order, waiting)
    if (result.error) return { state: prev, error: result.error }
    return { state: s, error: null, army: result.army, queued: false }
  } catch (e) {
    // An order from the network that makes no sense costs its sender the order, not the room the game.
    return { state: prev, error: `That order makes no sense (${e instanceof Error ? e.message : 'unknown error'})` }
  }
}

/** Every human's waiting orders in the order the month's turn sorts them, the same on every screen. */
export function monthOrdersOf(s: GameState): Order[] {
  const waiting = s.liveOrders ?? {}
  return humanOrder(s.seed, s.turn, Object.keys(waiting).sort()).flatMap((id) => waiting[id] ?? [])
}

/** Moves a shared live game on by one day. The AI plans for the nations nobody is at, as well as for all the rivals. */
export function stepRoomDay(prev: GameState, map: WorldMap): LiveStep {
  const ai = prev.liveAi ?? []
  const planner = (s: GameState, m: WorldMap): Order[] => [...generateAllBotOrders(s, m), ...ai.flatMap((id) => (s.nations[id]?.alive ? generateBotOrders(s, m, id, true) : []))]
  const step = advanceDay(prev, map, { monthOrders: monthOrdersOf(prev), planner })
  if (step.monthEnded && step.state.liveOrders) step.state.liveOrders = {}
  return step
}

/** How many players must agree for a clock change to pass: more than half of those here. */
export const votesNeeded = (here: number) => Math.floor(Math.max(1, here) / 2) + 1
