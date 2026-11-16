import { GROUND_UNITS, NAVAL_UNITS, AIR_UNITS } from '../data/deployment'
import { borderCover, heatNow, interception } from './deployment'
import { recordOf } from './borders'
import { guessDivisions, hasIntel, showDivisions } from './intel'
import { atWar, forceUnits, hasCasusBelli } from './helpers'
import type { GameState, NationId, UnitType, Via, WorldMap } from './types'
import { canAttackRegion } from './warfare'

/** One rival that could come at a nation, by the way it would come, and how well that way is watched. */
export interface Threat {
  nation: NationId
  route: Via
  level: 'high' | 'watch'
  text: string
}

const ROUTE_ORDER: Via[] = ['land', 'lane', 'fleet', 'air']
const sum = (u: Record<UnitType, number>, kinds: UnitType[]) => kinds.reduce((t, k) => t + u[k], 0)

/**
 * The early warning a nation's watch gives it: every rival at war with it, with a grievance against it, or recently involved in an incident
 * with it, and the way it could reach the nation's countries today: across the border, across a sea lane, over the ocean, or by air.
 * What it says of the rival's strength is exact when the nation has intelligence on it and a rounded guess when it has not.
 */
export function threatWatch(s: GameState, map: WorldMap, id: NationId): Threat[] {
  const out: Threat[] = []
  const mine = Object.values(s.regions).filter((r) => r.owner === id).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const x of Object.keys(s.nations).sort()) {
    const foe = s.nations[x]
    if (x === id || !foe?.alive) continue
    const war = atWar(s, id, x)
    if (!war && !hasCasusBelli(s, x, id) && heatNow(s, recordOf(s, id, x)) <= 0) continue
    // The most direct way they could come: by land first, then across a sea lane, the open ocean, the air.
    let route: Via | null = null
    for (const r of mine) {
      const reach = canAttackRegion(s, map, x, r.id)
      if (reach.ok && reach.via && (route === null || ROUTE_ORDER.indexOf(reach.via) < ROUTE_ORDER.indexOf(route))) route = reach.via
      if (route === 'land') break
    }
    if (!route) continue
    const force = forceUnits(s, x)
    const exact = hasIntel(s, id, x)
    const view = (v: number) => showDivisions(exact ? v : guessDivisions(s, id, x, route!, v), exact)
    if (route === 'land') {
      const cover = borderCover(s, map, id, x)
      out.push({
        nation: x,
        route,
        level: war && cover < 0.5 ? 'high' : 'watch',
        text: `${view(sum(force, GROUND_UNITS))} divisions of ground troops can cross the border${war ? ' and you are at war' : ''}. Your garrison there covers ${Math.round(cover * 100)}% of what it needs.`,
      })
      continue
    }
    const landing = { ...force, infantry: Math.max(1, (force.infantry + force.armor) * 0.5) }
    const share = interception(s, id, route, landing).share
    const ships = view(route === 'air' ? sum(force, AIR_UNITS) : sum(force, NAVAL_UNITS))
    out.push({
      nation: x,
      route,
      level: war && share < 0.1 ? 'high' : 'watch',
      text:
        route === 'air'
          ? `${ships} aircraft can reach you by air${war ? ' and you are at war' : ''}. Your air patrols would shoot down about ${Math.round(share * 100)}% of a landing.`
          : `${ships} warships can land troops on your coast${war ? ' and you are at war' : ''}. Your patrols would sink about ${Math.round(share * 100)}% of a landing${share < 0.01 ? ': your waters are not watched' : ''}.`,
    })
  }
  // Danger first, then by name.
  return out.sort((a, b) => Number(b.level === 'high') - Number(a.level === 'high') || (a.nation < b.nation ? -1 : 1))
}
