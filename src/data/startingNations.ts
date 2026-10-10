import { ECON, regionWorkforce } from '../engine/economy'
import { createRng } from '../engine/rng'
import type { Rng } from '../engine/rng'
import type { Army, Difficulty, GameSettings, GameState, General, GeneralTrait, Nation, Personality, RegionState, WorldMap } from '../engine/types'

export const PLAYER_COLOR = '#22d3ee'

const GENERAL_FIRST = ['Viktor', 'Amara', 'Kenji', 'Ilse', 'Rafael', 'Noor', 'Dmitri', 'Saoirse', 'Tariq', 'Mei', 'Lucien', 'Zofia', 'Kwame', 'Elena', 'Hugo', 'Anika', 'Mateo', 'Yara', 'Bogdan', 'Ines']
const GENERAL_LAST = ['Varga', 'Okafor', 'Takeda', 'Brandt', 'Montoya', 'Haddad', 'Volkov', 'Byrne', 'Rahman', 'Lin', 'Moreau', 'Nowak', 'Mensah', 'Petrova', 'Lindqvist', 'Sato', 'Reyes', 'Kader', 'Horvat', 'Silva']
export const GENERAL_TRAITS: Record<GeneralTrait, { name: string; description: string }> = {
  mountaineer: { name: 'Mountaineer', description: '+30% attack and defense in mountains and forests.' },
  logistician: { name: 'Logistician', description: '+1 supply tolerance, halves out-of-supply attrition.' },
  blitz: { name: 'Blitzkrieg', description: '+25% armor attack.' },
  air_marshal: { name: 'Air Marshal', description: '+25% air attack.' },
  stalwart: { name: 'Stalwart', description: '+25% defense.' },
}
const TRAITS = Object.keys(GENERAL_TRAITS) as GeneralTrait[]

function nationColor(index: number): string {
  const hue = (index * 137.508 + 20) % 360
  const inCyanBand = hue > 170 && hue < 200
  return `hsl(${Math.round(inCyanBand ? hue + 40 : hue)}, ${55 + (index % 3) * 10}%, ${42 + (index % 4) * 6}%)`
}

export interface NewGameOptions {
  playerRegionId: string
  seed: number
  victoryShare: number
  difficulty?: Difficulty
}

function pickPersonality(aggression: number, rng: Rng): Personality {
  const roll = rng.next()
  if (aggression > 0.68) return roll < 0.6 ? 'expansionist' : roll < 0.9 ? 'opportunist' : 'honorable'
  if (aggression < 0.35) return roll < 0.4 ? 'trader' : roll < 0.75 ? 'turtle' : 'honorable'
  return roll < 0.3 ? 'trader' : roll < 0.55 ? 'opportunist' : roll < 0.8 ? 'honorable' : roll < 0.9 ? 'turtle' : 'expansionist'
}

export function createInitialState(map: WorldMap, opts: NewGameOptions): GameState {
  const rng = createRng(opts.seed, 9999)
  const settings: GameSettings = { victoryShare: opts.victoryShare, seed: opts.seed, difficulty: opts.difficulty ?? 'normal' }
  const state: GameState = {
    turn: 1,
    seed: opts.seed,
    settings,
    playerId: opts.playerRegionId,
    nations: {},
    regions: {},
    armies: {},
    wars: [],
    pacts: {},
    casusBelli: {},
    alliances: [],
    proposals: [],
    deals: [],
    warScore: {},
    warStarted: {},
    opinions: {},
    proposalMemory: {},
    dispatches: [],
    pendingEvent: null,
    nextEventTurn: 2 + rng.int(0, 2),
    battles: [],
    log: [],
    nextId: 1,
    outcome: 'playing',
  }

  map.order.forEach((id, index) => {
    const mr = map.regions[id]
    const region: RegionState = {
      id,
      owner: id,
      population: mr.basePopulation,
      buildings: { factory: 0, farm: 0, university: 0, barracks: 1, port: 0, depot: 0 },
      sabotaged: 0,
      rebels: 0,
    }
    const w = regionWorkforce(region, mr)
    const dev = mr.development
    region.buildings.factory = Math.max(1, Math.round((w / 3) * (0.5 + dev)))
    region.buildings.university = Math.round((w / 6) * dev)
    region.buildings.barracks = 1 + Math.floor(w / 15)
    region.buildings.port = mr.coastal ? 1 + Math.floor((w / 20) * dev) : 0

    const techs = ['land_rifles']
    if (dev >= 0.5) techs.push('land_light_tanks', 'air_propeller')
    if (dev >= 0.5 && mr.coastal) techs.push('naval_gunboats')
    if (dev >= 0.8) techs.push('infra_farming')

    const units = {
      infantry: Math.max(1, Math.round(1 + Math.sqrt(w) * 1.2)),
      armor: techs.includes('land_light_tanks') ? Math.round(w / 10) : 0,
      air: techs.includes('air_propeller') ? Math.round(w / 12) : 0,
      naval: techs.includes('naval_gunboats') ? Math.round(w / 15) : 0,
    }
    const armyFood = units.infantry * 0.3 + units.armor * 0.2 + units.air * 0.1 + units.naval * 0.15
    region.buildings.farm = Math.max(1, Math.ceil((armyFood + w * 0.12) / ECON.foodPerFarm))

    const generals: General[] = []
    const generalCount = dev >= 0.8 ? 3 : dev >= 0.45 ? 2 : 1
    for (let g = 0; g < generalCount; g++) {
      generals.push({
        id: `g-${id}-${g}`,
        name: `${rng.pick(GENERAL_FIRST)} ${rng.pick(GENERAL_LAST)}`,
        trait: rng.pick(TRAITS),
      })
    }

    const isPlayer = id === opts.playerRegionId
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
      resources: { capital: 30 + w * 6, food: w * 4, pp: 30, tp: 0 },
      militaryPool: w * 0.05 * ECON.militaryCapPerWorkforce * 0.5,
      taxRate: 0.25,
      draftRate: 0.05,
      stability: 65,
      warWeariness: 0,
      techs,
      laws: [],
      generals,
      foodShortage: false,
      inDebt: false,
      debtTurns: 0,
      embargoedUntil: 0,
      vision: {},
      aggression,
      personality,
      contracts: [],
    }

    const army: Army = {
      id: `a${state.nextId++}`,
      owner: id,
      location: id,
      units,
      generalId: generals[0]?.id ?? null,
      outOfSupplyTurns: 0,
      entrenched: 0,
      homeTerritoryId: map.territoriesByRegion[id]?.[0] ?? '',
      training: 0,
    }
    state.regions[id] = region
    state.nations[id] = nation
    state.armies[army.id] = army
  })

  return state
}
