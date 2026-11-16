import { companyEffects } from './stocks'
import { launchSite, strikeHitsKind, strikeKind, takeMissiles, validateMissileStrike } from './missiles'
import { answerStrike } from './missileDoctrine'
import { FRONTIER, SYSTEM_IDS, SYSTEM_MAX, SYSTEM_SPECS, systemsCost, type SystemId } from '../data/systems'
import { TECH_BY_ID } from '../data/techTree'
import { addOpinion } from '../ai/opinion'
import { interceptFactor } from './combat'
import { projectPower, scaleBonus, scaleFactor } from './industry'
import { addInfamy, addLog, atWar, hasTech } from './helpers'
import type { GameState, MissileType, NationId, Order, RegionId, SalvoReport, StrikeAim, WorldMap } from './types'

type Fund = Extract<Order, { type: 'fundSystem' }>
type Strike = Extract<Order, { type: 'strike' }>

/** Money each month for the systems a nation runs. */
export function systemUpkeep(n: { systems?: Partial<Record<SystemId, number>> }): number {
  let total = 0
  for (const id of SYSTEM_IDS) total += (n.systems?.[id] ?? 0) * SYSTEM_SPECS[id].upkeep
  return total
}

export function validateFundSystem(s: GameState, o: Fund, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const spec = SYSTEM_SPECS[o.system]
  if (!spec) return 'Unknown system'
  if (!hasTech(n, spec.tech)) return `Needs ${TECH_BY_ID[spec.tech]?.name ?? 'a technology'}`
  const levels = o.levels ?? 1
  if (!Number.isInteger(levels) || levels < 1) return 'Choose how many levels to buy'
  const queued = pending.reduce((sum, p) => (p.type === 'fundSystem' && p.system === o.system ? sum + (p.levels ?? 1) : sum), 0)
  const have = (n.systems?.[o.system] ?? 0) + queued
  if (have >= SYSTEM_MAX) return 'Already at the highest level'
  if (have + levels > SYSTEM_MAX) return `Only ${SYSTEM_MAX - have} more level${SYSTEM_MAX - have === 1 ? '' : 's'} to the top (level ${SYSTEM_MAX})`
  return null
}

export function fundSystemCost(s: GameState, o: Fund): number {
  const full = systemsCost(o.system, s.nations[o.nationId]?.systems?.[o.system] ?? 0, o.levels ?? 1)
  // A space launch complex makes the Orbital Network 30% cheaper.
  const space = o.system === 'orbital' ? scaleFactor(0.7, projectPower(s.nations[o.nationId], 'spaceComplex')) : 1
  return Math.round(full * space * (1 - (s.nations[o.nationId] ? companyEffects(s, o.nationId).systemDiscount : 0)))
}

export function fundSystem(s: GameState, nationId: NationId, system: SystemId, levels = 1) {
  const n = s.nations[nationId]
  n.systems[system] = Math.min(SYSTEM_MAX, (n.systems[system] ?? 0) + levels)
  if (n.isPlayer) addLog(s, 'info', `${SYSTEM_SPECS[system].name} is now level ${n.systems[system]}.`, [nationId])
}

/** Strikes from afar: a hypersonic salvo from batteries within range, or an orbital strike once a year. */
export function strikeCost(o: Strike): { capital: number; pp: number } {
  return o.weapon === 'orbital' ? { capital: FRONTIER.orbitalMoney, pp: FRONTIER.orbitalPP } : { capital: FRONTIER.strikeMoney, pp: 0 }
}

/** The country within range of a nation's batteries or satellites that it can hit, and why not. */
export function validateStrike(s: GameState, map: WorldMap, o: Strike, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const r = s.regions[o.target]
  const t = map.regions[o.target]
  if (!r || !t) return 'Unknown country'
  if (r.owner === o.nationId || !atWar(s, o.nationId, r.owner)) return 'You can only strike a country you are at war with'
  if (o.weapon === 'orbital') {
    if (pending.some((p) => p.type === 'strike' && p.weapon === 'orbital')) return 'Only one orbital strike a month'
    if ((n.systems?.orbital ?? 0) < 1) return 'Needs an Orbital Network'
    // Each reconnaissance satellite in orbit (two at most) gives the weapon a month back: it knows where to aim sooner.
    const recon = Math.min(2, (n.space?.sats ?? []).filter((x) => x.kind === 'recon').length)
    const cooldown = FRONTIER.orbitalCooldown - Math.round(scaleBonus(3, projectPower(n, 'spaceComplex'))) - recon
    if (s.turn - n.lastOrbital < cooldown) return `The orbital weapon recharges in ${cooldown - (s.turn - n.lastOrbital)} months`
    return null
  }
  return validateMissileStrike(s, map, o, pending)
}

function highestBuilding(s: GameState, id: RegionId) {
  const b = s.regions[id].buildings
  let best: keyof typeof b | null = null
  for (const k of Object.keys(b) as (keyof typeof b)[]) if (b[k] > 0 && (!best || b[k] > b[best])) best = k
  return best
}

/** Missiles still free to fire: the stock, less what other strikes and attacks waiting for the month end already claim. */
export function missilesLeft(stock: number, pending: Order[], nationId: NationId): number {
  let used = 0
  for (const p of pending) {
    if (p.nationId !== nationId) continue
    if (p.type === 'strike' && p.weapon === 'missile') used += p.count ?? 1
    else if (p.type === 'attack') used += p.missiles ?? 0
  }
  return Math.max(0, Math.floor(stock + 1e-9) - used)
}

/** Takes the missiles out of a nation's stock for a salvo, and returns how many were fired. Each one is used up, whatever it hits. */
export function fireMissiles(s: GameState, o: Strike): number {
  return takeMissiles(s.nations[o.nationId], strikeKind(o), o.count ?? 1)
}

/** A hypersonic salvo landing (kept for callers that name no kind). */
export function strikeHits(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, fired: number, kind: MissileType = 'hypersonic', opts: { aim?: StrikeAim; scrambled?: boolean; auto?: boolean; origin?: RegionId } = {}): SalvoReport | undefined {
  return strikeHitsKind(s, map, nationId, target, kind, fired, opts)
}

export function runStrike(s: GameState, map: WorldMap, o: Strike) {
  const n = s.nations[o.nationId]
  const region = s.regions[o.target]
  const victim = s.nations[region.owner]
  const place = map.regions[o.target].name
  const stops = interceptFactor(victim.systems?.shield ?? 0)
  if (o.weapon === 'missile') {
    const origin = launchSite(s, map, o.nationId, o.target, strikeKind(o)) ?? undefined
    const fired = fireMissiles(s, o)
    if (fired < 1) return
    answerStrike(s, map, strikeHitsKind(s, map, o.nationId, o.target, strikeKind(o), fired, { aim: o.aim, origin }))
    return
  }
  const level = n.systems?.orbital ?? 1
  const hit = (FRONTIER.orbitalLine + FRONTIER.orbitalLinePerLevel * (level - 1)) * stops
  region.line = Math.max(0.5, region.line - hit)
  region.sabotaged = Math.max(region.sabotaged, 2)
  const building = highestBuilding(s, o.target)
  if (building && stops > 0.55) region.buildings[building]--
  n.lastOrbital = s.turn
  addInfamy(s, o.nationId, FRONTIER.orbitalInfamy)
  addOpinion(s, region.owner, o.nationId, 'Struck us from orbit', -20, 0.3)
  addLog(s, 'news', `A strike from orbit hit ${place}. ${n.name} used its Orbital Network on ${victim.name}: the Defense Line fell by ${hit.toFixed(1)}${building && stops > 0.55 ? ` and a ${building} was destroyed` : ''}.`, [o.nationId, region.owner])
}

/** The month's work of the systems: an Orbital Network keeps watching every enemy. */
export function runSystems(s: GameState) {
  for (const n of Object.values(s.nations)) {
    if (!n.alive || (n.systems?.orbital ?? 0) < 1) continue
    for (const k of s.wars) {
      const [a, b] = k.split('|')
      const enemy = a === n.id ? b : b === n.id ? a : null
      if (enemy && s.nations[enemy]?.alive) s.intel[`${n.id}|${enemy}`] = Math.max(s.intel[`${n.id}|${enemy}`] ?? 0, s.turn + 1)
    }
  }
}
