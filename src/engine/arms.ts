import { ARMS } from '../data/unitTypes'
import { addLog, atWar, canUseUnit, factoryCount, nationModifiers, newId, type AggregatedModifiers } from './helpers'
import type { ArmsContract, ArmsTerms, GameState, Nation, NationId } from './types'
import { UNIT_TYPES } from './types'

/** Each factory adds this much attack, up to the cap. */
export const FACTORY_ATTACK = 0.04
export const FACTORY_ATTACK_CAP = 0.2

export function factoryWeaponBonus(factories: number): number {
  if (!Number.isFinite(factories) || factories <= 0) return 0
  return Math.min(FACTORY_ATTACK_CAP, factories * FACTORY_ATTACK)
}

export function factoryWeaponNote(factories: number): string | null {
  const bonus = factoryWeaponBonus(factories)
  if (bonus <= 0) return null
  return `factory weapons (+${Math.round(bonus * 100)}%)`
}

/** Technology modifiers plus the attack bonus from factories. Weapon contracts are ignored. */
export function combatMods(n: Nation, turn: number, factories = 0): AggregatedModifiers {
  void turn
  const mods = nationModifiers(n)
  const bonus = factoryWeaponBonus(factories)
  if (bonus > 0) for (const k of UNIT_TYPES) mods.unitAttack[k] += bonus
  return mods
}

export function nationCombatMods(s: GameState, n: Nation): AggregatedModifiers {
  return combatMods(n, s.turn, factoryCount(s, n.id))
}

export function validateArmsTerms(s: GameState, from: NationId, to: NationId, terms: ArmsTerms): string | null {
  if (terms.seller !== from && terms.seller !== to) return 'The seller must be one of the two nations'
  if (atWar(s, from, to)) return 'Cannot trade arms with an enemy'
  if (!Number.isInteger(terms.tier) || terms.tier < 1 || terms.tier > ARMS.maxTier) return 'Invalid tier'
  if (!Number.isInteger(terms.months) || terms.months < ARMS.minMonths || terms.months > ARMS.maxMonths) return 'Invalid duration'
  if (!Number.isFinite(terms.payPerMonth) || terms.payPerMonth < 1 || terms.payPerMonth > ARMS.maxPay) return 'Invalid price'
  const buyerId = terms.seller === from ? to : from
  const seller = s.nations[terms.seller]
  const buyer = s.nations[buyerId]
  if (!seller?.alive || !buyer?.alive) return 'Invalid target'
  if (!canUseUnit(seller, terms.unit)) return `${seller.name} lacks the technology`
  if (factoryCount(s, terms.seller) < terms.tier) return `${seller.name} lacks the factories`
  if (!canUseUnit(buyer, terms.unit)) return `${buyer.name} cannot field that unit`
  return null
}

export function grantArmsContract(s: GameState, buyerId: NationId, terms: Omit<ArmsContract, 'id' | 'until'> & { months: number }) {
  const buyer = s.nations[buyerId]
  buyer.contracts = (buyer.contracts ?? []).filter((c) => c.unit !== terms.unit)
  buyer.contracts.push({
    id: newId(s, 'c'),
    unit: terms.unit,
    tier: terms.tier,
    supplier: terms.supplier,
    payPerMonth: terms.payPerMonth,
    until: s.turn + terms.months - 1,
  })
}

export function breakArmsBetween(s: GameState, a: NationId, b: NationId) {
  for (const [buyerId, sellerId] of [
    [a, b],
    [b, a],
  ] as const) {
    const buyer = s.nations[buyerId]
    if (!buyer?.contracts?.some((c) => c.supplier === sellerId)) continue
    buyer.contracts = buyer.contracts.filter((c) => c.supplier !== sellerId)
    addLog(s, 'diplomacy', `${buyer.name}'s weapons contracts with ${s.nations[sellerId]?.name ?? sellerId} are cancelled.`, [buyerId, sellerId])
  }
}

/** Drops foreign contracts that war, embargo, or a fallen supplier have already voided. */
export function pruneArmsContracts(s: GameState) {
  for (const n of Object.values(s.nations)) {
    if (!n.contracts) n.contracts = []
    n.contracts = n.contracts.filter((c) => {
      if (!c.supplier) return true
      const seller = s.nations[c.supplier]
      return !!seller?.alive && !atWar(s, n.id, c.supplier) && (n.embargoedUntil ?? 0) < s.turn && (seller.embargoedUntil ?? 0) < s.turn
    })
  }
}

/** Weapon contracts are no longer part of play. Drop any that an older save still carries. */
export function applyArmsContracts(s: GameState) {
  for (const n of Object.values(s.nations)) n.contracts = []
}
