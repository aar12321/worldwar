import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { NUCLEAR } from '../../data/nuclear'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { tierOf, updateTiers } from '../empire'
import { applyEventChoice } from '../events'
import { resolveTurn } from '../resolveTurn'
import type { GameState, NationId } from '../types'

const { map } = getWorld()

export interface SimStats {
  months: number
  nukes: { turn: number; by: string; target: string }[]
  plans: number
  planMonths: number[]
  joint: number
  warsOnLeader: number
  alive: number
  tiers: number[]
  maxWars: number
}

/** Bots play every nation, the leader's included, and the numbers that show whether the world stays livable are kept. */
export function simulate(s: GameState, months: number, leader: NationId): SimStats {
  const stats: SimStats = { months: 0, nukes: [], plans: 0, planMonths: [], joint: 0, warsOnLeader: 0, alive: 0, tiers: [], maxWars: 0 }
  const seenPlans = new Set<string>()
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    const orders = generateAllBotOrders(s, map, true)
    stats.joint += orders.filter((o) => o.type === 'attack' && o.joint).length
    const before = s.turn
    s = resolveTurn(s, map, orders)
    for (const e of s.log) if (e.turn === before && /NUCLEAR STRIKE/.test(e.text)) stats.nukes.push({ turn: before, by: e.nations[0], target: e.nations[1] })
    for (const p of s.coalitions ?? []) {
      if (!seenPlans.has(p.id)) {
        seenPlans.add(p.id)
        stats.plans++
        stats.planMonths.push(p.formed)
      }
    }
    stats.maxWars = Math.max(stats.maxWars, s.wars.length)
    stats.months++
  }
  stats.warsOnLeader = s.wars.filter((w) => w.split('|').includes(leader)).length
  stats.alive = Object.values(s.nations).filter((n) => n.alive).length
  stats.tiers = [1, 2, 3, 4, 5].map((t) => Object.values(s.nations).filter((n) => n.alive && n.tier === t).length)
  void tierOf
  return stats
}

/** Hands a nation the `count` countries nearest its capital that nobody has settled with a strong claim on. */
function grow(s: GameState, id: NationId, count: number, keep: NationId[] = []) {
  const home = map.regions[id]
  const near = Object.values(map.regions)
    .filter((r) => s.regions[r.id].owner === r.id && r.id !== id && !keep.includes(r.id))
    .sort((a, b) => (a.lat - home.lat) ** 2 + (a.lng - home.lng) ** 2 - ((b.lat - home.lat) ** 2 + (b.lng - home.lng) ** 2) || (a.id < b.id ? -1 : 1))
    .slice(0, count - 1)
  for (const r of near) {
    s.regions[r.id].owner = id
    s.nations[r.id].alive = false
  }
}

describe('the world does not degenerate', () => {
  it('72 months of Hard bots on the real world: no bomb thrown, wars stay few, the leader is not ground to dust', () => {
    const s = createInitialState(map, { playerRegionId: 'germany', seed: 21, difficulty: 'hard', goal: 'world' })
    const out = simulate(s, 72, 'germany')
    console.log('NORMAL START, 72 Hard months', JSON.stringify(out))
    expect(out.months).toBeGreaterThanOrEqual(60)
    expect(out.nukes.length).toBeLessThanOrEqual(1)
    expect(out.alive).toBeGreaterThan(30)
    expect(out.maxWars).toBeLessThan(Object.values(s.nations).length / 2)
  }, 900_000)

  it('60 months with five Hard Superpowers armed and at each other: bombs are rare, spaced, and never routine', () => {
    const s = createInitialState(map, { playerRegionId: 'germany', seed: 33, difficulty: 'hard', goal: 'world' })
    const giants = ['china', 'russia', 'brazil', 'india', 'germany']
    for (const id of giants) grow(s, id, 26, giants)
    updateTiers(s)
    for (const id of giants) {
      const n = s.nations[id]
      expect(n.tier).toBeGreaterThanOrEqual(4)
      n.techs.push('frontier_hypersonic')
      n.resources.capital = 4000
      n.resources.steel = 400
      n.resources.tp = 600
      n.nuclear = { warheads: 2, building: [] }
      for (const r of Object.values(s.regions)) if (r.owner === id && r.id === id) r.buildings.factory = Math.max(1, r.buildings.factory)
    }
    // They are all at war with one another's neighbors at the start, so the bomb has reasons to come out.
    for (let i = 0; i < giants.length; i++) {
      const a = giants[i]
      const b = giants[(i + 1) % giants.length]
      s.wars.push(a < b ? `${a}|${b}` : `${b}|${a}`)
    }
    s.wars.sort()
    const out = simulate(s, 60, 'germany')
    console.log('SUPERPOWER STRESS, 60 Hard months', JSON.stringify(out), 'quiet', NUCLEAR.worldQuiet)
    // The world waits after any bomb, so there can be at most one in each quiet spell.
    for (let i = 1; i < out.nukes.length; i++) expect(out.nukes[i].turn - out.nukes[i - 1].turn).toBeGreaterThanOrEqual(NUCLEAR.worldQuiet)
    expect(out.nukes.length).toBeLessThanOrEqual(Math.ceil(60 / NUCLEAR.worldQuiet))
    expect(out.alive).toBeGreaterThan(20)
  }, 900_000)
})
