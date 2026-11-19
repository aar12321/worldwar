import { describe, expect, it } from 'vitest'
import { advise } from '../advisor'
import { advanceDay, startLive } from '../live'
import { incomingMissiles, missileKinds, missileStock } from '../missiles'
import { createRng } from '../rng'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { forecastAttack, resolveAttack } from '../warfare'
import type { GameState, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)

/** r0 at war with r1, with a big army and a stock of hypersonic missiles that must not leave by themselves. */
function war(live = false): GameState {
  const s = startState(map)
  s.wars.push('r0|r1')
  s.nations.r0.resources.capital = 3000
  s.nations.r0.resources.steel = 200
  s.regions.r0.buildings.factory = 1
  setMilitary(s, 'r0', { infantry: 20, armor: 6, artillery: 4, fighter: 2, missile: 40 })
  setMilitary(s, 'r1', { infantry: 2 })
  s.regions.r1.line = 6
  return live ? startLive(s) : s
}
const attack = (extra: Partial<Extract<Order, { type: 'attack' }>> = {}): Order => ({ type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin', stance: 'assault', ...extra })

describe('an attack never carries missiles it was not told to', () => {
  it('a turn-game attack with no missiles named fires none, however big the stock', () => {
    const s = war()
    const out = applyOrderNow(s, map, attack())
    expect(out.error).toBeNull()
    expect(s.nations.r0.military.units.missile).toBe(40)
    expect(out.battle?.attacker.units.missile).toBe(0)
    expect(out.battle?.modifiers.some((m) => m.startsWith('Fired') || m.includes('batteries'))).toBe(false)
  })

  it('naming a number fires exactly that many, and they are used up', () => {
    const s = war()
    const out = applyOrderNow(s, map, attack({ missiles: 5 }))
    expect(out.battle?.attacker.units.missile).toBe(5)
    expect(s.nations.r0.military.units.missile).toBe(35)
  })

  it('a share of the stock is never taken: 0 and "left out" play the same fight', () => {
    const a = war()
    const b = war()
    const ra = resolveAttack(a, map, 'r0', 'r1', createRng(3, 1), 'allin', 'assault')!
    const rb = resolveAttack(b, map, 'r0', 'r1', createRng(3, 1), 'allin', 'assault', 0)!
    expect(JSON.stringify(ra.report)).toEqual(JSON.stringify(rb.report))
    expect(a.nations.r0.military.units.missile).toBe(40)
  })

  it('the forecast agrees: leaving missiles out is the same as naming none', () => {
    const s = war()
    expect(JSON.stringify(forecastAttack(s, map, 'r0', 'r1', 'allin', 'assault', 8))).toEqual(JSON.stringify(forecastAttack(s, map, 'r0', 'r1', 'allin', 'assault', 8, 0)))
  })

  it('a month-end attack from the order list fires none either', () => {
    const s = war()
    const next = resolveTurn(s, map, [attack()])
    expect(next.battles.length).toBe(1)
    expect(next.nations.r0.military.units.missile).toBe(40)
  })

  it('a live army sets out without missiles, and with only the ones named', () => {
    const s = war(true)
    const out = applyOrderNow(s, map, attack())
    expect(out.error).toBeNull()
    expect(out.army!.units.missile).toBe(0)
    expect(s.nations.r0.military.units.missile).toBe(40)

    const t = war(true)
    const named = applyOrderNow(t, map, attack({ missiles: 7 }))
    expect(named.army!.units.missile).toBe(7)
    expect(t.nations.r0.military.units.missile).toBe(33)
  })
})

describe('what the missile screens read from the engine', () => {
  it('lists the kinds a nation has or can build, and nothing else', () => {
    const s = startState(map)
    const n = s.nations.r0
    expect(missileKinds(n)).toEqual([])
    n.arsenal = { ballistic: 2 }
    expect(missileKinds(n)).toEqual(['ballistic'])
    n.missileProgram = 2
    expect(missileKinds(n)).toEqual(['cruise', 'tactical', 'ballistic', 'decoy'])
    n.techs.push('frontier_hypersonic')
    expect(missileKinds(n)).toContain('hypersonic')
  })

  it('a flight is incoming only to the nation that holds its target, and not to the one who fired it', () => {
    const s = war(true)
    s.flights = [
      { id: 'f1', nationId: 'r1', from: 'r1', target: 'r0', count: 3, kind: 'ballistic', launched: 0, lands: 3 },
      { id: 'f2', nationId: 'r0', from: 'r0', target: 'r1', count: 1, launched: 0, lands: 1 },
    ]
    expect(incomingMissiles(s, 'r0').map((f) => f.id)).toEqual(['f1'])
    expect(incomingMissiles(s, 'r1').map((f) => f.id)).toEqual(['f2'])
  })

  it('a struck nation records who hit it, and live flights land after their own days', () => {
    const s = war(true)
    s.nations.r0.arsenal = { cruise: 6, ballistic: 6 }
    s.regions.r0.buildings.factory = 1
    const fire = (kind: 'cruise' | 'ballistic'): Order => ({ type: 'strike', nationId: 'r0', target: 'r1', weapon: 'missile', kind, count: 2 })
    expect(applyOrderNow(s, map, fire('cruise')).error).toBeNull()
    expect(applyOrderNow(s, map, fire('ballistic')).error).toBeNull()
    expect(s.flights!.map((f) => f.lands - f.launched)).toEqual([2, 3])
    expect(missileStock(s.nations.r0, 'cruise')).toBe(4)
    let cur = s
    for (let i = 0; i < 3; i++) cur = advanceDay(cur, map, { planner: () => [] }).state
    expect(cur.flights).toHaveLength(0)
    expect(cur.nations.r1.struckBy?.r0).toBe(cur.turn)
  })
})

describe('the advisor after a missile strike', () => {
  const struck = () => {
    const s = startState(map)
    s.wars.push('r0|r1')
    s.regions.r0.buildings.factory = 1
    ;(s.nations.r0.struckBy ??= {}).r1 = s.turn
    s.nations.r0.resources.capital = 1000
    s.nations.r0.resources.tp = 200
    return s
  }

  it('with nothing to answer with, it suggests raising the program and says what it costs', () => {
    const s = struck()
    const a = advise(s, map, 'r0', [], 20).find((x) => x.id === 'struck-r1')!
    expect(a.urgency).toBe('now')
    expect(a.target).toEqual({ desk: 'military', tab: 'systems' })
    expect(a.detail).toMatch(/missile program/)
    expect(a.detail).toMatch(/120 money, 10 research/)
  })

  it('with missiles in range, it sends you to Missile War to answer (never to the War Room: an attack carries no missiles)', () => {
    const s = struck()
    s.nations.r0.arsenal = { cruise: 4 }
    const a = advise(s, map, 'r0', [], 20).find((x) => x.id === 'struck-r1')!
    expect(a.target).toEqual({ desk: 'military', tab: 'missiles', region: 'r1' })
    expect(a.detail).toMatch(/Missile War/)
    expect(a.detail).toMatch(/4 cruise missiles/)
  })

  it('goes quiet once the strike is old, or the war is over', () => {
    const s = struck()
    s.turn += 3
    expect(advise(s, map, 'r0', [], 20).some((x) => x.id === 'struck-r1')).toBe(false)
    const t = struck()
    t.wars = []
    expect(advise(t, map, 'r0', [], 20).some((x) => x.id === 'struck-r1')).toBe(false)
  })
})
