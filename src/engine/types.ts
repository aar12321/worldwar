import type { AgencyId, DomesticOp, ForeignOp } from '../data/agencies'
import type { SystemId } from '../data/systems'
import type { Commit, Stance } from '../data/war'
export type Terrain = 'plains' | 'forest' | 'mountain' | 'desert' | 'urban'
export type RegionId = string
export type NationId = string
/** Planes are two types: fighters win the air, bombers (`air`) strike the ground. */
/** Drones, robot infantry and hypersonic batteries are the Frontier units. They need no soldiers. */
export type UnitType = 'infantry' | 'armor' | 'artillery' | 'fighter' | 'air' | 'naval' | 'drone' | 'robot' | 'missile'
export type BuildingType = 'factory' | 'farm' | 'university' | 'barracks' | 'port' | 'civic'
export type TechBranch = 'land' | 'air' | 'naval' | 'infra' | 'economy' | 'frontier'
export type LawId =
  | 'martial_law'
  | 'war_economy'
  | 'conscription_act'
  | 'free_trade'
  | 'rationing'
  | 'universal_healthcare'
  | 'industrial_policy'
  | 'press_control'
  | 'austerity'
  | 'research_grants'
export type SectorId = 'farming' | 'energy' | 'manufacturing' | 'arms' | 'technology' | 'finance'
export type CityFocus = 'balanced' | 'industry' | 'farming' | 'harbor' | 'research' | 'fortress' | 'finance'
export type GovernmentType = 'democracy' | 'monarchy' | 'junta' | 'one_party'
/** Where tax money goes. Each share is 0 to 1 and the four add up to 1. */
export type BudgetKey = 'military' | 'education' | 'health' | 'infrastructure'
export type Budget = Record<BudgetKey, number>
export type GeneralTrait = 'mountaineer' | 'logistician' | 'blitz' | 'air_marshal' | 'stalwart'
export type SpyMission = 'sabotage'

export interface Agency {
  level: number
  /** Experience from successful operations. */
  exp: number
}

export type Difficulty = 'easy' | 'normal' | 'hard'
export type Personality = 'expansionist' | 'trader' | 'turtle' | 'opportunist' | 'honorable'
export type TradeResource = 'capital' | 'food' | 'tp' | 'manpower' | 'oil' | 'steel' | 'goods'
/** The materials a nation holds beyond money and people. */
export type Material = 'oil' | 'steel' | 'goods'
/** First-game goals a player nation has reached. */
export type Milestone = 'build' | 'train' | 'research' | 'war' | 'win' | 'capture'
export type ProposalKind = 'peace' | 'pact' | 'alliance' | 'trade' | 'callToArms' | 'loan' | 'guarantee'

export const UNIT_TYPES: UnitType[] = ['infantry', 'armor', 'artillery', 'fighter', 'air', 'naval', 'drone', 'robot', 'missile']
export const BUILDING_TYPES: BuildingType[] = ['factory', 'farm', 'university', 'barracks', 'port', 'civic']
export const TRADE_RESOURCES: TradeResource[] = ['capital', 'food', 'tp', 'manpower', 'oil', 'steel', 'goods']
export const MATERIALS_LIST: Material[] = ['oil', 'steel', 'goods']

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

/** A city inside a country. It grows with money and takes a focus that boosts the country. */
export interface City {
  id: string
  name: string
  /** 1 to 5. */
  level: number
  focus: CityFocus
  port: boolean
  lat?: number
  lng?: number
}

export type Governor = 'off' | 'growth' | 'industry' | 'farming' | 'research' | 'military'

export interface RegionState {
  id: RegionId
  /** An official who upgrades this country each month on a plan the player chose. */
  governor?: Governor
  owner: NationId
  population: number
  buildings: Buildings
  /** Turns of remaining sabotage (factories produce nothing). */
  sabotaged: number
  /** Strength of a rebel insurgency (in infantry divisions). */
  rebels: number
  /** Defense Line: points of resistance left. At 0 the country falls. */
  line: number
  /** 0 when just conquered, 1 when fully part of the nation. Scales its output. */
  integration: number
  /** Last turn an enemy attacked this country. It heals only in quiet months. */
  attackedTurn: number
  cities: City[]
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
  /** Turn of this nation's last attack. */
  lastAttackTurn: number
  /** Attacks made on `lastAttackTurn`. */
  attacksThisTurn: number
  /** Share of the military committed this turn (0 to 1). Those units defend at half strength until the turn ends. */
  exposed: number
}

export interface Resources {
  capital: number
  food: number
  pp: number
  tp: number
  /** Fuel for tanks, planes and warships. */
  oil: number
  /** What vehicles are built from. */
  steel: number
  /** What your people buy. Running out costs stability. */
  goods: number
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
  government: GovernmentType
  budget: Budget
  /** Tax on private businesses, 0 to 0.4. */
  corporateTax: number
  /** Turn of the next election, or 0 when the government holds none. */
  nextElection: number
  /** Turn the form of government last changed. */
  lastReform: number
  /** The nation that rules this one as a puppet, if any. */
  overlord: NationId | null
  agencies: { foreign: Agency; domestic: Agency }
  /** Frontier systems, each from 0 to 3. */
  systems: Record<SystemId, number>
  /** The turn of the last strike from afar and the last orbital strike, for the cooldowns. */
  lastStrike: number
  lastOrbital: number
  /** The turn until which foreign operations against this nation are harder. */
  secureUntil: number
  /** The turn it became a puppet, so a master can only annex one that has settled. */
  overlordSince?: number
  /** Size of each private business sector. */
  sectors: Record<SectorId, number>
  /** Sectors the state subsidizes: they cost money and grow faster. */
  subsidies: SectorId[]
  /** Bonds the state owes. Interest is paid every month. */
  debt: number
  /** Months in a row the treasury has been in the red with debt outstanding. */
  redMonths: number
  /** Turn until which no one will lend to this nation after a default. */
  defaultedUntil: number
  techs: string[]
  laws: LawId[]
  generals: General[]
  foodShortage: boolean
  /** No oil: vehicles fight at reduced strength. */
  oilShortage: boolean
  /** No goods: the people are unhappy. */
  goodsShortage: boolean
  /** Units moved through the world market this month. */
  tradeUsed: number
  /** Materials the country buys on its own to keep a small reserve. */
  autoBuy: TradeResource[]
  inDebt: boolean
  /** Consecutive months spent with negative Capital. */
  debtTurns: number
  /** Turn until which this nation's port trade is embargoed. */
  embargoedUntil: number
  aggression: number
  personality: Personality
  military: Military
  /** Goals of the guided first game this nation has reached. Only kept for players. */
  milestones?: Milestone[]
}

export type ResourceBundle = Partial<Record<TradeResource, number>>

export interface PeaceTerms {
  /** Regions that change hands; each goes to the side that does not currently own it. */
  cede: RegionId[]
  /** The loser becomes a puppet of the proposer instead of losing land. */
  puppet?: boolean
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
  | { kind: 'loan'; amount: number; months: number }
  | { kind: 'guarantee' }

export type Proposal = ProposalDraft & {
  id: string
  from: NationId
  to: NationId
  created: number
  /** Last turn on which the proposal can still be answered. */
  expires: number
}

export interface Pledge {
  from: NationId
  to: NationId
  until: number
}

/** Money one nation has put into another's business sector. It pays dividends until war or collapse. */
export interface Investment {
  id: string
  investor: NationId
  target: NationId
  sector: SectorId
  amount: number
}

export interface Deal {
  id: string
  kind: 'trade' | 'reparations' | 'loan'
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
  | { type: 'setPolicy'; nationId: NationId; taxRate: number; draftRate: number; corporateTax?: number; budget?: Budget }
  | { type: 'setGovernment'; nationId: NationId; government: GovernmentType }
  | { type: 'imposeSanctions'; nationId: NationId; target: NationId }
  | { type: 'liftSanctions'; nationId: NationId; target: NationId }
  | { type: 'releasePuppet'; nationId: NationId; target: NationId }
  | { type: 'developCity'; nationId: NationId; regionId: RegionId; cityId: string }
  | { type: 'setCityFocus'; nationId: NationId; regionId: RegionId; cityId: string; focus: CityFocus }
  | { type: 'fundSector'; nationId: NationId; sector: SectorId; amount: number }
  | { type: 'setSubsidies'; nationId: NationId; sectors: SectorId[] }
  | { type: 'issueBonds'; nationId: NationId; amount: number }
  | { type: 'repayDebt'; nationId: NationId; amount: number }
  | { type: 'invest'; nationId: NationId; target: NationId; sector: SectorId; amount: number }
  | { type: 'build'; nationId: NationId; regionId: RegionId; building: BuildingType }
  | { type: 'queueTrain'; nationId: NationId; unit: UnitType }
  | { type: 'cancelTrain'; nationId: NationId; jobId: string }
  | { type: 'train'; nationId: NationId; unit: UnitType }
  | { type: 'upgradeWeapons'; nationId: NationId; unit: UnitType }
  | { type: 'research'; nationId: NationId; techId: string }
  | { type: 'marketBuy'; nationId: NationId; resource: TradeResource; amount: number }
  | { type: 'marketSell'; nationId: NationId; resource: TradeResource; amount: number }
  | { type: 'setAutoBuy'; nationId: NationId; resources: TradeResource[] }
  | { type: 'attack'; nationId: NationId; target: RegionId; commit?: Commit; stance?: Stance; /** How many missiles to fire in this battle. Left out, a share of them fire with the force sent. */ missiles?: number }
  | { type: 'assignGeneral'; nationId: NationId; generalId: string | null }
  | { type: 'declareWar'; nationId: NationId; target: NationId }
  | { type: 'buildCase'; nationId: NationId; target: NationId }
  | { type: 'annexPuppet'; nationId: NationId; target: NationId }
  | { type: 'crisisAction'; nationId: NationId; crisisId: string; action: 'aid' | 'mediate' | 'support' }
  | { type: 'propose'; nationId: NationId; target: NationId; proposal: ProposalDraft }
  | { type: 'respond'; nationId: NationId; proposalId: string; accept: boolean }
  | { type: 'cancelDeal'; nationId: NationId; dealId: string }
  | { type: 'leaveAlliance'; nationId: NationId; target: NationId }
  | { type: 'spy'; nationId: NationId; target: RegionId; mission: SpyMission }
  | { type: 'operation'; nationId: NationId; op: ForeignOp; target: NationId }
  | { type: 'domestic'; nationId: NationId; op: DomesticOp; regionId?: RegionId }
  | { type: 'fundSystem'; nationId: NationId; system: SystemId; levels?: number }
  | { type: 'strike'; nationId: NationId; target: RegionId; weapon: 'missile' | 'orbital'; /** Missiles to fire in a hypersonic strike. */ count?: number }
  | { type: 'fundAgency'; nationId: NationId; agency: AgencyId; /** How many levels to buy at once. One if left out. */ levels?: number }
  | { type: 'setGovernor'; nationId: NationId; regionId: RegionId; governor: Governor }
  | { type: 'buyShares'; nationId: NationId; company: string; shares: number }
  | { type: 'sellShares'; nationId: NationId; company: string; shares: number }
  | { type: 'setDirective'; nationId: NationId; company: string; directive: Directive }
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
  /** Campaign detail. Missing on rebel fights. */
  commit?: Commit
  stance?: Stance
  lineBefore?: number
  lineAfter?: number
  lineMax?: number
}

export type LogKind = 'news' | 'info' | 'war' | 'battle' | 'tech' | 'economy' | 'event' | 'spy' | 'diplomacy'

export interface LogEntry {
  turn: number
  kind: LogKind
  text: string
  nations: NationId[]
}

export interface GameSettings {
  victoryShare: number
  /** 'world': the game ends when one player controls every country. 'classic': the older short goals, kept for tests and tools. */
  goal: 'world' | 'classic'
  seed: number
  difficulty: Difficulty
}

export interface Crisis {
  id: string
  kind: 'unrest' | 'dispute'
  /** The nation in trouble: the one in unrest, or the one threatened. */
  nation: NationId
  /** The nation threatening it, for a dispute. */
  rival: NationId | null
  area: string
  /** 0 rumor, 1 disturbance, 2 crisis. After that it ends one way or the other. */
  stage: number
  /** The turn the next thing happens. */
  next: number
  /** Chance that it boils over at the end. Help lowers it. */
  boil: number
  /** Nations that have answered it, so nobody pays twice. */
  answered: NationId[]
}

/** What a company has been told to do by the nation that controls it. */
export type Directive = 'payout' | 'expand' | 'focus'

export interface CompanyInfo {
  name: string
  sector: SectorId
  /** The country (region) it is based in. Whoever holds that country can invest in it. */
  home: RegionId
  /** That country's name, for messages. */
  country: string
  /** The price a share started at. Prices stay in a range around it. */
  base: number
}

export interface StockState {
  /** Every listed company: who it is, where it is based. */
  meta: Record<string, CompanyInfo>
  /** Share price of each listed company. */
  price: Record<string, number>
  /** Last month's price, to show the change. */
  last: Record<string, number>
  /** The home sector's size last month, to see whether it grew. */
  size: Record<string, number>
  /** Shares each nation holds: nation -> company -> shares. Only the nation that holds a company's country can hold its shares. */
  held: Record<NationId, Record<string, number>>
  /** What each company is doing. A company that is not listed here pays dividends. */
  directive: Record<string, Directive>
  /** The market's mood: a crash or boom that fades. */
  mood: number
  /** The whole exchange as one number, starting at 100. */
  index: number
}

export interface CaseFile {
  holder: NationId
  target: NationId
  /** The turn the case is ready. */
  ready: number
}

export interface GameState {
  turn: number
  seed: number
  settings: GameSettings
  /** The nation of the player at this screen. In online games each screen sets its own. */
  playerId: NationId
  /** Every nation a person plays. One in a single-player game, two to four online. */
  humans: NationId[]
  /** The human who won, once the game is won. */
  winner: NationId | null
  /** Humans knocked out of an online game. Their nations carry on under the AI. */
  eliminated: NationId[]
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
  /** "holder|target" -> what the reason for war is, shown to the player. */
  reasons: Record<string, string>
  /** How much each nation is distrusted for starting wars, taking land and covert acts. It fades. */
  infamy: Record<NationId, number>
  /** Cases being built against a country. When one is ready it becomes a reason for war. */
  cases: CaseFile[]
  /** "holder|target" -> the turn until which the holder can see the target's real numbers. */
  intel: Record<string, number>
  stocks: StockState
  /** Trouble building around the world. News of it comes in stages. */
  crises: Crisis[]
  /** Sorted "a|b" keys of defensive alliances. */
  alliances: string[]
  /** Proposals awaiting an answer from the player. */
  proposals: Proposal[]
  deals: Deal[]
  investments: Investment[]
  /** Trade sanctions: `from` is cutting off `to` until the turn given. */
  sanctions: Pledge[]
  /** Promises to defend a nation: `from` guards `to` until the turn given. */
  guarantees: Pledge[]
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
  /** Every nation's gross income added together, from the last turn. The base for the economic victory. */
  worldGross: number
}
