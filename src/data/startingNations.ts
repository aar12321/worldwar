import { PLAYER_COLOR, mapColor } from './mapColors'
import { OIL_DEPOSITS, STEEL_DEPOSITS } from './deposits'
import { SECTOR_IDS, SECTORS } from './business'
import { sectorCap } from '../engine/business'
import { worldGross } from '../engine/victory'
import { startingCities } from '../engine/cities'
import { CORPORATE_TAX, EVEN_BUDGET, GOVERNMENTS } from './government'
import { UNIT_SPECS, emptyTraining } from './unitTypes'
import { ECON, buildingCap, computeEconomy, lineMax, regionWorkforce } from '../engine/economy'
import { FIRST_EVENT_TURN } from '../engine/events'
import { createRng } from '../engine/rng'
import type { Rng } from '../engine/rng'
import { newStocks } from '../engine/stocks'
import { BUILDING_TYPES, UNIT_TYPES } from '../engine/types'
import type { Difficulty, GameSettings, GovernmentType, SectorId, GameState, General, GeneralTrait, Nation, Personality, RegionState, WorldMap } from '../engine/types'

const GENERAL_FIRST = ['Viktor', 'Amara', 'Kenji', 'Ilse', 'Rafael', 'Noor', 'Dmitri', 'Saoirse', 'Tariq', 'Mei', 'Lucien', 'Zofia', 'Kwame', 'Elena', 'Hugo', 'Anika', 'Mateo', 'Yara', 'Bogdan', 'Ines']
const GENERAL_LAST = ['Varga', 'Okafor', 'Takeda', 'Brandt', 'Montoya', 'Haddad', 'Volkov', 'Byrne', 'Rahman', 'Lin', 'Moreau', 'Nowak', 'Mensah', 'Petrova', 'Lindqvist', 'Sato', 'Reyes', 'Kader', 'Horvat', 'Silva']
/** Names kept for older saves. A general's only effect is free training at home. */
export const GENERAL_TRAITS: Record<GeneralTrait, { name: string; description: string }> = {
  mountaineer: { name: 'General', description: 'Drills your lowest-ranked unit type for free each month.' },
  logistician: { name: 'General', description: 'Drills your lowest-ranked unit type for free each month.' },
  blitz: { name: 'General', description: 'Drills your lowest-ranked unit type for free each month.' },
  air_marshal: { name: 'General', description: 'Drills your lowest-ranked unit type for free each month.' },
  stalwart: { name: 'General', description: 'Drills your lowest-ranked unit type for free each month.' },
}
const TRAITS = Object.keys(GENERAL_TRAITS) as GeneralTrait[]

function nationColor(index: number): string {
  return mapColor(index)
}

export interface NewGameOptions {
  playerRegionId: string
  /** Every nation a person plays, for an online game. Defaults to just the player's. */
  humans?: string[]
  seed: number
  victoryShare?: number
  goal?: 'world' | 'classic'
  difficulty?: Difficulty
  /** 'live': time flows and armies march. Turns, the default, is the game as it has always played. */
  mode?: 'turns' | 'live'
}

function pickPersonality(aggression: number, rng: Rng): Personality {
  const roll = rng.next()
  if (aggression > 0.68) return roll < 0.6 ? 'expansionist' : roll < 0.9 ? 'opportunist' : 'honorable'
  if (aggression < 0.35) return roll < 0.4 ? 'trader' : roll < 0.75 ? 'turtle' : 'honorable'
  return roll < 0.3 ? 'trader' : roll < 0.55 ? 'opportunist' : roll < 0.8 ? 'honorable' : roll < 0.9 ? 'turtle' : 'expansionist'
}

/** Early business: bigger and more varied in richer countries. */
function startingSectors(workforce: number, dev: number): Record<SectorId, number> {
  const cap = sectorCap(workforce)
  const out = {} as Record<SectorId, number>
  for (const id of SECTOR_IDS) out[id] = Math.round(cap * dev * SECTORS[id].startShare * 1.2 * 100) / 100
  return out
}

export function createInitialState(map: WorldMap, opts: NewGameOptions): GameState {
  const rng = createRng(opts.seed, 9999)
  // The old early-surprise roll stays so a seed still builds the same generals and personalities.
  void rng.int(0, 2)
  const settings: GameSettings = { victoryShare: opts.victoryShare ?? 0.4, goal: opts.goal ?? 'world', seed: opts.seed, difficulty: opts.difficulty ?? 'normal' }
  const state: GameState = {
    turn: 1,
    seed: opts.seed,
    settings,
    playerId: opts.playerRegionId,
    humans: [...new Set([opts.playerRegionId, ...(opts.humans ?? [])])],
    winner: null,
    eliminated: [],
    nations: {},
    regions: {},
    trainingQueue: [],
    wars: [],
    pacts: {},
    casusBelli: {},
    alliances: [],
    proposals: [],
    deals: [],
    investments: [],
    sanctions: [],
    guarantees: [],
    warScore: {},
    warStarted: {},
    opinions: {},
    proposalMemory: {},
    reasons: {},
    infamy: {},
    cases: [],
    intel: {},
    stocks: newStocks(map),
    crises: [],
    dispatches: [],
    pendingEvent: null,
    nextEventTurn: FIRST_EVENT_TURN,
    battles: [],
    log: [],
    nextId: 1,
    outcome: 'playing',
    worldGross: 0,
  }

  map.order.forEach((id, index) => {
    const mr = map.regions[id]
    const region: RegionState = {
      id,
      owner: id,
      population: mr.basePopulation,
      buildings: { factory: 0, farm: 0, university: 0, barracks: 1, port: 0, civic: 0 },
      sabotaged: 0,
      rebels: 0,
      line: 0,
      integration: 1,
      attackedTurn: -1,
      cities: startingCities(mr),
    }
    const w = regionWorkforce(region, mr)
    const dev = mr.development
    region.buildings.factory = Math.max(1, Math.round((w / 3) * (0.5 + dev)))
    region.buildings.university = Math.round((w / 6) * dev)
    region.buildings.barracks = 1 + Math.floor(w / 15)
    region.buildings.port = mr.coastal ? 1 + Math.floor((w / 20) * dev) : 0

    const techs = ['land_rifles']
    if (dev >= 0.5) techs.push('land_light_tanks', 'air_propeller', 'land_artillery')
    if (dev >= 0.7) techs.push('air_bombers')
    if (dev >= 0.5 && mr.coastal) techs.push('naval_gunboats')
    if (dev >= 0.8) techs.push('infra_farming')

    const units = {
      infantry: Math.max(1, Math.round(1 + Math.sqrt(w) * 1.2)),
      armor: techs.includes('land_light_tanks') ? Math.round(w / 10) : 0,
      artillery: techs.includes('land_artillery') ? Math.round(w / 16) : 0,
      fighter: techs.includes('air_propeller') ? Math.round(w / 20) : 0,
      air: techs.includes('air_bombers') ? Math.round(w / 20) : 0,
      naval: techs.includes('naval_gunboats') ? Math.round(w / 15) : 0,
      drone: 0,
      robot: 0,
      missile: 0,
    }
    const armyFood = UNIT_TYPES.reduce((sum, k) => sum + units[k] * UNIT_SPECS[k].food, 0)
    region.buildings.farm = Math.max(1, Math.ceil((armyFood + w * 0.12) / ECON.foodPerFarm))
    for (const b of BUILDING_TYPES) region.buildings[b] = Math.min(region.buildings[b], buildingCap(w, b))

    const generals: General[] = []
    const generalCount = dev >= 0.8 ? 3 : dev >= 0.45 ? 2 : 1
    for (let g = 0; g < generalCount; g++) {
      generals.push({
        id: `g-${id}-${g}`,
        name: `${rng.pick(GENERAL_FIRST)} ${rng.pick(GENERAL_LAST)}`,
        trait: rng.pick(TRAITS),
      })
    }

    // Rich countries are mostly democracies; the rest are a mix.
    const govRoll = rng.next()
    const government: GovernmentType = dev >= 0.7 ? (govRoll < 0.75 ? 'democracy' : govRoll < 0.88 ? 'monarchy' : 'one_party') : dev >= 0.4 ? (govRoll < 0.4 ? 'democracy' : govRoll < 0.65 ? 'monarchy' : govRoll < 0.85 ? 'one_party' : 'junta') : govRoll < 0.2 ? 'democracy' : govRoll < 0.5 ? 'monarchy' : govRoll < 0.7 ? 'one_party' : 'junta'
    const isPlayer = state.humans.includes(id)
    const aggression = isPlayer ? 0 : rng.range(0.15, 0.9)
    const personality = isPlayer ? 'honorable' : pickPersonality(aggression, rng)
    const nation: Nation = {
      id,
      name: mr.name,
      color: isPlayer ? PLAYER_COLOR : nationColor(index),
      capital: id,
      originalCapital: id,
      isPlayer,
      alive: true,
      resources: { capital: 30 + w * 6, food: w * 4, pp: 30, tp: 0, oil: 8 + (OIL_DEPOSITS[id] ?? 0) * 6, steel: 6 + (STEEL_DEPOSITS[id] ?? 0) * 4, goods: w * 2 },
      militaryPool: w * 0.05 * ECON.militaryCapPerWorkforce * 0.5,
      taxRate: 0.2,
      draftRate: 0.05,
      stability: 65,
      warWeariness: 0,
      techs,
      laws: [],
      generals,
      government,
      budget: { ...EVEN_BUDGET },
      overlord: null,
      agencies: { foreign: { level: dev > 0.75 ? 2 : dev > 0.45 ? 1 : 0, exp: 0 }, domestic: { level: dev > 0.55 ? 1 : 0, exp: 0 } },
      secureUntil: 0,
      systems: { cyber: 0, shield: 0, ai: 0, quantum: 0, orbital: 0, nano: 0 },
      lastStrike: -99,
      lastOrbital: -99,
      sectors: startingSectors(w, dev),
      subsidies: [],
      debt: 0,
      redMonths: 0,
      defaultedUntil: 0,
      corporateTax: CORPORATE_TAX.default,
      nextElection: GOVERNMENTS[government].election > 0 ? 12 + rng.int(0, 24) : 0,
      lastReform: 0,
      foodShortage: false,
      oilShortage: false,
      goodsShortage: false,
      tradeUsed: 0,
      autoBuy: ['food', 'oil', 'goods'],
      inDebt: false,
      debtTurns: 0,
      embargoedUntil: 0,
      aggression,
      personality,
      military: { units, drill: emptyTraining(), weapons: emptyTraining(), commanderId: null, lastAttackTurn: 0, attacksThisTurn: 0, exposed: 0 },
    }

    state.regions[id] = region
    state.nations[id] = nation
  })

  for (const nation of Object.values(state.nations)) {
    const capital = state.regions[nation.capital]
    const units = nation.military.units
    let guard = 0
    while (capital && guard < 12 && computeEconomy(state, map, nation.id).netFood < 0.4) {
      const econ = computeEconomy(state, map, nation.id)
      guard++
      if (econ.laborRatio < 0.9 && capital.buildings.factory > 0) capital.buildings.factory -= 1
      else if (econ.laborRatio < 0.9 && capital.buildings.university > 0) capital.buildings.university -= 1
      else if (capital.buildings.farm < 12) capital.buildings.farm += 1
      else if (units.infantry > 1) units.infantry -= 1
      else break
    }
    if (nation.resources.food < 8) nation.resources.food = 8
  }
  for (const r of Object.values(state.regions)) r.line = lineMax(state, map, r.id)
  state.worldGross = worldGross(state, map)
  // The live fields exist only in a live game, so a turn game's save is exactly what it always was.
  if (opts.mode === 'live') {
    state.settings.mode = 'live'
    state.day = 0
    state.armies = []
    state.launches = []
    state.flights = []
  }

  return state
}
