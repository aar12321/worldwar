export type CrisisKind = 'unrest' | 'dispute'

/** Months between one stage of a crisis and the next. */
export const CRISIS = {
  /** Months until the first rumor becomes a disturbance, and so on. Each gap is this, plus up to `jitter` more. */
  gap: 2,
  jitter: 2,
  /** Most crises running at once. */
  max: 3,
  /** Monthly chance a new one starts, before world tension adds to it. */
  spawn: 0.1,
  /** Chance the trouble boils over at the end, before anyone helps. */
  escalate: 0.7,
  /** Costs of answering. */
  aidMoney: 40,
  aidInfluence: 5,
  mediateInfluence: 15,
  supportInfluence: 10,
  /** How much each answer lowers the chance it boils over. */
  aidRelief: 0.4,
  mediateRelief: 0.3,
  supportRelief: 0.1,
}

export type CrisisAction = 'aid' | 'mediate' | 'support'

export const ACTION_LABELS: Record<CrisisAction, string> = {
  aid: 'Send aid',
  mediate: 'Mediate',
  support: 'Back them',
}

/** Headlines. Each stage tells a little more, and none arrives early. */
export const HEADLINES: Record<CrisisKind, string[]> = {
  unrest: [
    'Reports of unrest in {area}. Sources say {nation} is under strain.',
    'Protests spread across {nation}. The government has deployed security forces.',
    '{nation} is on the brink: the government begs its friends for help.',
  ],
  dispute: [
    'Diplomats in {area} warn of rising tension between {nation} and {rival}.',
    'Troops gather on the border of {nation}. {rival} denies planning an attack.',
    '{nation} says it faces invasion by {rival} and asks the world to stand with it.',
  ],
}

export const OUTCOMES = {
  unrestCalm: 'The unrest in {nation} has eased.',
  unrestBoils: '{nation} is rocked by uprisings. Rebels have seized part of the country.',
  disputeCalm: '{nation} and {rival} have stepped back from the brink.',
  disputeBoils: '{rival} has attacked {nation}. War has begun in {area}.',
}
