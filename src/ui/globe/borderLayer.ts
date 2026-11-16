import { borderState, borderTension, neighborsOf } from '../../engine/borders'
import { borderCover, garrisonDivisions } from '../../engine/deployment'
import { greatCircle } from '../../engine/armies'
import { deploymentView, hasIntel, showDivisions } from '../../engine/intel'
import { atWar, pairKey } from '../../engine/helpers'
import type { GameState, NationId, RegionId, WorldMap } from '../../engine/types'
import { borderLines, chokepoints } from '../../map/world'
import { tensionColor } from '../colors'
import type { PathDatum } from './useArmyLayer'

/** What a station badge shows. */
export type StationGlyph = 'ship' | 'sub' | 'air' | 'guard'

/** One force on station, drawn as a small badge on the globe. */
export interface StationBadge {
  key: string
  lat: number
  lng: number
  glyph: StationGlyph
  /** Divisions, with a tilde when it is a guess. */
  text: string
  color: string
  mine: boolean
  guess: boolean
  title: string
}

/** Nations whose forces on station the player can see: their own, and those they have intelligence on that touch them or fight them. */
function visibleNations(game: GameState, map: WorldMap, player: NationId): { id: NationId; exact: boolean }[] {
  const out: { id: NationId; exact: boolean }[] = [{ id: player, exact: true }]
  for (const nb of neighborsOf(game, map, player)) out.push({ id: nb.id, exact: hasIntel(game, player, nb.id) })
  for (const k of game.wars) {
    const [a, b] = k.split('|')
    const other = a === player ? b : b === player ? a : null
    if (other && game.nations[other]?.alive && !out.some((x) => x.id === other)) out.push({ id: other, exact: true })
  }
  return out
}

const centre = (map: WorldMap, id: RegionId) => ({ lat: map.regions[id].lat, lng: map.regions[id].lng })

/** The country where a nation's fleet sits: its best port, else its capital. */
function navalBase(game: GameState, map: WorldMap, id: NationId): RegionId {
  const n = game.nations[id]
  let best: RegionId | null = null
  let level = 0
  for (const r of Object.values(game.regions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (r.owner !== id || !map.regions[r.id]?.coastal) continue
    if (r.buildings.port > level || (best === null && level === 0)) {
      best = r.id
      level = r.buildings.port
    }
  }
  return best ?? n.capital
}

/** The longest stretch of border between each pair of nations, with the country on each side. */
function borderSpots(game: GameState) {
  const spots = new Map<string, { points: [number, number][]; owners: Record<NationId, RegionId> }>()
  for (const line of borderLines()) {
    const oa = game.regions[line.a]?.owner
    const ob = game.regions[line.b]?.owner
    if (!oa || !ob || oa === ob) continue
    const key = pairKey(oa, ob)
    const old = spots.get(key)
    if (!old || line.points.length > old.points.length) spots.set(key, { points: line.points, owners: { [oa]: line.a, [ob]: line.b } })
  }
  return spots
}

/**
 * The badges for forces on station that the player can see. With intelligence the numbers are exact; without it only the garrison
 * facing the player shows, as a guess, and only when `guesses` is on (the Borders map).
 */
export function stationBadges(game: GameState, map: WorldMap, player: NationId, guesses: boolean): StationBadge[] {
  const out: StationBadge[] = []
  // The map of borders is only worked out when a garrison needs a place to stand.
  let cached: ReturnType<typeof borderSpots> | null = null
  const spots = { get: (key: string) => (cached ??= borderSpots(game)).get(key) }
  for (const v of visibleNations(game, map, player)) {
    const n = game.nations[v.id]
    const d = n?.military.deployment
    if (!n?.alive || !d) continue
    const view = deploymentView(game, player, v.id)
    const mine = v.id === player
    const name = mine ? 'Your' : `${n.name}'s`
    if (view.exact) {
      const base = centre(map, navalBase(game, map, v.id))
      if (view.coastal >= 0.25) out.push({ key: `${v.id}:ship`, lat: base.lat, lng: base.lng - 1.3, glyph: 'ship', text: showDivisions(view.coastal, true), color: n.color, mine, guess: false, title: `${name} coastal patrol: ${showDivisions(view.coastal, true)} divisions of warships` })
      if (view.subs >= 0.25) out.push({ key: `${v.id}:sub`, lat: base.lat, lng: base.lng + 1.3, glyph: 'sub', text: showDivisions(view.subs, true), color: n.color, mine, guess: false, title: `${name} submarine screen: ${showDivisions(view.subs, true)} divisions of warships` })
      if (view.air >= 0.25) {
        const cap = centre(map, n.capital)
        out.push({ key: `${v.id}:air`, lat: cap.lat + 1.4, lng: cap.lng, glyph: 'air', text: showDivisions(view.air, true), color: n.color, mine, guess: false, title: `${name} air patrol: ${showDivisions(view.air, true)} divisions of fighters and drones` })
      }
    }
    for (const x of Object.keys(d.border).sort()) {
      const facing = view.exact ? garrisonDivisions(game, v.id, x) : x === player ? (view.border[player] ?? 0) : 0
      if (facing < 0.25 || (!view.exact && !guesses)) continue
      const spot = spots.get(pairKey(v.id, x))
      if (!spot) continue
      const mid = spot.points[Math.floor(spot.points.length / 2)]
      const home = centre(map, spot.owners[v.id])
      // The badge sits on the border, a little toward the nation that keeps the garrison.
      const lat = mid[1] + (home.lat - mid[1]) * 0.12
      const lng = mid[0] + (home.lng - mid[0]) * 0.12
      out.push({ key: `${v.id}:guard:${x}`, lat, lng, glyph: 'guard', text: showDivisions(facing, view.exact), color: n.color, mine, guess: !view.exact, title: `${name} garrison facing ${game.nations[x]?.name ?? x}: ${showDivisions(facing, view.exact)} divisions${view.exact ? '' : ' (a guess)'}` })
    }
  }
  return out
}

const ALT = 0.02

/** Lines for the Borders map: every land border colored by its tension, sea lanes the player touches, and the chokepoints. */
export function borderPaths(game: GameState, map: WorldMap, player: NationId): PathDatum[] {
  const out: PathDatum[] = []
  const cache = new Map<string, { color: string; cover: number; closed: boolean; disputed: boolean }>()
  const info = (a: NationId, b: NationId) => {
    const key = pairKey(a, b)
    let v = cache.get(key)
    if (!v) {
      const t = borderTension(game, map, a, b).total
      const state = borderState(game, map, a, b, t)
      v = { color: tensionColor(t), cover: Math.max(borderCover(game, map, a, b), borderCover(game, map, b, a)), closed: state === 'closed' || !!game.borders?.[key]?.closedBy?.length, disputed: state === 'disputed' }
      cache.set(key, v)
    }
    return v
  }
  // A line's id is its place in the list of border lines, so the picture can be matched to the map.
  borderLines().forEach((line, index) => {
    const oa = game.regions[line.a]?.owner
    const ob = game.regions[line.b]?.owner
    if (!oa || !ob || oa === ob) return
    const v = info(oa, ob)
    const involved = oa === player || ob === player
    out.push({
      id: `border:${index}`,
      points: line.points.map(([lng, lat]) => [lat, lng, ALT]),
      color: v.color,
      dash: v.closed ? 0.012 : 1,
      gap: v.closed ? 0.012 : 0,
      animate: 0,
      key: `border|${v.color}|${v.closed}|${v.cover.toFixed(1)}`,
      stroke: (involved ? 0.7 : 0.4) + v.cover * 0.9,
    })
  })
  // Sea lanes: the player's own, and every chokepoint.
  const drawn = new Set<string>()
  const lane = (a: RegionId, b: RegionId, color: string, stroke: number, tag: string) => {
    const key = [a, b].sort().join('>')
    if (drawn.has(key)) return
    drawn.add(key)
    const from = { lat: map.regions[a].lat, lng: map.regions[a].lng }
    const to = { lat: map.regions[b].lat, lng: map.regions[b].lng }
    const points: [number, number, number][] = []
    for (let k = 0; k <= 24; k++) {
      const p = greatCircle(from, to, k / 24)
      points.push([p.lat, p.lng, ALT + 0.025 * Math.sin(Math.PI * (k / 24))])
    }
    out.push({ id: `${tag}:${key}`, points, color, dash: 0.03, gap: 0.03, animate: 0, key: `${tag}|${key}|${color}`, stroke })
  }
  for (const r of Object.values(game.regions)) {
    if (r.owner !== player) continue
    for (const l of map.regions[r.id].seaLanes) {
      const o = game.regions[l]?.owner
      if (!o || o === player || !game.nations[o]?.alive) continue
      const v = info(player, o)
      lane(r.id, l, v.color, 0.45, 'sea')
    }
  }
  for (const [a, b] of chokepoints()) {
    const oa = game.regions[a]?.owner
    const ob = game.regions[b]?.owner
    lane(a, b, oa && ob && oa !== ob && atWar(game, oa, ob) ? '#ff453a' : '#9ad1ff', 0.9, 'choke')
  }
  return out
}

/** What the Borders map's picture depends on, as one string: it changes when a posture, a closure, a war or a pact does. */
export function borderSignature(game: GameState): string {
  let out = `${game.turn}|${game.wars.join(',')}|${game.alliances.join(',')}|${Object.keys(game.pacts).join(',')}|`
  for (const n of Object.values(game.nations)) {
    const d = n.military.deployment
    if (n.alive && d) out += `${n.id}:${d.coastal},${d.subs},${d.air},${Object.entries(d.border).map(([k, v]) => `${k}=${v}`).join('/')};`
  }
  return out + JSON.stringify(game.borders ?? {})
}
