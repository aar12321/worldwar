import { describe, expect, it } from 'vitest'
import { COMMITS } from '../data/war'
import { launchArmy } from '../engine/armies'
import { planPreset } from '../engine/commander'
import { attackPool, SENDABLE } from '../engine/deploy'
import { forecastMemo, forecastPlan } from '../engine/forecast'
import { totalUnits } from '../engine/helpers'
import { startLive } from '../engine/live'
import { validateOrder } from '../engine/orders'
import { applyOrderNow, resolveTurn } from '../engine/resolveTurn'
import type { GameState } from '../engine/types'
import { lineMap, setMilitary, startState } from '../engine/__tests__/fixtures'
import { simulate } from '../engine/__tests__/forecastScenarios'
import { CHOICES, choiceForecast, choiceOf, choiceOrder, choicePlan, choiceUnits, suggestedChoice, unitsLine } from './attackChoices'

const map = lineMap(6)

/** r0 at war with r1, with a mixed army, warships, and a store of missiles that must never leave with an attack. */
function war(live = false, enemy = 9): GameState {
  const s = startState(map)
  s.wars.push('r0|r1')
  s.nations.r0.resources.capital = 3000
  setMilitary(s, 'r0', { infantry: 18, armor: 6, artillery: 4, fighter: 3, air: 2, naval: 3, missile: 12 })
  setMilitary(s, 'r1', { infantry: enemy, artillery: 2 })
  return live ? startLive(s) : s
}

const SENT = ['probe', 'main', 'allin'] as const

describe('the attack planner offers four choices, from COMMITS', () => {
  it('None, Probe, Main force, All in: each is its share of every free kind, never a missile, no warships inland', () => {
    const s = war()
    const pool = attackPool(s, 'r0')
    expect(CHOICES).toEqual(['none', 'probe', 'main', 'allin'])
    expect(totalUnits(choiceUnits(pool, 'none', false))).toBe(0)
    let last = 0
    for (const c of SENT) {
      const u = choiceUnits(pool, c, false)
      expect(u.missile).toBe(0)
      expect(u.naval).toBe(0)
      // A share of what is free (rounded to whole divisions), growing with the choice.
      expect(totalUnits(u)).toBeGreaterThan(last)
      expect(totalUnits(u)).toBeLessThanOrEqual(totalUnits(pool) * COMMITS[c].share + 1e-9)
      last = totalUnits(u)
      expect(choiceOf(pool, u, false)).toBe(c)
    }
    // On a coast the warships go too.
    expect(choiceUnits(pool, 'allin', true).naval).toBe(3)
    expect(unitsLine(choiceUnits(pool, 'allin', false))).toBe('18 infantry · 6 tanks · 4 artillery · 3 fighters · 2 strike aircraft')
    expect(unitsLine(choiceUnits(pool, 'none', false))).toBe('nothing')
  })

  it('the order it sends has no missiles field, is valid, and names exactly the planned units', () => {
    const s = war()
    const pool = attackPool(s, 'r0')
    for (const c of SENT) {
      const units = choiceUnits(pool, c, false)
      const order = choiceOrder('r0', 'r1', 'assault', units)
      expect('missiles' in order).toBe(false)
      expect(order.units && 'missile' in order.units).toBe(false)
      expect(validateOrder(s, map, order)).toBeNull()
      expect(order.units).toEqual(choicePlan('r1', 'assault', units).units)
    }
  })
})

describe('the odds shown for each choice are what the engine resolves', () => {
  it('a row, the headline and the forecast of the sent order are one number; the battle uses exactly that force and fires no missile', () => {
    for (const stance of ['assault', 'blitz', 'siege'] as const) {
      const s = war()
      const pool = attackPool(s, 'r0')
      for (const c of SENT) {
        const units = choiceUnits(pool, c, false)
        const row = choiceForecast(s, map, 'r0', 'r1', stance, pool, c, false)!
        const headline = forecastMemo(s, map, 'r0', choicePlan('r1', stance, units))!
        const order = choiceOrder('r0', 'r1', stance, units)
        const ofOrder = forecastPlan(s, map, 'r0', { target: 'r1', stance, units: order.units, missiles: order.missiles })!
        expect(row.winChance).toBe(headline.winChance)
        expect(ofOrder.winChance).toBeCloseTo(row.winChance, 10)
        expect(ofOrder.yourLosses).toBeCloseTo(row.yourLosses, 10)
        const t = structuredClone(s)
        const out = applyOrderNow(t, map, order)
        expect(out.error).toBeNull()
        for (const k of SENDABLE) expect(out.battle!.attacker.units[k]).toBeCloseTo(row.sent[k], 6)
        expect(out.battle!.attacker.units.missile).toBe(0)
        expect(t.nations.r0.military.units.missile).toBe(12)
      }
    }
  })

  it('the forecast of each choice matches long simulations of the real battle', () => {
    for (const enemy of [6, 14, 24]) {
      const s = war(false, enemy)
      const pool = attackPool(s, 'r0')
      for (const c of SENT) {
        const plan = choicePlan('r1', 'assault', choiceUnits(pool, c, false))
        const f = forecastPlan(s, map, 'r0', plan)!
        const sim = simulate({ s, map, plan, name: c }, 400)
        expect(Math.abs(f.winChance - sim), `${c} against ${enemy}: forecast ${f.winChance}, simulated ${sim}`).toBeLessThan(0.08)
      }
    }
  }, 120_000)

  it('a turn-game order queued for the month end resolves with the named force and no missiles', () => {
    const s = war()
    const pool = attackPool(s, 'r0')
    const order = choiceOrder('r0', 'r1', 'assault', choiceUnits(pool, 'main', false))
    const next = resolveTurn(s, map, [order])
    expect(next.nations.r0.military.units.missile).toBe(12)
    const battle = next.log.find((e) => e.kind === 'battle')
    expect(battle).toBeTruthy()
  })

  it('a live army carries exactly the chosen units, keeps the home guard, and no missiles', () => {
    const s = war(true)
    const pool = attackPool(s, 'r0', [], true)
    for (const c of SENT) {
      const units = choiceUnits(pool, c, false)
      const army = launchArmy(structuredClone(s), map, choiceOrder('r0', 'r1', 'assault', units), 0)!
      expect(army.units.missile).toBe(0)
      for (const k of SENDABLE) expect(army.units[k]).toBeCloseTo(units[k], 6)
      const f = choiceForecast(s, map, 'r0', 'r1', 'assault', pool, c, false)!
      const named = forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', units: army.units })!
      expect(named.winChance).toBeCloseTo(f.winChance, 6)
    }
  })

  it('an old order that names missiles still fires exactly those (saves, bots and online peers)', () => {
    const s = war()
    const out = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault', missiles: 3 })
    expect(out.error).toBeNull()
    expect(out.battle!.attacker.units.missile).toBe(3)
    expect(s.nations.r0.military.units.missile).toBe(9)
  })
})

describe('the planner recommends one of the four', () => {
  it('opens on the smallest size that is likely to win', () => {
    const weak = war(false, 2)
    expect(suggestedChoice(weak, map, 'r0', 'r1', attackPool(weak, 'r0'), false)).toBe('probe')
    const strong = war(false, 60)
    expect(suggestedChoice(strong, map, 'r0', 'r1', attackPool(strong, 'r0'), false)).toBe('main')
  })

  it('AI Battle Command picks a choice judged on the units that would go, and a share kept home rules out the bigger ones', () => {
    const s = war(false, 14)
    const pool = attackPool(s, 'r0')
    const p = planPreset(s, map, 'r0', 'r1', { objective: 'win' }, (c) => choiceUnits(pool, c, false))!
    expect(SENT).toContain(p.commit)
    const plan = choicePlan('r1', p.stance, choiceUnits(pool, p.commit, false))
    expect(p.forecast.winChance).toBeCloseTo(forecastPlan(s, map, 'r0', plan, 128, false)!.winChance, 10)
    const safe = planPreset(s, map, 'r0', 'r1', { objective: 'defend' }, (c) => choiceUnits(pool, c, false))!
    expect(safe.commit).toBe('probe')
  })
})
