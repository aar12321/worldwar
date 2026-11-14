import { armyAt } from '../engine/armies'
import { absDate } from '../engine/calendar'
import type { Army } from '../engine/types'
import { useGame } from '../store'
import { globeBridge } from './globeBridge'

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** What an army is doing, in a few words. */
export function armyStatus(a: Army, now: number): string {
  const left = Math.max(0, Math.ceil(a.end - now))
  if (a.phase === 'fighting') return 'Fighting'
  if (a.phase === 'returning') return `Home ${absDate(a.end)} · ${days(left)}`
  if (now < a.start) return `Mustering · sets out ${absDate(a.start)}`
  return `Arrives ${absDate(a.end)} · ${days(left)}`
}

/** Moves the camera over an army, wherever it is on its way. */
export function showArmy(a: Army, now: number) {
  const at = armyAt(a, now)
  globeBridge.api?.pointOfView({ lat: at.lat, lng: at.lng, altitude: 1.3 }, useGame.getState().settings.reducedMotion ? 0 : 700)
}
