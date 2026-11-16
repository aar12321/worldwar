import { useMemo } from 'react'
import { advise, type Advice } from '../engine/advisor'
import { computeEconomy, type EconomyReport } from '../engine/economy'
import { committedCost, type OrderCost } from '../engine/orders'
import type { GameState, Nation, Order, Programs, Spending } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'

export interface PlayerView {
  game: GameState
  player: Nation
  econ: EconomyReport
  committed: OrderCost
  orders: Order[]
  pendingPolicy: { taxRate: number; draftRate: number; corporateTax: number; spending: Spending }
  /** The nation's programs and interest rate with any changes waiting for the month to end. */
  pendingPrograms: Programs
  pendingRate: number
}

/** What a live game changes on a quiet day. Nothing else is touched, so nothing that reads the rest needs to redo its work. */
const CLOCK_KEYS = new Set(['day', 'armies', 'launches', 'flights', 'battles', 'monthStart'])
let slowGame: GameState | null = null

/**
 * The game, except that a day in which only the date moved gives back the game it already had. Desks, the HUD and the
 * advisor read this, so a live game's quiet days cost them nothing. In a turn game it is just the game.
 */
export function settleGame(game: GameState | null): GameState | null {
  if (!game) {
    slowGame = null
    return null
  }
  const prev = slowGame
  if (prev && prev !== game) {
    let same = true
    for (const k of Object.keys(game) as (keyof GameState)[]) {
      if (!CLOCK_KEYS.has(k) && prev[k] !== game[k]) {
        same = false
        break
      }
    }
    if (same) return prev
  }
  slowGame = game
  return game
}

export function useSlowGame(): GameState | null {
  return useGame((s) => settleGame(s.game))
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
  const game = useSlowGame()
  const orders = useGame((s) => s.orders)
  return useMemo(() => (game ? playerViewFor(game, orders) : null), [game, orders])
}

function buildPlayerView(game: GameState, orders: Order[]): PlayerView {
  const { map } = getWorld()
  const player = game.nations[game.playerId]
  const policy = orders.find((o) => o.type === 'setPolicy')
  const pendingPolicy =
    policy && policy.type === 'setPolicy'
      ? { taxRate: policy.taxRate, draftRate: policy.draftRate, corporateTax: policy.corporateTax ?? player.corporateTax, spending: { ...player.spending, ...(policy.spending ?? {}) } }
      : { taxRate: player.taxRate, draftRate: player.draftRate, corporateTax: player.corporateTax, spending: player.spending }
  const projectedGame: GameState = policy
    ? { ...game, nations: { ...game.nations, [player.id]: { ...player, ...pendingPolicy } } }
    : game
  let pendingPrograms: Programs = player.programs
  let pendingRate = player.bank.rate
  for (const o of orders) {
    if (o.type !== 'setPrograms') continue
    pendingPrograms = { ...pendingPrograms, ...o.programs }
    if (o.rate !== undefined) pendingRate = o.rate
  }
  return {
    pendingPrograms,
    pendingRate,
    game,
    player,
    econ: computeEconomy(projectedGame, map, player.id),
    committed: committedCost(game, orders),
    orders,
    pendingPolicy,
  }
}

const adviceCache = new WeakMap<GameState, { orders: Order[]; list: Advice[] }>()

/** The advisor's full list for a game state and order list, worked out once however many screens ask. */
function adviceFor(game: GameState, orders: Order[]): Advice[] {
  const hit = adviceCache.get(game)
  if (hit && hit.orders === orders) return hit.list
  const list = advise(game, getWorld().map, game.playerId, orders, 50)
  adviceCache.set(game, { orders, list })
  return list
}

/** The advisor's list for the player's nation. Each caller takes the first `limit` of one shared list. */
export function useAdvice(limit = 6): Advice[] {
  const game = useSlowGame()
  const orders = useGame((s) => s.orders)
  return useMemo(() => (game ? adviceFor(game, orders).slice(0, limit) : []), [game, orders, limit])
}

export const fmt = (v: number, digits = 0) =>
  Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(digits)

export const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${fmt(v, digits)}`

/**
 * The name of the person playing a nation, when it is another human's (online). Null for AI nations and for your own.
 * Offers to that nation wait in their inbox until they read it, so they are not answered the moment the month ends.
 */
export function useHumanName(nationId: string | null): string | null {
  return useGame((s) => {
    const g = s.game
    if (!g || !nationId || nationId === g.playerId || !g.nations[nationId]?.isPlayer) return null
    return s.online?.lobby?.players.find((p) => p.nationId === nationId)?.name ?? 'another player'
  })
}
