import { difficultyOf } from '../data/difficulty'
import { PERSONALITIES } from '../data/personalities'
import { TERRAIN } from '../data/terrain'
import { COMMITS, type Commit, type Stance } from '../data/war'
import { clockMonth } from '../engine/calendar'
import { recentlyProposed } from '../engine/diplomacy'
import type { EconomyReport } from '../engine/economy'
import { lineMax } from '../engine/economy'
import { atWar, canUseUnit, hasCasusBelli, hasPact, isAllied, pairKey, totalUnits } from '../engine/helpers'
import type { Rng } from '../engine/rng'
import type { GameState, NationId, RegionId, UnitCounts, UnitType, WorldMap } from '../engine/types'
import { MISSILE_TYPES } from '../data/missiles'
import { missileStock } from '../engine/missiles'
import type { MissileType } from '../engine/types'
import { canAttackRegion, forecastAttack, garrisonStrength } from '../engine/warfare'
import { netWarScore, regionValue } from '../engine/warscore'
import type { TurnContext } from './bot'
import { opinionOf, storedOpinion } from './opinion'

/**
 * The strategic layer. Once a month every bot reads its own situation (personality, rival skill, relative power, neighbors, wars,
 * money, trouble) and takes a posture. The posture does not act by itself: it sets how eager the bot is to start a war, how good the
 * odds of an attack must be, how much of the army it may send away, and how hard it presses for peace. bot.ts turns those into
 * orders, and the functions below pick the targets and the force. Everything here is deterministic, uses only what the player's
 * own rules allow (forecasts are the same ones the War Room shows), and never touches a random number except through the `rng` it is given.
 */
export type Posture = 'expand' | 'consolidate' | 'defend' | 'opportunist' | 'turtle' | 'revenge'

export interface Strategy {
  posture: Posture
  /** One line on why, for tests and for anyone reading the logs. */
  why: string
  /** Scales how willing it is to start a new war. 0 means none. */
  appetite: number
  /** The smallest forecast chance of winning at which it launches an attack. */
  minOdds: number
  /** The largest share of its military an attack may send away. */
  maxCommit: number
  /** 0 to 1: how much it wants its wars over. */
  peaceDrive: number
  /** Scales how many units it raises this month. */
  recruit: number
  /** The nation it wants revenge on, if any. */
  grudge: NationId | null
  /** What the nations it fights could bring against it. */
  enemyPower: number
  /** Its worst war score against any enemy, from -100 to 100. */
  worstNet: number
}

/** Everything a bot can see when it plans, gathered once so the functions here do not recompute it. */
export interface Sight {
  s: GameState
  map: WorldMap
  id: NationId
  ctx: TurnContext
  econ: EconomyReport
  perceived: (id: NationId) => number
  opinion: (id: NationId) => number
  neighbors: Set<NationId>
}

/** How good an attack's odds must be, by rival skill. Easy waits for a sure thing, Hard accepts a fair fight. */
export const MIN_ODDS = [0.72, 0.62, 0.55] as const

const POSTURE_RULES: Record<Posture, { appetite: number; odds: number; commit: number; peace: number; recruit: number }> = {
  expand: { appetite: 1, odds: 0, commit: 1, peace: 0, recruit: 1 },
  opportunist: { appetite: 1, odds: 0, commit: 1, peace: 0.1, recruit: 1 },
  consolidate: { appetite: 0, odds: 0.06, commit: 0.66, peace: 0.35, recruit: 0.8 },
  defend: { appetite: 0, odds: 0.1, commit: 0.5, peace: 0.7, recruit: 1.5 },
  turtle: { appetite: 0.5, odds: 0.08, commit: 0.66, peace: 0.4, recruit: 1.15 },
  revenge: { appetite: 1.4, odds: -0.05, commit: 1, peace: 0, recruit: 1.25 },
}

/** The nation that took this one's land lately and is still within its reach, if any. */
function grudgeOf(sight: Sight, myPower: number): NationId | null {
  const { s, id, perceived } = sight
  let best: { id: NationId; v: number } | null = null
  for (const key of Object.keys(s.opinions)) {
    if (!key.startsWith(`${id}>`)) continue
    const target = key.slice(id.length + 1)
    if (!s.nations[target]?.alive || target === id) continue
    const taken = storedOpinion(s, id, target).find((m) => m.label === 'Seized our land')
    if (!taken || taken.value > -6) continue
    if (isAllied(s, id, target) || hasPact(s, id, target)) continue
    // A grudge only matters if it can be acted on: the other side must be within reach of a rebuilt army.
    if (perceived(target) > myPower * 2.5) continue
    if (!best || taken.value < best.v || (taken.value === best.v && target < best.id)) best = { id: target, v: taken.value }
  }
  return best?.id ?? null
}

/** Whether the nations touch by land (not only across a sea lane). */
function sharesBorder(sight: Sight, other: NationId): boolean {
  const { s, map, id } = sight
  for (const r of Object.values(s.regions)) {
    if (r.owner !== id) continue
    for (const nb of map.regions[r.id].neighbors) if (s.regions[nb]?.owner === other) return true
  }
  return false
}

/** Reads the situation and takes a posture. */
export function assessStrategy(sight: Sight): Strategy {
  const { s, id, ctx, econ } = sight
  const n = s.nations[id]
  const diff = difficultyOf(s.settings.difficulty)
  const persona = PERSONALITIES[n.personality ?? 'honorable']
  const myPower = Math.max(0.5, ctx.power.get(id) ?? 0)
  const enemies = ctx.enemies.get(id) ?? []
  const enemyPowers = enemies.map((e) => ctx.power.get(e) ?? 0).sort((a, b) => b - a)
  // The strongest enemy counts in full and the others half: they do not all arrive at once.
  const enemyPower = enemyPowers.reduce((sum, p, i) => sum + (i === 0 ? p : p * 0.5), 0)
  let worstNet = 0
  for (const e of enemies) worstNet = Math.min(worstNet, netWarScore(s, id, e))
  const atWarNow = enemies.length > 0
  const held = Object.values(s.regions).filter((r) => r.owner === id).length
  const unsettled = Object.values(s.regions).filter((r) => r.owner === id && r.integration < 0.85).length
  const broke = econ.netCapital < 0 && n.resources.capital < 40
  const grudge = grudgeOf(sight, myPower)

  // The neighbor that could crush it: far stronger, sharing a land border, and with a quarrel (a reason for war, or no love lost).
  let threat: { id: NationId; power: number } | null = null
  for (const x of [...sight.neighbors].sort()) {
    if (!s.nations[x]?.alive || isAllied(s, id, x) || hasPact(s, id, x) || !sharesBorder(sight, x)) continue
    const p = sight.perceived(x)
    const hostile = hasCasusBelli(s, x, id) || opinionOf(s, sight.map, x, id, { borders: true, coalition: false }) < -15
    if (p > myPower * 1.8 && hostile && (!threat || p > threat.power)) threat = { id: x, power: p }
  }

  let posture: Posture
  let why: string
  const losing = atWarNow && (enemyPower > myPower * 1.25 || worstNet <= -15)
  const drive = n.aggression * persona.aggression * diff.aggression
  if (losing) {
    posture = 'defend'
    why = worstNet <= -15 ? 'losing a war on points' : 'outgunned by its enemies'
  } else if (grudge && !broke && n.stability >= 40 && n.warWeariness < 25 && myPower >= sight.perceived(grudge) * 0.9) {
    posture = 'revenge'
    why = `wants its land back from ${s.nations[grudge].name}`
  } else if (unsettled > 1 + Math.floor(held / 8) || n.warWeariness > 28 || n.stability < 40 || broke) {
    posture = 'consolidate'
    why = broke ? 'short of money' : n.stability < 40 ? 'its people are restless' : n.warWeariness > 28 ? 'its people are weary of war' : 'too much newly conquered land to digest'
  } else if (threat) {
    posture = 'defend'
    why = `${s.nations[threat.id].name} has a quarrel with it and could crush it`
  } else if (n.personality === 'turtle' || drive < 0.12) {
    posture = 'turtle'
    why = 'keeps to itself'
  } else if (n.personality === 'opportunist' || (n.personality === 'trader' && drive < 0.6)) {
    posture = 'opportunist'
    why = 'waits for a neighbor in trouble'
  } else {
    posture = 'expand'
    why = 'strong enough to grow'
  }

  const rules = POSTURE_RULES[posture]
  // Officials can only run so much: the bigger the empire, the less eager it is to take more (the game's own administration strain, felt by the AI too).
  const overreach = held > 4 ? Math.max(0.3, 1 - (held - 4) * 0.09) : 1
  const minOdds = MIN_ODDS[diff.skill] + rules.odds
  return {
    posture,
    why,
    appetite: rules.appetite * overreach,
    minOdds,
    maxCommit: rules.commit,
    peaceDrive: rules.peace,
    recruit: rules.recruit,
    grudge,
    enemyPower,
    worstNet,
  }
}

/** Whether any of a nation's countries could be attacked from where `id` stands, war or no war. A war it cannot fight is no war at all. */
export function canReachNation(s: GameState, map: WorldMap, id: NationId, target: NationId): boolean {
  for (const r of Object.values(s.regions)) if (r.owner === target && canAttackRegion(s, map, id, r.id).ok) return true
  return false
}

/** Total strength of the wars a nation's enemies already fight, as a share of its own: a nation busy elsewhere is a softer target. */
function distraction(sight: Sight, target: NationId): number {
  const { ctx } = sight
  const myPower = Math.max(0.5, ctx.power.get(target) ?? 0.5)
  const foes = (ctx.enemies.get(target) ?? []).filter((e) => e !== sight.id)
  const others = foes.reduce((sum, e) => sum + (ctx.power.get(e) ?? 0), 0)
  return Math.min(2, others / myPower)
}

export interface WarPick {
  id: NationId
  ratio: number
  justified: boolean
}

/**
 * The best nation to go to war with, or null. A war is worth starting when the odds on paper are good, the target can actually be
 * reached, no bigger neighbor is waiting for the army to leave, and the posture allows it.
 */
export function chooseWarTarget(sight: Sight, strat: Strategy, mistake: string | null): WarPick | null {
  const { s, map, id, ctx, perceived, opinion } = sight
  if (strat.appetite <= 0) return null
  const n = s.nations[id]
  const diff = difficultyOf(s.settings.difficulty)
  const persona = PERSONALITIES[n.personality ?? 'honorable']
  const humans = new Set(s.humans)
  const myPower = ctx.power.get(id) ?? 0
  const alliesOf = (x: NationId) => ctx.allies.get(x) ?? []
  const playerCap = diff.maxWarsOnPlayer + (ctx.coalition ? 1 : 0)
  // Already in a fight that matters? Then no second one unless it is a walkover.
  const busy = (ctx.enemies.get(id) ?? []).reduce((sum, e) => sum + (ctx.power.get(e) ?? 0), 0)
  // A bigger neighbor across a land border that does not like it: the army cannot march away and leave the door open.
  const threatBehind = [...sight.neighbors].some((x) => x !== id && !isAllied(s, id, x) && !hasPact(s, id, x) && (ctx.power.get(x) ?? 0) > myPower * 1.3 && opinion(x) < 10 && sharesBorder(sight, x))
  let best: WarPick | null = null
  let bestJust: WarPick | null = null
  for (const target of [...sight.neighbors].sort()) {
    const t = s.nations[target]
    if (!t?.alive || atWar(s, id, target) || hasPact(s, id, target) || isAllied(s, id, target)) continue
    if (humans.has(target) && (s.turn < diff.playerGracePeriod || (ctx.warsOn.get(target) ?? 0) >= playerCap)) continue
    const isGrudge = strat.posture === 'revenge' && target === strat.grudge
    const op = opinion(target)
    const muchWeaker = perceived(target) < myPower * 0.55
    const bully = muchWeaker && n.personality !== 'honorable' && n.personality !== 'turtle'
    if (op > (bully || isGrudge ? 40 : 20)) continue
    if (n.personality === 'honorable' && op > 0 && !isGrudge) continue
    if (!canReachNation(s, map, id, target)) continue
    let defense = perceived(target)
    for (const ally of alliesOf(target)) if (sight.neighbors.has(ally) && !atWar(s, id, ally)) defense += perceived(ally) * 0.5
    let ratio = myPower / Math.max(0.5, defense)
    const justified = hasCasusBelli(s, id, target)
    if (justified) ratio *= 1.5
    if (op < -30) ratio *= 1.15
    // A target already fighting someone else is a softer one, and an enemy of a friend is a fair one.
    const distracted = distraction(sight, target)
    if (distracted > 0) ratio *= (n.personality === 'opportunist' || strat.posture === 'opportunist' ? 1.15 : 1.05) + Math.min(0.3, distracted * 0.2)
    if (alliesOf(id).some((a) => atWar(s, a, target))) ratio *= diff.skill === 2 ? 1.25 : diff.skill === 1 ? 1.12 : 1
    if (ctx.coalition && humans.has(target)) ratio *= 1.2
    // A runaway leader draws its neighbors: skilled rivals gang up on a nation holding eight or more countries.
    if (diff.skill >= 1 && (ctx.regions.get(target)?.length ?? 0) >= 8) ratio *= 1.2
    if (isGrudge) ratio *= 1.3 * strat.appetite
    // An opportunist only strikes a neighbor that is in trouble.
    if (strat.posture === 'opportunist' && distracted < 0.15 && t.warWeariness < 12 && !isGrudge && ratio < diff.warDeclarePowerRatio * 1.4) continue
    // Do not march off against a small neighbor while a big one waits, or while already fighting a big war.
    if ((threatBehind || busy > myPower * 0.5) && ratio < diff.warDeclarePowerRatio * 2.2) continue
    const pick = { id: target, ratio, justified }
    if (!best || ratio > best.ratio || (ratio === best.ratio && target < best.id)) best = pick
    if (justified && (!bestJust || ratio > bestJust.ratio)) bestJust = pick
  }
  const needed = diff.warDeclarePowerRatio / persona.risk / (mistake === 'overconfident' ? 0.85 : 1)
  const chosen = bestJust && bestJust.ratio > needed ? bestJust : best
  if (!chosen || chosen.ratio <= needed) return null
  return chosen
}

/** Whether a nation is ready for peace with an enemy, and whether it would pay for it. */
export function wantsPeace(sight: Sight, strat: Strategy, enemy: NationId, rng: Rng): { want: boolean; desperate: boolean; net: number } {
  const { s, id, perceived, ctx } = sight
  const n = s.nations[id]
  const personality = n.personality
  const myPower = ctx.power.get(id) ?? 0
  const theirs = perceived(enemy)
  const net = netWarScore(s, id, enemy)
  const started = s.warStarted[pairKey(id, enemy)] ?? s.turn
  const age = s.turn - started
  const weary = n.warWeariness > 30 - strat.peaceDrive * 8
  // Behind on points, or outgunned and not ahead.
  const losing = net <= -12 || (theirs > myPower * 1.4 && net <= 5) || (strat.posture === 'defend' && net < 0)
  // A war that has gone nowhere: no one is winning, and both sides are tiring.
  const stalemate = age >= 14 && Math.abs(net) < 10 && n.warWeariness > 10
  // Ahead enough to name terms. Expansionists want to keep fighting while the front is open.
  const satisfied = net >= 25 && rng.chance(personality === 'expansionist' ? 0.15 : 0.45)
  // A second war it does not need.
  const spare = (ctx.enemies.get(id) ?? []).length >= 2 && theirs < myPower * 0.35 && strat.posture === 'defend'
  const want = weary || losing || stalemate || satisfied || spare
  return { want, desperate: weary || losing, net }
}

/** Cumulative roll thresholds for each unit, by what the bot is doing. The attackers' mix is the long-standing one; a bot on the defensive trades some tanks and bombers for guns, fighters and robots. */
const MIX: Record<'attack' | 'defend', Record<'armor' | 'artillery' | 'fighter' | 'air' | 'naval' | 'drone' | 'robot' | 'missile', number>> = {
  attack: { armor: 0.22, artillery: 0.34, fighter: 0.42, air: 0.5, naval: 0.55, drone: 0.64, robot: 0.72, missile: 0.78 },
  defend: { armor: 0.12, artillery: 0.28, fighter: 0.4, air: 0.42, naval: 0.45, drone: 0.54, robot: 0.66, missile: 0.7 },
}

/** The unit a bot trains next. `counter` is what its likeliest opponent fields most of: only the strongest tier uses it. */
export function pickUnit(roll: number, rng: Rng, strat: Strategy, sight: Sight, counter: UnitType | null): UnitType {
  const { s, id } = sight
  const n = s.nations[id]
  const diff = difficultyOf(s.settings.difficulty)
  const can = (u: UnitType) => canUseUnit(n, u)
  const t = MIX[strat.posture === 'defend' || strat.posture === 'turtle' ? 'defend' : 'attack']
  let unit: UnitType = 'infantry'
  // Keep the mix balanced: fighters before bombers, and artillery for big fronts.
  if (roll < t.armor && can('armor')) unit = 'armor'
  else if (roll < t.artillery && can('artillery')) unit = 'artillery'
  else if (roll < t.fighter && can('fighter')) unit = 'fighter'
  else if (roll < t.air && can('air') && n.military.units.fighter >= 0.5) unit = 'air'
  else if (roll < t.naval && can('naval')) unit = 'naval'
  // The Frontier weapons: Medium fields drones and robots, Hard adds hypersonic batteries.
  else if (diff.skill >= 1 && roll < t.drone && can('drone')) unit = 'drone'
  else if (diff.skill >= 1 && roll < t.robot && can('robot')) unit = 'robot'
  else if (diff.skill === 2 && roll < t.missile && can('missile')) unit = 'missile'
  // The strongest tier answers what its enemy fields: fighters against bombers and drones, guns against tanks, tanks against foot soldiers.
  if (diff.skill === 2 && counter && rng.chance(0.5) && can(counter)) unit = counter
  return unit
}

/** The unit that best answers what an enemy fields most of. */
export function counterOf(units: UnitCounts | undefined): UnitType | null {
  if (!units) return null
  const total = totalUnits(units)
  if (total < 3) return null
  if ((units.air + units.fighter) / total > 0.25) return 'fighter'
  if (units.armor / total > 0.3) return 'artillery'
  if ((units.drone ?? 0) / total > 0.2) return 'fighter'
  if (units.infantry / total > 0.6) return 'armor'
  return null
}

export interface AttackPlan {
  target: RegionId
  commit: Commit
  stance: Stance
  odds: number
  capture: number
  score: number
  /** The country had already been cracked: this attack finishes or presses a front that is open. */
  started: boolean
}

/** A Defense Line that has been pushed in is cheaper to finish. */
function crackedShare(sight: Sight, regionId: RegionId): number {
  const { s, map } = sight
  const max = lineMax(s, map, regionId)
  return Math.min(1, s.regions[regionId].line / Math.max(0.1, max))
}

/** What a force at home would stand against if the whole of the target's military met it, in the units of `homePower`. */
function estimateDefense(sight: Sight, regionId: RegionId): number {
  const { s, map, ctx } = sight
  const owner = s.regions[regionId].owner
  return ((ctx.home.get(owner) ?? 0) + garrisonStrength(s, map, regionId) * 1.2) * TERRAIN[map.regions[regionId].terrain].defense
}

const COMMIT_ORDER: Commit[] = ['probe', 'main', 'allin']

/**
 * Looks over every country it could attack this month, tries the real battle forecast on the few softest, and returns the attacks
 * worth making best first. It sends the smallest force that clears the bar, unless a bigger one is clearly better, and it keeps a
 * reserve home when another enemy is near. It never attacks at worse odds than its posture accepts.
 */
export function planAttacks(sight: Sight, strat: Strategy, warTargets: Set<NationId>, mistake: string | null, limit = 1): AttackPlan[] {
  const { s, map, id, ctx } = sight
  const n = s.nations[id]
  const myPower = Math.max(0.1, ctx.power.get(id) ?? 0)
  const diff = difficultyOf(s.settings.difficulty)
  const planned = clockMonth(s)
  const minOdds = Math.max(0.3, strat.minOdds - (mistake === 'overconfident' ? 0.15 : 0))
  const options = Object.values(s.regions)
    .filter((r) => warTargets.has(r.owner) && canAttackRegion(s, map, id, r.id).ok)
    .map((r) => {
      const max = lineMax(s, map, r.id)
      const cracked = crackedShare(sight, r.id)
      // The strongest tier joins a front an ally has just hit.
      const joint = diff.skill === 2 && r.attackedTurn >= planned - 1 && r.attackedTurn !== planned ? 0.85 : 1
      const def = estimateDefense(sight, r.id) * (0.6 + 0.4 * cracked) * joint
      return { id: r.id, def, started: r.line < max - 0.01, owner: r.owner }
    })
    .sort((x, y) => x.def - y.def || (x.id < y.id ? -1 : 1))
  if (!options.length) return []
  // A front it has already opened comes first, then the softest countries.
  const shortlist = [...options.filter((o) => o.started).slice(0, 2), ...options.slice(0, 3)].filter((o, i, all) => all.findIndex((p) => p.id === o.id) === i).slice(0, 4)
  const plans: AttackPlan[] = []
  for (const o of shortlist) {
    const otherThreat = (ctx.enemies.get(id) ?? []).filter((e) => e !== o.owner).reduce((m, e) => Math.max(m, ctx.power.get(e) ?? 0), 0)
    let cap = strat.maxCommit
    if (otherThreat > myPower * 0.6) cap = Math.min(cap, COMMITS.main.share)
    if (otherThreat > myPower * 1.0) cap = Math.min(cap, COMMITS.probe.share)
    const armored = n.military.units.armor + n.military.units.air + n.military.units.fighter
    const total = totalUnits(n.military.units)
    const stance: Stance = total > 0 && armored / total > 0.45 && sight.econ.netCapital > -10 ? 'blitz' : lineMax(s, map, o.id) > 6 ? 'siege' : 'assault'
    let chosen: AttackPlan | null = null
    for (const commit of COMMIT_ORDER) {
      if (COMMITS[commit].share > cap + 1e-9 && commit !== 'probe') continue
      const f = forecastAttack(s, map, id, o.id, commit, stance, 8)
      if (!f) continue
      const value = regionValue(s, map, o.id) + (s.nations[o.owner].capital === o.id ? 18 : 0)
      // Winning is worth the land; the troops it costs and the reserve it empties are the price.
      const score = f.winChance * (value + f.captureChance * 10) - f.yourLosses * 1.4 - COMMITS[commit].share * 2 + (o.started ? 6 : 0)
      if (f.winChance < minOdds) continue
      const plan: AttackPlan = { target: o.id, commit, stance, odds: f.winChance, capture: f.captureChance, score, started: o.started }
      // The smallest force that clears the bar, unless the next one up wins by much more.
      if (!chosen || plan.odds >= chosen.odds + 0.2 || plan.capture >= chosen.capture + 0.25) chosen = plan
      if (plan.odds >= 0.92) break
    }
    if (chosen) plans.push(chosen)
  }
  return plans.sort((a, b) => b.score - a.score || (a.target < b.target ? -1 : 1)).slice(0, limit)
}

/**
 * Whether a war on `target` could be fought well: on a copy of the state with the war already declared, the same forecast the
 * War Room shows must find an attack worth making. This keeps a bot from declaring wars it can neither win nor even fight.
 */
export function warLooksWinnable(sight: Sight, strat: Strategy, target: NationId, mistake: string | null): boolean {
  const trial: GameState = { ...sight.s, wars: [...sight.s.wars, pairKey(sight.id, target)] }
  // The target's own front is the one that matters: the plan is made as if nothing else were going on.
  return planAttacks({ ...sight, s: trial }, strat, new Set([target]), mistake, 1).length > 0
}

/**
 * Whether a bot with this posture, odds and front is ready to launch the attack this month. A war it has only just entered is
 * followed up quickly (a war declared and then left idle costs influence and reputation for nothing), a front already cracked is
 * pressed, and otherwise a bot attacks now and then, more readily at a sure thing.
 */
export function readyToStrike(plan: AttackPlan, strat: Strategy, baseChance: number, rng: Rng, warAge = 99): boolean {
  if (plan.started) return rng.chance(0.88)
  const boost = plan.odds >= 0.9 ? 1.5 : plan.odds >= 0.75 ? 1.2 : 1
  const posture = strat.posture === 'revenge' ? 1.3 : strat.posture === 'defend' ? 0.7 : 1
  const chance = baseChance * boost * posture
  return rng.chance(Math.min(0.9, warAge <= 2 && strat.posture !== 'defend' ? Math.max(chance, 0.4) : chance))
}

/** An alliance is worth having with a nation of weight, that is not already sinking, and not one that would only drag the bot into its wars. */
export function goodAlly(sight: Sight, candidate: NationId): boolean {
  const { s, id, ctx, perceived } = sight
  const n = s.nations[id]
  const myPower = Math.max(0.5, ctx.power.get(id) ?? 0)
  const theirs = perceived(candidate)
  const wars = (ctx.enemies.get(candidate) ?? []).filter((e) => !isAllied(s, id, e))
  const bigWar = wars.some((e) => (ctx.power.get(e) ?? 0) > myPower * 1.2 && !atWar(s, id, e))
  // Weak friends bring nothing but their quarrels (an honorable nation keeps faith with them anyway).
  if (theirs < myPower * 0.25 && n.personality !== 'honorable') return false
  return !bigWar
}

/** A reason to look twice at an enemy of an ally: it is a fight the bot may already have friends in. */
export function alliedWarTargets(sight: Sight): NationId[] {
  const { s, id, ctx } = sight
  const out = new Set<NationId>()
  for (const a of ctx.allies.get(id) ?? []) for (const e of ctx.enemies.get(a) ?? []) if (e !== id && !atWar(s, id, e) && !isAllied(s, id, e) && !recentlyProposed(s, id, e, 'peace', 1)) out.add(e)
  return [...out].sort()
}

export interface MissileShot {
  target: RegionId
  kind: MissileType
  count: number
  why: string
}

/**
 * Which missiles to fire at whom, from what is in store. Each kind has a job: tactical missiles thin a big army (they do nothing to a
 * Defense Line), cruise missiles harass, wearing down the line of the front it means to attack and stopping factories, and ballistic
 * missiles, which the world never forgives, only when the bot is losing badly or facing a power twice its size. Hypersonic missiles
 * are the army's own and keep their old rule in bot.ts. The salvo is capped so a few missiles are never spent on a trifle.
 */
export function chooseMissileStrikes(sight: Sight, strat: Strategy, enemies: NationId[]): MissileShot[] {
  const { s, id, ctx } = sight
  const n = s.nations[id]
  if (!enemies.length) return []
  const myPower = Math.max(0.5, ctx.power.get(id) ?? 0)
  const out: MissileShot[] = []
  const foeRegions = (e: NationId) => Object.values(s.regions).filter((r) => r.owner === e).sort((a, b) => b.line - a.line || (a.id < b.id ? -1 : 1))
  const byPower = [...enemies].sort((a, b) => (ctx.power.get(b) ?? 0) - (ctx.power.get(a) ?? 0) || (a < b ? -1 : 1))
  const biggest = byPower[0]
  for (const kind of MISSILE_TYPES) {
    if (kind === 'hypersonic') continue
    const have = missileStock(n, kind)
    if (have < 1) continue
    if (kind === 'tactical') {
      // An army worth thinning: the enemy's strength at home is a real share of its own.
      const e = byPower.find((x) => (ctx.home.get(x) ?? 0) >= myPower * 0.5)
      if (e && have >= 2) out.push({ target: foeRegions(e)[0].id, kind, count: Math.min(have, 8), why: `thin ${s.nations[e].name}'s army` })
    } else if (kind === 'cruise') {
      // Harassment, spent a few at a time on the weakest enemy's front so the line is already thin when the army arrives.
      const e = [...byPower].reverse().find((x) => foeRegions(x).some((r) => canAttackRegion(s, sight.map, id, r.id).ok))
      if (e && have >= 3) {
        const front = foeRegions(e).filter((r) => canAttackRegion(s, sight.map, id, r.id).ok)[0]
        if (front) out.push({ target: front.id, kind, count: Math.min(have, 4), why: `soften the front in ${s.nations[e].name}` })
      }
    } else if (kind === 'ballistic') {
      const desperate = strat.posture === 'defend' && strat.worstNet <= -15
      const outsized = (ctx.power.get(biggest) ?? 0) > myPower * 2
      if ((desperate || outsized) && have >= 2) out.push({ target: foeRegions(biggest)[0].id, kind, count: Math.min(have, 4), why: 'a last resort against a stronger enemy' })
    }
  }
  return out
}

/** Months of income held as cash. A bot sitting on far more than it needs should spend it. */
export function cashMonths(sight: Sight): number {
  const { s, id, econ } = sight
  const income = Math.max(8, econ.taxIncome + econ.factoryIncome + econ.tradeIncome)
  return s.nations[id].resources.capital / income
}
