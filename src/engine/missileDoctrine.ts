import { MW } from '../data/missileWar'
import { MISSILES, MISSILE_TYPES } from '../data/missiles'
import { launchStrike } from './armies'
import { isLive, clockOf } from './calendar'
import { addInfamy, addLog, atWar, enemiesOf } from './helpers'
import { missileStock, strikeKind, validateMissileStrike } from './missiles'
import { doctrineOf, radarLevel, tensionOf, trucePair } from './missileWar'
import { fireMissiles, strikeHits } from './systems'
import { createRng } from './rng'
import type { GameState, MissileFlight, NationId, Order, SalvoReport, WorldMap } from './types'

type Strike = Extract<Order, { type: 'strike' }>

/**
 * The shot a doctrine would fire back at `foe`: the kind it holds the most of (decoys never), at the launch site that hit it if that is a
 * country with a factory, else at the foe's most worn country. A salvo of up to a third of the store, six at most. Null if nothing can be fired.
 */
export function answerShot(s: GameState, map: WorldMap, id: NationId, foe: NationId, origin?: string, cap = MW.answerMax): Strike | null {
  const n = s.nations[id]
  const kinds = MISSILE_TYPES.filter((k) => k !== 'decoy' && missileStock(n, k) >= 1).sort((a, b) => missileStock(n, b) - missileStock(n, a) || (a < b ? -1 : 1))
  if (!kinds.length) return null
  const targets = Object.values(s.regions)
    .filter((r) => r.owner === foe)
    .sort((a, b) => (a.id === origin ? -1 : b.id === origin ? 1 : b.line - a.line || (a.id < b.id ? -1 : 1)))
    .slice(0, 6)
  for (const kind of kinds) {
    const count = Math.max(1, Math.min(cap, Math.ceil(missileStock(n, kind) * MW.answerShare)))
    for (const r of targets) {
      for (const aim of r.id === origin && r.buildings.factory > 0 ? (['site', 'country'] as const) : (['country'] as const)) {
        const o: Strike = { type: 'strike', nationId: id, target: r.id, weapon: 'missile', kind, count, ...(aim === 'site' ? { aim } : {}) }
        if (!validateMissileStrike(s, map, o, [])) return o
      }
    }
  }
  return null
}

/** Fires a doctrine's shot at once: it flies in a live game, lands in a turn game. It costs nothing and never answers an answer. */
function fireAuto(s: GameState, map: WorldMap, o: Strike) {
  if (isLive(s)) {
    launchStrike(s, map, o, clockOf(s), true)
    return
  }
  const fired = fireMissiles(s, o)
  if (fired >= 1) strikeHits(s, map, o.nationId, o.target, fired, strikeKind(o), { aim: o.aim, auto: true })
}

/** After a salvo lands: a nation with a retaliation doctrine answers the one who struck it. */
export function answerStrike(s: GameState, map: WorldMap, report: SalvoReport | undefined) {
  if (!MW.enabled || !report || report.auto) return
  const victim = s.nations[report.to]
  if (!victim?.alive || !s.nations[report.from]?.alive || !atWar(s, report.to, report.from) || trucePair(s, report.to, report.from) !== null) return
  // A nation that fires on warning has already answered while the salvo was in the air (live); in a turn game it answers now.
  const d = doctrineOf(victim)
  if (d === 'hold' || (d === 'warning' && isLive(s))) return
  const shot = answerShot(s, map, victim.id, report.from, report.origin)
  if (!shot) return
  addLog(s, 'news', `${victim.name} answers by doctrine: ${shot.count} ${MISSILES[strikeKind(shot)].name.toLowerCase()}${shot.count === 1 ? '' : 's'} at ${map.regions[shot.target].name}.`, [victim.id, report.from])
  fireAuto(s, map, shot)
}

/** A live salvo has just left: a nation that fires on warning, and has radar to see it, answers before it lands. */
export function warnAnswer(s: GameState, map: WorldMap, flight: MissileFlight) {
  if (!MW.enabled || flight.auto) return
  const victim = s.nations[s.regions[flight.target]?.owner]
  if (!victim?.alive || doctrineOf(victim) !== 'warning' || radarLevel(victim) < 1) return
  if (!atWar(s, victim.id, flight.nationId) || trucePair(s, victim.id, flight.nationId) !== null) return
  const shot = answerShot(s, map, victim.id, flight.nationId, flight.from)
  if (!shot) return
  addLog(s, 'news', `LAUNCH ON WARNING: ${victim.name}'s radar saw a salvo from ${s.nations[flight.nationId].name} and fired ${shot.count} missiles back before it landed.`, [victim.id, flight.nationId])
  fireAuto(s, map, shot)
}

/**
 * A nation that fires on warning can be fooled. Each month, with a chance that grows with the world's tension and shrinks with each
 * level of radar, its system mistakes noise for a salvo and fires a few missiles at a country it is at war with. Only ever at a nation it is
 * already fighting, so a false alarm can sour a war but never start one. Deterministic (its own random stream).
 */
export function runFalseAlarms(s: GameState, map: WorldMap) {
  if (!MW.enabled) return
  const ids = Object.keys(s.nations).sort()
  ids.forEach((id, i) => {
    const n = s.nations[id]
    if (!n.alive || doctrineOf(n) !== 'warning') return
    const foes = enemiesOf(s, id).filter((e) => s.nations[e]?.alive && trucePair(s, id, e) === null)
    if (!foes.length) return
    const rng = createRng((s.seed ^ 0x6a1a) >>> 0, s.turn * 1009 + i)
    const p = MW.falseAlarm * (1 + tensionOf(s) / MW.falseAlarmTension) * (1 - 0.25 * radarLevel(n))
    if (!rng.chance(p)) return
    const foe = rng.pick(foes)
    const shot = answerShot(s, map, id, foe, undefined, 3)
    if (!shot) return
    addLog(s, 'news', `FALSE ALARM: ${n.name}'s warning system mistook noise for a salvo and fired ${shot.count} missiles at ${s.nations[foe].name}.`, [id, foe])
    addInfamy(s, id, MW.falseAlarmInfamy)
    s.missileTension = Math.min(100, tensionOf(s) + MW.falseAlarmTensionAdd)
    fireAuto(s, map, shot)
  })
}

