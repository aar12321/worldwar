import type { LocalProjectId, Tier } from '../engine/types'

/**
 * Projects built in one country of an empire, not by the nation as a whole. A dam needs hills to dam, a resort a coast. A country can
 * hold each once, built up to three levels. They stay with the land, so a conquered country's industrial park is the conqueror's.
 */

/**
 * What one country's projects add up to. Money, food, research and the rest are flat amounts a month, for a country of middling size:
 * a bigger country gives more and costs more (see `localScale`). `factory` is a share of this country's factory output.
 */
export interface LocalYield {
  factory: number
  food: number
  steel: number
  research: number
  money: number
  /** Trade capacity on the market. */
  trade: number
  /** Added to this country's Defense Line. */
  line: number
  /** Share by which this country settles faster. */
  settle: number
  /** Share by which rebels are less likely to rise here. */
  order: number
  /** Added to the nation's stability. */
  stability: number
  /** Power for factories. */
  power: number
  /** Share added to this country's oil and steel deposits. */
  deposits: number
}

/** The yields that grow with the size of the country they are built in. The rest are shares or fixed amounts. */
export const SCALED_YIELDS: (keyof LocalYield)[] = ['food', 'steel', 'research', 'money', 'trade', 'line', 'power']

export const NO_LOCAL: LocalYield = { factory: 0, food: 0, steel: 0, research: 0, money: 0, trade: 0, line: 0, settle: 0, order: 0, stability: 0, power: 0, deposits: 0 }
export const LOCAL_FIELDS = Object.keys(NO_LOCAL) as (keyof LocalYield)[]

/** What a country must have before a project can be built in it. */
export type LocalNeed = 'university' | 'port' | 'coast' | 'deposit' | 'wild'

export const NEED_TEXT: Record<LocalNeed, string> = {
  university: 'a university',
  port: 'a port',
  coast: 'a coastline',
  deposit: 'oil or steel deposits',
  wild: 'mountains or forest',
}

export interface LocalSpec {
  name: string
  blurb: string
  /** One line: what it does at its first level. */
  effect: string
  tier: Tier
  months: number
  cost: number
  needs?: LocalNeed
  /** For one unit of worth. Level 1 is 1, then 1.6 and 2. */
  yields: Partial<LocalYield>
  /** Money a month for each point of the country's development: a resort in a rich country earns more. */
  perDevelopment?: number
}

export const LOCAL: Record<LocalProjectId, LocalSpec> = {
  industrialPark: { name: 'Industrial park', blurb: 'Serviced plots, a rail spur and cheap power for factories.', effect: 'This country\'s factories +15%, and steel.', tier: 1, months: 6, cost: 120, yields: { factory: 0.15, steel: 1 } },
  techHub: { name: 'Tech hub', blurb: 'A campus where the university\'s graduates start companies.', effect: 'Research +1.6 a month in a country of middling size.', tier: 1, months: 8, cost: 160, needs: 'university', yields: { research: 1.6 } },
  irrigation: { name: 'Irrigation', blurb: 'Canals and pumps that turn dry fields green.', effect: 'Food +4 a month in a country of middling size.', tier: 1, months: 6, cost: 90, yields: { food: 4 } },
  dam: { name: 'Hydroelectric dam', blurb: 'A great wall across a river valley.', effect: 'Power for factories +10, and money +3.5.', tier: 1, months: 10, cost: 200, needs: 'wild', yields: { power: 10, money: 3.5 } },
  resort: { name: 'Tourist resort', blurb: 'Beaches, hotels and a airport. Visitors spend more in a richer country.', effect: 'Money +1.5, and more the richer the country.', tier: 1, months: 8, cost: 150, needs: 'coast', yields: { money: 1.5 }, perDevelopment: 3.5 },
  culturalCentre: { name: 'Cultural centre', blurb: 'A theater, a museum and a school of the national language.', effect: 'Settles 50% faster, rebels 40% less likely here, calm +0.3.', tier: 1, months: 6, cost: 110, yields: { settle: 0.5, order: 0.4, stability: 0.3 } },
  fortress: { name: 'Border fortress', blurb: 'Walls, bunkers and a garrison town on the frontier.', effect: 'Defense Line +3, rebels 15% less likely here.', tier: 1, months: 6, cost: 100, yields: { line: 3, order: 0.15 } },
  sez: { name: 'Special economic zone', blurb: 'A free port where goods and money move without red tape.', effect: 'Trade capacity +3, and money +4.', tier: 2, months: 10, cost: 220, needs: 'port', yields: { trade: 3, money: 4 } },
  mine: { name: 'Mine expansion', blurb: 'New shafts, new rigs and a railway to the coast.', effect: 'Oil and steel deposits +50%.', tier: 1, months: 8, cost: 140, needs: 'deposit', yields: { deposits: 0.5 } },
}

export const LOCAL_IDS = Object.keys(LOCAL) as LocalProjectId[]
export const isLocalProject = (id: string): id is LocalProjectId => id in LOCAL

/** What a country project does at a level of worth and in a country of a size, one line each, for the screens. */
export function describeLocal(id: LocalProjectId, power: number, scale: number, development = 0.5): string[] {
  const spec = LOCAL[id]
  const y = spec.yields
  const flat = (v: number | undefined) => (v ?? 0) * power * scale
  const out: string[] = []
  const f = (v: number, digits = 1) => v.toFixed(digits)
  if (y.factory) out.push(`This country's factories +${Math.round(y.factory * power * 100)}%`)
  if (y.steel) out.push(`Steel +${f(flat(y.steel))} a month`)
  if (y.food) out.push(`Food +${f(flat(y.food))} a month`)
  if (y.research) out.push(`Research +${f(flat(y.research))} a month`)
  const money = flat(y.money) + (spec.perDevelopment ?? 0) * development * power * scale
  if (money) out.push(`Money +${f(money)} a month`)
  if (y.trade) out.push(`Trade capacity +${f(flat(y.trade))}`)
  if (y.power) out.push(`Power for factories +${f(flat(y.power))}`)
  if (y.line) out.push(`Defense Line +${f(flat(y.line))}`)
  if (y.settle) out.push(`Settles ${Math.round(y.settle * power * 100)}% faster`)
  if (y.order) out.push(`Rebels ${Math.round(y.order * power * 100)}% less likely here`)
  if (y.stability) out.push(`Stability +${f(y.stability * power)}`)
  if (y.deposits) out.push(`Oil and steel deposits +${Math.round(y.deposits * power * 100)}%`)
  return out
}
