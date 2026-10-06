import { useMemo } from 'react'
import { computeEconomy, type EconomyReport } from '../engine/economy'
import { committedCost, type OrderCost } from '../engine/orders'
import type { GameState, Nation, Order } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'

export interface PlayerView {
  game: GameState
  player: Nation
  econ: EconomyReport
  committed: OrderCost
  orders: Order[]
  pendingPolicy: { taxRate: number; draftRate: number }
}

export function usePlayerView(): PlayerView | null {
  const game = useGame((s) => s.game)
  const orders = useGame((s) => s.orders)
  return useMemo(() => {
    if (!game) return null
    const { map } = getWorld()
    const player = game.nations[game.playerId]
    const policy = orders.find((o) => o.type === 'setPolicy')
    const pendingPolicy = policy && policy.type === 'setPolicy' ? { taxRate: policy.taxRate, draftRate: policy.draftRate } : { taxRate: player.taxRate, draftRate: player.draftRate }
    const projectedGame: GameState = policy
      ? { ...game, nations: { ...game.nations, [player.id]: { ...player, ...pendingPolicy } } }
      : game
    return {
      game,
      player,
      econ: computeEconomy(projectedGame, map, player.id),
      committed: committedCost(game, orders),
      orders,
      pendingPolicy,
    }
  }, [game, orders])
}

export const fmt = (v: number, digits = 0) =>
  Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(digits)

export const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${fmt(v, digits)}`
