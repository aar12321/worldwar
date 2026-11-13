import type { RegionId } from '../engine/types'

/** Oil a country pumps each month at full strength. Countries not listed have none and must buy it. */
export const OIL_DEPOSITS: Record<RegionId, number> = {
  'saudi-arabia': 9,
  'united-states-of-america': 8,
  russia: 7,
  iran: 6,
  iraq: 6,
  venezuela: 5,
  canada: 5,
  'united-arab-emirates': 5,
  nigeria: 4,
  libya: 4,
  kuwait: 4,
  mexico: 4,
  china: 4,
  algeria: 3,
  kazakhstan: 3,
  norway: 3,
  angola: 3,
  qatar: 3,
  brazil: 3,
  azerbaijan: 2.5,
  oman: 2.5,
  indonesia: 2,
  colombia: 2,
  'united-kingdom': 2,
  romania: 1.5,
  egypt: 1.5,
  ecuador: 1.5,
  turkmenistan: 1.5,
  gabon: 1.5,
  congo: 1.5,
  malaysia: 1.5,
  brunei: 1.5,
  'eq-guinea': 1.5,
  sudan: 1,
  'trinidad-and-tobago': 1,
  argentina: 1,
  peru: 1,
  india: 1,
  yemen: 1,
  syria: 1,
}

/** Iron and coal: steel a country makes each month before its factories add any. */
export const STEEL_DEPOSITS: Record<RegionId, number> = {
  china: 9,
  'united-states-of-america': 8,
  russia: 6,
  japan: 6,
  india: 5,
  germany: 5,
  brazil: 4,
  ukraine: 4,
  australia: 4,
  'south-korea': 3,
  sweden: 3,
  canada: 3,
  'south-africa': 3,
  turkey: 2.5,
  'united-kingdom': 2.5,
  france: 2.5,
  italy: 2.5,
  poland: 2,
  mexico: 2,
  kazakhstan: 2,
  iran: 2,
  chile: 2,
  czechia: 1.5,
  spain: 1.5,
  belgium: 1.5,
  luxembourg: 1.5,
  austria: 1.5,
  finland: 1.5,
  norway: 1,
  venezuela: 1,
  peru: 1,
  'north-korea': 1.5,
  taiwan: 1.5,
  egypt: 1,
  romania: 1,
  slovakia: 1,
  serbia: 1,
}

/** The market: what each material is worth, who can trade how much, and what a shortage costs. */
export const MATERIALS = {
  /** Share the market keeps on every sale or purchase. */
  spread: 0.08,
  freeTradeSpread: 0.03,
  /** Units a nation can move through the market each month: a base plus its ports. */
  tradeBase: 12,
  tradePerPort: 8,
  /** Oil and steel each factory level makes. */
  steelPerFactory: 0.5,
  /** Goods: a little from the workforce, more from factories. */
  goodsPerWorkforce: 0.2,
  goodsPerFactory: 0.35,
  /** Goods people use each month, per unit of workforce. */
  goodsUsePerWorkforce: 0.3,
  /** Vehicles (everything but infantry) fight at this strength with no oil. */
  noOilStrength: 0.6,
  /** Stability lost while goods run out. */
  noGoodsStability: 12,
  /** Months of use an auto-buy keeps in stock. */
  autoBuyMonths: 2,
  /** The scarcity price curve is clamped to this range around each material's base price. */
  priceMin: 0.6,
  priceMax: 1.8,
}
