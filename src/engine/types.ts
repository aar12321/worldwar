export type Terrain = 'plains' | 'forest' | 'mountain' | 'desert' | 'urban'
export type RegionId = string
export type NationId = string
export type UnitType = 'infantry' | 'armor' | 'air' | 'naval'
export type BuildingType = 'factory' | 'farm' | 'university' | 'barracks' | 'port' | 'civic'
export type TechBranch = 'land' | 'air' | 'naval' | 'infra'
export type LawId = 'martial_law' | 'war_economy' | 'conscription_act'
export type GeneralTrait = 'mountaineer' | 'logistician' | 'blitz' | 'air_marshal' | 'stalwart'
export type SpyMission = 'sabotage'
export type Difficulty = 'easy' | 'normal' | 'hard'
export type Personality = 'expansionist' | 'trader' | 'turtle' | 'opportunist' | 'honorable'
export type TradeResource = 'capital' | 'food' | 'tp' | 'manpower'
export type ProposalKind = 'peace' | 'pact' | 'alliance' | 'trade' | 'callToArms'

export const UNIT_TYPES: UnitType[] = ['infantry', 'armor', 'air', 'naval']
export const BUILDING_TYPES: BuildingType[] = ['factory', 'farm', 'university', 'barracks', 'port', 'civic']
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

/** A unit in production. It joins the national military when it finishes. */
export interface TrainingJob {
  id: string
  nationId: NationId
  unit: UnitType
  remaining: number
  total: number
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
  /** Kept so older saves still load. It no longer changes combat or supply. */
  trait: GeneralTrait
}

/** A nation's whole armed force. */
export interface Military {
  units: UnitCounts
  /** Drill rank 0 to 5 for each unit type. */
  drill: Record<UnitType, number>
  /** Permanent weapon level 0 to 5 for each unit type. Raises attack and defense. */
  weapons: Record<UnitType, number>
  /** A commander drills the lowest-ranked unit type for free each month. */
  commanderId: string | null
  /** Turn of this nation's last attack. A nation may attack once per turn. */
  lastAttackTurn: number
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
  aggression: number
  personality: Personality
  military: Military
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
  | { type: 'queueTrain'; nationId: NationId; unit: UnitType }
  | { type: 'cancelTrain'; nationId: NationId; jobId: string }
  | { type: 'train'; nationId: NationId; unit: UnitType }
  | { type: 'upgradeWeapons'; nationId: NationId; unit: UnitType }
  | { type: 'research'; nationId: NationId; techId: string }
  | { type: 'attack'; nationId: NationId; target: RegionId }
  | { type: 'assignGeneral'; nationId: NationId; generalId: string | null }
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
  /** Damage the attacker dealt this round. */
  attackerDamage: number
  /** Damage the defender dealt this round. */
  defenderDamage: number
  /** Units each side lost this round. */
  attackerLosses: UnitCounts
  defenderLosses: UnitCounts
}

export interface BattleReport {
  id: string
  turn: number
  regionId: RegionId
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
  /** Units in production. The front jobs advance each month, up to the nation's training slots. */
  trainingQueue: TrainingJob[]
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
  /** Turn when the next surprise decision may appear. New games wait until turn 21. */
  nextEventTurn: number
  battles: BattleReport[]
  log: LogEntry[]
  nextId: number
  outcome: 'playing' | 'victory' | 'defeat'
}
