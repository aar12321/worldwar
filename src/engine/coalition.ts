import { opinionOf, nationNeighbors } from '../ai/opinion'
import { COALITION, THREAT } from '../data/coalition'
import { difficultyOf } from '../data/difficulty'
import { TERRAIN } from '../data/terrain'
import { UNIT_SPECS } from '../data/unitTypes'
import { blocsOf, type Bloc } from './blocs'
import { absDay, absDate, dayDate, isLive } from './calendar'
import { economicShare } from './victory'
import { empireCount, tierOf } from './empire'
import { addLog, alliesOf, atWar, clamp, enemiesOf, grantJustification, hasPact, isAllied, maxWars, newId, pairKey, regionsOf, sanctionersOf, totalUnits } from './helpers'
import { militaryPower } from './militaryStats'
import type { Rng } from './rng'
import type { CoalitionPlan, GameState, NationId, RegionId, Tier, WorldMap } from './types'
import { canAttackRegion, garrisonStrength } from './warfare'
import { lineMax } from './economy'

export interface ThreatPart {
  label: string
  value: number
}

export interface ThreatReport {
  nation: NationId
  tier: Tier
  /** 0 to 100: how alarming this nation's size and reputation are. */
  score: number
  /** 0 to 4, an index into THREAT.levelNames. */
  level: number
  levelName: string
  parts: ThreatPart[]
  /** How much the score turns into action given the tier, 0 to 1.2, before the difficulty. */
  rawPressure: number
  /** The same, after the difficulty: Easy rivals never band together, so it is 0 there. */
  pressure: number
}

const nm = (s: GameState, id: NationId) => s.nations[id]?.name ?? id

/** How alarmed the world is by a nation: its tier, its share of countries, people and output, and its reputation for aggression. */
export function threatOf(s: GameState, map: WorldMap, id: NationId, opts: { output?: boolean } = {}): ThreatReport {
  const n = s.nations[id]
  const tier = (n?.tier ?? 1) as Tier
  const diff = difficultyOf(s.settings.difficulty)
  const parts: ThreatPart[] = []
  const push = (label: string, value: number) => {
    if (value >= 0.5) parts.push({ label, value: Math.round(value) })
  }
  if (!n?.alive) return { nation: id, tier, score: 0, level: 0, levelName: THREAT.levelNames[0], parts, rawPressure: 0, pressure: 0 }
  push(`Empire tier (${tierOf(n).name})`, THREAT.tier[tier - 1])
  const total = Math.max(1, Object.keys(s.regions).length)
  push('Share of the world\'s countries', (empireCount(s, id) / total) * 100 * THREAT.perCountryShare)
  let mine = 0
  let people = 0
  for (const r of Object.values(s.regions)) {
    people += r.population
    if (r.owner === id) mine += r.population
  }
  push('Share of the world\'s people', (people > 0 ? mine / people : 0) * 100 * THREAT.perPeopleShare)
  // Output needs an economy report for the nation and its puppets: skipped where only a rough reading is needed, and for small nations.
  if (opts.output !== false && tier >= 2) push('Share of the world\'s output', economicShare(s, map, id) * 100 * THREAT.perOutputShare)
  push('Reputation for aggression', (s.infamy[id] ?? 0) * THREAT.perInfamy)
  const score = Math.min(THREAT.max, parts.reduce((sum, p) => sum + p.value, 0))
  let level = 0
  for (let i = 0; i < THREAT.levels.length; i++) if (score >= THREAT.levels[i]) level = i
  const rawPressure = Math.min(THREAT.maxPressure, (THREAT.ramp[tier - 1] * score) / THREAT.scoreFull)
  return { nation: id, tier, score, level, levelName: THREAT.levelNames[level], parts, rawPressure, pressure: diff.coalitions ? rawPressure : 0 }
}

/** The pressure the world puts on a nation (0 for Easy games, and for small nations). Cheap enough for the AI to ask. */
export function pressureOf(s: GameState, map: WorldMap, id: NationId, opts: { output?: boolean } = {}): number {
  if (!difficultyOf(s.settings.difficulty).coalitions) return 0
  if ((s.nations[id]?.tier ?? 1) <= 1) return 0
  return threatOf(s, map, id, opts).pressure
}

/** Human leaders the world is reacting to, strongest pressure first. Computed once a turn for the AI. */
export function leadersOf(s: GameState, map: WorldMap, floor = 0.01, opts: { output?: boolean } = {}): { id: NationId; threat: ThreatReport }[] {
  const out: { id: NationId; threat: ThreatReport }[] = []
  for (const id of s.humans) {
    if (!s.nations[id]?.alive || (s.nations[id].tier ?? 1) <= 1) continue
    const threat = threatOf(s, map, id, opts)
    if (threat.pressure >= floor) out.push({ id, threat })
  }
  return out.sort((a, b) => b.threat.pressure - a.threat.pressure || (a.id < b.id ? -1 : 1))
}

// ---- Joint strikes ----

/**
 * The month a strike is fought in. A turn game's rivals plan and fight in the same month. A live game's plan the month ahead at the
 * month's turn, so their attacks leave in the month after the one the plan names.
 */
export const strikeMonth = (s: Pick<GameState, 'settings'>, plan: Pick<CoalitionPlan, 'strikeTurn'>): number => plan.strikeTurn + (isLive(s) ? 1 : 0)

/** When a strike falls, for the screens: a day in a live game, else only the month. */
export function strikeDate(s: Pick<GameState, 'settings'>, plan: Pick<CoalitionPlan, 'strikeTurn' | 'strikeDay'>): string {
  const month = strikeMonth(s, plan)
  return isLive(s) ? absDate(absDay(month, plan.strikeDay)) : dayDate(month, 0).replace(/^1 /, '')
}

export const activePlans = (s: Pick<GameState, 'coalitions'>, target?: NationId): CoalitionPlan[] => (s.coalitions ?? []).filter((p) => !p.done && (!target || p.target === target))

/** A joint strike that is due this month and that this nation takes part in. */
export function dueStrike(s: GameState, nationId: NationId): CoalitionPlan | null {
  for (const p of s.coalitions ?? []) if (!p.done && s.turn >= p.strikeTurn && p.members.includes(nationId) && s.nations[p.target]?.alive) return p
  return null
}

/** How hard a country would be to take, for choosing the weakest border: its garrison on its terrain, and how much of its line is left. */
function toughness(s: GameState, map: WorldMap, id: RegionId): number {
  const r = s.regions[id]
  const max = Math.max(0.5, lineMax(s, map, id))
  return garrisonStrength(s, map, id) * UNIT_SPECS.infantry.defense * TERRAIN[map.regions[id].terrain].defense * (0.6 + 0.4 * Math.min(1, r.line / max))
}

/** The countries of a leader that a rival touches by land or sea lane, weakest first. */
function bordersOf(s: GameState, map: WorldMap, leader: NationId, rival: NationId): RegionId[] {
  const out: RegionId[] = []
  for (const r of regionsOf(s, leader)) {
    const mr = map.regions[r]
    if (mr.neighbors.some((x) => s.regions[x]?.owner === rival) || mr.seaLanes.some((x) => s.regions[x]?.owner === rival)) out.push(r)
  }
  return out
}

/** The country a member attacks in a joint strike: the first of the shared targets it can reach, or else the weakest it can. */
export function jointTarget(s: GameState, map: WorldMap, plan: CoalitionPlan, member: NationId): RegionId | null {
  const mine = (id: RegionId) => s.regions[id]?.owner === plan.target && canAttackRegion(s, map, member, id).ok
  for (const id of plan.focus) if (mine(id)) return id
  const rest = regionsOf(s, plan.target)
    .filter(mine)
    .sort((a, b) => toughness(s, map, a) - toughness(s, map, b) || (a < b ? -1 : 1))
  return rest[0] ?? null
}

/** The month's work: plans that came due are closed, and Hard rivals who see a runaway leader agree to strike it together. */
export function runCoalitions(s: GameState, map: WorldMap, rng: Rng) {
  if (!s.coalitions && !s.humans.length) return
  const keep: CoalitionPlan[] = []
  for (const p of s.coalitions ?? []) {
    if (!s.nations[p.target]?.alive) continue
    if (!p.done && s.turn >= p.strikeTurn) {
      p.done = true
      ;(s.coalitionLast ??= {})[p.target] = s.turn
    }
    // A plan is kept a month past the strike, so the screens and the live clock can still see how it went.
    if (!p.done || s.turn <= p.strikeTurn + 1) keep.push(p)
  }
  if (keep.length || s.coalitions) s.coalitions = keep
  const diff = difficultyOf(s.settings.difficulty)
  if (diff.skill < 2 || !diff.coalitions) return
  for (const leader of s.humans) {
    const n = s.nations[leader]
    if (!n?.alive || n.tier < COALITION.planTier || (s.coalitions ?? []).some((p) => p.target === leader && !p.done)) continue
    const threat = threatOf(s, map, leader)
    if (threat.pressure < COALITION.planFrom) continue
    const last = s.coalitionLast?.[leader]
    const rest = threat.pressure >= 0.95 ? COALITION.restTotal : COALITION.rest
    if (last !== undefined && s.turn - last < rest) continue
    const plan = planStrike(s, map, rng, leader, threat)
    if (plan) (s.coalitions ??= []).push(plan)
  }
}

/** Who a leader's rivals would send, and where. Null when fewer than two can reach it. */
function planStrike(s: GameState, map: WorldMap, rng: Rng, leader: NationId, threat: ThreatReport): CoalitionPlan | null {
  const fronts = COALITION.fronts[tierOf(s.nations[leader]).id] ?? 2
  const leaderPower = Math.max(1, militaryPower(s, leader))
  const near = nationNeighbors(s, map, leader)
  const humans = new Set(s.humans)
  const eligible = (id: NationId) => {
    const n = s.nations[id]
    if (!n?.alive || humans.has(id) || id === leader || n.overlord || s.nations[leader].overlord === id) return false
    if (isAllied(s, id, leader) || hasPact(s, id, leader)) return false
    if (enemiesOf(s, id).length >= maxWars(s, id) && !atWar(s, id, leader)) return false
    if (totalUnits(n.military.units) < 1) return false
    // A rival that loves the leader does not join, and a long-rested one is not asked again.
    if (opinionOf(s, map, id, leader, { borders: near.has(id), coalition: true }) > 30) return false
    return militaryPower(s, id) >= leaderPower * COALITION.minPower
  }
  const score = (id: NationId) => militaryPower(s, id) * (1 - clamp(opinionOf(s, map, id, leader, { borders: near.has(id), coalition: true }), -60, 30) / 150)
  // Those at the leader's border first, then the allies of any chosen rival who can reach it: they press their friend's enemy.
  const chosen: NationId[] = []
  const neighbors = [...near].filter(eligible).filter((id) => bordersOf(s, map, leader, id).length > 0).sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1))
  for (const id of neighbors) if (chosen.length < fronts) chosen.push(id)
  for (const base of [...chosen]) {
    for (const ally of alliesOf(s, base).sort()) {
      if (chosen.length >= fronts || chosen.includes(ally) || !eligible(ally)) continue
      if (regionsOf(s, leader).some((r) => canAttackRegion(s, map, ally, r).ok)) chosen.push(ally)
    }
  }
  if (chosen.length < 2) return null
  // The weakest countries any of them can reach are the shared targets.
  const reach = new Set<RegionId>()
  for (const id of chosen) for (const r of regionsOf(s, leader)) if (canAttackRegion(s, map, id, r).ok) reach.add(r)
  const focus = [...reach].sort((a, b) => toughness(s, map, a) - toughness(s, map, b) || (a < b ? -1 : 1)).slice(0, 3)
  if (!focus.length) return null
  const strikeTurn = s.turn + 1 + COALITION.lead
  const members = [...chosen].sort((a, b) => militaryPower(s, b) - militaryPower(s, a) || (a < b ? -1 : 1))
  const plan: CoalitionPlan = { id: newId(s, 'cp'), target: leader, members, focus, formed: s.turn, strikeTurn, strikeDay: rng.int(COALITION.day[0], COALITION.day[1]), threat: Math.round(threat.score) }
  // Each rival has its reasons on paper, and the strongest ties the others to it with a treaty, so a bloc stands where there was none.
  for (const id of members) grantJustification(s, id, leader, `Joined the coalition against ${nm(s, leader)}`, COALITION.lead + 6)
  const head = members[0]
  for (const id of members.slice(1)) {
    const key = pairKey(head, id)
    if (!s.alliances.includes(key) && !atWar(s, head, id) && alliesOf(s, id).length < difficultyOf(s.settings.difficulty).maxAlliances + 1 && alliesOf(s, head).length < difficultyOf(s.settings.difficulty).maxAlliances + 1) {
      s.alliances.push(key)
      s.alliances.sort()
    }
  }
  addLog(s, 'news', `${members.map((m) => nm(s, m)).join(', ')} have agreed to act together against ${nm(s, leader)}. A joint strike on its borders is expected in ${strikeDate(s, plan)}.`, [leader, ...members])
  return plan
}

/** The live clock's day of a month on which a joint strike's attacks all leave, or null if the order belongs to none. */
export function jointDay(s: GameState, joint: string | undefined): number | null {
  if (!joint) return null
  return (s.coalitions ?? []).find((p) => p.id === joint)?.strikeDay ?? s.relations?.plans.find((p) => p.id === joint)?.strike?.day ?? null
}

// ---- What the screens show ----

export interface ReactionView {
  threat: ThreatReport
  /** What this difficulty's rivals do about a leader. */
  stance: 'none' | 'defensive' | 'coordinated'
  stanceText: string
  /** Alliance blocs that are drawing together against the leader: a member is at war with it, wary of it, or in a joint plan. */
  blocs: { bloc: Bloc; hostile: NationId[] }[]
  /** Rivals at war with the leader, and those that dislike it most. */
  atWar: NationId[]
  wary: { id: NationId; opinion: number; neighbor: boolean }[]
  sanctioners: NationId[]
  /** A joint strike being prepared, if any, with the months until it comes. */
  plan: (CoalitionPlan & { monthsLeft: number; date: string }) | null
  /** The rivals that could be talked out of it: those in the plan that are not yet at war with the leader. */
  persuadable: NationId[]
}

/** Everything the World reaction panel and the advisor read: the threat, who is drawing together, what is coming. */
export function worldReaction(s: GameState, map: WorldMap, id: NationId): ReactionView {
  const diff = difficultyOf(s.settings.difficulty)
  const threat = threatOf(s, map, id)
  const stance = !diff.coalitions ? 'none' : diff.skill >= 2 ? 'coordinated' : 'defensive'
  const stanceText =
    stance === 'none'
      ? 'Easy rivals never band together against you. They judge you only on your own dealings with them.'
      : stance === 'defensive'
        ? 'Medium rivals form alliances and blocs against a growing power, and join a war against it to defend their friends. They do not plan strikes together.'
        : 'Hard rivals form alliances, join their friends\' wars, and plan pre-emptive strikes together: several fronts, the same month and day, on your weakest border.'
  const near = nationNeighbors(s, map, id)
  const others = Object.values(s.nations).filter((n) => n.alive && n.id !== id && !s.humans.includes(n.id))
  const atWarWith = enemiesOf(s, id).filter((e) => s.nations[e]?.alive).sort()
  const plan = activePlans(s, id)[0] ?? null
  const wary = others
    .map((n) => ({ id: n.id, opinion: opinionOf(s, map, n.id, id, { borders: near.has(n.id), coalition: true }), neighbor: near.has(n.id) }))
    .filter((x) => x.opinion <= -15 && !atWarWith.includes(x.id))
    .sort((a, b) => a.opinion - b.opinion || (a.id < b.id ? -1 : 1))
    .slice(0, 8)
  const hostileSet = new Set<NationId>([...atWarWith, ...wary.map((w) => w.id), ...(plan?.members ?? [])])
  const blocs = blocsOf(s)
    .filter((b) => !b.members.includes(id))
    .map((bloc) => ({ bloc, hostile: bloc.members.filter((m) => hostileSet.has(m)) }))
    .filter((b) => b.hostile.length > 0)
    .slice(0, 5)
  return {
    threat,
    stance,
    stanceText,
    blocs,
    atWar: atWarWith,
    wary,
    sanctioners: sanctionersOf(s, id),
    plan: plan ? { ...plan, monthsLeft: Math.max(0, strikeMonth(s, plan) - s.turn), date: strikeDate(s, plan) } : null,
    persuadable: plan ? plan.members.filter((m) => !atWar(s, m, id)) : [],
  }
}

/**
 * How much the world's fear of a leader draws two rivals together: the leader's pressure when both of them border it or fight it, else 0.
 * `leaders` are the ones already worked out this month; left out, they are worked out here, roughly (without the output share).
 */
export function alarmBetween(s: GameState, map: WorldMap, a: NationId, b: NationId, leaders?: ThreatReport[]): { leader: NationId; pressure: number } | null {
  const list = leaders ?? leadersOf(s, map, COALITION.allyFrom, { output: false }).map((l) => l.threat)
  for (const l of list) {
    if (l.pressure < COALITION.allyFrom || l.nation === a || l.nation === b) continue
    const near = nationNeighbors(s, map, l.nation)
    const afraid = (id: NationId) => near.has(id) || atWar(s, id, l.nation)
    if (afraid(a) && afraid(b)) return { leader: l.nation, pressure: l.pressure }
  }
  return null
}
