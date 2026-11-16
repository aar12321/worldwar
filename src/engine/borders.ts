import { BORDER } from '../data/deployment'
import { addOpinion } from '../ai/opinion'
import { borderCover, closedBy, garrisonDivisions, heatNow, landBorders, patrolCover } from './deployment'
import { addLog, atWar, clamp, hasCasusBelli, hasPact, isAllied, pairKey } from './helpers'
import type { BorderRecord, GameState, NationId, Order, RegionId, WorldMap } from './types'

/**
 * Borders. Every pair of neighbors, by land or across a sea lane, has a border that is open, fortified, closed or disputed, with a
 * tension from 0 to 100. Tension is worked out from the game as it stands (wars, pacts, garrisons, closures) plus a short memory of
 * incidents (`GameState.borders`), so it needs no monthly bookkeeping and a game that never has an incident carries nothing.
 */

export type BorderKind = 'open' | 'fortified' | 'closed' | 'disputed'

export interface TensionPart {
  label: string
  value: number
}

export interface Tension {
  total: number
  parts: TensionPart[]
}

export interface Neighbor {
  id: NationId
  /** Countries of the first nation along the shared land border, 0 if the two meet only across the sea. */
  land: number
  /** Countries of the first nation with a sea lane to the other. */
  sea: number
}

export const recordOf = (s: Pick<GameState, 'borders'>, a: NationId, b: NationId): BorderRecord | undefined => s.borders?.[pairKey(a, b)]

/** Every nation that shares a land border or a sea lane with `id`, sorted. */
export function neighborsOf(s: GameState, map: WorldMap, id: NationId): Neighbor[] {
  const land = new Map<NationId, Set<RegionId>>()
  const sea = new Map<NationId, Set<RegionId>>()
  const add = (m: Map<NationId, Set<RegionId>>, o: NationId, r: RegionId) => {
    let set = m.get(o)
    if (!set) m.set(o, (set = new Set()))
    set.add(r)
  }
  for (const r of Object.values(s.regions)) {
    if (r.owner !== id) continue
    const mr = map.regions[r.id]
    if (!mr) continue
    for (const nb of mr.neighbors) {
      const o = s.regions[nb]?.owner
      if (o && o !== id && s.nations[o]?.alive) add(land, o, r.id)
    }
    for (const nb of mr.seaLanes) {
      const o = s.regions[nb]?.owner
      if (o && o !== id && s.nations[o]?.alive) add(sea, o, r.id)
    }
  }
  const ids = [...new Set([...land.keys(), ...sea.keys()])].sort()
  return ids.map((x) => ({ id: x, land: land.get(x)?.size ?? 0, sea: sea.get(x)?.size ?? 0 }))
}

/** Whether two nations share a land border. */
export const sharesLandBorder = (s: GameState, map: WorldMap, a: NationId, b: NationId) => (landBorders(s, map, a).get(b) ?? 0) > 0

/** Neither nation has a posture and the border is not closed: there is nothing to add to the old rules. (A past incident only shows in tension; it does not change the dice.) */
const quiet = (s: GameState, a: NationId, b: NationId) => !s.borders?.[pairKey(a, b)]?.closedBy?.length && !s.nations[a]?.military.deployment && !s.nations[b]?.military.deployment

/** The most `borderPressure` could be, worked out without searching the map. */
export function pressureBound(s: GameState, a: NationId, b: NationId): number {
  if (quiet(s, a, b)) return 0
  return BORDER.buildupPerDivision * (garrisonDivisions(s, a, b) + garrisonDivisions(s, b, a)) + BORDER.seaBuildupPerDivision * (patrolOf(s, a) + patrolOf(s, b))
}

/** The part of tension that comes of what the neighbors have posted at each other: troops massed on a land border, warships along a sea one. Games with no posture never have it. */
export function borderPressure(s: GameState, map: WorldMap, a: NationId, b: NationId): number {
  if (quiet(s, a, b)) return 0
  // Garrisons stand only on land borders, so a posted garrison says the border is by land without a search of the map.
  const posted = garrisonDivisions(s, a, b) + garrisonDivisions(s, b, a)
  if (posted > 0) return Math.min(BORDER.buildupCap, BORDER.buildupPerDivision * posted)
  const sea = patrolOf(s, a) + patrolOf(s, b)
  if (sea > 0 && !sharesLandBorder(s, map, a, b)) return Math.min(BORDER.seaBuildupCap, BORDER.seaBuildupPerDivision * sea)
  return 0
}

const patrolOf = (s: GameState, id: NationId) => {
  const c = patrolCover(s, id)
  return c.coastal + c.subs
}

/** How tense the border between two nations is, from 0 to 100, with the reasons. */
export function borderTension(s: GameState, map: WorldMap, a: NationId, b: NationId): Tension {
  const parts: TensionPart[] = []
  const add = (label: string, value: number) => {
    if (Math.abs(value) >= 0.5) parts.push({ label, value: Math.round(value) })
  }
  const land = sharesLandBorder(s, map, a, b)
  add(land ? 'Neighbors by land' : 'Neighbors across the sea', land ? BORDER.baseLand : BORDER.baseSea)
  if (atWar(s, a, b)) add('At war', BORDER.war)
  const heat = heatNow(s, recordOf(s, a, b))
  if (heat > 0) add('Recent incidents', heat)
  if (land) {
    const posted = garrisonDivisions(s, a, b) + garrisonDivisions(s, b, a)
    add('Troops massed on the border', Math.min(BORDER.buildupCap, BORDER.buildupPerDivision * posted))
  } else {
    add('Warships on patrol', Math.min(BORDER.seaBuildupCap, BORDER.seaBuildupPerDivision * (patrolOf(s, a) + patrolOf(s, b))))
  }
  if (s.borders?.[pairKey(a, b)]?.closedBy?.length) add('Border closed', BORDER.closed)
  if (hasCasusBelli(s, a, b) || hasCasusBelli(s, b, a)) add('A grievance', BORDER.grievance)
  if (isAllied(s, a, b)) add('Allies', BORDER.alliance)
  else if (hasPact(s, a, b)) add('Non-aggression pact', BORDER.pact)
  if (s.nations[a]?.overlord === b || s.nations[b]?.overlord === a) add('Puppet and master', BORDER.puppet)
  if (s.deals.some((d) => d.kind === 'trade' && ((d.from === a && d.to === b) || (d.from === b && d.to === a)))) add('Trade partners', BORDER.trade)
  return { total: Math.round(clamp(parts.reduce((t, p) => t + p.value, 0), 0, 100)), parts }
}

/** The state of the border: disputed beats closed beats fortified beats open. */
export function borderState(s: GameState, map: WorldMap, a: NationId, b: NationId, tension = borderTension(s, map, a, b).total): BorderKind {
  if (atWar(s, a, b) || tension >= BORDER.disputed) return 'disputed'
  if (s.borders?.[pairKey(a, b)]?.closedBy?.length) return 'closed'
  if (sharesLandBorder(s, map, a, b)) return Math.max(borderCover(s, map, a, b), borderCover(s, map, b, a)) >= BORDER.fortified ? 'fortified' : 'open'
  return patrolOf(s, a) >= 2 || patrolOf(s, b) >= 2 ? 'fortified' : 'open'
}

/** One neighbor, as the screens show it. `mine` is how well the nation guards that border; `theirs` how well the neighbor guards it. */
export interface BorderView {
  other: NationId
  land: boolean
  fronts: number
  tension: number
  parts: TensionPart[]
  state: BorderKind
  closedByMe: boolean
  closedByThem: boolean
  /** Cover from 0 to 1 and the divisions of garrison behind it. Zero both ways along a sea border. */
  mineCover: number
  mineDivisions: number
  theirCover: number
  theirDivisions: number
}

export function bordersOf(s: GameState, map: WorldMap, id: NationId): BorderView[] {
  return neighborsOf(s, map, id).map((nb) => {
    const t = borderTension(s, map, id, nb.id)
    const land = nb.land > 0
    return {
      other: nb.id,
      land,
      fronts: land ? nb.land : nb.sea,
      tension: t.total,
      parts: t.parts,
      state: borderState(s, map, id, nb.id, t.total),
      closedByMe: closedBy(s, id, nb.id),
      closedByThem: closedBy(s, nb.id, id),
      mineCover: land ? borderCover(s, map, id, nb.id) : 0,
      mineDivisions: land ? garrisonDivisions(s, id, nb.id) : 0,
      theirCover: land ? borderCover(s, map, nb.id, id) : 0,
      theirDivisions: land ? garrisonDivisions(s, nb.id, id) : 0,
    }
  })
}

/**
 * How much more or less likely a border incident is, from what the neighbors have posted. One when neither has a posture, a closure or
 * a recent incident, so games that never use borders roll exactly the dice they always did.
 */
export function incidentFactor(s: GameState, map: WorldMap, a: NationId, b: NationId): number {
  if (quiet(s, a, b)) return 1
  const pressure = borderPressure(s, map, a, b)
  const rec = recordOf(s, a, b)
  const closed = rec?.closedBy?.length ? BORDER.closedIncidents : 0
  const cover = Math.max(borderCover(s, map, a, b), borderCover(s, map, b, a))
  return clamp(1 + pressure * 0.02 - closed * 1 - cover * 0.4, 0.2, BORDER.incidentMax)
}

/** Records an incident on the border: heat that fades over the months. Mutates `s`. */
export function recordIncident(s: GameState, a: NationId, b: NationId) {
  const key = pairKey(a, b)
  const rec = ((s.borders ??= {})[key] ??= {})
  rec.heat = Math.min(BORDER.heatCap, heatNow(s, rec) + BORDER.incidentHeat)
  rec.at = s.turn
  rec.incidents = (rec.incidents ?? 0) + 1
}

// ---- Closing a border ----

type SetBorder = Extract<Order, { type: 'setBorder' }>

export function validateSetBorder(s: GameState, map: WorldMap, o: SetBorder): string | null {
  const other = s.nations[o.neighbor]
  if (!other?.alive || o.neighbor === o.nationId) return 'Choose a neighboring nation'
  if (!neighborsOf(s, map, o.nationId).some((x) => x.id === o.neighbor)) return `${other.name} is not your neighbor`
  const now = closedBy(s, o.nationId, o.neighbor)
  if (o.closed && now) return 'That border is already closed'
  if (!o.closed && !now) return 'That border is not closed'
  if (o.closed && isAllied(s, o.nationId, o.neighbor)) return `${other.name} is your ally`
  if (o.closed && (other.overlord === o.nationId || s.nations[o.nationId].overlord === o.neighbor)) return 'You cannot close the border with your own puppet or master'
  return null
}

export function applySetBorder(s: GameState, o: SetBorder) {
  const key = pairKey(o.nationId, o.neighbor)
  const n = s.nations[o.nationId]
  const other = s.nations[o.neighbor]
  if (o.closed) {
    const rec = ((s.borders ??= {})[key] ??= {})
    rec.closedBy = [...new Set([...(rec.closedBy ?? []), o.nationId])].sort()
    // A closed border is a message. The neighbor remembers it for a while.
    addOpinion(s, o.neighbor, o.nationId, 'Closed our border', BORDER.closedOpinion, 0.3)
    addLog(s, 'info', `${n.name} closed its border with ${other.name}.`, [o.nationId, o.neighbor])
  } else if (s.borders?.[key]) {
    const rec = s.borders[key]
    rec.closedBy = (rec.closedBy ?? []).filter((x) => x !== o.nationId)
    if (!rec.closedBy.length) delete rec.closedBy
    if (rec.heat === undefined && !rec.closedBy) delete s.borders[key]
    if (Object.keys(s.borders).length === 0) delete s.borders
    addLog(s, 'info', `${n.name} reopened its border with ${other.name}.`, [o.nationId, o.neighbor])
  }
}

