import { MW } from '../data/missileWar'
import { MISSILES } from '../data/missiles'
import { clamp } from './helpers'
import { launchSite } from './missiles'
import { harmBoost } from './programEffects'
import { harmOf, launchersSeen, mobileCover, raidPlan, salvoDefense, type RaidPlan, type SalvoDefense } from './missileWar'
import type { GameState, MissileType, NationId, RegionId, StrikeAim, WorldMap } from './types'

/** What a salvo is likely to do, before it is fired: the chance each missile gets through and what that does. Pure: nothing is changed. */
export interface StrikeForecast {
  kind: MissileType
  count: number
  aim: StrikeAim
  /** Share of the missiles that get through, 0 to 1, and what stops the rest. */
  chance: number
  defense: SalvoDefense
  /** Expected harm. `dead` is in millions. */
  dead: number
  lossPct: number
  line: number
  army: number
  buildings: number
  factories: boolean
  /** Counterforce: share of the enemy's missiles in store expected to be destroyed, and the launch site's months shut. */
  stock: number
  down: number
  /** The country it would leave from, or null if none reaches. */
  from: RegionId | null
  /** One line for the order tray. */
  text: string
}

export function strikeForecast(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, kind: MissileType, count: number, aim: StrikeAim = 'country', scrambled = false): StrikeForecast | null {
  const region = s.regions[target]
  const victim = s.nations[region?.owner]
  if (!region || !victim || count < 1) return null
  const defense = salvoDefense(s, nationId, victim.id, target, kind, count, scrambled)
  const h = harmOf(kind, count, defense.through, aim, region, mobileCover(victim), launchersSeen(s, s.nations[nationId], victim.id), harmBoost(s.nations[nationId], victim))
  const dead = region.population * h.lossPct
  const chance = defense.through
  const parts = [`${Math.round(chance * 100)}% get through`]
  if (defense.coverage < 0.999) parts.push(`the shield is short of rounds (${defense.stock} for ${Math.ceil(defense.needed)})`)
  if (h.line > 0.05) parts.push(`line -${h.line.toFixed(1)}`)
  if (dead >= 0.05) parts.push(`${dead.toFixed(1)}M dead`)
  if (aim === 'site') parts.push(`${Math.round(h.stock * 100)}% of the store, site shut ${h.down}m`)
  return { kind, count, aim, chance, defense, dead, lossPct: h.lossPct, line: h.line, army: h.army, buildings: h.buildings, factories: h.factories, stock: h.stock, down: h.down, from: launchSite(s, map, nationId, target, kind), text: `${MISSILES[kind].name}: ${parts.join(', ')}` }
}

export interface RaidForecast {
  plan: RaidPlan
  /** Chance a given bomber division comes back, expected aircraft lost (divisions), and expected harm. */
  survive: number
  lost: number
  dead: number
  line: number
  stock: number
  text: string
}

export function raidForecast(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, aim: StrikeAim = 'country', share?: number): RaidForecast | null {
  const region = s.regions[target]
  if (!region || !s.nations[region.owner]) return null
  const plan = raidPlan(s, map, { nationId, target, share })
  const victim = s.nations[region.owner]
  const kind: MissileType = aim === 'site' ? 'tactical' : 'cruise'
  const h = harmOf(kind, plan.survivors * MW.raid.perBomber, 1, aim, region, mobileCover(victim), launchersSeen(s, s.nations[nationId], victim.id))
  const lost = plan.sent * plan.loss + plan.escorts * plan.loss * 0.5
  const dead = region.population * h.lossPct
  const text = `${plan.sent.toFixed(1)} bomber divisions + ${plan.escorts.toFixed(1)} escorts: ${Math.round((1 - plan.loss) * 100)}% get through, ~${lost.toFixed(2)} lost${plan.flak > 0.3 ? ' (batteries)' : ''}${h.line > 0.05 ? `, line -${h.line.toFixed(1)}` : ''}${aim === 'site' ? `, ${Math.round(h.stock * 100)}% of the store` : ''}${dead >= 0.05 ? `, ${dead.toFixed(1)}M dead` : ''}`
  return { plan, survive: clamp(1 - plan.loss, 0, 1), lost, dead, line: h.line, stock: h.stock, text }
}
