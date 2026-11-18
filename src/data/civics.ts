import type { GovernmentType } from '../engine/types'
import type { PolicyEffects } from './government'

/**
 * Civics: the government desk's people and machinery. A cabinet of ministers chosen from candidates, a civil service of a chosen size,
 * the nation's talent by profession and who uses it, the jobs picture, national policies that are drafted, voted and phased in, and
 * the interest groups that react to all of it. Every number the rules use is here, with what it means.
 *
 * Absent (`Nation.civics` undefined) a nation is exactly as before. A human nation is given a neutral desk at its first month end: no
 * ministers, a standard civil service and no new policies, which changes nothing until the player acts.
 */

/** Switch for the whole layer. Off, no nation is given a desk, no bot uses it and the old rules run exactly (see turnGolden.test.ts). */
export const CIVICS = { on: true }

// ---------------------------------------------------------------- talent

export type Profession = 'administrators' | 'economists' | 'diplomats' | 'engineers' | 'scientists' | 'doctors' | 'teachers' | 'officers' | 'spies'

export const PROFESSIONS: Profession[] = ['administrators', 'economists', 'diplomats', 'engineers', 'scientists', 'doctors', 'teachers', 'officers', 'spies']

export interface ProfessionSpec {
  name: string
  /** One person of it, for the candidate cards. */
  one: string
  blurb: string
  color: string
}

export const PROFESSION_SPECS: Record<Profession, ProfessionSpec> = {
  administrators: { name: 'Administrators', one: 'administrator', blurb: 'Run the ministries and the civil service. Short of them, a big state does less for its money.', color: '#64d2ff' },
  economists: { name: 'Economists', one: 'economist', blurb: 'Draft tax and industrial policy, staff finance and labour. They make every draft faster.', color: '#ffd60a' },
  diplomats: { name: 'Diplomats', one: 'diplomat', blurb: 'Staff the foreign ministry and the foreign agency.', color: '#5e5ce6' },
  engineers: { name: 'Engineers', one: 'engineer', blurb: 'Factories, Frontier systems, national projects, the space agency and the missile program all want them.', color: '#ff9f0a' },
  scientists: { name: 'Scientists', one: 'scientist', blurb: 'Universities, research and the space agency.', color: '#bf5af2' },
  doctors: { name: 'Doctors', one: 'doctor', blurb: 'Hospitals and health care.', color: '#30d158' },
  teachers: { name: 'Teachers', one: 'teacher', blurb: 'The schools. More spending on schools needs more of them.', color: '#ff6482' },
  officers: { name: 'Officers', one: 'officer', blurb: 'Lead the divisions. The academy trains more.', color: '#ac8e68' },
  spies: { name: 'Spies', one: 'spy', blurb: 'Staff the foreign and domestic agencies.', color: '#8e8e93' },
}

/**
 * The talent pool, as shares of the labour force. Engineers, scientists and doctors are the people model's own skills (they grow with
 * schooling, universities and a focus, and leave with emigration). The others are a share of the skilled workers, more with schooling.
 */
export const TALENT = {
  /** Share of the population in the labour force. */
  participation: 0.47,
  /** Shares of the skilled workers who are administrators, economists, diplomats and teachers, at schooling 0; times (0.6 + 0.8 * schooling). */
  ofSkilled: { administrators: 0.08, economists: 0.012, diplomats: 0.002, teachers: 0.07 },
  /** Officers: a share of the labour force, plus this much for each academy level. */
  officers: 0.0035,
  officersPerAcademy: 0.0008,
  /** Spies: a share of the labour force, a quarter more for each level of the two agencies together. */
  spies: 0.0004,
  spiesPerAgencyLevel: 0.25,
  /** Demand, as shares of the labour force. Administrators: per civil-service share. */
  adminPerService: 0.2,
  /** Economists: a base for the treasury and the bank, and this many thousand per bill being drafted. */
  economistsBase: 0.003,
  economistsPerBill: 4,
  /** Diplomats: a base, and per foreign-agency level. */
  diplomatsBase: 0.0008,
  diplomatsPerAgency: 0.0003,
  /** Teachers per level of school spending. */
  teachersPerSchools: 0.016,
  /** Officers: thousands per division. */
  officersPerDivision: 2.2,
  /** Spies: per level of each agency. */
  spiesPerAgency: 0.00012,
  /** Each minister draws this many thousand of their profession for the ministry's staff. */
  ministryStaff: 2,
  /** Engineers each missile program level draws, as a share of the workforce (counted only with the desk). */
  missileEngineers: 0.0015,
  /** A brain drain: each event takes this share of the professionals away, at most `drainMax`; it heals by `drainHeal` a month. */
  drainStep: 0.04,
  drainMax: 0.2,
  drainHeal: 0.004,
  /** Chance a month of a brain drain while people are leaving faster than `drainMigration`. */
  drainChance: 0.08,
  drainMigration: -0.0003,
}

// ---------------------------------------------------------------- cabinet

export type MinistryId = 'finance' | 'interior' | 'foreign' | 'defence' | 'health' | 'education' | 'labour' | 'industry' | 'science'

export const MINISTRIES: MinistryId[] = ['finance', 'interior', 'foreign', 'defence', 'health', 'education', 'labour', 'industry', 'science']

/** What a minister can change. `PolicyEffects` fields, plus the people's jobs, health and schooling, officials' capacity and the treasury. */
export interface CivicEffect extends Partial<PolicyEffects> {
  /** Added to the unemployment the nation is heading for. Negative means more jobs. */
  jobs?: number
  /** Added to the health the nation is heading for. */
  health?: number
  /** Added to the schooling the nation is heading for. */
  schooling?: number
  /** Added to how many countries the officials can run. */
  admin?: number
  /** Share of gross income gained (positive) or lost each month, on the 'Government' money line. */
  treasury?: number
  /** Share by which the talent pool grows. */
  talent?: number
}

export interface MinistrySpec {
  name: string
  title: string
  profession: Profession
  blurb: string
  /** What a minister of competence 100, with a fully staffed ministry, does. Competence 50 does half. */
  effects: CivicEffect
}

export const MINISTRY_SPECS: Record<MinistryId, MinistrySpec> = {
  finance: { name: 'Finance', title: 'Minister of Finance', profession: 'economists', blurb: 'Collects taxes better and wastes less.', effects: { treasury: 0.04 } },
  interior: { name: 'Interior', title: 'Minister of the Interior', profession: 'administrators', blurb: 'Order at home and officials who can run more.', effects: { stability: 2, admin: 1.5 } },
  foreign: { name: 'Foreign Affairs', title: 'Foreign Minister', profession: 'diplomats', blurb: 'Influence abroad, and every nation thinks a little better of you.', effects: { influence: 0.6, trade: 0.06 } },
  defence: { name: 'Defence', title: 'Minister of Defence', profession: 'officers', blurb: 'Cheaper forces and a people that tire of war more slowly.', effects: { upkeep: -0.08, weariness: -0.15 } },
  health: { name: 'Health', title: 'Minister of Health', profession: 'doctors', blurb: 'Better health care for the same money.', effects: { health: 0.03 } },
  education: { name: 'Education', title: 'Minister of Education', profession: 'teachers', blurb: 'Better schools, and a little more research.', effects: { schooling: 0.03, research: 0.03 } },
  labour: { name: 'Labour', title: 'Minister of Labour', profession: 'economists', blurb: 'Matches the jobless with jobs: lower unemployment.', effects: { jobs: -0.015, stability: 0.6 } },
  industry: { name: 'Industry', title: 'Minister of Industry', profession: 'engineers', blurb: 'Factories and businesses grow faster.', effects: { factory: 0.06, growth: 0.06 } },
  science: { name: 'Science', title: 'Minister of Science', profession: 'scientists', blurb: 'More research from every lab.', effects: { research: 0.08 } },
}

export type Ideology = 'reformer' | 'conservative' | 'technocrat' | 'populist' | 'hardliner'

export const IDEOLOGIES: Ideology[] = ['reformer', 'conservative', 'technocrat', 'populist', 'hardliner']

export type GroupId = 'business' | 'labour' | 'military' | 'faithful' | 'regions'

export const GROUPS: GroupId[] = ['business', 'labour', 'military', 'faithful', 'regions']

export const IDEOLOGY_SPECS: Record<Ideology, { name: string; blurb: string; groups: Partial<Record<GroupId, number>> }> = {
  reformer: { name: 'Reformer', blurb: 'Wants change. Business and workers like it, tradition does not.', groups: { business: 3, labour: 2, faithful: -3 } },
  conservative: { name: 'Conservative', blurb: 'Keeps things as they are. Tradition and the provinces approve.', groups: { faithful: 5, regions: 3, labour: -2 } },
  technocrat: { name: 'Technocrat', blurb: 'Numbers first. Business trusts them; the provinces feel unheard.', groups: { business: 4, regions: -2 } },
  populist: { name: 'Populist', blurb: 'Speaks for the street. Workers cheer, business worries.', groups: { labour: 5, regions: 2, business: -4 } },
  hardliner: { name: 'Hardliner', blurb: 'Order and strength. The army approves; workers do not.', groups: { military: 6, faithful: 2, labour: -3 } },
}

export const CABINET = {
  /** Candidates offered for each ministry, and how often a new list is drawn (months). */
  candidates: 3,
  regenMonths: 12,
  /** Trait ranges of a candidate, 0 to 100. Competence rises with how well the profession is staffed. */
  competence: [30, 90] as [number, number],
  loyalty: [25, 95] as [number, number],
  corruption: [0, 60] as [number, number],
  popularity: [15, 85] as [number, number],
  /** Competence added for each 0.1 of profession coverage above 1 (taken away below it), at most +-10. */
  competencePerCoverage: 10,
  /** Salary a month: this much per square root of (population / 10 million), times (0.5 + competence / 100), plus a floor. About 0.4 for a good minister of a 40-million nation. */
  salaryPerPop: 0.12,
  salaryFloor: 0.1,
  /** Months of salary paid on appointment. */
  signing: 3,
  /** Stability lost on a dismissal, plus this much per 10 points of popularity above 50. */
  fireStability: 2,
  firePerPopularity: 0.5,
  /** Months before a ministry can be filled again after a dismissal or resignation. */
  vacancyMonths: 1,
  /** Money lost a month to a minister's corruption: corruption 100 wastes this share of gross. */
  wastePerCorruption: 0.012,
  /** Monthly chance of a scandal at corruption 100 (halved by an anti-corruption agency, a fifth by a purge). */
  scandalChance: 0.06,
  scandalStability: 3,
  scandalPopularity: 25,
  /** Below this popularity a minister in a scandal resigns. */
  resignPopularity: 25,
  /** Below this loyalty a minister may resign, with this chance a month. */
  disloyal: 25,
  resignChance: 0.08,
  /** Loyalty lost a month while approval is below `unhappyApproval`; gained while above `happyApproval`. */
  loyaltyDrift: 1,
  unhappyApproval: 40,
  happyApproval: 60,
  /** Competence gained a month in office (experience), up to `competenceCap`. */
  experience: 0.25,
  competenceCap: 99,
  /** Opinion of every other nation for a foreign minister of competence 100. */
  foreignOpinion: 5,
}

/** Names for candidates: a given name and a family name, from neutral syllables. */
export const NAME_PARTS = {
  first: ['Ada', 'Ari', 'Bela', 'Cora', 'Dan', 'Eli', 'Ema', 'Ivo', 'Jana', 'Kai', 'Lena', 'Leo', 'Mara', 'Milo', 'Nia', 'Omar', 'Pia', 'Rui', 'Sana', 'Teo', 'Uma', 'Vera', 'Yan', 'Zara'],
  last: ['Arden', 'Basri', 'Calder', 'Dorin', 'Ekman', 'Farro', 'Galen', 'Halvor', 'Ilves', 'Jarek', 'Kovar', 'Lindqvist', 'Marek', 'Novak', 'Orsini', 'Petrov', 'Quint', 'Rasko', 'Sorel', 'Tamm', 'Ulver', 'Varga', 'Weller', 'Zoric'],
}

// ---------------------------------------------------------------- civil service

export const SERVICE = {
  levels: ['Lean', 'Small', 'Standard', 'Large', 'Vast'],
  /** The level every nation has: no effect either way. */
  standard: 2,
  /** Share of the labour force in public-sector jobs. */
  share: [0.07, 0.1, 0.13, 0.17, 0.22],
  /** Added to the unemployment the nation heads for: a big state hires the jobless. */
  jobs: [0.014, 0.007, 0, -0.009, -0.018],
  /** Money a month per unit of workforce, against the standard (negative is a saving). */
  cost: [-0.12, -0.06, 0, 0.1, 0.22],
  /** Added to how many countries the officials can run (times administrator coverage). */
  admin: [-1.5, -0.7, 0, 1, 2],
  /** Stability from public services (times administrator coverage). */
  stability: [-1.5, -0.7, 0, 0.8, 1.4],
  /** Output lost as the state crowds out private business (negative), or gained as it gets out of the way. */
  output: [0.015, 0.008, 0, -0.012, -0.03],
  /** Interest groups: labour and the provinces like a big state, business a small one. */
  groups: [
    { business: 6, labour: -6, regions: -4 },
    { business: 3, labour: -3, regions: -2 },
    {},
    { business: -3, labour: 3, regions: 2 },
    { business: -6, labour: 6, regions: 4 },
  ] as Partial<Record<GroupId, number>>[],
}

// ---------------------------------------------------------------- national policies

export type PolicyAreaId = 'taxReform' | 'industrial' | 'labourLaw' | 'antiCorruption' | 'centralBank' | 'digitalGov' | 'talentVisas'

export const POLICY_AREAS: PolicyAreaId[] = ['taxReform', 'industrial', 'labourLaw', 'antiCorruption', 'centralBank', 'digitalGov', 'talentVisas']

export interface PolicyOptionSpec {
  name: string
  blurb: string
  effects: CivicEffect
  /** How each group feels about it, about -10 to +10. */
  groups: Partial<Record<GroupId, number>>
}

export interface PolicyAreaSpec {
  name: string
  blurb: string
  /** The ministry whose minister drafts it faster. */
  ministry: MinistryId
  /** Months to draft with no minister and a fully staffed profession. */
  draftMonths: number
  /** Influence to start drafting. */
  cost: number
  /** What the nation has before any reform: no effect. */
  standard: string
  options: Record<string, PolicyOptionSpec>
}

export const POLICY_SPECS: Record<PolicyAreaId, PolicyAreaSpec> = {
  taxReform: {
    name: 'Tax reform',
    blurb: 'How the income tax is shaped. The rate itself stays in the Budget tab.',
    ministry: 'finance',
    draftMonths: 4,
    cost: 10,
    standard: 'mixed',
    options: {
      mixed: { name: 'Mixed brackets', blurb: 'The tax code as it stands.', effects: {}, groups: {} },
      flat: { name: 'Flat tax', blurb: 'One rate for all. Business grows faster; the treasury takes a little less and workers resent it.', effects: { growth: 0.06, treasury: -0.008, stability: -0.5 }, groups: { business: 8, labour: -6 } },
      progressive: { name: 'Progressive brackets', blurb: 'The rich pay more. The treasury and workers gain; business grows more slowly.', effects: { treasury: 0.012, growth: -0.03, stability: 0.8, taxSensitivity: -0.1 }, groups: { labour: 7, business: -6 } },
    },
  },
  industrial: {
    name: 'Industrial policy',
    blurb: 'How far the state steers industry.',
    ministry: 'industry',
    draftMonths: 4,
    cost: 10,
    standard: 'standard',
    options: {
      standard: { name: 'Light touch', blurb: 'Industry runs itself, with the usual help.', effects: {}, groups: {} },
      market: { name: 'Free market', blurb: 'Fewer rules and favours. Business grows; factories get no special help.', effects: { growth: 0.06, factory: -0.02 }, groups: { business: 6, labour: -3 } },
      strategic: { name: 'Strategic industries', blurb: 'Cheap credit and contracts for chosen industries. Factories and research gain; it costs a little.', effects: { factory: 0.06, research: 0.02, treasury: -0.008 }, groups: { business: 2, regions: 3, military: 2 } },
      stateLed: { name: 'State-led industry', blurb: 'Five-year plans. Factories and jobs, but private business stalls.', effects: { factory: 0.08, growth: -0.06, jobs: -0.008 }, groups: { labour: 5, business: -8, military: 2 } },
    },
  },
  labourLaw: {
    name: 'Labour law',
    blurb: 'How easily firms hire and fire. Works with the minimum wage and jobs programs in the People tab.',
    ministry: 'labour',
    draftMonths: 3,
    cost: 8,
    standard: 'standard',
    options: {
      standard: { name: 'Standard', blurb: 'The usual contracts and protections.', effects: {}, groups: {} },
      flexible: { name: 'Flexible contracts', blurb: 'Easy to hire, easy to fire: more jobs and growth, less security.', effects: { jobs: -0.01, growth: 0.03, stability: -0.8 }, groups: { business: 7, labour: -8 } },
      protective: { name: 'Strong protections', blurb: 'Secure jobs and calm workers, but firms hire less.', effects: { jobs: 0.006, stability: 1, output: -0.01 }, groups: { labour: 8, business: -6 } },
    },
  },
  antiCorruption: {
    name: 'Anti-corruption',
    blurb: 'How hard the state goes after graft, its own ministers included.',
    ministry: 'interior',
    draftMonths: 3,
    cost: 10,
    standard: 'standard',
    options: {
      standard: { name: 'Ordinary courts', blurb: 'The police and courts as they are.', effects: {}, groups: {} },
      agency: { name: 'Anti-corruption agency', blurb: 'An independent watchdog. Less waste, half the ministers\' scandals.', effects: { treasury: 0.01, output: 0.008 }, groups: { business: 2, labour: 2, regions: -2 } },
      purge: { name: 'Purge', blurb: 'Arrests at the top. Waste all but ends, but the powerful are frightened and angry.', effects: { treasury: 0.018, stability: -1.5 }, groups: { military: -5, faithful: -2, business: -3, labour: 4 } },
    },
  },
  centralBank: {
    name: 'Central bank',
    blurb: 'Who the bank answers to. The interest rate itself stays in the Bank tab.',
    ministry: 'finance',
    draftMonths: 5,
    cost: 12,
    standard: 'standard',
    options: {
      standard: { name: 'Answers to the treasury', blurb: 'The bank as it is.', effects: {}, groups: {} },
      independent: { name: 'Independent', blurb: 'Markets trust the currency: business grows and trades more.', effects: { growth: 0.03, trade: 0.04, treasury: -0.004 }, groups: { business: 6, labour: -2 } },
      political: { name: 'Under the government', blurb: 'Cheap money for the state. The treasury gains; business is wary.', effects: { treasury: 0.01, growth: -0.03 }, groups: { labour: 3, business: -6 } },
    },
  },
  digitalGov: {
    name: 'Digital government',
    blurb: 'Forms, taxes and records online. Needs engineers.',
    ministry: 'science',
    draftMonths: 6,
    cost: 12,
    standard: 'paper',
    options: {
      paper: { name: 'Paper and counters', blurb: 'Queues and stamps.', effects: {}, groups: {} },
      eServices: { name: 'E-services', blurb: 'Most forms online. Officials run more, and a little is saved.', effects: { output: 0.008, admin: 0.6, treasury: 0.004 }, groups: { business: 3, regions: -1 } },
      digitalFirst: { name: 'Digital first', blurb: 'Everything online. Officials run much more; the countryside feels left behind.', effects: { output: 0.016, admin: 1.2, upkeep: -0.02, treasury: 0.006 }, groups: { business: 5, regions: -4, faithful: -2 } },
    },
  },
  talentVisas: {
    name: 'Talent visas',
    blurb: 'Immigration for professionals, beside the immigration policy in the People tab.',
    ministry: 'interior',
    draftMonths: 3,
    cost: 8,
    standard: 'none',
    options: {
      none: { name: 'No special visas', blurb: 'Professionals come like anyone else.', effects: {}, groups: {} },
      skilled: { name: 'Skilled-worker visas', blurb: 'A fast lane for professionals: a tenth more talent.', effects: { talent: 0.1, stability: -0.3 }, groups: { business: 4, labour: -2 } },
      talentHunt: { name: 'Global talent hunt', blurb: 'Grants and fast passports for the best: a fifth more talent and more research, at a price.', effects: { talent: 0.2, research: 0.02, treasury: -0.006 }, groups: { business: 6, labour: -3, faithful: -4 } },
    },
  },
}

export const PIPELINE = {
  /** Bills being drafted or voted on at once. */
  maxBills: 2,
  /** Drafting goes this much faster with a minister of competence 100 for the area. */
  ministerSpeed: 0.6,
  /** The draft speed is also times the coverage of economists, between these bounds. */
  staffMin: 0.6,
  staffMax: 1.2,
  /** Months a finished draft waits before its vote, for lobbying. */
  voteMonths: 1,
  /** Influence for one round of lobbying, the most rounds, and what each adds to the chance of passing. */
  lobbyCost: 6,
  lobbyMax: 3,
  lobbyChance: 0.08,
  /** Chance of passing: a base by government, then approval, stability and the groups' feelings about the option. */
  base: { democracy: 0.55, monarchy: 0.72, junta: 0.8, one_party: 0.88 } as Record<GovernmentType, number>,
  perApproval: 0.006,
  perStability: 0.004,
  /** At most this much from the groups' support of the option (support is -1 to 1). */
  support: 0.25,
  min: 0.05,
  max: 0.97,
  /** Months a passed policy takes to phase in fully. */
  phaseMonths: 6,
  /** Name of the body that votes, by government. */
  body: { democracy: 'Parliament', monarchy: 'Royal council', junta: 'Military council', one_party: 'Party congress' } as Record<GovernmentType, string>,
}

// ---------------------------------------------------------------- interest groups

export const GROUP_SPECS: Record<GroupId, { name: string; blurb: string; color: string }> = {
  business: { name: 'Business', blurb: 'Owners, bankers and employers. They want low taxes, free markets and a small state.', color: '#ffd60a' },
  labour: { name: 'Labour', blurb: 'Workers and unions. They want jobs, protections and fair taxes.', color: '#ff6482' },
  military: { name: 'Military', blurb: 'The officers. They want strength, respect and money for the forces.', color: '#ac8e68' },
  faithful: { name: 'Tradition', blurb: 'The clergy and the traditional. They want stability and the old ways.', color: '#bf5af2' },
  regions: { name: 'Provinces', blurb: 'Towns and the countryside away from the capital. They want services and to be heard.', color: '#30d158' },
}

export const GROUPS_RULES = {
  /** How much each group counts, by government. */
  weight: {
    democracy: { business: 1, labour: 1.2, military: 0.6, faithful: 0.8, regions: 1 },
    monarchy: { business: 1, labour: 0.7, military: 1, faithful: 1.4, regions: 1 },
    junta: { business: 0.8, labour: 0.5, military: 2, faithful: 0.8, regions: 0.7 },
    one_party: { business: 0.6, labour: 1.2, military: 1.2, faithful: 0.5, regions: 0.8 },
  } as Record<GovernmentType, Record<GroupId, number>>,
  /** Stability from what the government chose (ministers, policies, the civil service): per point of a group's feeling, times its weight. */
  stabilityPerPoint: 0.06,
  /** Each group's feeling from choices counts at most this much either way. */
  choiceCap: 25,
  /** Mood from the times (not choices, so no stability, but shown and counted in approval and votes). */
  mood: {
    /** Business: per point of corporate tax above 15%, and of income tax above 25%. */
    businessCorpTax: -0.8,
    businessTax: -0.5,
    /** Labour: per point of unemployment above 6%. */
    labourJobless: -2.5,
    /** Military: at war, and per point of war weariness. */
    militaryWar: 6,
    militaryWeariness: -0.3,
    /** Tradition: per point of stability away from 50. */
    faithfulStability: 0.2,
    /** Provinces: per conquered country not yet settled, and per country over the officials' capacity. */
    regionsOccupied: -2,
    regionsOver: -3,
  },
}

/** Monthly records of the jobs picture kept for the charts (human nations only). */
export const JOBS_HISTORY = 36

export type Sector = 'agriculture' | 'industry' | 'services' | 'public' | 'military' | 'research'

export const SECTORS_ORDER: Sector[] = ['agriculture', 'industry', 'services', 'public', 'military', 'research']

export const SECTOR_SPECS: Record<Sector, { name: string; color: string }> = {
  agriculture: { name: 'Farming', color: '#30d158' },
  industry: { name: 'Industry', color: '#ff9f0a' },
  services: { name: 'Services', color: '#0a84ff' },
  public: { name: 'Public sector', color: '#64d2ff' },
  military: { name: 'Military', color: '#ac8e68' },
  research: { name: 'Research', color: '#bf5af2' },
}

export const EMPLOYMENT = {
  /** Farming: a share of private jobs that falls as the land develops, plus a little per farm per unit of workforce. */
  farmBase: 0.5,
  farmPerDevelopment: -0.5,
  farmPerFarm: 0.04,
  farmMin: 0.03,
  farmMax: 0.6,
  /** Industry: a base share, plus per factory per unit of workforce. */
  industryBase: 0.18,
  industryPerFactory: 0.06,
  industryMax: 0.45,
  /** People in uniform: thousands per division. */
  perDivision: 25,
  /** Research: the scientists, and every space-agency staffer (counted in thousands). */
  researchShare: 0.6,
}

// ---------------------------------------------------------------- state and orders

export interface Minister {
  /** `ministry-epoch-index`: unique within a nation's game. */
  id: string
  name: string
  ministry: MinistryId
  /** 0 to 100: how much of the ministry's effect they deliver. */
  competence: number
  /** 0 to 100: low loyalty may resign. */
  loyalty: number
  ideology: Ideology
  /** 0 to 100: money wasted and the chance of a scandal. */
  corruption: number
  /** 0 to 100: adds to approval; a popular minister is dear to dismiss. */
  popularity: number
  /** Turn appointed. */
  since: number
}

export interface Bill {
  id: number
  area: PolicyAreaId
  option: string
  stage: 'drafting' | 'vote'
  /** Months of work left (drafting) or months to the vote. */
  left: number
  /** Months of work it needed, for the progress bar. */
  total: number
  /** Rounds of lobbying bought. */
  lobby: number
}

export interface PolicyInForce {
  option: string
  /** 0 to 1: how far it has phased in. */
  phase: number
  since: number
}

/** One month of the jobs picture, in millions of people. */
export interface JobsPoint {
  turn: number
  force: number
  /** Employed by sector, in `SECTORS_ORDER` order. */
  sectors: number[]
  unemployment: number
}

export interface CivicsState {
  cabinet: Partial<Record<MinistryId, Minister>>
  /** Civil service level, 0 to 4 (2 is standard). */
  service: number
  policies: Partial<Record<PolicyAreaId, PolicyInForce>>
  bills: Bill[]
  /** Next bill id. */
  nextBill: number
  /** Share of professionals lost to brain drain, healing over time. */
  drain: number
  /** The labour force at the last month end, in millions: what thousands of staff are measured against. */
  force: number
  /** Turn until which each ministry stays empty after a dismissal or resignation. */
  vacantUntil: Partial<Record<MinistryId, number>>
  /** Human nations only: the jobs picture month by month. */
  history: JobsPoint[]
}

export type CivicsAction =
  | { kind: 'appoint'; ministry: MinistryId; candidate: string }
  | { kind: 'dismiss'; ministry: MinistryId }
  | { kind: 'service'; level: number }
  | { kind: 'draft'; area: PolicyAreaId; option: string }
  | { kind: 'lobby'; bill: number }
  | { kind: 'withdraw'; bill: number }
