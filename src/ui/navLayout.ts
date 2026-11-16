/** Which desks the phone's bottom bar shows, and which go behind "More". Pure, so the rule is tested. */

/** One slot is at least this wide, so a 12 px label fits and a thumb can hit it. */
export const SLOT_WIDTH = 60

export const phoneSlots = (width: number): number => Math.max(4, Math.min(8, Math.floor((width - 12) / SLOT_WIDTH)))

export interface PhoneSplit<T> {
  shown: T[]
  more: T[]
  /** Whether the More button takes a slot. */
  hasMore: boolean
}

/**
 * Fits desks into the bar. If they all fit and nothing is pinned they all show. Otherwise the last slot is More and the
 * rest of the desks wait behind it, except that the desk that is open always stays in the bar.
 */
export function splitForPhone<T extends { id: string }>(desks: readonly T[], activeId: string | null, slots: number, hasPins: boolean): PhoneSplit<T> {
  if (desks.length <= slots && !hasPins) return { shown: [...desks], more: [], hasMore: false }
  const room = Math.max(1, slots - 1)
  const shown = desks.slice(0, room)
  const active = desks.find((d) => d.id === activeId)
  if (active && !shown.includes(active)) shown[room - 1] = active
  return { shown, more: desks.filter((d) => !shown.includes(d)), hasMore: true }
}
