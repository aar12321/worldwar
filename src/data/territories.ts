/**
 * Territories: every number the rules in `engine/territories.ts` use.
 *
 * A territory is a vassal of a harder kind than a puppet. The master takes a fixed share of ALL its revenue for ever, it sits in the
 * master's faction for ever and fights in every war the master fights, and the master commands its army. In return it is loyal for
 * ever (no loyalty meter, no rebels, no breaking free), owes no war reparations, and its people are not the master's people.
 * Nothing here grows without limit: a territory is paid for at the peace table (`valueMult` times a puppet's price) and the number a
 * master may hold is held by its tier.
 */
export const TERRITORY = {
  /** The share of the territory's revenue (taxes + factories + trade + business tax, before its own costs) the master takes each month, for ever. */
  cut: 0.3,
  /** Price at the peace table, in war score: this many times the price of a puppet of the same size. */
  valueMult: 1.6,
  /** Most a territory can cost, whatever its size: the whole war score. */
  valueCap: 100,
  /** The most territories one master may hold, by its tier (1 Nation ... 5 Hegemon). */
  maxByTier: [1, 1, 2, 3, 4] as number[],
  /** A territory counts for this share of its countries toward its master's tier and the conquest goal (never toward people, output or workforce). */
  countWeight: 0.5,
  /** Months before a master may annex a territory outright. */
  annexMonths: 12,
  /** Influence to annex: the puppet price (per country) times this. */
  annexCostMult: 1.5,
  /** Land annexed from a territory comes in this share settled, as from a restive puppet. */
  annexIntegration: 0.6,
  /** Opinion the freed territory holds of a master that lets it go. */
  releaseOpinion: 25,
  /** Opinion a territory holds of the nation that made it one. */
  madeOpinion: -15,
  /** A master may order its territory's military only while the territory's own order count stays within the usual limits; these are the kinds of order it may give. */
  commands: ['queueTrain', 'cancelTrain', 'train', 'upgradeWeapons', 'attack', 'setDeployment', 'setAlert', 'recall', 'assignGeneral', 'cancelDeal', 'propose'] as const,
  /** A forced trade deal must give the territory back at least this share of the market value of what it gives (a master cannot drain it for nothing), and a territory holds at most this many trade deals. */
  forceFair: 0.7,
  maxDeals: 6,
  /** The AI: who asks for a territory at the peace table. Never Easy. `minNet` is the war score a master must have beyond the price. */
  ai: { minNet: [999, 999, 40], maxTerritories: [0, 0, 1], minLand: 30, maxRichness: 1.0 },
}

/** The rules of the peace table, in words, for the UI and the reports. */
export const TERRITORY_TEXT = {
  term: 'Make them a territory',
  hint: 'They become your territory for ever: you take 30% of all their revenue, they join your faction and fight in your wars, you command their army, and they owe you no reparations. They are not your people: their population does not count as yours.',
  describe: (name: string, master: string) => `${name} becomes a territory of ${master}: ${Math.round(TERRITORY.cut * 100)}% of its revenue goes to ${master} for ever`,
  log: (name: string, master: string) => `${name} is now a territory of ${master}.`,
  refusal: 'we will never be your territory',
}
