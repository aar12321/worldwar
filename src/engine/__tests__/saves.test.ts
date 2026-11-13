import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { encodeState, decodeState, fingerprint } from '../../net/protocol'
import { normalizeGame } from '../migrate'
import { resolveTurn } from '../resolveTurn'
import { UNIT_TYPES, type GameState } from '../types'

const { map } = getWorld()

/** A game as an older version saved it: none of the newer fields. */
function oldSave(): GameState {
  const s = createInitialState(map, { playerRegionId: 'germany', seed: 3 })
  const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
  for (const k of ['stocks', 'crises', 'cases', 'reasons', 'infamy', 'intel', 'humans', 'winner', 'eliminated']) delete raw[k]
  for (const n of Object.values(raw.nations as Record<string, Record<string, unknown>>)) {
    for (const k of ['systems', 'lastStrike', 'lastOrbital', 'agencies', 'secureUntil', 'overlordSince']) delete n[k]
    const units = (n.military as { units: Record<string, number>; drill: Record<string, number>; weapons: Record<string, number> })
    for (const u of ['drone', 'robot', 'missile']) {
      delete units.units[u]
      delete units.drill[u]
      delete units.weapons[u]
    }
  }
  for (const r of Object.values(raw.regions as Record<string, Record<string, unknown>>)) delete r.governor
  delete (raw.settings as Record<string, unknown>).goal
  return raw as unknown as GameState
}

describe('older saves and online snapshots', () => {
  it('an older save opens with every newer field filled in, and keeps playing', () => {
    const game = normalizeGame(oldSave(), map)
    const me = game.nations[game.playerId]
    expect(me.systems).toEqual({ cyber: 0, shield: 0, ai: 0, quantum: 0, orbital: 0, nano: 0 })
    expect(me.agencies.foreign.level).toBeGreaterThanOrEqual(0)
    for (const u of UNIT_TYPES) expect(Number.isFinite(me.military.units[u])).toBe(true)
    expect(game.stocks.price).toBeTruthy()
    expect(game.crises).toEqual([])
    expect(game.humans).toEqual([game.playerId])
    expect(game.settings.goal).toBe('classic')
    let cur = game
    for (let i = 0; i < 6; i++) cur = resolveTurn(cur, map, generateAllBotOrders(cur, map))
    expect(cur.turn).toBe(game.turn + 6)
    for (const n of Object.values(cur.nations)) for (const u of UNIT_TYPES) expect(Number.isFinite(n.military.units[u])).toBe(true)
  })

  it('a long game still fits an online snapshot in a few small pieces and survives the trip', async () => {
    let s = createInitialState(map, { playerRegionId: 'germany', seed: 4, difficulty: 'hard' })
    for (let i = 0; i < 40; i++) s = resolveTurn(s, map, generateAllBotOrders(s, map))
    const parts = await encodeState(s)
    expect(parts.every((p) => p.length <= 40_000)).toBe(true)
    const bytes = parts.reduce((sum, p) => sum + p.length, 0)
    // Squeezed, the whole world is well under a megabyte, so it travels in a handful of messages.
    expect(bytes).toBeLessThan(200_000)
    expect(parts.length).toBeLessThanOrEqual(5)
    const back = await decodeState(parts)
    expect(fingerprint(back)).toBe(fingerprint(s))
    expect(JSON.stringify(back)).toBe(JSON.stringify(s))
  })
})
