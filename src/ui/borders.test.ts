import { describe, expect, it } from 'vitest'
import { deploymentOrder } from '../ai/deployment'
import { createInitialState } from '../data/startingNations'
import { applyOrderNow } from '../engine/resolveTurn'
import type { GameState, Order } from '../engine/types'
import { borderLines, chokepoints, getWorld } from '../map/world'
import { borderPaths, borderSignature, stationBadges } from './globe/borderLayer'
import { paintSignature } from './globe/paint'
import { tensionColor } from './colors'
import { MAP_MODE_KEYS } from './shortcuts'

const { map } = getWorld()
const game = (): GameState => createInitialState(map, { playerRegionId: 'france', seed: 5, difficulty: 'normal', goal: 'world', victoryShare: 1 })
const post = (s: GameState, id: string, border: Record<string, number>, extra: Partial<Extract<Order, { type: 'setDeployment' }>> = {}) =>
  expect(applyOrderNow(s, map, { type: 'setDeployment', nationId: id, coastal: 0, subs: 0, air: 0, border, ...extra }).error).toBeNull()

describe('the border lines come from the same map as the countries', () => {
  it('every land border the map knows has a line, between two countries that are neighbors', () => {
    const lines = borderLines()
    expect(lines.length).toBeGreaterThan(300)
    for (const l of lines.slice(0, 200)) {
      expect(map.regions[l.a].neighbors).toContain(l.b)
      expect(l.points.length).toBeGreaterThanOrEqual(2)
    }
    expect(lines.some((l) => [l.a, l.b].sort().join() === 'france,germany')).toBe(true)
  })

  it('the chokepoints are real sea lanes between countries in the game', () => {
    const list = chokepoints()
    expect(list.length).toBeGreaterThan(10)
    for (const [a, b] of list) expect(map.regions[a].seaLanes).toContain(b)
  })
})

describe('forces on station on the globe', () => {
  it('shows your own, exact, as badges: a garrison on the border, patrols at your port, an air patrol over your capital', () => {
    const s = game()
    s.nations.france.military.units.naval = 10
    s.nations.france.military.units.fighter = 6
    post(s, 'france', { germany: 0.3, spain: 0.1 }, { coastal: 0.3, subs: 0.2, air: 0.3 })
    const badges = stationBadges(s, map, 'france', false)
    const kinds = badges.map((b) => b.glyph).sort()
    expect(kinds).toEqual(['air', 'guard', 'guard', 'ship', 'sub'])
    for (const b of badges) {
      expect(b.mine).toBe(true)
      expect(b.guess).toBe(false)
      expect(b.text).not.toMatch(/~/)
      expect(Number.isFinite(b.lat) && Number.isFinite(b.lng)).toBe(true)
    }
    // A garrison badge sits on the border, not in the middle of either country.
    const guard = badges.find((b) => b.key === 'france:guard:germany')!
    expect(guard.lat).toBeGreaterThan(46)
    expect(guard.lat).toBeLessThan(52)
    expect(guard.lng).toBeGreaterThan(2)
    expect(guard.lng).toBeLessThan(10)
  })

  it('shows a neighbor you have intelligence on, exactly, and a stranger only as a guess on the Borders map', () => {
    const s = game()
    post(s, 'germany', { france: 0.4, poland: 0.2 }, { air: 0.5 })
    // A stranger: nothing on a normal map, a faded guess facing you on the Borders map.
    expect(stationBadges(s, map, 'france', false).filter((b) => b.key.startsWith('germany'))).toHaveLength(0)
    const guess = stationBadges(s, map, 'france', true).filter((b) => b.key.startsWith('germany'))
    expect(guess.map((b) => b.key)).toEqual(['germany:guard:france'])
    expect(guess[0].guess).toBe(true)
    expect(guess[0].text).toMatch(/^~/)
    // Their garrison facing Poland is none of your business.
    expect(guess.some((b) => b.key.includes('poland'))).toBe(false)
    // With intelligence it is exact, and the whole posture shows.
    s.intel['france|germany'] = s.turn + 1
    const exact = stationBadges(s, map, 'france', false).filter((b) => b.key.startsWith('germany'))
    expect(exact.some((b) => b.glyph === 'air')).toBe(true)
    expect(exact.every((b) => !b.guess && !b.text.startsWith('~'))).toBe(true)
  })

  it('shows nothing for a nation that has never been told to post forces', () => {
    expect(stationBadges(game(), map, 'france', true)).toEqual([])
  })

  it('the AI posts a posture its neighbors can see on the map', () => {
    const s = game()
    const o = deploymentOrder(s, map, 'germany', 2)
    expect(o).not.toBeNull()
    expect(applyOrderNow(s, map, o!).error).toBeNull()
    s.intel['france|germany'] = s.turn + 1
    expect(stationBadges(s, map, 'france', false).some((b) => b.key.startsWith('germany'))).toBe(true)
  })
})

describe('the Borders map', () => {
  it('has its own key and its own paint: it repaints when a posture, a closure or a war changes', () => {
    expect(MAP_MODE_KEYS.borders).toBe('7')
    const s = game()
    const before = paintSignature(s, 'borders')
    expect(paintSignature(s, 'borders')).toBe(before)
    post(s, 'france', { germany: 0.3 })
    const posted = paintSignature(s, 'borders')
    expect(posted).not.toBe(before)
    s.wars.push('france|germany')
    expect(paintSignature(s, 'borders')).not.toBe(posted)
    // The other map modes do not care about postures.
    const t = game()
    const p = paintSignature(t, 'political')
    post(t, 'france', { germany: 0.3 })
    expect(paintSignature(t, 'political')).toBe(p)
    expect(borderSignature(t)).toContain('france:')
  })

  it('draws a line for each stretch of border in the color of its tension, thicker where guarded, dashed where closed, plus the sea', () => {
    const s = game()
    const calm = borderPaths(s, map, 'france')
    const ffg = (list: typeof calm) => list.filter((p) => p.id.startsWith('border:'))
    expect(ffg(calm).length).toBeGreaterThan(300)
    expect(calm.some((p) => p.id.startsWith('choke:'))).toBe(true)
    // Peace: nothing red.
    expect(ffg(calm).every((p) => p.color !== tensionColor(70))).toBe(true)
    // War on Germany turns the French-German lines red; a posted garrison thickens them; a closed border dashes the Spanish one.
    s.wars.push('france|germany')
    post(s, 'france', { germany: 0.5 })
    expect(applyOrderNow(s, map, { type: 'setBorder', nationId: 'france', neighbor: 'spain', closed: true }).error).toBeNull()
    const hot = borderPaths(s, map, 'france')
    const isPair = (p: (typeof hot)[number], a: string, b: string) => {
      const line = borderLines()[Number(p.id.split(':')[1])]
      return [line.a, line.b].sort().join() === [a, b].sort().join()
    }
    // The ids index the line list, so a pair can be looked up from the picture.
    const german = ffg(hot).filter((p) => isPair(p, 'france', 'germany'))
    expect(german.length).toBeGreaterThan(0)
    expect(german.every((p) => p.color === tensionColor(70))).toBe(true)
    const calmGerman = ffg(calm).filter((p) => isPair(p, 'france', 'germany'))
    expect(german[0].stroke!).toBeGreaterThan(calmGerman[0].stroke!)
    const spanish = ffg(hot).filter((p) => isPair(p, 'france', 'spain'))
    expect(spanish.every((p) => p.gap > 0 && p.dash > 0 && p.dash < 0.1)).toBe(true)
    expect(ffg(hot).filter((p) => isPair(p, 'france', 'belgium')).every((p) => p.gap === 0)).toBe(true)
  })
})
