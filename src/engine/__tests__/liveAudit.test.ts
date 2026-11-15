import { describe, expect, it } from 'vitest'
import { LIVE } from '../../data/live'
import { advise } from '../advisor'
import { annexPuppet } from '../diplomacy'
import { forceUnits, totalUnits } from '../helpers'
import { advanceDay, startLive, type LiveEvent } from '../live'
import { normalizeGame } from '../migrate'
import { markMonth } from '../monthMark'
import { applyOrderNow } from '../resolveTurn'
import type { GameState, Order } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(8)
const none = () => []

/** r0 (the player) is at war with its neighbor r1. */
function war(live = true) {
  const s = live ? startLive(startState(map)) : startState(map)
  s.wars.push('r0|r1')
  s.nations.r0.resources.capital = 3000
  setMilitary(s, 'r0', { infantry: 30, armor: 6, artillery: 4 })
  setMilitary(s, 'r1', { infantry: 1 })
  s.regions.r1.line = 3
  return s
}
const attack = (extra: Partial<Extract<Order, { type: 'attack' }>> = {}): Order => ({ type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault', ...extra })

function run(s: GameState, days: number) {
  const events: LiveEvent[] = []
  for (let i = 0; i < days; i++) {
    const step = advanceDay(s, map, { planner: none })
    s = step.state
    events.push(...step.events)
  }
  return { s, events }
}

describe('annexing a puppet in a live game', () => {
  it('hands its armies, salvos and planned attacks to the master instead of destroying them', () => {
    const s = war()
    s.nations.r2.overlord = 'r0'
    s.wars.push('r1|r2')
    setMilitary(s, 'r2', { infantry: 10 })
    const sent = applyOrderNow(s, map, { type: 'attack', nationId: 'r2', target: 'r1', commit: 'main', stance: 'assault' })
    expect(sent.army).toBeTruthy()
    s.flights = [{ id: 'f1', nationId: 'r2', from: 'r2', target: 'r1', count: 2, launched: 0, lands: 1 }]
    s.launches = [{ id: 'l1', at: 5, order: { type: 'attack', nationId: 'r2', target: 'r1', commit: 'probe', stance: 'assault' } }]
    const masterBefore = totalUnits(forceUnits(s, 'r0'))
    const puppetArmy = totalUnits(sent.army!.units)
    annexPuppet(s, map, 'r0', 'r2')
    expect(s.nations.r2.alive).toBe(false)
    expect(s.armies).toHaveLength(1)
    expect(s.armies![0].nationId).toBe('r0')
    expect(s.flights![0].nationId).toBe('r0')
    expect(s.launches![0].order.nationId).toBe('r0')
    // Everything the puppet had, at home and in the field, is the master's.
    expect(totalUnits(forceUnits(s, 'r0'))).toBeCloseTo(masterBefore + 10)
    expect(puppetArmy).toBeGreaterThan(0)
  })

  it('the army marches on, fights for the master, and comes home to the master', () => {
    const s = war()
    s.nations.r2.overlord = 'r0'
    s.wars.push('r1|r2')
    setMilitary(s, 'r2', { infantry: 10 })
    applyOrderNow(s, map, { type: 'attack', nationId: 'r2', target: 'r1', commit: 'main', stance: 'assault' })
    annexPuppet(s, map, 'r0', 'r2')
    const homeBefore = totalUnits(s.nations.r0.military.units)
    const { s: after, events } = run(s, 25)
    expect(events.some((e) => e.kind === 'battle' && e.report.attacker.nationId === 'r0')).toBe(true)
    expect(after.armies).toEqual([])
    // The survivors rejoin the master's military.
    expect(totalUnits(after.nations.r0.military.units)).toBeGreaterThan(homeBefore)
  })
})

describe('an army whose launch country was lost', () => {
  it('goes home with the outcome "cut", to a country its nation still holds', () => {
    const s = war()
    s.regions.r2.owner = 'r0'
    applyOrderNow(s, map, attack())
    const a = s.armies![0]
    const lost = a.home
    // The country it set out from falls to the enemy while it marches.
    s.regions[lost].owner = 'r1'
    const before = totalUnits(forceUnits(s, 'r0'))
    const { s: after, events } = run(s, 12)
    expect(events.some((e) => e.kind === 'battle')).toBe(false)
    const back = events.find((e) => e.kind === 'turnedBack')
    expect(back && back.kind === 'turnedBack' && back.why).toBe('cut')
    // It marched home to a country its nation still holds, and its units are back in the military.
    expect(after.armies).toEqual([])
    expect(events.some((e) => e.kind === 'home')).toBe(true)
    expect(totalUnits(after.nations.r0.military.units)).toBeCloseTo(before)
  })
})

describe('what a battle report says about the share of the military', () => {
  const says = (s: GameState) => s.battles[s.battles.length - 1].modifiers.join(' | ')
  const fight = (live: boolean, order: Order) => {
    const s = war(live)
    if (!live) return { s, text: (applyOrderNow(s, map, order), says(s)), report: s.battles[s.battles.length - 1] }
    applyOrderNow(s, map, order)
    const out = run(s, 12)
    const report = out.events.flatMap((e) => (e.kind === 'battle' ? [e.report] : []))[0]
    return { s: out.s, text: report.modifiers.join(' | '), report }
  }

  it('turn game: the preset and the share it really sent', () => {
    expect(fight(false, attack()).text).toMatch(/main force \(66% of the military\)/)
    expect(fight(false, attack({ commit: 'probe' })).text).toMatch(/probe \(33% of the military\)/)
  })

  it('turn game: a chosen share is called a chosen force', () => {
    const r = fight(false, attack({ share: 0.25 }))
    expect(r.text).toMatch(/a chosen force \(25% of the military\)/)
    expect(r.report.chosen).toBe(true)
  })

  it('turn game: an all-in attack after another only sends what is left at home', () => {
    const s = war(false)
    // A country that holds, so the war goes on after the first attack.
    setMilitary(s, 'r1', { infantry: 120, armor: 30 })
    applyOrderNow(s, map, attack())
    expect(s.regions.r1.owner).toBe('r1')
    const out = applyOrderNow(s, map, attack({ commit: 'allin' }))
    expect(out.error).toBeNull()
    expect(out.battle?.modifiers.join(' ')).toMatch(/all in \(34% of the military\)/)
  })

  it('live game: the preset is named with the share the army left with, a guard staying home', () => {
    expect(fight(true, attack()).text).toMatch(/main force \(66% of the military\)/)
    expect(fight(true, attack({ commit: 'allin' })).text).toMatch(new RegExp(`all in \\(${Math.round((1 - LIVE.homeGuard) * 100)}% of the military\\)`))
    expect(fight(true, attack()).report.chosen).toBeUndefined()
  })

  it('live game: a chosen share is a chosen force, not the preset beside it', () => {
    const r = fight(true, attack({ share: 0.25 }))
    expect(r.text).toMatch(/a chosen force \(25% of the military\)/)
    expect(r.text).not.toMatch(/main force/)
    expect(r.report.chosen).toBe(true)
  })
})

describe('loading a damaged live save', () => {
  function saved() {
    const s = war()
    s.nations.r0.resources.capital = 3000
    applyOrderNow(s, map, attack())
    return JSON.parse(JSON.stringify(s)) as GameState
  }

  it('drops an army with a route, phase or share that makes no sense, and keeps the good one', () => {
    const bad = saved()
    const good = bad.armies![0]
    const broken = (id: string, over: Record<string, unknown>) => bad.armies!.push({ ...structuredClone(good), id, ...over } as never)
    broken('via', { via: 'teleport' })
    broken('phase', { phase: 'sleeping' })
    broken('share-high', { share: 4 })
    broken('share-low', { share: -0.2 })
    broken('share-nan', { share: null })
    broken('home', { home: 'atlantis' })
    broken('from', { from: { lat: 'x', lng: 3 } })
    broken('start', { start: null })
    const loaded = normalizeGame(bad, map)
    expect(loaded.armies!.map((a) => a.id)).toEqual([good.id])
  })

  it('repairs a commit or stance it does not know, and forgets a "chosen" that is not true', () => {
    const bad = saved()
    const a = bad.armies![0] as unknown as Record<string, unknown>
    a.commit = 'everything'
    a.stance = 'sneak'
    a.chosen = 'yes'
    const loaded = normalizeGame(bad, map)
    expect(loaded.armies![0].commit).toBe('main')
    expect(loaded.armies![0].stance).toBe('assault')
    expect('chosen' in loaded.armies![0]).toBe(false)
  })
})

describe('the month the report starts from, saved with the game', () => {
  function liveWithMark() {
    const s = war()
    s.monthStart = markMonth(s, 'r0', [{ text: 'You captured Elsewhere.', good: true }])
    s.monthStart.stats.money = 1234
    return s
  }

  it('survives a save and a load exactly', () => {
    const s = liveWithMark()
    const loaded = normalizeGame(JSON.parse(JSON.stringify(s)), map)
    expect(JSON.stringify(loaded.monthStart)).toBe(JSON.stringify(s.monthStart))
    expect(loaded.monthStart!.stats.money).toBe(1234)
  })

  it('is carried by the clock through quiet days, battles and the days of a month', () => {
    let s = liveWithMark()
    applyOrderNow(s, map, attack())
    s = run(s, 20).s
    expect(s.turn).toBe(1)
    expect(s.monthStart?.stats.money).toBe(1234)
  })

  it('is dropped when damaged or from another month, and a turn game never has one', () => {
    const wrongMonth = liveWithMark()
    wrongMonth.monthStart!.turn = 7
    expect(normalizeGame(JSON.parse(JSON.stringify(wrongMonth)), map).monthStart).toBeUndefined()
    const nan = JSON.parse(JSON.stringify(liveWithMark())) as GameState
    ;(nan.monthStart!.stats as unknown as Record<string, unknown>).food = 'lots'
    expect(normalizeGame(nan, map).monthStart).toBeUndefined()
    const junk = JSON.parse(JSON.stringify(liveWithMark())) as GameState
    junk.monthStart!.battles = [{ text: 5, good: true }, { text: 'ok', good: false }, null] as never
    expect(normalizeGame(junk, map).monthStart!.battles).toEqual([{ text: 'ok', good: false }])
    const turnGame = startState(map) as GameState
    turnGame.monthStart = markMonth(turnGame, 'r0')
    expect('monthStart' in normalizeGame(JSON.parse(JSON.stringify(turnGame)), map)).toBe(false)
  })
})

describe('the advisor and an army that is on its way', () => {
  it('names the day it arrives, not a count of days that would freeze on a quiet day', () => {
    const s = war()
    const units = { infantry: 9, armor: 2, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }
    s.armies!.push({ id: 'in1', nationId: 'r1', units, commit: 'main', stance: 'assault', share: 0.66, via: 'land', bySea: false, home: 'r1', target: 'r0', phase: 'outbound', from: { lat: 0, lng: 5 }, to: { lat: 0, lng: 0 }, start: 0, end: 6, launched: 0 })
    const text = (st: GameState) => advise(st, map, 'r0', [], 20).find((a) => a.id === 'incoming-in1')!.detail
    const first = text(s)
    expect(first).toMatch(/arrive on \d+ \w+ \d{4}/)
    expect(first).not.toMatch(/\bin \d+ days?\b/)
    // Two days on, the same words are still true.
    s.day = 2
    expect(text(s)).toBe(first)
  })
})
