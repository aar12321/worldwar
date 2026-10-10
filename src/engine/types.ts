export type Terrain = 'plains' | 'forest' | 'mountain' | 'desert' | 'urban'
export type RegionId = string
export type NationId = string
export type UnitType = 'infantry' | 'armor' | 'air' | 'naval'
export type BuildingType = 'factory' | 'farm' | 'university' | 'barracks' | 'port' | 'depot'
export type TechBranch = 'land' | 'air' | 'naval' | 'infra'
export type LawId = 'martial_law' | 'war_economy' | 'conscription_act'
export type GeneralTrait = 'mountaineer' | 'logistician' | 'blitz' | 'air_marshal' | 'stalwart'
export type SpyMission = 'sabotage' | 'stealVision'
export type Difficulty = 'easy' | 'normal' | 'hard'
export type Personality = 'expansionist' | 'trader' | 'turtle' | 'opportunist' | 'honorable'
export type TradeResource = 'capital' | 'food' | 'tp' | 'manpower'
export type ProposalKind = 'peace' | 'pact' | 'alliance' | 'trade' | 'callToArms' | 'arms'

export const UNIT_TYPES: UnitType[] = ['infantry', 'armor', 'air', 'naval']
export const BUILDING_TYPES: BuildingType[] = ['factory', 'farm', 'university', 'barracks', 'port', 'depot']
export const TRADE_RESOURCES: TradeResource[] = ['capital', 'food', 'tp', 'manpower']

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

/** A muster ground inside a country. Armies are raised and trained here. */
export interface Territory {
  id: string
  regionId: RegionId
  name: string
  lat: number
  lng: number
  /** 0 is the heartland muster, where the starting army is based. */
  index: number
}

export interface WorldMap {
  regions: Record<RegionId, MapRegion>
  order: RegionId[]
  territories: Record<string, Territory>
  territoriesByRegion: Record<RegionId, string[]>
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
  /** Consecutive months the army has held its position (capped at 3). */
  entrenched: number
  /** Muster this army is raised from. Empty when it has no base. */
  homeTerritoryId: string
  /** 0–5. Each rank adds combat power. */
  training: number
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
  /** Consecutive months spent with negative Capital. */
  debtTurns: number
  /** Turn until which this nation's port trade is embargoed. */
  embargoedUntil: number
  /** Turn number until which this nation can see the given nation's armies. */
  vision: Record<NationId, number>
  aggression: number
  personality: Personality
  /** Live weapons contracts. One per unit type. */
  contracts: ArmsContract[]
}

export interface ArmsContract {
  id: string
  unit: UnitType
  /** 1–3. Each tier is +10% attack for this unit type. */
  tier: number
  /** Nation selling the weapons, or null for domestic industry. */
  supplier: NationId | null
  /** Last turn the bonus applies. */
  until: number
  /** Capital the buyer pays the supplier each month. 0 for domestic contracts. */
  payPerMonth: number
}

export interface ArmsTerms {
  unit: UnitType
  tier: number
  months: number
  payPerMonth: number
  /** One of the two parties. The other pays. */
  seller: NationId
}

export type ResourceBundle = Partial<Record<TradeResource, number>>

export interface PeaceTerms {
  /** Regions that change hands; each goes to the side that does not currently own it. */
  cede: RegionId[]
  /** Capital per month for REPARATION_MONTHS. Positive: the target pays the proposer. Negative: the proposer pays. */
  reparations: number
}

export interface TradeTerms {
  /** What the proposer hands over. */
  give: ResourceBundle
  /** What the proposer asks for in return. */
  receive: ResourceBundle
  /** 0 for a one-off exchange, otherwise the amounts change hands every month for this many months. */
  months: number
}

export type ProposalDraft =
  | { kind: 'peace'; terms: PeaceTerms }
  | { kind: 'pact' }
  | { kind: 'alliance' }
  | { kind: 'trade'; terms: TradeTerms }
  | { kind: 'callToArms'; enemy: NationId }
  | { kind: 'arms'; terms: ArmsTerms }

export type Proposal = ProposalDraft & {
  id: string
  from: NationId
  to: NationId
  created: number
  /** Last turn on which the proposal can still be answered. */
  expires: number
}

export interface Deal {
  id: string
  kind: 'trade' | 'reparations'
  from: NationId
  to: NationId
  /** Paid by `from` to `to` every month. */
  give: ResourceBundle
  /** Paid by `to` to `from` every month. */
  receive: ResourceBundle
  /** Last turn on which the deal pays out. */
  until: number
}

export interface OpinionModifier {
  label: string
  value: number
  /** Amount the modifier fades toward zero each month. */
  decay: number
}

export type DispatchKind = 'proposal' | 'accepted' | 'rejected' | 'joined' | 'ignored' | 'broken' | 'expired' | 'completed'

export interface Dispatch {
  kind: DispatchKind
  from: NationId
  to: NationId
  proposalKind: ProposalKind | 'deal' | 'war'
  text: string
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
  /** Changes the rival's opinion of the player. */
  | { type: 'opinion'; amount: number; label: string }
  /** Gives (or takes) resources from the rival. */
  | { type: 'rivalResource'; key: keyof Resources; amount: number; perWorkforce?: number }
  | { type: 'clearCasusBelli' }
  | { type: 'embargo'; turns: number }

export interface PendingEvent {
  eventId: string
  turn: number
  rivalId: NationId | null
  regionId: RegionId | null
}

export type Order =
  | { type: 'setPolicy'; nationId: NationId; taxRate: number; draftRate: number }
  | { type: 'build'; nationId: NationId; regionId: RegionId; building: BuildingType }
  | { type: 'recruit'; nationId: NationId; territoryId: string; unit: UnitType }
  | { type: 'train'; nationId: NationId; armyId: string }
  | { type: 'rebase'; nationId: NationId; armyId: string; territoryId: string }
  | { type: 'signContract'; nationId: NationId; unit: UnitType; tier: number }
  | { type: 'research'; nationId: NationId; techId: string }
  | { type: 'move'; nationId: NationId; armyId: string; to: RegionId }
  | { type: 'attack'; nationId: NationId; armyId: string; target: RegionId }
  | { type: 'assignGeneral'; nationId: NationId; armyId: string; generalId: string | null }
  | { type: 'declareWar'; nationId: NationId; target: NationId }
  | { type: 'propose'; nationId: NationId; target: NationId; proposal: ProposalDraft }
  | { type: 'respond'; nationId: NationId; proposalId: string; accept: boolean }
  | { type: 'cancelDeal'; nationId: NationId; dealId: string }
  | { type: 'leaveAlliance'; nationId: NationId; target: NationId }
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
  difficulty: Difficulty
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
  /** Sorted "a|b" keys of defensive alliances. */
  alliances: string[]
  /** Proposals awaiting an answer from the player. */
  proposals: Proposal[]
  deals: Deal[]
  /** "a>b" -> war score a has earned against b (0..100). */
  warScore: Record<string, number>
  /** Sorted "a|b" -> turn the war started. */
  warStarted: Record<string, number>
  /** "holder>target" -> remembered grievances and favours. */
  opinions: Record<string, OpinionModifier[]>
  /** "from>to:kind" -> last turn that proposal was made, so bots do not spam. */
  proposalMemory: Record<string, number>
  /** Diplomatic outcomes from the most recent turn. */
  dispatches: Dispatch[]
  pendingEvent: PendingEvent | null
  nextEventTurn: number
  battles: BattleReport[]
  log: LogEntry[]
  nextId: number
  outcome: 'playing' | 'victory' | 'defeat'
}
