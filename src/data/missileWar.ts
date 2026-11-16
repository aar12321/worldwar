import type { Doctrine, StrikeAim } from '../engine/types'

/**
 * The missile war: everything that turns "invest, then wait for the weapon to work" into a fight. Every number is here, so the war can be tuned
 * in one place and a test can put the old rules back (`MW.enabled = false`, see the withOldMissiles helper in the tests).
 *
 * The loop in one paragraph: raise radar and buy interceptor rounds and batteries (defence); decoys and big salvos burn the rounds, a
 * shield with no rounds left stops nothing (saturation); counterforce strikes and bomber raids at launch sites destroy the enemy's stock and
 * shut his launchers (offence); a doctrine answers for you; every strike raises the world's tension, which raises the risk of false alarms
 * and the world's judgement, until someone offers a ceasefire.
 */
export const MW = {
  /** Off: the old rules (no population damage from light missiles, no interceptor stock, no reports, no tension). Used only by tests. */
  enabled: true,

  // ---- Interceptors ----
  /** Interceptor rounds a shield level holds, and each air-defence battery adds. A nation with no shield and no battery holds none. */
  roundsPerShield: 8,
  roundsPerBattery: 4,
  /** Share of the full store that comes back each month. */
  regen: 0.5,
  /** Money for one round, and the most one order buys. */
  roundCost: 4,
  roundsMaxOrder: 40,
  // ---- Radar (early warning) ----
  radarMax: 3,
  radarMoney: [60, 140, 260],
  /** Each radar level adds this to the share of a salvo the defence stops (cueing the interceptors), and each finished aircraft node counts as a level (AWACS). */
  radarStop: 0.04,
  /** Aircraft developments that act as an airborne early-warning level each: radar network, integrated air shield. */
  awacsNodes: ['radar', 'iads'] as const,
  // ---- Air-defence batteries ----
  batteryMax: 3,
  batteryMoney: 90,
  /** Share of a salvo each battery in the struck country stops, before kind adjustments (cruise missiles are caught easiest). */
  batteryStop: 0.07,
  /** Threat to a raid: loss share each battery adds. */
  batteryFlak: 0.08,
  // ---- Mobile launchers ----
  mobileMax: 3,
  mobileMoney: [80, 160, 280],
  /** Each level cuts the share of missiles a counterforce strike finds, and shortens how long a hit launch site stays shut. */
  mobileHide: 0.25,
  // ---- Counterforce ----
  /** Months a launch site stays shut after a counterforce strike gets through, at most, and per missile that lands. */
  siteDownMax: 3,
  siteDownPer: 0.35,
  /** A counterforce strike does this share of the harm to people and the line that a strike on the country does. */
  siteHarm: 0.35,
  /** Months a recon sortie shows where the launchers are, and what it costs. */
  reconMonths: 3,
  reconMoney: 12,
  // ---- Scramble (live) ----
  /** Fighters scrambled against one salvo count this many times as much as fighters on the ground, and stop this much extra. */
  scrambleWing: 1.5,
  scrambleStop: 0.1,
  scrambleMoney: 8,
  // ---- Bomber raids ----
  raid: {
    money: 25,
    oil: 2,
    /** Strike aircraft (divisions of `air`) sent by default, and the least that makes a raid. */
    shareDefault: 0.5,
    minBombers: 0.25,
    /** Warheads' worth of missiles each surviving bomber division delivers, and the most. */
    perBomber: 3,
    /** Loss share of the raid with no defences, and what each defence adds. */
    baseLoss: 0.05,
    perFighter: 0.1,
    maxLoss: 0.7,
    /** Escorts (fighter divisions per bomber division) cut the losses by 1 / (1 + escort x this). */
    escortCover: 0.8,
    /** A raid cannot be repeated in this many months. */
    cooldown: 1,
  },
  // ---- Doctrine ----
  /** Share of the store a retaliation or a launch-on-warning fires, and the most missiles. */
  answerShare: 0.3,
  answerMax: 6,
  /** Chance per month, for a nation with a launch-on-warning doctrine and enemies at war, of a false alarm: base, grown by tension, cut by radar. */
  falseAlarm: 0.04,
  falseAlarmTension: 25,
  falseAlarmTensionAdd: 10,
  falseAlarmInfamy: 2,
  // ---- Tension and the ladder ----
  /** Tension lost each month, and the extra when nobody fired a missile that month. */
  tensionFade: 3,
  tensionQuietFade: 3,
  /** A counterforce strike raises tension this share as much. A nuclear strike adds this much. */
  siteTension: 0.6,
  nukeTension: 30,
  /** Share of the tension that counts as world tension in the crises track. */
  worldShare: 0.25,
  /** The ladder. A rung opens at its `from` tension. */
  ladder: [
    { name: 'Calm', from: 0, blurb: 'No missiles in the air. Nations talk.' },
    { name: 'Skirmish', from: 10, blurb: 'Isolated strikes. Rivals watch their radar.' },
    { name: 'Missile war', from: 30, blurb: 'Regular salvos. Interceptor stores run low and false alarms become a risk.' },
    { name: 'Strategic exchange', from: 55, blurb: 'Cities are being hit. The world judges every civilian death harder.' },
    { name: 'Nuclear brink', from: 80, blurb: 'One mistake from the bomb. Everyone wants a ceasefire.' },
  ],
  /** From this rung, the war-crime reputation of a missile is multiplied by this per rung above it. */
  crimeFromRung: 3,
  crimePerRung: 0.5,
  // ---- Ceasefires ----
  truceMonths: 6,
  /** An AI rival accepts a ceasefire when tension is at least this (by difficulty skill), or it has taken more harm than it dealt. */
  truceTension: [10, 25, 40],
  truceTensionDrop: 12,
  /** Infamy for lifting a ceasefire. */
  truceLiftInfamy: 3,
  // ---- The record ----
  keepSalvos: 40,
  /** War score a salvo gives: per point of Defense Line cut and per 1% of the people killed, at most per salvo. */
  scoreLine: 0.6,
  scorePerPercent: 0.5,
  scoreMax: 6,
  /** War weariness a nation gains for each 1% of its people killed. */
  weariness: 0.15,
  /** Stability the struck nation loses to one salvo, at most. */
  stabilityMax: 6,
  /** Infamy one salvo earns for civilian deaths, at most. */
  infamyMax: 6,
}

export const DOCTRINES: Record<Doctrine, { name: string; blurb: string }> = {
  hold: { name: 'Hold fire', blurb: 'Never answers on its own. Your orders decide every launch.' },
  retaliate: { name: 'Retaliate', blurb: 'When struck, answers with up to a third of the store at the launch site that hit you. Never answers an answer.' },
  warning: { name: 'Launch on warning', blurb: 'In a live game, fires the moment radar sees a salvo in the air, before it lands. Faster, but a false alarm can launch a salvo by mistake, more often as tension rises and less with better radar.' },
}

export const AIMS: Record<StrikeAim, { name: string; blurb: string }> = {
  country: { name: 'The country', blurb: 'Hits the people, the line, the factories and the army. All of the missile\'s harm.' },
  site: { name: 'Launch sites', blurb: `Counterforce. Destroys missiles in the enemy's stores and shuts his launchers for a few months, but does only ${Math.round(MW.siteHarm * 100)}% of the harm to people and the line. Needs a factory in the country, and mobile launchers hide from it unless a recon sortie found them.` },
}

export const DEFENSE_TEXT = {
  radar: { name: 'Early-warning radar', blurb: 'Shows incoming salvos the day they leave, cues your interceptors (each level stops a little more) and makes launch on warning safer.' },
  interceptors: { name: 'Interceptor rounds', blurb: 'The shield fires rounds at every missile that arrives. When the store runs dry it stops nothing. Rounds come back at half the store a month.' },
  battery: { name: 'Air-defence battery', blurb: 'A battery in one country stops a share of missiles aimed at it, holds more interceptor rounds, and shoots at enemy bombers.' },
  mobile: { name: 'Mobile launchers', blurb: 'Launchers on trucks. Counterforce strikes find fewer of your missiles and your sites reopen sooner, unless a recon sortie found them.' },
} as const

/** The rung of the ladder a tension is on, 0 to 4. */
export function rungOf(tension: number): number {
  let rung = 0
  MW.ladder.forEach((r, i) => {
    if (tension >= r.from) rung = i
  })
  return rung
}
