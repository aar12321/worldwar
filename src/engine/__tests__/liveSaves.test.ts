import { describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { daysInMonth } from '../calendar'
import { normalizeGame } from '../migrate'
import { advanceDay, startLive } from '../live'
import { applyOrderNow } from '../resolveTurn'
import type { GameState } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

function midMarch(): GameState {
  let s = startLive(startState(map))
  s.wars.push('r0|r1')
  s.nations.r0.resources.capital = 2000
  setMilitary(s, 'r0', { infantry: 20, armor: 4, missile: 4 })
  setMilitary(s, 'r1', { infantry: 3 })
  s.regions.r0.buildings.factory = 1
  applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault', missiles: 2 })
  s = advanceDay(s, map, { planner: () => [] }).state
  // A day on: the army is on the road and a salvo has just been fired.
  applyOrderNow(s, map, { type: 'strike', nationId: 'r0', target: 'r1', weapon: 'missile', count: 1 })
  return s
}

const LIVE_KEYS = ['day', 'armies', 'launches', 'flights']

describe('saves and live games', () => {
  it('a turn game gets no live fields when it is loaded', () => {
    const s = startState(map)
    const loaded = normalizeGame(JSON.parse(JSON.stringify(s)), map)
    for (const key of LIVE_KEYS) expect(key in loaded).toBe(false)
    expect('mode' in loaded.settings).toBe(false)
  })

  it('a live game saved mid-march, with an army and a missile in the air, loads and plays on exactly the same', () => {
    const s = midMarch()
    expect(s.armies).toHaveLength(1)
    expect(s.flights).toHaveLength(1)
    const loaded = normalizeGame(JSON.parse(JSON.stringify(s)), map)
    expect(loaded.settings.mode).toBe('live')
    let a = s
    let b = loaded
    for (let i = 0; i < 12; i++) {
      a = advanceDay(a, map, { planner: (st, m) => generateAllBotOrders(st, m) }).state
      b = advanceDay(b, map, { planner: (st, m) => generateAllBotOrders(st, m) }).state
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it('a damaged live save loses what makes no sense and keeps the rest', () => {
    const s = midMarch()
    const bad = JSON.parse(JSON.stringify(s)) as GameState
    bad.day = 400
    bad.armies!.push({ ...bad.armies![0], id: 'broken', nationId: 'nobody' })
    bad.armies!.push({ ...bad.armies![0], id: 'nan', units: { ...bad.armies![0].units, infantry: Number.NaN } })
    bad.flights!.push({ ...bad.flights![0], id: 'lost', target: 'atlantis' })
    bad.launches = [{ id: 'l1', at: 5, order: { type: 'attack', nationId: 'gone', target: 'r1', commit: 'main', stance: 'assault' } }]
    const loaded = normalizeGame(bad, map)
    expect(loaded.day).toBe(daysInMonth(loaded.turn) - 1)
    expect(loaded.armies!.map((a) => a.id)).toEqual([s.armies![0].id])
    expect(loaded.flights!.map((f) => f.id)).toEqual([s.flights![0].id])
    expect(loaded.launches).toEqual([])
  })

  it('a live save with no fields at all still opens as a live game on its first day', () => {
    const s = midMarch()
    const bare = JSON.parse(JSON.stringify(s)) as Partial<GameState>
    delete bare.day
    delete bare.armies
    delete bare.launches
    delete bare.flights
    const loaded = normalizeGame(bare as GameState, map)
    expect(loaded.day).toBe(0)
    expect(loaded.armies).toEqual([])
    expect(loaded.launches).toEqual([])
    expect(loaded.flights).toEqual([])
  })
})
