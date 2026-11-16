import { useMemo } from 'react'
import { enemiesOf, puppetsOf } from '../engine/helpers'
import { factionOf, votesWaiting } from '../engine/factions'
import type { GameState, Order } from '../engine/types'
import { isLive } from '../engine/calendar'
import { useGame } from '../store'
import { useAdvice, useSlowGame } from './hooks'
import { NO_CTX } from './shortcuts'
import type { RegCtx } from './registry'

/** Offers waiting for your answer: not yet answered by an order of yours. */
export function offersWaiting(game: GameState, orders: readonly Order[]): number {
  return game.proposals.filter((p) => p.to === game.playerId && !orders.some((o) => o.type === 'respond' && o.proposalId === p.id)).length
}

/** The registry context for a game, without the advisor's count (the key handler does not need it). */
export function regCtxOf(game: GameState | null, orders: readonly Order[] = [], urgent = 0): RegCtx {
  if (!game) return NO_CTX
  const me = game.nations[game.playerId]
  return {
    game,
    live: isLive(game),
    tier: me?.tier ?? 1,
    offers: offersWaiting(game, orders),
    urgent,
    factionDue: game.factions?.length
      ? votesWaiting(game, game.playerId, orders as Order[]).length + (factionOf(game, game.playerId) ? 0 : game.factions.filter((f) => f.invites.some((i) => i.nation === game.playerId && i.expires >= game.turn)).length)
      : 0,
    wars: enemiesOf(game, game.playerId).length,
    armies: game.armies?.filter((a) => a.nationId === game.playerId).length ?? 0,
    puppets: puppetsOf(game, game.playerId).length,
  }
}

/** The registry context for the screen. It follows the "slow" game, so a quiet live day does not rebuild it. */
export function useRegCtx(): RegCtx {
  const game = useSlowGame()
  const orders = useGame((s) => s.orders)
  const urgent = useAdvice(50).filter((a) => a.urgency === 'now').length
  return useMemo(() => regCtxOf(game, orders, urgent), [game, orders, urgent])
}
