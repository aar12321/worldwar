import { difficultyOf } from '../data/difficulty'
import { memoFrozen } from './frozen'
import { TERRAIN } from '../data/terrain'
import { BUILDING_SPECS, DIPLOMACY, UNIT_SPECS } from '../data/unitTypes'
import { MATERIALS, OIL_DEPOSITS, STEEL_DEPOSITS } from '../data/deposits'
import { EMPIRE, WAR } from '../data/war'
import { falloutFactor } from '../data/nuclear'
import { NO_EFFECTS, type PolicyEffects } from '../data/government'
import { TRAITS, traitOf } from '../data/traits'
import { agencyUpkeep } from './agencies'
import { aircraftBill, runAircraft } from './aircraft'
import { systemUpkeep } from './systems'
import { companyEffects } from './stocks'
import { addLog, clamp, enemiesOf, forceUnits, nationModifiers, pairKey, sanctionersOf } from './helpers'
import type { Rng } from './rng'
import { checkDefault, type CreditReport, creditReport, dividendsFor, growSectors, sectorYield, subsidyBill } from './business'
import { cityEffects, cityWorkforceBonus } from './cities'
import { policyEffects } from './policy'
import { marketPrices, pushMarket, type MarketPrices } from './trade'
import type { Buildings, BuildingType, GameState, MapRegion, NationId, RegionState, TradeResource, WorldMap } from './types'
import { BUILDING_TYPES, UNIT_TYPES } from './types'
import type { SectorId } from './types'
import { SECTOR_IDS, SECTORS } from '../data/business'
import { BANKING } from '../data/banking'
import { CITY_CREDIT_CAP, EMPIRE_RULES, OCCUPATION } from '../data/empire'
import { COVERAGE, EPIDEMIC, IMMIGRATION, PEOPLE } from '../data/people'
import { ACADEMY, ARMS_EXPORTS, ENTERPRISE, GENERAL_TRAITS } from '../data/projects'
import { bankCredit, inflationStability, interestOf, policyRate, realIncomeFactor, runBank, seigniorage } from './bank'
import { accordTrade } from './council'
import { lineBonus } from './deployment'
import { adminReport, combineTraits, occupationFloor, settleSpeed, type AdminReport } from './empire'
import { activeProjects, armsExportIncome, enterpriseIncome, industryCapMult, powerMult, programEffects, projectBill, projectPower, projectSpeed, runArmsExports, runProjects, scaleBonus, scaleFactor, worksEffects } from './industry'
import { activeLocal, localBill, localEffects, runLocalProjects } from './works'
import { deskStability, societyBill, societyEffects, runSociety, softCap, type SocietySource } from './society'
import { coverageMult, coverageOf, demandOf, peopleStability, populationGrowth, runPeople, spendingBill, type Demand, type PeopleBasis } from './people'
import { commanderTrait } from './generals'
import { spaceEffects } from './spaceEffects'
import { runSpace, spaceEngineerDemand } from './space'
import { programBill, programEngineerDemand } from './missileProgram'
import { civicsEffects, civicsMoney, missileEngineerDraw } from './civics'

export const ECON = {
  /** Tax per worker. Raised from 12 when spending became real money, so a nation's first month nets what it always did. */
  taxPerWorkforce: 13.8,
  factoryOutput: 6,
  portTrade: 3,
  jobsPerBuilding: 0.6,
  buildingUpkeep: 0.15,
  baseFoodPerWorkforce: 0.8,
  foodPerFarm: 3,
  /** Gardens feed a small country even when it cannot staff a farm. */
  subsistencePerRegion: 1,
  foodConsumptionPerWorkforce: 0.75,
  foodCapPerWorkforce: 20,
  tpPerUniversity: 2.5,
  militaryRegenPerWorkforce: 60,
  militaryCapPerWorkforce: 600,
  ppCap: 200,
  stabilityBase: 70,
  /** Months of negative Capital before unpaid soldiers start deserting. */
  desertionAfter: 2,
  desertionPerMonth: 0.05,
  maxDesertion: 0.2,
  embargoTradeMult: 0.4,
}

/** The whole nation's workforce, counting conquered land at the share that has settled. */
export function nationWorkforce(s: GameState, map: WorldMap, nationId: NationId): number {
  let total = 0
  for (const r of Object.values(s.regions)) if (r.owner === nationId) total += regionWorkforce(r, map.regions[r.id]) * integrationFactor(r)
  return total
}

export function regionWorkforce(region: RegionState, mapRegion: MapRegion): number {
  return Math.pow(Math.max(0.05, region.population), 0.6) * (0.3 + 0.7 * mapRegion.development) * (1 + cityWorkforceBonus(region))
}

/** Highest level of a building a country can reach. Bigger countries have room for more. */
export function buildingCap(workforce: number, building: BuildingType): number {
  const big = building === 'port' || building === 'civic' ? 15 : 6
  return BUILDING_SPECS[building].max + Math.floor(workforce / big)
}

/** Defense Line points a country starts with. Big, fortified countries and capitals hold out longer. */
export function lineMax(s: GameState, map: WorldMap, regionId: string): number {
  const r = s.regions[regionId]
  const owner = s.nations[r.owner]
  const capital = owner?.capital === regionId ? WAR.lineCapital : owner?.regionalCapitals?.includes(regionId) ? EMPIRE_RULES.regionalCapitalLine : 0
  return (TRAITS[traitOf(regionId, map.regions[regionId])].line ?? 0) + cityEffects(r).line + localEffects(r, map.regions[regionId]).line + WAR.lineBase + regionWorkforce(r, map.regions[regionId]) * WAR.linePerWorkforce + r.buildings.barracks * WAR.linePerBarracks + capital + lineBonus(s, map, regionId)
}

/** Share of a country's output that counts, rising as conquered land is integrated (and, after a nuclear strike, as the ruins heal). The occupation policy sets the floor. */
export const integrationFactor = (r: RegionState, floor: number = WAR.integrationFloor) => (floor + (1 - floor) * Math.min(1, Math.max(0, r.integration))) * falloutFactor(r.fallout)

export interface WarBill {
  enemy: NationId
  amount: number
}

/**
 * Game states the screen holds. They are never changed once the store has them, so their economy can be worked out once.
 * States the engine is resolving are copies that are changed as the month runs, so they are never marked and never cached.
 */
const settled = new WeakSet<GameState>()
const econCache = new WeakMap<GameState, Map<NationId, EconomyReport>>()

/** Marks a state as finished and unchanging: the store calls this for every game it shows. */
export function markSettled(s: GameState) {
  settled.add(s)
}

export interface MoneyLine {
  label: string
  amount: number
  /** Which part of the report it belongs to. */
  kind: 'income' | 'cost'
}

/** One cause of stability, with its effect in points. */
export interface StabilityPart {
  label: string
  value: number
}

export interface EconomyReport {
  workforce: number
  civilianWorkforce: number
  laborRatio: number
  buildings: Buildings
  regionCount: number
  taxIncome: number
  factoryIncome: number
  tradeIncome: number
  upkeep: number
  netCapital: number
  /** Taxes, factories, trade and business tax: what the economy earns before costs. */
  gross: number
  /** Every money line of the month, income and costs, adding up to `netCapital`. */
  lines: MoneyLine[]
  /** How lenders see this nation. */
  credit: CreditReport
  /** What private businesses produce each month. */
  business: ReturnType<typeof sectorYield>
  /** Tax on business profit. */
  corporateIncome: number
  /** Dividends from investments abroad. */
  dividends: number
  /** Interest on bonds. */
  interest: number
  /** Cost of the subsidies the state pays. */
  subsidies: number
  /** Income gained or spent each month on laws, such as austerity or research grants. */
  policyMoney: number
  warBills: WarBill[]
  warBillTotal: number
  /** Conquered countries not yet fully integrated. */
  occupied: number
  foodProduction: number
  foodConsumption: number
  netFood: number
  oilProduction: number
  oilUse: number
  netOil: number
  steelProduction: number
  goodsProduction: number
  goodsUse: number
  netGoods: number
  /** Units this nation can move through the world market each month. */
  tradeCapacity: number
  ppGain: number
  tpGain: number
  militaryRegen: number
  militaryCap: number
  civilianManpower: number
  stabilityTarget: number
  /** Why stability is heading where it is: each cause and how many points it adds (or takes). They sum to the target before it is held to 0-100. */
  stabilityParts: StabilityPart[]
  /** Programs for the people: what they cost a month, what they add, and where it comes from. */
  society: { bill: number; byPolicy: Record<string, number>; stability: number; rawStability: number; sources: SocietySource[] }
  divisions: number
  population: number
  /** The people model's view of the nation: its land, what its work needs, how well it is staffed. */
  basis: PeopleBasis
  demand: Demand
  coverage: ReturnType<typeof coverageOf>
  /** Output multipliers from staffing: factories by engineers, universities by scientists. */
  factoryStaff: number
  researchStaff: number
  admin: AdminReport
  /** What spending on the people and public works costs this month. */
  spending: ReturnType<typeof spendingBill>
  projects: { building: number; upkeep: number }
  /** The space program: its bill this month, and what its mines earn. */
  space: { bill: ReturnType<typeof spaceEffects>['bill']; income: number }
  /** Money this month's work on aircraft developments costs. */
  aircraftBill: number
  enterpriseIncome: number
  armsExports: number
  seigniorage: number
  /** Share of income inflation eats this month. */
  realIncome: number
}

export function computeEconomy(s: GameState, map: WorldMap, nationId: NationId): EconomyReport {
  // A state the rivals are planning on is frozen: each nation's report is worked out once for the whole plan.
  if (!settled.has(s)) return memoFrozen(s, 'economy', nationId, () => economyOf(s, map, nationId))
  let byNation = econCache.get(s)
  if (!byNation) econCache.set(s, (byNation = new Map()))
  let report = byNation.get(nationId)
  if (!report) byNation.set(nationId, (report = economyOf(s, map, nationId)))
  return report
}

function economyOf(s: GameState, map: WorldMap, nationId: NationId): EconomyReport {
  const n = s.nations[nationId]
  const mods = nationModifiers(n)
  const owned = Object.values(s.regions).filter((r) => r.owner === nationId)
  const buildings: Buildings = { factory: 0, farm: 0, university: 0, barracks: 0, port: 0, civic: 0, hospital: 0 }
  const floor = occupationFloor(n)
  let workforce = 0
  let baseFood = 0
  let factoryWork = 0
  let activeFactories = 0
  let workingFarms = 0
  let workingUniversities = 0
  let population = 0
  let rebelRegions = 0
  let occupied = 0
  let oilProduction = 0
  let steelProduction = 0
  let goodsProduction = 0
  let portLevels = 0
  let cityFood = 0
  let cityMoney = 0
  let cityResearch = 0
  let cityTrade = 0
  let cityCredit = 0
  let localPower = 0
  let localStability = 0
  let devWeight = 0
  const traitParts: Partial<PolicyEffects>[] = []
  for (const r of owned) {
    const mr = map.regions[r.id]
    const eff = integrationFactor(r, floor)
    const w = regionWorkforce(r, mr) * eff
    workforce += w
    devWeight += mr.development * w
    population += r.population
    baseFood += w * (1 - n.draftRate) * ECON.baseFoodPerWorkforce * TERRAIN[mr.terrain].food
    for (const b of BUILDING_TYPES) buildings[b] += r.buildings[b] ?? 0
    workingFarms += r.buildings.farm * eff
    workingUniversities += r.buildings.university * eff
    const ce = cityEffects(r)
    // Projects built in this country: an industrial park, a dam, a resort and the rest.
    const le = localEffects(r, mr)
    // A city's factory bonus works on its own country's factories, not the whole empire's.
    if (r.sabotaged <= 0) {
      activeFactories += r.buildings.factory * eff
      factoryWork += r.buildings.factory * eff * (1 + ce.factory + le.factory)
    }
    if (r.rebels > 0) rebelRegions++
    if (r.integration < 1) occupied++
    oilProduction += (OIL_DEPOSITS[r.id] ?? 0) * eff * (1 + le.deposits)
    steelProduction += ((STEEL_DEPOSITS[r.id] ?? 0) * (1 + le.deposits) + r.buildings.factory * MATERIALS.steelPerFactory) * eff
    goodsProduction += (w * MATERIALS.goodsPerWorkforce + r.buildings.factory * MATERIALS.goodsPerFactory) * eff
    portLevels += r.buildings.port * eff
    cityFood += (ce.food + le.food) * eff
    cityMoney += (ce.money + le.money) * eff
    cityResearch += (ce.research + le.research) * eff
    steelProduction += (ce.steel + le.steel) * eff
    cityTrade += (ce.tradeCapacity + le.trade) * eff
    localPower += le.power * eff
    localStability += le.stability * eff
    cityCredit += ce.credit * eff
    // What makes this country special helps the whole nation, more as it settles in, and less for each country beyond the strongest.
    const trait = TRAITS[traitOf(r.id, mr)]
    const part: Partial<PolicyEffects> = {}
    for (const [k, v] of Object.entries(trait.effects)) part[k as keyof PolicyEffects] = v * eff
    traitParts.push(part)
  }
  const traitEff = combineTraits(traitParts, n.tier ?? 1)
  const sy = sectorYield(n)
  oilProduction += sy.oil
  steelProduction += sy.steel
  goodsProduction += sy.goods
  const civilianWorkforce = workforce * (1 - n.draftRate)
  const jobs = (buildings.factory + buildings.farm + buildings.university) * ECON.jobsPerBuilding * (1 - mods.jobsReduction)
  const laborRatio = jobs > 0 ? Math.min(1, civilianWorkforce / jobs) : 1
  const stabilityFactor = 0.6 + (0.4 * n.stability) / 100
  const pol = policyEffects(n)
  for (const k of Object.keys(traitEff) as (keyof PolicyEffects)[]) pol[k] += traitEff[k] ?? 0
  // Companies the nation controls and has put to work.
  const firms = companyEffects(s, nationId)
  for (const k of Object.keys(NO_EFFECTS) as (keyof PolicyEffects)[]) if (k !== 'research') pol[k] += firms[k]
  // The space program: satellites, discoveries and prestige at home, and what its outposts and mines bring in.
  const space = spaceEffects(n)
  for (const k of Object.keys(space.policy) as (keyof PolicyEffects)[]) pol[k] += space.policy[k] ?? 0
  oilProduction += space.oil
  steelProduction += space.steel
  localPower += space.power

  // The people: who is needed, who there is, and how well the work is staffed.
  const basis: PeopleBasis = {
    workforce,
    factories: buildings.factory,
    universities: buildings.university,
    hospitals: buildings.hospital,
    buildings: BUILDING_TYPES.reduce((sum, b) => sum + buildings[b], 0),
    development: workforce > 0 ? devWeight / workforce : 0.3,
    occupiedShare: owned.length ? occupied / owned.length : 0,
    systemLevels: Object.values(n.systems ?? {}).reduce((a, b) => a + (b ?? 0), 0),
    // A project in a country is smaller than a national one, so it draws half as hard on the engineers.
    activeProjects: activeProjects(n).length + 0.5 * activeLocal(s, nationId).length,
    // The missile program's staff are counted once: the program's own staff when it has one, else the desk's charter estimate.
    extraEngineers: spaceEngineerDemand(n, workforce) + (n.mprog ? programEngineerDemand(n, workforce) : missileEngineerDraw(n)),
  }
  const demand = demandOf(n, basis)
  const coverage = coverageOf(n, demand)
  const factoryStaff = coverageMult(coverage.engineers, COVERAGE.factory)
  const researchStaff = coverageMult(coverage.scientists, COVERAGE.research)
  const admin = adminReport(s, map, nationId, n.people?.skills.skilled ?? 0.3)
  const works = worksEffects(n)
  const prog = programEffects(n)
  const spec = n.people?.specialization ?? 0
  const focus = n.programs?.focus ?? 'balanced'
  if (focus === 'business') pol.growth += 0.1 * spec
  if (n.seizedUntil > s.turn) pol.growth -= ENTERPRISE.seizeClimate
  pol.growth += BANKING.growthPerPoint * (BANKING.neutralRate - policyRate(s, n))
  const epidemic = n.people?.epidemic ?? 0
  const sickness = 1 - EPIDEMIC.output * epidemic - (n.programs?.quarantine ? EPIDEMIC.quarantineOutput : 0)
  const realIncome = realIncomeFactor(n)
  // What each finished project is worth: 0 if not built, 1 at its first level, more at the next two.
  const rail = projectPower(n, 'rail')
  const gridPower = projectPower(n, 'grid')
  const portsPower = projectPower(n, 'ports')

  const outputMult = stabilityFactor * (1 + mods.allOutput + pol.output + prog.output + scaleBonus(0.03, gridPower) - admin.output) * sickness * realIncome
  const atWarCount = enemiesOf(s, nationId).length
  const botBonus = n.isPlayer ? 0 : difficultyOf(s.settings.difficulty).botIncomeBonus
  const embargoed = (n.embargoedUntil ?? 0) >= s.turn
  // Only people with jobs pay tax. The base rate assumes the usual 5% out of work.
  const employed = (1 - (n.people?.unemployment ?? PEOPLE.jobsBase)) / (1 - PEOPLE.jobsBase)

  const taxIncome = n.taxRate * civilianWorkforce * ECON.taxPerWorkforce * employed * outputMult * (1 + botBonus) * scaleFactor(1.03, projectPower(n, 'digitalGov'))
  const factoryBonus = 1 + mods.factoryOutput + pol.factory + works.factory + scaleBonus(0.06, rail) + (focus === 'trades' ? 0.05 * spec : 0)
  const factoryIncome = factoryWork * ECON.factoryOutput * laborRatio * factoryBonus * outputMult * factoryStaff * powerMult(n, activeFactories, oilProduction, localPower) * (1 + botBonus)
  const sanctionMult = Math.max(DIPLOMACY.sanctions.minFloor, 1 - DIPLOMACY.sanctions.tradeCut * sanctionersOf(s, nationId).length)
  const currency = n.bank?.currency ?? 1
  const tradeIncome =
    buildings.port * ECON.portTrade * outputMult * (atWarCount > 0 ? 0.7 : 1) * (embargoed ? ECON.embargoTradeMult : 1) * sanctionMult * (1 + Math.max(0, 1 - currency) * 10 * BANKING.weakCurrencyTrade) * scaleFactor(1.25, portsPower)
  const biz = sy
  // State sectors pay the state their profit directly; only private ones pay business tax.
  const stateProfit = (n.stateOwned ?? []).reduce((sum, id) => sum + (n.sectors[id] ?? 0) * SECTORS[id].profit, 0)
  const corporateIncome = (n.corporateTax ?? 0) * Math.max(0, biz.profit - stateProfit) * outputMult + biz.money
  const enterprise = enterpriseIncome(n) * outputMult
  const dividends = dividendsFor(s, nationId)
  const subsidies = subsidyBill(n)
  const gross = taxIncome + factoryIncome + tradeIncome + corporateIncome
  const credit = creditReport(s, n, gross, atWarCount > 0, Math.min(CITY_CREDIT_CAP, cityCredit) + bankCredit(n, gross))
  // Bonds carry the rate they were sold at. A state with debt but no bond list (an old test or tool) pays the going rate.
  const interest = n.bonds?.length ? interestOf(n) : n.debt * credit.rate
  const policyMoney = pol.money * gross
  const land = { capital: cityMoney, food: cityFood, pp: buildings.civic * 0.6 + owned.length * EMPIRE.influencePerRegion, tp: buildings.civic * 0.3 + cityResearch + space.research }
  const arms = armsExportIncome(s, n, gross)
  const seign = seigniorage(s, n, gross, s.worldGross ?? 0)

  let unitUpkeep = 0
  let armyFood = 0
  let divisions = 0
  let oilUse = 0
  // Armies in the field still cost money, food and oil.
  const force = forceUnits(s, nationId)
  for (const k of UNIT_TYPES) {
    unitUpkeep += force[k] * UNIT_SPECS[k].upkeep * (k === 'naval' ? scaleFactor(0.85, portsPower) : 1)
    armyFood += force[k] * UNIT_SPECS[k].food
    oilUse += force[k] * UNIT_SPECS[k].oil
    divisions += force[k]
  }
  const goodsUse = workforce * MATERIALS.goodsUsePerWorkforce * (1 + pol.goodsUse)
  const warBills: WarBill[] = []
  for (const enemy of enemiesOf(s, nationId)) {
    let enemyWorkforce = 0
    for (const r of Object.values(s.regions)) if (r.owner === enemy) enemyWorkforce += regionWorkforce(r, map.regions[r.id])
    warBills.push({ enemy, amount: WAR.billBase + WAR.billPerUnit * divisions + WAR.billPerEnemyWorkforce * enemyWorkforce })
  }
  warBills.sort((a, b) => (a.enemy < b.enemy ? -1 : 1))
  const warBillTotal = warBills.reduce((sum, b) => sum + b.amount, 0)
  const buildingUpkeep = basis.buildings * ECON.buildingUpkeep
  const spending = spendingBill(n, workforce, buildingUpkeep)
  const trait = commanderTrait(n)
  const upkeepMult = Math.max(0.3, 1 + pol.upkeep + (trait === 'logistician' ? GENERAL_TRAITS.logistician.upkeep : 0))
  // Units, public works (the buildings' upkeep, scaled by its level), agencies, Frontier systems and the academy, all eased by policy.
  const systems = systemUpkeep(n) * scaleFactor(0.75, gridPower)
  const upkeep = (unitUpkeep + spending.works + agencyUpkeep(n) + systems + (n.academy ?? 0) * ACADEMY.upkeep) * upkeepMult
  const projects = projectBill(n)
  const aircraft = aircraftBill(n, projectSpeed(n, coverage.engineers))
  const localCosts = localBill(s, nationId)
  projects.building += localCosts.building
  projects.upkeep += localCosts.upkeep
  const governors = admin.governors * EMPIRE_RULES.governorSalary
  const settle = OCCUPATION[n.programs?.occupation ?? 'standard'].cost * occupied
  const quarantine = n.programs?.quarantine ? EPIDEMIC.quarantineCost * workforce : 0
  const civics = civicsMoney(n, population, workforce, gross)
  const badLoans = n.programs?.creditSector && n.stability < BANKING.badLoanStability ? BANKING.badLoanCost * Math.max(1, n.sectors[n.programs.creditSector] ?? 0) * 0.5 : 0

  const foodProduction =
    (sy.food + baseFood + owned.length * ECON.subsistencePerRegion + workingFarms * ECON.foodPerFarm * laborRatio * (1 + mods.foodOutput) + land.food) * scaleFactor(1.05, rail)
  const foodConsumption = workforce * ECON.foodConsumptionPerWorkforce * (1 + pol.foodUse) + armyFood

  const ppGain = 1.5 + n.stability / 50 + mods.ppPerTurn + pol.influence + land.pp - n.laws.length * EMPIRE_RULES.lawUpkeep
  // Technology companies lift all of the nation's research, not only what its universities make.
  const tpGain =
    (1 + firms.research) *
    scaleFactor(1.12, projectPower(n, 'sciencePark')) *
    scaleFactor(1.05, projectPower(n, 'spaceComplex')) *
    (0.5 + workforce * 0.04 + sy.research * outputMult + workingUniversities * ECON.tpPerUniversity * laborRatio * (1 + mods.researchOutput + pol.research) * outputMult * researchStaff + land.tp)

  const highTax = Math.max(0, n.taxRate - 0.2) * 150 * Math.max(0.2, 1 + pol.taxSensitivity)
  const lowTax = Math.max(0, 0.2 - n.taxRate) * 50
  const soc = societyEffects(n)
  const societyCost = societyBill(n, workforce)
  // Every cause on its own line, so the screen can say why stability is where it is. Added in this order, which is the order the sum has always had.
  const stabilityParts: StabilityPart[] = [
    { label: 'A settled country', value: ECON.stabilityBase },
    { label: 'High taxes', value: -highTax },
    { label: 'Low taxes', value: lowTax },
    { label: 'Hunger', value: -(n.foodShortage ? 25 * (1 - soc.social.famine) : 0) },
    { label: 'Empty shops', value: -(n.goodsShortage ? MATERIALS.noGoodsStability * (1 - soc.social.famine) : 0) },
    { label: 'Debt', value: -(n.inDebt ? 15 : 0) },
    { label: 'War weariness', value: -(n.warWeariness * 0.5 * Math.max(0.2, 1 + pol.weariness)) },
    { label: 'Government and laws', value: pol.stability },
    { label: 'Technology', value: mods.stability },
    { label: 'Rebels', value: -(rebelRegions * 3) },
    // Officials can run only so much: an empire past its administration capacity grows restless.
    { label: 'Stretched officials', value: -admin.stability },
    { label: 'Health, jobs and welfare', value: n.people ? peopleStability(n) : 0 },
    { label: 'Rising prices', value: -inflationStability(n) },
    { label: 'Epidemic', value: -(EPIDEMIC.stability * epidemic) },
    { label: 'Conquered land', value: -(OCCUPATION[n.programs?.occupation ?? 'standard'].stability * occupied) },
    { label: 'Immigration', value: IMMIGRATION[n.programs?.immigration ?? 'normal'].stability },
    { label: 'Programs for the people', value: soc.stability },
    // Projects in your countries (cultural centres) share the one ceiling on care with the programs, so a centre in every country cannot buy perfect calm.
    { label: 'Projects in your countries', value: softCap(soc.rawStability + localStability) - soc.stability },
    // The government desk (ministers, civil service, reforms, interest groups): a line only for a nation that has one. What it adds
    // shares the same ceiling, on top of the programs and projects (`deskStability`).
    ...(n.civics ? [{ label: 'Cabinet and reforms', value: deskStability(civicsEffects(n).stability, soc.rawStability + localStability) }] : []),
  ]
  const stabilityTarget = clamp(
    stabilityParts.reduce((sum, p) => sum + p.value, 0),
    0,
    100,
  )

  const lines: MoneyLine[] = [
    { label: 'Taxes', amount: taxIncome, kind: 'income' },
    { label: 'Factories', amount: factoryIncome, kind: 'income' },
    { label: 'Trade', amount: tradeIncome, kind: 'income' },
    { label: 'Business tax and banks', amount: corporateIncome, kind: 'income' },
    { label: 'State enterprises', amount: enterprise, kind: 'income' },
    { label: 'Cities', amount: land.capital, kind: 'income' },
    { label: 'Dividends from investments', amount: dividends, kind: 'income' },
    { label: 'Arms exports', amount: arms, kind: 'income' },
    { label: 'Reserve currency', amount: seign, kind: 'income' },
    { label: 'Laws', amount: policyMoney, kind: policyMoney >= 0 ? 'income' : 'cost' },
    { label: 'Military and upkeep', amount: -(upkeep - spending.works * upkeepMult), kind: 'cost' },
    { label: 'Public works', amount: -spending.works * upkeepMult, kind: 'cost' },
    { label: 'Schools', amount: -spending.schools, kind: 'cost' },
    { label: 'Health care', amount: -spending.health, kind: 'cost' },
    { label: 'Pensions', amount: -spending.pensions, kind: 'cost' },
    { label: 'Jobless support', amount: -spending.jobless, kind: 'cost' },
    { label: 'Housing', amount: -spending.housing, kind: 'cost' },
    { label: 'Programs for the people', amount: -societyCost.total, kind: 'cost' },
    { label: 'National projects', amount: -(projects.building + projects.upkeep), kind: 'cost' },
    { label: 'Space program', amount: -space.bill.total, kind: 'cost' },
    { label: 'Space mining', amount: space.money, kind: 'income' },
    { label: 'Aircraft development', amount: -aircraft, kind: 'cost' },
    { label: 'Missile program', amount: -programBill(n).total, kind: 'cost' },
    { label: 'Governors', amount: -governors, kind: 'cost' },
    { label: 'Settlers', amount: -settle, kind: 'cost' },
    { label: 'Quarantine', amount: -quarantine, kind: 'cost' },
    { label: 'Bad loans', amount: -badLoans, kind: 'cost' },
    { label: 'Cabinet salaries', amount: -civics.salaries, kind: 'cost' },
    { label: 'Civil service', amount: -civics.service, kind: civics.service > 0 ? 'cost' : 'income' },
    { label: 'Government (collection, waste, reforms)', amount: civics.treasury, kind: civics.treasury >= 0 ? 'income' : 'cost' },
    { label: 'War bills', amount: -warBillTotal, kind: 'cost' },
    { label: 'Interest on bonds', amount: -interest, kind: 'cost' },
    { label: 'Subsidies', amount: -subsidies, kind: 'cost' },
  ].filter((l) => Math.abs(l.amount) > 1e-9) as MoneyLine[]
  const netCapital = lines.reduce((sum, l) => sum + l.amount, 0)

  return {
    workforce,
    civilianWorkforce,
    laborRatio,
    buildings,
    regionCount: owned.length,
    taxIncome,
    factoryIncome,
    tradeIncome,
    upkeep,
    netCapital,
    gross,
    lines,
    business: biz,
    credit,
    corporateIncome,
    dividends,
    interest,
    subsidies,
    policyMoney,
    warBills,
    warBillTotal,
    occupied,
    foodProduction,
    foodConsumption,
    netFood: foodProduction - foodConsumption,
    oilProduction,
    oilUse,
    netOil: oilProduction - oilUse,
    steelProduction,
    goodsProduction,
    goodsUse,
    netGoods: goodsProduction - goodsUse,
    tradeCapacity: (MATERIALS.tradeBase + portLevels * MATERIALS.tradePerPort + cityTrade) * Math.max(0.3, 1 + pol.trade + works.trade + accordTrade(s, nationId) + scaleBonus(0.1, rail)) * scaleFactor(1.3, portsPower) * sanctionMult,
    ppGain,
    tpGain,
    militaryRegen: workforce * n.draftRate * ECON.militaryRegenPerWorkforce * (1 - EPIDEMIC.recruits * epidemic),
    militaryCap: workforce * n.draftRate * ECON.militaryCapPerWorkforce,
    civilianManpower: population * (1 - n.draftRate),
    stabilityTarget,
    stabilityParts,
    society: { bill: societyCost.total, byPolicy: societyCost.byPolicy as Record<string, number>, stability: soc.stability, rawStability: soc.rawStability, sources: soc.sources },
    divisions,
    population,
    basis,
    demand,
    coverage,
    factoryStaff,
    researchStaff,
    admin,
    spending,
    projects,
    space: { bill: space.bill, income: space.money },
    aircraftBill: aircraft,
    enterpriseIncome: enterprise,
    armsExports: arms,
    seigniorage: seign,
    realIncome,
  }
}

export function applyEconomy(s: GameState, map: WorldMap, nationId: NationId, rng: Rng, prices?: MarketPrices): EconomyReport {
  const n = s.nations[nationId]
  const e = computeEconomy(s, map, nationId)
  const r = n.resources

  r.capital += e.netCapital
  n.inDebt = r.capital < 0
  checkDefault(s, n)
  n.debtTurns = n.inDebt ? (n.debtTurns ?? 0) + 1 : 0
  if (n.debtTurns >= ECON.desertionAfter) {
    const loss = Math.min(ECON.maxDesertion, ECON.desertionPerMonth * (n.debtTurns - ECON.desertionAfter + 1))
    for (const k of UNIT_TYPES) n.military.units[k] *= 1 - loss
    for (const a of s.armies ?? []) if (a.nationId === nationId) for (const k of UNIT_TYPES) a.units[k] *= 1 - loss
    if (n.isPlayer || n.debtTurns === ECON.desertionAfter)
      addLog(s, 'economy', `${n.name} cannot pay its soldiers: ${Math.round(loss * 100)}% of the military has deserted.`, [nationId])
  }
  r.food += e.netFood
  if (r.food < 0) {
    if (!n.foodShortage) addLog(s, 'economy', `${n.name} is suffering a food shortage.`, [nationId])
    r.food = 0
    n.foodShortage = true
  } else {
    n.foodShortage = false
    r.food = Math.min(r.food, e.workforce * ECON.foodCapPerWorkforce)
  }
  // Materials: steel only piles up, oil and goods can run out.
  const capMult: Partial<Record<SectorId, number>> = {}
  const rateMult: Partial<Record<SectorId, number>> = {}
  const extra: Partial<Record<SectorId, number>> = { ...companyEffects(s, nationId).expand }
  for (const id of SECTOR_IDS) capMult[id] = industryCapMult(n, id) * (id === 'finance' && n.programs?.focus === 'business' ? 1 + 0.2 * (n.people?.specialization ?? 0) : 1)
  for (const id of n.stateOwned ?? []) rateMult[id] = ENTERPRISE.growth
  if (n.programs?.creditSector) extra[n.programs.creditSector] = (extra[n.programs.creditSector] ?? 0) + BANKING.directedGrowth
  if ((n.programs?.armsExports ?? 'off') !== 'off') extra.arms = (extra.arms ?? 0) + ARMS_EXPORTS.growth
  const pol = policyEffects(n)
  pol.growth += BANKING.growthPerPoint * (BANKING.neutralRate - policyRate(s, n)) - (n.seizedUntil > s.turn ? ENTERPRISE.seizeClimate : 0)
  growSectors(n, e.workforce, pol, enemiesOf(s, nationId).length > 0, extra, { capMult, rateMult })
  r.steel += e.steelProduction
  r.oil += e.netOil
  r.goods += e.netGoods
  buyShortfalls(s, nationId, e, prices ?? marketPrices(s))
  if (r.oil < 0) {
    if (!n.oilShortage && n.isPlayer) addLog(s, 'economy', `${n.name} is out of oil. Tanks, planes and warships fight at ${Math.round(MATERIALS.noOilStrength * 100)}% strength.`, [nationId])
    r.oil = 0
    n.oilShortage = true
  } else n.oilShortage = false
  if (r.goods < 0) {
    if (!n.goodsShortage && n.isPlayer) addLog(s, 'economy', `${n.name} has run out of goods. People are growing restless.`, [nationId])
    r.goods = 0
    n.goodsShortage = true
  } else n.goodsShortage = false
  n.tradeUsed = 0
  r.pp = Math.min(ECON.ppCap, r.pp + e.ppGain)
  r.tp += e.tpGain
  n.militaryPool = Math.min(e.militaryCap, n.militaryPool + e.militaryRegen)

  n.stability = clamp(n.stability + (e.stabilityTarget - n.stability) * 0.25, 0, 100)
  const enemies = enemiesOf(s, nationId)
  let weariness = 0
  for (const e of enemies) {
    const months = s.turn - (s.warStarted[pairKey(nationId, e)] ?? s.turn)
    weariness += WAR.weariness + Math.min(WAR.wearinessPerMonthCap, months * WAR.wearinessPerMonth)
  }
  n.warWeariness = clamp(n.warWeariness + (enemies.length > 0 ? weariness : -2), 0, 60)

  const owned = Object.values(s.regions)
    .filter((x) => x.owner === nationId)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  // Families grow with health, homes and food; an epidemic or famine takes its toll.
  const growth = n.people ? populationGrowth(n) : n.foodShortage ? -0.003 : 0.0008
  const occ = OCCUPATION[n.programs?.occupation ?? 'standard']
  const soc = societyEffects(n).social
  const heal = 1 + worksEffects(n).heal + scaleBonus(0.15, projectPower(n, 'rail'))
  for (const region of owned) {
    region.population *= 1 + growth
    if (region.sabotaged > 0) region.sabotaged--
    if (region.integration < 1) {
      const here = localEffects(region, map.regions[region.id])
      region.integration = Math.min(1, region.integration + (settleSpeed(s, map, n, region.id) * (1 + soc.settle + here.settle)) / WAR.integrationTurns)
      // Unrest in land you have not yet won over. Good policing, a tour of the provinces and a cultural centre make it rarer.
      if (rng.chance(0.07 * occ.rebels * (1 - region.integration) * Math.max(0, 1 - soc.order - here.order))) region.rebels += 0.4 + e.workforce * 0.02
    }
    // A country heals its Defense Line in months nobody attacks it.
    if (region.attackedTurn < s.turn) {
      const max = lineMax(s, map, region.id)
      region.line = Math.min(max, region.line + (WAR.healPerTurn + region.buildings.barracks * WAR.healPerBarracks) * heal)
    }
  }

  if (n.stability < 30 && rng.chance(((30 - n.stability) / 120) * (1 - soc.order))) {
    const candidates = owned.filter((x) => x.id !== n.capital)
    const target = candidates.length ? rng.pick(candidates) : owned[0]
    if (target) {
      target.rebels += 1 + e.workforce * 0.05
      addLog(s, 'event', `Unrest boils over: rebels rise up in ${map.regions[target.id].name}.`, [nationId])
    }
  }

  // The people's year, the bank's month, the projects' progress and the arms trade.
  if (n.people) runPeople(s, n, e.basis)
  // Programs phase in toward their level, and campaigns run down.
  runSociety(n)
  if (n.bank) runBank(s, n, e.gross, e.credit.score, e.credit.room, e.credit.rate, e.credit.locked)
  if (n.projects) r.capital += runProjects(s, n, e.coverage.engineers)
  r.capital += runLocalProjects(s, n, projectSpeed(n, e.coverage.engineers))
  if (n.space) r.capital += runSpace(s, map, n, e.researchStaff)
  if (n.aircraft) r.capital += runAircraft(s, n, projectSpeed(n, e.coverage.engineers))
  runArmsExports(s, n)
  return e
}

/**
 * A country on auto-buy keeps a small reserve of the materials it uses, buying what it is short of at the market price.
 * It never spends its last money and cannot move more than its trade capacity.
 */
function buyShortfalls(s: GameState, nationId: NationId, e: EconomyReport, prices: MarketPrices) {
  const n = s.nations[nationId]
  if (!n.autoBuy?.length) return
  const use: Partial<Record<TradeResource, number>> = { food: e.foodConsumption, oil: e.oilUse, goods: e.goodsUse }
  const net: Partial<Record<TradeResource, number>> = { food: e.netFood, oil: e.netOil, goods: e.netGoods, steel: e.steelProduction }
  // An embargo cuts what can be bought, on auto-buy as by hand.
  const capacity = e.tradeCapacity * ((n.embargoedUntil ?? 0) >= s.turn ? ECON.embargoTradeMult : 1)
  for (const r of n.autoBuy) {
    if (r === 'capital' || r === 'tp' || r === 'manpower') continue
    const stock = n.resources[r]
    // Steel is not used up month to month: the reserve is a store for building and training, topped up when production is thin.
    const want = r === 'steel' ? MATERIALS.steelReserve - stock : (use[r] ?? 0) * MATERIALS.autoBuyMonths - stock
    if (want <= 0 || (r === 'steel' ? (net.steel ?? 0) >= 1 : (net[r] ?? 0) >= 0 && stock >= 0)) continue
    const left = Math.max(0, capacity - n.tradeUsed)
    const price = prices[r] * (1 + marketSpread(n))
    const afford = Math.max(0, (n.resources.capital - 15) / price)
    const amount = Math.min(want, left, afford)
    if (amount < 0.05) continue
    n.resources.capital -= amount * price
    n.resources[r] += amount
    n.tradeUsed += amount
    pushMarket(s, r, amount)
  }
}

/** The market's cut on every trade. Free trade narrows it. */
export const marketSpread = (n: { laws: string[] }) => (n.laws.includes('free_trade') ? MATERIALS.freeTradeSpread : MATERIALS.spread)

export { militaryPower } from './militaryStats'
