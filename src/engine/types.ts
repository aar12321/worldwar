import type { AgencyId, DomesticOp, ForeignOp } from '../data/agencies'
import type { AircraftNodeId } from '../data/aircraft'
import type { SystemId } from '../data/systems'
import type { ScenarioGoal } from '../data/scenarios'
import type { SpaceAction, SpaceState, SpaceWorld } from '../data/space'
import type { Commit, Stance } from '../data/war'
export type Terrain = 'plains' | 'forest' | 'mountain' | 'desert' | 'urban'
export type RegionId = string
export type NationId = string
/** Planes are two types: fighters win the air, bombers (`air`) strike the ground. */
/** Drones, robot infantry and hypersonic batteries are the Frontier units. They need no soldiers. */
export type UnitType = 'infantry' | 'armor' | 'artillery' | 'fighter' | 'air' | 'naval' | 'drone' | 'robot' | 'missile'
export type BuildingType = 'factory' | 'farm' | 'university' | 'barracks' | 'port' | 'civic' | 'hospital'
export type TechBranch = 'land' | 'air' | 'naval' | 'infra' | 'economy' | 'frontier' | 'medicine'
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
/** The old zero-sum budget, kept so older saves can be read and turned into spending levels. */
export type BudgetKey = 'military' | 'education' | 'health' | 'infrastructure'
export type Budget = Record<BudgetKey, number>

// ---- Statecraft: people, money, industry and empire ----

/** The five kinds of workers a country has. Their shares add up to 1. */
export type SkillKey = 'basic' | 'skilled' | 'engineers' | 'doctors' | 'scientists'
export const SKILL_KEYS: SkillKey[] = ['basic', 'skilled', 'engineers', 'doctors', 'scientists']
export type SchoolStage = 'primary' | 'secondary' | 'university'
export type SchoolFocus = 'balanced' | 'trades' | 'engineering' | 'medicine' | 'science' | 'business'
export type ImmigrationPolicy = 'closed' | 'normal' | 'selective' | 'open'
export type OccupationPolicy = 'standard' | 'autonomy' | 'assimilate' | 'settle'
export type ArmsExports = 'off' | 'friends' | 'anyone'
export type ProjectId =
  | 'rail' | 'grid' | 'ports' | 'sciencePark' | 'medCentre' | 'digitalGov' | 'spaceComplex'
  | 'waterNetwork' | 'stadium' | 'broadband' | 'grainReserve' | 'openUniversity' | 'expo' | 'aiLab' | 'fusion' | 'plannedCity' | 'marsMission'
/** A project built in one country of an empire, not by the nation as a whole. */
export type LocalProjectId = 'industrialPark' | 'techHub' | 'irrigation' | 'dam' | 'resort' | 'culturalCentre' | 'fortress' | 'sez' | 'mine'
export type ResearchTrack = 'productivity' | 'medicine' | 'weapons'
/** The standing programs a government runs for its people (see `data/society.ts`). */
export type SocialId =
  | 'clinics' | 'cleanWater' | 'mentalHealth' | 'elderCare'
  | 'schoolMeals' | 'scholarships' | 'apprenticeships' | 'libraries'
  | 'minimumWage' | 'jobsGuarantee' | 'smallLoans' | 'workerRights'
  | 'childBenefit' | 'parentalLeave' | 'foodAid' | 'transit'
  | 'policing' | 'courts' | 'integration' | 'festivals' | 'broadcasting' | 'surveillance'
/** The kinds of missile. Hypersonic ones are the military's `missile` stock; the rest are the nation's `arsenal`. */
export type MissileType = 'cruise' | 'tactical' | 'hypersonic' | 'ballistic'
export type CampaignId = 'celebration' | 'vaccination' | 'literacy' | 'jobFair' | 'unityTour' | 'foodBank' | 'babyBonus'
/** 1 Nation, 2 Regional power, 3 Great power, 4 Superpower, 5 Hegemon. */
export type Tier = 1 | 2 | 3 | 4 | 5

/** What a puppet pays its master: a share of its income, of its oil or steel, or of its soldiers. */
export type TributeForm = 'money' | 'oil' | 'steel' | 'levy'

/** What a master may change about a puppet in one order (once a month). Every part is optional; at least one must change something. */
export interface PuppetPatch {
  taxRate?: number
  draftRate?: number
  /** Enact (`on`) or repeal one law. */
  law?: { id: LawId; on: boolean }
  /** New levels for some of the puppet's spending lines. */
  spending?: Partial<Spending>
  tribute?: { form: TributeForm; share: number }
  /** Money sent to the puppet as aid; it buys loyalty. */
  aid?: number
}

/** Real money a nation spends on its people each month. Schools, health and public works go 0 to 4 (2 is standard); welfare goes 0 to 2. */
export interface Spending {
  schools: number
  health: number
  works: number
  pensions: number
  jobless: number
  housing: number
}
export type SpendingKey = keyof Spending

/** Standing choices a nation makes about how it is run. */
export interface Programs {
  stage: SchoolStage
  focus: SchoolFocus
  immigration: ImmigrationPolicy
  occupation: OccupationPolicy
  armsExports: ArmsExports
  quarantine: boolean
  /** The business sector the banks are told to lend to, if any. */
  creditSector: SectorId | null
}

export interface People {
  skills: Record<SkillKey, number>
  /** How well schooled the people are, 0 to 1. */
  schooling: number
  /** How healthy the people are, 0 to 1. */
  health: number
  /** Share of the workforce without a job. */
  unemployment: number
  /** How specialized the schools have made the people in their focus, 0 to 1. */
  specialization: number
  /** Turn the school focus last changed. Specialization starts again from nothing. */
  focusSince: number
  /** How bad an epidemic is, 0 when there is none. */
  epidemic: number
  /** Last month's people moving in (positive) or out, as a share of the population. */
  migration: number
}

export interface Bank {
  /** The central bank's interest rate, in percent a year. */
  rate: number
  /** Price rises, in percent a year. */
  inflation: number
  /** Strength of the currency against the world's, 1 is even. */
  currency: number
  /** Money printed this month, as a share of a month's income. */
  printed: number
  /** The sovereign wealth fund. */
  fund: number
  /** War bonds sold in the present wars, and the stability they have bought. */
  warBonds: number
  warBondStability: number
}

/** A bond the state owes: a fixed monthly rate until it comes due. */
export interface Bond {
  id: string
  amount: number
  /** Monthly interest. */
  rate: number
  /** Turn it comes due. */
  due: number
  /** Months it ran for, to roll it over for as long again. */
  term: number
  war?: boolean
}

/** One social program: the level chosen, how far its effect has phased in toward it, and the month it was last changed. */
export interface SocialState {
  level: number
  strength: number
  changed: number
}

/** A campaign: months of effect left, and months until it can be run again. */
export interface CampaignState {
  left: number
  cooldown: number
}

/** One aircraft development: months of work done, whether it is finished, and whether the work is on hold (which frees its slot). */
export interface AircraftState {
  progress: number
  done: boolean
  paused?: boolean
}

export interface ProjectState {
  /** Months of work done on the level being built. */
  progress: number
  /** True once the level being built is finished. While an upgrade is under way it is false, and the earlier levels keep working. */
  done: boolean
  paused?: boolean
  /** Levels finished, once there is more than one or an upgrade has begun. Missing means 1 when `done`, 0 otherwise. */
  level?: number
  /** The month a rush last bought time on this project: one rush a month. */
  rushed?: number
  /** Projects in a country: the nation that began it, so a half-built project is not inherited by a conqueror. */
  by?: NationId
}

/** What everyone can see about the world economy, worked out once a month. */
export interface WorldStats {
  /** Average interest rate, weighted by income. */
  rate: number
  inflation: number
  /** The median living standard, to compare a country's against. */
  living: number
  /** The nation whose money the world trades in, if any. */
  reserve: NationId | null
  /** The stock exchange's index last month, to see how it moved. */
  lastIndex: number
}
export type GeneralTrait = 'mountaineer' | 'logistician' | 'blitz' | 'air_marshal' | 'stalwart'

export interface Agency {
  level: number
  /** Experience from successful operations. Only the foreign agency's counts (it raises the odds); the domestic count is kept for old saves and is not shown. */
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
export const BUILDING_TYPES: BuildingType[] = ['factory', 'farm', 'university', 'barracks', 'port', 'civic', 'hospital']
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
  /** Projects built in this country (industrial parks, dams, resorts...). They stay with the land if it is conquered. */
  works?: Partial<Record<LocalProjectId, ProjectState>>
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
  /** Months of devastation still to run after a nuclear strike: its output stays crippled and heals as they pass. Absent when there is none. */
  fallout?: number
  cities: City[]
}

export interface General {
  id: string
  name: string
  /** What the commander is good at, when appointed: mountains, logistics, blitz, air power or defense. */
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
  /** Where the forces stand guard: patrols, the submarine screen, border garrisons. Absent until the nation sets a posture. */
  deployment?: Deployment
}

/**
 * A standing posture: shares of each arm on station (see `engine/deployment.ts`). What is not on station is the reserve, the only
 * part that can be sent to attack. Everything on station still costs upkeep and oil, and still defends, best at its own post.
 */
export interface Deployment {
  /** Share of the warships on coastal patrol, 0 to 1. */
  coastal: number
  /** Share of the warships in the submarine screen. `coastal` and `subs` add up to at most 1. */
  subs: number
  /** Share of the fighters and drones flying air patrols. */
  air: number
  /** Share of the ground forces (infantry, tanks, artillery, robots) on the border with each neighboring nation. All the shares add up to at most 1. */
  border: Record<NationId, number>
  /** The month the posture last changed. It can change once a month. */
  changed: number
  /** How many of the nation's countries lie along each border it garrisons, as of the last month's upkeep. Spares the map a search every time. */
  fronts?: Record<NationId, number>
}

/** What a pair of neighbors remember about their border: incidents, and who has closed it. Absent until something happens. */
export interface BorderRecord {
  /** Heat from border incidents as it stood in month `at`. It fades every month. */
  heat?: number
  at?: number
  /** Border incidents so far. */
  incidents?: number
  /** Nations that have closed this border. */
  closedBy?: NationId[]
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
  /** Older saves only: the zero-sum budget, turned into spending levels when the game loads. */
  budget?: Budget
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
  /** The turn of the last orbital strike, for its cooldown. */
  lastOrbital: number
  /** The turn until which foreign operations against this nation are harder. */
  secureUntil: number
  /** The turn it became a puppet, so a master can only annex one that has settled. */
  overlordSince?: number
  /**
   * Puppets only: how loyal the puppet is to its master, 0 to 100 (see `engine/puppets.ts`). Absent on a puppet made before loyalty
   * existed, which keeps the old flat rules until its master first rules it, and on every nation that is not a puppet.
   */
  loyalty?: number
  /** Puppets only: the form and share of the tribute the master takes. Absent means the old 12% of income in money. */
  tribute?: { form: TributeForm; share: number }
  /** Puppets only: the month the master last changed the puppet's rules (once a month). */
  ruledAt?: number
  /** Puppets only: the month the puppet last called on the world for help against its master. */
  calledOut?: number
  /** Turn of the last corruption sweep. Stolen money takes time to build up again. */
  lastSweep?: number
  /** Size of each private business sector. */
  sectors: Record<SectorId, number>
  /** Sectors the state subsidizes: they cost money and grow faster. */
  subsidies: SectorId[]
  /** Bonds the state owes, the sum of `bonds`. Interest is paid every month. */
  debt: number
  bonds: Bond[]
  spending: Spending
  programs: Programs
  people: People
  bank: Bank
  /** Business sectors the state owns, and the turn until which business distrusts it after a seizure. */
  stateOwned: SectorId[]
  seizedUntil: number
  projects: Partial<Record<ProjectId, ProjectState>>
  /** The space agency: talent, rockets, flights, labs, outposts. Absent until the first space order, so a nation that never uses it is unchanged. */
  space?: SpaceState
  /** Cruise, tactical and ballistic missiles in store (hypersonic ones are `military.units.missile`). */
  arsenal?: Partial<Record<MissileType, number>>
  /** The missile program's level, 0 to 3. */
  missileProgram?: number
  /** Missiles built so far in the month `turn`, against the program's capacity. */
  missileBuilt?: { turn: number; count: number }
  /** The last month each nation struck this one with missiles, so it can answer. */
  struckBy?: Record<NationId, number>
  /** The kind of missile each of them last struck this nation with, so it can answer in kind. */
  struckWith?: Record<NationId, MissileType>
  /** The nuclear program of a Superpower: warheads in store and under construction. Absent until the first one is ordered. */
  nuclear?: NuclearState
  /** Aircraft developments begun or finished (see `data/aircraft.ts`). Absent until the first one is started, so a nation that never uses them is unchanged. */
  aircraft?: Partial<Record<AircraftNodeId, AircraftState>>
  /** Social programs in force. Absent until the first one is set, so a nation that never uses them is unchanged. */
  social?: Partial<Record<SocialId, SocialState>>
  /** Campaigns running or cooling down. Absent until the first one is run. */
  campaigns?: Partial<Record<CampaignId, CampaignState>>
  /** Military academy level, 0 to 3. */
  academy: number
  /** Levels bought in each future research program. */
  research2: Record<ResearchTrack, number>
  /** Empire tier, from the countries held. */
  tier: Tier
  regionalCapitals: RegionId[]
  /** Turn the capital last moved, and the last World Council resolution. */
  capitalMoved: number
  lastResolution: number
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
  /** A general peace: allies and puppets of each side who are fighting the other side stop too, with the same truce. */
  general?: boolean
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
  /** A live contract: months to wait before the first delivery. */
  start?: number
  /** A live contract: money the proposer posts. It comes back when the contract is fulfilled and goes to the other side if the proposer breaks it. */
  collateral?: number
  /** A live contract: the other nation joins every war the proposer fights, for as long as it runs. */
  joinWars?: boolean
}

export type ProposalDraft =
  | { kind: 'peace'; terms: PeaceTerms }
  | { kind: 'pact' }
  | { kind: 'alliance' }
  | { kind: 'trade'; terms: TradeTerms }
  | { kind: 'callToArms'; enemy: NationId }
  | { kind: 'loan'; amount: number; months: number; /** A World Bank loan from a superpower: the borrower signs a pact for the loan's length. */ pact?: boolean }
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
  /** Present on a live contract (a trade with a start, collateral or a duty to join wars). Absent on every other deal. */
  contract?: ContractInfo
}

/** What makes a deal a live contract: when it starts, the collateral held for it, and the duty to join wars. */
export interface ContractInfo {
  /** First turn it pays out. */
  start: number
  /** Collateral the poster put up, held until the contract ends. */
  held: number
  poster: NationId
  /** The nation that must join every war of the other side while it runs. */
  joins?: NationId
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

/** One month of a nation's numbers, for the Statistics charts and the monthly report. */
export interface HistoryPoint {
  turn: number
  nation: NationId
  money: number
  income: number
  power: number
  countries: number
  stability: number
  population: number
  schooling: number
  inflation: number
  unemployment: number
  rank: number
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
  | { type: 'people'; key: 'health' | 'schooling' | 'unemployment' | 'specialization'; amount: number }
  | { type: 'bank'; key: 'inflation' | 'currency'; amount: number }
  | { type: 'epidemic'; severity: number }
  | { type: 'skills'; from: SkillKey; to: SkillKey; amount: number }
  | { type: 'projectProgress'; months: number }

export interface PendingEvent {
  eventId: string
  turn: number
  rivalId: NationId | null
  regionId: RegionId | null
}

export type Order =
  | { type: 'setPolicy'; nationId: NationId; taxRate: number; draftRate: number; corporateTax?: number; spending?: Spending; /** Older saved orders only. */ budget?: Budget }
  | { type: 'setPrograms'; nationId: NationId; programs: Partial<Programs>; rate?: number }
  | { type: 'printMoney'; nationId: NationId; share: number }
  | { type: 'wealthFund'; nationId: NationId; amount: number }
  | { type: 'setStateOwned'; nationId: NationId; sector: SectorId; mode: 'buy' | 'seize' | 'sell' }
  /** Starts a project, or the next level of a built one. A project of a country (`LocalProjectId`) says which with `regionId`. */
  | { type: 'startProject'; nationId: NationId; project: ProjectId | LocalProjectId; regionId?: RegionId }
  | { type: 'pauseProject'; nationId: NationId; project: ProjectId | LocalProjectId; paused: boolean; regionId?: RegionId }
  /** Pays extra to finish the level under way sooner. Once a month for each project. */
  | { type: 'rushProject'; nationId: NationId; project: ProjectId | LocalProjectId; regionId?: RegionId }
  | { type: 'moveCapital'; nationId: NationId; regionId: RegionId }
  | { type: 'setRegionalCapital'; nationId: NationId; regionId: RegionId; on: boolean }
  | { type: 'fundAcademy'; nationId: NationId }
  | { type: 'researchProgram'; nationId: NationId; track: ResearchTrack }
  | { type: 'resolution'; nationId: NationId; kind: ResolutionKind; target?: NationId; target2?: NationId }
  | { type: 'setGovernment'; nationId: NationId; government: GovernmentType }
  | { type: 'imposeSanctions'; nationId: NationId; target: NationId }
  | { type: 'liftSanctions'; nationId: NationId; target: NationId }
  | { type: 'releasePuppet'; nationId: NationId; target: NationId }
  | { type: 'developCity'; nationId: NationId; regionId: RegionId; cityId: string }
  | { type: 'setCityFocus'; nationId: NationId; regionId: RegionId; cityId: string; focus: CityFocus }
  | { type: 'fundSector'; nationId: NationId; sector: SectorId; amount: number }
  | { type: 'setSubsidies'; nationId: NationId; sectors: SectorId[] }
  | { type: 'issueBonds'; nationId: NationId; amount: number; /** Months until it comes due: 12, 36 or 60. */ term?: number; /** War bonds: sold to the people in wartime, outside normal credit. */ war?: boolean }
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
  | { type: 'attack'; nationId: NationId; target: RegionId; commit?: Commit; stance?: Stance; /** How many hypersonic missiles to fire in this battle. Left out, none: an attack never carries missiles it was not told to. */ missiles?: number; /** A share of the military to send (0.05 to 1), in place of the Probe, Main force and All in presets. */ share?: number; /** The coalition strike this attack belongs to: in a live game every attack of one strike leaves on the same day. */ joint?: string }
  | { type: 'assignGeneral'; nationId: NationId; generalId: string | null }
  | { type: 'declareWar'; nationId: NationId; target: NationId }
  | { type: 'buildCase'; nationId: NationId; target: NationId }
  | { type: 'annexPuppet'; nationId: NationId; target: NationId }
  /** A master rules its puppet: tax, draft, a law, spending, the form of the tribute, aid. Once a month for each puppet, at the month's end. */
  | { type: 'governPuppet'; nationId: NationId; target: NationId; patch: PuppetPatch }
  | { type: 'crisisAction'; nationId: NationId; crisisId: string; action: 'aid' | 'mediate' | 'support' }
  | { type: 'propose'; nationId: NationId; target: NationId; proposal: ProposalDraft }
  | { type: 'respond'; nationId: NationId; proposalId: string; accept: boolean }
  | { type: 'cancelDeal'; nationId: NationId; dealId: string }
  | { type: 'leaveAlliance'; nationId: NationId; target: NationId }
  /** Tears up a non-aggression pact, at a cost in reputation. */
  | { type: 'breakPact'; nationId: NationId; target: NationId }
  | { type: 'operation'; nationId: NationId; op: ForeignOp; target: NationId }
  | { type: 'domestic'; nationId: NationId; op: DomesticOp; regionId?: RegionId }
  | { type: 'fundSystem'; nationId: NationId; system: SystemId; levels?: number }
  | { type: 'strike'; nationId: NationId; target: RegionId; weapon: 'missile' | 'orbital'; /** Missiles to fire in the salvo. */ count?: number; /** Which kind. Hypersonic if left out. */ kind?: MissileType }
  /** Raises the missile program one level. */
  | { type: 'fundMissiles'; nationId: NationId }
  /** Builds missiles of a kind from the program: money and steel (and oil) each. */
  | { type: 'buildMissiles'; nationId: NationId; kind: Exclude<MissileType, 'hypersonic'>; count: number }
  /** Starts building one nuclear warhead (a Superpower with the missile technology). */
  | { type: 'buildWarhead'; nationId: NationId }
  /** Fires a nuclear warhead at a country of a nation you are at war with. */
  | { type: 'nuke'; nationId: NationId; target: RegionId }
  /** Anything the space program does: hire, develop and build rockets, launch missions, run the labs, claim and build on other worlds. Applies at once. */
  | { type: 'space'; nationId: NationId; action: SpaceAction }
  /** Starts an aircraft development (research is paid now, money month by month). */
  | { type: 'startAircraftDev'; nationId: NationId; node: AircraftNodeId }
  /** Puts a development on hold, which frees its slot and its monthly bill, or takes it up again. */
  | { type: 'pauseAircraftDev'; nationId: NationId; node: AircraftNodeId; paused: boolean }
  | { type: 'fundAgency'; nationId: NationId; agency: AgencyId; /** How many levels to buy at once. One if left out. */ levels?: number }
  | { type: 'setGovernor'; nationId: NationId; regionId: RegionId; governor: Governor }
  /** Posts forces on station. The shares replace the nation's whole posture; what is left over is the reserve. */
  | { type: 'setDeployment'; nationId: NationId; coastal: number; subs: number; air: number; border: Record<NationId, number> }
  /** Closes or reopens the border with a neighboring nation. */
  | { type: 'setBorder'; nationId: NationId; neighbor: NationId; closed: boolean }
  | { type: 'buyShares'; nationId: NationId; company: string; shares: number }
  | { type: 'sellShares'; nationId: NationId; company: string; shares: number }
  | { type: 'setDirective'; nationId: NationId; company: string; directive: Directive }
  | { type: 'enactLaw'; nationId: NationId; law: LawId }
  | { type: 'repealLaw'; nationId: NationId; law: LawId }
  /** Sets a social program to Off (0), Pilot, National or Universal (3). */
  | { type: 'setSocial'; nationId: NationId; policy: SocialId; level: number }
  | { type: 'campaign'; nationId: NationId; campaign: CampaignId }
  | { type: 'suppressRebels'; nationId: NationId; regionId: RegionId }
  /** Factions: found one, join one you were invited to, invite a nation, leave, pay into the common pool, take your share out, put a country to a war vote, vote. */
  | { type: 'factionFound'; nationId: NationId; name: string; charter?: Partial<FactionCharter> }
  | { type: 'factionJoin'; nationId: NationId; factionId: string }
  | { type: 'factionInvite'; nationId: NationId; target: NationId }
  | { type: 'factionLeave'; nationId: NationId }
  | { type: 'factionContribute'; nationId: NationId; gift: FactionGift }
  | { type: 'factionWithdraw'; nationId: NationId; gift: FactionGift }
  | { type: 'factionPropose'; nationId: NationId; proposal: FactionProposalDraft }
  | { type: 'factionVote'; nationId: NationId; proposalId: string; vote: 'yes' | 'no' }
  /** Online: this player's answer to the decision waiting for them (`GameState.pendingEvents`). */
  | { type: 'eventChoice'; nationId: NationId; index: number }
  /** Live mode: calls an army that is still on its way out back home. */
  | { type: 'recall'; nationId: NationId; armyId: string }

export type ResolutionKind = 'sanctions' | 'ceasefire' | 'recognition' | 'accord'

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

/** A landing met by the defender's patrols: who sank how many divisions of it before it came ashore. */
export interface Interception {
  by: NationId
  /** Divisions of the landing force sunk or shot down. */
  sunk: number
  /** Share of the force that was lost. */
  share: number
  /** How the crossing went: the route. */
  via: Via
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
  /** Live mode: the army that fought it. */
  armyId?: string
  /** The player chose how much of the military to send, instead of a preset. */
  chosen?: boolean
  /** The defender's patrols met the landing at sea and sank part of it. */
  intercept?: Interception
  /** A surprise attack on a border nobody was guarding: how much stronger it made the attacker. */
  surprise?: number
  /** Set by the screen on a battle watched again from the list, so the globe does not treat it as news. */
  replay?: boolean
}

export type LogKind = 'news' | 'info' | 'war' | 'battle' | 'tech' | 'economy' | 'event' | 'spy' | 'diplomacy'

export interface LogEntry {
  turn: number
  /** Live games: the day of the month it happened. */
  day?: number
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
  /** 'live': time flows and armies march. Missing means turns, the way the game has always played. */
  mode?: 'turns' | 'live'
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
  /** The scenario this game started from, with its goal. Absent in a Standard game, so a Standard save is exactly what it always was. */
  scenario?: { id: string; start: number; goal: ScenarioGoal }
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
  /** True in a game people play together online. Everyone gets their own decisions, and none of them stops the month. */
  multiplayer?: boolean
  /** Multiplayer: the decision waiting for each human. An answer is an `eventChoice` order; an unanswered one takes the first option. */
  pendingEvents?: Record<NationId, PendingEvent>
  /** Turn when the next surprise decision may appear. New games wait until turn 8 (FIRST_EVENT_TURN). */
  nextEventTurn: number
  battles: BattleReport[]
  log: LogEntry[]
  nextId: number
  outcome: 'playing' | 'victory' | 'defeat'
  /** Every nation's gross income added together, from the last turn. The base for the economic victory. */
  worldGross: number
  worldStats: WorldStats
  /** A World Council trade accord: its members trade more freely until it ends. */
  accord?: { until: number; members: NationId[] }
  /** Per-month history of the player's nation, for charts and reports. */
  history?: HistoryPoint[]
  /** How much buying (positive) or selling (negative) has pushed each world price lately. It fades every month. */
  marketPressure?: Partial<Record<TradeResource, number>>
  /** Factions: member countries pooling money, materials and soldiers to vote on wars together. Absent until one is founded. */
  factions?: Faction[]
  /** Who holds each world beyond Earth, and how many flights the world has flown. Absent until someone starts a space program. */
  space?: SpaceWorld
  /** What neighbors remember about their borders, by sorted "a|b" key: incidents and closures. Absent until something happens. */
  borders?: Record<string, BorderRecord>
  /** Live mode only: the day of the month, from 0. `turn` is still the month. */
  day?: number
  /** Live mode only: armies marching, fighting or coming home. */
  armies?: Army[]
  /** Live mode only: attacks the AI planned for this month that have not left yet. */
  launches?: PlannedLaunch[]
  /** Live mode only: hypersonic salvos in the air. */
  flights?: MissileFlight[]
  /** Live mode only: nuclear warheads in the air. They fly for days, and the target's owner can see them coming. */
  nukes?: NukeFlight[]
  /** World tension added by a nuclear strike. It fades every month and is added to the world's tension. */
  shock?: number
  /** The turn of the last nuclear strike anywhere in the world, so rivals keep quiet for a while after one. */
  nukeLast?: number
  /** Rivals drawing together against a leading nation, and the strikes they have agreed on. Absent until one forms. */
  coalitions?: CoalitionPlan[]
  /** The turn each leading nation was last the object of a coalition's plan, so plans do not follow one another at once. */
  coalitionLast?: Record<NationId, number>
  /** Live mode only: the absolute day whose business waits until the player answers a decision that came with the new month. */
  pendingDay?: number
  /** Live mode only: how the player's nation stood when the month began, and its battles since. It travels with the game, so a month's report is right across a save and a load. The screen keeps it; the clock does not touch it. */
  monthStart?: MonthMark
}

/** The numbers the monthly report compares: how the player's nation stood at one moment. */
export interface MonthStats {
  money: number
  food: number
  influence: number
  research: number
  oil: number
  steel: number
  goods: number
  soldiers: number
  divisions: number
  stability: number
}

/** A month's starting point for the report: the numbers as the month began, and one line for each of the player's battles since. */
export interface MonthMark {
  /** The month it began. */
  turn: number
  stats: MonthStats
  battles: { text: string; good: boolean }[]
}

/** How an army gets to its target. Over water or air it fights with the amphibious penalty. */
export type Via = 'land' | 'lane' | 'fleet' | 'air'
export interface GeoPoint {
  lat: number
  lng: number
}
export type ArmyPhase = 'outbound' | 'fighting' | 'returning'
export type AttackOrder = Extract<Order, { type: 'attack' }>

/** Live mode: part of a nation's military sent to attack a country. It takes days to arrive, fights once, and comes home. */
export interface Army {
  id: string
  nationId: NationId
  /** The units in the field. They left the national military when the army set out and rejoin it when it is home. */
  units: UnitCounts
  commit: Commit
  stance: Stance
  /** Share of the military it was when it left, for the battle report. */
  share: number
  /** The player chose the share, instead of a preset. The battle report names it a chosen force, not a preset. */
  chosen?: boolean
  via: Via
  /** Fixed at launch: crossing water or air fights with the amphibious penalty. */
  bySea: boolean
  /** Where it set out from. It returns here, or to the nearest country still held. */
  home: RegionId
  target: RegionId
  phase: ArmyPhase
  /** The leg it is on now, in absolute days. Before `start` it is still mustering at `from`. */
  from: GeoPoint
  to: GeoPoint
  start: number
  end: number
  launched: number
  battleId?: string
  outcome?: ArmyOutcome
  /** The nation that held the target when the army set out. Older saves do not have it. */
  foe?: NationId
}

/**
 * How an army's march ended. `taken`: the country was already its own. `changed`: another nation now holds it.
 * `peace`: the war is over. `cut`: the country it set out from was lost, so it could not be supplied.
 */
export type ArmyOutcome = 'captured' | 'won' | 'repulsed' | 'recalled' | 'peace' | 'taken' | 'changed' | 'cut'

/** Live mode: an attack the AI means to launch on a given day. */
export interface PlannedLaunch {
  id: string
  /** Absolute day. */
  at: number
  order: AttackOrder
}

/** Live mode: a salvo of hypersonic missiles on its way. */
export interface MissileFlight {
  id: string
  nationId: NationId
  from: RegionId
  target: RegionId
  count: number
  /** Which kind. Hypersonic if left out. */
  kind?: MissileType
  launched: number
  /** Absolute day it lands. */
  lands: number
  /** Who held the target when it was fired. */
  foe?: NationId
}

// ---- Factions: countries that pool money, materials and soldiers and vote on war together ----

/** What the common pool holds besides soldiers. */
export type PoolResource = 'money' | 'oil' | 'steel' | 'goods' | 'food'
export const POOL_RESOURCES: PoolResource[] = ['money', 'oil', 'steel', 'goods', 'food']
export type PoolStock = Record<PoolResource, number>

/** How a faction's own rules work: who counts how much in a vote, who gets conquered land, and what leaving costs. */
export interface FactionCharter {
  /** `majority`: each member has one vote. `weighted`: votes follow each member's ownership share. */
  vote: 'majority' | 'weighted'
  /** `share`: conquered countries are split by ownership share. `proposer`: they go to whoever proposed the war. */
  spoils: 'share' | 'proposer'
  /** `refund`: a leaver takes back what is left of what they put in, less a fee. `forfeit`: they leave everything behind. */
  exit: 'refund' | 'forfeit'
}

/** A gift to the pool, or a withdrawal from it: money and materials, and soldiers by type. */
export interface FactionGift {
  stock?: Partial<PoolStock>
  units?: Partial<UnitCounts>
}

/** What one member has put into the pool and not taken out. Ownership shares come from this. */
export interface FactionLedger {
  stock: PoolStock
  units: UnitCounts
  /** The month of the last contribution: it stays locked for a while after. */
  last: number
  joined: number
}

/** A standing deal between the pool and a member: the member supplies the pool each month, and may be paid from it. */
export interface FactionContractTerms {
  /** The member who supplies. */
  member: NationId
  /** What the member sends the pool each month. Supplies with nothing paid back count as contributions to its ledger. */
  supply: Partial<PoolStock>
  /** What the pool pays the member each month. */
  pay: Partial<PoolStock>
  /** Months from approval before the first delivery. */
  start: number
  months: number
  /** Money the member puts up as a guarantee. */
  collateral: number
}

export type FactionProposalDraft = { kind: 'war'; target: NationId } | { kind: 'contract'; terms: FactionContractTerms }

export interface FactionProposal {
  id: string
  kind: 'war' | 'contract'
  by: NationId
  created: number
  /** The last month in which it can still be voted on. */
  expires: number
  target?: NationId
  terms?: FactionContractTerms
  votes: Record<NationId, 'yes' | 'no'>
  /** Weighted charters only: each member's weight on the day it was put forward, so money paid in afterwards cannot buy this vote. */
  weights?: Record<NationId, number>
}

export interface FactionContract extends FactionContractTerms {
  id: string
  /** First and last month it delivers. */
  from: number
  until: number
  /** The member's collateral, held by the pool. */
  held: number
}

/** A war the faction fights together: the pooled army attacks the target every month. */
export interface FactionWar {
  id: string
  target: NationId
  /** The member whose training, weapons and technology the pooled army fights with. */
  lead: NationId
  proposer: NationId
  since: number
  /** Countries each member has been given from this war, so the split follows the shares. */
  given: Record<NationId, number>
  captured: RegionId[]
}

export interface FactionInvite {
  nation: NationId
  by: NationId
  expires: number
}

export interface Faction {
  id: string
  name: string
  founder: NationId
  founded: number
  charter: FactionCharter
  members: NationId[]
  pool: { stock: PoolStock; units: UnitCounts }
  ledger: Record<NationId, FactionLedger>
  proposals: FactionProposal[]
  contracts: FactionContract[]
  invites: FactionInvite[]
  wars: FactionWar[]
  /** The pooled army could not be fed or fuelled last month, so it fights at reduced strength. */
  short?: { oil?: boolean; food?: boolean }
  /** What happened lately: votes, wars, contracts, members. */
  history: { turn: number; text: string }[]
}

/** A nuclear program: warheads built, and the turns the ones under construction are done. */
export interface NuclearState {
  warheads: number
  building: number[]
  /** The turn of its last launch, for the wait between two. */
  last?: number
  /** Warheads fired in all. */
  fired?: number
}

/** Live mode: a nuclear warhead on its way. */
export interface NukeFlight {
  id: string
  nationId: NationId
  from: RegionId
  target: RegionId
  launched: number
  /** Absolute day it lands. */
  lands: number
  /** Who held the target when it was fired. */
  foe?: NationId
}

/**
 * Rivals who have agreed to strike a leading nation together: who they are, where they will hit, and when. Hard rivals make these
 * plans, and the leader sees them coming in the World reaction panel.
 */
export interface CoalitionPlan {
  id: string
  /** The leading nation they gather against. */
  target: NationId
  members: NationId[]
  /** The target's weakest countries a member can reach, first choice first. Every member attacks the first one it can reach. */
  focus: RegionId[]
  /** The turn the plan was made, the month the strike falls, and (live games) the day of that month. */
  formed: number
  strikeTurn: number
  strikeDay: number
  /** Set once the month of the strike has come and gone. */
  done?: boolean
  /** The threat score that brought them together. */
  threat: number
}
