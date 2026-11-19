import { describe, expect, it } from 'vitest'
import { MISSILE_TYPES } from '../data/missiles'
import { MW } from '../data/missileWar'
import { strikeHitsKind } from '../engine/missiles'
import { startLive } from '../engine/live'
import { validateOrder } from '../engine/orders'
import { applyOrderNow } from '../engine/resolveTurn'
import type { GameState, MissileFlight, SalvoReport } from '../engine/types'
import { lineMap, setMilitary, startState } from '../engine/__tests__/fixtures'
import { DECAL_LIFE, FX_CAPS, LOOK, decalsFrom, flightsFor, lookColor, planFx, radarRing, reportDay, stageOf } from './missileFx'
import { nextSteps, salvoLine, warStatus } from './missileWarText'

const map = lineMap(8)
const names = (id: string) => (id === 'r0' ? 'You' : `Nation ${id}`)

function war(): GameState {
  const s = startState(map)
  s.wars.push('r0|r1', 'r0|r2')
  Object.assign(s.nations.r0.resources, { capital: 9000, steel: 900, oil: 300, tp: 500 })
  s.nations.r0.arsenal = { cruise: 20, tactical: 10 }
  s.regions.r0.buildings.factory = 2
  s.regions.r1.buildings.factory = 2
  setMilitary(s, 'r0', { infantry: 8, fighter: 2, air: 3 })
  return s
}

const report = (over: Partial<SalvoReport> = {}): SalvoReport => ({
  id: 'v1', turn: 3, from: 'r0', to: 'r1', region: 'r1', weapon: 'missile', kind: 'cruise', aim: 'country', fired: 10, hit: 6, shield: 0.25, batteries: 0.05, patrol: 0, fighters: 0.1, interceptorsUsed: 10, coverage: 1, dead: 1.2, line: 2, factories: true, buildings: 0, army: 0, stock: 0, site: false, aircraftLost: 0, place: 'Region 1', news: 'x', ...over,
})
const at = { lat: 0, lng: 5 }
const from = { lat: 0, lng: 0 }

describe('the look of each missile', () => {
  it('every kind has its own colour, thickness, height and trail in both palettes, and the colour-blind colours stay apart', () => {
    for (const key of ['color', 'cb', 'stroke', 'altitude', 'dash'] as const) expect(new Set(MISSILE_TYPES.map((k) => LOOK[k][key])).size, key).toBe(MISSILE_TYPES.length)
    // Heavier missiles climb higher and draw thicker, longer trails; a cruise missile skims.
    expect(LOOK.ballistic.altitude).toBeGreaterThan(LOOK.hypersonic.altitude)
    expect(LOOK.hypersonic.altitude).toBeGreaterThan(LOOK.cruise.altitude)
    expect(LOOK.ballistic.stroke).toBeGreaterThan(LOOK.cruise.stroke)
    expect(LOOK.ballistic.blast).toBeGreaterThan(LOOK.cruise.blast)
    expect(lookColor('cruise', 'colorblind')).not.toBe(lookColor('cruise', 'standard'))
  })
})

describe('what a salvo draws', () => {
  it('a launch flash, an interception burst with debris, and an impact ring scaled by the kind', () => {
    const plan = planFx(report(), from, at, { mine: true })
    expect(plan.rings.length).toBeGreaterThan(3)
    expect(plan.rings[0].lat).toBe(from.lat)
    // The impact ring comes last in time, at the target.
    const impact = plan.rings.filter((r) => r.lat === at.lat && r.lng === at.lng)
    expect(impact.length).toBeGreaterThan(0)
    const big = planFx(report({ kind: 'ballistic', hit: 10 }), from, at, { mine: true }).rings.find((r) => r.lat === at.lat && r.lng === at.lng)!
    const small = planFx(report({ kind: 'cruise', hit: 10 }), from, at, { mine: true }).rings.find((r) => r.lat === at.lat && r.lng === at.lng)!
    expect(big.maxRadius).toBeGreaterThan(small.maxRadius)
    expect(plan.shake).toBeGreaterThan(0)
    expect(planFx(report(), from, at, { mine: false }).shake).toBe(0)
    expect(planFx(report({ hit: 0 }), from, at, { mine: true }).shake).toBe(0)
  })

  it('air kills and shield kills look different, and counterforce adds its own ring', () => {
    const shield = planFx(report({ shield: 0.5, fighters: 0, patrol: 0, batteries: 0 }), from, at).rings.map((r) => r.color)
    const air = planFx(report({ shield: 0, fighters: 0.4, patrol: 0.1, batteries: 0 }), from, at).rings.map((r) => r.color)
    expect(shield).not.toEqual(air)
    const site = planFx(report({ site: true, aim: 'site' }), from, at).rings.map((r) => r.color)
    expect(site).toContain('#ff9f0a')
  })

  it('never draws more than the cap, however big the salvo, and reduced motion draws one ring, no shake and no delay', () => {
    const huge = planFx(report({ fired: 500, hit: 400, shield: 0.9, kind: 'ballistic', dead: 90 }), from, at, { mine: true })
    expect(huge.rings.length).toBeLessThanOrEqual(FX_CAPS.ringsPerReport)
    const still = planFx(report({ kind: 'ballistic', hit: 10 }), from, at, { mine: true, reduced: true })
    expect(still.rings).toHaveLength(1)
    expect(still.rings[0].delay).toBe(0)
    expect(still.shake).toBe(0)
    expect(still.sortie).toBe(false)
  })

  it('a raid sends aircraft and ends in a dogfight', () => {
    const raid = planFx(report({ weapon: 'raid', kind: undefined, fired: 2, hit: 1.5, aircraftLost: 0.4 }), from, at)
    expect(raid.sortie).toBe(true)
    expect(raid.rings.length).toBeGreaterThan(1)
  })

  it('is cheap: four hundred salvos plan in a blink', () => {
    const start = performance.now()
    for (let i = 0; i < 400; i++) planFx(report({ id: `v${i}`, fired: 3 + (i % 20), hit: 1 + (i % 10) }), from, at, { mine: true })
    expect(performance.now() - start).toBeLessThan(250)
  })
})

describe('craters and smoke', () => {
  const regions = { r1: at, r2: { lat: 1, lng: 1 } }
  it('fade with the days since the strike, smoke first, and go away', () => {
    const r = report({ turn: 3 })
    const day = (d: number) => decalsFrom([r], reportDay(r) + d, regions)
    const base = day(0)
    const scorch0 = base.find((d) => d.kind === 'scorch')!
    expect(base.some((d) => d.kind === 'smoke')).toBe(true)
    const mid = day(DECAL_LIFE.smoke + 1)
    expect(mid.some((d) => d.kind === 'smoke')).toBe(false)
    expect(mid.find((d) => d.kind === 'scorch')!.alpha).toBeLessThan(scorch0.alpha)
    expect(day(DECAL_LIFE.scorch + 1)).toEqual([])
  })

  it('only places that were hit, and never more than the cap', () => {
    expect(decalsFrom([report({ hit: 0 })], 0, regions)).toEqual([])
    const many = Array.from({ length: 80 }, (_, i) => report({ id: `v${i}`, region: i % 2 ? 'r1' : 'r2' }))
    expect(decalsFrom(many, 0, regions).length).toBeLessThanOrEqual(FX_CAPS.decals)
  })
})

describe('the radar sweep and the timeline', () => {
  it('a radar sweep only with radar, wider with each level', () => {
    expect(radarRing(0, at)).toBeNull()
    expect(radarRing(3, at)!.maxRadius).toBeGreaterThan(radarRing(1, at)!.maxRadius)
    expect(radarRing(1, undefined)).toBeNull()
  })

  it('a flight goes from launch through flight to impact, with the days left', () => {
    const f = { launched: 10, lands: 13 }
    expect(stageOf(f, 10)).toMatchObject({ stage: 'launch', progress: 0, left: 3 })
    expect(stageOf(f, 11.5)).toMatchObject({ stage: 'flight', left: 2 })
    expect(stageOf(f, 11.5).progress).toBeCloseTo(0.5, 9)
    expect(stageOf(f, 13)).toMatchObject({ stage: 'impact', progress: 1, left: 0 })
    expect(stageOf(f, 20).progress).toBe(1)
  })

  it('lists incoming and outgoing flights, soonest first', () => {
    const s = startLive(war())
    const mk = (id: string, nationId: string, target: string, lands: number): MissileFlight => ({ id, nationId, from: 'r0', target, count: 3, kind: 'cruise', launched: 1, lands })
    s.flights = [mk('a', 'r1', 'r0', 5), mk('b', 'r1', 'r0', 3), mk('c', 'r0', 'r1', 4)]
    expect(flightsFor(s, 'r0', 'incoming').map((f) => f.id)).toEqual(['b', 'a'])
    expect(flightsFor(s, 'r0', 'outgoing').map((f) => f.id)).toEqual(['c'])
  })
})

describe('the next steps replace invest-and-wait', () => {
  it('at war with nothing, the first step is to build; with missiles ready, to fire; each button is a legal order', () => {
    const s = war()
    s.nations.r0.arsenal = {}
    s.nations.r0.missileProgram = 0
    expect(nextSteps(s, map, s.nations.r0, false).map((x) => x.id)).toContain('program')
    const t = war()
    const steps = nextSteps(t, map, t.nations.r0, false)
    expect(steps.map((x) => x.id)).toContain('launch')
    expect(steps.find((x) => x.id === 'launch')!.target).toBeTruthy()
    // Firing is done in this tab's strike planner, never in the War Room.
    expect(steps.find((x) => x.id === 'launch')!.go).toBe('strike')
    expect(steps.every((x) => !/War Room/.test(x.text))).toBe(true)
    for (const step of steps) if (step.order) expect(validateOrder(t, map, step.order), step.id).toBeNull()
  })

  it('a salvo in the air puts "scramble" first, and restocking the rounds is offered', () => {
    const s = startLive(war())
    // r1 attacks r0, which has fighters and a shield.
    s.nations.r1.arsenal = { cruise: 20 }
    s.nations.r0.systems.shield = 2
    s.nations.r0.military.units.fighter = 2
    Object.assign(s.nations.r1.resources, { capital: 500 })
    applyOrderNow(s, map, { type: 'strike', nationId: 'r1', target: 'r0', weapon: 'missile', kind: 'cruise', count: 12 })
    s.nations.r0.missileWar = { interceptors: 2 }
    const steps = nextSteps(s, map, s.nations.r0, true)
    expect(steps[0].id).toBe('scramble')
    expect(steps[0].tone).toBe('urgent')
    expect(steps.map((x) => x.id)).toContain('rounds-now')
    for (const step of steps) if (step.order) expect(validateOrder(s, map, step.order), step.id).toBeNull()
    expect(nextSteps(s, map, s.nations.r0, true, 1)).toHaveLength(1)
  })

  it('at peace there is nothing to do', () => {
    const s = war()
    s.wars = []
    expect(nextSteps(s, map, s.nations.r0, false)).toEqual([])
  })

  it('the status counts what is in the air and the exchange', () => {
    const s = war()
    s.nations.r1.systems.shield = 1
    strikeHitsKind(s, map, 'r0', 'r1', 'ballistic', 6)
    const st = warStatus(s, s.nations.r0)
    expect(st.fired).toBe(6)
    expect(st.killed).toBeGreaterThan(0)
    expect(st.exchange).toBeNull()
    expect(warStatus(s, s.nations.r1).exchange).toBe(0)
    expect(st.rungName).toBe(MW.ladder[st.rung].name)
  })
})

describe('readable salvo lines', () => {
  it('say what left, what stopped it, what got through and what it did', () => {
    const line = salvoLine(report({ interceptorsUsed: 10, coverage: 0.5, scrambled: true, site: true, stock: 4.5 }), names)
    expect(line).toMatch(/^You: 10 cruise missiles at Region 1/)
    expect(line).toMatch(/Stopped by shield 25%, batteries 5%, fighters 10%/)
    expect(line).toMatch(/6 of 10 got through/)
    expect(line).toMatch(/1.2M dead/)
    expect(line).toMatch(/line -2.0/)
    expect(line).toMatch(/4.5 missiles destroyed in store/)
    expect(line).toMatch(/launch site shut/)
    expect(line).toMatch(/scrambled/)
    expect(line).toMatch(/ran short of rounds/)
  })

  it('a raid reads as a raid', () => {
    const line = salvoLine(report({ weapon: 'raid', kind: undefined, fired: 2, hit: 1.4, aircraftLost: 0.6, shield: 0, fighters: 0.2, batteries: 0.1, aim: 'site' }), names)
    expect(line).toMatch(/2.0 bomber divisions at Region 1 \(launch sites\)/)
    expect(line).toMatch(/0.60 aircraft lost/)
  })
})
