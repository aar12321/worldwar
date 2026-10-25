import { useEffect, useMemo, useState } from 'react'
import { computeEconomy, type EconomyReport } from '../engine/economy'
import { committedCost, type OrderCost } from '../engine/orders'
import type { GameState, Nation, Order, RegionId } from '../engine/types'
import { visibleRegions } from '../engine/visibility'
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

let viewCache: { game: GameState; orders: Order[]; view: PlayerView } | null = null

function viewFor(game: GameState, orders: Order[]): PlayerView {
  if (viewCache && viewCache.game === game && viewCache.orders === orders) return viewCache.view
  const { map } = getWorld()
  const player = game.nations[game.playerId]
  const policy = orders.find((o) => o.type === 'setPolicy')
  const pendingPolicy = policy && policy.type === 'setPolicy' ? { taxRate: policy.taxRate, draftRate: policy.draftRate } : { taxRate: player.taxRate, draftRate: player.draftRate }
  const projectedGame: GameState = policy
    ? { ...game, nations: { ...game.nations, [player.id]: { ...player, ...pendingPolicy } } }
    : game
  const view: PlayerView = {
    game,
    player,
    econ: computeEconomy(projectedGame, map, player.id),
    committed: committedCost(game, orders),
    orders,
    pendingPolicy,
  }
  viewCache = { game, orders, view }
  return view
}

export function usePlayerView(): PlayerView | null {
  const game = useGame((s) => s.game)
  const orders = useGame((s) => s.orders)
  return useMemo(() => (game ? viewFor(game, orders) : null), [game, orders])
}

let visionCache: { game: GameState; vis: Set<RegionId> | 'all' } | null = null

function visionFor(game: GameState): Set<RegionId> | 'all' {
  if (visionCache && visionCache.game === game) return visionCache.vis
  const vis = visibleRegions(game, getWorld().map, game.playerId)
  visionCache = { game, vis }
  return vis
}

/** The player's fog of war, recomputed only when the game state changes. */
export function usePlayerVision(): Set<RegionId> | 'all' {
  const game = useGame((s) => s.game)
  return useMemo(() => (game ? visionFor(game) : new Set<RegionId>()), [game])
}

/** Matches the CSS `@media (max-width)` breakpoints, including the boundary pixel. */
export function useNarrow(max = 1100): boolean {
  const query = `(max-width: ${max}px)`
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setNarrow(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return narrow
}

export const fmt = (v: number, digits = 0) =>
  Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(digits)

export const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${fmt(v, digits)}`
