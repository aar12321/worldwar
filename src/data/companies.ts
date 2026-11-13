import type { SectorId } from '../engine/types'

export interface Company {
  id: string
  name: string
  sector: SectorId
  /** The country it is based in. Its fortunes follow that country. */
  home: string
}

const c = (id: string, name: string, sector: SectorId, home: string): Company => ({ id, name, sector, home })

/** The companies on the world exchange. All are made up, but each follows the real economy of its home country. */
export const COMPANIES: Company[] = [
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

export const COMPANY_BY_ID: Record<string, Company> = Object.fromEntries(COMPANIES.map((x) => [x.id, x]))

export const STOCKS = {
  startPrice: 100,
  /** Shares of each company that exist. */
  float: 1000,
  /** Most a nation may own of one company. */
  maxStake: 400,
  /** Share of a trade's value paid as a fee. */
  fee: 0.01,
  /** Dividend each month, as a share of the value held. */
  dividend: 0.004,
  /** Opinion gained by a nation whose companies you own, per share of them you hold, up to the cap. */
  opinionPerTenth: 4,
  opinionCap: 20,
  /** Chance each month of a market-wide crash or boom, before world tension adds. */
  crash: 0.006,
  boom: 0.01,
}
