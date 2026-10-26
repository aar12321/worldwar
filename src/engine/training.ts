import { BASE_TRAIN_SLOTS, TRAIN_MONTHS, UNIT_SPECS } from '../data/unitTypes'
import { addLog } from './helpers'
import type { GameState, NationId, TrainingJob, UnitType } from './types'

/** Units that can train at once: a base number plus one per barracks level. */
export function trainingSlots(s: GameState, nationId: NationId): number {
  let barracks = 0
  for (const r of Object.values(s.regions)) if (r.owner === nationId) barracks += r.buildings.barracks
  return BASE_TRAIN_SLOTS + barracks
}

/** Puts one trained unit into the nation's military. A new recruit is green, so it pulls the drill of that type down. */
export function addUnitToMilitary(s: GameState, nationId: NationId, unit: UnitType) {
  const m = s.nations[nationId].military
  const have = m.units[unit]
  m.drill[unit] = Math.round((m.drill[unit] * have) / (have + 1))
  m.units[unit] = have + 1
}

/**
 * Advances every training queue by one month. Each nation works on its first jobs, up to its training slots.
 * A finished unit joins the military and can fight at once.
 */
export function tickTraining(s: GameState) {
  const queue = s.trainingQueue ?? []
  if (queue.length === 0) return
  const next: TrainingJob[] = []
  const used = new Map<NationId, number>()
  for (const job of queue) {
    const nation = s.nations[job.nationId]
    if (!nation?.alive) continue
    const slots = trainingSlots(s, job.nationId)
    const taken = used.get(job.nationId) ?? 0
    if (taken >= slots) {
      next.push(job)
      continue
    }
    used.set(job.nationId, taken + 1)
    const remaining = job.remaining - 1
    if (remaining > 0) {
      next.push({ ...job, remaining })
      continue
    }
    addUnitToMilitary(s, job.nationId, job.unit)
    if (nation.isPlayer) addLog(s, 'info', `${UNIT_SPECS[job.unit].name} finished training and joined your military.`, [job.nationId])
  }
  s.trainingQueue = next
}

export function trainMonths(unit: UnitType): number {
  return TRAIN_MONTHS[unit]
}
