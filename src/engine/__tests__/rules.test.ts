import { describe, expect, it } from 'vitest'
import { getWorld } from '../../map/world'
import { applyEventChoice, scheduleEvent } from '../events'
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

  it('events fire every 2 to 4 turns on the real map', () => {
    const { map: world } = getWorld()
    let s = startState(world, 'germany', 3)
    s.nextEventTurn = 2
    const fired: number[] = []
    for (let i = 0; i < 24; i++) {
      if (s.pendingEvent) {
        fired.push(s.turn)
        s = applyEventChoice(s, world, 1)
      }
      s = resolveTurn(s, world, [])
    }
    expect(fired.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < fired.length; i++) {
      expect(fired[i] - fired[i - 1]).toBeGreaterThanOrEqual(2)
      expect(fired[i] - fired[i - 1]).toBeLessThanOrEqual(4)
    }
  })

  it('scheduler never picks an event whose requirements are unmet', () => {
    const s = startState(lineMap(1))
    for (let i = 0; i < 30; i++) {
      const ev = scheduleEvent(s, lineMap(1), 'r0', createRng(i))
      if (ev?.eventId === 'border_skirmish') throw new Error('border skirmish needs a non-capital border region')
    }
  })
})
