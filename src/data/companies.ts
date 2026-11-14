import type { Directive, SectorId } from '../engine/types'
import type { PolicyEffects } from './government'

export interface CompanySeed {
  id: string
  name: string
  sector: SectorId
  /** The country it is based in. Its fortunes follow that country. */
  home: string
}

const c = (id: string, name: string, sector: SectorId, home: string): CompanySeed => ({ id, name, sector, home })

/** Names for the well-known countries, best first. A country lists the first of these with a sector of its own, up to two. All are made up. */
export const COMPANY_SEEDS: CompanySeed[] = [
  c('nimbus', 'Nimbus Cloud', 'technology', 'united-states-of-america'),
  c('helix', 'Helix AI', 'technology', 'united-states-of-america'),
  c('apex', 'Apex Semiconductor', 'technology', 'taiwan'),
  c('hanbit', 'Hanbit Electronics', 'technology', 'south-korea'),
  c('sakura', 'Sakura Robotics', 'technology', 'japan'),
  c('danube', 'Danube Software', 'technology', 'germany'),
  c('lotus', 'Lotus Systems', 'technology', 'india'),
  c('dragonsil', 'Dragon Silicon', 'technology', 'china'),
  c('fjordlabs', 'Fjord Labs', 'technology', 'sweden'),
  c('liberty', 'Liberty Capital', 'finance', 'united-states-of-america'),
  c('albion', 'Albion Bank', 'finance', 'united-kingdom'),
  c('helvetia', 'Helvetia Reserve', 'finance', 'switzerland'),
  c('delta', 'Delta Exchange', 'finance', 'netherlands'),
  c('gulfsov', 'Gulf Sovereign', 'finance', 'united-arab-emirates'),
  c('yangtze', 'Yangtze Trust', 'finance', 'china'),
  c('desertcrude', 'Desert Crude', 'energy', 'saudi-arabia'),
  c('taiga', 'Taiga Petroleum', 'energy', 'russia'),
  c('northgas', 'Northern Gas', 'energy', 'norway'),
  c('maple', 'Maple Energy', 'energy', 'canada'),
  c('amazonfuel', 'Amazon Fuels', 'energy', 'brazil'),
  c('persian', 'Persian Gulf Oil', 'energy', 'iran'),
  c('rhine', 'Rhine Machines', 'manufacturing', 'germany'),
  c('hanheavy', 'Han Heavy Industries', 'manufacturing', 'china'),
  c('osaka', 'Osaka Motors', 'manufacturing', 'japan'),
  c('midwest', 'Midwest Steel', 'manufacturing', 'united-states-of-america'),
  c('silesia', 'Silesia Works', 'manufacturing', 'poland'),
  c('bharat', 'Bharat Motors', 'manufacturing', 'india'),
  c('eagle', 'Eagle Defense', 'arms', 'united-states-of-america'),
  c('rusarms', 'Rus Armaments', 'arms', 'russia'),
  c('galilee', 'Galilee Systems', 'arms', 'israel'),
  c('loire', 'Loire Aerospace', 'arms', 'france'),
  c('albionshield', 'Albion Shield', 'arms', 'united-kingdom'),
  c('pampas', 'Pampas Agro', 'farming', 'argentina'),
  c('cerrado', 'Cerrado Foods', 'farming', 'brazil'),
  c('prairie', 'Prairie Grain', 'farming', 'united-states-of-america'),
  c('murray', 'Murray Farms', 'farming', 'australia'),
  c('blacksea', 'Black Sea Harvest', 'farming', 'ukraine'),
]

export const STOCKS = {
  /** Shares of each company that exist. A stake is shares out of this. */
  float: 1000,
  /** A company starts out worth this many months of its home country's income. */
  worth: 8,
  /** Price a company's share starts at is its worth over the float; it never leaves this range around that. */
  minFactor: 0.04,
  maxFactor: 20,
  /** Share of a trade's value paid as a fee. */
  fee: 0.01,
  /** Buying or selling the whole float at once would move the price by this much. Smaller trades move it less. */
  impact: 0.6,
  /** Dividend each month, as a share of the value held, by what the company has been told to do. */
  dividend: { payout: 0.014, expand: 0, focus: 0.004 } as Record<Directive, number>,
  /** Chance each month of a market-wide crash or boom, before world tension adds. */
  crash: 0.006,
  boom: 0.01,
}

/** What owning a share of a company gets you. Strength scales what its instructions can do. */
export const TIERS = [
  { at: 0.1, name: 'Investor', strength: 0, blurb: 'Dividends only.' },
  { at: 0.25, name: 'Board seat', strength: 0.5, blurb: 'You can instruct the company, at half strength.' },
  { at: 0.51, name: 'Control', strength: 1, blurb: 'You run the company. Its instructions work at full strength.' },
  { at: 0.75, name: 'Dominant', strength: 1.25, blurb: 'Nobody can stand against you. Instructions work at a quarter more.' },
]

export const DIRECTIVES: Record<Directive, { name: string; blurb: string }> = {
  payout: { name: 'Pay dividends', blurb: 'Pay profits out to its owners: the best dividends.' },
  expand: { name: 'Expand the business', blurb: 'Reinvest everything: its whole sector grows faster. No dividends while it does.' },
  focus: { name: 'Specialize', blurb: 'Put the company to work for the nation. What that means depends on its sector. Small dividends.' },
}

/** Extra monthly growth of the company's sector under "Expand the business", at full strength. */
export const EXPAND_GROWTH = 0.012

/** What "Specialize" does for each sector, at full strength. */
export const SPECIALTY: Record<SectorId, { name: string; blurb: string; effects: Partial<PolicyEffects>; armsDiscount?: number; systemDiscount?: number }> = {
  technology: { name: 'Research push', blurb: 'Faster research, quicker business growth, and cheaper Frontier systems.', effects: { research: 0.05, growth: 0.02 }, systemDiscount: 0.08 },
  finance: { name: 'Capital drive', blurb: 'More income, more room to trade, quicker business growth.', effects: { money: 0.012, trade: 0.06, growth: 0.02 } },
  energy: { name: 'Cheap power', blurb: 'Cheaper energy lifts output and factories.', effects: { output: 0.02, factory: 0.03 } },
  manufacturing: { name: 'Factory drive', blurb: 'Factories produce more.', effects: { factory: 0.05, output: 0.01 } },
  arms: { name: 'Defense contracts', blurb: 'Units cost less to train and the army costs less to keep.', effects: { upkeep: -0.03 }, armsDiscount: 0.06 },
  farming: { name: 'Harvest drive', blurb: 'People eat less of your stores and stay calmer.', effects: { foodUse: -0.04, stability: 0.5 } },
}

/** However many companies a nation owns, their instructions add up to no more than this. */
export const COMPANY_CAP = { effect: 0.3, arms: 0.2, systems: 0.25 }
