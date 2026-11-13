import { difficultyOf } from '../data/difficulty'
import { TERRAIN } from '../data/terrain'
import { BUILDING_SPECS, UNIT_SPECS } from '../data/unitTypes'
import { MATERIALS, OIL_DEPOSITS, STEEL_DEPOSITS } from '../data/deposits'
import { WAR } from '../data/war'
import { addLog, clamp, enemiesOf, nationModifiers, pairKey } from './helpers'
import type { Rng } from './rng'
import { checkDefault, creditReport, dividendsFor, growSectors, sectorYield, subsidyBill } from './business'
import { policyEffects } from './policy'
import { marketPrices, type MarketPrices } from './trade'
import type { Buildings, BuildingType, GameState, MapRegion, NationId, RegionState, TradeResource, WorldMap } from './types'
import { BUILDING_TYPES, UNIT_TYPES } from './types'

export const ECON = {
  taxPerWorkforce: 12,
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
  return Math.pow(Math.max(0.05, region.population), 0.6) * (0.3 + 0.7 * mapRegion.development)
}

/** Highest level of a building a country can reach. Bigger countries have room for more. */
export function buildingCap(workforce: number, building: BuildingType): number {
  const big = building === 'port' || building === 'civic' ? 15 : 6
  return BUILDING_SPECS[building].max + Math.floor(workforce / big)
}

/** Defense Line points a country starts with. Big, fortified countries and capitals hold out longer. */
export function lineMax(s: GameState, map: WorldMap, regionId: string): number {
  const r = s.regions[regionId]
  const capital = s.nations[r.owner]?.capital === regionId ? WAR.lineCapital : 0
  return WAR.lineBase + regionWorkforce(r, map.regions[regionId]) * WAR.linePerWorkforce + r.buildings.barracks * WAR.linePerBarracks + capital
}

/** Share of a country's output that counts, rising as conquered land is integrated. */
export const integrationFactor = (r: RegionState) => WAR.integrationFloor + (1 - WAR.integrationFloor) * Math.min(1, Math.max(0, r.integration))

export interface WarBill {
  enemy: NationId
  amount: number
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
  /** Income gained or spent each month on laws, such as healthcare or austerity. */
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
  divisions: number
  population: number
}

export function computeEconomy(s: GameState, map: WorldMap, nationId: NationId): EconomyReport {
  const n = s.nations[nationId]
  const mods = nationModifiers(n)
  const owned = Object.values(s.regions).filter((r) => r.owner === nationId)
  const buildings: Buildings = { factory: 0, farm: 0, university: 0, barracks: 0, port: 0, civic: 0 }
  let workforce = 0
  let baseFood = 0
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
  for (const r of owned) {
    const mr = map.regions[r.id]
    const eff = integrationFactor(r)
    const w = regionWorkforce(r, mr) * eff
    workforce += w
    population += r.population
    baseFood += w * (1 - n.draftRate) * ECON.baseFoodPerWorkforce * TERRAIN[mr.terrain].food
    for (const b of BUILDING_TYPES) buildings[b] += r.buildings[b]
    workingFarms += r.buildings.farm * eff
    workingUniversities += r.buildings.university * eff
    if (r.sabotaged <= 0) activeFactories += r.buildings.factory * eff
    if (r.rebels > 0) rebelRegions++
    if (r.integration < 1) occupied++
    oilProduction += (OIL_DEPOSITS[r.id] ?? 0) * eff
    steelProduction += ((STEEL_DEPOSITS[r.id] ?? 0) + r.buildings.factory * MATERIALS.steelPerFactory) * eff
    goodsProduction += (w * MATERIALS.goodsPerWorkforce + r.buildings.factory * MATERIALS.goodsPerFactory) * eff
    portLevels += r.buildings.port * eff
  }
  const sy = sectorYield(n)
  oilProduction += sy.oil
  steelProduction += sy.steel
  goodsProduction += sy.goods
  const civilianWorkforce = workforce * (1 - n.draftRate)
  const jobs = (buildings.factory + buildings.farm + buildings.university) * ECON.jobsPerBuilding * (1 - mods.jobsReduction)
  const laborRatio = jobs > 0 ? Math.min(1, civilianWorkforce / jobs) : 1
  const stabilityFactor = 0.6 + (0.4 * n.stability) / 100
  const pol = policyEffects(n)
  const outputMult = stabilityFactor * (1 + mods.allOutput + pol.output)
  const atWarCount = enemiesOf(s, nationId).length
  const botBonus = n.isPlayer ? 0 : difficultyOf(s.settings.difficulty).botIncomeBonus
  const embargoed = (n.embargoedUntil ?? 0) >= s.turn

  const taxIncome = n.taxRate * civilianWorkforce * ECON.taxPerWorkforce * outputMult * (1 + botBonus)
  const factoryIncome =
    activeFactories * ECON.factoryOutput * laborRatio * (1 + mods.factoryOutput + pol.factory) * outputMult * (1 + botBonus)
  const tradeIncome = buildings.port * ECON.portTrade * outputMult * (atWarCount > 0 ? 0.7 : 1) * (embargoed ? ECON.embargoTradeMult : 1)
  const biz = sy
  const corporateIncome = (n.corporateTax ?? 0) * biz.profit * outputMult + biz.money
  const dividends = dividendsFor(s, nationId)
  const subsidies = subsidyBill(n)
  const gross = taxIncome + factoryIncome + tradeIncome + corporateIncome
  const credit = creditReport(s, n, gross, enemiesOf(s, nationId).length > 0)
  const interest = n.debt * credit.rate
  const policyMoney = pol.money * gross
  const land = { capital: 0, food: 0, pp: buildings.civic * 0.6, tp: buildings.civic * 0.3 }

  let upkeep = 0
  let armyFood = 0
  let divisions = 0
  let oilUse = 0
  for (const k of UNIT_TYPES) {
    upkeep += n.military.units[k] * UNIT_SPECS[k].upkeep
    armyFood += n.military.units[k] * UNIT_SPECS[k].food
    oilUse += n.military.units[k] * UNIT_SPECS[k].oil
    divisions += n.military.units[k]
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
  const totalBuildings = BUILDING_TYPES.reduce((sum, b) => sum + buildings[b], 0)
  upkeep += totalBuildings * ECON.buildingUpkeep
  upkeep *= Math.max(0.3, 1 + pol.upkeep)

  const foodProduction = sy.food + baseFood + owned.length * ECON.subsistencePerRegion + workingFarms * ECON.foodPerFarm * laborRatio * (1 + mods.foodOutput) + land.food
  const foodConsumption = workforce * ECON.foodConsumptionPerWorkforce * (1 + pol.foodUse) + armyFood

  const ppGain = 1.5 + n.stability / 50 + mods.ppPerTurn + pol.influence + land.pp
  const tpGain =
    0.5 + workforce * 0.04 + sy.research * outputMult + workingUniversities * ECON.tpPerUniversity * laborRatio * (1 + mods.researchOutput + pol.research) * outputMult + land.tp

  const highTax = Math.max(0, n.taxRate - 0.2) * 150 * Math.max(0.2, 1 + pol.taxSensitivity)
  const lowTax = Math.max(0, 0.2 - n.taxRate) * 50
  const stabilityTarget = clamp(
    ECON.stabilityBase -
      highTax +
      lowTax -
      (n.foodShortage ? 25 : 0) -
      (n.goodsShortage ? MATERIALS.noGoodsStability : 0) -
      (n.inDebt ? 15 : 0) -
      n.warWeariness * 0.5 * Math.max(0.2, 1 + pol.weariness) +
      pol.stability +
      mods.stability -
      rebelRegions * 3 -
      Math.max(0, occupied - WAR.overextendFree) * WAR.overextendPenalty,
    0,
    100,
  )

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
    netCapital: taxIncome + factoryIncome + tradeIncome + corporateIncome + dividends + land.capital - upkeep - warBillTotal - interest - subsidies + policyMoney,
    business: biz,
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
    tradeCapacity: (MATERIALS.tradeBase + portLevels * MATERIALS.tradePerPort) * Math.max(0.3, 1 + pol.trade),
    ppGain,
    tpGain,
    militaryRegen: workforce * n.draftRate * ECON.militaryRegenPerWorkforce,
    militaryCap: workforce * n.draftRate * ECON.militaryCapPerWorkforce,
    civilianManpower: population * (1 - n.draftRate),
    stabilityTarget,
    divisions,
    population,
  }
}

export function applyEconomy(s: GameState, map: WorldMap, nationId: NationId, rng: Rng, prices?: MarketPrices) {
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
  growSectors(n, e.workforce, policyEffects(n), enemiesOf(s, nationId).length > 0)
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
  for (const region of owned) {
    region.population *= n.foodShortage ? 0.997 : 1.0008
    if (region.sabotaged > 0) region.sabotaged--
    if (region.integration < 1) {
      region.integration = Math.min(1, region.integration + 1 / WAR.integrationTurns)
      // Unrest in land you have not yet won over.
      if (rng.chance(0.07 * (1 - region.integration))) region.rebels += 0.4 + e.workforce * 0.02
    }
    // A country heals its Defense Line in months nobody attacks it.
    if (region.attackedTurn < s.turn) {
      const max = lineMax(s, map, region.id)
      region.line = Math.min(max, region.line + WAR.healPerTurn + region.buildings.barracks * WAR.healPerBarracks)
    }
  }

  if (n.stability < 30 && rng.chance((30 - n.stability) / 120)) {
    const candidates = owned.filter((x) => x.id !== n.capital)
    const target = candidates.length ? rng.pick(candidates) : owned[0]
    if (target) {
      target.rebels += 1 + e.workforce * 0.05
      addLog(s, 'event', `Unrest boils over: rebels rise up in ${map.regions[target.id].name}.`, [nationId])
    }
  }
}

/**
 * A country on auto-buy keeps a small reserve of the materials it uses, buying what it is short of at the market price.
 * It never spends its last money and cannot move more than its trade capacity.
 */
function buyShortfalls(s: GameState, nationId: NationId, e: EconomyReport, prices: MarketPrices) {
  const n = s.nations[nationId]
  if (!n.autoBuy?.length) return
  const use: Partial<Record<TradeResource, number>> = { food: e.foodConsumption, oil: e.oilUse, goods: e.goodsUse, steel: 0 }
  const net: Partial<Record<TradeResource, number>> = { food: e.netFood, oil: e.netOil, goods: e.netGoods, steel: e.steelProduction }
  for (const r of n.autoBuy) {
    if (r === 'capital' || r === 'tp' || r === 'manpower') continue
    const stock = n.resources[r]
    const want = (use[r] ?? 0) * MATERIALS.autoBuyMonths - stock
    if (want <= 0 || (net[r] ?? 0) >= 0 && stock >= 0) continue
    const left = Math.max(0, e.tradeCapacity - n.tradeUsed)
    const price = prices[r] * (1 + marketSpread(n))
    const afford = Math.max(0, (n.resources.capital - 15) / price)
    const amount = Math.min(want, left, afford)
    if (amount < 0.05) continue
    n.resources.capital -= amount * price
    n.resources[r] += amount
    n.tradeUsed += amount
  }
}

/** The market's cut on every trade. Free trade narrows it. */
export const marketSpread = (n: { laws: string[] }) => (n.laws.includes('free_trade') ? MATERIALS.freeTradeSpread : MATERIALS.spread)

export { militaryPower } from './militaryStats'
