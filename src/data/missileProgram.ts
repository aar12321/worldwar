import type { MissileType, Tier } from '../engine/types'

/**
 * The missile program as an organisation: facilities you build and upgrade, staff you hire from the nation's talent, a chief designer,
 * and a development tree whose projects end in a test launch. The older program level (data/missiles.ts, `fundMissiles`) stays as the
 * program's charter: it decides which kinds of missile may be built at all. Everything here is plain numbers with comments, and the
 * engine (engine/missileProgram.ts) reads them for the rules, the forecast, the AI and the screen.
 *
 * Money scale, for reading the numbers: a small nation (Poland) nets about 27 money a month at the start, a big one (China) about 180.
 * A level-1 facility is a month or two of a small nation's income; a full program costs a small nation 10 to 20 money a month to run.
 */

/** The master switch. Off (tests only), nothing in this file changes a game: no bot uses the program and every effect is zero. */
export const MPROG = {
  on: true,
  /**
   * Medium rivals found programs more often (docs/MISSILE_PROGRAM_STATUS.md): one at war now and then, and a rich one a little more
   * readily, with the same bill limits. Off: as before (about one Medium program in two years).
   */
  mediumFounds: true,
  /** Medium: the monthly chance a rival at war founds one, and the chance for a rich and restless one at peace. */
  mediumWar: 0.15,
  mediumRich: 0.1,
  /**
   * Interceptor rounds on the production line (`produce` with `missile: 'interceptor'`): needs a plant and the interceptor works,
   * delivered into the store at the line's pace. Off: the order is refused.
   */
  interceptorLine: true,
  /**
   * Rivals put interceptor rounds on their own lines (src/ai/missileProgram.ts): a Medium or Hard program with a plant and the
   * interceptor works, under missile threat (an enemy with missiles in range, struck lately, or a low store), queues a batch within
   * the program's usual money guards. Easy rivals never do. Needs `interceptorLine`. Off: rivals only buy rounds outright, as before.
   */
  aiInterceptorLine: true,
}

/** How a rival uses the line for interceptor rounds (MPROG.aiInterceptorLine). */
export const AI_LINE = {
  /** A store (counting rounds on the line) below this share of what it holds is low. */
  lowStore: 0.5,
  /** Smallest batch worth queuing. */
  minBatch: 4,
  /** An enemy holding at least this many missiles is a threat when one of its launch sites reaches us. */
  armed: 3,
  /** Struck within this many months. */
  struck: 3,
  /** Most countries of ours checked for an enemy in range (the most populous first). */
  homes: 4,
}

// ---- Facilities ----

export type FacilityId = 'institute' | 'bureau' | 'stand' | 'plant' | 'silos' | 'works' | 'integration'

/** Everything a facility, a project or the chief designer can add to the program. Missing means none. */
export interface ProgramEffects {
  /** Share added to the range of program missiles (cruise, tactical, ballistic, decoy). */
  range: number
  /** Share added to what each missile that gets through does (accuracy and payload: the CEP shrinks). */
  harm: number
  /** Share of the enemy's interception (shield, batteries, fighters, patrols) that your missiles slip past. */
  evade: number
  /** Share of the enemy missiles that would get through which your own defences stop as well. */
  intercept: number
  /** Share added to the interceptor rounds your store can hold. */
  rounds: number
  /** Early-warning radar levels added (the Missile War tab's radar, within its own maximum). */
  radar: number
  /** Mobile launcher levels added (hide launchers from counterforce). */
  mobile: number
  /** Share of your missiles in store that a counterforce strike would destroy which survive instead (hardening, quick launch). */
  harden: number
  /** Share off the price of every program missile. */
  cost: number
  /** Missiles a month added to the program's capacity. */
  capacity: number
  /** Missiles added to what the stores hold. */
  storage: number
  /** Share added to the speed of research and development. */
  speed: number
  /** Share added to the chance a test launch succeeds. */
  reliability: number
}

export type ProgramEffectKey = keyof ProgramEffects

/** The most each effect can add up to, whatever is built: no runaway. */
export const PROGRAM_CAPS: ProgramEffects = { range: 0.6, harm: 0.5, evade: 0.3, intercept: 0.2, rounds: 0.6, radar: 2, mobile: 2, harden: 0.6, cost: 0.35, capacity: 20, storage: 60, speed: 0.9, reliability: 0.25 }

export interface FacilitySpec {
  name: string
  blurb: string
  /** One short line on what each level gives. */
  perLevel: string
  /** Money to build each level (index 0 is level 1). */
  money: number[]
  /** Months each level takes to build (a live game counts the days). */
  months: number[]
  /** Money a month the facility costs to run at each level. */
  upkeep: number[]
  /** What one level adds. A level counts this many times. */
  effects: Partial<ProgramEffects>
}

export const FACILITIES: Record<FacilityId, FacilitySpec> = {
  // The institute is the heart: it is where your engineers work, so in-house development needs one, and its levels add slots and speed.
  institute: { name: 'Research institute', blurb: 'Laboratories and wind tunnels. In-house development needs one; each level speeds research and the second and fourth add a project slot.', perLevel: '+12% development speed', money: [40, 90, 160, 260], months: [1, 2, 3, 4], upkeep: [1, 2, 3, 5], effects: { speed: 0.12 } },
  // The bureau turns ideas into designs that fly: better tests, and the advanced projects need it.
  bureau: { name: 'Design bureau', blurb: 'Draughtsmen and integration teams. Each level makes test launches likelier to succeed; advanced projects need a bigger bureau.', perLevel: '+5% test success', money: [50, 110, 200], months: [1, 2, 3], upkeep: [1, 2, 3], effects: { reliability: 0.05 } },
  // The test stand is the range: a test launch needs one, and each level allows one more test a month and makes tests cheaper.
  stand: { name: 'Engine test stand', blurb: 'Static firing pits and a range out to sea. Test launches need one. Each level allows one more test a month, cuts its price and steadies it.', perLevel: '+1 test a month, +4% test success, -15% test price', money: [35, 80, 150], months: [1, 2, 2], upkeep: [1, 1, 2], effects: { reliability: 0.04 } },
  // The plant is volume: a bigger monthly build, cheaper missiles, and the production line (a queue that delivers day by day).
  plant: { name: 'Production plant', blurb: 'Assembly halls. Each level adds to what the program builds in a month, makes every missile cheaper, and runs a production line that delivers day by day.', perLevel: '+3 missiles a month, -4% missile price, +3 a month on the line', money: [60, 120, 200, 320], months: [2, 2, 3, 4], upkeep: [2, 3, 4, 6], effects: { capacity: 3, cost: 0.04 } },
  // Silos are where missiles wait: bigger stores, and hardened ones a counterforce strike cannot reach.
  silos: { name: 'Silo field', blurb: 'Hardened silos and dispersed launch sites. Each level stores more missiles and protects them from counterforce strikes.', perLevel: '+10 missiles stored, 10% of the store safe from counterforce', money: [50, 110, 190], months: [2, 3, 3], upkeep: [1, 2, 3], effects: { storage: 10, harden: 0.1 } },
  // The works make interceptors: the shield holds more rounds and stops a little more.
  works: { name: 'Interceptor works', blurb: 'A factory for interceptor rounds. Each level lets your store hold more rounds and your defences stop a little more of what gets through.', perLevel: '+15% interceptor rounds, +3% interception', money: [60, 130, 220], months: [2, 3, 3], upkeep: [2, 3, 4], effects: { rounds: 0.15, intercept: 0.03 } },
  // Integration fits warheads to bodies: more harm per missile; multiple warheads need the second level.
  integration: { name: 'Warhead integration', blurb: 'Where warheads meet missiles. Each level makes every missile that lands do more; multiple warheads need the second level.', perLevel: '+6% harm per missile that lands', money: [80, 200], months: [3, 4], upkeep: [2, 4], effects: { harm: 0.06 } },
}

export const FACILITY_IDS = Object.keys(FACILITIES) as FacilityId[]

// ---- Staff ----

export type StaffRole = 'engineer' | 'propulsion' | 'guidance' | 'crew' | 'production' | 'analyst'

export interface StaffSpec {
  name: string
  /** One of them, for "1 rocket engineer". */
  one: string
  blurb: string
  /** Money to hire one (signing bonus and relocation), and their salary a month. */
  hire: number
  salary: number
  /** Heads beyond this add nothing more (the bonus is per head up to here). */
  useful: number
}

export const STAFF: Record<StaffRole, StaffSpec> = {
  engineer: { name: 'Rocket engineers', one: 'rocket engineer', blurb: 'The core team. In-house development needs two. Each one speeds every project.', hire: 6, salary: 0.8, useful: 10 },
  propulsion: { name: 'Propulsion scientists', one: 'propulsion scientist', blurb: 'Motors and stages. Each speeds propulsion projects and steadies their tests.', hire: 8, salary: 1, useful: 4 },
  guidance: { name: 'Guidance specialists', one: 'guidance specialist', blurb: 'Navigation and seekers. Each speeds guidance and payload projects and makes strikes a little more accurate.', hire: 8, salary: 1, useful: 4 },
  crew: { name: 'Test crews', one: 'test crew', blurb: 'The people on the range. Each makes every test launch likelier to succeed.', hire: 5, salary: 0.6, useful: 5 },
  production: { name: 'Production managers', one: 'production manager', blurb: 'Run the plant. Each adds a missile a month and trims the price.', hire: 6, salary: 0.8, useful: 6 },
  analyst: { name: 'Intelligence analysts', one: 'intelligence analyst', blurb: 'Watch the rivals and guard your people. One shows rival programs, three show what they develop, and each cuts the risk of staff being poached.', hire: 7, salary: 0.9, useful: 4 },
}

export const STAFF_ROLES = Object.keys(STAFF) as StaffRole[]

/** What a head of each role adds, up to `useful` heads. */
export const STAFF_FX = {
  /** Development speed per rocket engineer. */
  engineerSpeed: 0.05,
  /** Speed per specialist on a project of their branch (propulsion: propulsion; guidance: guidance and payload). */
  branchSpeed: 0.08,
  /** Test success per specialist on a test of their branch. */
  branchReliability: 0.02,
  /** Test success per test crew. */
  crewReliability: 0.03,
  /** Harm per guidance specialist. */
  guidanceHarm: 0.01,
  /** Missiles a month and price cut per production manager. */
  productionCapacity: 1,
  productionCost: 0.015,
  /** Cut in the chance of a poaching per analyst. */
  analystGuard: 0.2,
}

// ---- The chief designer ----

export type ChiefTrait = 'engines' | 'precision' | 'industrial' | 'daredevil' | 'meticulous' | 'stealth'

export interface TraitSpec {
  name: string
  blurb: string
  /** The bonus at skill 3; it scales by 0.7 + 0.1 x skill (0.8 at skill 1, 1.2 at skill 5). */
  effects: Partial<ProgramEffects>
  /** Extra development speed on one branch. */
  branch?: { branch: DevBranch; speed: number }
}

export const CHIEF_TRAITS: Record<ChiefTrait, TraitSpec> = {
  engines: { name: 'Engine wizard', blurb: 'Lives on the test stand. Propulsion projects go much faster and missiles fly further.', effects: { range: 0.08 }, branch: { branch: 'propulsion', speed: 0.3 } },
  precision: { name: 'Precision fanatic', blurb: 'Obsessed with the last metre. Guidance projects go much faster and missiles land closer.', effects: { harm: 0.06 }, branch: { branch: 'guidance', speed: 0.3 } },
  industrial: { name: 'Production genius', blurb: 'Thinks in assembly lines. More missiles a month, each a little cheaper.', effects: { capacity: 2, cost: 0.08 }, branch: { branch: 'production', speed: 0.3 } },
  daredevil: { name: 'Daredevil', blurb: 'Fast and loose. Everything is developed faster, and more tests blow up.', effects: { speed: 0.2, reliability: -0.06 } },
  meticulous: { name: 'Meticulous', blurb: 'Checks everything twice. Tests rarely fail, development is a little slower.', effects: { speed: -0.08, reliability: 0.1 } },
  stealth: { name: 'Stealth visionary', blurb: 'Builds missiles radar cannot hold. Payload projects go faster and missiles slip past more defences.', effects: { evade: 0.04 }, branch: { branch: 'payload', speed: 0.3 } },
}

export const CHIEF_TRAIT_IDS = Object.keys(CHIEF_TRAITS) as ChiefTrait[]

export const CHIEF = {
  /** Candidates on offer; the list is drawn again every year. */
  candidates: 3,
  /** Money to hire one: base plus per point of skill. Salary a month: base plus per point. */
  hire: [30, 12],
  salary: [2, 1],
  /** Skill grows by one for this many successful tests, to at most 5. */
  testsPerSkill: 3,
  maxSkill: 5,
  first: ['Anya', 'Viktor', 'Mei', 'Rahul', 'Leila', 'Tomas', 'Ines', 'Kenji', 'Amara', 'Pavel', 'Sofia', 'Omar', 'Hana', 'Diego', 'Yusuf', 'Greta', 'Ivan', 'Nadia', 'Chen', 'Marek'],
  last: ['Korolenko', 'Brandt', 'Okafor', 'Nakamura', 'Haddad', 'Varga', 'Silva', 'Lindqvist', 'Mensah', 'Petrov', 'Ortega', 'Rahimi', 'Novak', 'Iyer', 'Kowalczyk', 'Abara', 'Moreau', 'Tanaka', 'Duarte', 'Sato'],
}

// ---- Development ----

export type DevBranch = 'propulsion' | 'guidance' | 'payload' | 'production' | 'defense'

export const DEV_BRANCHES: Record<DevBranch, { name: string; color: string; blurb: string }> = {
  propulsion: { name: 'Propulsion', color: '#ff9f0a', blurb: 'Range, speed, quick launch.' },
  guidance: { name: 'Guidance', color: '#64d2ff', blurb: 'Accuracy: a smaller CEP, more harm per missile.' },
  payload: { name: 'Payload', color: '#ff6482', blurb: 'Warheads, decoys, stealth, multiple warheads.' },
  production: { name: 'Production', color: '#30d158', blurb: 'Cheaper, faster, harder to destroy.' },
  defense: { name: 'Defense', color: '#bf5af2', blurb: 'Interceptor generations and early warning.' },
}

export const DEV_BRANCH_IDS = Object.keys(DEV_BRANCHES) as DevBranch[]

export type MissileDevId =
  | 'motors' | 'solid' | 'stage' | 'glide'
  | 'inertial' | 'satnav' | 'seeker'
  | 'warheads' | 'decoys' | 'stealth' | 'mirv'
  | 'lines' | 'auto' | 'mobile' | 'hardened'
  | 'gen2' | 'gen3' | 'warning'

export interface DevSpec {
  name: string
  blurb: string
  branch: DevBranch
  requires: MissileDevId[]
  /** Months of work at the normal pace (staff, institute and budget make it faster). */
  months: number
  /** Money and research paid when the work begins. */
  money: number
  tp: number
  /** The program level (charter) it needs, and the empire tier. */
  level: number
  tier: Tier
  /** Facilities it needs, at least at these levels. */
  needs: Partial<Record<FacilityId, number>>
  /** The chance a first test succeeds before bonuses. Missing: no test, it is done when the work is. */
  test?: number
  effects: Partial<ProgramEffects>
}

export const DEVS: Record<MissileDevId, DevSpec> = {
  // Propulsion: range first, then quick launch, then the long reach, then speed that interceptors cannot follow.
  motors: { name: 'Improved motors', blurb: 'More thrust from the same tube.', branch: 'propulsion', requires: [], months: 2, money: 40, tp: 5, level: 1, tier: 1, needs: {}, test: 0.75, effects: { range: 0.15 } },
  solid: { name: 'Solid-fuel boosters', blurb: 'No fuelling before launch: missiles leave before a counterforce strike lands, and tests are steadier.', branch: 'propulsion', requires: ['motors'], months: 3, money: 70, tp: 10, level: 1, tier: 1, needs: { stand: 1 }, test: 0.7, effects: { harden: 0.15, reliability: 0.04 } },
  stage: { name: 'Second stage', blurb: 'A second rocket on top of the first: continental reach.', branch: 'propulsion', requires: ['motors'], months: 4, money: 110, tp: 18, level: 2, tier: 1, needs: { institute: 2, stand: 2 }, test: 0.65, effects: { range: 0.3 } },
  glide: { name: 'Hypersonic glide body', blurb: 'A warhead that skips along the atmosphere too fast to intercept.', branch: 'propulsion', requires: ['stage', 'solid'], months: 6, money: 220, tp: 35, level: 3, tier: 2, needs: { institute: 3, bureau: 2 }, test: 0.55, effects: { evade: 0.1, range: 0.1 } },
  // Guidance: each step shrinks the circle half the missiles land in, so each one that gets through does more.
  inertial: { name: 'Inertial guidance', blurb: 'Gyroscopes that know where the missile is: the CEP halves.', branch: 'guidance', requires: [], months: 2, money: 45, tp: 6, level: 1, tier: 1, needs: {}, test: 0.75, effects: { harm: 0.08 } },
  satnav: { name: 'Satellite navigation', blurb: 'Fixes from orbit all the way down.', branch: 'guidance', requires: ['inertial'], months: 3, money: 90, tp: 14, level: 2, tier: 1, needs: { institute: 2 }, test: 0.7, effects: { harm: 0.1 } },
  seeker: { name: 'Terminal seekers', blurb: 'A camera in the nose picks the target in the last seconds and dodges.', branch: 'guidance', requires: ['satnav'], months: 4, money: 140, tp: 24, level: 2, tier: 1, needs: { bureau: 2 }, test: 0.65, effects: { harm: 0.1, evade: 0.04 } },
  // Payload: harder hits, then ways through the shield, then several warheads on one missile (only near the top).
  warheads: { name: 'Heavier warheads', blurb: 'More explosive in the same nose cone.', branch: 'payload', requires: ['inertial'], months: 3, money: 80, tp: 12, level: 2, tier: 1, needs: { integration: 1 }, test: 0.7, effects: { harm: 0.12 } },
  decoys: { name: 'Penetration aids', blurb: 'Chaff, balloons and jammers released in flight: the shield shoots at ghosts.', branch: 'payload', requires: [], months: 2, money: 60, tp: 8, level: 1, tier: 1, needs: { bureau: 1 }, test: 0.75, effects: { evade: 0.06 } },
  stealth: { name: 'Low-observable body', blurb: 'Shapes and coatings that radar barely sees.', branch: 'payload', requires: ['decoys'], months: 5, money: 170, tp: 28, level: 3, tier: 2, needs: { bureau: 2 }, test: 0.6, effects: { evade: 0.08 } },
  mirv: { name: 'Multiple warheads (MIRV)', blurb: 'One missile, several warheads, each to its own aim point. Only great powers can field them.', branch: 'payload', requires: ['warheads', 'stage', 'stealth'], months: 8, money: 380, tp: 60, level: 3, tier: 3, needs: { integration: 2, bureau: 3 }, test: 0.5, effects: { harm: 0.15, evade: 0.08 } },
  // Production: cheaper and more missiles, launchers that move, silos that survive.
  lines: { name: 'Cheaper production lines', blurb: 'Standard parts and fewer hand-fitted ones.', branch: 'production', requires: [], months: 2, money: 50, tp: 5, level: 1, tier: 1, needs: { plant: 1 }, effects: { cost: 0.12 } },
  auto: { name: 'Automated assembly', blurb: 'Robots on the line: many more missiles a month.', branch: 'production', requires: ['lines'], months: 4, money: 120, tp: 15, level: 2, tier: 1, needs: { plant: 2 }, effects: { capacity: 4, cost: 0.06 } },
  mobile: { name: 'Mobile launchers', blurb: 'Missiles on trucks that move every night: counterforce strikes find fewer of them.', branch: 'production', requires: ['solid'], months: 3, money: 100, tp: 12, level: 2, tier: 1, needs: { stand: 1 }, test: 0.75, effects: { mobile: 1 } },
  hardened: { name: 'Hardened silos', blurb: 'Concrete and steel doors: more of the store survives counterforce, and it holds more.', branch: 'production', requires: [], months: 3, money: 90, tp: 10, level: 1, tier: 1, needs: { silos: 1 }, effects: { harden: 0.2, storage: 6 } },
  // Defense: interceptor generations and the early-warning network.
  gen2: { name: 'Interceptor generation 2', blurb: 'Faster interceptors with their own radar: more rounds and more kills.', branch: 'defense', requires: [], months: 3, money: 80, tp: 10, level: 1, tier: 1, needs: { works: 1 }, test: 0.7, effects: { intercept: 0.06, rounds: 0.2 } },
  gen3: { name: 'Interceptor generation 3', blurb: 'Hit-to-kill interceptors that reach ballistic warheads.', branch: 'defense', requires: ['gen2'], months: 5, money: 180, tp: 30, level: 2, tier: 1, needs: { works: 2 }, test: 0.6, effects: { intercept: 0.08, rounds: 0.2 } },
  warning: { name: 'Early-warning network', blurb: 'Over-the-horizon radar: an extra level of warning for the interceptors.', branch: 'defense', requires: [], months: 3, money: 90, tp: 10, level: 1, tier: 1, needs: { works: 1 }, effects: { radar: 1 } },
}

export const DEV_IDS = Object.keys(DEVS) as MissileDevId[]

// ---- Contractors ----

export type Contractor = 'house' | 'domestic' | 'foreign'

export const CONTRACTORS: Record<Contractor, { name: string; blurb: string; price: number; pace: number; reliability: number }> = {
  // In-house: the cheapest, as fast as your staff, institute and budget make it, and the experience stays home.
  house: { name: 'In-house', blurb: 'Your own institute and staff. Cheapest, and as fast as your people make it.', price: 1, pace: 1, reliability: 0 },
  // A domestic firm: a third dearer, a fixed good pace, slightly shakier tests.
  domestic: { name: 'Domestic contractor', blurb: 'A firm at home. Dearer, needs no institute or staff, works at a steady pace; its tests are a little shakier.', price: 1.35, pace: 1.3, reliability: -0.04 },
  // A foreign firm: the fastest and the dearest, the least reliable, and every rival's intelligence sees your program.
  foreign: { name: 'Foreign contractor', blurb: 'A foreign firm. The fastest and the dearest, the shakiest tests, and every rival can see your program.', price: 1.7, pace: 1.7, reliability: -0.08 },
}

export const CONTRACTOR_IDS = Object.keys(CONTRACTORS) as Contractor[]

// ---- Rules ----

export const PROGRAM_RULES = {
  /** A facility may be built one level above the program's charter level (so a nation with no program can found the institute, bureau and stand). */
  aboveCharter: 1,
  /** The highest facility level each empire tier may build (tiers 1 to 5). */
  tierLevel: [3, 4, 5, 5, 5],
  /** Facilities that may be under construction at once, by tier. */
  builds: [1, 1, 2, 2, 3],
  /** Development slots by institute level (0 to 4). Contractors use a slot too. */
  slots: [1, 1, 2, 2, 3],
  /** In-house development needs at least this many rocket engineers and an institute. */
  houseEngineers: 2,
  /** Hiring: at most this many at once. */
  hireMax: 5,
  /**
   * The talent the people can spare: (engineers x 0.65 + scientists x 0.35) of the workforce times this. Poland can spare about 9 at the
   * start and China about 85. The space agency's staff come out of the same pool.
   */
  talentPerWork: 60,
  /** Share of the program's staff drawn from the engineers the factories need (as the space agency's are). */
  engineerDraw: 0.4,
  /** Budget: the multiplier the slider sets, from a lean program to a crash one. Speed of work is 0.6 + 0.4 x budget; operations cost money x budget. */
  budgets: [0.5, 0.75, 1, 1.25, 1.5],
  /** Operations a month (money): a base while anything is in hand, plus per project and per construction, times the budget. */
  opsBase: 1,
  opsPerJob: 1.5,
  /** Experience: per successful test, per failed one, per facility finished, per missile fired at an enemy (up to a month's cap). At most 100. */
  exp: { success: 6, failure: 3, built: 1, fired: 0.25, firedMonth: 4, max: 100 },
  /** What experience gives at 100 (in proportion below): development speed and test success. */
  expSpeed: 0.2,
  expReliability: 0.1,
}

export const TEST_RULES = {
  /** Live: days from the order to the launch (the countdown), and days in the air. A turn game resolves the test at the month's end. */
  countdown: 2,
  flight: 1,
  /** Money a test costs: a tenth of the project's money, at least this, less 15% a stand level. */
  minMoney: 8,
  share: 0.1,
  standCut: 0.15,
  /** Each earlier failure of the same project adds this to the next try: the engineers learned something. */
  learn: 0.06,
  /** The chance is held between these. */
  floor: 0.25,
  ceiling: 0.95,
  /** World tension a successful test adds (a failure adds half), and what rivals within reach think of it. */
  tension: 0.4,
  opinion: -2,
  /** Rivals within this share of the tested range notice (at most `noticeMax` of the nearest). */
  noticeMax: 6,
}

export const PRODUCTION_RULES = {
  /** Missiles a month a production line delivers per plant level (production managers and the chief add more). */
  perLevel: 3,
  /** Price on the line, as a share of the build price (the plant's own discount on top). */
  price: 0.9,
  /** Batches waiting at once. */
  queueMax: 4,
  /** Most in one batch. */
  batchMax: 20,
  /** Interceptor rounds (MPROG.interceptorLine): rounds the line makes in the time of one missile, and their price as a share of buying rounds at once (MW.roundCost). */
  roundsPerMissile: 2,
  roundPrice: 0.75,
}

export const POACH = {
  /** The monthly chance a program with at least `minStaff` loses staff to a rival, before what changes it. */
  base: 0.05,
  minStaff: 3,
  /** A lean budget makes people listen to offers; a rich one keeps them. */
  leanBudget: 1.6,
  richBudget: 0.6,
  /** No rival program near, half the chance. */
  quiet: 0.5,
  /** Heads lost when it happens. */
  heads: [1, 2],
  /** The chance it is the chief designer (skill 3 or more) who goes. */
  chief: 0.2,
  /** Experience the receiving program gains. */
  exp: 2,
}

/** The fictional CEP of each kind at the start, in metres: shown on the screen, shrinking as guidance and payload work raise `harm`. */
export const BASE_CEP: Partial<Record<MissileType, number>> = { cruise: 30, tactical: 60, ballistic: 900, decoy: 400, hypersonic: 120 }

/** Test flights show on the globe with the missile look of their branch. */
export const TEST_LOOK: Record<DevBranch, Exclude<MissileType, 'hypersonic'>> = { propulsion: 'ballistic', guidance: 'tactical', payload: 'ballistic', production: 'cruise', defense: 'cruise' }

/** Milestones on the screen's strip: a short name, and what earns it (checked in engine/missileProgram.ts `milestones`). */
export const MILESTONES = [
  { id: 'founded', name: 'Founded', blurb: 'A first facility built.' },
  { id: 'team', name: 'The team', blurb: 'Five staff hired.' },
  { id: 'chief', name: 'Chief designer', blurb: 'A chief designer hired.' },
  { id: 'firstTest', name: 'First light', blurb: 'A first successful test launch.' },
  { id: 'veteran', name: 'Veteran range', blurb: 'Five successful tests.' },
  { id: 'reach', name: 'Long reach', blurb: 'Range raised by 40% or more.' },
  { id: 'precision', name: 'Pinpoint', blurb: 'Harm per missile raised by 25% or more.' },
  { id: 'shield', name: 'Iron dome', blurb: 'Interceptor generation 3.' },
  { id: 'mirv', name: 'Many warheads', blurb: 'MIRV developed.' },
] as const

export type MilestoneId = (typeof MILESTONES)[number]['id']

// ---- State (kept on the nation as `mprog`; absent until its first program order, so a nation that never uses it is unchanged) ----

/** Program missile kinds (hypersonic missiles come from technology, not from here). */
export type ProgramKind = Exclude<MissileType, 'hypersonic'>

/** One development: months of work left at pace 1, its contractor, failures so far, and where it stands. */
export interface DevState {
  /** `dev`: being worked on; `test`: the work is done and it waits for a successful test launch; `done`. */
  state: 'dev' | 'test' | 'done'
  left: number
  total: number
  by: Contractor
  fails: number
}

export interface FacilityBuild {
  facility: FacilityId
  level: number
  left: number
  total: number
}

/** What the production line makes: a program missile, or interceptor rounds for the store. */
export type LineKind = ProgramKind | 'interceptor'

export interface LineBatch {
  id: string
  kind: LineKind
  count: number
  /** Missiles finished so far (a fraction while one is on the line). */
  made: number
}

export interface ChiefDesigner {
  name: string
  trait: ChiefTrait
  skill: number
  /** Successful tests under them, toward the next point of skill. */
  tests: number
  /** The month they joined. */
  since: number
}

export interface MissileProgramState {
  fac: Partial<Record<FacilityId, number>>
  builds: FacilityBuild[]
  staff: Partial<Record<StaffRole, number>>
  chief?: ChiefDesigner
  devs: Partial<Record<MissileDevId, DevState>>
  line: LineBatch[]
  /** The budget multiplier, one of PROGRAM_RULES.budgets. */
  budget: number
  /** Program experience, 0 to 100. */
  exp: number
  /** The absolute day the work was last brought up to date. Every rate is constant between two such days. */
  asOf: number
  /** The treasury was empty at the last month's end: in-house work stands still this month. */
  stalled?: boolean
  /** A foreign contractor worked on it: every rival's intelligence sees the program. */
  exposed?: boolean
  stats: { tests: number; successes: number; failures: number; built: number; poached: number; gained: number }
  /** Test launches made in a month, against the stand's limit. */
  testsIn?: { turn: number; count: number }
  /** Missiles fired at enemies so far (the ledger's count), to give experience for the new ones. */
  firedSeen?: number
  seq: number
}

/** A test launch on its way, kept on the game so every screen draws the same arc. Resolved when it lands. */
export interface MissileTestFlight {
  id: string
  nationId: string
  dev: MissileDevId
  from: string
  to: { lat: number; lng: number }
  launched: number
  lands: number
}

export type MissileProgramAction =
  | { kind: 'build'; facility: FacilityId }
  | { kind: 'hire'; role: StaffRole; count: number }
  | { kind: 'dismiss'; role: StaffRole; count: number }
  | { kind: 'chief'; pick: number }
  | { kind: 'dropChief' }
  | { kind: 'develop'; dev: MissileDevId; by?: Contractor }
  | { kind: 'test'; dev: MissileDevId }
  | { kind: 'budget'; level: number }
  | { kind: 'produce'; missile: LineKind; count: number }
