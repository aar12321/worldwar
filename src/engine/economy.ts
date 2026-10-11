import { difficultyOf } from '../data/difficulty'
import { TERRAIN } from '../data/terrain'
import { TRAINING, UNIT_SPECS, clampTraining, type UnitTraining } from '../data/unitTypes'
import { combatMods } from './arms'
import { addLog, armiesOf, clamp, enemiesOf, nationModifiers, type AggregatedModifiers } from './helpers'
import type { Rng } from './rng'
import type { Buildings, GameState, MapRegion, NationId, RegionState, UnitType, WorldMap } from './types'
import { BUILDING_TYPES, UNIT_TYPES } from './types'

export const ECON = {
  taxPerWorkforce: 12,
  factoryOutput: 6,
  portTrade: 3,
  jobsPerBuilding: 0.6,
  buildingUpkeep: 0.15,
  baseFoodPerWorkforce: 0.8,
  foodPerFarm: 3,
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

export function regionWorkforce(region: RegionState, mapRegion: MapRegion): number {
  return Math.pow(Math.max(0.05, region.population), 0.6) * (0.3 + 0.7 * mapRegion.development)
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
  foodProduction: number
  foodConsumption: number
  netFood: number
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
  const buildings: Buildings = { factory: 0, farm: 0, university: 0, barracks: 0, port: 0, depot: 0 }
  let workforce = 0
  let baseFood = 0
  let activeFactories = 0
  let population = 0
  let rebelRegions = 0
  for (const r of owned) {
    const mr = map.regions[r.id]
    const w = regionWorkforce(r, mr)
    workforce += w
    population += r.population
    baseFood += w * (1 - n.draftRate) * ECON.baseFoodPerWorkforce * TERRAIN[mr.terrain].food
    for (const b of BUILDING_TYPES) buildings[b] += r.buildings[b]
    if (r.sabotaged <= 0) activeFactories += r.buildings.factory
    if (r.rebels > 0) rebelRegions++
  }
  const civilianWorkforce = workforce * (1 - n.draftRate)
  const jobs = (buildings.factory + buildings.farm + buildings.university) * ECON.jobsPerBuilding * (1 - mods.jobsReduction)
  const laborRatio = jobs > 0 ? Math.min(1, civilianWorkforce / jobs) : 1
  const stabilityFactor = 0.6 + (0.4 * n.stability) / 100
  const martial = n.laws.includes('martial_law')
  const warEconomy = n.laws.includes('war_economy')
  const outputMult = stabilityFactor * (1 + mods.allOutput) * (martial ? 0.85 : 1)
  const atWarCount = enemiesOf(s, nationId).length
  const botBonus = n.isPlayer ? 0 : difficultyOf(s.settings.difficulty).botIncomeBonus
  const embargoed = (n.embargoedUntil ?? 0) >= s.turn

  const taxIncome = n.taxRate * civilianWorkforce * ECON.taxPerWorkforce * outputMult * (1 + botBonus)
  const factoryIncome =
    activeFactories * ECON.factoryOutput * laborRatio * (1 + mods.factoryOutput + (warEconomy ? 0.25 : 0)) * outputMult * (1 + botBonus)
  const tradeIncome = buildings.port * ECON.portTrade * outputMult * (atWarCount > 0 ? 0.7 : 1) * (embargoed ? ECON.embargoTradeMult : 1)

  const armies = armiesOf(s, nationId)
  let upkeep = 0
  let armyFood = 0
  let divisions = 0
  for (const a of armies)
    for (const k of UNIT_TYPES) {
      upkeep += a.units[k] * UNIT_SPECS[k].upkeep
      armyFood += a.units[k] * UNIT_SPECS[k].food
      divisions += a.units[k]
    }
  const totalBuildings = BUILDING_TYPES.reduce((sum, b) => sum + buildings[b], 0)
  upkeep += totalBuildings * ECON.buildingUpkeep

  const foodProduction = baseFood + buildings.farm * ECON.foodPerFarm * laborRatio * (1 + mods.foodOutput)
  const foodConsumption = workforce * ECON.foodConsumptionPerWorkforce + armyFood

  const ppGain = 1.5 + n.stability / 50 + mods.ppPerTurn
  const tpGain =
    0.5 + workforce * 0.04 + buildings.university * ECON.tpPerUniversity * laborRatio * (1 + mods.researchOutput) * outputMult

  const highTax = Math.max(0, n.taxRate - 0.2) * 150
  const lowTax = Math.max(0, 0.2 - n.taxRate) * 50
  const stabilityTarget = clamp(
    ECON.stabilityBase -
      highTax +
      lowTax -
      (n.foodShortage ? 25 : 0) -
      (n.inDebt ? 15 : 0) -
      n.warWeariness * 0.5 +
      (martial ? 15 : 0) -
      (warEconomy ? 10 : 0) +
      mods.stability -
      rebelRegions * 3,
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
    netCapital: taxIncome + factoryIncome + tradeIncome - upkeep,
    foodProduction,
    foodConsumption,
    netFood: foodProduction - foodConsumption,
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

export function applyEconomy(s: GameState, map: WorldMap, nationId: NationId, rng: Rng) {
  const n = s.nations[nationId]
  const e = computeEconomy(s, map, nationId)
  const r = n.resources

  r.capital += e.netCapital
  n.inDebt = r.capital < 0
  n.debtTurns = n.inDebt ? (n.debtTurns ?? 0) + 1 : 0
  if (n.debtTurns >= ECON.desertionAfter) {
    const loss = Math.min(ECON.maxDesertion, ECON.desertionPerMonth * (n.debtTurns - ECON.desertionAfter + 1))
    for (const a of armiesOf(s, nationId)) for (const k of UNIT_TYPES) a.units[k] *= 1 - loss
    if (n.isPlayer || n.debtTurns === ECON.desertionAfter)
      addLog(s, 'economy', `${n.name} cannot pay its soldiers: ${Math.round(loss * 100)}% of every army has deserted.`, [nationId])
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
  r.pp = Math.min(ECON.ppCap, r.pp + e.ppGain)
  r.tp += e.tpGain
  n.militaryPool = Math.min(e.militaryCap, n.militaryPool + e.militaryRegen)

  n.stability = clamp(n.stability + (e.stabilityTarget - n.stability) * 0.25, 0, 100)
  const atWar = enemiesOf(s, nationId).length > 0
  n.warWeariness = clamp(n.warWeariness + (atWar ? 0.8 : -2), 0, 60)

  const owned = Object.values(s.regions)
    .filter((x) => x.owner === nationId)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const region of owned) {
    region.population *= n.foodShortage ? 0.997 : 1.0008
    if (region.sabotaged > 0) region.sabotaged--
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

/** Total army strength, including technology, training, and weapons contracts. */
export function militaryPower(s: GameState, nationId: NationId): number {
  const n = s.nations[nationId]
  if (!n) return 0
  const mods = combatMods(n, s.turn)
  let p = 0
  for (const a of Object.values(s.armies)) if (a.owner === nationId) p += unitPower(a.units, mods, a.training)
  return p
}

export function unitPower(units: Record<UnitType, number>, mods?: AggregatedModifiers | null, training: number | UnitTraining = 0): number {
  let p = 0
  for (const k of UNIT_TYPES) {
    const spec = UNIT_SPECS[k]
    const rank = clampTraining(typeof training === 'number' ? training : training[k] ?? 0)
    const drilled = 1 + rank * TRAINING.bonusPerLevel
    p += units[k] * (spec.attack * (1 + (mods?.unitAttack[k] ?? 0)) + spec.defense * (1 + (mods?.unitDefense[k] ?? 0))) * 0.5 * drilled
  }
  return p
}
