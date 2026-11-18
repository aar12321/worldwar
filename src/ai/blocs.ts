import { BLOC, ROLES } from '../data/blocs'
import { difficultyOf } from '../data/difficulty'
import { FACTION } from '../data/factions'
import { PERSONALITIES } from '../data/personalities'
import { blocOf, blocPower, forecastOp, joinProblem, leaderOf, sendable } from '../engine/bloc'
import { isLive } from '../engine/calendar'
import { SENDABLE } from '../engine/deploy'
import { factionName, factionOf } from '../engine/factions'
import { alliesOf, atWar, enemiesOf, regionsOf, totalUnits } from '../engine/helpers'
import { militaryPower } from '../engine/militaryStats'
import { createRng } from '../engine/rng'
import type { BlocRole, Faction, GameState, NationId, Order, RegionId, UnitCounts, WorldMap } from '../engine/types'
import { canAttackRegion } from '../engine/warfare'
import { botAcceptsInvite } from './factions'
import { opinionOf } from './opinion'

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

/** Whether a rival answers a call to arms: it dislikes the enemy, the bloc is stronger, and it is not busy with a war of its own. */
export function botJoinsCall(s: GameState, map: WorldMap, id: NationId, by: NationId, target: NationId, rng: { range: (a: number, b: number) => number }): boolean {
  const diff = difficultyOf(s.settings.difficulty)
  if (joinProblem(s, id, target)) return false
  if (s.humans.includes(target) && (s.turn < diff.playerGracePeriod || enemiesOf(s, target).length >= diff.maxWarsOnPlayer)) return false
  const f = factionOf(s, id)
  if (!f) return false
  const persona = PERSONALITIES[s.nations[id].personality ?? 'honorable']
  const ratio = blocPower(s, f) / Math.max(1, militaryPower(s, target))
  const opT = opinionOf(s, map, id, target, { coalition: false })
  const opB = opinionOf(s, map, id, by, { coalition: false })
  const busy = enemiesOf(s, id).length
  const score = -opT * 0.4 + opB * 0.15 + (persona.loyalty - 1) * 20 + (persona.aggression - 1) * 12 + (ratio - 1.3) * 10 - busy * 8 + rng.range(-5, 5)
  return score > 2
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

  // Calls to arms: join, or say no so the members know.
  for (const c of b.calls) {
    if (c.by === nationId || c.answers[nationId] || c.expires < s.turn) continue
    if (joinProblem(s, nationId, c.target)) continue
    tryAdd({ type: 'blocAnswer', nationId, callId: c.id, join: botJoinsCall(s, map, nationId, c.by, c.target, rng) })
  }

  // Operations: pledge a share of the free divisions to any planned one against an enemy, unless a war of its own needs them at home.
  // An operation needs a real force to win (a country is defended by its owner's whole army), so a rival sends most of what is free.
  const share = hard ? 0.85 : 0.75
  for (const op of b.ops) {
    if (op.status !== 'planned' || op.pledges[nationId]) continue
    const owner = s.regions[op.target]?.owner
    if (!owner || !atWar(s, nationId, owner)) continue
    const others = enemiesOf(s, nationId).filter((e) => e !== owner && !f.members.includes(e))
    if (others.some((e) => militaryPower(s, e) > militaryPower(s, nationId) * 0.8)) continue
    const units = pledgeOf(s, nationId, share)
    if (totalUnits({ infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0, ...units }) >= 0.3) tryAdd({ type: 'blocCommit', nationId, opId: op.id, units })
  }

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
  if (!rng.chance((hard ? 0.7 : 0.45) * persona.aggression)) return
  const target = opTarget(s, map, f, share, hard ? 0.4 : 0.5, humanOk)
  if (!target) return
  tryAdd({ type: 'blocPlan', nationId, target, when: isLive(s) ? 12 : 1 })
}
