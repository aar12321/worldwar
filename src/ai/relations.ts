import { difficultyOf } from '../data/difficulty'
import { RELATIONS, PROGRAMS } from '../data/relations'
import { SECTOR_IDS } from '../data/business'
import { enemiesOf, hasPact, isAllied } from '../engine/helpers'
import { canAttackRegion } from '../engine/warfare'
import { clockMonth } from '../engine/calendar'
import { embassyOf, needLevel, plansBetween } from '../engine/relations'
import { createRng, type Rng } from '../engine/rng'
import type { GameState, NationId, Order, RelateOrder, WorldMap } from '../engine/types'
import { opinionOf } from './opinion'

const hashString = (str: string): number => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

type Add = (o: Order) => boolean

/**
 * How a rival tends its friendships (docs/RELATIONS_STATUS.md): Medium and Hard rivals open embassies with friends, visit them, send aid to a friend in need,
 * build joint ventures and research, agree joint war plans with the nations they fight beside and strike together. Easy rivals only rarely send a visit or aid.
 * Toward a player they ask, rather than act: a request waits in the inbox (see `ask` in src/engine/relations.ts).
 * Its own random stream, so nothing else in the month moves. Returns whether it ordered an attack for a joint strike this month.
 */
export function relationBotOrders(s: GameState, map: WorldMap, id: NationId, add: Add): boolean {
  if (!RELATIONS.on) return false
  const n = s.nations[id]
  if (!n?.alive || n.overlord) return false
  const diff = difficultyOf(s.settings.difficulty)
  const rng = createRng((s.seed ^ 0x7e1a) >>> 0, s.turn * 100003 + hashString(id))
  const bot = s.humans.includes(id) || n.isPlayer
  // A bot that stands in for a player answers its inbox: it takes what it can afford.
  if (bot) answerInbox(s, id, add)
  const struck = planStrikes(s, map, id, rng, add, diff.skill)
  const chance = diff.skill >= 2 ? 0.4 : diff.skill === 1 ? 0.22 : 0.025
  if (!rng.chance(chance)) return struck
  // Never at the cost of what the nation needs to run: relationships are what is left over.
  if (n.resources.pp < 25 || n.resources.capital < 90) return struck
  const live = Object.values(s.nations).filter((x) => x.alive && x.id !== id)
  const humans = new Set(s.humans)
  const mood = new Map<NationId, number>()
  const like = (x: NationId) => {
    let v = mood.get(x)
    if (v === undefined) mood.set(x, (v = opinionOf(s, map, id, x)))
    return v
  }
  const friends = live
    .filter((x) => !s.wars.includes(id < x.id ? `${id}|${x.id}` : `${x.id}|${id}`) && like(x.id) >= 0)
    .sort((a, b) => like(b.id) - like(a.id) || (a.id < b.id ? -1 : 1))
  const ai = friends.filter((x) => !humans.has(x.id))
  const players = friends.filter((x) => humans.has(x.id))
  const order = (o: Omit<RelateOrder, 'type' | 'nationId'>): Order => ({ type: 'relate', nationId: id, ...o })

  // Easy rivals: now and then a visit or a gift of food to a friend.
  if (diff.skill === 0) {
    for (const f of ai.slice(0, 3)) {
      if (add(order({ act: 'visit', target: f.id }))) return true
      if (needLevel(s, f.id, 'food') === 'dire' && add(order({ act: 'aid', target: f.id, resource: 'food', amount: 15 }))) return true
    }
    return struck
  }

  // A joint war plan with a friend that fights the same enemy.
  for (const f of ai) {
    const shared = enemiesOf(s, id).filter((e) => enemiesOf(s, f.id).includes(e) && !plansBetween(s, id, f.id).some((p) => p.enemy === e))
    if (shared.length && add(order({ act: 'warPlan', target: f.id, enemy: shared[0], months: RELATIONS.plan.months, split: rng.pick([0.2, 0.25, 0.3]) }))) return true
  }
  // Aid to a friend in dire need: it is what makes a friend.
  for (const f of ai) for (const r of ['food', 'oil'] as const) if (needLevel(s, f.id, r) === 'dire' && add(order({ act: 'aid', target: f.id, resource: r, amount: 20 }))) return true
  // Players are asked, not given to.
  for (const p of players) if (askPlayer(s, id, p.id, like(p.id), rng, add)) return true
  // The rest: a mix of what a friend is worth, tried in a random order. An embassy opens the programs; no rival keeps more than three.
  const mine = (s.relations?.embassies ?? []).filter((e) => e.from === id).length
  const tries: Order[] = []
  for (const f of ai.slice(0, 5)) {
    const hasEmbassy = !!embassyOf(s, id, f.id)
    if (!hasEmbassy && mine < 3) tries.push(order({ act: 'embassy', target: f.id }))
    tries.push(order({ act: 'visit', target: f.id }), order({ act: 'culture', target: f.id }))
    if (hasEmbassy && like(f.id) >= 12) {
      tries.push(order({ act: 'science', target: f.id }), order({ act: 'students', target: f.id }))
      if (n.personality === 'trader') tries.push(order({ act: 'tradeMission', target: f.id }))
      if (diff.skill >= 2 && n.resources.capital > 160) tries.push(order({ act: 'venture', target: f.id, sector: rng.pick(SECTOR_IDS), amount: PROGRAMS.venture.min + 10 }))
    }
  }
  for (let i = tries.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[tries[i], tries[j]] = [tries[j], tries[i]]
  }
  for (const o of tries.slice(0, 8)) if (add(o)) return true
  return struck
}

/** A rival asks a player for something it needs, if it has a reason and is liked well enough. */
function askPlayer(s: GameState, id: NationId, player: NationId, opinion: number, rng: Rng, add: Add): boolean {
  const ask = (o: Omit<RelateOrder, 'type' | 'nationId' | 'target' | 'act'>): boolean => add({ type: 'relate', nationId: id, target: player, act: 'ask', ...o })
  const n = s.nations[id]
  for (const r of ['food', 'oil'] as const) if (needLevel(s, id, r) !== 'ok' && needLevel(s, id, r) !== 'flush' && ask({ kind: 'aid', resource: r, amount: 15 })) return true
  const shared = enemiesOf(s, id).find((e) => s.wars.includes(e < player ? `${e}|${player}` : `${player}|${e}`))
  if (shared && ask({ kind: 'plan', enemy: shared, months: RELATIONS.plan.months })) return true
  if (opinion >= 20 && n.resources.capital > 160 && rng.chance(0.4) && ask({ kind: 'venture', sector: rng.pick(SECTOR_IDS), amount: PROGRAMS.venture.min + 10 })) return true
  if (n.personality === 'trader' && ask({ kind: 'trade' })) return true
  if (opinion >= 25 && rng.chance(0.3) && ask({ kind: 'visit' })) return true
  if (enemiesOf(s, id).length > 0 && ask({ kind: 'support' })) return true
  return false
}

/** A bot standing in for a player takes the requests it can afford, and turns the rest down. */
function answerInbox(s: GameState, me: NationId, add: Add) {
  for (const q of s.relations?.requests ?? []) {
    if (q.to !== me) continue
    if (!add({ type: 'relate', nationId: me, target: q.from, act: 'answer', id: q.id, accept: true })) add({ type: 'relate', nationId: me, target: q.from, act: 'answer', id: q.id, accept: false })
  }
}

/**
 * The plans this nation is in: set a day to strike an enemy country together when none is set, and send its own army against the country the plan names.
 * Returns whether an attack was ordered.
 */
function planStrikes(s: GameState, map: WorldMap, id: NationId, rng: Rng, add: Add, skill: number): boolean {
  if (skill < 1) return false
  let attacked = false
  for (const p of s.relations?.plans ?? []) {
    if (p.a !== id && p.b !== id) continue
    const partner = p.a === id ? p.b : p.a
    const month = clockMonth(s)
    if (!p.strike || p.strike.turn < month) {
      // The one who made the plan names the target, every few months, among the enemy's countries both can reach.
      if (p.a === id && (s.turn - p.start) % 3 === 0 && s.relations) {
        const options = Object.values(s.regions)
          .filter((r) => r.owner === p.enemy && canAttackRegion(s, map, id, r.id).ok && canAttackRegion(s, map, partner, r.id).ok)
          .sort((x, y) => x.line - y.line || (x.id < y.id ? -1 : 1))
        if (options.length) add({ type: 'relate', nationId: id, target: partner, act: 'strikeWindow', id: p.id, region: options[0].id, months: 1 })
      }
      continue
    }
    if (p.strike.turn === month && !attacked) {
      const region = p.strike.region
      if (s.regions[region]?.owner === p.enemy && add({ type: 'attack', nationId: id, target: region, commit: 'main', stance: 'assault', joint: p.id })) attacked = true
    }
  }
  void rng
  return attacked
}

/** Whether two nations are close enough to trust a plan: allies or pact partners count for more. Used by the AI's answers. */
export const trusted = (s: GameState, a: NationId, b: NationId) => isAllied(s, a, b) || hasPact(s, a, b)
