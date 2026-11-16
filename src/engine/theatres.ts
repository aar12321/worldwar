import { GROUND_UNITS } from '../data/deployment'
import { PRESENCE } from '../data/presence'
import { borderState, borderTension, neighborsOf, recordOf, type BorderKind } from './borders'
import { borderCover, garrisonDivisions, patrolCover } from './deployment'
import { atWar, forceUnits, hasCasusBelli } from './helpers'
import { deploymentView, hasIntel } from './intel'
import { alertOf, chokeStatus, postedUpkeep, readinessOf, type ChokeView } from './presence'
import type { GameState, NationId, WorldMap } from './types'

/**
 * Theatres: the military desk's view of where the nation's forces stand, one theatre for each neighbor (a border by land, a sea by
 * water). Pure and read-only; it never touches the dice.
 */
export interface Theatre {
  id: string
  other: NationId
  kind: 'land' | 'sea'
  name: string
  lat: number
  lng: number
  /** Divisions of yours that stand there: a garrison on the border, or the patrols that watch that water. */
  mine: number
  /** What the rival has facing you, as far as intelligence shows. Null when nothing is known. */
  rival: number | null
  rivalExact: boolean
  /** How well your post covers what it has to, 0 to 1. */
  cover: number
  tension: number
  /** Change in tension since last month, null before there is a record. */
  delta: number | null
  state: BorderKind
  threat: 'low' | 'watch' | 'high'
  /** One sentence on what is changing. */
  changing: string
  atWar: boolean
}

const verb = (d: number) => (d > 0 ? `up ${d}` : `down ${-d}`)

export function theatresOf(s: GameState, map: WorldMap, id: NationId): Theatre[] {
  const out: Theatre[] = []
  const me = s.nations[id]
  const prev = s.presence?.[id]?.tension
  const cover = patrolCover(s, id)
  for (const nb of neighborsOf(s, map, id)) {
    const other = s.nations[nb.id]
    const land = nb.land > 0
    const t = borderTension(s, map, id, nb.id)
    const view = deploymentView(s, id, nb.id)
    const mine = land ? garrisonDivisions(s, id, nb.id) : cover.coastal + cover.subs
    const rival = land ? (view.exact ? (view.border[id] ?? 0) : (view.border[id] ?? null)) : view.posted ? view.coastal + view.subs : null
    const c = land ? borderCover(s, map, id, nb.id) : Math.min(1, (cover.coastal + cover.subs) / 2)
    const delta = prev?.[nb.id] !== undefined ? t.total - prev[nb.id] : null
    const war = atWar(s, id, nb.id)
    const hot = war || hasCasusBelli(s, nb.id, id)
    const threat = war && c < 0.5 ? 'high' : t.total >= 60 || (hot && c < 0.3) ? 'high' : t.total >= 35 || hot ? 'watch' : 'low'
    const a = map.regions[land ? [...Object.values(s.regions)].find((r) => r.owner === id && map.regions[r.id].neighbors.some((x) => s.regions[x]?.owner === nb.id))?.id ?? me.capital : me.capital]
    const b = map.regions[Object.values(s.regions).find((r) => r.owner === nb.id)?.id ?? other.capital]
    const heat = recordOf(s, id, nb.id)?.heat
    const changing =
      delta !== null && delta !== 0
        ? `Tension ${verb(delta)} this month${heat ? ' after an incident' : ''}.`
        : war
          ? 'At war.'
          : hot
            ? 'A grievance is open.'
            : land && mine < 0.5 && t.total >= 25
              ? 'The border is thinly guarded.'
              : 'Quiet.'
    out.push({
      id: `${land ? 'land' : 'sea'}:${nb.id}`,
      other: nb.id,
      kind: land ? 'land' : 'sea',
      name: land ? `${other.name} front` : `Waters off ${other.name}`,
      lat: (a.lat + b.lat) / 2,
      lng: Math.abs(a.lng - b.lng) > 180 ? a.lng : (a.lng + b.lng) / 2,
      mine,
      rival,
      rivalExact: view.exact || hasIntel(s, id, nb.id),
      cover: c,
      tension: t.total,
      delta,
      state: borderState(s, map, id, nb.id, t.total),
      threat,
      changing,
      atWar: war,
    })
  }
  return out.sort((x, y) => Number(y.atWar) - Number(x.atWar) || y.tension - x.tension || (x.other < y.other ? -1 : 1))
}

/** What a nation's forces have done, as the desk's ledger shows it, with a one-line meaning for each. */
export interface LedgerLine {
  key: string
  label: string
  value: string
  hint: string
}

export function ledgerLines(s: GameState, id: NationId): LedgerLine[] {
  const r = s.presence?.[id]
  const n = (v: number | undefined) => String(Math.round(v ?? 0))
  return [
    { key: 'deterred', label: 'Incidents deterred', value: n(r?.deterred), hint: 'Provocations turned back at the border, landings met by patrols, tense borders eased by talks.' },
    { key: 'trade', label: 'Trade protected', value: n(r?.trade), hint: 'Money your patrols and held straits have added to your sea trade. It never pays for the fleet itself.' },
    { key: 'blockaded', label: 'Enemy trade denied', value: n(r?.blockaded), hint: 'Sea trade your fleet kept from rivals you were at war with or sanctioning.' },
    { key: 'intel', label: 'Intelligence gained', value: n(r?.intel), hint: 'Times your patrols and air screens learned what a neighbor keeps on station.' },
    { key: 'detected', label: 'Enemy forces detected', value: n(r?.detected), hint: 'Rival fleets and air patrols your forces located.' },
    { key: 'sorties', label: 'Sorties flown', value: n(r?.sorties), hint: 'Air patrol flights, a few for each division on patrol each month.' },
    { key: 'incidents', label: 'Naval and air incidents', value: n(r?.incidents), hint: 'Collisions and shoot-downs with tense neighbors.' },
    { key: 'shows', label: 'Shows of force', value: n(r?.shows), hint: 'Times you made a point of your strength to a neighbor, or drilled at home.' },
  ]
}

export type Preset = 'defensive' | 'balanced' | 'forward'
export const PRESET_INFO: Record<Preset, { name: string; hint: string }> = {
  defensive: { name: 'Defensive', hint: 'Most troops on the borders and ships on patrol, high alert where it is hot. Hard to surprise, little left to attack with.' },
  balanced: { name: 'Balanced', hint: 'Garrisons where the worry is, patrols along the coast, the rest in reserve.' },
  forward: { name: 'Forward', hint: 'A light guard and a big reserve. Strong at attacking, weak to a surprise.' },
}

/** Which preset the situation calls for, and why. Read-only; the advisor and the desk both use it. */
export function recommendPreset(s: GameState, map: WorldMap, id: NationId): { preset: Preset; why: string } {
  const th = theatresOf(s, map, id)
  const hot = th.filter((t) => t.threat === 'high')
  const watch = th.filter((t) => t.threat === 'watch')
  const war = th.filter((t) => t.atWar)
  const mine = forceUnits(s, id)
  const ground = GROUND_UNITS.reduce((t, k) => t + mine[k], 0)
  if (hot.length) return { preset: 'defensive', why: `${hot.length === 1 ? th.find((t) => t.threat === 'high')!.name : `${hot.length} theatres`} ${hot.length === 1 ? 'is' : 'are'} at danger level: guard what you hold first.` }
  if (war.length && ground >= 6) return { preset: 'forward', why: 'You are at war with the fronts covered: keep a large reserve to press the attack.' }
  if (watch.length) return { preset: 'balanced', why: `${watch.length} ${watch.length === 1 ? 'border is' : 'borders are'} on watch: keep garrisons there and the rest in reserve.` }
  return { preset: 'balanced', why: 'Nothing is pressing. A balanced posture costs little and keeps the borders watched.' }
}

/** Supply of the forces on station: oil in the tank against what they burn. */
export function supplyOf(s: GameState, id: NationId): { state: 'good' | 'thin' | 'dry'; months: number; burn: number } {
  const n = s.nations[id]
  const burn = postedUpkeep(s, id).oil
  if (burn <= 0.01) return { state: 'good', months: 99, burn: 0 }
  const months = n.resources.oil / burn
  return { state: months <= 0.2 ? 'dry' : months < 6 ? 'thin' : 'good', months, burn }
}

/** The numbers the desk's header shows: what is posted, the readiness and its upkeep. */
export function postureSummary(s: GameState, id: NationId) {
  const d = s.nations[id]?.military.deployment
  const u = postedUpkeep(s, id)
  return { posted: !!d, alert: alertOf(d), readiness: readinessOf(d), upkeep: u.money, oil: u.oil, supply: supplyOf(s, id), base: PRESENCE.readyBase }
}

export type { ChokeView }
export { chokeStatus }
