import { validateOrder } from './orders'
import type { GameState, Order, Proposal, WorldMap } from './types'

/**
 * Whether an offer waiting on a nation can no longer be taken up because the world moved on: a pact offer from someone it is now
 * allied with, peace with someone it is no longer at war with, a call to a war that is over. Such offers used to sit in the inbox
 * with "Cannot accept" until they expired, counted on the Diplomacy badge and in the advisor. A shortfall the nation can fix
 * (money, influence, a box to untick) is not moot. Pure and read-only: nothing in the month's resolution calls it.
 */
export function offerIsMoot(game: GameState, map: WorldMap, p: Proposal, orders: readonly Order[] = []): boolean {
  const others = orders.filter((o) => !(o.type === 'respond' && o.proposalId === p.id))
  const why = validateOrder(game, map, { type: 'respond', nationId: p.to, proposalId: p.id, accept: true }, others as Order[])
  return !!why && !/money|afford|enough|untick|influence/i.test(why)
}
