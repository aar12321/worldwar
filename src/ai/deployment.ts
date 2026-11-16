import { PUPPET } from '../data/puppets'
import { AIR_UNITS, GROUND_UNITS, NAVAL_UNITS } from '../data/deployment'
import { PRESENCE } from '../data/presence'
import { alertOf } from '../engine/presence'
import { borderCover, garrisonDivisions, heatNow, landBorders, patrolCover } from '../engine/deployment'
import { neighborsOf, recordOf } from '../engine/borders'
import { atWar, clamp, forceUnits, hasCasusBelli, hasPact, isAllied, puppetsOf, regionsOf, totalUnits } from '../engine/helpers'
import type { GameState, NationId, Order, WorldMap } from '../engine/types'

export type Posture = Pick<Extract<Order, { type: 'setDeployment' }>, 'coastal' | 'subs' | 'air' | 'border'>

const sum = (u: Record<string, number>, kinds: string[]) => kinds.reduce((t, k) => t + (u[k] ?? 0), 0)
const round05 = (v: number) => Math.round(v * 20) / 20

/** Most of each arm a rival keeps on station, by skill (Easy, Medium, Hard). The rest stays free to attack with. */
const CAP = { ground: [0.1, 0.2, 0.3], coastal: [0.25, 0.3, 0.3], subs: [0, 0.2, 0.4], air: [0.15, 0.25, 0.35] }

/** The most ground forces a rival posts in its puppets in all, and the loyalty above which it does not bother (it keeps an existing garrison until the puppet is loyal, `PUPPET.high`, so the post does not flap). */
export const PUPPET_GARRISON_CAP = 0.2
export const PUPPET_GARRISON_BELOW = 60

/** How much a neighbor worries a nation, from the war, the grievance, the incidents and the size of its army. A friend barely counts. */
export function borderThreat(s: GameState, id: NationId, x: NationId): number {
  const mine = Math.max(1, totalUnits(forceUnits(s, id)))
  let t = 0.15
  if (atWar(s, id, x)) t += 3
  if (hasCasusBelli(s, x, id)) t += 1
  t += heatNow(s, recordOf(s, id, x)) / 25
  t += 0.6 * clamp(totalUnits(forceUnits(s, x)) / mine, 0, 2)
  // Troops massed across the border worry it: it matches a build-up (so build-ups feed on each other).
  if (PRESENCE.on) t += PRESENCE.mirror * clamp(garrisonDivisions(s, x, id) / mine, 0, 1.5)
  if (isAllied(s, id, x) || s.nations[x]?.overlord === id || s.nations[id]?.overlord === x || s.nations[x]?.territoryOf === id || s.nations[id]?.territoryOf === x) t *= 0.1
  else if (hasPact(s, id, x)) t *= 0.4
  return t
}

/**
 * The posture a government in this position would keep: garrisons on the borders that worry it most, patrols along its coast, a
 * submarine screen where the sea is hostile, and an air screen. Stronger rivals keep more on station, and watch more borders, than weak
 * ones; every rival keeps a reserve to attack with. No random numbers, so the same game always plans the same posture.
 */
export function plannedPosture(s: GameState, map: WorldMap, id: NationId, skill: 0 | 1 | 2): Posture {
  const n = s.nations[id]
  const force = forceUnits(s, id)
  const atWarNow = s.wars.some((k) => k.split('|').includes(id))
  // A nation set on conquest keeps more of its army free.
  const eager = atWarNow && n.aggression > 0.4 ? 0.75 : 1
  const out: Posture = { coastal: 0, subs: 0, air: 0, border: {} }

  const fronts = landBorders(s, map, id)
  const threats = [...fronts.keys()].sort().map((x) => ({ x, t: borderThreat(s, id, x) }))
  if (threats.length && sum(force, GROUND_UNITS) >= 1) {
    const total = Math.min(CAP.ground[skill] * eager, 0.05 + 0.06 * threats.reduce((t, e) => t + e.t, 0))
    const chosen = skill === 0 ? [threats.reduce((best, e) => (e.t > best.t + 1e-9 ? e : best), threats[0])] : threats
    const weight = chosen.reduce((t, e) => t + e.t, 0)
    for (const e of chosen) {
      const share = round05((total * e.t) / Math.max(1e-6, weight))
      if (share >= 0.05) out.border[e.x] = share
    }
  }

  // A master that rules a shaky puppet beside it keeps a garrison there: it buys loyalty (see PUPPET.garrison) for troops that would otherwise
  // sit in the reserve. Medium and Hard only, and only as much as the cover needs, out of at most PUPPET_GARRISON_CAP of the ground forces.
  if (skill >= 1 && fronts.size) {
    const ground = sum(force, GROUND_UNITS)
    let room = PUPPET_GARRISON_CAP
    for (const p of puppetsOf(s, id).sort()) {
      const loyal = s.nations[p].loyalty
      if (!fronts.has(p) || loyal === undefined || loyal >= (n.military.deployment?.border[p] ? PUPPET.high : PUPPET_GARRISON_BELOW) || ground < 4) continue
      const need = (PUPPET.garrison.perCountry * regionsOf(s, p).length) / ground
      const share = Math.min(room, Math.ceil(need * 20) / 20)
      if (share < 0.05) continue
      const total = Object.values(out.border).reduce((t, v) => t + v, 0) - (out.border[p] ?? 0) + share
      if (total > 1) continue
      out.border[p] = Math.max(out.border[p] ?? 0, share)
      room -= share
    }
  }

  const coastal = Object.values(s.regions).some((r) => r.owner === id && map.regions[r.id]?.coastal)
  const navy = sum(force, NAVAL_UNITS)
  if (coastal && navy >= 0.5) {
    const hostile = neighborsOf(s, map, id).filter((nb) => atWar(s, id, nb.id) || hasCasusBelli(s, nb.id, id) || heatNow(s, recordOf(s, id, nb.id)) > 0).length
    out.coastal = round05(CAP.coastal[skill] * eager)
    out.subs = skill === 0 ? 0 : round05(Math.min(CAP.subs[skill] * eager, 0.05 + 0.1 * hostile))
    if (out.coastal + out.subs > 0.7) out.subs = round05(0.7 - out.coastal)
  }
  const air = sum(force, AIR_UNITS)
  if (air >= 0.5) out.air = round05(Math.min(0.5, (CAP.air[skill] + (atWarNow ? 0.1 : 0)) * eager))
  return out
}

/** How far apart two postures are, as the largest change in any one share. */
function distance(a: Posture, b: Posture): number {
  let d = Math.max(Math.abs(a.coastal - b.coastal), Math.abs(a.subs - b.subs), Math.abs(a.air - b.air))
  for (const x of new Set([...Object.keys(a.border), ...Object.keys(b.border)])) d = Math.max(d, Math.abs((a.border[x] ?? 0) - (b.border[x] ?? 0)))
  return d
}

/** The order that moves a nation to the posture it would choose, or null when it is already close to it, or has too little army to bother. */
export function deploymentOrder(s: GameState, map: WorldMap, id: NationId, skill: 0 | 1 | 2): Order | null {
  const n = s.nations[id]
  if (totalUnits(forceUnits(s, id)) < 3) return null
  const want = plannedPosture(s, map, id, skill)
  const d = n.military.deployment
  const have: Posture = d ? { coastal: d.coastal, subs: d.subs, air: d.air, border: d.border } : { coastal: 0, subs: 0, air: 0, border: {} }
  // A change in a puppet's garrison is worth an order from half that much: it is what holds the puppet's loyalty.
  const puppetShift = Object.keys({ ...want.border, ...have.border }).some((x) => s.nations[x]?.overlord === id && Math.abs((want.border[x] ?? 0) - (have.border[x] ?? 0)) >= 0.05)
  if (d ? distance(want, have) < 0.1 && !puppetShift : distance(want, have) <= 0) return null
  return { type: 'setDeployment', nationId: id, ...want }
}


/**
 * How a nation reads a neighbor's posture when it weighs a war: a border that is well guarded, or a coast that is well patrolled,
 * takes some of the shine off the target (more on Medium and Hard); an unguarded border invites an aggressive nation to probe it.
 * One when presence is off. A multiplier for the odds the nation sees.
 */
export function postureRead(s: GameState, map: WorldMap, id: NationId, target: NationId, skill: 0 | 1 | 2, aggression: number): number {
  // A nation that never stationed anything has no guard to read.
  if (!PRESENCE.on || !s.nations[target]?.military.deployment) return 1
  const land = (landBorders(s, map, id).get(target) ?? 0) > 0
  if (land) {
    const cover = borderCover(s, map, target, id)
    let f = 1 - PRESENCE.deter[skill] * cover
    if (skill >= 1 && aggression > 0.5 && cover < 0.15) f *= 1 + PRESENCE.probe
    return f
  }
  const c = patrolCover(s, target)
  return 1 - PRESENCE.deter[skill] * 0.5 * clamp((c.coastal + c.subs) / 4, 0, 1)
}

/** The alert order a government in this position would give: high at war or under threat, relaxed when nobody is a worry (Hard only), else normal. Null on Easy and when nothing needs changing. */
export function alertOrder(s: GameState, map: WorldMap, id: NationId, skill: 0 | 1 | 2): Order | null {
  const d = s.nations[id]?.military.deployment
  if (!PRESENCE.on || !d || skill === 0) return null
  let threat = s.wars.some((k) => k.split('|').includes(id))
  let worry = threat
  if (!threat) {
    for (const nb of neighborsOf(s, map, id)) {
      const hot = hasCasusBelli(s, nb.id, id) || heatNow(s, recordOf(s, id, nb.id)) > 10
      if (hot) threat = true
      if (hot || (!isAllied(s, id, nb.id) && !hasPact(s, id, nb.id) && borderThreat(s, id, nb.id) > 0.9)) worry = true
    }
  }
  const want = threat ? 'high' : skill === 2 && !worry ? 'relaxed' : 'normal'
  return want === alertOf(d) ? null : { type: 'setAlert', nationId: id, alert: want }
}

/** The three presets of the Theatres desk: the planner's posture, leaning to guarding, to balance, or to a big reserve. */
export function presetPosture(s: GameState, map: WorldMap, id: NationId, preset: 'defensive' | 'balanced' | 'forward'): Posture {
  const scale = (p: Posture, ground: number, groundCap: number, sea: number, air: number): Posture => {
    const border: Record<NationId, number> = {}
    let total = 0
    for (const [x, v] of Object.entries(p.border)) {
      border[x] = round05(v * ground)
      total += border[x]
    }
    if (total > groundCap) for (const x of Object.keys(border)) border[x] = round05((border[x] * groundCap) / total)
    for (const x of Object.keys(border)) if (border[x] < 0.05) delete border[x]
    const coastal = round05(Math.min(1, p.coastal * sea))
    const subs = round05(Math.min(1 - coastal, p.subs * sea))
    return { coastal, subs, air: round05(Math.min(1, p.air * air)), border }
  }
  if (preset === 'balanced') return plannedPosture(s, map, id, 1)
  if (preset === 'defensive') return scale(plannedPosture(s, map, id, 2), 1.6, 0.6, 1.4, 1.4)
  return scale(plannedPosture(s, map, id, 1), 0.5, 0.2, 0.5, 0.6)
}
