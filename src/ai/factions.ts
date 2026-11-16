import { difficultyOf } from '../data/difficulty'
import { FACTION } from '../data/factions'
import { PERSONALITIES } from '../data/personalities'
import { emptyStock, factionName, factionOf, poolPower, poolValue, warTargetProblem } from '../engine/factions'
import { alliesOf, atWar, enemiesOf, hasCasusBelli, hasPact, isAllied } from '../engine/helpers'
import { militaryPower } from '../engine/militaryStats'
import { createRng, type Rng } from '../engine/rng'
import type { Faction, FactionGift, FactionProposal, GameState, NationId, Order, UnitType, WorldMap } from '../engine/types'
import { opinionOf } from './opinion'

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Whether a rival takes up an invitation: it likes the members, and has not been told by its difficulty to stay out of such things. */
export function botAcceptsInvite(s: GameState, map: WorldMap, botId: NationId, f: Faction, rng: Rng): boolean {
  if (!difficultyOf(s.settings.difficulty).coalitions) return false
  const me = s.nations[botId]
  if (!me?.alive || me.overlord) return false
  const persona = PERSONALITIES[me.personality ?? 'honorable']
  const feel = mean(f.members.map((m) => opinionOf(s, map, botId, m, { coalition: false })))
  // Someone it is at war with, or whose enemy it must now fight beside, is a poor partner.
  if (f.members.some((m) => atWar(s, botId, m))) return false
  const friends = f.members.filter((m) => isAllied(s, botId, m)).length
  return feel + friends * 12 + (persona.loyalty - 1) * 12 + rng.range(-4, 4) >= 8
}

type TryAdd = (o: Order) => boolean

/** What the faction's army, and its members' own, could bring against a country. */
function combinedPower(s: GameState, f: Faction): number {
  return f.members.reduce((a, m) => a + militaryPower(s, m), 0) + poolPower(s, f)
}

/** How a rival votes on a war: by what it thinks of the target, whether it has a reason, and whether the faction can win. Returns null to stay silent. */
export function botWarVote(s: GameState, map: WorldMap, botId: NationId, f: Faction, p: FactionProposal, rng: Rng): 'yes' | 'no' | null {
  const target = p.target!
  const me = s.nations[botId]
  const diff = difficultyOf(s.settings.difficulty)
  const persona = PERSONALITIES[me.personality ?? 'honorable']
  if (isAllied(s, botId, target) || hasPact(s, botId, target)) return 'no'
  if (s.humans.includes(target) && s.turn < diff.playerGracePeriod) return 'no'
  const opT = opinionOf(s, map, botId, target, { coalition: false })
  const opP = opinionOf(s, map, botId, p.by, { coalition: false })
  const ratio = combinedPower(s, f) / Math.max(1, militaryPower(s, target))
  const score = -opT * 0.45 + (hasCasusBelli(s, botId, target) ? 14 : 0) + (atWar(s, botId, target) ? 24 : 0) + (persona.aggression - 1) * 14 + opP * 0.12 + (ratio - 1.2) * 12 - 8 + rng.range(-5, 5)
  if (score > 4) return 'yes'
  if (score < -6) return 'no'
  return null
}

/** How a rival votes on a supply contract: yes when it is a gift or a fair price, no when it drains the pool. */
export function botContractVote(s: GameState, map: WorldMap, botId: NationId, f: Faction, p: FactionProposal): 'yes' | 'no' | null {
  const t = p.terms!
  const get = (Object.keys(t.pay) as (keyof typeof t.pay)[]).reduce((a, r) => a + (t.pay[r] ?? 0) * FACTION.price[r], 0) * t.months
  const give = (Object.keys(t.supply) as (keyof typeof t.supply)[]).reduce((a, r) => a + (t.supply[r] ?? 0) * FACTION.price[r], 0) * t.months
  if (get <= 0) return 'yes'
  if (get > poolValue(f) * 0.3 && get > give * 1.05) return 'no'
  const op = opinionOf(s, map, botId, p.by, { coalition: false })
  return get <= give * 1.05 && op >= -10 ? 'yes' : 'no'
}

const SOLDIERS: UnitType[] = ['infantry', 'armor', 'artillery', 'fighter', 'air', 'naval', 'drone', 'robot']

/**
 * The rival's faction play for the month: join, vote, pay in, invite, and (for the faction's leader) put a war to the vote.
 * Easy rivals stay out of it altogether: they never gang up. It uses its own random stream, so it never moves the rest of a bot's month.
 */
export function factionBotOrders(s: GameState, map: WorldMap, nationId: NationId, tryAdd: TryAdd) {
  const diff = difficultyOf(s.settings.difficulty)
  const me = s.nations[nationId]
  if (!diff.coalitions || !me?.alive || me.overlord) return
  const persona = PERSONALITIES[me.personality ?? 'honorable']
  const rng = createRng(s.seed ^ 0x5fac7105, s.turn * 100003 + hashString(nationId))
  const f = factionOf(s, nationId)
  const hard = diff.skill === 2

  if (!f) {
    // An invitation first, then maybe a faction of its own with its friends.
    for (const g of s.factions ?? []) {
      if (!g.invites.some((i) => i.nation === nationId && i.expires >= s.turn)) continue
      if (botAcceptsInvite(s, map, nationId, g, rng) && tryAdd({ type: 'factionJoin', nationId, factionId: g.id })) return
    }
    if (s.turn < 4) return
    const friends = alliesOf(s, nationId).filter((a) => s.nations[a]?.alive && !factionOf(s, a) && !s.nations[a].overlord)
    if (friends.length === 0 || me.resources.pp < FACTION.foundInfluence + 4) return
    if (!rng.chance((hard ? 0.18 : 0.1) * persona.loyalty)) return
    const charter = persona.aggression > 1.2 ? { vote: 'weighted' as const, spoils: 'share' as const } : undefined
    tryAdd({ type: 'factionFound', nationId, name: factionName(s, nationId), ...(charter ? { charter } : {}) })
    return
  }

  // Votes first: a faction's business waits on its members.
  for (const p of f.proposals) {
    if (p.votes[nationId]) continue
    const v = p.kind === 'war' ? botWarVote(s, map, nationId, f, p, rng) : botContractVote(s, map, nationId, f, p)
    if (v) tryAdd({ type: 'factionVote', nationId, proposalId: p.id, vote: v })
  }

  // Paying in: spare money and fuel every few months, and a part of the army when it is safe at home.
  if ((s.turn + hashString(nationId)) % 3 === 0) {
    const gift: FactionGift = { stock: emptyStock(), units: {} }
    const spare = me.resources.capital - 170
    if (spare > 40) gift.stock!.money = Math.floor(spare * (hard ? 0.4 : 0.28))
    if (me.resources.oil > 30) gift.stock!.oil = Math.floor((me.resources.oil - 18) * 0.4)
    if (me.resources.steel > 50) gift.stock!.steel = Math.floor((me.resources.steel - 30) * 0.4)
    const foes = enemiesOf(s, nationId)
    const safe = foes.every((e) => f.wars.some((w) => w.target === e))
    const mine = me.military.units
    const inPool = SOLDIERS.reduce((a, k) => a + f.pool.units[k], 0)
    const home = SOLDIERS.reduce((a, k) => a + mine[k], 0)
    if (safe && home > 3 && inPool < home * 0.8) for (const k of SOLDIERS) if (mine[k] >= 1) gift.units![k] = Math.floor(mine[k] * (hard ? 0.3 : 0.2) * 10) / 10
    const hasStock = Object.values(gift.stock!).some((v) => (v ?? 0) > 0)
    const hasUnits = Object.values(gift.units!).some((v) => (v ?? 0) > 0)
    if (hasStock || hasUnits) {
      const tidy: FactionGift = { stock: Object.fromEntries(Object.entries(gift.stock!).filter(([, v]) => (v ?? 0) > 0)), units: Object.fromEntries(Object.entries(gift.units!).filter(([, v]) => (v ?? 0) > 0)) }
      if (!tryAdd({ type: 'factionContribute', nationId, gift: tidy })) {
        // Money alone, if the whole gift was too much.
        if (tidy.stock?.money) tryAdd({ type: 'factionContribute', nationId, gift: { stock: { money: tidy.stock.money } } })
      }
    }
  }

  // Only the founder speaks for the faction: they bring friends in and put wars to the vote.
  if (f.founder !== nationId) return
  if (f.members.length < FACTION.maxMembers && f.members.length < 5 && rng.chance(0.2)) {
    const candidates = [...alliesOf(s, nationId), ...Object.values(s.nations).filter((n) => n.alive && opinionOf(s, map, nationId, n.id, { coalition: false }) >= 25).map((n) => n.id)]
    const free = [...new Set(candidates)].filter((id) => id !== nationId && s.nations[id]?.alive && !factionOf(s, id) && !s.nations[id].overlord).sort()
    for (const id of free.slice(0, 2)) if (tryAdd({ type: 'factionInvite', nationId, target: id })) break
  }
  if (f.members.length < 2 || s.turn < 3 || f.wars.length > 0 || f.proposals.some((p) => p.kind === 'war')) return
  if (!rng.chance(0.22 * persona.aggression * diff.aggression)) return
  const mightiest = combinedPower(s, f)
  let best: { id: NationId; ratio: number } | null = null
  for (const t of Object.values(s.nations).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!t.alive || f.members.includes(t.id)) continue
    if (s.humans.includes(t.id) && (s.turn < diff.playerGracePeriod || enemiesOf(s, t.id).length >= diff.maxWarsOnPlayer)) continue
    // A reason: one of ours is already at war with them, or holds a case against them, or the leader simply cannot stand them.
    const reason = f.members.some((m) => atWar(s, m, t.id) || hasCasusBelli(s, m, t.id)) || opinionOf(s, map, nationId, t.id, { coalition: false }) <= -20
    if (!reason) continue
    const power = Math.max(1, militaryPower(s, t.id))
    const ratio = mightiest / power
    if (ratio < (diff.warDeclarePowerRatio / persona.risk) * 0.85) continue
    if (warTargetProblem(s, map, f, nationId, t.id)) continue
    if (!best || ratio > best.ratio) best = { id: t.id, ratio }
  }
  if (best) tryAdd({ type: 'factionPropose', nationId, proposal: { kind: 'war', target: best.id } })
}
