import { formatDivisions, totalUnits } from '../engine/helpers'
import type { Army, Order } from '../engine/types'

/** The general a queued order will leave on this army, or the one already there. */
export function generalChoice(armyId: string, current: string | null, orders: Order[]): string | null {
  const pending = orders.find((o) => o.type === 'assignGeneral' && o.armyId === armyId)
  if (pending && pending.type === 'assignGeneral') return pending.generalId
  return current
}

export function armyMarkerText(army: Army, place: string, away: boolean): { title: string; detail: string } {
  const count = formatDivisions(totalUnits(army.units))
  return {
    title: place,
    detail: away ? `Away · ${count} divisions` : `${count} divisions`,
  }
}
