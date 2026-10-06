export type Terrain = 'plains' | 'forest' | 'mountain' | 'desert' | 'urban'
export type RegionId = string
export type NationId = string
export type UnitType = 'infantry' | 'armor' | 'air' | 'naval'
export type BuildingType = 'factory' | 'farm' | 'university' | 'barracks' | 'port'
export type TechBranch = 'land' | 'air' | 'naval' | 'infra'
export type LawId = 'martial_law' | 'war_economy' | 'conscription_act'
export type GeneralTrait = 'mountaineer' | 'logistician' | 'blitz' | 'air_marshal' | 'stalwart'
export type SpyMission = 'sabotage' | 'stealVision'

export const UNIT_TYPES: UnitType[] = ['infantry', 'armor', 'air', 'naval']
export const BUILDING_TYPES: BuildingType[] = ['factory', 'farm', 'university', 'barracks', 'port']

/** Static geography, never mutated during play. */
export interface MapRegion {
  id: RegionId
  name: string
  lat: number
  lng: number
  /** Share of world land area (0..1). */
  area: number
  terrain: Terrain
  coastal: boolean
  neighbors: RegionId[]
  seaLanes: RegionId[]
  basePopulation: number
  development: number
}

export interface WorldMap {
  regions: Record<RegionId, MapRegion>
  order: RegionId[]
}

export type Buildings = Record<BuildingType, number>
export type UnitCounts = Record<UnitType, number>

export interface RegionState {
  id: RegionId
  owner: NationId
  population: number
  buildings: Buildings
  /** Turns of remaining sabotage (factories produce nothing). */
  sabotaged: number
  /** Strength of a rebel insurgency (in infantry divisions). */
  rebels: number
}

export interface General {
  id: string
  name: string
  trait: GeneralTrait
}

export interface Army {
  id: string
  owner: NationId
  location: RegionId
  units: UnitCounts
  generalId: string | null
  outOfSupplyTurns: number
}

export interface Resources {
  capital: number
  food: number
  pp: number
  tp: number
}

export interface Nation {
  id: NationId
  name: string
  color: string
  capital: RegionId
  originalCapital: RegionId
  isPlayer: boolean
  alive: boolean
  resources: Resources
  /** Available military manpower pool, in thousands. */
  militaryPool: number
  taxRate: number
  draftRate: number
  stability: number
  warWeariness: number
  techs: string[]
  laws: LawId[]
  generals: General[]
  foodShortage: boolean
  inDebt: boolean
  /** Turn number until which this nation can see the given nation's armies. */
  vision: Record<NationId, number>
  aggression: number
}

export interface PeaceOffer {
  from: NationId
  to: NationId
  turn: number
}

export type EventEffect =
  | { type: 'resource'; key: keyof Resources; amount: number; perWorkforce?: number }
  | { type: 'stability'; amount: number }
  | { type: 'militaryPool'; fraction: number }
  | { type: 'armyAttrition'; fraction: number }
  | { type: 'unlockRandomTech' }
  | { type: 'casusBelliForRival'; turns: number }
  | { type: 'spawnRebels'; strength: number }
  | { type: 'loseBuilding'; building: BuildingType }
  | { type: 'addBuilding'; building: BuildingType }
  | { type: 'popLoss'; fraction: number }
  | { type: 'warWeariness'; amount: number }

export interface PendingEvent {
  eventId: string
  turn: number
  rivalId: NationId | null
  regionId: RegionId | null
}

export type Order =
  | { type: 'setPolicy'; nationId: NationId; taxRate: number; draftRate: number }
  | { type: 'build'; nationId: NationId; regionId: RegionId; building: BuildingType }
  | { type: 'recruit'; nationId: NationId; regionId: RegionId; unit: UnitType }
  | { type: 'research'; nationId: NationId; techId: string }
  | { type: 'move'; nationId: NationId; armyId: string; to: RegionId }
  | { type: 'attack'; nationId: NationId; armyId: string; target: RegionId }
  | { type: 'assignGeneral'; nationId: NationId; armyId: string; generalId: string | null }
  | { type: 'declareWar'; nationId: NationId; target: NationId }
  | { type: 'offerPeace'; nationId: NationId; target: NationId }
  | { type: 'acceptPeace'; nationId: NationId; target: NationId }
  | { type: 'offerPact'; nationId: NationId; target: NationId }
  | { type: 'spy'; nationId: NationId; target: RegionId; mission: SpyMission }
  | { type: 'enactLaw'; nationId: NationId; law: LawId }
  | { type: 'repealLaw'; nationId: NationId; law: LawId }
  | { type: 'suppressRebels'; nationId: NationId; regionId: RegionId }

export interface BattleSide {
  nationId: NationId
  units: UnitCounts
  losses: UnitCounts
}

export interface BattleRound {
  name: string
  attackerDamage: number
  defenderDamage: number
}

export interface BattleReport {
  id: string
  turn: number
  regionId: RegionId
  /** Region the attack was launched from (null for rebel uprisings). */
  fromRegionId: RegionId | null
  attacker: BattleSide
  defender: BattleSide
  rounds: BattleRound[]
  winner: 'attacker' | 'defender'
  captured: boolean
  modifiers: string[]
}

export type LogKind = 'info' | 'war' | 'battle' | 'tech' | 'economy' | 'event' | 'spy' | 'diplomacy'

export interface LogEntry {
  turn: number
  kind: LogKind
  text: string
  nations: NationId[]
}

export interface GameSettings {
  victoryShare: number
  seed: number
}

export interface GameState {
  turn: number
  seed: number
  settings: GameSettings
  playerId: NationId
  nations: Record<NationId, Nation>
  regions: Record<RegionId, RegionState>
  armies: Record<string, Army>
  /** Sorted "a|b" keys. */
  wars: string[]
  /** Sorted "a|b" key -> turn the pact expires. */
  pacts: Record<string, number>
  /** "holder|target" -> turn the casus belli expires. */
  casusBelli: Record<string, number>
  peaceOffers: PeaceOffer[]
  pendingEvent: PendingEvent | null
  nextEventTurn: number
  battles: BattleReport[]
  log: LogEntry[]
  nextId: number
  outcome: 'playing' | 'victory' | 'defeat'
}
