import { addOpinion, forgetNation } from '../ai/opinion'
import { TRAINING } from '../data/unitTypes'
import { combatMods, contractNote } from './arms'
import { regionWorkforce } from './economy'
import { resolveBattle, type Combatant } from './combat'
import { recordBattle } from './warscore'
import {
  addLog,
  armiesIn,
  atWar,
  createArmy,
  emptyUnits,
  hasTech,
  nationModifiers,
  newId,
  pairKey,
  regionsOf,
  sumUnits,
  totalUnits,
} from './helpers'
import type { Rng } from './rng'
import type { Army, BattleReport, GameState, Nation, NationId, Order, RegionId, UnitCounts, WorldMap } from './types'
import { UNIT_TYPES } from './types'

export interface Reach {
  ok: boolean
  bySea: boolean
}

/** Whether an army of `nationId` at `from` can move to / attack `to`. */
export function canReach(s: GameState, map: WorldMap, nationId: NationId, from: RegionId, to: RegionId, kind: 'move' | 'attack'): Reach {
  if (from === to) return { ok: kind === 'attack', bySea: false }
  const mr = map.regions[from]
  if (mr.neighbors.includes(to)) return { ok: true, bySea: false }
  if (!mr.seaLanes.includes(to)) return { ok: false, bySea: false }
  const n = s.nations[nationId]
  const hasPort = s.regions[from].buildings.port > 0
  if (kind === 'move') return { ok: hasPort && hasTech(n, 'naval_gunboats'), bySea: true }
  return { ok: hasPort && nationModifiers(n).seaInvasion, bySea: true }
}

export function garrisonStrength(s: GameState, map: WorldMap, regionId: RegionId): number {
  const r = s.regions[regionId]
  const owner = s.nations[r.owner]
  const isCapital = owner?.capital === regionId
  return 0.5 + r.buildings.barracks * 0.75 + (isCapital ? 1 : 0) + regionWorkforce(r, map.regions[regionId]) * 0.05
}

export function killNation(s: GameState, id: NationId, by: NationId | null) {
  const n = s.nations[id]
  if (!n.alive) return
  n.alive = false
  n.contracts = []
  for (const other of Object.values(s.nations)) other.contracts = (other.contracts ?? []).filter((c) => c.supplier !== id)
  for (const a of Object.values(s.armies)) if (a.owner === id) delete s.armies[a.id]
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
  addLog(s, 'war', conqueror ? `${n.name} has fallen to ${conqueror.name}!` : `${n.name} has collapsed.`, by ? [id, by] : [id])
}

/** Hands a region to a new owner. Conquest razes barracks and depots; a negotiated cession keeps them. */
export function transferRegion(s: GameState, map: WorldMap, regionId: RegionId, newOwner: NationId, raze = true) {
  const region = s.regions[regionId]
  const oldOwner = region.owner
  region.owner = newOwner
  region.rebels = 0
  if (raze) {
    region.buildings.barracks = 0
    region.buildings.depot = 0
  }
  for (const a of armiesIn(s, regionId, oldOwner)) {
    const retreat = map.regions[regionId].neighbors.find((x) => s.regions[x]?.owner === oldOwner)
    if (retreat) a.location = retreat
    else delete s.armies[a.id]
  }
  const old = s.nations[oldOwner]
  if (!old) return
  const remaining = regionsOf(s, oldOwner)
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

function distributeLosses(armies: Army[], losses: UnitCounts, extra?: UnitCounts) {
  const totals = sumUnits([...armies.map((a) => a.units), ...(extra ? [extra] : [])])
  for (const k of UNIT_TYPES) {
    if (totals[k] <= 0) continue
    for (const a of armies) a.units[k] = Math.max(0, a.units[k] - losses[k] * (a.units[k] / totals[k]))
    if (extra) extra[k] = Math.max(0, extra[k] - losses[k] * (extra[k] / totals[k]))
  }
}

function pruneArmies(s: GameState) {
  for (const a of Object.values(s.armies)) if (totalUnits(a.units) < 0.1) delete s.armies[a.id]
}

function bestGeneral(n: Nation, armies: Army[]) {
  for (const a of armies) {
    const g = n.generals.find((x) => x.id === a.generalId)
    if (g) return g.trait
  }
  return null
}

/** Training bonus diluted by untrained garrison troops, so a green militia does not inherit an elite army's drill. */
function trainingBonus(armies: Army[], extra: UnitCounts | null): number {
  let units = extra ? totalUnits(extra) : 0
  let weighted = 0
  for (const a of armies) {
    const t = totalUnits(a.units)
    units += t
    weighted += t * Math.max(0, Math.min(TRAINING.max, a.training ?? 0))
  }
  return units > 0 ? (weighted / units) * TRAINING.bonusPerLevel : 0
}

/** Defense bonus for armies that have dug in: +10% after two months in place, +20% after three. */
function entrenchmentBonus(armies: Army[]): number {
  let units = 0
  let weighted = 0
  for (const a of armies) {
    const t = totalUnits(a.units)
    units += t
    weighted += t * Math.max(0, Math.min(3, a.entrenched ?? 0) - 1) * 0.1
  }
  return units > 0 ? Math.round((weighted / units) * 100) / 100 : 0
}

function makeCombatant(s: GameState, n: Nation | null, armies: Army[], extra: UnitCounts | null, notes: string[], penalty: number, defending = false): Combatant {
  let p = penalty
  if (n?.foodShortage) {
    p *= 0.7
    notes.push('food shortage (-30%)')
  }
  const drilled = trainingBonus(armies, extra)
  if (drilled > 0.005) {
    p *= 1 + drilled
    notes.push(`training (+${Math.round(drilled * 100)}%)`)
  }
  const dug = defending ? entrenchmentBonus(armies) : 0
  if (dug > 0) {
    p *= 1 + dug
    notes.push(`entrenched (+${Math.round(dug * 100)}%)`)
  }
  if (n && !defending) {
    const arms = contractNote(n, s.turn)
    if (arms) notes.push(arms)
  }
  return {
    units: sumUnits([...armies.map((a) => a.units), ...(extra ? [extra] : [])]),
    mods: n ? combatMods(n, s.turn) : null,
    general: n ? bestGeneral(n, armies) : null,
    penalty: p,
    penaltyNotes: notes,
  }
}

export function resolveMoves(s: GameState, map: WorldMap, orders: Order[], moved: Set<string>) {
  for (const o of orders) {
    if (o.type !== 'move') continue
    const a = s.armies[o.armyId]
    if (!a || a.owner !== o.nationId || moved.has(a.id)) continue
    if (s.regions[o.to]?.owner !== o.nationId) continue
    if (!canReach(s, map, o.nationId, a.location, o.to, 'move').ok) continue
    a.location = o.to
    moved.add(a.id)
  }
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function resolveAttacks(s: GameState, map: WorldMap, orders: Order[], rng: Rng, used: Set<string>) {
  const groups = new Map<string, { nationId: NationId; target: RegionId; armyIds: string[] }>()
  for (const o of orders) {
    if (o.type !== 'attack') continue
    const key = `${o.nationId}>${o.target}`
    const g = groups.get(key) ?? { nationId: o.nationId, target: o.target, armyIds: [] }
    g.armyIds.push(o.armyId)
    groups.set(key, g)
  }
  const keys = shuffle([...groups.keys()].sort(), rng)
  for (const key of keys) {
    const g = groups.get(key)!
    const attackerNation = s.nations[g.nationId]
    if (!attackerNation?.alive) continue
    const targetRegion = s.regions[g.target]
    const mr = map.regions[g.target]
    const defenderId = targetRegion.owner
    const suppression = defenderId === g.nationId
    if (suppression ? targetRegion.rebels <= 0 : !atWar(s, g.nationId, defenderId)) continue

    let bySea = false
    const armies: Army[] = []
    for (const id of g.armyIds) {
      const a = s.armies[id]
      if (!a || a.owner !== g.nationId || used.has(id) || totalUnits(a.units) < 0.1) continue
      const reach = canReach(s, map, g.nationId, a.location, g.target, 'attack')
      if (!reach.ok) continue
      bySea ||= reach.bySea
      armies.push(a)
    }
    if (!armies.length) continue
    for (const a of armies) used.add(a.id)

    const attNotes: string[] = []
    let attPenalty = 1
    if (armies.some((a) => a.outOfSupplyTurns > 0)) {
      attPenalty *= 0.6
      attNotes.push('out of supply (-40%)')
    }
    if (bySea) {
      const reduction = nationModifiers(attackerNation).amphibiousPenaltyReduction
      attPenalty *= 1 - 0.4 * (1 - reduction)
      attNotes.push(`amphibious assault (-${Math.round(40 * (1 - reduction))}%)`)
    }
    const attacker = makeCombatant(s, attackerNation, armies, null, attNotes, attPenalty)

    const defenderNation = suppression ? null : s.nations[defenderId]
    const defArmies = suppression ? [] : armiesIn(s, g.target, defenderId)
    const garrison = emptyUnits()
    if (suppression) garrison.infantry = targetRegion.rebels
    else garrison.infantry = garrisonStrength(s, map, g.target)
    const defender = makeCombatant(s, defenderNation, defArmies, garrison, [], 1, true)
    const wasCapital = !suppression && s.nations[defenderId]?.capital === g.target

    const outcome = resolveBattle({ attacker, defender, terrain: mr.terrain, coastal: mr.coastal }, rng)
    distributeLosses(armies, outcome.attackerLosses)
    distributeLosses(defArmies, outcome.defenderLosses, garrison)

    const attLoss = totalUnits(outcome.attackerLosses)
    const defLoss = totalUnits(outcome.defenderLosses)
    attackerNation.warWeariness = Math.min(60, attackerNation.warWeariness + attLoss * 0.6)
    if (defenderNation) defenderNation.warWeariness = Math.min(60, defenderNation.warWeariness + defLoss * 0.6)

    const fromRegionId = armies[0].location
    let captured = false
    if (suppression) {
      targetRegion.rebels = outcome.winner === 'attacker' ? 0 : garrison.infantry
    } else if (outcome.winner === 'attacker') {
      pruneArmies(s)
      const survivors = armies.filter((a) => s.armies[a.id])
      if (survivors.length) {
        transferRegion(s, map, g.target, g.nationId)
        captured = true
        const lead = survivors[0]
        let leadUnits = totalUnits(lead.units)
        for (const a of survivors.slice(1)) {
          const extra = totalUnits(a.units)
          const sum = leadUnits + extra
          if (sum > 0) lead.training = Math.max(0, Math.min(TRAINING.max, Math.round(((lead.training ?? 0) * leadUnits + (a.training ?? 0) * extra) / sum)))
          leadUnits = sum
          for (const k of UNIT_TYPES) lead.units[k] += a.units[k]
          if (!lead.generalId) lead.generalId = a.generalId
          delete s.armies[a.id]
        }
        if (!mr.coastal && lead.units.naval > 0) {
          const origin = lead.location
          const fleet = createArmy(s, {
            owner: g.nationId,
            location: origin,
            units: { ...emptyUnits(), naval: lead.units.naval },
            homeTerritoryId: openMuster(s, map, origin, g.nationId),
            training: lead.training ?? 0,
          })
          fleet.outOfSupplyTurns = lead.outOfSupplyTurns
          used.add(fleet.id)
          lead.units.naval = 0
        }
        lead.location = g.target
      }
    }
    pruneArmies(s)

    const report: BattleReport = {
      id: newId(s, 'b'),
      turn: s.turn,
      regionId: g.target,
      fromRegionId,
      attacker: { nationId: g.nationId, units: attacker.units, losses: outcome.attackerLosses },
      defender: { nationId: suppression ? 'rebels' : defenderId, units: defender.units, losses: outcome.defenderLosses },
      rounds: outcome.rounds,
      winner: outcome.winner,
      captured,
      modifiers: outcome.modifiers,
    }
    s.battles.push(report)
    if (!suppression) {
      recordBattle(s, report, wasCapital && captured)
      if (captured) addOpinion(s, defenderId, g.nationId, 'Seized our land', -8, 0.2)
    }
    const defName = suppression ? 'rebels' : s.nations[defenderId].name
    const verb = suppression
      ? outcome.winner === 'attacker' ? 'crushed the rebels in' : 'failed to crush the rebels in'
      : captured ? 'captured' : 'was repulsed attacking'
    addLog(s, 'battle', `${attackerNation.name} ${verb} ${mr.name}${suppression ? '' : ` (held by ${defName})`}.`, suppression ? [g.nationId] : [g.nationId, defenderId])
  }
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
    const defArmies = armiesIn(s, region.id, ownerId)
    const garrison = { ...emptyUnits(), infantry: garrisonStrength(s, map, region.id) }
    const attacker: Combatant = { units: rebels, mods: null, general: null, penalty: 1, penaltyNotes: [] }
    const defender = makeCombatant(s, owner, defArmies, garrison, [], 1, true)
    const outcome = resolveBattle({ attacker, defender, terrain: mr.terrain, coastal: mr.coastal }, rng)
    distributeLosses(defArmies, outcome.defenderLosses, garrison)
    region.rebels = Math.max(0, region.rebels - outcome.attackerLosses.infantry)
    pruneArmies(s)

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
      fromRegionId: null,
      attacker: { nationId: 'rebels', units: rebels, losses: outcome.attackerLosses },
      defender: { nationId: ownerId, units: defender.units, losses: outcome.defenderLosses },
      rounds: outcome.rounds,
      winner: outcome.winner,
      captured,
      modifiers: outcome.modifiers,
    })
  }
}

function openMuster(s: GameState, map: WorldMap, regionId: RegionId, owner: NationId): string {
  for (const id of map.territoriesByRegion[regionId] ?? []) {
    let taken = false
    for (const a of Object.values(s.armies)) if (a.homeTerritoryId === id && a.owner === owner) taken = true
    if (!taken) return id
  }
  return ''
}

function secede(s: GameState, map: WorldMap, regionId: RegionId, strength: number) {
  const mr = map.regions[regionId]
  const oldOwner = s.regions[regionId].owner
  let nationId: NationId = regionId
  const existing = s.nations[regionId]
  if (existing && !existing.alive) {
    existing.alive = true
    existing.capital = regionId
    existing.resources = { capital: 20, food: 10, pp: 10, tp: existing.resources.tp }
    existing.stability = 55
    existing.warWeariness = 0
    existing.contracts = []
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
      resources: { capital: 20, food: 10, pp: 10, tp: 0 },
      stability: 55,
      warWeariness: 0,
      laws: [],
      generals: [],
      vision: {},
      aggression: 0.3,
      personality: 'turtle',
      debtTurns: 0,
      embargoedUntil: 0,
      foodShortage: false,
      inDebt: false,
      contracts: [],
    }
  }
  transferRegion(s, map, regionId, nationId, false)
  createArmy(s, {
    owner: nationId,
    location: regionId,
    units: { ...emptyUnits(), infantry: strength },
    homeTerritoryId: map.territoriesByRegion[regionId]?.[0] ?? '',
  })
  const key = pairKey(nationId, oldOwner)
  if (s.nations[oldOwner]?.alive && !s.wars.includes(key)) {
    s.wars.push(key)
    s.wars.sort()
    s.warStarted[key] = s.turn
  }
  addLog(s, 'war', `${mr.name} has seceded from ${s.nations[oldOwner].name} and declared independence as ${s.nations[nationId].name}!`, [oldOwner, nationId])
}
