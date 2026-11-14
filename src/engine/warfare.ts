import { addOpinion, forgetNation } from '../ai/opinion'
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
import { recordBattle } from './warscore'
import { addInfamy, addLog, atWar, distanceKm, emptyUnits, nationModifiers, newId, pairKey, reach, regionsOf, totalUnits } from './helpers'
import type { Rng } from './rng'
import type { BattleReport, GameState, Military, Nation, NationId, RegionId, UnitCounts, WorldMap } from './types'
import { UNIT_TYPES } from './types'

export { distanceKm }

export interface Reach {
  ok: boolean
  /** Whether the attack crosses water or air and so fights with the amphibious penalty. */
  bySea: boolean
  via?: 'land' | 'lane' | 'fleet' | 'air'
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
  const u = n.military.units
  const fleet = t.coastal && u.naval >= REACH.navalUnits
  const air = u.fighter + u.air >= REACH.airUnits
  if (!fleet && !air) return { ok: false, bySea: false }
  let by: Reach['via'] | null = null
  for (const r of Object.values(s.regions)) {
    if (r.owner !== nationId) continue
    const from = map.regions[r.id]
    if (!from) continue
    const km = distanceKm(from, t)
    if (fleet && r.buildings.port > 0 && km <= REACH.seaKm) return { ok: true, bySea: true, via: 'fleet' }
    if (air && r.buildings.factory > 0 && km <= REACH.airKm) by = 'air'
  }
  return by ? { ok: true, bySea: true, via: by } : { ok: false, bySea: false }
}

/** Why a nation cannot reach a country, in words a player can act on. */
export function reachProblem(s: GameState, map: WorldMap, nationId: NationId, target: RegionId): string {
  const t = map.regions[target]
  const u = s.nations[nationId]?.military.units
  const hasPort = Object.values(s.regions).some((r) => r.owner === nationId && r.buildings.port > 0)
  const navy = u && u.naval >= REACH.navalUnits
  const air = u && u.fighter + u.air >= REACH.airUnits
  const sea = !t?.coastal ? 'ships cannot reach an inland country' : hasPort ? (navy ? '' : 'train warships to sail from your port') : navy ? 'build a port for your warships' : 'build a port and train warships'
  const sky = air ? 'it is beyond your air range, and you need a factory close enough to use as an airbase' : 'or train fighters or strike aircraft and keep a factory as an airbase'
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
  n.military = emptyMilitary()
  s.trainingQueue = (s.trainingQueue ?? []).filter((job) => job.nationId !== id)
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
  seize(s, map, regionId, newOwner, raze)
  const old = s.nations[oldOwner]
  if (!old) return
  const remaining = regionsOf(s, oldOwner)
  // A nation whose capital has fallen and whose army is gone has nothing left to fight with. It surrenders whole.
  // A player who crushes an army also wins the war outright: the beaten nation gives up when its army is a fraction of the conqueror's.
  const crushed = s.nations[newOwner]?.isPlayer && totalUnits(old.military.units) < totalUnits(s.nations[newOwner].military.units) * EMPIRE.surrenderShare
  if (raze && remaining.length > 0 && old.capital === regionId && (totalUnits(old.military.units) < EMPIRE.surrenderUnits || crushed)) {
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

/** Nano-medicine returns part of a side's losses to its military. Returns the divisions saved. */
function reviveLosses(n: Nation, losses: UnitCounts): number {
  const share = NANO_REVIVE[Math.max(0, Math.min(3, n.systems?.nano ?? 0))]
  if (share <= 0) return 0
  let saved = 0
  for (const k of UNIT_TYPES) {
    const back = losses[k] * share
    n.military.units[k] += back
    saved += back
  }
  return saved
}

/** Spreads a side's losses over its military and the garrison that stood beside it. */
function applyLosses(military: Military, garrison: UnitCounts, losses: UnitCounts) {
  for (const k of UNIT_TYPES) {
    const total = military.units[k] + garrison[k]
    if (total <= 0) continue
    military.units[k] = Math.max(0, military.units[k] - losses[k] * (military.units[k] / total))
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
  return { units, drill, mods: n ? combatMods(n) : null, penalty: p, penaltyNotes: notes, vehicleMult, sys: n ? { ...n.systems } : undefined }
}

/** Share of a nation's military that is free to defend: units committed to attacks this turn fight at half strength. */
function defendingShare(n: Nation, notes: string[]): number {
  const tired = n.military.exposed * WAR.exposedDefenseLoss
  if (tired > 0.01) notes.push(`army committed abroad (-${Math.round(tired * 100)}% of the military)`)
  return 1 - tired
}

/** Share of the military an attack by `n` would commit right now, or 0 if it is spent. */
export function commitShare(n: Nation, commit: Commit): number {
  return Math.max(0, Math.min(COMMITS[commit].share, 1 - n.military.exposed))
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
}

/** Builds both sides of an attack, or null if it is not allowed. Shared by the real fight and the forecast. */
function prepareAttack(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, commit: Commit, stance: Stance, missiles?: number): Setup | null {
  const attackerNation = s.nations[nationId]
  const targetRegion = s.regions[target]
  const mr = map.regions[target]
  if (!attackerNation?.alive || !targetRegion || !mr) return null
  const defenderId = targetRegion.owner
  const defenderNation = s.nations[defenderId]
  if (defenderId === nationId || !defenderNation?.alive || !atWar(s, nationId, defenderId)) return null
  const reach = canAttackRegion(s, map, nationId, target)
  const share = commitShare(attackerNation, commit)
  if (!reach.ok || share < 0.05 || totalUnits(attackerNation.military.units) < 0.1) return null

  const spec = STANCES[stance]
  const attNotes: string[] = []
  let attPenalty = 1
  if (reach.bySea) {
    // An Orbital Network helps every landing, from sea or air.
    const reduction = Math.min(0.9, nationModifiers(attackerNation).amphibiousPenaltyReduction + FRONTIER.orbitalLanding * (attackerNation.systems?.orbital ?? 0))
    attPenalty *= 1 - 0.4 * (1 - reduction)
    attNotes.push(`amphibious assault (-${Math.round(40 * (1 - reduction))}%)`)
  }
  const attacker = makeCombatant(attackerNation, attackerNation.military, null, attNotes, attPenalty, share)
  // The player chooses how many missiles to fire. Left out, a share of them fire with the force sent.
  if (missiles !== undefined) attacker.units.missile = Math.min(Math.max(0, Math.floor(missiles)), Math.floor(attackerNation.military.units.missile + 1e-9))
  attacker.boost = spec.boost
  attacker.damageTaken = spec.ownLosses
  const garrison = emptyUnits()
  garrison.infantry = garrisonStrength(s, map, target)
  const defNotes: string[] = []
  const defender = makeCombatant(defenderNation, defenderNation.military, garrison, defNotes, 1, defendingShare(defenderNation, defNotes))
  return { attacker, defender, garrison, share, bySea: reach.bySea }
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
export function forecastAttack(s: GameState, map: WorldMap, nationId: NationId, target: RegionId, commit: Commit, stance: Stance, runs?: number, missiles?: number): AttackForecast | null {
  const setup = prepareAttack(s, map, nationId, target, commit, stance, missiles)
  if (!setup) return null
  // AI Battle Command plays the fight many more times, so its odds are exact.
  const exact = (s.nations[nationId]?.systems?.ai ?? 0) > 0
  runs ??= exact ? 64 : 16
  const mr = map.regions[target]
  const max = lineMax(s, map, target)
  const before = Math.min(s.regions[target].line, max)
  const spec = STANCES[stance]
  const missileCut = setup.attacker.units.missile * FRONTIER.missileLine * interceptFactor(s.nations[s.regions[target].owner]?.systems?.shield ?? 0)
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
    const push = WAR.advanceBase * ratio * spec.advance
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
): AttackResult | null {
  const setup = prepareAttack(s, map, nationId, target, commit, stance, missiles)
  if (!setup) return null
  const { attacker, defender, garrison, share } = setup
  const attackerNation = s.nations[nationId]
  const targetRegion = s.regions[target]
  const mr = map.regions[target]
  const defenderId = targetRegion.owner
  const defenderNation = s.nations[defenderId]
  const spec = STANCES[stance]

  const outcome = resolveBattle({ attacker, defender, terrain: mr.terrain, coastal: mr.coastal }, rng)
  applyLosses(attackerNation.military, emptyUnits(), outcome.attackerLosses)
  applyLosses(defenderNation.military, garrison, outcome.defenderLosses)
  // Nano-medicine brings part of what a side lost back.
  // Every missile fired is used up, unless the fight already took it as a loss.
  const firedMissiles = attacker.units.missile
  if (firedMissiles > 0) attackerNation.military.units.missile = Math.max(0, attackerNation.military.units.missile - Math.max(0, firedMissiles - outcome.attackerLosses.missile))
  const savedA = reviveLosses(attackerNation, outcome.attackerLosses)
  const savedD = reviveLosses(defenderNation, outcome.defenderLosses)
  const m = attackerNation.military
  m.attacksThisTurn = m.lastAttackTurn === s.turn ? m.attacksThisTurn + 1 : 1
  m.lastAttackTurn = s.turn
  m.exposed = Math.min(1, m.exposed + share)
  // Machines do not tire a people: robot losses add no war weariness.
  const attLoss = totalUnits(outcome.attackerLosses) - outcome.attackerLosses.robot
  const defLoss = totalUnits(outcome.defenderLosses) - outcome.defenderLosses.robot
  attackerNation.warWeariness = Math.min(60, attackerNation.warWeariness + attLoss * 0.6)
  defenderNation.warWeariness = Math.min(60, defenderNation.warWeariness + defLoss * 0.6)

  // A win pushes the Defense Line back. More force and a bigger edge push it further.
  const max = lineMax(s, map, target)
  const lineBefore = Math.min(targetRegion.line, max)
  let lineAfter = lineBefore
  if (outcome.winner === 'attacker') {
    const ratio = Math.min(WAR.maxPowerRatio, Math.max(WAR.minPowerRatio, outcome.attackerPower / Math.max(0.1, outcome.defenderPower)))
    const guns = gunBonus(attacker.units, stance)
    lineAfter = Math.max(0, lineBefore - WAR.advanceBase * ratio * spec.advance * guns)
    if (spec.siegeTurns > 0) targetRegion.sabotaged = Math.max(targetRegion.sabotaged, spec.siegeTurns)
  }
  // Hypersonic batteries crack the Defense Line directly, win or lose, unless the shield stops them.
  const missileHits = attacker.units.missile * FRONTIER.missileLine * interceptFactor(defenderNation.systems?.shield ?? 0)
  if (missileHits > 0 && lineAfter > 0) lineAfter = Math.max(outcome.winner === 'attacker' ? 0 : 0.5, lineAfter - missileHits)
  targetRegion.line = lineAfter
  targetRegion.attackedTurn = s.turn

  const captured = outcome.winner === 'attacker' && lineAfter <= 0
  const wasCapital = defenderNation.capital === target
  const report: BattleReport = {
    id: newId(s, 'b'),
    turn: s.turn,
    regionId: target,
    attacker: { nationId, units: attacker.units, losses: outcome.attackerLosses },
    defender: { nationId: defenderId, units: defender.units, losses: outcome.defenderLosses },
    rounds: outcome.rounds,
    winner: outcome.winner,
    captured,
    modifiers: [...outcome.modifiers, `${spec.name} with ${COMMITS[commit].name.toLowerCase()} (${Math.round(share * 100)}% of the military)`],
    commit,
    stance,
    lineBefore,
    lineAfter,
    lineMax: max,
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
  if (firedMissiles >= 0.5) report.modifiers.push(`Fired ${Math.round(firedMissiles)} hypersonic missile${Math.round(firedMissiles) === 1 ? '' : 's'} (used up)`)
  if (missileHits > 0) report.modifiers.push(`Hypersonic batteries cut the Defense Line by ${missileHits.toFixed(1)}`)
  if (savedA + savedD > 0) report.modifiers.push(`Nano-medicine saved ${(savedA + savedD).toFixed(1)} divisions`)
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
    const defender = makeCombatant(owner, owner.military, garrison, [], 1)
    const outcome = resolveBattle({ attacker, defender, terrain: mr.terrain, coastal: mr.coastal }, rng)
    applyLosses(owner.military, garrison, outcome.defenderLosses)
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
    s.nations[nationId] = {
      ...structuredClone(base),
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
