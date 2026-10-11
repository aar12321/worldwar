import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../data/startingNations'
import { FIRST_EVENT_TURN, applyEventChoice, scheduleEvent } from '../events'
import { normalizeGame } from '../migrate'
import { validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import { createRng } from '../rng'
import { visibleRegions } from '../visibility'
import { giveRegions, lineMap, startState } from './fixtures'

describe('tech tree', () => {
  const map = lineMap(3)

  it('requires prerequisites and enough Tech Points', () => {
    const s = startState(map)
    const n = s.nations.r0
    expect(validateOrder(s, map, { type: 'research', nationId: 'r0', techId: 'land_heavy_tanks' })).toMatch(/Tech Points|Prerequisites/)
    n.resources.tp = 10_000
    expect(validateOrder(s, map, { type: 'research', nationId: 'r0', techId: 'land_heavy_tanks' })).toBe('Prerequisites missing')
    expect(validateOrder(s, map, { type: 'research', nationId: 'r0', techId: 'infra_farming' })).toBeNull()
  })

  it('research completes at turn end and deducts its cost', () => {
    const s = startState(map)
    s.nations.r0.resources.tp = 100
    s.nations.r0.techs = ['land_rifles']
    const next = resolveTurn(s, map, [{ type: 'research', nationId: 'r0', techId: 'infra_farming' }])
    expect(next.nations.r0.techs).toContain('infra_farming')
    expect(next.nations.r0.resources.tp).toBeLessThan(100)
  })

  it('orbital satellites reveal every army', () => {
    const s = startState(map)
    expect(visibleRegions(s, map, 'r0')).not.toBe('all')
    s.nations.r0.techs.push('air_satellites')
    expect(visibleRegions(s, map, 'r0')).toBe('all')
  })
})

describe('diplomacy', () => {
  const map = lineMap(3)

  it('declaring war costs PP and is cheaper with a casus belli', () => {
    const s = startState(map)
    s.nations.r0.resources.pp = 30
    const next = resolveTurn(s, map, [{ type: 'declareWar', nationId: 'r0', target: 'r1' }])
    expect(next.wars).toContain('r0|r1')
    const s2 = startState(map)
    s2.nations.r0.resources.pp = 12
    expect(validateOrder(s2, map, { type: 'declareWar', nationId: 'r0', target: 'r1' })).toMatch(/Political/)
    s2.casusBelli['r0|r1'] = 10
    expect(validateOrder(s2, map, { type: 'declareWar', nationId: 'r0', target: 'r1' })).toBeNull()
  })

  it('a non-aggression pact blocks war', () => {
    const s = startState(map)
    s.pacts['r0|r1'] = 20
    expect(validateOrder(s, map, { type: 'declareWar', nationId: 'r0', target: 'r1' })).toMatch(/pact/)
  })
})

describe('decision events', () => {
  const map = lineMap(4)

  it('Bread Riot: force costs PP and soldiers, imports cost Capital but raise stability', () => {
    const s = startState(map)
    s.pendingEvent = { eventId: 'bread_riot', turn: 1, rivalId: null, regionId: null }
    const force = applyEventChoice(s, map, 0)
    expect(force.nations.r0.resources.pp).toBeLessThan(s.nations.r0.resources.pp)
    expect(force.nations.r0.militaryPool).toBeLessThan(s.nations.r0.militaryPool)
    const imp = applyEventChoice(s, map, 1)
    expect(imp.nations.r0.resources.capital).toBeLessThan(s.nations.r0.resources.capital)
    expect(imp.nations.r0.stability).toBeGreaterThan(s.nations.r0.stability)
    expect(imp.pendingEvent).toBeNull()
  })

  it('Tech Defector: accepting unlocks a tech and arms the rival with a casus belli', () => {
    const s = startState(map)
    s.nations.r1.techs.push('infra_farming')
    s.pendingEvent = { eventId: 'tech_defector', turn: 1, rivalId: 'r1', regionId: null }
    const next = applyEventChoice(s, map, 0)
    expect(next.nations.r0.techs.length).toBe(s.nations.r0.techs.length + 1)
    expect(next.casusBelli['r1|r0']).toBeGreaterThan(s.turn)
  })

  it('Border Skirmish: diverting troops spawns rebels in the border region', () => {
    const s = startState(map)
    giveRegions(s, 'r0', ['r1'])
    s.pendingEvent = { eventId: 'border_skirmish', turn: 1, rivalId: null, regionId: 'r1' }
    expect(applyEventChoice(s, map, 0).regions.r1.rebels).toBeGreaterThan(0)
  })

  it('a pending decision blocks the turn from resolving', () => {
    const s = startState(map)
    s.pendingEvent = { eventId: 'bread_riot', turn: 1, rivalId: null, regionId: null }
    expect(resolveTurn(s, map, [])).toBe(s)
  })

  it('a new game keeps surprise decisions quiet for twenty turns', () => {
    const fresh = createInitialState(lineMap(3), { playerRegionId: 'r0', seed: 4, victoryShare: 0.4 })
    expect(fresh.turn).toBe(1)
    expect(fresh.pendingEvent).toBeNull()
    expect(fresh.nextEventTurn).toBe(FIRST_EVENT_TURN)

    const map = lineMap(4)
    let s = startState(map, 'r0', 3)
    s.nextEventTurn = FIRST_EVENT_TURN
    const fired: number[] = []
    for (let i = 0; i < 45; i++) {
      s = resolveTurn(s, map, [])
      if (s.turn < FIRST_EVENT_TURN) expect(s.pendingEvent).toBeNull()
      if (s.pendingEvent) {
        fired.push(s.turn)
        s = applyEventChoice(s, map, 1)
      }
    }
    expect(fired).toEqual([21, 41])
  })

  it('an early save does not spring a surprise that was about to appear', () => {
    const map = lineMap(2)
    const early = startState(map)
    early.turn = 4
    early.nextEventTurn = 6
    early.pendingEvent = { eventId: 'bread_riot', turn: 4, rivalId: null, regionId: null }
    normalizeGame(early, map)
    expect(early.pendingEvent).toBeNull()
    expect(early.nextEventTurn).toBe(FIRST_EVENT_TURN)

    const late = startState(map)
    late.turn = 30
    late.nextEventTurn = 32
    late.pendingEvent = { eventId: 'bread_riot', turn: 30, rivalId: null, regionId: null }
    normalizeGame(late, map)
    expect(late.pendingEvent?.eventId).toBe('bread_riot')
    expect(late.nextEventTurn).toBe(32)
  })

  it('scheduler never picks an event whose requirements are unmet', () => {
    const s = startState(lineMap(1))
    for (let i = 0; i < 30; i++) {
      const ev = scheduleEvent(s, lineMap(1), 'r0', createRng(i))
      if (ev?.eventId === 'border_skirmish') throw new Error('border skirmish needs a non-capital border region')
    }
  })
})
