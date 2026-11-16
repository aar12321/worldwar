import { STRATEGIC_SEA_LANES } from './countries'

/** Alert levels: what readiness each aims for, and what keeping it costs the posted forces. */
export type AlertLevel = 'relaxed' | 'normal' | 'high'
export const ALERT_LEVELS: AlertLevel[] = ['relaxed', 'normal', 'high']

export const ALERT: Record<AlertLevel, { name: string; hint: string; target: number; upkeep: number; oil: number }> = {
  relaxed: { name: 'Relaxed', hint: 'Crews stand down. Cheaper, but slow to react.', target: 55, upkeep: -0.2, oil: -0.3 },
  normal: { name: 'Normal', hint: 'The usual watch.', target: 75, upkeep: 0, oil: 0 },
  high: { name: 'High alert', hint: 'Crews at stations, engines warm. Costs more upkeep and oil.', target: 95, upkeep: 0.25, oil: 0.4 },
}

/** The numbers behind forces being seen to be on station: what presence earns, what it risks, what it costs. Every value is a soft cap. */
export const PRESENCE = {
  /** Test switch: with it off, no month of presence is run and no readiness bends a combat number. The goldens return to what they were. */
  on: (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PRESENCE !== '0',
  /** Readiness (0 to 100). `readyBase` is where a force that never set an alert sits. It moves `readyStep` points a month toward its target. */
  readyBase: 75,
  readyStep: 12,
  /** Each point of readiness above or below the base moves the garrison's, the patrols' and the air screen's strengths by this much, between the two limits. */
  readyEffect: 0.006,
  readyMin: 0.8,
  readyMax: 1.2,
  /** A force with no oil left in the tank cannot keep its alert: this much is taken off the target. */
  drySupply: 25,
  /** Share of the income of a coastal nation that rides the sea. */
  seaShare: 0.25,
  /** Trade protected by patrols: the share of that income per square root of division on patrol, the most it is worth, and the share of the fleet's own upkeep it can never exceed (so a patrol never pays for itself). */
  tradePer: 0.03,
  tradeCap: 0.08,
  tradeVsUpkeep: 0.6,
  /** A held strait or canal adds this much of the sea income. */
  chokeValue: 0.04,
  /** The patrol a nation needs to hold a strait, and how much stronger than the other side it must be. */
  chokeMin: 0.5,
  chokeEdge: 1.5,
  /** A blockade at war: patrol advantage (in divisions) that is a full blockade, and the most of the sea income it takes. Sanctions enforced by patrols count for this share of it. */
  blockadeFull: 4,
  blockadeCut: 0.1,
  sanctionShare: 0.5,
  /** Watching: the chance each month to learn what a neighbor has is 1 - exp(-per * cover), the weights of each kind of patrol, how many months the sight lasts, and the most a nation learns in a month. */
  watchPer: 0.25,
  watchWeight: { coastal: 0.3, subs: 0.8, air: 0.6 },
  watchMonths: 2,
  watchMax: 3,
  /** Sorties flown a month by each division of air patrol. */
  sorties: 4,
  /** Incidents between patrols: the monthly chance for a pair of tense neighbors per point of tension, the tension from which they happen, and what each costs. */
  incidentPer: 0.0004,
  incidentFrom: 30,
  incidentLoss: 0.05,
  incidentHeat: 10,
  incidentOpinion: -6,
  /** Talks that ease a tense border between neighbors that are not on high alert: the monthly chance and the heat they take off. */
  easeChance: 0.12,
  easeHeat: 8,
  /** A show of force: what it costs (capital, oil), the months before the same one can be shown again, and what it does. */
  show: { capital: 6, capitalPerDivision: 1.5, oil: 2, cooldown: 6, heat: 14, opinion: -10, minDivisions: 0.5, drill: 0.15, drillCap: 3, ready: 8 },
  /** An exercise at home: more training, and a readiness that holds for a few months. */
  exercise: { capital: 10, capitalPerDivision: 1.2, oil: 3, cooldown: 9, drill: 0.3, drillCap: 3.5, ready: 12, months: 3 },
  /** How the AI reads a posted border: the share of its appetite a fully guarded border takes off, by skill (Easy, Medium, Hard). */
  deter: [0, 0.18, 0.3] as number[],
  /** The share an unguarded border adds to an aggressive nation's appetite. */
  probe: 0.08,
  /** Worry each division of ground troops across the border adds, as a share of the nation's own (the arms race). */
  mirror: 0.4,
}

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

/** What the narrow seas are called. */
const NAMES: Record<string, string> = {
  'united-states-of-america|united-kingdom': 'North Atlantic',
  'united-states-of-america|japan': 'North Pacific',
  'united-states-of-america|cuba': 'Florida Straits',
  'canada|greenland': 'Davis Strait',
  'greenland|iceland': 'Denmark Strait',
  'iceland|united-kingdom': 'GIUK Gap',
  'iceland|norway': 'Norwegian Sea',
  'brazil|nigeria': 'South Atlantic',
  'brazil|senegal': 'Atlantic Narrows',
  'brazil|south-africa': 'Cape Route',
  'argentina|south-africa': 'Southern Ocean',
  'argentina|falkland-is': 'Falklands Sound',
  'australia|indonesia': 'Timor Sea',
  'australia|new-zealand': 'Tasman Sea',
  'australia|papua-new-guinea': 'Torres Strait',
  'japan|russia': 'La Perouse Strait',
  'japan|taiwan': 'Ryukyu Gap',
  'japan|philippines': 'Philippine Sea',
  'madagascar|mozambique': 'Mozambique Channel',
  'india|sri-lanka': 'Palk Strait',
  'india|indonesia': 'Bay of Bengal',
  'mexico|cuba': 'Yucatan Channel',
  'spain|morocco': 'Strait of Gibraltar',
  'italy|libya': 'Central Mediterranean',
  'italy|tunisia': 'Sicilian Channel',
  'france|algeria': 'Western Mediterranean',
  'greece|egypt': 'Eastern Mediterranean',
  'turkey|cyprus': 'Cyprus Channel',
  'saudi-arabia|egypt': 'Red Sea',
  'yemen|djibouti': 'Bab-el-Mandeb',
  'panama|colombia': 'Panama Canal',
  'russia|united-states-of-america': 'Bering Strait',
  'china|taiwan': 'Taiwan Strait',
  'philippines|malaysia': 'Sulu Sea',
}

export interface ChokeDef {
  id: string
  name: string
  a: string
  b: string
}

/** The narrow seas and canals the map treats as strategic: each is a sea lane between two countries. */
export const CHOKEPOINTS: ChokeDef[] = STRATEGIC_SEA_LANES.map(([x, y]) => {
  const a = slug(x)
  const b = slug(y)
  return { id: `${a}|${b}`, name: NAMES[`${a}|${b}`] ?? `${x} - ${y} lane`, a, b }
})
