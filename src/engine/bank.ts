import { BANKING } from '../data/banking'
import { STOCKS } from '../data/companies'
import { TREASURY } from '../data/business'
import { tierOf } from './empire'
import { addLog, clamp, enemiesOf, newId, sanctionersOf } from './helpers'
import type { Bank, Bond, Directive, GameState, Nation, NationId, WorldStats } from './types'

export const startingBank = (rate = BANKING.neutralRate): Bank => ({ rate, inflation: BANKING.targetInflation, currency: 1, printed: 0, fund: 0, warBonds: 0, warBondStability: 0 })

export const startingWorldStats = (): WorldStats => ({ rate: BANKING.neutralRate, inflation: BANKING.targetInflation, living: 1, reserve: null, lastIndex: 100 })

/** The interest rate range a nation may set, or null when it must take the world's. */
export const rateRange = (n: Pick<Nation, 'tier'>) => tierOf(n).rate

/** The nation's policy rate: its own, within its tier's range, or the world's. */
export function policyRate(s: GameState, n: Nation): number {
  const range = rateRange(n)
  if (!range) return s.worldStats?.rate ?? BANKING.neutralRate
  return clamp(n.bank?.rate ?? BANKING.neutralRate, range[0], range[1])
}

/** Share of real income inflation eats: half a percent for each point over 3%. */
export const realIncomeFactor = (n: Pick<Nation, 'bank'>) => Math.max(0.5, 1 - BANKING.realIncomeLoss * Math.max(0, (n.bank?.inflation ?? 2) - BANKING.inflationFree))

/** Monthly rate on a new bond: the credit rating's rate, scaled by the policy rate, cheaper for the reserve currency. */
export function newBondRate(s: GameState, n: Nation, creditRate: number, war = false): number {
  if (war) return BANKING.warBondRate
  const scale = 0.5 + policyRate(s, n) / BANKING.rateScale
  return creditRate * scale * (s.worldStats?.reserve === n.id ? BANKING.reserveBondDiscount : 1)
}

export const debtOf = (n: Pick<Nation, 'bonds'>) => (n.bonds ?? []).reduce((sum, b) => sum + b.amount, 0)

/** Keeps `debt` equal to the bonds owed. */
export function syncDebt(n: Nation) {
  n.bonds = (n.bonds ?? []).filter((b) => b.amount > 0.01)
  n.debt = debtOf(n)
}

/** Monthly interest on everything owed. */
export const interestOf = (n: Pick<Nation, 'bonds'>) => (n.bonds ?? []).reduce((sum, b) => sum + b.amount * b.rate, 0)

export function issueBond(s: GameState, n: Nation, amount: number, term: number, rate: number, war = false) {
  ;(n.bonds ??= []).push({ id: newId(s, 'bd'), amount, rate, due: s.turn + term, term, ...(war ? { war: true } : {}) })
  n.resources.capital += amount
  if (war) {
    n.bank.warBonds += amount
    const gain = Math.min(BANKING.warBondStability, BANKING.warBondStabilityCap - n.bank.warBondStability)
    if (gain > 0) {
      n.stability = clamp(n.stability + gain, 0, 100)
      n.bank.warBondStability += gain
    }
  }
  syncDebt(n)
}

/** Pays back bonds, the dearest first. */
export function repayBonds(n: Nation, amount: number) {
  let left = amount
  for (const b of [...(n.bonds ?? [])].sort((x, y) => y.rate - x.rate || (x.id < y.id ? -1 : 1))) {
    if (left <= 0) break
    const pay = Math.min(b.amount, left)
    b.amount -= pay
    left -= pay
  }
  syncDebt(n)
}

/** A default writes off half of every bond. */
export function writeOffBonds(n: Nation, share: number) {
  for (const b of n.bonds ?? []) b.amount *= 1 - share
  syncDebt(n)
}

/** Why a nation cannot sell these bonds, or null. `room` is what lenders still offer. */
export function bondProblem(s: GameState, n: Nation, amount: number, term: number | undefined, war: boolean | undefined, room: number, locked: boolean, gross: number): string | null {
  if (!Number.isFinite(amount) || amount < TREASURY.min) return `Bonds start at ${TREASURY.min} money`
  if ((n.bonds ?? []).length >= BANKING.maxBonds) return `You already owe ${BANKING.maxBonds} bonds. Repay or let one come due first.`
  const spec = tierOf(n)
  if (war) {
    if (enemiesOf(s, n.id).length === 0) return 'War bonds are sold only in wartime'
    if (n.stability < BANKING.warBondMinStability) return `People will not buy war bonds with stability under ${BANKING.warBondMinStability}%`
    const cap = spec.warBondCap * Math.max(10, gross) - n.bank.warBonds
    if (amount > cap + 1e-6) return `People will lend at most ${Math.max(0, Math.floor(cap))} more in war bonds`
    return null
  }
  if (term !== undefined && !spec.bondTerms.includes(term)) return `A ${spec.name} can sell bonds for ${spec.bondTerms.join(' or ')} months`
  if (locked) return 'Nobody will lend to you after your default'
  if (amount > room + 1e-6) return `Lenders will give you at most ${Math.floor(room)} more`
  return null
}

/** Why a nation cannot print this much, or null. */
export function printProblem(n: Nation, share: number): string | null {
  const cap = tierOf(n).printCap
  if (!Number.isFinite(share) || share <= 0) return 'Choose how much to print'
  if (n.bank.printed + share > cap + 1e-9) return `A ${tierOf(n).name} can print at most ${Math.round(cap * 100)}% of a month's income each month`
  return null
}

/** Prints money worth a share of a month's income. It costs nothing now and inflation later. */
export function printMoney(n: Nation, share: number, gross: number) {
  n.resources.capital += share * Math.max(0, gross)
  n.bank.printed += share
}

export function fundProblem(n: Nation, amount: number): string | null {
  if (!tierOf(n).wealthFund) return 'Needs a Great power (10 countries)'
  if (!Number.isFinite(amount) || amount === 0) return 'Choose an amount'
  if (amount > 0 && n.resources.capital < amount) return `You have only ${Math.floor(n.resources.capital)} money`
  if (amount < 0 && -amount > n.bank.fund * BANKING.fundWithdrawShare + 1e-6) return `At most a quarter of the fund (${Math.floor(n.bank.fund * BANKING.fundWithdrawShare)}) can come out in a month`
  return null
}

/** Puts money into the wealth fund, or takes it out for a small fee. */
export function moveFund(n: Nation, amount: number) {
  if (amount > 0) {
    n.resources.capital -= amount
    n.bank.fund += amount
  } else {
    const out = Math.min(n.bank.fund, -amount)
    n.bank.fund -= out
    n.resources.capital += out * (1 - BANKING.fundFee)
  }
}

/** Seigniorage the reserve currency's holder earns from the world using its money. */
export function seigniorage(s: GameState, n: Nation, gross: number, worldGross: number): number {
  if (s.worldStats?.reserve !== n.id) return 0
  return Math.min(BANKING.seigniorageOwn * gross, BANKING.seigniorageWorld * Math.max(0, worldGross - gross))
}

/** The wealth fund's return this month: the world rate plus half the exchange's move, within limits. */
export function fundReturn(s: GameState): number {
  const idx = s.stocks?.index ?? 100
  const last = s.worldStats?.lastIndex ?? idx
  const move = last > 0 ? (idx - last) / last : 0
  return clamp((s.worldStats?.rate ?? BANKING.neutralRate) / 1200 + move * 0.5, BANKING.fundReturnMin, BANKING.fundReturnMax)
}

/** Credit-score points from the wealth fund and lost to inflation. */
export function bankCredit(n: Nation, gross: number): number {
  const fund = Math.min(BANKING.fundCreditCap, (n.bank.fund / Math.max(10, gross)) * BANKING.fundCredit)
  return fund - BANKING.inflationCredit * Math.max(0, n.bank.inflation - BANKING.inflationCalm)
}

/** Stability inflation costs. */
export const inflationStability = (n: Pick<Nation, 'bank'>) => BANKING.inflationStability * Math.max(0, (n.bank?.inflation ?? 2) - BANKING.inflationCalm)

/**
 * One month of a nation's money: inflation follows printing, the rate, wars and shortages; the currency follows the rate, inflation,
 * credit and war; inflation eats debt and savings; bonds come due and roll over or are repaid; the fund earns its return.
 */
export function runBank(s: GameState, n: Nation, gross: number, creditScore: number, creditRoom: number, creditRate: number, locked: boolean) {
  const b = n.bank
  const spec = tierOf(n)
  const rate = policyRate(s, n)
  b.rate = rate
  const credibility = spec.credibility * (s.worldStats?.reserve === n.id ? BANKING.reserveCredibility : 1)
  const wars = enemiesOf(s, n.id).length
  const target =
    BANKING.targetInflation +
    BANKING.printInflation * b.printed * credibility -
    BANKING.rateInflation * (rate - BANKING.neutralRate) +
    Math.min(BANKING.warInflationCap, wars * BANKING.warInflation) +
    (n.goodsShortage ? BANKING.goodsShortageInflation : 0) +
    (n.foodShortage ? BANKING.foodShortageInflation : 0) +
    (n.programs?.creditSector ? BANKING.directedCreditInflation : 0)
  b.inflation = clamp(b.inflation + (target - b.inflation) * BANKING.inflationRate, BANKING.inflationMin, BANKING.inflationMax)
  b.printed = 0
  const w = s.worldStats ?? startingWorldStats()
  const currencyTarget =
    1 +
    BANKING.currencyRateGap * (rate - w.rate) -
    BANKING.currencyInflationGap * (b.inflation - w.inflation) +
    BANKING.currencyCredit * (creditScore - 60) +
    (w.reserve === n.id ? BANKING.currencyReserve : 0) -
    BANKING.currencyWar * Math.min(2, wars) -
    BANKING.currencySanctions * Math.min(2, sanctionersOf(s, n.id).length)
  b.currency = clamp(b.currency + (currencyTarget - b.currency) * BANKING.currencyRate, BANKING.currencyMin, BANKING.currencyMax)
  // Inflation above 2% eats into what is owed, and into money in the treasury.
  const erosion = Math.max(0, b.inflation - BANKING.targetInflation) / 1200
  if (erosion > 0) {
    for (const bond of n.bonds ?? []) bond.amount *= 1 - erosion
    if (n.resources.capital > 0) n.resources.capital *= 1 - erosion
  }
  // Bonds that come due roll over while lenders allow, or must be repaid.
  let room = creditRoom
  for (const bond of [...(n.bonds ?? [])].sort((x, y) => x.due - y.due || (x.id < y.id ? -1 : 1))) {
    if (bond.due > s.turn) continue
    if (!bond.war && !locked && room >= bond.amount) {
      bond.due = s.turn + bond.term
      bond.rate = newBondRate(s, n, creditRate)
      room -= bond.amount
      continue
    }
    n.resources.capital -= bond.amount
    if (n.isPlayer) addLog(s, 'economy', `A bond of ${Math.round(bond.amount)} came due and lenders would not roll it over. It was paid from the treasury.`, [n.id])
    bond.amount = 0
  }
  syncDebt(n)
  if (b.fund > 0) b.fund = Math.max(0, b.fund * (1 + fundReturn(s)))
  if (wars === 0) {
    b.warBonds = 0
    b.warBondStability = 0
  }
  void gross
}

/** The world's money, worked out once a month from every nation: the average rate and inflation, the median living standard, the reserve currency. */
export function updateWorldStats(s: GameState, gross: Map<NationId, number>, living: number) {
  let wsum = 0
  let rate = 0
  let infl = 0
  let reserve: NationId | null = null
  let best = 0
  for (const [id, g] of [...gross].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const n = s.nations[id]
    if (!n?.alive || g <= 0) continue
    wsum += g
    rate += (rateRange(n) ? n.bank.rate : BANKING.neutralRate) * g
    infl += n.bank.inflation * g
    if (tierOf(n).reserve !== 'no' && g > best) {
      best = g
      reserve = id
    }
  }
  // The reserve currency belongs to the largest economy of all, and only if that economy is a superpower or more.
  let largest = 0
  for (const g of gross.values()) largest = Math.max(largest, g)
  if (reserve && best < largest - 1e-6) reserve = null
  s.worldStats = {
    rate: wsum > 0 ? rate / wsum : BANKING.neutralRate,
    inflation: wsum > 0 ? infl / wsum : BANKING.targetInflation,
    living: living > 0 ? living : (s.worldStats?.living ?? 1),
    reserve,
    lastIndex: s.stocks?.index ?? 100,
  }
}

/**
 * Monthly dividend on the value of a nation's shares. A share never pays more than the cheapest a nation could borrow at (a top
 * credit rating at its own policy rate), so borrowing with bonds to buy shares cannot earn a profit on the gap. The company's
 * instruction sets the most it may pay: nothing for "expand", a third as much for "specialize".
 */
export function dividendRate(s: GameState, n: Nation, directive: Directive): number {
  const ceiling = STOCKS.dividend[directive]
  if (ceiling <= 0) return 0
  const cheapest = newBondRate(s, n, TREASURY.ratings[0].rate)
  return Math.min(ceiling, cheapest * (ceiling / STOCKS.dividend.payout))
}

export type { Bond }
