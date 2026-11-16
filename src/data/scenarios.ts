import type { Difficulty, Personality, RegionId, Tier, TradeResource } from '../engine/types'
import { tierSpec } from './empire'

/**
 * Scenarios: replayable starting situations, written as plain data. `applyScenario` (engine/scenarios.ts) reads the `ops` list
 * and changes a freshly made world, so a scenario is deterministic, testable, and optional: the Standard game applies nothing.
 */

/** How a scenario is won. 'world' and 'classic' are the game's own goals; the rest are checked by `humanStatus` (engine/victory.ts). */
export type ScenarioGoal =
  | { kind: 'world' }
  | { kind: 'classic'; victoryShare: number }
  /** Be standing, with your capital in your hands, this many months after the start. */
  | { kind: 'survive'; months: number }
  /** Reach an empire tier (2 Regional power, 3 Great power...). Optionally within a number of months, or lose. */
  | { kind: 'tier'; tier: Tier; deadline?: number }
  /** Reach a share of the world's output, optionally within a number of months, or lose. */
  | { kind: 'economy'; share: number; deadline?: number }

/**
 * A nation named in a scenario. Either a country's id, or one of:
 * `$player`; `$neighbor:strongest` / `$neighbor:weakest` / `$neighbor:2nd` (the player's neighbors by military strength);
 * `$top:1`, `$top:2`... (the strongest nations in the world other than the player); `$patron` (the strongest nation
 * that does not border the player); `$world` (every nation). `{ first: [...] }` is the first of those that exists and is
 * not the player, so a scenario about one country still works when the player picks that country.
 */
export type NationRef = string | { first: string[] }
/** One nation, or a list of them. */
export type Who = NationRef | NationRef[]

export type ScenarioOp =
  /** A war already under way. `lead` is the war score the first side holds over the second, `months` how long ago it began. */
  | { op: 'war'; a: NationRef; b: NationRef; lead?: number; months?: number }
  /** Every pair among the members becomes allies. */
  | { op: 'alliance'; members: Who }
  /** Every pair among the members signs a non-aggression pact for this many months. */
  | { op: 'pact'; members: Who; months: number }
  | { op: 'puppet'; master: NationRef; puppets: Who }
  | { op: 'sanction'; from: Who; to: Who; months: number }
  | { op: 'guarantee'; from: NationRef; to: NationRef; months: number }
  /** `holder` resents `target`. With a `reason`, it also holds a reason for war for `months` months. */
  | { op: 'grudge'; holder: Who; target: NationRef; value: number; label: string; reason?: string; months?: number }
  /** Both sides of a rivalry resent each other. */
  | { op: 'feud'; sideA: Who; sideB: Who; value: number; label: string }
  | { op: 'treasury'; who: Who; mult?: number; add?: number }
  | { op: 'stability'; who: Who; add?: number; set?: number }
  | { op: 'weariness'; who: Who; set: number }
  /** Scales the whole military. `weapons` and `drill` set a level for every unit type the nation fields. */
  | { op: 'military'; who: Who; mult?: number; weapons?: number; drill?: number }
  | { op: 'stock'; who: Who; key: 'oil' | 'food' | 'steel' | 'goods' | 'tp' | 'pp'; mult?: number; add?: number; except?: Who }
  /** Technologies, in an order where each one's requirements come first. Ones whose requirements are missing are skipped. */
  | { op: 'techs'; who: Who; add: string[] }
  | { op: 'people'; who: Who; health?: number; schooling?: number; unemployment?: number }
  | { op: 'epidemic'; who: Who; severity: number }
  | { op: 'crisis'; kind: 'unrest' | 'dispute'; nation: NationRef; rival?: NationRef; stage: 0 | 1 | 2 }
  | { op: 'rebels'; who: Who; strength: number }
  | { op: 'character'; who: Who; personality?: Personality; aggression?: number; aggressionMult?: number }
  | { op: 'market'; resource: TradeResource; pressure: number }
  /** Missiles in store and a missile program level. */
  | { op: 'missiles'; who: Who; cruise?: number; tactical?: number; program?: number }

export interface ScenarioDef {
  id: string
  title: string
  /** One line for the card. */
  tagline: string
  /** The situation, in plain words: what is going on and what it asks of you. Short paragraphs. */
  briefing: string[]
  /** One sentence: how you win. */
  goalText: string
  goal: ScenarioGoal
  /** The nation that suits the scenario best, and the rival skill. Picking the scenario suggests both; nothing locks them. */
  recommended: { nation: RegionId; difficulty: Difficulty }
  /** What kind of game it is, for the card. */
  tags: string[]
  /** Rough length of a game. */
  length: string
  ops: ScenarioOp[]
}

const WEST = ['united-states-of-america', 'canada', 'united-kingdom', 'france', 'germany', 'japan', 'australia']
const EAST = ['china', 'russia', 'north-korea', 'iran']
const GULF = ['saudi-arabia', 'united-arab-emirates', 'qatar', 'kuwait', 'oman']

export const STANDARD_SCENARIO = 'standard'

export const SCENARIOS: ScenarioDef[] = [
  {
    id: STANDARD_SCENARIO,
    title: 'Standard game',
    tagline: 'The world as it stands in January 2026. Hold every country.',
    briefing: ['Every country begins alone, with its own army and its own ambitions. No one is at war yet.', 'It is the long game: hold the whole world, yours or puppets of yours. Take your time.'],
    goalText: 'Hold every country in the world, yours or puppets of yours.',
    goal: { kind: 'world' },
    recommended: { nation: 'poland', difficulty: 'normal' },
    tags: ['Open', 'Long'],
    length: '12 to 15 hours',
    ops: [],
  },
  {
    id: 'cold-war',
    title: 'Two Blocs',
    tagline: 'A cold war: two armed alliances, sanctions, and quiet wars far from home.',
    briefing: [
      'The great powers have split into two camps. The western bloc (the United States, Canada, Britain, France, Germany, Japan and Australia) and the eastern bloc (China, Russia, North Korea and Iran, with a few client states) sit behind sanctions and old grudges.',
      'No one wants the big war, so the fighting is elsewhere: in Yemen, and between Ethiopia and Eritrea. A dispute on the Korean border is heating up. Everyone else must choose a side, or play both.',
    ],
    goalText: 'Take 6 countries, hold 35% of the world’s people, or reach 16% of its output.',
    goal: { kind: 'classic', victoryShare: 0.35 },
    recommended: { nation: 'india', difficulty: 'normal' },
    tags: ['Blocs', 'Proxy wars'],
    length: 'about 6 hours',
    ops: [
      { op: 'alliance', members: WEST },
      { op: 'alliance', members: EAST },
      { op: 'puppet', master: 'russia', puppets: ['belarus'] },
      { op: 'puppet', master: 'china', puppets: ['laos', 'cambodia'] },
      { op: 'feud', sideA: WEST, sideB: EAST, value: -25, label: 'Cold war rivalry' },
      { op: 'sanction', from: 'united-states-of-america', to: 'russia', months: 24 },
      { op: 'sanction', from: 'russia', to: 'united-states-of-america', months: 24 },
      { op: 'treasury', who: ['united-states-of-america', 'china', 'russia'], mult: 1.4 },
      { op: 'military', who: ['united-states-of-america', 'china', 'russia'], mult: 1.2 },
      { op: 'war', a: 'saudi-arabia', b: 'yemen', lead: 5, months: 8 },
      { op: 'war', a: 'ethiopia', b: 'eritrea', lead: 0, months: 5 },
      { op: 'crisis', kind: 'dispute', nation: 'south-korea', rival: 'north-korea', stage: 1 },
    ],
  },
  {
    id: 'small-among-giants',
    title: 'Small Among Giants',
    tagline: 'A tiny country, two hungry neighbors, one distant friend. Live to see 2031.',
    briefing: [
      'You rule a small nation with a few divisions. Your strongest neighbor has a bigger army, a fatter treasury, an old claim on your land, and a government that likes the idea of taking it. The next strongest is watching.',
      'A distant power has promised to guard you for three years. A promise is not an army. Build, sign pacts, make friends, and be a harder meal than you look.',
    ],
    goalText: 'Still stand, with your capital in your hands, five years from now.',
    goal: { kind: 'survive', months: 60 },
    recommended: { nation: 'estonia', difficulty: 'normal' },
    tags: ['Survival', 'Underdog'],
    length: 'about 3 hours',
    ops: [
      { op: 'military', who: '$neighbor:strongest', mult: 1.5 },
      { op: 'treasury', who: '$neighbor:strongest', mult: 1.5 },
      { op: 'character', who: '$neighbor:strongest', personality: 'expansionist', aggression: 0.85 },
      { op: 'grudge', holder: '$neighbor:strongest', target: '$player', value: -20, label: 'Old claims on your land', reason: 'Old claims', months: 24 },
      { op: 'character', who: '$neighbor:2nd', aggressionMult: 1.3 },
      { op: 'military', who: '$player', mult: 1.15, drill: 1 },
      { op: 'stability', who: '$player', add: 10 },
      { op: 'guarantee', from: '$patron', to: '$player', months: 36 },
    ],
  },
  {
    id: 'peaceful-builder',
    title: 'The Peaceful Builder',
    tagline: 'A rich start, calm neighbors, and a world that mostly wants to trade.',
    briefing: [
      'Money is easy to find at the start: you have a full treasury, a calm people and pacts with every neighbor for three years. Most of the world has turned its mind to trade, not war.',
      'There is a prize for patience. If you grow your economy to a large share of the world’s output, you win without a single invasion. Do not mistake quiet for safety: pacts end, and a rich neighbor is a target.',
    ],
    goalText: 'Within ten years, reach 3.5% of the world’s output (puppets count half).',
    goal: { kind: 'economy', share: 0.035, deadline: 120 },
    recommended: { nation: 'south-korea', difficulty: 'normal' },
    tags: ['Economy', 'Peaceful'],
    length: 'about 5 hours',
    ops: [
      { op: 'character', who: '$world', aggressionMult: 0.55 },
      { op: 'treasury', who: '$player', mult: 2.5 },
      { op: 'stability', who: '$player', add: 12 },
      { op: 'techs', who: '$player', add: ['eco_banking', 'eco_exchanges', 'eco_schools', 'infra_railways', 'eco_mass_production'] },
      { op: 'pact', members: ['$player', '$neighbor:strongest'], months: 36 },
      { op: 'pact', members: ['$player', '$neighbor:2nd'], months: 36 },
      { op: 'pact', members: ['$player', '$neighbor:weakest'], months: 36 },
    ],
  },
  {
    id: 'arms-race',
    title: 'The Arms Race',
    tagline: 'Everyone is arming. Missiles are stocked, armies are big, and tempers are short.',
    briefing: [
      'Every government has spent its way to a larger army, and the great powers keep missiles ready. Nobody has fired yet. Weapons are better, defenses are stronger, and a war that begins now will be a costly one.',
      'You will not out-build everyone. Pick your quarrel, strike where the odds are good, and keep a shield and a reserve at home. A short, sharp win is what the war colleges promise.',
    ],
    goalText: 'Take 3 countries, hold 25% of the world’s people, or reach 11% of its output.',
    goal: { kind: 'classic', victoryShare: 0.25 },
    recommended: { nation: 'turkey', difficulty: 'hard' },
    tags: ['Military', 'Short'],
    length: 'about 3 hours',
    ops: [
      { op: 'military', who: '$world', mult: 1.4 },
      { op: 'military', who: ['$top:1', '$top:2', '$top:3', '$top:4', '$top:5', '$top:6'], weapons: 1 },
      { op: 'missiles', who: '$top:1', cruise: 4, tactical: 2, program: 1 },
      { op: 'missiles', who: '$top:2', cruise: 4, tactical: 2, program: 1 },
      { op: 'missiles', who: '$top:3', cruise: 3, tactical: 2, program: 1 },
      { op: 'missiles', who: '$top:4', cruise: 3, tactical: 1, program: 1 },
      { op: 'missiles', who: '$player', cruise: 2, program: 1 },
      { op: 'character', who: '$world', aggressionMult: 1.15 },
      { op: 'treasury', who: '$player', mult: 1.5 },
      { op: 'feud', sideA: ['$top:1'], sideB: ['$top:2'], value: -20, label: 'Arms race rivalry' },
    ],
  },
  {
    id: 'collapsing-neighbor',
    title: 'A Neighbor Collapses',
    tagline: 'A government falls next door. Rebels, refugees, and a race for the pieces.',
    briefing: [
      'Next door, a state is coming apart: no money, an army that will not obey, rebels in the provinces and a crisis in the news. Its other neighbors have noticed, and each has a grievance ready.',
      'You can send aid and be thanked. You can take what you can reach before anyone else does, and be judged for it. Or you can watch the border and let someone else make the mess.',
    ],
    goalText: 'Take 3 countries, hold 25% of the world’s people, or reach 11% of its output.',
    goal: { kind: 'classic', victoryShare: 0.25 },
    recommended: { nation: 'turkey', difficulty: 'normal' },
    tags: ['Crisis', 'Opportunity'],
    length: 'about 3 hours',
    ops: [
      { op: 'stability', who: { first: ['syria', '$neighbor:weakest'] }, set: 12 },
      { op: 'treasury', who: { first: ['syria', '$neighbor:weakest'] }, mult: 0.2 },
      { op: 'military', who: { first: ['syria', '$neighbor:weakest'] }, mult: 0.35 },
      { op: 'weariness', who: { first: ['syria', '$neighbor:weakest'] }, set: 35 },
      { op: 'rebels', who: { first: ['syria', '$neighbor:weakest'] }, strength: 3 },
      { op: 'crisis', kind: 'unrest', nation: { first: ['syria', '$neighbor:weakest'] }, stage: 2 },
    ],
  },
  {
    id: 'resource-crunch',
    title: 'The Resource Crunch',
    tagline: 'Oil, steel and grain are short everywhere. Prices are climbing.',
    briefing: [
      'A bad harvest and a closed pipeline have emptied the world’s warehouses. Oil is scarce for everyone except the countries that pump it, steel is dear, and food is short in the cities.',
      'Tanks and planes burn oil, and a country with none fights at half strength. Trade for what you lack, protect what you have, and look hard at who owns the wells.',
    ],
    goalText: 'Within six years, grow to a Regional power (hold 4 countries).',
    goal: { kind: 'tier', tier: 2, deadline: 72 },
    recommended: { nation: 'japan', difficulty: 'normal' },
    tags: ['Economy', 'Scarcity'],
    length: 'about 4 hours',
    ops: [
      { op: 'stock', who: '$world', key: 'oil', mult: 0.2, except: ['saudi-arabia', 'russia', 'iran', 'iraq', 'kuwait', 'united-arab-emirates', 'venezuela', 'nigeria', 'libya', 'qatar', 'norway', 'canada'] },
      { op: 'stock', who: '$world', key: 'steel', mult: 0.4 },
      { op: 'stock', who: '$world', key: 'food', mult: 0.6 },
      { op: 'market', resource: 'oil', pressure: 0.35 },
      { op: 'market', resource: 'steel', pressure: 0.2 },
      { op: 'market', resource: 'food', pressure: 0.15 },
    ],
  },
  {
    id: 'plague-year',
    title: 'Plague Year',
    tagline: 'A deadly epidemic is loose in your region. Hospitals fill; borders matter.',
    briefing: [
      'A fast new disease started in the crowded cities of your region and has already reached you and your neighbors. Health systems are straining and trust in the government is thin.',
      'Spend on doctors and hospitals, close the border if you must, and keep people fed and calm. The nations that cope will come out of it stronger than the ones that do not.',
    ],
    goalText: 'Still stand, with your capital in your hands, three years from now.',
    goal: { kind: 'survive', months: 36 },
    recommended: { nation: 'brazil', difficulty: 'easy' },
    tags: ['Disaster', 'Health'],
    length: 'about 2 hours',
    ops: [
      { op: 'epidemic', who: '$player', severity: 0.55 },
      { op: 'epidemic', who: '$neighbor:strongest', severity: 0.5 },
      { op: 'epidemic', who: '$neighbor:2nd', severity: 0.45 },
      { op: 'people', who: '$player', health: -0.08 },
      { op: 'stability', who: '$player', add: -8 },
      { op: 'treasury', who: '$player', mult: 1.3 },
    ],
  },
  {
    id: 'strait-under-fire',
    title: 'Strait Under Fire',
    tagline: 'A war over the Gulf shipping lanes, with the world’s oil at stake.',
    briefing: [
      'A big, hungry power on one side of the Gulf has gone to war with two of its small, rich neighbors over the sea lanes. The others are allied, uneasy, and ready to fight. The price of oil has jumped.',
      'Whoever holds the shore holds the tankers. Join the defense, join the attack, or stay out and sell fuel to both: every choice has a bill.',
    ],
    goalText: 'Take 3 countries, hold 25% of the world’s people, or reach 11% of its output.',
    goal: { kind: 'classic', victoryShare: 0.25 },
    recommended: { nation: 'united-arab-emirates', difficulty: 'normal' },
    tags: ['War', 'Chokepoint'],
    length: 'about 3 hours',
    ops: [
      { op: 'alliance', members: GULF },
      { op: 'war', a: 'iran', b: 'united-arab-emirates', lead: 12, months: 2 },
      { op: 'war', a: 'iran', b: 'kuwait', lead: 6, months: 2 },
      { op: 'military', who: 'iran', mult: 1.4 },
      { op: 'sanction', from: 'saudi-arabia', to: 'iran', months: 18 },
      { op: 'grudge', holder: ['saudi-arabia', 'qatar', 'oman'], target: 'iran', value: -25, label: 'Attacked our ally', reason: 'Attacked our ally', months: 12 },
      { op: 'market', resource: 'oil', pressure: 0.3 },
    ],
  },
  {
    id: 'rising-giant',
    title: 'The Rising Giant',
    tagline: 'A rival superpower is growing, with clients, a full treasury and a new fleet.',
    briefing: [
      'One power has gathered clients around it, filled its treasury and built a large modern army. Its neighbors are nervous. It has an old quarrel with one of them: you.',
      'You cannot match it yet. Find allies, buy time, strengthen the border, and look for the moment it stumbles. Or take what the giant has not yet grown into.',
    ],
    goalText: 'Take 6 countries, hold 35% of the world’s people, or reach 16% of its output.',
    goal: { kind: 'classic', victoryShare: 0.35 },
    recommended: { nation: 'india', difficulty: 'hard' },
    tags: ['Rival', 'Containment'],
    length: 'about 6 hours',
    ops: [
      { op: 'puppet', master: { first: ['china', 'united-states-of-america'] }, puppets: ['laos', 'cambodia', 'mongolia'] },
      { op: 'treasury', who: { first: ['china', 'united-states-of-america'] }, mult: 2.2 },
      { op: 'military', who: { first: ['china', 'united-states-of-america'] }, mult: 1.6, weapons: 1 },
      { op: 'techs', who: { first: ['china', 'united-states-of-america'] }, add: ['air_jets', 'land_mechanized', 'naval_destroyers'] },
      { op: 'grudge', holder: { first: ['china', 'united-states-of-america'] }, target: '$player', value: -25, label: 'Border dispute', reason: 'Border dispute', months: 18 },
    ],
  },
  {
    id: 'two-fronts',
    title: 'Two Fronts',
    tagline: 'You start the game already at war on two borders, and losing.',
    briefing: [
      'The war has already begun, and it is not going well. Two of your neighbors have crossed your borders, your people are tired, the treasury is thin, and the front is moving the wrong way.',
      'Your first job is not to win. It is to stop losing: hold the line, find friends, and find the peace table before it is too late. Then, if you can, take back the initiative.',
    ],
    goalText: 'Still stand, with your capital in your hands, three years from now.',
    goal: { kind: 'survive', months: 36 },
    recommended: { nation: 'poland', difficulty: 'normal' },
    tags: ['War', 'Comeback'],
    length: 'about 3 hours',
    ops: [
      { op: 'war', a: '$neighbor:strongest', b: '$player', lead: 22, months: 4 },
      { op: 'war', a: '$neighbor:2nd', b: '$player', lead: 14, months: 3 },
      { op: 'weariness', who: '$player', set: 22 },
      { op: 'stability', who: '$player', set: 48 },
      { op: 'treasury', who: '$player', mult: 0.7 },
      { op: 'military', who: '$player', mult: 0.85 },
      { op: 'guarantee', from: '$patron', to: '$player', months: 24 },
      { op: 'grudge', holder: '$patron', target: '$neighbor:strongest', value: -20, label: 'Attacked our friend', reason: 'Attacked our friend', months: 18 },
    ],
  },
  {
    id: 'powder-keg',
    title: 'Powder Keg',
    tagline: 'A crowded mountain region where every border is disputed and every neighbor is armed.',
    briefing: [
      'Small, proud, heavily armed nations are packed together between two big powers, and every border has a history. Disputes are in the news. A war has broken out between two of them, and a third crisis is brewing.',
      'It takes very little to start a larger war here. A quick, careful player can profit. A careless one will be burned.',
    ],
    goalText: 'Take 3 countries, hold 25% of the world’s people, or reach 11% of its output.',
    goal: { kind: 'classic', victoryShare: 0.25 },
    recommended: { nation: 'georgia', difficulty: 'normal' },
    tags: ['Crisis', 'Regional'],
    length: 'about 3 hours',
    ops: [
      { op: 'war', a: 'azerbaijan', b: 'armenia', lead: 6, months: 3 },
      { op: 'crisis', kind: 'dispute', nation: 'georgia', rival: 'russia', stage: 1 },
      { op: 'crisis', kind: 'dispute', nation: 'turkey', rival: 'iran', stage: 0 },
      { op: 'feud', sideA: ['azerbaijan', 'turkey'], sideB: ['armenia', 'iran'], value: -18, label: 'Regional rivalry' },
      { op: 'military', who: ['azerbaijan', 'armenia', 'georgia'], mult: 1.5 },
      { op: 'character', who: ['azerbaijan', 'armenia', 'georgia', 'turkey', 'iran'], aggressionMult: 1.25 },
    ],
  },
]

export const SCENARIO_BY_ID: Record<string, ScenarioDef> = Object.fromEntries(SCENARIOS.map((x) => [x.id, x]))

export const scenarioOf = (id: string | undefined | null): ScenarioDef | null => (id ? (SCENARIO_BY_ID[id] ?? null) : null)

export const TIER_NAMES: Record<number, string> = { 2: 'a Regional power', 3: 'a Great power', 4: 'a Superpower', 5: 'a Hegemon' }

/** The goal in one plain sentence, for the top bar and the end screen. Null for the game's own goals. */
export function scenarioGoalSentence(g: ScenarioGoal): string | null {
  switch (g.kind) {
    case 'survive':
      return `survive ${g.months} months with your capital in your hands`
    case 'tier':
      return `grow to ${TIER_NAMES[g.tier]} (${tierSpec(g.tier).countries} countries)${g.deadline ? ` within ${g.deadline} months` : ''}`
    case 'economy':
      return `reach ${(g.share * 100).toFixed(1)}% of the world\u2019s output${g.deadline ? ` within ${g.deadline} months` : ''}`
    default:
      return null
  }
}

/** The goal in a few words for a card: "Survive 5 years", "Take 3 countries". */
export function scenarioGoalShort(g: ScenarioGoal): string {
  switch (g.kind) {
    case 'world':
      return 'Hold every country'
    case 'classic':
      return g.victoryShare <= 0.25 ? 'Take 3 countries' : g.victoryShare >= 0.6 ? 'Take 12 countries' : 'Take 6 countries'
    case 'survive':
      return g.months % 12 === 0 ? `Survive ${g.months / 12} years` : `Survive ${g.months} months`
    case 'tier':
      return `Grow to ${TIER_NAMES[g.tier]}`
    case 'economy':
      return `${(g.share * 100).toFixed(1)}% of world output`
  }
}
