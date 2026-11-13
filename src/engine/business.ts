import { BUSINESS, INVEST, SECTOR_IDS, SECTORS, TREASURY } from '../data/business'
import type { PolicyEffects } from '../data/government'
import { addOpinion } from '../ai/opinion'
import { addLog, atWar, clamp, newId } from './helpers'
import type { GameState, Nation, NationId, SectorId } from './types'

/** Largest size any one sector can reach in a country with this workforce. */
export const sectorCap = (workforce: number) => Math.max(BUSINESS.minCap, workforce * BUSINESS.capPerWorkforce)

export interface SectorYield {
  food: number
  oil: number
  goods: number
  steel: number
  research: number
  /** Money straight from the sector, before any business tax. */
  money: number
  /** Profit the business tax is taken from. */
  profit: number
  /** Share unit purchases cost less, from the arms industry. */
  armsDiscount: number
}

/** What a nation's businesses produce each month at their current size. */
export function sectorYield(n: Pick<Nation, 'sectors'>): SectorYield {
  const z = n.sectors
  let profit = 0
  for (const id of SECTOR_IDS) profit += (z[id] ?? 0) * SECTORS[id].profit
  return {
    food: z.farming * BUSINESS.food,
    oil: z.energy * BUSINESS.oil,
    goods: z.manufacturing * BUSINESS.goods,
    steel: z.manufacturing * BUSINESS.steelManufacturing + z.arms * BUSINESS.steelArms,
    research: z.technology * BUSINESS.research,
    money: z.finance * BUSINESS.finance,
    profit,
    armsDiscount: Math.min(BUSINESS.armsDiscountCap, z.arms * BUSINESS.armsDiscount),
  }
}

/** How friendly a country is to business this month: taxes, calm, laws, schools and what it knows. */
export function growthClimate(n: Nation, pol: Pick<PolicyEffects, 'growth'>): number {
  const taxes = (n.corporateTax - BUSINESS.neutralTax) * BUSINESS.taxDrag
  const calm = (n.stability - 50) / 100
  const know = Math.min(0.3, n.techs.length * 0.01)
  return clamp(1 + pol.growth - taxes + calm + know, 0.2, 2.2)
}

/** War helps the arms makers and hurts the bankers. */
const WAR_MULT: Record<SectorId, number> = { farming: 0.9, energy: 1, manufacturing: 1.1, arms: 1.3, technology: 0.9, finance: 0.7 }

/** One month of growth for every sector. Pure on the nation; the caller supplies workforce and policy. */
export function growSectors(n: Nation, workforce: number, pol: Pick<PolicyEffects, 'growth'>, atWarNow: boolean) {
  const cap = sectorCap(workforce)
  const climate = growthClimate(n, pol)
  for (const id of SECTOR_IDS) {
    let size = n.sectors[id] ?? 0
    if (n.stability < BUSINESS.shrinkBelow) {
      size *= 0.99
    } else {
      const subsidy = n.subsidies.includes(id) ? 1 + BUSINESS.subsidyGrowth : 1
      const war = atWarNow ? WAR_MULT[id] : 1
      const rate = BUSINESS.growth * climate * subsidy * war
      size += rate * size * Math.max(0, 1 - size / cap) + (size < cap ? BUSINESS.seed * cap * climate * subsidy : 0)
    }
    n.sectors[id] = Math.min(cap * 1.5, Math.max(0, size))
  }
}

/** Money to add `size` units to a sector that is already `at` units. */
export const fundingCost = (at: number, units = 1) => units * (BUSINESS.fundBase + BUSINESS.fundPerSize * at)

/** Size a grant of `amount` money adds to a sector that is `at` units big. */
export const fundingGain = (at: number, amount: number) => amount / (BUSINESS.fundBase + BUSINESS.fundPerSize * at)

/** Monthly cost of the subsidies a nation pays. */
export function subsidyBill(n: Pick<Nation, 'sectors' | 'subsidies'>): number {
  return n.subsidies.reduce((sum, id) => sum + (n.sectors[id] ?? 0) * BUSINESS.subsidyCost, 0)
}

/** Dividends the investor earns each month from money it has put into other nations' businesses. */
export function dividendsFor(s: GameState, nationId: NationId): number {
  let total = 0
  for (const inv of s.investments ?? []) if (inv.investor === nationId && s.nations[inv.target]?.alive) total += inv.amount * INVEST.dividend
  return total
}

/** Money other nations have invested in this nation's businesses. */
export function investedIn(s: GameState, nationId: NationId, sector?: SectorId): number {
  return (s.investments ?? []).reduce((sum, inv) => (inv.target === nationId && (!sector || inv.sector === sector) ? sum + inv.amount : sum), 0)
}

/** Foreign investments are lost when the two nations go to war, or when either one is gone. */
export function cleanInvestments(s: GameState) {
  const kept = []
  for (const inv of s.investments ?? []) {
    const a = s.nations[inv.investor]
    const b = s.nations[inv.target]
    if (!a?.alive || !b?.alive) continue
    if (atWar(s, inv.investor, inv.target)) {
      if (a.isPlayer) addLog(s, 'economy', `Your ${Math.round(inv.amount)} invested in ${b.name}'s ${SECTORS[inv.sector].name.toLowerCase()} was seized when the war began.`, [inv.investor, inv.target])
      if (b.isPlayer) addLog(s, 'economy', `${a.name}'s investment in your ${SECTORS[inv.sector].name.toLowerCase()} was lost in the war.`, [inv.investor, inv.target])
      continue
    }
    kept.push(inv)
  }
  s.investments = kept
}

export interface CreditReport {
  score: number
  rating: string
  /** Monthly interest on bonds. */
  rate: number
  /** Money still available to borrow. */
  room: number
  locked: boolean
}

/** How lenders see a nation: its debt against its income, its calm, its wars and its banks. */
export function creditReport(s: GameState, n: Nation, grossIncome: number, atWarNow: boolean, bonus = 0): CreditReport {
  const locked = n.defaultedUntil > s.turn
  const ratio = n.debt / Math.max(10, grossIncome * 12)
  const score = 92 - ratio * 70 - Math.max(0, 50 - n.stability) * 0.7 - (atWarNow ? 8 : 0) + (n.sectors?.finance ?? 0) * 1.2 + bonus - (locked ? 45 : 0) - (n.inDebt ? 15 : 0)
  const tier = TREASURY.ratings.find((r) => score >= r.min) ?? TREASURY.ratings[TREASURY.ratings.length - 1]
  const limit = locked ? 0 : Math.max(0, grossIncome * 12 * tier.limit - n.debt)
  return { score, rating: tier.name, rate: tier.rate, room: limit, locked }
}

/** A nation that has been in the red for months with debt outstanding defaults. */
export function checkDefault(s: GameState, n: Nation) {
  if (n.inDebt && n.debt > 0) n.redMonths = (n.redMonths ?? 0) + 1
  else n.redMonths = 0
  if (n.redMonths < TREASURY.defaultAfter) return
  const lost = n.debt * TREASURY.writeOff
  n.debt -= lost
  n.redMonths = 0
  n.stability = Math.max(0, n.stability - TREASURY.defaultStability)
  n.defaultedUntil = s.turn + TREASURY.lockout
  for (const inv of s.investments ?? []) if (inv.target === n.id) inv.amount *= 0.5
  addLog(s, 'economy', `${n.name} defaulted on its bonds. Half the debt is written off, nobody will lend to it for ${TREASURY.lockout} months, and its people are furious.`, [n.id])
  for (const other of Object.values(s.nations)) if (other.alive && other.id !== n.id && other.isPlayer === false) addOpinion(s, other.id, n.id, 'Defaulted on its debts', -6, 0.3)
}

/** Adds money to a sector: used by a government grant or an outside investment. Returns the size gained. */
export function addToSector(n: Nation, sector: SectorId, amount: number, workforce: number, efficiency = 1): number {
  const at = n.sectors[sector] ?? 0
  const cap = sectorCap(workforce) * 1.5
  const gain = Math.min(cap - at, fundingGain(at, amount) * efficiency)
  n.sectors[sector] = at + Math.max(0, gain)
  return Math.max(0, gain)
}

export function makeInvestment(s: GameState, investor: NationId, target: NationId, sector: SectorId, amount: number) {
  const existing = (s.investments ??= []).find((i) => i.investor === investor && i.target === target && i.sector === sector)
  if (existing) existing.amount += amount
  else s.investments.push({ id: newId(s, 'i'), investor, target, sector, amount })
}
