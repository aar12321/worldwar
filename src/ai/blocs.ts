import { BLOC, ROLES } from '../data/blocs'
import { difficultyOf } from '../data/difficulty'
import { FACTION } from '../data/factions'
import { PERSONALITIES } from '../data/personalities'
import { blocOf, blocPower, forecastOp, hasPerk, joinProblem, leaderOf, sendable } from '../engine/bloc'
import { isLive } from '../engine/calendar'
import { SENDABLE } from '../engine/deploy'
import { factionName, factionOf } from '../engine/factions'
import { alliesOf, atWar, enemiesOf, hasCasusBelli, hasPact, isAllied, maxWars, pairKey, regionsOf, totalUnits } from '../engine/helpers'
import { militaryPower } from '../engine/militaryStats'
import { createRng } from '../engine/rng'
import type { Rng } from '../engine/rng'
import type { BlocRole, Faction, GameState, NationId, Order, RegionId, UnitCounts, WorldMap } from '../engine/types'
import { canAttackRegion } from '../engine/warfare'
import { joinWarBlocked } from '../engine/diplomacy'
import { botAcceptsInvite } from './factions'
import { opinionOf } from './opinion'
import { diceChance, sumFactors, type DiceRule, type OddsFactor } from './diplomat'

type TryAdd = (o: Order) => boolean

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

/** The role that suits a rival: a food store for the Breadbasket, steel for the Arsenal, a war at home for the Shield, the Spymaster otherwise. */
export function preferredRoles(s: GameState, id: NationId): BlocRole[] {
  const n = s.nations[id]
  const prefs: BlocRole[] = []
  if (enemiesOf(s, id).length > 0) prefs.push('shield')
  if (n.resources.steel >= 30) prefs.push('arsenal')
  if (n.resources.food >= 60) prefs.push('breadbasket')
  prefs.push('spymaster', 'arsenal', 'breadbasket', 'shield')
  return [...new Set(prefs)]
}

/** The dice a rival rolls on a bloc's call to arms: a draw from [-5, 5) added to its score, which must beat 2. */
export const CALL_NOISE = 5
const CALL_NEED = 2

/**
 * How a rival weighs a bloc's call to arms from `by` against `target`: a refusal it cannot get past (`no`), or its score before the dice
 * and its terms. `botJoinsCall` and the Bloc desk's odds (`joinCallOutlook`) both read it, so they cannot disagree.
 */
export function joinCallRule(s: GameState, map: WorldMap, id: NationId, by: NationId, target: NationId): { no: string } | { dice: DiceRule; factors: OddsFactor[] } {
  const diff = difficultyOf(s.settings.difficulty)
  const problem = joinProblem(s, id, target)
  if (problem) return { no: problem }
  if (s.humans.includes(target) && s.turn < diff.playerGracePeriod) return { no: `${s.nations[target]?.name ?? 'They'} is still in its first months` }
  if (s.humans.includes(target) && enemiesOf(s, target).length >= diff.maxWarsOnPlayer) return { no: `${s.nations[target]?.name ?? 'They'} has enough enemies already` }
  const f = factionOf(s, id)
  if (!f) return { no: 'Not in a bloc' }
  const persona = PERSONALITIES[s.nations[id].personality ?? 'honorable']
  const ratio = blocPower(s, f) / Math.max(1, militaryPower(s, target))
  const opT = opinionOf(s, map, id, target, { coalition: false })
  const opB = opinionOf(s, map, id, by, { coalition: false })
  const busy = enemiesOf(s, id).length
  const tName = s.nations[target]?.name ?? 'the enemy'
  // The score is these added up in this order, then the dice.
  const factors: OddsFactor[] = [
    { label: `Their opinion of ${tName}`, value: -opT * 0.4 },
    { label: `Their opinion of ${s.nations[by]?.name ?? 'the caller'}`, value: opB * 0.15 },
    { label: 'Their loyalty', value: (persona.loyalty - 1) * 20 },
    { label: 'Their appetite for war', value: (persona.aggression - 1) * 12 },
    { label: `The bloc's strength against ${tName}`, value: (ratio - 1.3) * 10 },
    { label: 'Wars of their own', value: -(busy * 8) },
  ]
  return { dice: { base: sumFactors(factors), need: CALL_NEED, spread: CALL_NOISE }, factors }
}

/** Whether a rival answers a call to arms: it dislikes the enemy, the bloc is stronger, and it is not busy with a war of its own. */
export function botJoinsCall(s: GameState, map: WorldMap, id: NationId, by: NationId, target: NationId, rng: { range: (a: number, b: number) => number }): boolean {
  const r = joinCallRule(s, map, id, by, target)
  if ('no' in r) return false
  return r.dice.base + rng.range(-CALL_NOISE, CALL_NOISE) > r.dice.need
}

/** How a member would answer a bloc's call to arms: as `OfferOutlook`, or `human` for a player, who decides. */
export interface CallOutlook {
  outlook: 'likely' | 'unsure' | 'unlikely' | 'human'
  /** The chance it joins (0 for a player: not a guess). */
  chance: number
  /** The top reason: what stops it, or the term that weighs most toward its answer. */
  reason: string
  dice?: DiceRule
  factors?: OddsFactor[]
  /** Mutual Defence: it joins as the call goes out, before anyone else answers. */
  atOnce?: true
}

/**
 * Whether member `id` would join a call to arms from `by` against `target`, read off the rules that decide it: Mutual Defence (a rival
 * joins as the call opens), a rival's monthly answer (`joinCallRule`, the same as `botJoinsCall`), and Easy rivals, who never answer.
 * `opening`: the call is not made yet (a war about to start, or the leader about to call). As things stand now.
 */
export function joinCallOutlook(s: GameState, map: WorldMap, id: NationId, by: NationId, target: NationId, opening: boolean): CallOutlook {
  if (s.humans.includes(id) || s.nations[id]?.isPlayer) return { outlook: 'human', chance: 0, reason: 'Your friend decides' }
  const problem = joinProblem(s, id, target)
  if (problem) return { outlook: 'unlikely', chance: 0, reason: problem }
  // A yes that starts no war (`declareWar` keeps the enemy to its limit of wars) is no help.
  const full = joinWarBlocked(s, id, target)
  if (full) return { outlook: 'unlikely', chance: 0, reason: full }
  const f = factionOf(s, id)
  if (opening && hasPerk(f, 'defence')) return { outlook: 'likely', chance: 1, reason: 'Mutual Defence: they join as the call goes out', atOnce: true }
  if (!BLOC.on || !difficultyOf(s.settings.difficulty).coalitions) return { outlook: 'unlikely', chance: 0, reason: 'Rivals on this difficulty stay out of bloc wars' }
  const r = joinCallRule(s, map, id, by, target)
  if ('no' in r) return { outlook: 'unlikely', chance: 0, reason: r.no }
  const chance = diceChance(r.dice)
  const outlook = chance >= 1 ? 'likely' : chance <= 0 ? 'unlikely' : 'unsure'
  // The term that pulls hardest toward the answer: for it when it joins, against it otherwise (an even chance: against).
  const toward = chance > 0.5 ? r.factors.reduce((a, b) => (b.value > a.value ? b : a)) : r.factors.reduce((a, b) => (b.value < a.value ? b : a))
  const signed = `${toward.value >= 0 ? '+' : '−'}${Math.abs(Math.round(toward.value))}`
  return { outlook, chance, reason: `${toward.label} (${signed})`, dice: r.dice, factors: r.factors }
}

/**
 * Every member's answer to a call to arms from `by` against `target` (the caller and territories left out), with the enemy's room for wars:
 * Mutual Defence members join first, in the bloc's order, while the enemy has room for another war (as `openCall` does); once it has none,
 * nobody else can join. When more may join than it has room for, `room` says so (the first to answer go to war).
 */
export function callOutlooks(s: GameState, map: WorldMap, f: Faction, by: NationId, target: NationId, opening: boolean): { members: { id: NationId; o: CallOutlook }[]; room: number } {
  let room = maxWars(s, target) - enemiesOf(s, target).length
  const fullText = `${s.nations[target]?.name ?? 'The enemy'} is fighting all the wars it can, so nobody more can join`
  const members = f.members.filter((m) => m !== by && s.nations[m]?.alive && !s.nations[m].territoryOf).map((id) => ({ id, o: joinCallOutlook(s, map, id, by, target, opening) }))
  for (const m of members) {
    if (!m.o.atOnce) continue
    if (room > 0) room--
    else m.o = { outlook: 'unlikely', chance: 0, reason: fullText }
  }
  if (room <= 0) for (const m of members) if (!m.o.atOnce && (m.o.outlook === 'likely' || m.o.outlook === 'unsure')) m.o = { outlook: 'unlikely', chance: 0, reason: fullText }
  return { members, room }
}

/** A pledge for an operation: a share of what the rival can send, kept to tenths of a division. */
function pledgeOf(s: GameState, id: NationId, share: number): Partial<UnitCounts> {
  const can = sendable(s, id)
  const out: Partial<UnitCounts> = {}
  for (const k of SENDABLE) {
    const v = Math.floor(can[k] * share * 10) / 10
    if (v >= 0.1) out[k] = v
  }
  return out
}

/**
 * The enemy country the bloc is likeliest to take: the few weakest lines its members at war can reach, each played out with the
 * divisions the rival members would pledge. Null when none is worth it (odds below `floor`).
 */
function opTarget(s: GameState, map: WorldMap, f: Faction, share: number, floor: number, humansOk: (id: NationId) => boolean): RegionId | null {
  const members = f.members.filter((m) => s.nations[m]?.alive)
  const options: { id: RegionId; line: number; power: number }[] = []
  const enemies = [...new Set(members.flatMap((m) => enemiesOf(s, m)))].filter((e) => !members.includes(e) && s.nations[e]?.alive && humansOk(e)).sort()
  for (const e of enemies) {
    for (const r of regionsOf(s, e).sort()) {
      if (!members.some((m) => atWar(s, m, e) && canAttackRegion(s, map, m, r).ok)) continue
      options.push({ id: r, line: s.regions[r].line, power: militaryPower(s, e) })
    }
  }
  // The weakest enemy first (its whole army defends), then the weakest line.
  options.sort((a, b) => a.power - b.power || a.line - b.line || (a.id < b.id ? -1 : 1))
  let best: { id: RegionId; odds: number } | null = null
  for (const o of options.slice(0, 6)) {
    const owner = s.regions[o.id].owner
    const pledges: Record<NationId, Partial<UnitCounts>> = {}
    for (const m of members) if (atWar(s, m, owner) && !s.nations[m].territoryOf) pledges[m] = pledgeOf(s, m, share)
    const odds = forecastOp(s, map, f, { id: 'plan', by: f.founder, target: o.id, enemy: owner, created: s.turn, dday: s.turn + 1, pledges, status: 'planned' }, 8).winChance
    if (odds >= floor && (!best || odds > best.odds)) best = { id: o.id, odds }
  }
  return best?.id ?? null
}

/** The enemies of operations this nation's bloc has planned, or is planning in this month's orders: they are hit together on D-Day. */
export function blocOpEnemies(s: GameState, id: NationId, orders: Order[]): NationId[] {
  const f = factionOf(s, id)
  if (!f) return []
  const out = blocOf(f).ops.filter((o) => o.status === 'planned' || o.status === 'marching').map((o) => o.enemy)
  for (const o of orders) if (o.type === 'blocPlan' && s.regions[o.target]) out.push(s.regions[o.target].owner)
  return [...new Set(out)]
}

/**
 * A war the bloc chooses (`BLOC.aiWars`): a weak nation next to a member, that the leader does not like, that no member is tied to,
 * and that the members who could join would beat together with the odds of `BLOC.warOdds` (forecast with their pledges, as if they were
 * at war, on fixed seeds). Never a person's nation: a bloc at peace picks on rivals, and a player meets it only in wars of their own
 * or a member's. Null when there is none. The state is borrowed for the forecast and put back exactly.
 */
export function warOfChoice(s: GameState, map: WorldMap, f: Faction, share: number): { target: NationId; region: RegionId; odds: number } | null {
  const leader = leaderOf(f)
  const members = f.members.filter((m) => s.nations[m]?.alive && !s.nations[m].territoryOf && !s.nations[m].overlord).sort()
  if (members.length < 2) return null
  // Only while the world still has plenty of nations: in a world already eaten down to a few, blocs do not finish off the rest.
  if (Object.values(s.nations).filter((n) => n.alive).length < BLOC.warMinNations) return null
  const power = blocPower(s, f)
  const started = (id: NationId) => hasCasusBelli(s, leader, id) || (s.cases ?? []).some((c) => c.holder === leader && c.target === id)
  const owned = new Set(members.flatMap((m) => regionsOf(s, m)))
  const near = new Set<NationId>()
  for (const r of owned) for (const x of map.regions[r]?.neighbors ?? []) {
    const o = s.regions[x]?.owner
    if (o && !members.includes(o)) near.add(o)
  }
  const options = [...near]
    .filter((id) => {
      const t = s.nations[id]
      if (!t?.alive || t.overlord || t.territoryOf || s.humans.includes(id) || t.isPlayer) return false
      if (factionOf(s, id)) return false
      if (joinProblem(s, leader, id)) return false
      if (members.some((m) => isAllied(s, m, id) || hasPact(s, m, id))) return false
      if (militaryPower(s, id) > power * BLOC.warPowerShare) return false
      return opinionOf(s, map, leader, id, { coalition: false }) < BLOC.warOpinion
    })
    // A target the leader is already building a case against (or holds a reason for) comes first, so the bloc follows one war through.
    .sort((a, b) => Number(started(b)) - Number(started(a)) || militaryPower(s, a) - militaryPower(s, b) || (a < b ? -1 : 1))
  for (const id of options.slice(0, 4)) {
    const joiners = members.filter((m) => !joinProblem(s, m, id))
    if (joiners.length < 2 || !joiners.includes(leader)) continue
    const keys = joiners.map((m) => pairKey(m, id))
    const wars = s.wars
    s.wars = [...wars, ...keys]
    try {
      const regions = regionsOf(s, id)
        .filter((r) => joiners.some((m) => canAttackRegion(s, map, m, r).ok))
        // The leader declares, so a country it can reach itself comes first: the operation can then be planned in the same month.
        .sort((a, b) => Number(canAttackRegion(s, map, leader, b).ok) - Number(canAttackRegion(s, map, leader, a).ok) || Number(s.nations[id].capital === b) - Number(s.nations[id].capital === a) || s.regions[a].line - s.regions[b].line || (a < b ? -1 : 1))
      const region = regions[0]
      if (!region) continue
      const pledges: Record<NationId, Partial<UnitCounts>> = {}
      for (const m of joiners) pledges[m] = pledgeOf(s, m, share)
      const odds = forecastOp(s, map, f, { id: 'plan', by: leader, target: region, enemy: id, created: s.turn, dday: s.turn + 1, pledges, status: 'planned' }, 8).winChance
      if (odds >= BLOC.warOdds) return { target: id, region, odds }
    } finally {
      s.wars = wars
    }
  }
  return null
}

/** A member's answers to the bloc's calls to arms, and its pledges to planned operations. */
function answerAndPledge(s: GameState, map: WorldMap, f: Faction, nationId: NationId, hard: boolean, rng: Rng, tryAdd: TryAdd) {
  const b = blocOf(f)
  // Calls to arms: join, or say no so the members know.
  const joining = new Set<NationId>()
  for (const c of b.calls) {
    if (c.by === nationId || c.answers[nationId] || c.expires < s.turn) continue
    if (joinProblem(s, nationId, c.target)) continue
    const join = botJoinsCall(s, map, nationId, c.by, c.target, rng)
    if (tryAdd({ type: 'blocAnswer', nationId, callId: c.id, join }) && join) joining.add(c.target)
  }

  // Operations: pledge a share of the free divisions to any planned one against an enemy, unless a war of its own needs them at home.
  // An operation needs a real force to win (a country is defended by its owner's whole army), so a rival sends most of what is free.
  const share = hard ? 0.85 : 0.75
  for (const op of b.ops) {
    if (op.status !== 'planned' || op.pledges[nationId]) continue
    const owner = s.regions[op.target]?.owner
    // A member that answers the call this month is at war by the time the operation fights (answers come first).
    if (!owner || !(atWar(s, nationId, owner) || (BLOC.aiWars && joining.has(owner)))) continue
    const others = enemiesOf(s, nationId).filter((e) => e !== owner && !f.members.includes(e))
    if (others.some((e) => militaryPower(s, e) > militaryPower(s, nationId) * 0.8)) continue
    const units = pledgeOf(s, nationId, share)
    if (totalUnits({ infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0, ...units }) >= 0.3) tryAdd({ type: 'blocCommit', nationId, opId: op.id, units })
  }

}

/**
 * Live games (`BLOC.liveAnswers`): the rival members of each bloc that asked something of them (an operation planned, a call to arms)
 * answer and pledge on the day after, through the same orders a person gives, so a short operation does not set out without them.
 * Deterministic: a stream of its own, seeded by the day; members in a fixed order. `apply` carries out one order now and says whether it went through.
 */
export function blocBotAnswers(s: GameState, map: WorldMap, today: number, apply: TryAdd) {
  const diff = difficultyOf(s.settings.difficulty)
  if (!BLOC.on || !BLOC.liveAnswers || !diff.coalitions) return
  for (const f of [...(s.factions ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const b = f.bloc
    if (!b || b.ask === undefined || b.ask > today) continue
    delete b.ask
    for (const m of [...f.members].sort()) {
      const n = s.nations[m]
      if (!n?.alive || n.overlord || n.territoryOf || s.humans.includes(m)) continue
      const rng = createRng((s.seed ^ 0x0b10ca11) >>> 0, today * 100003 + hashString(m))
      answerAndPledge(s, map, f, m, diff.skill === 2, rng, apply)
    }
  }
}

/**
 * A rival's bloc play for the month: join or found a bloc around friends and shared enemies, take a role, answer calls to arms, pledge
 * divisions to operations and, as leader, invite, call the bloc to arms and plan operations. Easy rivals stay out (they never gang up).
 * Bounded so blocs cannot run away: two operations at a time, a share of each member's free divisions, and never against a player in
 * their grace months. It uses its own random stream.
 */
export function blocBotOrders(s: GameState, map: WorldMap, nationId: NationId, tryAdd: TryAdd) {
  const diff = difficultyOf(s.settings.difficulty)
  const me = s.nations[nationId]
  if (!BLOC.on || !diff.coalitions || !me?.alive || me.overlord || me.territoryOf) return
  const persona = PERSONALITIES[me.personality ?? 'honorable']
  const rng = createRng((s.seed ^ 0x0b10cb07) >>> 0, s.turn * 100003 + hashString(nationId))
  const hard = diff.skill === 2
  const f = factionOf(s, nationId)
  const humanOk = (id: NationId) => !s.humans.includes(id) || (s.turn >= diff.playerGracePeriod && enemiesOf(s, id).length <= diff.maxWarsOnPlayer)

  if (!f) {
    for (const g of s.factions ?? []) {
      if (!g.invites.some((i) => i.nation === nationId && i.expires >= s.turn)) continue
      if (botAcceptsInvite(s, map, nationId, g, rng) && tryAdd({ type: 'factionJoin', nationId, factionId: g.id })) return
    }
    if (s.turn < 4 || me.resources.pp < FACTION.foundInfluence + 4) return
    // Friends: allies, and nations fighting the same enemy that it does not dislike.
    const foes = enemiesOf(s, nationId)
    const brothers = Object.values(s.nations).filter((n) => n.alive && n.id !== nationId && !n.overlord && foes.some((e) => atWar(s, n.id, e)) && opinionOf(s, map, nationId, n.id, { coalition: false }) >= 0).map((n) => n.id)
    const friends = [...new Set([...alliesOf(s, nationId), ...brothers])].filter((a) => s.nations[a]?.alive && !factionOf(s, a) && !s.nations[a].overlord)
    if (friends.length === 0) return
    // Fewer new blocs the more there are: a rival would rather join one.
    if (!rng.chance(((hard ? 0.18 : 0.1) * persona.loyalty * (brothers.length ? 1.5 : 1)) / (1 + (s.factions?.length ?? 0) / 6))) return
    tryAdd({ type: 'factionFound', nationId, name: factionName(s, nationId) })
    return
  }

  const b = blocOf(f)
  // A role, the first free one that suits.
  if (!b.roles[nationId] && f.members.length >= 2) {
    const taken = new Set(Object.entries(b.roles).filter(([m]) => f.members.includes(m)).map(([, r]) => r))
    const role = preferredRoles(s, nationId).find((r) => !taken.has(r) && ROLES.some((x) => x.id === r))
    if (role) tryAdd({ type: 'blocRole', nationId, role })
  }

  answerAndPledge(s, map, f, nationId, hard, rng, tryAdd)
  const share = hard ? 0.85 : 0.75

  if (leaderOf(f) !== nationId) return
  // The leader brings friends in.
  if (f.members.length < FACTION.maxMembers && f.members.length < 5 && rng.chance(0.2)) {
    const candidates = [...alliesOf(s, nationId), ...Object.values(s.nations).filter((n) => n.alive && opinionOf(s, map, nationId, n.id, { coalition: false }) >= 25).map((n) => n.id)]
    const free = [...new Set(candidates)].filter((id) => id !== nationId && s.nations[id]?.alive && !factionOf(s, id) && !s.nations[id].overlord && !s.nations[id].territoryOf).sort()
    for (const id of free.slice(0, 2)) if (tryAdd({ type: 'factionInvite', nationId, target: id })) break
  }
  if (f.members.length < 2) return
  // A call to arms against an enemy the others are not fighting yet.
  for (const e of enemiesOf(s, nationId).sort()) {
    if (f.members.includes(e) || b.calls.some((c) => c.target === e) || !humanOk(e)) continue
    if (f.members.every((m) => m === nationId || atWar(s, m, e) || !!joinProblem(s, m, e))) continue
    if (rng.chance(0.4 * diff.aggression) && tryAdd({ type: 'blocCall', nationId, target: e })) break
  }
  // An operation: one at a time for a rival bloc, against the weakest country of an enemy it can reach.
  if (b.ops.some((o) => o.status === 'planned' || o.status === 'marching')) return
  // A bloc at peace chooses a war it can win together: the case first, then the war (the members are called in when it starts).
  if (BLOC.aiWars && s.turn >= 6 && f.members.every((m) => enemiesOf(s, m).length === 0)) {
    // A case already under way, or a reason in hand, is followed through; otherwise the bloc thinks of a war now and then.
    const pursuing = (s.cases ?? []).some((c) => c.holder === nationId) || Object.keys(s.casusBelli).some((k) => k.startsWith(`${nationId}|`) && s.casusBelli[k] >= s.turn)
    if (rng.next() >= (hard ? BLOC.warChance.hard : BLOC.warChance.normal) * persona.aggression && !pursuing) return
    const war = warOfChoice(s, map, f, share)
    if (!war) return
    if (hasCasusBelli(s, nationId, war.target)) {
      // The war and its operation in one month: the members are called in as it starts, and pledge when they answer.
      // (A country only another member reaches is planned next month, once that member has answered the call.)
      if (tryAdd({ type: 'declareWar', nationId, target: war.target }) && canAttackRegion(s, map, nationId, war.region).ok) tryAdd({ type: 'blocPlan', nationId, target: war.region, when: isLive(s) ? 12 : 1 })
    }
    else if (!(s.cases ?? []).some((c) => c.holder === nationId && c.target === war.target)) {
      if (!(hard && tryAdd({ type: 'operation', nationId, op: 'case', target: war.target }))) tryAdd({ type: 'buildCase', nationId, target: war.target })
    }
    return
  }
  if (!rng.chance((hard ? 0.7 : 0.45) * persona.aggression)) return
  const target = opTarget(s, map, f, share, BLOC.aiWars ? (hard ? BLOC.opFloor.hard : BLOC.opFloor.normal) : hard ? 0.4 : 0.5, humanOk)
  if (!target) return
  tryAdd({ type: 'blocPlan', nationId, target, when: isLive(s) ? 12 : 1 })
}
