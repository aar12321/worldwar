import { greatCircle } from '../../engine/armies'
import { chokeStatus } from '../../engine/presence'
import { neighborsOf } from '../../engine/borders'
import { patrolCover } from '../../engine/deployment'
import { deploymentView, hasIntel, showDivisions } from '../../engine/intel'
import { atWar, enemiesOf, hasCasusBelli, pairKey } from '../../engine/helpers'
import { heatNow } from '../../engine/deployment'
import type { GameState, NationId, RegionId, WorldMap } from '../../engine/types'
import { borderLines } from '../../map/world'
import { relationColors, tint } from '../colors'
import type { PathDatum, ThreatRing } from './useArmyLayer'

/**
 * The persistent picture of the military on the globe: patrol routes with wakes, submarine tracks, air circuits, radar rings, the
 * straits and who holds them, battle lines and supply lines, and rivals' fleets as far as intelligence shows them. Pure: the globe
 * hands it the game and how close the camera is, and gets back lines and badges, capped so the globe stays light.
 */

/** How close the camera is: 0 far (the world), 1 a region, 2 close. */
export type Lod = 0 | 1 | 2

export type PresenceGlyph = 'ship' | 'sub' | 'air' | 'guard' | 'choke' | 'front' | 'supply' | 'base'

/** What a click on a badge opens: enough to rebuild the card from the live game. */
export interface CardRef {
  kind: 'fleet' | 'sub' | 'air' | 'garrison' | 'choke' | 'front' | 'base'
  nation: NationId
  other?: NationId
  /** A strait's id, or the war's key. */
  id?: string
}

export interface PresenceMarker {
  key: string
  lat: number
  lng: number
  glyph: PresenceGlyph
  text: string
  color: string
  mine: boolean
  /** A rounded guess, drawn dashed with a tilde. */
  guess: boolean
  /** Contested or at war: drawn with a warning edge. */
  hot: boolean
  title: string
  card: CardRef
}

export interface PresenceData {
  paths: PathDatum[]
  markers: PresenceMarker[]
  rings: ThreatRing[]
}

export const EMPTY_PRESENCE: PresenceData = { paths: [], markers: [], rings: [] }

/** The most of each kind the globe is ever asked to carry. */
export const CAPS = { markers: 70, paths: 70, rings: 4 }

const ALT = 0.045
const centre = (map: WorldMap, id: RegionId) => ({ lat: map.regions[id].lat, lng: map.regions[id].lng })

/** The country where a nation's fleet sits: its best port, else its capital. */
export function navalBase(game: GameState, map: WorldMap, id: NationId): RegionId {
  let best: RegionId | null = null
  let level = 0
  for (const r of Object.values(game.regions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (r.owner !== id || !map.regions[r.id]?.coastal) continue
    if (r.buildings.port > level || (best === null && level === 0)) {
      best = r.id
      level = r.buildings.port
    }
  }
  return best ?? game.nations[id].capital
}

/** Points along the great circle from `a` toward `b`, up to the fraction `to`, with a small hump so the line rides above the sea. */
function route(a: { lat: number; lng: number }, b: { lat: number; lng: number }, to: number, steps = 18, from = 0): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let k = 0; k <= steps; k++) {
    const t = from + (k / steps) * (to - from)
    const p = greatCircle(a, b, t)
    out.push([p.lat, p.lng, ALT + 0.012 * Math.sin(Math.PI * (k / steps))])
  }
  return out
}

/** A ring of points around a place, the circuit of an air patrol. */
function circuit(c: { lat: number; lng: number }, radius: number, steps = 32): [number, number, number][] {
  const out: [number, number, number][] = []
  const cos = Math.max(0.2, Math.cos((c.lat * Math.PI) / 180))
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * Math.PI * 2
    out.push([Math.max(-85, Math.min(85, c.lat + radius * Math.sin(a))), c.lng + (radius * Math.cos(a)) / cos, ALT + 0.016])
  }
  return out
}

/** Which nations the player sees, and how well: exact with intelligence, a rounded guess for neighbors and enemies, nothing for the rest. */
export function visibleNations(game: GameState, map: WorldMap, player: NationId): { id: NationId; tier: 'exact' | 'rounded' }[] {
  const out: { id: NationId; tier: 'exact' | 'rounded' }[] = [{ id: player, tier: 'exact' }]
  const seen = new Set<NationId>([player])
  const add = (id: NationId) => {
    if (seen.has(id) || !game.nations[id]?.alive) return
    seen.add(id)
    out.push({ id, tier: hasIntel(game, player, id) ? 'exact' : 'rounded' })
  }
  for (const nb of neighborsOf(game, map, player)) add(nb.id)
  for (const e of enemiesOf(game, player)) add(e)
  // Anyone else the player has intelligence on.
  for (const n of Object.values(game.nations).sort((a, b) => (a.id < b.id ? -1 : 1))) if (n.alive && game.intel?.[`${player}|${n.id}`] !== undefined && hasIntel(game, player, n.id)) add(n.id)
  return out
}

const hot = (game: GameState, player: NationId, other: NationId) => hasCasusBelli(game, other, player) || hasCasusBelli(game, player, other) || heatNow(game, game.borders?.[pairKey(player, other)]) > 0
const short = (name: string) => (name.length > 11 ? `${name.slice(0, 10)}.` : name)

/**
 * Builds what the globe draws. `lod` thins it out far away: from afar only the player's own forces, the straits that matter and the
 * wars; closer, the neighbors' forces; close, everything the player can see. `moving` is false under reduced motion, so the routes
 * hold still.
 */
export function presenceLayer(game: GameState, map: WorldMap, player: NationId, lod: Lod, palette: 'standard' | 'colorblind', moving: boolean): PresenceData {
  const paths: PathDatum[] = []
  const markers: PresenceMarker[] = []
  const rings: ThreatRing[] = []
  const colors = relationColors(palette)
  const anim = (ms: number) => (moving ? ms : 0)
  const seeNation = (_tier: "exact" | "rounded", mine: boolean) => mine || lod >= 1

  for (const v of visibleNations(game, map, player)) {
    const n = game.nations[v.id]
    const d = n?.military.deployment
    if (!n?.alive || !d) continue
    const mine = v.id === player
    if (!seeNation(v.tier, mine)) continue
    // From a middle distance a neighbor shows only when it is a worry; close up, every neighbor does.
    if (!mine && lod === 1 && (v.tier === 'rounded' ? !atWar(game, player, v.id) && !(hot(game, player, v.id)) : false)) continue
    if (!mine && markers.length > CAPS.markers * 0.7) continue
    const view = deploymentView(game, player, v.id)
    const exact = view.exact
    const cover = patrolCover(game, v.id)
    const name = mine ? 'Your' : `${n.name}'s`
    const baseId = navalBase(game, map, v.id)
    const base = centre(map, baseId)
    const lanes = [...map.regions[baseId].seaLanes].sort()
    // Lanes toward the player's waters, or the most tense, first.
    const hostile = (l: RegionId) => {
      const o = game.regions[l]?.owner
      return o && o !== v.id && (atWar(game, v.id, o) || o === player) ? 0 : 1
    }
    lanes.sort((a, b) => hostile(a) - hostile(b) || (a < b ? -1 : 1))
    const line = mine ? '#ffffff' : tint(n.color, 0.45)
    const wake = (id: string, to: RegionId, color: string, dash: number, gap: number, frac: number, stroke: number, ms: number, from = 0.18): [number, number] | null => {
      const end = centre(map, to)
      const pts = route(base, end, frac, 18, from)
      paths.push({ id, points: pts, color, dash, gap, animate: anim(ms), key: `${id}|${color}|${moving}`, stroke })
      const mid = pts[Math.floor(pts.length * 0.7)]
      return [mid[0], mid[1]]
    }
    // Surface patrol: a dashed wake out along a sea lane, with the fleet's badge near its far end.
    if (cover.coastal >= 0.25 && lanes.length && (view.coastal > 0 || exact)) {
      const spot = wake(`pat:${v.id}`, lanes[0], line, 0.06, 0.04, 0.5, mine ? 3 : 2.2, 2600)
      // The station badge already marks an exact fleet; a guess has none, so the globe adds one.
      if (spot && !exact)
        markers.push({ key: `fleet:${v.id}`, lat: spot[0], lng: spot[1], glyph: 'ship', text: showDivisions(view.coastal, exact), color: n.color, mine, guess: !exact, hot: false, title: `${name} coastal patrol: ${showDivisions(view.coastal, exact)} divisions of warships on station${exact ? '' : ' (a rounded guess)'}`, card: { kind: 'fleet', nation: v.id } })
    }
    // Submarine screen: a dotted, fainter track the other way, out to sea.
    if (cover.subs >= 0.25 && lanes.length && (view.subs > 0 || exact)) {
      const spot = wake(`sub:${v.id}`, lanes[Math.min(1, lanes.length - 1)], line, 0.012, 0.05, 0.8, mine ? 2.4 : 1.8, 4200, 0.3)
      if (spot && !exact)
        markers.push({ key: `sub:${v.id}`, lat: spot[0], lng: spot[1], glyph: 'sub', text: showDivisions(view.subs, exact), color: n.color, mine, guess: !exact, hot: false, title: `${name} submarine screen: ${showDivisions(view.subs, exact)} divisions${exact ? '' : ' (a rounded guess)'}`, card: { kind: 'sub', nation: v.id } })
    }
    // Air patrol: a circuit over the capital, a plane flying it, and (for the player) the radar ring.
    if (cover.air >= 0.25 && (view.air > 0 || exact) && (mine || lod >= 1)) {
      const cap = centre(map, n.capital)
      const radius = 1.6 + Math.min(3, cover.air * 0.45)
      const pts = circuit(cap, radius)
      paths.push({ id: `air:${v.id}`, points: pts, color: line, dash: 0.05, gap: 0.05, animate: anim(3200), key: `air|${v.id}|${radius.toFixed(1)}|${moving}|${mine}`, stroke: mine ? 2.4 : 1.8 })
      if (!exact) markers.push({ key: `air:${v.id}`, lat: pts[0][0], lng: pts[0][1], glyph: 'air', text: showDivisions(view.air, exact), color: n.color, mine, guess: !exact, hot: false, title: `${name} air patrol: ${showDivisions(view.air, exact)} divisions of fighters and drones${exact ? '' : ' (a rounded guess)'}`, card: { kind: 'air', nation: v.id } })
      if (mine && rings.length < CAPS.rings) rings.push({ lat: cap.lat, lng: cap.lng, color: n.color, maxRadius: radius * 1.5, repeat: 3800 })
    }
    // Garrisons on borders are drawn by the station badges; their click opens the same card (see Globe.tsx).
    if (!mine && exact && lod >= 2 && cover.coastal + cover.subs >= 0.25) {
      markers.push({ key: `base:${v.id}`, lat: base.lat, lng: base.lng, glyph: 'base', text: short(n.name), color: n.color, mine, guess: false, hot: atWar(game, player, v.id), title: `${n.name}'s main naval base`, card: { kind: 'base', nation: v.id } })
    }
  }

  // Straits and canals: who holds them. Thin from afar.
  const chokes = chokeStatus(game, map)
  for (const c of chokes) {
    const mineHere = c.power[player] !== undefined
    const warm = c.contested || (c.holder && atWar(game, player, c.holder))
    if (lod === 0 && !mineHere && !warm) continue
    if (lod === 1 && !c.holder && !c.contested && !mineHere) continue
    const holder = c.holder ? game.nations[c.holder] : null
    const color = c.contested ? colors.war : holder ? holder.color : '#9aa4b2'
    markers.push({
      key: `choke:${c.id}`,
      lat: c.lat,
      lng: c.lng,
      glyph: 'choke',
      text: holder ? short(holder.name) : c.contested ? 'Contested' : 'Open',
      color,
      mine: c.holder === player,
      guess: false,
      hot: c.contested,
      title: `${c.name}: ${holder ? `held by ${holder.name}` : c.contested ? 'contested by both shores' : 'nobody holds it'}`,
      card: { kind: 'choke', nation: c.holder ?? player, id: c.id },
    })
    if (holder && lod >= 1 && paths.length < CAPS.paths) {
      const a = centre(map, c.a)
      const b = centre(map, c.b)
      const pts = route(a, b, 1, 14)
      paths.push({ id: `held:${c.id}`, points: pts, color: tint(holder.color, 0.45), dash: 0.03, gap: 0.02, animate: anim(2000), key: `held|${c.id}|${holder.id}|${moving}`, stroke: 2 })
    }
  }

  // Battle lines: the borders between nations at war, with a badge at the middle of the longest, and the player's supply lines.
  const warKeys = game.wars.filter((k) => {
    const [a, b] = k.split('|')
    return game.nations[a]?.alive && game.nations[b]?.alive && (a === player || b === player || lod >= 1)
  })
  if (warKeys.length) {
    const wars = new Set(warKeys)
    const best = new Map<string, { points: [number, number][]; a: NationId; b: NationId }>()
    borderLines().forEach((line, i) => {
      const oa = game.regions[line.a]?.owner
      const ob = game.regions[line.b]?.owner
      if (!oa || !ob || oa === ob) return
      const key = pairKey(oa, ob)
      if (!wars.has(key)) return
      if (paths.length < CAPS.paths) paths.push({ id: `front:${i}`, points: line.points.map(([lng, lat]) => [lat, lng, ALT + 0.004]), color: colors.war, dash: 0.03, gap: 0.015, animate: anim(1500), key: `front|${i}|${moving}|${palette}`, stroke: 3 })
      const old = best.get(key)
      if (!old || line.points.length > old.points.length) best.set(key, { points: line.points, a: oa, b: ob })
    })
    for (const [key, f] of best) {
      const mid = f.points[Math.floor(f.points.length / 2)]
      const [a, b] = key.split('|')
      const involved = a === player || b === player
      markers.push({ key: `front:${key}`, lat: mid[1], lng: mid[0], glyph: 'front', text: involved ? 'Front' : 'War', color: colors.war, mine: involved, guess: false, hot: true, title: `Front: ${game.nations[a]?.name} and ${game.nations[b]?.name} are at war`, card: { kind: 'front', nation: involved ? (a === player ? a : b) : a, other: involved ? (a === player ? b : a) : b, id: key } })
      // The player's supply line: from the capital to the front.
      if (involved && paths.length < CAPS.paths) {
        const cap = centre(map, game.nations[player].capital)
        const pts: [number, number, number][] = []
        for (let k = 0; k <= 20; k++) {
          const p = greatCircle(cap, { lat: mid[1], lng: mid[0] }, k / 20)
          pts.push([p.lat, p.lng, ALT + 0.02 * Math.sin(Math.PI * (k / 20))])
        }
        paths.push({ id: `supply:${key}`, points: pts, color: '#5ce1a0', dash: 0.02, gap: 0.05, animate: anim(2400), key: `supply|${key}|${moving}`, stroke: 1.8 })
      }
    }
  }

  return { paths: paths.slice(0, CAPS.paths), markers: markers.slice(0, CAPS.markers), rings: rings.slice(0, CAPS.rings) }
}

/** What the picture depends on, as one string, so the globe rebuilds it only when something that shows has changed. */
export function presenceSignature(game: GameState, lod: Lod): string {
  let out = `${lod}|${game.turn}|${game.day ?? ''}|${game.wars.join(',')}|`
  for (const n of Object.values(game.nations)) {
    const d = n.military.deployment
    if (n.alive && d) out += `${n.id}:${d.coastal},${d.subs},${d.air},${Object.keys(d.border).length};`
  }
  return out
}
