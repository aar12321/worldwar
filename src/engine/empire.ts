import { CITY_CREDIT_CAP, EMPIRE_RULES, LAW_CONFLICTS, OCCUPATION, TIERS, TRAIT_CAPS, tierSpec, type TierSpec } from '../data/empire'
import type { PolicyEffects } from '../data/government'
import { LAW_SPECS } from '../data/unitTypes'
import { addLog, distanceKm } from './helpers'
import { societyEffects } from './society'
import type { GameState, LawId, Nation, NationId, RegionId, Tier, WorldMap } from './types'

export { CITY_CREDIT_CAP }

/** Countries that count toward a nation's tier: those it holds, and half of each puppet's. */
export function empireCount(s: GameState, id: NationId, held?: Map<NationId, number>): number {
  const counts = held ?? countRegions(s)
  let puppets = 0
  for (const n of Object.values(s.nations)) if (n.alive && n.overlord === id) puppets += counts.get(n.id) ?? 0
  return (counts.get(id) ?? 0) + Math.floor(puppets / 2)
}

export function countRegions(s: GameState): Map<NationId, number> {
  const out = new Map<NationId, number>()
  for (const r of Object.values(s.regions)) out.set(r.owner, (out.get(r.owner) ?? 0) + 1)
  return out
}

/** The tier for a count, given the tier held now: promotion is at once, demotion only once the count falls clearly below the line. */
export function tierFor(count: number, current: Tier = 1): Tier {
  let t: Tier = 1
  for (const spec of TIERS) if (count >= spec.countries) t = spec.id
  if (t >= current) return t
  // Holding on: a nation keeps its tier until it is a tenth below the line.
  let kept: Tier = t
  for (let c = current; c > t; c--) {
    const line = tierSpec(c).countries
    if (count >= Math.max(1, Math.floor(line * (1 - EMPIRE_RULES.demoteSlack)))) {
      kept = c as Tier
      break
    }
  }
  return kept
}

export const tierOf = (n: Pick<Nation, 'tier'>): TierSpec => tierSpec(n.tier ?? 1)

/** Updates every nation's tier. A player hears of a promotion or a fall; the world hears of a new superpower. */
export function updateTiers(s: GameState) {
  const counts = countRegions(s)
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
    const before = n.tier ?? 1
    const after = tierFor(empireCount(s, n.id, counts), before)
    if (after === before) continue
    n.tier = after
    const spec = tierSpec(after)
    if (n.isPlayer) addLog(s, 'news', after > before ? `${n.name} is now a ${spec.name}. New powers are open to you: see the Empire desk.` : `${n.name} has fallen back to a ${spec.name}. Some powers are closed until you grow again.`, [n.id])
    else if (after > before && after >= 4) addLog(s, 'news', `${n.name} has become a ${spec.name}.`, [n.id])
  }
}

/** Why a nation is too small for something, or null when its tier allows it. */
export function tierGate(s: GameState, id: NationId, need: Tier): string | null {
  const n = s.nations[id]
  if (!n || (n.tier ?? 1) >= need) return null
  const spec = tierSpec(need)
  return `Needs a ${spec.name} (${spec.countries} countries). You hold ${empireCount(s, id)}.`
}

/** The lowest tier that allows something, for the gate messages. */
export function tierWhere(test: (t: TierSpec) => boolean): Tier {
  return (TIERS.find(test)?.id ?? 5) as Tier
}

/**
 * Bonuses from many countries: in full up to the strongest single one, then flattening toward a cap. One country gives exactly its
 * bonus; a hundred no longer give a hundred times as much.
 */
export function diminish(sum: number, strongest: number, cap: number): number {
  if (cap <= 0) return sum
  const sign = sum < 0 ? -1 : 1
  const total = Math.abs(sum)
  const top = Math.min(total, Math.abs(strongest))
  const rest = total - top
  return sign * (top + cap * (1 - Math.exp(-rest / cap)))
}

/** Trait effects from every country a nation holds, each key diminished by the tier's cap. */
export function combineTraits(parts: Partial<PolicyEffects>[], tier: Tier): Partial<PolicyEffects> {
  const sum: Partial<Record<keyof PolicyEffects, number>> = {}
  const top: Partial<Record<keyof PolicyEffects, number>> = {}
  for (const p of parts)
    for (const [k, v] of Object.entries(p) as [keyof PolicyEffects, number][]) {
      sum[k] = (sum[k] ?? 0) + v
      if (Math.abs(v) > Math.abs(top[k] ?? 0)) top[k] = v
    }
  const out: Partial<PolicyEffects> = {}
  const mult = tierSpec(tier).traitCap
  for (const k of Object.keys(sum) as (keyof PolicyEffects)[]) out[k] = diminish(sum[k]!, top[k] ?? 0, (TRAIT_CAPS[k] ?? 0) * mult)
  return out
}

/** The nation's capital and the regional capitals it still holds. */
export function capitalsOf(s: GameState, n: Nation): RegionId[] {
  const out: RegionId[] = []
  if (s.regions[n.capital]?.owner === n.id) out.push(n.capital)
  for (const id of n.regionalCapitals ?? []) if (s.regions[id]?.owner === n.id && !out.includes(id)) out.push(id)
  return out
}

/** Distance from a country to the nearest of a nation's capitals. */
export function capitalDistance(s: GameState, map: WorldMap, n: Nation, regionId: RegionId, caps = capitalsOf(s, n)): number {
  const here = map.regions[regionId]
  if (!here || caps.length === 0) return 0
  let best = Infinity
  for (const c of caps) {
    const m = map.regions[c]
    if (m) best = Math.min(best, distanceKm(m, here))
  }
  return Number.isFinite(best) ? best : 0
}

export interface AdminReport {
  capacity: number
  load: number
  /** Countries' worth over capacity, 0 when within it. */
  over: number
  stability: number
  output: number
  governors: number
}

/** How much a nation's officials can run, against what its countries ask of them. */
export function adminReport(s: GameState, map: WorldMap, id: NationId, skilledShare = 0.3): AdminReport {
  const n = s.nations[id]
  const spec = tierOf(n)
  const caps = capitalsOf(s, n)
  let civic = 0
  let load = 0
  let governors = 0
  for (const r of Object.values(s.regions)) {
    if (r.owner !== id) continue
    civic += r.buildings.civic
    if (r.governor && r.governor !== 'off') governors++
    if (caps.includes(r.id)) continue
    let w = r.integration < 1 ? EMPIRE_RULES.adminUnsettled : EMPIRE_RULES.adminSettled
    if (r.governor && r.governor !== 'off') w *= EMPIRE_RULES.adminGovernor
    const km = capitalDistance(s, map, n, r.id, caps)
    w *= 1 + Math.min(EMPIRE_RULES.adminDistanceMax, (km / EMPIRE_RULES.adminDistanceKm) * EMPIRE_RULES.adminDistanceMax)
    load += w
  }
  const capacity =
    spec.adminBase +
    civic * EMPIRE_RULES.adminPerCivic +
    skilledShare * EMPIRE_RULES.adminPerSkilled +
    (n.projects?.digitalGov?.done ? EMPIRE_RULES.adminDigitalGov : 0) +
    Math.max(0, caps.length - 1) * EMPIRE_RULES.adminRegionalCapital +
    // Honest courts and clear rules let the same officials run more.
    societyEffects(n).social.admin
  const over = Math.max(0, load - capacity)
  return {
    capacity,
    load,
    over,
    stability: Math.min(EMPIRE_RULES.overStabilityCap, over * EMPIRE_RULES.overStability),
    output: Math.min(EMPIRE_RULES.overOutputCap, over * EMPIRE_RULES.overOutput),
    governors,
  }
}

/** Laws a nation may have in force at once. */
export const lawSlots = (n: Pick<Nation, 'tier'>) => tierOf(n).lawSlots

/** A law already in force that this one cannot stand beside, if any. */
export function lawConflict(n: Pick<Nation, 'laws'>, law: LawId): LawId | null {
  for (const [a, b] of LAW_CONFLICTS) {
    if (a === law && n.laws.includes(b)) return b
    if (b === law && n.laws.includes(a)) return a
  }
  return null
}

/** Why a law cannot be enacted now, or null. */
export function lawProblem(n: Nation, law: LawId): string | null {
  if (LAW_SPECS[law]?.retired) return 'That law has been replaced by health spending'
  if (n.laws.includes(law)) return 'Already enacted'
  const clash = lawConflict(n, law)
  if (clash) return `It cannot stand beside ${LAW_SPECS[clash].name}. Repeal that first.`
  const slots = lawSlots(n)
  if (n.laws.length >= slots) return `You have room for ${slots} laws as a ${tierOf(n).name}. Repeal one, or grow your empire.`
  return null
}

/** How fast conquered land settles in this country: the occupation policy, and a capital nearby. */
export function settleSpeed(s: GameState, map: WorldMap, n: Nation, regionId: RegionId): number {
  const occ = OCCUPATION[n.programs?.occupation ?? 'standard']
  const near = capitalDistance(s, map, n, regionId) <= EMPIRE_RULES.capitalSettleKm
  return occ.speed * (near ? EMPIRE_RULES.capitalSettleSpeed : 1)
}

/** Share of an unsettled country's output that counts under the nation's occupation policy. */
export const occupationFloor = (n: Pick<Nation, 'programs'> | undefined) => OCCUPATION[n?.programs?.occupation ?? 'standard'].floor
