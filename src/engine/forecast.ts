import { FRONTIER } from '../data/systems'
import { TERRAIN } from '../data/terrain'
import { TRAINING, trainingRank } from '../data/unitTypes'
import { STANCES, WAR, type Commit, type Stance } from '../data/war'
import { bomberBonus } from './aircraft'
import { COMBAT, airSuperiority, hasCombinedArms, resolveBattle, sidePower } from './combat'
import { lineMax } from './economy'
import { emptyUnits, totalUnits } from './helpers'
import type { Rng } from './rng'
import { createRng } from './rng'
import type { GameState, NationId, RegionId, UnitCounts, WorldMap } from './types'
import { UNIT_TYPES } from './types'
import { batteryThrough, blitzSpec, gunBonus, prepareAttack } from './warfare'

/**
 * The win-probability forecast. A pure function of the game state and a plan: it runs the REAL battle (`resolveBattle`, the same
 * function the fight itself uses) many times on fixed, evenly spread dice, so the number a player sees is the number the fight
 * is drawn from. Nothing here touches the random streams of the game, so asking costs nothing and changes nothing.
 *
 * The dice are a low-discrepancy (Kronecker) sequence rather than random numbers: the same plan always gives the same answer, a
 * small change to the plan moves the answer a little (not at random), and a hundred runs are about as good as a few hundred drawn
 * blindly. src/engine/__tests__/forecast.test.ts checks it against long simulations of `resolveAttack` itself.
 */

export interface AttackPlan {
  target: RegionId
  stance: Stance
  commit?: Commit
  share?: number
  /** Units named one by one. When present they replace the commit and the share. */
  units?: Partial<UnitCounts>
  missiles?: number
}

export type Tone = 'good' | 'bad' | 'neutral'

export interface Factor {
  id: string
  label: string
  /** One short line: the number or the fact. */
  summary: string
  /** What it means and how it works, for the tooltip. */
  tip: string
  /** Whether it helps the attacker (good), hurts (bad) or is just there. */
  tone: Tone
}

export interface Forecast {
  /** Chance the attacker wins the battle (0 to 1). */
  winChance: number
  /** An honest range for `winChance` at about 90%: the width of the estimate, not of the fight. */
  low: number
  high: number
  runs: number
  /** Chance the country falls to this one attack. */
  captureChance: number
  /** Average Defense Line points pushed back, counting losses as zero. */
  lineDamage: number
  lineBefore: number
  lineMax: number
  yourLosses: number
  theirLosses: number
  yourLossByUnit: UnitCounts
  theirLossByUnit: UnitCounts
  /** Starting strength of each side with every kind weighted evenly (the number the fight is drawn from). */
  attackerPower: number
  defenderPower: number
  /** The force that will fight, after any patrols on the way in. */
  sent: UnitCounts
  /** Share of the reserve it is. */
  share: number
  label: 'Likely' | 'Even' | 'Unlikely'
  factors: Factor[]
}

const PHI = (() => {
  // The generalised golden ratio for 12 dimensions (two fortunes and up to ten rounds' dice): the real root of x^13 = x + 1.
  let x = 2
  for (let i = 0; i < 80; i++) x = Math.pow(1 + x, 1 / 13)
  return x
})()
const ALPHA = Array.from({ length: 12 }, (_, j) => 1 / Math.pow(PHI, j + 1))
const frac = (v: number) => v - Math.floor(v)

/** A stand-in random stream: the `i`th point of an evenly spread sequence, shifted by `shift`. Only what `resolveBattle` calls is needed. */
function evenDice(i: number, shift: number[]): Rng {
  let d = 0
  const next = () => {
    const j = d++ % ALPHA.length
    return Math.min(0.999999, frac(shift[j] + (i + 1) * ALPHA[j]))
  }
  return { next, range: (a, b) => a + next() * (b - a), int: (a, b) => a + Math.floor(next() * (b - a + 1)), chance: (p) => next() < p, pick: (items) => items[Math.floor(next() * items.length)] }
}

/** Evenly spread runs of the real fight. 256 is within about a point of a very long simulation; 96 was not good enough (see forecast.test.ts). */
const DEFAULT_RUNS = 256

export const labelFor = (p: number): Forecast['label'] => (p >= 0.7 ? 'Likely' : p >= 0.4 ? 'Even' : 'Unlikely')

/** Runs the real fight many times and explains the result. Null when the attack cannot be made. */
export function forecastPlan(s: GameState, map: WorldMap, nationId: NationId, plan: AttackPlan, runs: number = DEFAULT_RUNS, withFactors = true): Forecast | null {
  const setup = prepareAttack(s, map, nationId, plan.target, plan.commit ?? 'main', plan.stance, plan.missiles, undefined, plan.share, plan.units)
  if (!setup) return null
  const mr = map.regions[plan.target]
  const region = s.regions[plan.target]
  const max = lineMax(s, map, plan.target)
  const before = Math.min(region.line, max)
  const spec = blitzSpec(s.nations[nationId], plan.stance)
  const defenderShield = s.nations[region.owner]?.systems?.shield ?? 0
  const missileCut = setup.attacker.units.missile * FRONTIER.missileLine * batteryThrough(setup.attacker, setup.defender, defenderShield)
  const guns = gunBonus(setup.attacker.units, plan.stance) * bomberBonus(setup.attacker.air, setup.attacker.units)
  const shiftRng = createRng(s.seed, 7711 + plan.target.length * 31 + (plan.target.charCodeAt(0) || 0))
  const shift = ALPHA.map(() => shiftRng.next())
  let wins = 0
  let damage = 0
  let captures = 0
  const mine = emptyUnits()
  const theirs = emptyUnits()
  let attackerPower = 0
  let defenderPower = 0
  for (let i = 0; i < runs; i++) {
    const out = resolveBattle({ attacker: setup.attacker, defender: setup.defender, terrain: mr.terrain, coastal: mr.coastal }, evenDice(i, shift))
    for (const k of UNIT_TYPES) {
      mine[k] += out.attackerLosses[k]
      theirs[k] += out.defenderLosses[k]
    }
    attackerPower = out.attackerPower
    defenderPower = out.defenderPower
    if (out.winner !== 'attacker') continue
    wins++
    const ratio = Math.min(WAR.maxPowerRatio, Math.max(WAR.minPowerRatio, out.attackerPower / Math.max(0.1, out.defenderPower)))
    const push = WAR.advanceBase * ratio * spec.advance * guns
    damage += Math.min(before, push + missileCut)
    if (push + missileCut >= before) captures++
  }
  const p = wins / runs
  // The estimate's own error: a few hundred evenly spread runs are about twice as good as blind ones, so half the usual width.
  const margin = Math.max(0.01, 1.645 * 0.5 * Math.sqrt(Math.max(0.0025, p * (1 - p)) / runs))
  for (const k of UNIT_TYPES) {
    mine[k] /= runs
    theirs[k] /= runs
  }
  const f: Forecast = {
    winChance: p,
    low: Math.max(0, p - margin),
    high: Math.min(1, p + margin),
    runs,
    captureChance: captures / runs,
    lineDamage: damage / runs,
    lineBefore: before,
    lineMax: max,
    yourLosses: totalUnits(mine),
    theirLosses: totalUnits(theirs),
    yourLossByUnit: mine,
    theirLossByUnit: theirs,
    attackerPower,
    defenderPower,
    sent: { ...setup.attacker.units },
    share: setup.share,
    label: labelFor(p),
    factors: [],
  }
  if (withFactors) f.factors = explain(s, map, plan, setup, missileCut)
  return f
}

const weighted = (units: UnitCounts, of: (k: (typeof UNIT_TYPES)[number]) => number) => {
  const total = totalUnits(units)
  if (total <= 0) return 0
  let sum = 0
  for (const k of UNIT_TYPES) sum += units[k] * of(k)
  return sum / total
}

/** The parts of the fight a player can act on, each with what it does to the odds. The same inputs `resolveBattle` reads. */
function explain(s: GameState, map: WorldMap, plan: AttackPlan, setup: NonNullable<ReturnType<typeof prepareAttack>>, missileCut: number): Factor[] {
  const att = setup.attacker
  const def = setup.defender
  const mr = map.regions[plan.target]
  const even = { infantry: 1, armor: 1, artillery: 1, fighter: 1, air: 1, naval: 1, drone: 1, robot: 1, missile: 1 }
  const out: Factor[] = []
  const add = (id: string, label: string, summary: string, tip: string, tone: Tone) => out.push({ id, label, summary, tip, tone })
  const aTotal = totalUnits(att.units)
  const dTotal = totalUnits(def.units)
  const aPower = sidePower(att, even, mr.terrain, mr.coastal, false)
  const dPower = sidePower(def, even, mr.terrain, mr.coastal, true)
  const ratio = aPower / Math.max(0.1, dPower)
  add(
    'force',
    'Attack power against defence',
    `${aPower.toFixed(0)} against ${dPower.toFixed(0)} (${ratio.toFixed(2)} to 1)`,
    `Your ${aTotal.toFixed(1)} divisions against their ${dTotal.toFixed(1)} (army that stands here plus the garrison). Every unit counts at its attack or defence value, scaled by everything below. You need clearly more than they have: a win takes about 1.1 to 1 in what is left at the end, and the defender fights at a bonus.`,
    ratio >= 1.15 ? 'good' : ratio >= 0.85 ? 'neutral' : 'bad',
  )
  const plains = sidePower(att, even, 'plains', mr.coastal, false)
  const terr = plains > 0 ? aPower / plains : 1
  add(
    'terrain',
    `Terrain: ${TERRAIN[mr.terrain].name}`,
    `defenders ×${TERRAIN[mr.terrain].defense}, your force at ${Math.round(terr * 100)}% of its plains strength`,
    `Each kind of unit fights differently on different ground: tanks do badly in mountains and cities, infantry and robots do well. Defenders also get a flat bonus (${TERRAIN[mr.terrain].defense}× here). A force built for the ground it will fight on is worth more than a bigger one built wrong.`,
    terr >= 1.02 && TERRAIN[mr.terrain].defense <= 1.05 ? 'good' : terr < 0.9 || TERRAIN[mr.terrain].defense > 1.2 ? 'bad' : 'neutral',
  )
  const lineNow = Math.min(s.regions[plan.target].line, lineMax(s, map, plan.target))
  add(
    'line',
    'Defense Line',
    `${lineNow.toFixed(1)} of ${lineMax(s, map, plan.target).toFixed(1)}`,
    'Winning does not take a country until its Defense Line is at zero. A bigger edge, guns (artillery), bombers and missiles push the line further. The line does not change the chance to win the battle, only whether this one battle takes the country.',
    lineNow <= 2 ? 'good' : 'neutral',
  )
  const st = STANCES[plan.stance]
  add(
    'stance',
    `Stance: ${st.name}`,
    `push ×${st.advance}, your losses ×${st.ownLosses}${st.cost ? `, ${st.cost} money` : ''}`,
    `${st.blurb} A stance changes how hard each kind of unit hits and how much the line moves, and what your side loses.`,
    plan.stance === 'assault' ? 'neutral' : st.ownLosses < 1 ? 'good' : 'neutral',
  )
  const aCombined = hasCombinedArms(att.units)
  const dCombined = hasCombinedArms(def.units)
  const aBonus = COMBAT.combinedArmsBonus + (att.mods?.combinedArms ?? 0) + 0.05 * (att.sys?.ai ?? 0)
  add(
    'combined',
    'Combined arms',
    aCombined ? `yours +${Math.round(aBonus * 100)}%${dCombined ? `, theirs +${Math.round(aBonus * COMBAT.defenderCombinedArmsShare * 100)}%` : ''}` : dCombined ? 'theirs only' : 'neither side',
    `An army with real numbers of foot soldiers, tanks and aircraft (each at least ${Math.round(COMBAT.combinedArmsShare * 100)}% of the force) fights as a team: +${Math.round(COMBAT.combinedArmsBonus * 100)}% power, more with AI Battle Command and a military academy. A token tank or two does not count. Defenders get half the bonus.`,
    aCombined ? 'good' : dCombined ? 'bad' : 'neutral',
  )
  const notes = [...att.penaltyNotes]
  const lowOil = (att.vehicleMult ?? 1) < 1
  add(
    'supply',
    'Supply, oil and food',
    notes.length ? notes.join('; ') : 'fully supplied',
    'A nation with no oil fights its tanks, planes and ships at reduced strength; a food shortage costs 30% of everything; crossing water or air costs 40% of strength (less with an Orbital Network). Fix these before you attack: they apply to every unit.',
    notes.length || lowOil ? 'bad' : 'good',
  )
  if (def.penaltyNotes.length) add('supplyDef', 'Their supply', def.penaltyNotes.join('; '), 'The defender is short of something, which weakens it in this fight.', 'good')
  const drillA = weighted(att.units, (k) => att.drill?.[k] ?? 0)
  const drillD = weighted(def.units, (k) => def.drill?.[k] ?? 0)
  const techA = weighted(att.units, (k) => att.mods?.unitAttack[k] ?? 0)
  const techD = weighted(def.units, (k) => def.mods?.unitDefense[k] ?? 0)
  const trainEdge = (1 + drillA * TRAINING.bonusPerLevel) * (1 + techA) - (1 + drillD * TRAINING.bonusPerLevel) * (1 + techD)
  add(
    'quality',
    'Training, weapons and technology',
    `yours ${trainingRank(Math.round(drillA))}, +${Math.round(techA * 100)}% weapons and tech; theirs ${trainingRank(Math.round(drillD))}, +${Math.round(techD * 100)}%`,
    `Drill rank (+${Math.round(TRAINING.bonusPerLevel * 100)}% per rank), weapon levels and technology multiply each unit's strength. The defender's garrison is green, which pulls its average down. Average over the units actually in the fight.`,
    trainEdge > 0.05 ? 'good' : trainEdge < -0.05 ? 'bad' : 'neutral',
  )
  add(
    'garrison',
    'Garrison',
    `${setup.garrison.infantry.toFixed(1)} divisions of local defenders`,
    'Every country has a garrison of its own (barracks, workforce, a capital and city defences add to it) that fights beside the army that stands there. It adds to the defender and takes losses with it.',
    setup.garrison.infantry > 3 ? 'bad' : 'neutral',
  )
  const airsup = airSuperiority(att, def)
  const anyAir = att.units.air + att.units.fighter + def.units.air + def.units.fighter > 0.05
  add(
    'air',
    'Air cover',
    anyAir ? `you hold ${Math.round(airsup * 100)}% of the air${att.units.air > 0 ? `: your bombers fly at ${Math.round(Math.max(0.4, Math.min(1.6, 0.4 + 1.2 * airsup)) * 100)}%` : ''}` : 'no aircraft on either side',
    'The side with more fighters rules the air. A side that does not has its strike aircraft fly at 40% of their strength; one that does flies them at up to 160%. A few fighters are cheap insurance for a bomber force.',
    !anyAir ? 'neutral' : airsup >= 0.55 ? 'good' : airsup <= 0.45 ? 'bad' : 'neutral',
  )
  add(
    'missiles',
    'Missile support',
    att.units.missile >= 0.5 ? `${Math.round(att.units.missile)} fired: cuts the Defense Line by ${missileCut.toFixed(1)} (after their shield)` : 'none fired',
    `Hypersonic missiles strike first, before the air war, and crack the Defense Line directly (${FRONTIER.missileLine} per missile). They are used up. An Interceptor Shield on their side stops a share. They help take the country, and add a little to the opening round.`,
    att.units.missile >= 0.5 ? 'good' : 'neutral',
  )
  add(
    'reinforce',
    'Defender reinforcement',
    setup.defendShare >= 0.99 ? 'their whole army stands here' : `${Math.round(setup.defendShare * 100)}% of their army stands here`,
    'A military attacked on several fronts in one month, or with part of it away on its own attacks, cannot fully stand on every front. If the defender is stretched, more of its army is elsewhere. Forces they have posted on station fight at +35% at their own post.',
    setup.defendShare < 0.9 ? 'good' : 'neutral',
  )
  if (setup.bySea) add('landing', 'Landing from sea or air', setup.intercept ? `patrols sink ${Math.round(setup.intercept.share * 100)}% of the force on the way` : 'amphibious penalty applies', 'A landing fights at a penalty (less with an Orbital Network) and meets the defender\'s patrols on the way in.', 'bad')
  if (setup.surprise > 0.005) add('surprise', 'Surprise', `+${Math.round(setup.surprise * 100)}% on an unguarded border`, 'A border nobody was guarding is lost to a first strike early in a war.', 'good')
  return out
}

/** A forecast by commit preset, share or named units, as the War Room shows it. Memoised on the state object: a new state is a new answer. */
const memo = new WeakMap<object, Map<string, Forecast | null>>()
export function forecastMemo(s: GameState, map: WorldMap, nationId: NationId, plan: AttackPlan, runs: number = DEFAULT_RUNS): Forecast | null {
  let byState = memo.get(s)
  if (!byState) memo.set(s, (byState = new Map()))
  const key = `${nationId}|${plan.target}|${plan.stance}|${plan.commit ?? ''}|${plan.share ?? ''}|${plan.missiles ?? ''}|${plan.units ? UNIT_TYPES.map((k) => plan.units![k] ?? 0).join(',') : ''}|${runs}`
  if (byState.has(key)) return byState.get(key) ?? null
  const f = forecastPlan(s, map, nationId, plan, runs)
  if (byState.size > 400) byState.clear()
  byState.set(key, f)
  return f
}

// --- What a player without AI Battle Command is told -----------------------------------------------------------------

export interface RoughOdds {
  label: Forecast['label']
  /** "about 60%": a rounded guess. */
  text: string
  low: number
  high: number
  /** How well the other side is known: this sets how wide the band is. */
  intel: 'spies' | 'front' | 'blind'
  note: string
}

/** How well `nationId` can see the country it is about to attack. A war front shows you something; spies or satellites show you much more. */
export function intelQuality(s: GameState, nationId: NationId, target: RegionId): 'spies' | 'front' | 'blind' {
  const owner = s.regions[target]?.owner
  const n = s.nations[nationId]
  if ((n?.systems?.orbital ?? 0) >= 1) return 'spies'
  if ((s.intel?.[`${nationId}|${owner}`] ?? -1) >= s.turn) return 'spies'
  return s.wars.includes([nationId, owner].sort().join('|')) ? 'front' : 'blind'
}

function steady(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/**
 * What a nation without AI Battle Command is told: a label and a rounded band that always contains the real chance but never pins it
 * down. The centre is the real chance plus a fixed error (it holds all month), rounded to 5%; the band is wider the less you know.
 */
export function roughOdds(s: GameState, nationId: NationId, target: RegionId, exact: number): RoughOdds {
  const intel = intelQuality(s, nationId, target)
  const half = intel === 'spies' ? 0.1 : intel === 'front' ? 0.17 : 0.27
  const off = (steady(`${nationId}|${target}|${s.turn}|${s.seed}`) - 0.5) * half
  const centre = Math.round(Math.min(1, Math.max(0, exact + off)) * 20) / 20
  const low = Math.max(0, Math.min(centre - half, exact - 0.02))
  const high = Math.min(1, Math.max(centre + half, exact + 0.02))
  const round5 = (v: number) => Math.round(v * 20) / 20
  const lo = Math.min(round5(low), exact)
  const hi = Math.max(round5(high), exact)
  return {
    label: labelFor(centre),
    text: `about ${Math.round(centre * 100)}%`,
    low: lo,
    high: hi,
    intel,
    note: intel === 'spies' ? 'Spies and satellites give a fair picture.' : intel === 'front' ? 'You can only see the front line. Spies or an Orbital Network narrow this.' : 'You know little of their army. Spies or an Orbital Network narrow this.',
  }
}
