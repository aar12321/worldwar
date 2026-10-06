import { TECH_BY_ID } from '../data/techTree'
import { addLog } from './helpers'
import type { GameState, NationId } from './types'

export type TechStatus = 'owned' | 'available' | 'locked'

export function techStatus(s: GameState, nationId: NationId, techId: string): TechStatus {
  const n = s.nations[nationId]
  if (n.techs.includes(techId)) return 'owned'
  const t = TECH_BY_ID[techId]
  return t.requires.every((r) => n.techs.includes(r)) ? 'available' : 'locked'
}

export function research(s: GameState, nationId: NationId, techId: string): boolean {
  const n = s.nations[nationId]
  const t = TECH_BY_ID[techId]
  if (!t || n.techs.includes(techId) || !t.requires.every((r) => n.techs.includes(r))) return false
  if (n.resources.tp < t.cost) return false
  n.resources.tp -= t.cost
  n.techs.push(techId)
  if (n.isPlayer || t.tier >= 5) addLog(s, 'tech', `${n.name} has developed ${t.name}.`, [nationId])
  return true
}
