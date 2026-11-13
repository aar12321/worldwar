import type { SectorId } from '../engine/types'

export interface SectorSpec {
  name: string
  blurb: string
  /** What each unit of size produces each month, in plain words. */
  yields: string
  /** Share of a nation's early business that is this sector. */
  startShare: number
  /** Money profit per unit of size. The business tax is taken from this. */
  profit: number
}

export const SECTORS: Record<SectorId, SectorSpec> = {
  farming: { name: 'Agriculture', blurb: 'Large farms and food processing.', yields: '+0.25 food', startShare: 0.4, profit: 0.6 },
  energy: { name: 'Energy', blurb: 'Oil, power and fuel.', yields: '+0.12 oil', startShare: 0.15, profit: 0.8 },
  manufacturing: { name: 'Manufacturing', blurb: 'Factories that make what people buy.', yields: '+0.2 goods, +0.15 steel', startShare: 0.35, profit: 1 },
  arms: { name: 'Arms industry', blurb: 'Weapons makers. Cheaper units, and steel.', yields: '+0.2 steel, 2% cheaper units', startShare: 0.1, profit: 1 },
  technology: { name: 'Technology', blurb: 'Start-ups and labs.', yields: '+0.15 research', startShare: 0.1, profit: 0.8 },
  finance: { name: 'Finance', blurb: 'Banks and investors. Better credit.', yields: '+0.5 money, better credit', startShare: 0.15, profit: 1.2 },
}

export const SECTOR_IDS = Object.keys(SECTORS) as SectorId[]

export const BUSINESS = {
  /** Largest a sector can get: this times the nation's workforce. */
  capPerWorkforce: 0.9,
  minCap: 4,
  /** Monthly growth of a healthy sector, before the climate. */
  growth: 0.02,
  /** Growth even from nothing, as a share of the cap, so a country can start new industries. */
  seed: 0.004,
  /** Money to add one unit of size, rising as a sector gets bigger. */
  fundBase: 10,
  fundPerSize: 0.8,
  minFunding: 20,
  /** Money a subsidy costs each month per unit of size, and what it does to growth. */
  subsidyCost: 0.25,
  subsidyGrowth: 0.6,
  /** Corporate tax above this slows business, below it speeds it. */
  neutralTax: 0.15,
  taxDrag: 3,
  /** Stability below which businesses shrink. */
  shrinkBelow: 35,
  /** Output per unit of size. */
  food: 0.25,
  oil: 0.12,
  goods: 0.2,
  steelManufacturing: 0.15,
  steelArms: 0.2,
  research: 0.15,
  finance: 0.5,
  /** Each unit of arms industry makes units this much cheaper, up to a limit. */
  armsDiscount: 0.02,
  armsDiscountCap: 0.3,
}

export const INVEST = {
  min: 40,
  /** Monthly dividend as a share of the money invested. */
  dividend: 0.008,
  /** A foreign investor's money adds this much of what a government grant would. */
  efficiency: 0.8,
  /** Largest total outside investment in a sector, as a multiple of its size. */
  maxPerSize: 25,
}

export const TREASURY = {
  /** Smallest bond or repayment. */
  min: 20,
  /** Months of income a nation with a top rating can borrow, and the monthly interest of each rating. */
  ratings: [
    { name: 'AAA', min: 85, limit: 1.4, rate: 0.003 },
    { name: 'AA', min: 72, limit: 1.1, rate: 0.0045 },
    { name: 'A', min: 60, limit: 0.85, rate: 0.006 },
    { name: 'BBB', min: 48, limit: 0.6, rate: 0.0085 },
    { name: 'BB', min: 36, limit: 0.4, rate: 0.011 },
    { name: 'B', min: 24, limit: 0.22, rate: 0.015 },
    { name: 'CCC', min: 12, limit: 0.08, rate: 0.02 },
    { name: 'D', min: -100, limit: 0, rate: 0.03 },
  ],
  /** Months in a row in the red, with debt outstanding, before a nation defaults. */
  defaultAfter: 3,
  /** Debt written off, stability lost and months locked out of credit after a default. */
  writeOff: 0.5,
  defaultStability: 15,
  lockout: 24,
}
