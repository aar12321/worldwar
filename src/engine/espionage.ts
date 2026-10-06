import { addLog, hasTech } from './helpers'
import type { Rng } from './rng'
import type { GameState, NationId, RegionId, SpyMission, WorldMap } from './types'

export const SPY = {
  baseSuccess: 0.65,
  satellitePenalty: 0.2,
  sabotageTurns: 3,
  visionTurns: 6,
  failureCasusBelliTurns: 12,
}

export function spySuccessChance(s: GameState, nationId: NationId, target: RegionId): number {
  const owner = s.nations[s.regions[target].owner]
  let p = SPY.baseSuccess
  if (hasTech(owner, 'air_satellites')) p -= SPY.satellitePenalty
  if (hasTech(s.nations[nationId], 'air_satellites')) p += 0.1
  return Math.max(0.1, Math.min(0.95, p))
}

export function runSpyMission(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, mission: SpyMission, rng: Rng) {
  const region = s.regions[target]
  const ownerId = region.owner
  const n = s.nations[nationId]
  const owner = s.nations[ownerId]
  const name = map.regions[target].name
  if (rng.chance(spySuccessChance(s, nationId, target))) {
    if (mission === 'sabotage') {
      region.sabotaged = SPY.sabotageTurns
      addLog(s, 'spy', `${n.name}'s agents sabotaged the factories of ${name}. Output halted for ${SPY.sabotageTurns} months.`, [nationId, ownerId])
    } else {
      n.vision[ownerId] = s.turn + SPY.visionTurns
      addLog(s, 'spy', `${n.name}'s spies stole ${owner.name}'s military maps. Their armies are revealed for ${SPY.visionTurns} months.`, [nationId])
    }
  } else {
    s.casusBelli[`${ownerId}|${nationId}`] = s.turn + SPY.failureCasusBelliTurns
    addLog(s, 'spy', `${owner.name} caught ${n.name}'s spies in ${name}! ${owner.name} gains a casus belli.`, [nationId, ownerId])
  }
}
