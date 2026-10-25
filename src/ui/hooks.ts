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

const viewCache = new WeakMap<GameState, { orders: Order[]; view: PlayerView }>()

/** Every component asks for the view; the economy is worked out once per game state and order list. */
function playerViewFor(game: GameState, orders: Order[]): PlayerView {
  const hit = viewCache.get(game)
  if (hit && hit.orders === orders) return hit.view
  const view = buildPlayerView(game, orders)
  viewCache.set(game, { orders, view })
  return view
}

export function usePlayerView(): PlayerView | null {
  const game = useGame((s) => s.game)
  const orders = useGame((s) => s.orders)
  return useMemo(() => (game ? playerViewFor(game, orders) : null), [game, orders])
}

function buildPlayerView(game: GameState, orders: Order[]): PlayerView {
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
}

const visionCache = new WeakMap<GameState, Set<RegionId> | 'all'>()

/** The player's fog of war, recomputed only when the game state changes. */
export function usePlayerVision(): Set<RegionId> | 'all' {
  const game = useGame((s) => s.game)
  return useMemo(() => {
    if (!game) return new Set<RegionId>()
    const hit = visionCache.get(game)
    if (hit) return hit
    const vision = visibleRegions(game, getWorld().map, game.playerId)
    visionCache.set(game, vision)
    return vision
  }, [game])
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
