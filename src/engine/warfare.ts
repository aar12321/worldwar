import { addOpinion, forgetNation } from '../ai/opinion'
import { BANKING } from '../data/banking'
import { COMBAT_MEDICINE, DEMAND, MEDICINE } from '../data/people'
import { GENERAL_TRAITS } from '../data/projects'
import { AIRCRAFT_RULES } from '../data/aircraft'
import { aircraftEffects, airReach, bomberBonus, pastDefenses } from './aircraft'
import { updateTiers } from './empire'
import { commanderTrait } from './generals'
import { blendPeople } from './people'
import { emptyTraining } from '../data/unitTypes'
import { combatMods } from './arms'
import { MATERIALS } from '../data/deposits'
import { TECH_BY_ID } from '../data/techTree'
import { FRONTIER, NANO_REVIVE } from '../data/systems'
import { COMMITS, EMPIRE, JUSTIFY, REACH, STANCES, WAR, type Commit, type Stance } from '../data/war'
import { cityEffects, razeCities } from './cities'
import { lineMax, regionWorkforce } from './economy'
import { interceptFactor, resolveBattle, type Combatant } from './combat'
import { createRng } from './rng'
import { defenseWeights, freeUnits, interception, surpriseBonus } from './deployment'
import { cleanUnits, shareOf, SENDABLE } from './deploy'
import { recordBattle } from './warscore'
import { addInfamy, addLog, atWar, distanceKm, emptyUnits, forceUnits, nationModifiers, newId, pairKey, reach, regionsOf, totalUnits } from './helpers'
import { clearPuppetFields } from './puppets'
import type { Rng } from './rng'
import type { Army, BattleReport, GameState, Interception, Military, Nation, NationId, RegionId, UnitCounts, Via, WorldMap } from './types'
import { UNIT_TYPES } from './types'

export { distanceKm }

export interface Reach {
  ok: boolean
  /** Whether the attack crosses water or air and so fights with the amphibious penalty. */
  bySea: boolean
  via?: Via
}

/**
 * Whether a nation can attack `target`. By land across a border; across a short sea lane from a port; across the open
 * ocean with a fleet, from a port to any coast in range; or with an air force, from a country with a factory to use as
 * an airbase. Reach over water or air fights with the amphibious penalty.
 */
export function canAttackRegion(s: GameState, map: WorldMap, nationId: NationId, target: RegionId): Reach {
  const t = map.regions[target]
  if (!t) return { ok: false, bySea: false }
  for (const id of t.neighbors) if (s.regions[id]?.owner === nationId) return { ok: true, bySea: false, via: 'land' }
  for (const id of t.seaLanes) {
    const r = s.regions[id]
    if (r?.owner === nationId && r.buildings.port > 0) return { ok: true, bySea: true, via: 'lane' }
  }
  const n = s.nations[nationId]
  if (!n) return { ok: false, bySea: false }
  // Ships and planes on station cannot carry an army: only the reserve can.
  const u = freeUnits(s, nationId)
  // Ships and planes carry the army: a token squadron cannot lift a whole military across the ocean.
  const lift = carryNeeded(u)
  const fleet = t.coastal && u.naval >= Math.max(REACH.navalUnits, lift)
  const air = u.fighter + u.air >= Math.max(REACH.airUnits, lift)
  if (!fleet && !air) return { ok: false, bySea: false }
  let by: Reach['via'] | null = null
  for (const r of Object.values(s.regions)) {
    if (r.owner !== nationId) continue
    const from = map.regions[r.id]
    if (!from) continue
    const km = distanceKm(from, t)
    if (fleet && r.buildings.port > 0 && km <= REACH.seaKm) return { ok: true, bySea: true, via: 'fleet' }
    if (air && r.buildings.factory > 0 && km <= airReach(n)) by = 'air'
  }
  return by ? { ok: true, bySea: true, via: by } : { ok: false, bySea: false }
}

/** Warships, or fighters and strike aircraft, needed to carry a military this big across water or air. */
export function carryNeeded(u: UnitCounts): number {
  return totalUnits(u) * REACH.carryShare
}

/** Why a nation cannot reach a country, in words a player can act on. */
export function reachProblem(s: GameState, map: WorldMap, nationId: NationId, target: RegionId): string {
  const t = map.regions[target]
  const u = s.nations[nationId] ? freeUnits(s, nationId) : undefined
  const hasPort = Object.values(s.regions).some((r) => r.owner === nationId && r.buildings.port > 0)
  const lift = u ? carryNeeded(u) : 0
  const navy = u && u.naval >= Math.max(REACH.navalUnits, lift)
  const air = u && u.fighter + u.air >= Math.max(REACH.airUnits, lift)
  const ships = Math.ceil(Math.max(REACH.navalUnits, lift))
  // Warships on patrol or in the screen cannot carry an army: say so, rather than telling the player to train more.
  const all = s.nations[nationId] ? forceUnits(s, nationId).naval : 0
  const stationed = !navy && all >= Math.max(REACH.navalUnits, lift) && !!s.nations[nationId]?.military.deployment
  const sea = !t?.coastal ? 'ships cannot reach an inland country' : hasPort ? (navy ? '' : stationed ? 'your warships are on patrol: free some in Military, Deployment, to sail' : `train warships to sail from your port (${ships} needed to carry your military)`) : navy ? 'build a port for your warships' : 'build a port and train warships'
  const sky = air ? 'it is beyond your air range, and you need a factory close enough to use as an airbase' : `or train fighters or strike aircraft (${Math.ceil(Math.max(REACH.airUnits, lift))} needed) and keep a factory as an airbase`
  return `Out of reach: it is not on your border. To reach it, ${[sea, sky].filter(Boolean).join('; ')}.`
}

/** Enemy countries the nation could attack this turn. */
export function attackableRegions(s: GameState, map: WorldMap, nationId: NationId): RegionId[] {
  const out: RegionId[] = []
  for (const r of Object.values(s.regions)) {
    if (r.owner === nationId || !atWar(s, nationId, r.owner)) continue
    if (canAttackRegion(s, map, nationId, r.id).ok) out.push(r.id)
  }
  return out.sort()
}

/** Defenders standing in a country before any military arrives. */
export function garrisonStrength(s: GameState, map: WorldMap, regionId: RegionId): number {
  const r = s.regions[regionId]
  const owner = s.nations[r.owner]
  const capitalBonus = owner?.capital === regionId ? 0.75 : 0
  return 0.8 + r.buildings.barracks * 0.75 + regionWorkforce(r, map.regions[regionId]) * 0.05 + capitalBonus + cityEffects(r).garrison
}

export function emptyMilitary(units: UnitCounts = emptyUnits()): Military {
  return { units, drill: emptyTraining(), weapons: emptyTraining(), commanderId: null, lastAttackTurn: 0, attacksThisTurn: 0, exposed: 0 }
}

export function killNation(s: GameState, id: NationId, by: NationId | null) {
  const n = s.nations[id]
  if (!n.alive) return
  n.alive = false
  // A fallen puppet is nobody's puppet if it ever rises again.
  if (n.loyalty !== undefined) {
    n.overlord = null
    clearPuppetFields(n)
  }
  n.military = emptyMilitary()
  s.trainingQueue = (s.trainingQueue ?? []).filter((job) => job.nationId !== id)
  // Live mode: whatever the fallen nation had in the field or in the air is lost with it.
  if (s.armies) s.armies = s.armies.filter((a) => a.nationId !== id)
  if (s.launches) s.launches = s.launches.filter((l) => l.order.nationId !== id)
  if (s.flights) s.flights = s.flights.filter((f) => f.nationId !== id)
  if (s.nukes) s.nukes = s.nukes.filter((f) => f.nationId !== id)
  const involves = (k: string) => k.split(/[|>]/).includes(id)
  s.wars = s.wars.filter((k) => !involves(k))
  s.alliances = s.alliances.filter((k) => !involves(k))
  for (const k of Object.keys(s.pacts)) if (involves(k)) delete s.pacts[k]
  for (const k of Object.keys(s.warScore)) if (involves(k)) delete s.warScore[k]
  for (const k of Object.keys(s.warStarted)) if (involves(k)) delete s.warStarted[k]
  s.proposals = s.proposals.filter((p) => p.from !== id && p.to !== id && !(p.kind === 'callToArms' && p.enemy === id))
  s.deals = s.deals.filter((d) => d.from !== id && d.to !== id)
  forgetNation(s, id)
  const conqueror = by ? s.nations[by] : null
  // The conqueror takes part of the treasury and learns something the fallen nation knew.
  if (conqueror?.alive) {
    const spoils = Math.max(0, n.resources.capital) * EMPIRE.spoilsShare
    conqueror.resources.capital += spoils
    n.resources.capital -= spoils
    // And part of its wealth fund.
    const fund = (n.bank?.fund ?? 0) * BANKING.fundSpoils
    if (fund > 0) {
      conqueror.resources.capital += fund
      n.bank.fund -= fund
    }
    const learn = n.techs.filter((t) => !conqueror.techs.includes(t) && TECH_BY_ID[t]?.requires.every((r) => conqueror.techs.includes(r))).sort()[0]
    if (learn) {
      conqueror.techs.push(learn)
      if (conqueror.isPlayer) addLog(s, 'tech', `Your scientists studied the captured labs of ${n.name} and learned ${TECH_BY_ID[learn].name}.`, [by!])
    }
  }
  addLog(s, 'war', conqueror ? `${n.name} has fallen to ${conqueror.name}!` : `${n.name} has collapsed.`, by ? [id, by] : [id])
}

function seize(s: GameState, map: WorldMap, regionId: RegionId, newOwner: NationId, raze: boolean) {
  const region = s.regions[regionId]
  region.owner = newOwner
  region.rebels = 0
  if (raze) region.buildings.barracks = 0
  region.attackedTurn = s.turn
  if (raze) razeCities(region)
  // Conquered land starts restless and half-productive. A negotiated cession is gentler.
  region.integration = raze ? 0 : 0.5
  region.line = raze ? lineMax(s, map, regionId) * WAR.capturedLine : lineMax(s, map, regionId)
}

/** Hands a country to a new owner. Conquest razes the barracks; a negotiated cession keeps them. */
export function transferRegion(s: GameState, map: WorldMap, regionId: RegionId, newOwner: NationId, raze = true) {
  const oldOwner = s.regions[regionId].owner
  // The land's people come with it: the new owner's schooling, health and skills move toward theirs, by the land's share of its workforce.
  const gained = regionWorkforce(s.regions[regionId], map.regions[regionId])
  let had = 0
  for (const r of Object.values(s.regions)) if (r.owner === newOwner) had += regionWorkforce(r, map.regions[r.id])
  if (s.nations[newOwner] && s.nations[oldOwner]) blendPeople(s.nations[newOwner], s.nations[oldOwner], gained / Math.max(0.1, had + gained))
  seize(s, map, regionId, newOwner, raze)
  const old = s.nations[oldOwner]
  if (!old) return
  const remaining = regionsOf(s, oldOwner)
  // A nation whose capital has fallen and whose army is gone has nothing left to fight with. It surrenders whole.
  // A player who crushes an army also wins the war outright: the beaten nation gives up when its army is a fraction of the conqueror's.
  const crushed = s.nations[newOwner]?.isPlayer && totalUnits(forceUnits(s, oldOwner)) < totalUnits(forceUnits(s, newOwner)) * EMPIRE.surrenderShare
  if (raze && remaining.length > 0 && old.capital === regionId && (totalUnits(forceUnits(s, oldOwner)) < EMPIRE.surrenderUnits || crushed)) {
    addLog(s, 'war', `${old.name}'s capital has fallen and its army is broken. ${old.name} surrenders to ${s.nations[newOwner]?.name ?? 'its conqueror'}.`, [oldOwner, newOwner])
    for (const id of remaining) seize(s, map, id, newOwner, true)
    killNation(s, oldOwner, newOwner)
    return
  }
  if (remaining.length === 0) {
    killNation(s, oldOwner, newOwner)
    return
  }
  if (old.capital === regionId) {
    const next = remaining.reduce((best, id) => (s.regions[id].population > s.regions[best].population ? id : best), remaining[0])
    old.capital = next
    old.stability = Math.max(0, old.stability - 15)
    addLog(s, 'war', `${old.name}'s capital has fallen! The government flees to ${map.regions[next].name}.`, [oldOwner, newOwner])
  }
}

/** A Blitz under a commander who knows the trade pushes further. */
function blitzSpec(n: Nation | undefined, stance: Stance) {
  const spec = STANCES[stance]
  return stance === 'blitz' && commanderTrait(n) === 'blitz' ? { ...spec, advance: spec.advance * (1 + GENERAL_TRAITS.blitz.blitz) } : spec
}

/** Doctors return a share of infantry losses: more with good coverage and modern surgery, capped with nano-medicine. */
function treatWounded(n: Nation, losses: UnitCounts, into: UnitCounts = n.military.units): number {
  if (!n.people) return 0
  const coverage = n.people.skills.doctors / Math.max(1e-4, DEMAND.doctorsBase + DEMAND.doctorsPerHealth * (n.spending?.health ?? 2))
  const nano = NANO_REVIVE[Math.max(0, Math.min(3, n.systems?.nano ?? 0))]
  const share = Math.max(0, Math.min(COMBAT_MEDICINE.cap - nano, COMBAT_MEDICINE.perCoverage * Math.min(1.5, coverage) + (n.techs.includes('med_surgery') ? (MEDICINE.med_surgery.combatMedicine ?? 0) : 0)))
  if (share <= 0) return 0
  const back = losses.infantry * share
  into.infantry += back
  return back
}

/** Nano-medicine returns part of a side's losses to its military. Returns the divisions saved. */
function reviveLosses(n: Nation, losses: UnitCounts, into: UnitCounts = n.military.units): number {
  const share = NANO_REVIVE[Math.max(0, Math.min(3, n.systems?.nano ?? 0))]
  if (share <= 0) return 0
  let saved = 0
  for (const k of UNIT_TYPES) {
    const back = losses[k] * share
    into[k] += back
    saved += back
  }
  return saved
}

/** The part of a side's losses its military took, leaving out the garrison's (local militia, who are not revived into the army). */
function militaryLosses(units: UnitCounts, garrison: UnitCounts, losses: UnitCounts): UnitCounts {
  const out = emptyUnits()
  for (const k of UNIT_TYPES) {
    const total = units[k] + garrison[k]
    out[k] = total > 0 ? losses[k] * (units[k] / total) : 0
  }
  return out
}

/** Spreads a side's losses over its military and the garrison that stood beside it. */
function applyLosses(units: UnitCounts, garrison: UnitCounts, losses: UnitCounts) {
  for (const k of UNIT_TYPES) {
    const total = units[k] + garrison[k]
    if (total <= 0) continue
    units[k] = Math.max(0, units[k] - losses[k] * (units[k] / total))
    garrison[k] = Math.max(0, garrison[k] - losses[k] * (garrison[k] / total))
  }
}

function makeCombatant(n: Nation | null, military: Military | null, garrison: UnitCounts | null, notes: string[], penalty: number, share = 1): Combatant {
  let p = penalty
  if (n?.foodShortage) {
    p *= 0.7
    notes.push('food shortage (-30%)')
  }
  const units = emptyUnits()
  const drill = emptyTraining()
  for (const k of UNIT_TYPES) {
    const army = (military?.units[k] ?? 0) * share
    const extra = garrison?.[k] ?? 0
    units[k] = army + extra
    // The garrison is green, so it pulls the drill of its type down.
    drill[k] = army + extra > 0 ? ((military?.drill[k] ?? 0) * army) / (army + extra) : 0
  }
  let vehicleMult = 1
  if (n?.oilShortage) {
    vehicleMult = MATERIALS.noOilStrength
    notes.push(`no oil (tanks, planes and ships at ${Math.round(MATERIALS.noOilStrength * 100)}%)`)
  }
  const air = n ? aircraftEffects(n) : undefined
  return { units, drill, mods: n ? combatMods(n) : null, penalty: p, penaltyNotes: notes, vehicleMult, sys: n ? { ...n.systems } : undefined, ...(air ? { air } : {}) }
}

/**
 * Share of a nation's military that is free to defend this country: units committed to attacks this month fight at half strength,
 * and a military attacked on several fronts in one month cannot stand at full strength on each of them.
 */
function defendingShare(s: GameState, n: Nation, target: RegionId, notes: string[]): number {
  const tired = n.military.exposed * WAR.exposedDefenseLoss
  if (tired > 0.01) notes.push(`army committed abroad (-${Math.round(tired * 100)}% of the military)`)
  let fronts = 1
  for (const r of Object.values(s.regions)) if (r.owner === n.id && r.id !== target && r.attackedTurn === s.turn) fronts++
  const spread = Math.max(WAR.minFrontShare, 1 / Math.sqrt(fronts))
  if (spread < 0.99) notes.push(`attacked on ${fronts} fronts this month (${Math.round(spread * 100)}% of the military here)`)
  return (1 - tired) * spread
}

/** Share of the military an attack by `n` would commit right now, or 0 if it is spent. */
export function commitShare(n: Nation, commit: Commit, custom?: number): number {
  return Math.max(0, Math.min(custom ?? COMMITS[commit].share, 1 - n.military.exposed))
}

export interface AttackResult {
  report: BattleReport
}

/**
 * One nation's whole military attacks a country. The defender is its whole military plus the country's garrison.
 * A win takes the country. Returns null when the attack is not allowed to happen.
 */
/** How much a force's artillery multiplies the push on a Defense Line. A Siege makes the most of guns. */
export function gunBonus(units: UnitCounts, stance: Stance): number {
  const share = Math.min(WAR.artilleryCap, units.artillery / Math.max(0.1, totalUnits(units)))
  return 1 + share * (stance === 'siege' ? WAR.artillerySiege : WAR.artilleryAssault)
}

interface Setup {
  attacker: Combatant
  defender: Combatant
  garrison: UnitCounts
  share: number
  bySea: boolean
  /** Share of the defender's military standing in this fight. */
  defendShare: number
  via?: Via
  /** Units of the landing force lost to the defender's patrols before it came ashore. */
  sunk: UnitCounts | null
  intercept?: Interception
  /** A first strike on a border nobody guarded: how much stronger it made the attacker. */
  surprise: number
  /** The units named in the order, as they will fight (before the patrols). Null for a share. */
  picked: UnitCounts | null
}

/** Units multiplied by a weight for each kind. */
function scaled(units: UnitCounts, weights: Record<string, number>): UnitCounts {
  const out = emptyUnits()
  for (const k of UNIT_TYPES) out[k] = units[k] * weights[k]
  return out
}

/**
 * The share of hypersonic batteries' damage that gets past the defender's shield and, with developments, its hunter fighters
 * (those standing in this fight). Exactly the shield's own number when neither side has any developments.
 */
function batteryThrough(attacker: Combatant, defender: Combatant, shield: number): number {
  const base = interceptFactor(shield)
  if (!attacker.air && !defender.air) return base
  return pastDefenses(base, attacker.air, defender.air, defender.units.fighter, AIRCRAFT_RULES.huntVs.hypersonic)
}

/** Builds both sides of an attack, or null if it is not allowed. Shared by the real fight and the forecast. */
/** `army` is a live-mode army that is fighting: its own units attack, and nothing is taken from the national military. */
export function prepareAttack(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, commit: Commit, stance: Stance, missiles?: number, army?: Army, custom?: number, named?: Partial<UnitCounts>): Setup | null {
  const attackerNation = s.nations[nationId]
  const targetRegion = s.regions[target]
  const mr = map.regions[target]
  if (!attackerNation?.alive || !targetRegion || !mr) return null
  const defenderId = targetRegion.owner
  const defenderNation = s.nations[defenderId]
  if (defenderId === nationId || !defenderNation?.alive || !atWar(s, nationId, defenderId)) return null
  const reach: Reach = army ? { ok: true, bySea: army.bySea, via: army.via } : canAttackRegion(s, map, nationId, target)
  // Only the reserve can attack: what stands on station stays at its post.
  const free = army ? null : freeUnits(s, nationId)
  // A force chosen unit by unit: what was named, less what this month's earlier named attacks already spent.
  let picked: UnitCounts | null = null
  if (named && !army && free) {
    picked = cleanUnits(named)
    for (const k of SENDABLE) picked[k] = Math.min(picked[k], Math.max(0, free[k] - (attackerNation.military.sent?.[k] ?? 0)))
  }
  const share = army ? army.share : picked ? shareOf(picked, free!) : commitShare(attackerNation, commit, custom)
  if (army ? totalUnits(army.units) < 0.05 : !reach.ok || share < 0.05 || totalUnits(free!) < 0.1 || (picked !== null && totalUnits(picked) < 0.05)) return null

  const spec = blitzSpec(attackerNation, stance)
  const attNotes: string[] = []
  let attPenalty = 1
  if (reach.bySea) {
    // An Orbital Network helps every landing, from sea or air. Ground crews and drop tanks help a landing by air.
    const by = army ? army.via : reach.via
    const reduction = Math.min(0.9, nationModifiers(attackerNation).amphibiousPenaltyReduction + FRONTIER.orbitalLanding * (attackerNation.systems?.orbital ?? 0) + (by === 'air' ? (aircraftEffects(attackerNation)?.landing ?? 0) : 0))
    attPenalty *= 1 - 0.4 * (1 - reduction)
    attNotes.push(`amphibious assault (-${Math.round(40 * (1 - reduction))}%)`)
  }
  // An army fights with the units it carries, every missile included. Otherwise a share of the whole military goes.
  // A garrison that is not on its guard loses the border to a surprise attack in the first months of a war.
  let surprise = 0
  if (reach.via === 'land') {
    surprise = surpriseBonus(s, map, defenderId, nationId)
    if (surprise > 0.005) {
      attPenalty *= 1 + surprise
      attNotes.push(`surprise on an unguarded border (+${Math.round(surprise * 100)}%)`)
    }
  }
  const attacker = army ? makeCombatant(attackerNation, { ...attackerNation.military, units: army.units }, null, attNotes, attPenalty, 1) : picked ? makeCombatant(attackerNation, { ...attackerNation.military, units: picked }, null, attNotes, attPenalty, 1) : makeCombatant(attackerNation, free === attackerNation.military.units ? attackerNation.military : { ...attackerNation.military, units: free! }, null, attNotes, attPenalty, share)
  // The defender's patrols meet a landing from the sea or the air and sink part of it before it comes ashore.
  let sunk: UnitCounts | null = null
  let intercept: Interception | undefined
  if (reach.bySea && reach.via) {
    const icpt = interception(s, defenderId, reach.via, attacker.units)
    if (icpt.share > 0) {
      sunk = emptyUnits()
      for (const k of UNIT_TYPES) {
        if (k === 'missile') continue
        sunk[k] = attacker.units[k] * icpt.share
        attacker.units[k] -= sunk[k]
      }
      intercept = { by: defenderId, sunk: totalUnits(sunk), share: icpt.share, via: reach.via }
      attNotes.push(`patrols sank ${Math.round(icpt.share * 100)}% of the landing force`)
    }
  }
  // An attack fires only the missiles it names. Left out, none go: missiles are fired on purpose, as strikes or by name in an attack, never by a share of the stock.
  if (!army) attacker.units.missile = Math.min(Math.max(0, Math.floor(missiles ?? 0)), Math.floor(attackerNation.military.units.missile + 1e-9))
  attacker.boost = spec.boost
  attacker.damageTaken = spec.ownLosses
  const garrison = emptyUnits()
  garrison.infantry = garrisonStrength(s, map, target)
  const defNotes: string[] = []
  // What stands on station fights where it stands: a garrison best on its own border, patrols against a landing.
  const weights = defenseWeights(s, defenderId, nationId, reach.bySea)
  const defending = weights ? { ...defenderNation.military, units: scaled(defenderNation.military.units, weights) } : defenderNation.military
  if (weights && UNIT_TYPES.some((k) => Math.abs(weights[k] - 1) > 0.02 && defenderNation.military.units[k] >= 0.05)) defNotes.push('forces on station: strongest at their own post')
  const defender = makeCombatant(defenderNation, defending, garrison, defNotes, 1, defendingShare(s, defenderNation, target, defNotes))
  return { attacker, defender, garrison, share, bySea: reach.bySea, defendShare: defendingShare(s, defenderNation, target, []), via: reach.via, sunk, intercept, surprise, picked }
}

export interface AttackForecast {
  /** Share of your military this attack would send. */
  share: number
  winChance: number
  /** True when AI Battle Command ran the fight enough times to make the odds exact. */
  exact: boolean
  /** Average Defense Line points pushed back, counting losses as zero. */
  lineDamage: number
  lineBefore: number
  lineMax: number
  /** Chance the country falls to this one attack. */
  captureChance: number
  /** Average divisions you lose. */
  yourLosses: number
  theirLosses: number
  label: 'Likely' | 'Even' | 'Risky'
}

/** Plays the attack out several times on fixed seeds, so the War Room can show honest odds without changing the game. */
export function forecastAttack(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, commit: Commit, stance: Stance, runs?: number, missiles?: number, custom?: number, named?: Partial<UnitCounts>): AttackForecast | null {
  const setup = prepareAttack(s, map, nationId, target, commit, stance, missiles, undefined, custom, named)
  if (!setup) return null
  // AI Battle Command plays the fight many more times, so its odds are exact.
  const exact = (s.nations[nationId]?.systems?.ai ?? 0) > 0
  runs ??= exact ? 64 : 16
  const mr = map.regions[target]
  const max = lineMax(s, map, target)
  const before = Math.min(s.regions[target].line, max)
  const spec = blitzSpec(s.nations[nationId], stance)
  const missileCut = setup.attacker.units.missile * FRONTIER.missileLine * batteryThrough(setup.attacker, setup.defender, s.nations[s.regions[target].owner]?.systems?.shield ?? 0)
  let wins = 0
  let damage = 0
  let captures = 0
  let mine = 0
  let theirs = 0
  for (let i = 0; i < runs; i++) {
    const out = resolveBattle({ attacker: setup.attacker, defender: setup.defender, terrain: mr.terrain, coastal: mr.coastal }, createRng(s.seed, 90210 + i))
    mine += totalUnits(out.attackerLosses)
    theirs += totalUnits(out.defenderLosses)
    if (out.winner !== 'attacker') continue
    wins++
    const ratio = Math.min(WAR.maxPowerRatio, Math.max(WAR.minPowerRatio, out.attackerPower / Math.max(0.1, out.defenderPower)))
    // The same push as the real fight, artillery included.
    const push = WAR.advanceBase * ratio * spec.advance * gunBonus(setup.attacker.units, stance) * bomberBonus(setup.attacker.air, setup.attacker.units)
    damage += Math.min(before, push + missileCut)
    if (push + missileCut >= before) captures++
  }
  const winChance = wins / runs
  return {
    share: setup.share,
    winChance,
    exact,
    lineDamage: damage / runs,
    lineBefore: before,
    lineMax: max,
    captureChance: captures / runs,
    yourLosses: mine / runs,
    theirLosses: theirs / runs,
    label: winChance >= 0.75 ? 'Likely' : winChance >= 0.4 ? 'Even' : 'Risky',
  }
}

export function resolveAttack(
  s: GameState,
  map: WorldMap,
  nationId: NationId,
  target: RegionId,
  rng: Rng,
  commit: Commit = 'main',
  stance: Stance = 'assault',
  missiles?: number,
  /** Live mode: the army that arrived. Its units fight and take the losses, and the bookkeeping of a month's attacks is skipped. */
  army?: Army,
  /** Turn mode: a chosen share of the military, in place of the preset the commit names. */
  custom?: number,
  /** Turn mode: exactly these units, in place of a share. */
  named?: Partial<UnitCounts>,
): AttackResult | null {
  const setup = prepareAttack(s, map, nationId, target, commit, stance, missiles, army, custom, named)
  if (!setup) return null
  const { attacker, defender, garrison, share } = setup
  const attackerNation = s.nations[nationId]
  const targetRegion = s.regions[target]
  const mr = map.regions[target]
  const defenderId = targetRegion.owner
  const defenderNation = s.nations[defenderId]
  const spec = blitzSpec(attackerNation, stance)

  const outcome = resolveBattle({ attacker, defender, terrain: mr.terrain, coastal: mr.coastal }, rng)
  const mine = army ? army.units : attackerNation.military.units
  // Whatever the patrols sank on the way in is gone before the fight.
  if (setup.sunk) for (const k of UNIT_TYPES) mine[k] = Math.max(0, mine[k] - setup.sunk[k])
  applyLosses(mine, emptyUnits(), outcome.attackerLosses)
  // Only the part of the defender's military that stood here (the rest held other fronts) and the garrison share the losses.
  const standing = emptyUnits()
  for (const k of UNIT_TYPES) standing[k] = defenderNation.military.units[k] * setup.defendShare
  const defMilLosses = militaryLosses(standing, garrison, outcome.defenderLosses)
  applyLosses(standing, garrison, outcome.defenderLosses)
  for (const k of UNIT_TYPES) defenderNation.military.units[k] = defenderNation.military.units[k] * (1 - setup.defendShare) + standing[k]
  // Nano-medicine brings part of what a side lost back.
  // Every missile fired is used up, unless the fight already took it as a loss.
  const firedMissiles = attacker.units.missile
  if (firedMissiles > 0) mine.missile = Math.max(0, mine.missile - Math.max(0, firedMissiles - outcome.attackerLosses.missile))
  const savedA = reviveLosses(attackerNation, outcome.attackerLosses, mine)
  const savedD = reviveLosses(defenderNation, defMilLosses)
  // Doctors return part of the wounded infantry to the ranks (more with modern surgery). A force that was wiped out has nobody to carry them back.
  const healedA = totalUnits(mine) >= 0.05 ? treatWounded(attackerNation, outcome.attackerLosses, mine) : 0
  const healedD = totalUnits(defenderNation.military.units) >= 0.05 ? treatWounded(defenderNation, defMilLosses) : 0
  if (!army) {
    const m = attackerNation.military
    m.attacksThisTurn = m.lastAttackTurn === s.turn ? m.attacksThisTurn + 1 : 1
    m.lastAttackTurn = s.turn
    m.exposed = Math.min(1, m.exposed + share)
    // A force chosen by name is spent for the month: it cannot be named again until the turn ends.
    if (setup.picked) {
      const spent = (m.sent ??= emptyUnits())
      for (const k of SENDABLE) spent[k] += setup.picked[k]
    }
  }
  // Machines do not tire a people: robots, drones and missiles lost add no war weariness.
  const machines = (l: UnitCounts) => l.robot + l.drone + l.missile
  const attLoss = totalUnits(outcome.attackerLosses) - machines(outcome.attackerLosses)
  const defLoss = totalUnits(outcome.defenderLosses) - machines(outcome.defenderLosses)
  attackerNation.warWeariness = Math.min(60, attackerNation.warWeariness + attLoss * 0.6)
  defenderNation.warWeariness = Math.min(60, defenderNation.warWeariness + defLoss * 0.6)

  // A win pushes the Defense Line back. More force and a bigger edge push it further.
  const max = lineMax(s, map, target)
  const lineBefore = Math.min(targetRegion.line, max)
  let lineAfter = lineBefore
  if (outcome.winner === 'attacker') {
    const ratio = Math.min(WAR.maxPowerRatio, Math.max(WAR.minPowerRatio, outcome.attackerPower / Math.max(0.1, outcome.defenderPower)))
    const guns = gunBonus(attacker.units, stance) * bomberBonus(attacker.air, attacker.units)
    lineAfter = Math.max(0, lineBefore - WAR.advanceBase * ratio * spec.advance * guns)
    if (spec.siegeTurns > 0) targetRegion.sabotaged = Math.max(targetRegion.sabotaged, spec.siegeTurns)
  }
  // Hypersonic batteries crack the Defense Line directly, win or lose, unless the shield stops them.
  const missileHits = attacker.units.missile * FRONTIER.missileLine * batteryThrough(attacker, defender, defenderNation.systems?.shield ?? 0)
  if (missileHits > 0 && lineAfter > 0) lineAfter = Math.min(lineAfter, Math.max(outcome.winner === 'attacker' ? 0 : 0.5, lineAfter - missileHits))
  targetRegion.line = lineAfter
  targetRegion.attackedTurn = s.turn

  const captured = outcome.winner === 'attacker' && lineAfter <= 0
  const wasCapital = defenderNation.capital === target
  // A live army says whether its share was chosen; in a turn game the order says so.
  const chosen = army ? !!army.chosen : custom !== undefined || !!setup.picked
  const report: BattleReport = {
    id: newId(s, 'b'),
    turn: s.turn,
    regionId: target,
    attacker: { nationId, units: attacker.units, losses: outcome.attackerLosses },
    defender: { nationId: defenderId, units: defender.units, losses: outcome.defenderLosses },
    rounds: outcome.rounds,
    winner: outcome.winner,
    captured,
    modifiers: [...outcome.modifiers, `${spec.name} with ${chosen ? 'a chosen force' : COMMITS[commit].name.toLowerCase()} (${Math.round(share * 100)}% of the military)`],
    commit,
    stance,
    lineBefore,
    lineAfter,
    lineMax: max,
    ...(army ? { armyId: army.id } : {}),
    ...(chosen ? { chosen } : {}),
    ...(setup.intercept ? { intercept: setup.intercept } : {}),
    ...(setup.surprise > 0.005 ? { surprise: setup.surprise } : {}),
  }
  s.battles.push(report)
  if (outcome.winner === 'attacker') reach(attackerNation, 'win')
  if (captured) reach(attackerNation, 'capture')
  if (captured) transferRegion(s, map, target, nationId)
  recordBattle(s, report, captured && wasCapital)
  if (captured) {
    addOpinion(s, defenderId, nationId, 'Seized our land', -8, 0.2)
    addInfamy(s, nationId, JUSTIFY.infamyCapture)
  }
  const verb = captured ? 'captured' : outcome.winner === 'attacker' ? 'pushed back the defense of' : 'was repulsed attacking'
  addLog(s, 'battle', `${attackerNation.name} ${verb} ${mr.name} (held by ${defenderNation.name}).`, [nationId, defenderId])
  if (setup.intercept) {
    const by = defenderNation.name
    report.modifiers.push(`${by}'s patrols met the landing at sea and sank ${setup.intercept.sunk.toFixed(1)} divisions of it`)
    addLog(s, 'war', `${by}'s patrols intercepted ${attackerNation.name}'s landing on ${mr.name} and sank ${setup.intercept.sunk.toFixed(1)} divisions of it.`, [nationId, defenderId])
  }
  if (setup.surprise > 0.005) addLog(s, 'war', `${attackerNation.name} struck ${mr.name} across a border ${defenderNation.name} was not guarding.`, [nationId, defenderId])
  if (firedMissiles >= 0.5) report.modifiers.push(`Fired ${Math.round(firedMissiles)} hypersonic missile${Math.round(firedMissiles) === 1 ? '' : 's'} (used up)`)
  if (missileHits > 0) report.modifiers.push(`Hypersonic batteries cut the Defense Line by ${missileHits.toFixed(1)}`)
  if (savedA + savedD > 0) report.modifiers.push(`Nano-medicine saved ${(savedA + savedD).toFixed(1)} divisions`)
  if (healedA + healedD >= 0.05) report.modifiers.push(`Field hospitals returned ${(healedA + healedD).toFixed(1)} divisions of wounded infantry`)
  if (captured) updateTiers(s)
  return { report }
}

export function resolveRebels(s: GameState, map: WorldMap, rng: Rng) {
  const regions = Object.values(s.regions)
    .filter((r) => r.rebels > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const region of regions) {
    const ownerId = region.owner
    const owner = s.nations[ownerId]
    if (!owner?.alive) continue
    region.rebels *= 1.06
    const mr = map.regions[region.id]
    const rebels = { ...emptyUnits(), infantry: region.rebels }
    const garrison = emptyUnits()
    garrison.infantry = garrisonStrength(s, map, region.id)
    const attacker: Combatant = { units: rebels, mods: null, penalty: 1, penaltyNotes: [] }
    // Rebels are fought by the garrison and a share of the army sent to the trouble, not the whole military.
    const defender = makeCombatant(owner, owner.military, garrison, [], 1, WAR.rebelArmyShare)
    const outcome = resolveBattle({ attacker, defender, terrain: mr.terrain, coastal: mr.coastal }, rng)
    const sent = emptyUnits()
    for (const k of UNIT_TYPES) sent[k] = owner.military.units[k] * WAR.rebelArmyShare
    applyLosses(sent, garrison, outcome.defenderLosses)
    for (const k of UNIT_TYPES) owner.military.units[k] = owner.military.units[k] * (1 - WAR.rebelArmyShare) + sent[k]
    region.rebels = Math.max(0, region.rebels - outcome.attackerLosses.infantry)

    let captured = false
    if (outcome.winner === 'attacker' && region.rebels >= 0.1) {
      captured = true
      secede(s, map, region.id, region.rebels)
    } else if (region.rebels < 0.2) {
      region.rebels = 0
      addLog(s, 'event', `The insurgency in ${mr.name} has been crushed.`, [ownerId])
    }
    s.battles.push({
      id: newId(s, 'b'),
      turn: s.turn,
      regionId: region.id,
      attacker: { nationId: 'rebels', units: rebels, losses: outcome.attackerLosses },
      defender: { nationId: ownerId, units: defender.units, losses: outcome.defenderLosses },
      rounds: outcome.rounds,
      winner: outcome.winner,
      captured,
      modifiers: outcome.modifiers,
    })
  }
}

function secede(s: GameState, map: WorldMap, regionId: RegionId, strength: number) {
  const mr = map.regions[regionId]
  const oldOwner = s.regions[regionId].owner
  let nationId: NationId = regionId
  const existing = s.nations[regionId]
  const military = emptyMilitary({ ...emptyUnits(), infantry: strength })
  s.regions[regionId].integration = 1
  s.regions[regionId].line = lineMax(s, map, regionId) * 0.5
  if (existing && !existing.alive) {
    existing.alive = true
    existing.capital = regionId
    existing.resources = { capital: 20, food: 10, pp: 10, tp: existing.resources.tp, oil: 4, steel: 3, goods: 6 }
    existing.stability = 55
    existing.warWeariness = 0
    existing.military = military
  } else {
    nationId = `free-${regionId}-${s.turn}`
    const base = existing ?? s.nations[oldOwner]
    const parent = s.nations[oldOwner]
    // A new nation starts clean: none of its old ruler's debts, ties, Frontier systems or companies, and only the basics of its knowledge.
    const known = (parent?.techs ?? []).filter((t, _i, all) => (TECH_BY_ID[t]?.requires ?? []).every((r) => all.includes(r)) && (TECH_BY_ID[t]?.cost ?? 0) <= WAR.secedeTechCost)
    s.nations[nationId] = {
      ...structuredClone(base),
      overlord: null,
      overlordSince: undefined,
      debt: 0,
      redMonths: 0,
      defaultedUntil: 0,
      subsidies: [],
      techs: known,
      systems: { cyber: 0, shield: 0, ai: 0, quantum: 0, orbital: 0, nano: 0 },
      agencies: { foreign: { level: 1, exp: 0 }, domestic: { level: 1, exp: 0 } },
      sectors: Object.fromEntries(Object.entries(base.sectors).map(([k, v]) => [k, Math.min(v, 1)])) as Nation['sectors'],
      milestones: undefined,
      lastReform: -99,
      id: nationId,
      name: `Free ${mr.name}`,
      color: `hsl(${(s.turn * 47) % 360}, 70%, 55%)`,
      capital: regionId,
      originalCapital: regionId,
      isPlayer: false,
      alive: true,
      resources: { capital: 20, food: 10, pp: 10, tp: 0, oil: 4, steel: 3, goods: 6 },
      militaryPool: 0,
      stability: 55,
      warWeariness: 0,
      laws: [],
      generals: [],
      aggression: 0.3,
      personality: 'turtle',
      debtTurns: 0,
      embargoedUntil: 0,
      foodShortage: false,
      inDebt: false,
      military,
    }
  }
  transferRegion(s, map, regionId, nationId, false)
  const key = pairKey(nationId, oldOwner)
  if (s.nations[oldOwner]?.alive && !s.wars.includes(key)) {
    s.wars.push(key)
    s.wars.sort()
    s.warStarted[key] = s.turn
  }
  addLog(s, 'war', `${mr.name} has seceded from ${s.nations[oldOwner].name} and declared independence as ${s.nations[nationId].name}!`, [oldOwner, nationId])
}
