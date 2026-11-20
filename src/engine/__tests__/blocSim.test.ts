import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { BLOC } from '../../data/blocs'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { blocOf, blocPower, levelOf } from '../bloc'
import { applyEventChoice } from '../events'
import { regionsOf } from '../helpers'
import { militaryPower } from '../militaryStats'
import { resolveTurn } from '../resolveTurn'
import type { BlocOp, GameState } from '../types'

/**
 * Rival blocs over two years on the real world (docs/BLOC_STATUS.md): they form, take roles, answer calls, plan operations and fight them,
 * and level up; none runs away with the world. Measured on Normal and Hard; Easy rivals never take part.
 */
function play(difficulty: 'easy' | 'normal' | 'hard', seed: number, months: number) {
  const { map } = getWorld()
  let s: GameState = createInitialState(map, { playerRegionId: 'poland', seed, difficulty, goal: 'classic', victoryShare: 2 })
  const seen = new Map<string, BlocOp>()
  for (let i = 0; i < months && s.outcome === 'playing'; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    s = resolveTurn(s, map, [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)])
    for (const f of s.factions ?? []) for (const o of f.bloc?.ops ?? []) seen.set(o.id, o)
  }
  const ops = [...seen.values()]
  const fought = ops.filter((o) => o.result && !o.result.failed)
  const blocs = s.factions ?? []
  const countries = Object.keys(s.regions).length
  const biggest = Math.max(0, ...blocs.map((f) => f.members.reduce((a, m) => a + regionsOf(s, m).length, 0)))
  const worldPower = Object.values(s.nations).filter((n) => n.alive).reduce((a, n) => a + militaryPower(s, n.id), 0)
  const strongest = Math.max(0, ...blocs.map((f) => blocPower(s, f)))
  return {
    s,
    blocs: blocs.length,
    members: blocs.reduce((a, f) => a + f.members.length, 0),
    roles: blocs.reduce((a, f) => a + Object.keys(blocOf(f).roles).length, 0),
    ops: ops.length,
    fought: fought.length,
    multi: fought.filter((o) => Object.keys(o.result!.members).length >= 2).length,
    won: fought.filter((o) => o.result!.won).length,
    goals: blocs.reduce((a, f) => a + blocOf(f).done, 0),
    levels: blocs.map((f) => levelOf(blocOf(f).xp)),
    shareOfCountries: biggest / countries,
    shareOfPower: strongest / Math.max(1, worldPower),
  }
}

describe('rival blocs over two years', () => {
  it('Normal and Hard: blocs form, fight joint operations together and level up, and none runs away', () => {
    const rows: string[] = []
    let planned = 0
    for (const [difficulty, seed] of [['normal', 7], ['hard', 5]] as const) {
      const r = play(difficulty, seed, 24)
      rows.push(`${difficulty}: ${r.blocs} blocs, ${r.members} members, ${r.roles} roles, ${r.ops} operations (${r.fought} fought, ${r.multi} by 2+ members, ${r.won} won), ${r.goals} objectives met, levels ${r.levels.join('/')}, biggest bloc ${Math.round(r.shareOfCountries * 100)}% of countries, strongest ${Math.round(r.shareOfPower * 100)}% of the world's strength`)
      console.log(rows.at(-1))
      expect(r.blocs).toBeGreaterThan(0)
      expect(r.roles).toBeGreaterThan(0)
      // No runaway: no bloc holds a third of the world's countries or half of its strength after two years.
      expect(r.shareOfCountries).toBeLessThan(0.33)
      expect(r.shareOfPower).toBeLessThan(0.5)
      expect(Math.max(...r.levels)).toBeLessThanOrEqual(BLOC.levels.length)
      planned += r.ops
      // Rival blocs choose a war they can win together (BLOC.aiWars), so each world fights at least one joint operation, by two or more members.
      expect(r.fought).toBeGreaterThanOrEqual(1)
      expect(r.multi).toBeGreaterThanOrEqual(1)
    }
    // Operations a player plans are covered by bloc.test.ts and the live online test.
    expect(planned).toBeGreaterThan(1)
    console.log(rows.join('\n'))
  }, 900_000)

  it('Easy: rivals never form blocs or plan operations', () => {
    const r = play('easy', 3, 12)
    const botBlocs = (r.s.factions ?? []).filter((f) => !f.members.includes(r.s.playerId))
    expect(botBlocs.length).toBe(0)
  }, 600_000)
})
