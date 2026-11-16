import { create } from 'zustand'
import { COMMITS, type Stance } from '../data/war'
import { compactUnits, shareOfPool } from '../engine/deploy'
import { atWar, territoriesOf } from '../engine/helpers'
import { canAttackRegion } from '../engine/warfare'
import type { GameState, NationId, Order, RegionId, UnitCounts } from '../engine/types'
import { getWorld } from '../map/world'

const KEY = 'ww.territorySend'

function load(): Record<NationId, boolean> {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<NationId, boolean>) : {}
  } catch {
    return {}
  }
}

/**
 * "Send territory forces": whether an attack planned in the War Room also sends a territory's army with the master's own, one switch for each
 * territory. Kept in the browser only: it is a convenience for the person at the screen, not part of the game.
 */
export const useTerritoryPrefs = create<{ send: Record<NationId, boolean>; setSend: (id: NationId, on: boolean) => void }>((set, get) => ({
  send: load(),
  setSend(id, on) {
    const send = { ...get().send, [id]: on }
    set({ send })
    try {
      localStorage.setItem(KEY, JSON.stringify(send))
    } catch {
      // Private windows and blocked storage: the switch still works for this visit.
    }
  },
}))

/** The territories of `me` that are at war with the country's owner and could send an army at `target`. */
export function sendingTerritories(game: GameState, me: NationId, target: RegionId): NationId[] {
  const { map } = getWorld()
  const owner = game.regions[target]?.owner
  return territoriesOf(game, me)
    .filter((id) => !!owner && atWar(game, id, owner) && canAttackRegion(game, map, id, target).ok)
    .sort()
}

/** The order that sends a territory's chosen force: the master's order, wrapping the territory's own attack. */
export function territoryAttack(me: NationId, territory: NationId, target: RegionId, stance: Stance, units: UnitCounts): Order {
  return { type: 'commandTerritory', nationId: me, territory, order: { type: 'attack', nationId: territory, target, stance, units: compactUnits(units) } }
}


/** The force a territory sends when nothing else is chosen: the usual main force of what it has free. */
export const defaultPick = (pool: UnitCounts): UnitCounts => shareOfPool(pool, COMMITS.main.share)
