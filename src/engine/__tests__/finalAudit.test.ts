import { describe, expect, it } from 'vitest'
import { BODIES, BODY_IDS, COMPANIES, DOMESTIC, MINE_IDS, MISSION_IDS, MISSIONS, NODES, ROCKETS, SPACE, type BodyId, type MineId, type MissionId, type NodeId } from '../../data/space'
import { blocsOf } from '../blocs'
import { atWar, enemiesOf, maxWars, pairKey } from '../helpers'
import { detonate } from '../nuclear'
import { validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { createRng } from '../rng'
import { newSpace, quote } from '../space'
import { discoveryBonus } from '../spaceEffects'
import type { GameState, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const line = lineMap(10)

function nuclearWorld() {
  const s = startState(line, 'r0', 3)
  const me = s.nations.r0
  me.tier = 4
  me.techs.push('frontier_hypersonic')
  me.resources.capital = 5000
  me.resources.pp = 500
  me.nuclear = { warheads: 1, building: [] }
  s.wars.push('r0|r1')
  s.regions.r1.population = 40
  setMilitary(s, 'r1', { infantry: 20 })
  return s
}

describe('the world answers a nuclear strike whatever the attacker\'s own war limit', () => {
  it('an attacker already at its limit is still declared on by the leading blocs; the declarers\' own limits still hold', () => {
    const s = nuclearWorld()
    s.alliances.push(pairKey('r2', 'r3'), pairKey('r4', 'r5'))
    setMilitary(s, 'r2', { infantry: 30 })
    setMilitary(s, 'r3', { infantry: 20 })
    setMilitary(s, 'r4', { infantry: 12 })
    setMilitary(s, 'r5', { infantry: 6 })
    // r0 already fights as many wars as it may (r1 is one of them).
    for (const id of ['r6', 'r7']) s.wars.push(pairKey('r0', id))
    s.wars.sort()
    expect(enemiesOf(s, 'r0').length).toBeGreaterThanOrEqual(maxWars(s, 'r0'))
    // r4 is stretched to its own limit and stays out.
    for (const id of ['r6', 'r7', 'r8']) if (!s.wars.includes(pairKey('r4', id))) s.wars.push(pairKey('r4', id))
    s.wars.sort()
    expect(blocsOf(s).length).toBeGreaterThan(0)
    detonate(s, line, createRng(1, 1), 'r0', 'r1')
    for (const id of ['r2', 'r3', 'r5']) expect(atWar(s, id, 'r0'), id).toBe(true)
    expect(atWar(s, 'r4', 'r0')).toBe(false)
    // Over its limit only by the answer: it cannot start a new war of its own.
    expect(enemiesOf(s, 'r0').length).toBeGreaterThan(maxWars(s, 'r0'))
    expect(validateOrder(s, line, { type: 'declareWar', nationId: 'r0', target: 'r9' })).toMatch(/already fighting/)
  })
})

// ---- space ----

const map = lineMap(8)

function spaceWorld(seed = 4): GameState {
  const s = startState(map, 'r0', seed)
  const n = s.nations.r0
  n.techs.push('air_propeller', 'air_jets')
  n.resources.capital = 20000
  n.resources.tp = 2000
  n.resources.pp = 200
  n.resources.steel = 500
  s.regions.r0.population = 400
  return s
}

/** A nation with only an outpost on a claimed body (no staff, pad or rockets), so a comparison shows the outpost and its mine alone. */
function settled(body: BodyId, discoveries: NodeId[]) {
  const s = spaceWorld()
  s.space ??= { claims: {}, launches: 0 }
  const a = (s.nations.r0.space ??= newSpace())
  Object.assign(a, { engineers: 0, astronauts: 0, pads: 0, hangar: {}, rockets: {}, exp: 900 })
  a.discoveries = [...discoveries]
  s.space.claims[body] = { owner: 'r0', turn: 0 }
  a.bodies[body] = { surveyed: true, landed: true, outpost: { level: 1, mines: {}, unsupplied: 0 } }
  return s
}

/** The month a nation that built the outpost and the mine has caught up with one that never went to space (money, steel and oil counted). */
function breakEven(body: BodyId, mine: MineId, horizon: number) {
  const value = (s: GameState) => s.nations.r0.resources.capital + (s.nations.r0.resources.steel + s.nations.r0.resources.oil * 1.1) * 1.7
  let a = settled(body, ['isru'])
  let z = spaceWorld()
  a.nations.r0.resources.capital -= MISSIONS[`outpost_${body}` as MissionId].payload
  const r = applyOrderNow(a, map, { type: 'space', nationId: 'r0', action: { kind: 'mine', body, mine } } as Order)
  if (r.error) throw new Error(r.error)
  for (let i = 1; i <= horizon; i++) {
    a = resolveTurn(a, map, [])
    z = resolveTurn(z, map, [])
    if (value(a) >= value(z)) return i
  }
  return Infinity
}

describe('space mining: every mine is a sane, but slow, choice', () => {
  // 120 or more months of a simulated nation with events off (the test fixture has none): the mine, its outpost cargo and its upkeep against a nation that stayed home.
  for (const body of BODY_IDS) {
    for (const id of MINE_IDS) {
      if (!BODIES[body].mines.includes(id)) continue
      it(`${id} on ${body} pays back in money, steel and oil in between 7 and 14 years, never quickly`, () => {
        const months = breakEven(body, id, 190)
        expect(months, `${id} on ${body}`).toBeGreaterThan(84)
        expect(months, `${id} on ${body}`).toBeLessThanOrEqual(170)
      }, 120_000)
    }
  }
})

describe('space exploits', () => {
  it('outsourcing is never a bargain: at the most mature industry the cheapest company still costs more than flying it yourself, and what a home firm returns stays below its price', () => {
    const s = spaceWorld()
    s.turn = 600
    s.space = { claims: {}, launches: 500 }
    const n = s.nations.r0
    n.sectors = { ...n.sectors, technology: 3 }
    n.space = newSpace()
    for (const id of MISSION_IDS) {
      const inHouse = ROCKETS[MISSIONS[id].rocket].cost + MISSIONS[id].payload
      for (const co of [...Object.keys(COMPANIES), DOMESTIC.id]) {
        const q = quote(s, n, id, 'outsource', co)
        if (!q.price) continue
        expect(q.price, `${id} by ${co}`).toBeGreaterThanOrEqual(inHouse * 1.15)
        // What comes back to a technology sector is a fraction of the price, so paying a firm is never a way to get a flight for free:
        // net of that return a flight still costs a tenth more than in-house.
        const back = q.price * (co === DOMESTIC.id ? DOMESTIC.share : DOMESTIC.abroadShare)
        expect(q.price - back, `${id} by ${co}`).toBeGreaterThanOrEqual(inHouse * 1.1)
      }
    }
  })

  it('a claim nobody settles lapses; one with an outpost is kept; claiming again costs influence again', () => {
    const s = settled('moon', ['isru'])
    s.space!.claims.mars = { owner: 'r0', turn: 0 }
    s.turn = SPACE.claimMonths
    let cur = resolveTurn(s, map, [])
    expect(cur.space!.claims.mars).toBeDefined()
    cur.turn = SPACE.claimMonths + 1
    cur = resolveTurn(cur, map, [])
    // The moon has an outpost: still claimed. Mars has none: it lapses and anyone may take it.
    expect(cur.space!.claims.moon?.owner).toBe('r0')
    expect(cur.space!.claims.mars).toBeUndefined()
    expect(cur.log.some((l) => /claim on Mars lapsed/.test(l.text))).toBe(true)
    cur.nations.r0.space!.bodies.mars = { surveyed: true, landed: true }
    const before = cur.nations.r0.resources.pp
    const r = applyOrderNow(cur, map, { type: 'space', nationId: 'r0', action: { kind: 'claim', body: 'mars' } } as Order)
    expect(r.error).toBeNull()
    expect(cur.nations.r0.resources.pp).toBe(before - SPACE.claimCost)
  })

  it('discoveries stack only up to a ceiling: all eighteen together never make mines more than 50% richer or the economy more than 4% bigger', () => {
    const all = Object.keys(NODES) as NodeId[]
    const bonus = discoveryBonus({ discoveries: all } as never)
    expect(bonus.mining).toBeLessThanOrEqual(SPACE.discoveryCap.mining)
    expect(bonus.output).toBeLessThanOrEqual(SPACE.discoveryCap.output)
    // Below the ceiling nothing is trimmed.
    expect(discoveryBonus({ discoveries: ['isru'] } as never).mining).toBe(NODES.isru.effect.mining ?? 0)
  })
})
