/** The central bank, the currency, bonds and the wealth fund. */
export const BANKING = {
  /** The interest rate a nation starts with and the world settles around. */
  neutralRate: 4,
  /** Business grows this much faster for each point the rate is below neutral. */
  growthPerPoint: 0.02,
  /** Inflation a nation aims for. */
  targetInflation: 2,
  /** Inflation target: each share of a month's income printed adds this much, times the tier's credibility. */
  printInflation: 200,
  /** The rate pulls inflation down this much for each point above neutral. */
  rateInflation: 0.6,
  warInflation: 1.5,
  warInflationCap: 4,
  goodsShortageInflation: 3,
  foodShortageInflation: 2,
  directedCreditInflation: 0.8,
  /** Inflation moves this share of the way to its target each month, and stays in this range. */
  inflationRate: 0.3,
  inflationMin: -5,
  inflationMax: 60,
  /** Each point of inflation over 3% eats this share of real income. */
  realIncomeLoss: 0.005,
  inflationFree: 3,
  /** Stability lost for each point of inflation over 5%. */
  inflationStability: 0.4,
  inflationCalm: 5,
  /** Credit score lost for each point of inflation over 5%. */
  inflationCredit: 0.5,
  /** Currency: what moves it, how fast, and its range. */
  currencyRateGap: 0.03,
  currencyInflationGap: 0.015,
  currencyCredit: 0.002,
  currencyReserve: 0.15,
  currencyWar: 0.05,
  currencySanctions: 0.05,
  currencyRate: 0.2,
  currencyMin: 0.6,
  currencyMax: 1.6,
  /** A weak currency makes exports cheap: port income rises this much for each 0.1 below 1. */
  weakCurrencyTrade: 0.03,
  /** Bonds: most a nation holds at once, and how the policy rate scales the credit rate. */
  maxBonds: 8,
  /** The month's bond rate is the credit rate times (0.5 + rate/8): even at the neutral 4%. */
  rateScale: 8,
  /** Older saves: debt becomes one bond due this many months later. */
  migratedTerm: 24,
  /** War bonds: a patriotic rate, the stability each issue buys and its cap per war. */
  warBondRate: 0.0015,
  warBondTerm: 36,
  warBondStability: 2,
  warBondStabilityCap: 6,
  warBondMinStability: 40,
  /** Directed credit: growth for the chosen sector, and what bad loans cost while the country is unstable. */
  directedGrowth: 0.012,
  badLoanStability: 40,
  badLoanCost: 2,
  /** The wealth fund: the withdrawal fee, the most that can come out in a month, its return's floor and cap, and its weight in credit. */
  fundFee: 0.01,
  fundWithdrawShare: 0.25,
  fundReturnMin: -0.02,
  fundReturnMax: 0.025,
  fundCredit: 2,
  fundCreditCap: 15,
  fundSpoils: 0.4,
  /** The reserve currency: seigniorage, cheaper bonds and trusted printing. */
  seigniorageOwn: 0.08,
  seigniorageWorld: 0.002,
  reserveBondDiscount: 0.8,
  reserveCredibility: 0.5,
  /** Printing comes in these shares of a month's income. */
  printSteps: [0.05, 0.1, 0.25],
  /** Dividends on shares follow the world interest rate, plus this little premium a month, so borrowing to buy shares earns nothing. */
  dividendPremium: 0.0005,
}
