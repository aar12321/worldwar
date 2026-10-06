import { TERRAIN } from '../data/terrain'
import { UNIT_SPECS } from '../data/unitTypes'
import { emptyUnits, totalUnits, type AggregatedModifiers } from './helpers'
import type { Rng } from './rng'
import type { BattleRound, GeneralTrait, Terrain, UnitCounts, UnitType } from './types'
import { UNIT_TYPES } from './types'

export interface Combatant {
  units: UnitCounts
  mods: AggregatedModifiers | null
  general: GeneralTrait | null
  /** Multiplier applied to all combat power (supply, food, amphibious). */
  penalty: number
  penaltyNotes: string[]
}

export interface BattleInput {
  attacker: Combatant
  defender: Combatant
  terrain: Terrain
  coastal: boolean
}

export interface BattleOutcome {
  attackerLosses: UnitCounts
  defenderLosses: UnitCounts
  rounds: BattleRound[]
  winner: 'attacker' | 'defender'
  modifiers: string[]
}

export const COMBAT = {
  damagePerPower: 0.18,
  combinedArmsBonus: 0.25,
  defenderCombinedArmsShare: 0.5,
  minPresence: 0.5,
}

const ROUNDS: { name: string; weights: Record<UnitType, number> }[] = [
  { name: 'Air Strike & Bombardment', weights: { infantry: 0.15, armor: 0, air: 1, naval: 0.7 } },
  { name: 'Infantry Envelopment', weights: { infantry: 1, armor: 0.3, air: 0.2, naval: 0.1 } },
  { name: 'Armored Push', weights: { infantry: 0.5, armor: 1, air: 0.3, naval: 0.2 } },
]

export function hasCombinedArms(u: UnitCounts): boolean {
  return u.infantry >= COMBAT.minPresence && u.armor >= COMBAT.minPresence && u.air >= COMBAT.minPresence
}

export function terrainMultiplier(terrain: Terrain, unit: UnitType, mods: AggregatedModifiers | null): number {
  const base = TERRAIN[terrain].unit[unit]
  return mods?.ignoreMountainPenalty && terrain === 'mountain' ? Math.max(1, base) : base
}

function generalMultiplier(general: GeneralTrait | null, unit: UnitType, terrain: Terrain, defending: boolean): number {
  if (!general) return 1
  if (general === 'mountaineer' && (terrain === 'mountain' || terrain === 'forest')) return 1.3
  if (general === 'blitz' && unit === 'armor' && !defending) return 1.25
  if (general === 'air_marshal' && unit === 'air') return 1.25
  if (general === 'stalwart' && defending) return 1.25
  return 1
}

/** Combat power of one side for a round. */
export function sidePower(
  c: Combatant,
  weights: Record<UnitType, number>,
  terrain: Terrain,
  coastal: boolean,
  defending: boolean,
): number {
  let power = 0
  for (const k of UNIT_TYPES) {
    if (k === 'naval' && !coastal) continue
    const spec = UNIT_SPECS[k]
    const base = defending ? spec.defense : spec.attack
    const tech = 1 + (defending ? (c.mods?.unitDefense[k] ?? 0) : (c.mods?.unitAttack[k] ?? 0))
    power += c.units[k] * weights[k] * base * tech * terrainMultiplier(terrain, k, c.mods) * generalMultiplier(c.general, k, terrain, defending)
  }
  if (hasCombinedArms(c.units)) {
    const bonus = COMBAT.combinedArmsBonus + (c.mods?.combinedArms ?? 0)
    power *= 1 + (defending ? bonus * COMBAT.defenderCombinedArmsShare : bonus)
  }
  if (defending) power *= TERRAIN[terrain].defense
  return power * c.penalty
}

function applyLosses(units: UnitCounts, losses: UnitCounts, damage: number, coastal: boolean) {
  const eligible = UNIT_TYPES.filter((k) => units[k] > 0 && (coastal || k !== 'naval'))
  const total = eligible.reduce((s, k) => s + units[k], 0)
  if (total <= 0) return
  const dmg = Math.min(damage, total)
  for (const k of eligible) {
    const share = (units[k] / total) * dmg
    units[k] -= share
    losses[k] += share
  }
}

export function resolveBattle(input: BattleInput, rng: Rng): BattleOutcome {
  const { terrain, coastal } = input
  const att = { ...input.attacker, units: { ...input.attacker.units } }
  const def = { ...input.defender, units: { ...input.defender.units } }
  const attackerLosses = emptyUnits()
  const defenderLosses = emptyUnits()
  const startAtt = totalUnits(att.units)
  const startDef = totalUnits(def.units)
  const rounds: BattleRound[] = []

  for (const round of ROUNDS) {
    const ap = sidePower(att, round.weights, terrain, coastal, false)
    const dp = sidePower(def, round.weights, terrain, coastal, true)
    const toDef = ap * rng.range(0.85, 1.15) * COMBAT.damagePerPower
    const toAtt = dp * rng.range(0.85, 1.15) * COMBAT.damagePerPower
    applyLosses(def.units, defenderLosses, toDef, coastal)
    applyLosses(att.units, attackerLosses, toAtt, coastal)
    rounds.push({ name: round.name, attackerDamage: toDef, defenderDamage: toAtt })
    if (totalUnits(def.units) < 0.1 || totalUnits(att.units) < 0.1) break
  }

  const evenWeights = { infantry: 1, armor: 1, air: 1, naval: 1 }
  const attLeft = sidePower(att, evenWeights, terrain, coastal, false)
  const defLeft = sidePower(def, evenWeights, terrain, coastal, true)
  const attLossFrac = startAtt > 0 ? totalUnits(attackerLosses) / startAtt : 1
  const defLossFrac = startDef > 0 ? totalUnits(defenderLosses) / startDef : 1
  const attackerWins =
    totalUnits(att.units) >= 0.1 &&
    (totalUnits(def.units) < 0.1 || (attLeft >= defLeft * 1.1 && defLossFrac >= attLossFrac))

  const modifiers: string[] = [`Terrain: ${TERRAIN[terrain].name} (defense x${TERRAIN[terrain].defense})`]
  if (hasCombinedArms(input.attacker.units)) modifiers.push('Attacker combined arms bonus')
  if (hasCombinedArms(input.defender.units)) modifiers.push('Defender combined arms bonus')
  if (input.attacker.units.armor > 0 && TERRAIN[terrain].unit.armor < 1) modifiers.push(`Armor struggles in ${TERRAIN[terrain].name.toLowerCase()}`)
  for (const note of input.attacker.penaltyNotes) modifiers.push(`Attacker: ${note}`)
  for (const note of input.defender.penaltyNotes) modifiers.push(`Defender: ${note}`)

  return { attackerLosses, defenderLosses, rounds, winner: attackerWins ? 'attacker' : 'defender', modifiers }
}
