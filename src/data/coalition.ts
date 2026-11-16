/**
 * How the world reacts to a nation that grows too big. A leader's threat grows with its empire tier, its share of the world's
 * countries, people and output, and its reputation for aggression. The threat, scaled by the tier, is how eagerly rivals band
 * together against it, within what each difficulty allows.
 */
export const THREAT = {
  /** Points for the empire tier held, by tier 1 to 5. */
  tier: [0, 4, 12, 24, 38],
  /** Points for each percent of the world's countries, people and output (before any tier points). */
  perCountryShare: 0.9,
  perPeopleShare: 0.35,
  perOutputShare: 0.4,
  /** Points for each point of infamy. */
  perInfamy: 0.35,
  /** The threat score is capped here. */
  max: 100,
  /** Where each level starts. */
  levels: [0, 12, 27, 45, 65] as const,
  levelNames: ['Calm', 'Watched', 'Alarmed', 'United against you', 'Total mobilization'] as const,
  /**
   * How much of the threat turns into action, by the tier of the leader: Regional < Great < Superpower < Hegemon. A lone nation
   * (tier 1) is never a coalition's concern. The product `ramp * score / scoreFull` is the pressure, 0 to `maxPressure`.
   */
  ramp: [0, 0.25, 0.55, 0.85, 1],
  scoreFull: 60,
  maxPressure: 1.2,
}

export const COALITION = {
  /** Pressure at which a rival starts looking for partners against a leader, and at which a Hard rival joins an ally's war on it. */
  allyFrom: 0.1,
  pressFrom: 0.3,
  /** Pressure at which Hard rivals plan a joint strike, and the tier the leader must have reached. */
  planFrom: 0.3,
  planTier: 3,
  /** Rivals in a joint strike, by the leader's tier 3, 4 and 5. */
  fronts: { 3: 2, 4: 3, 5: 4 } as Record<number, number>,
  /** Months of warning between the plan and the strike, and months before the same leader is planned against again (shorter when it is at its worst). */
  lead: 2,
  rest: 14,
  restTotal: 7,
  /** Strongest rival one nation can be asked to bring: no member may be weaker than this share of the leader's own force. */
  minPower: 0.04,
  /** In a live game the strike leaves on a day within this range of the month (inclusive), the same for every member. */
  day: [3, 9] as const,
  /** Willingness to ally, call to arms and so on: this much extra score at full pressure. */
  allyBonus: 26,
  armsBonus: 20,
  /** Chance each month that a rival looking for a partner against a leader goes out and asks, at full pressure. */
  driveChance: 0.55,
  /** Extra alliances a Hard rival may keep while a leader is at or above this pressure. */
  extraAlliance: 0.5,
  /** Months a rival is rested after taking part in a strike before it will plan another. */
  memberRest: 6,
}
