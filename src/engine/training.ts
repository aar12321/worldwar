import { TRAIN_MONTHS, UNIT_SPECS } from '../data/unitTypes'
import { addLog, boundArmy, createArmy, emptyUnits } from './helpers'
import { territoryOwner } from './territory'
import type { GameState, NationId, TrainingJob, UnitType, WorldMap } from './types'

/** Puts one trained unit into the army bound to this territory, creating that army if needed. */
export function addUnitAtTerritory(s: GameState, map: WorldMap, nationId: NationId, territoryId: string, unit: UnitType) {
  const t = map.territories[territoryId]
  if (!t) return null
  let army = boundArmy(s, t.id, nationId)
  if (!army) army = createArmy(s, { owner: nationId, location: t.regionId, units: emptyUnits(), homeTerritoryId: t.id })
  army.units[unit] += 1
  return army
}

/**
 * Advances every training queue by one month.
 * Jobs ordered this same resolution wait until the next month.
 * A finished unit joins the territory's army and can fight with it immediately.
 */
export function tickTraining(s: GameState, map: WorldMap) {
  const queue = s.trainingQueue ?? []
  if (queue.length === 0) return
  const next: TrainingJob[] = []
  const advanced = new Set<string>()
  for (const job of queue) {
    const territory = map.territories[job.territoryId]
    const owner = territory ? territoryOwner(s, map, job.territoryId) : null
    const nation = s.nations[job.nationId]
    if (!territory || owner !== job.nationId || !nation?.alive) {
      if (nation?.alive) {
        const spec = UNIT_SPECS[job.unit]
        nation.resources.capital += spec.capitalCost * 0.5
        nation.militaryPool += spec.manpowerCost * 0.5
        if (nation.isPlayer) {
          addLog(s, 'info', `Training of ${spec.name} stopped because the territory was lost. Half the cost was refunded.`, [job.nationId])
        }
      }
      continue
    }
    if (job.clock === 'time' || job.orderedTurn === s.turn) {
      next.push(job)
      continue
    }
    // One slot per territory. Later jobs wait their turn.
    if (advanced.has(job.territoryId)) {
      next.push(job)
      continue
    }
    advanced.add(job.territoryId)
    const remaining = job.remaining - 1
    if (remaining > 0) {
      next.push({ ...job, remaining })
      continue
    }
    const army = addUnitAtTerritory(s, map, job.nationId, job.territoryId, job.unit)
    if (nation.isPlayer && army) {
      const where = army.location === territory.regionId ? territory.name : map.regions[army.location]?.name ?? territory.name
      addLog(s, 'info', `${UNIT_SPECS[job.unit].name} finished training at ${territory.name} and joined the army in ${where}.`, [job.nationId])
    }
  }
  s.trainingQueue = next
}

export function trainMonths(unit: UnitType): number {
  return TRAIN_MONTHS[unit]
}
