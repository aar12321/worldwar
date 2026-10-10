import { addOpinion } from '../ai/opinion'
import { ARMS, UNIT_SPECS } from '../data/unitTypes'
import { addLog, atWar, canUseUnit, factoryCount, nationModifiers, newId, type AggregatedModifiers } from './helpers'
import type { ArmsContract, ArmsTerms, GameState, Nation, NationId, UnitType } from './types'
import { UNIT_TYPES } from './types'

export function weaponTiers(n: Nation | undefined, turn: number): Partial<Record<UnitType, number>> {
  const out: Partial<Record<UnitType, number>> = {}
  if (!n) return out
  for (const c of n.contracts ?? []) {
    if (c.until < turn) continue
    out[c.unit] = Math.max(out[c.unit] ?? 0, c.tier)
  }
  return out
}

/** Technology modifiers plus the attack bonus from live weapons contracts. */
export function combatMods(n: Nation, turn: number): AggregatedModifiers {
  const mods = nationModifiers(n)
  const bonus: Partial<Record<UnitType, number>> = {}
  for (const c of n.contracts ?? []) {
    if (c.until < turn) continue
    bonus[c.unit] = Math.max(bonus[c.unit] ?? 0, c.tier * ARMS.attackPerTier)
  }
  for (const k of UNIT_TYPES) if (bonus[k]) mods.unitAttack[k] += bonus[k]
  return mods
}

export function contractNote(n: Nation, turn: number): string | null {
  const tiers = weaponTiers(n, turn)
  const bits = UNIT_TYPES.filter((k) => tiers[k]).map((k) => `${UNIT_SPECS[k].name} +${Math.round((tiers[k] ?? 0) * ARMS.attackPerTier * 100)}%`)
  return bits.length ? `arms contract (${bits.join(', ')})` : null
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

/** Monthly payment for foreign contracts, then expiry. A buyer who cannot pay loses the contract. */
export function applyArmsContracts(s: GameState) {
  const nations = Object.values(s.nations).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const n of nations) {
    if (!n.alive) {
      n.contracts = []
      continue
    }
    const kept: ArmsContract[] = []
    for (const c of n.contracts ?? []) {
      if (c.supplier) {
        const seller = s.nations[c.supplier]
        if (!seller?.alive || atWar(s, n.id, c.supplier) || (n.embargoedUntil ?? 0) >= s.turn || (seller.embargoedUntil ?? 0) >= s.turn) continue
        if (n.resources.capital < c.payPerMonth) {
          addOpinion(s, c.supplier, n.id, 'Defaulted on an arms contract', -20, 0.4)
          addLog(s, 'diplomacy', `${n.name} could not pay ${seller.name} for ${UNIT_SPECS[c.unit].name} and the contract is cancelled.`, [n.id, c.supplier])
          continue
        }
        n.resources.capital -= c.payPerMonth
        seller.resources.capital += c.payPerMonth
      }
      if (s.turn >= c.until) {
        const who = c.supplier ? [n.id, c.supplier] : [n.id]
        if (n.isPlayer || (c.supplier && s.nations[c.supplier]?.isPlayer))
          addLog(s, 'economy', `${n.name}'s ${UNIT_SPECS[c.unit].name} contract has been fulfilled.`, who)
        continue
      }
      kept.push(c)
    }
    n.contracts = kept
  }
}
