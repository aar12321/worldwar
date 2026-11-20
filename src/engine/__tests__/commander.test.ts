import { describe, expect, it } from 'vitest'
import { STANCES, type Stance } from '../../data/war'
import { advise, capabilities, compareStances, DEFAULT_AUTO, incomingThreats, planAttack, planMonth, planPreset, rankTargets, whatIf } from '../commander'
import { attackPool, cleanUnits, worthOf } from '../deploy'
import { forecastMemo, forecastPlan } from '../forecast'
import { choicePlan, choiceUnits } from '../../ui/attackChoices'
import { totalUnits } from '../helpers'
import { validateOrder } from '../orders'
import type { GameState, UnitCounts, WorldMap } from '../types'
import { lineMap, setMilitary, startState } from './fixtures'

/** A hub: r0 touches r1, r2 and r3, each held by a different enemy on different ground. */
function hub(): { s: GameState; map: WorldMap } {
  const map = lineMap(5, { 1: 'plains', 2: 'mountain', 3: 'urban' })
  map.regions.r0.neighbors = ['r1', 'r2', 'r3']
  for (const id of ['r1', 'r2', 'r3']) map.regions[id].neighbors = ['r0']
  const s = startState(map)
  s.wars.push('r0|r1', 'r0|r2', 'r0|r3')
  s.nations.r0.resources.capital = 5000
  setMilitary(s, 'r0', { infantry: 24, armor: 8, artillery: 5, fighter: 4, air: 4, missile: 6 })
  setMilitary(s, 'r1', { infantry: 18, armor: 4 })
  setMilitary(s, 'r2', { infantry: 16 })
  setMilitary(s, 'r3', { infantry: 14, artillery: 3 })
  return { s, map }
}

describe('AI Battle Command: the planner', () => {
  it('levels unlock what systems.ts promises', () => {
    expect(capabilities(0)).toMatchObject({ exact: false, stance: false, composition: false, auto: false })
    expect(capabilities(1)).toMatchObject({ exact: true, stance: false, composition: false, auto: false })
    expect(capabilities(2)).toMatchObject({ exact: true, stance: true, composition: false, auto: false })
    expect(capabilities(3)).toMatchObject({ exact: true, stance: true, composition: true, auto: true })
  })

  it('finds a force at least as good as any plan on a grid of compositions, deterministically', () => {
    const { s, map } = hub()
    const planned = planAttack(s, map, 'r0', 'r1', { objective: 'win', stance: 'assault' })!
    expect(planned).toBeTruthy()
    const again = planAttack(s, map, 'r0', 'r1', { objective: 'win', stance: 'assault' })!
    expect(JSON.stringify(again.plan)).toBe(JSON.stringify(planned.plan))
    // Exhaustive grid over infantry x armor x artillery x air in steps of 4, 2, 2, 2.
    let bestGrid = 0
    for (let i = 0; i <= 24; i += 4) for (let a = 0; a <= 8; a += 2) for (let g = 0; g <= 4; g += 2) for (let b = 0; b <= 4; b += 2) {
      const units: Partial<UnitCounts> = { infantry: i, armor: a, artillery: g, air: b }
      if (i + a + g + b < 1) continue
      const f = forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', units }, 256, false)
      if (f) bestGrid = Math.max(bestGrid, f.winChance)
    }
    expect(planned.forecast.winChance).toBeGreaterThanOrEqual(bestGrid - 0.04)
    // It never sends more than there is.
    const pool = attackPool(s, 'r0')
    for (const k of Object.keys(planned.plan.units) as (keyof UnitCounts)[]) expect(planned.plan.units[k]!).toBeLessThanOrEqual(pool[k] + 1e-9)
  })

  it('beats the three preset sizes when the mix matters', () => {
    const { s, map } = hub()
    const mine = planAttack(s, map, 'r0', 'r2', { objective: 'win', stance: 'assault' })!
    const preset = planPreset(s, map, 'r0', 'r2', { objective: 'win', stance: 'assault' })!
    expect(mine.forecast.winChance).toBeGreaterThanOrEqual(preset.forecast.winChance - 0.02)
  })

  it('each objective does what it says', () => {
    const { s, map } = hub()
    const win = planAttack(s, map, 'r0', 'r1', { objective: 'win', stance: 'assault' })!
    const cheap = planAttack(s, map, 'r0', 'r1', { objective: 'losses', stance: 'assault' })!
    expect(cheap.forecast.winChance).toBeGreaterThanOrEqual(0.55)
    // Losses weighed by what the units cost to raise: a lost tank counts as nearly three riflemen.
    expect(worthOf(cheap.forecast.yourLossByUnit)).toBeLessThanOrEqual(worthOf(win.forecast.yourLossByUnit) + 0.2)
    const safe = planAttack(s, map, 'r0', 'r1', { objective: 'defend', keepHome: 0.5, stance: 'assault' })!
    expect(totalUnits(cleanUnits(safe.plan.units))).toBeLessThanOrEqual(totalUnits(attackPool(s, 'r0')) * 0.5 + 0.1)
    const fast = planAttack(s, map, 'r0', 'r1', { objective: 'fast', stance: 'assault' })!
    expect(fast.forecast.captureChance).toBeGreaterThanOrEqual(win.forecast.captureChance - 0.05)
  })

  it('recommends the stance with the best score for the plan', () => {
    const { s, map } = hub()
    const plan = { target: 'r1', stance: 'assault' as Stance, units: { infantry: 14, armor: 6, artillery: 4, air: 3 } }
    const cmp = compareStances(s, map, 'r0', plan, 'fast')
    for (const st of Object.keys(STANCES) as Stance[]) expect(cmp.scores[cmp.best]).toBeGreaterThanOrEqual(cmp.scores[st] - 0.5)
    // Fast capture favours the stance that pushes the line furthest.
    expect(cmp.forecasts.blitz!.lineDamage).toBeGreaterThanOrEqual(cmp.forecasts.siege!.lineDamage)
  })

  it('ranks the targets, best first, with gains and risks', () => {
    const { s, map } = hub()
    const rows = rankTargets(s, map, 'r0', { objective: 'win' }, 3)
    expect(rows.map((r) => r.target).sort()).toEqual(['r1', 'r2', 'r3'])
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score)
    expect(rows.every((r) => r.gains.length > 0 && r.plan)).toBe(true)
    // The mountain defender is the harder one.
    expect(rows.find((r) => r.target === 'r2')!.risks.join(' ')).toMatch(/mountain/)
    // Without the third level the ranking still works, with presets.
    expect(rankTargets(s, map, 'r0', { objective: 'win' }, 1)).toHaveLength(3)
  })

  it("the ranking's odds are the War Room planner's odds for the chosen size and stance, at every level", () => {
    const { s, map } = hub()
    const pool = attackPool(s, 'r0')
    for (const level of [1, 2, 3]) {
      for (const objective of ['win', 'losses', 'defend'] as const) {
        const rows = rankTargets(s, map, 'r0', { objective }, level)
        expect(rows.length).toBe(3)
        for (const r of rows) {
          expect(['probe', 'main', 'allin']).toContain(r.choice)
          if (level < 2) expect(r.stance).toBe('assault')
          const coastal = !!map.regions[r.target].coastal
          // Exactly what the War Room computes for its big number: choicePlan(target, stance, choiceUnits(pool, choice, coastal)) through forecastMemo.
          const units = choiceUnits(pool, r.choice, coastal)
          const f = forecastMemo(s, map, 'r0', choicePlan(r.target, r.stance, units))!
          expect(r.win).toBe(f.winChance)
          expect(r.plan!.units).toEqual(choicePlan(r.target, r.stance, units).units)
          // And the size is the planner's pick of the three for the goal.
          const p = planPreset(s, map, 'r0', r.target, { objective, stance: level >= 2 ? undefined : 'assault' }, (c) => choiceUnits(pool, c, coastal))!
          expect(r.choice).toBe(p.commit)
        }
      }
    }
  })

  it('writes specific advice: waits when it cannot win, and warns of supply and home threats', () => {
    const { s, map } = hub()
    s.nations.r0.oilShortage = true
    s.nations.r0.warWeariness = 40
    setMilitary(s, 'r3', { infantry: 60, armor: 10 })
    const plan = { target: 'r3', stance: 'assault' as Stance, units: { infantry: 6 } }
    const rec = planAttack(s, map, 'r0', 'r3', { objective: 'win' })
    const lines = advise(s, map, 'r0', plan, 3, rec)
    const text = lines.map((l) => l.text).join('\n')
    expect(text).toMatch(/out of oil/)
    expect(text).toMatch(/war-weary/)
    expect(text).toMatch(/Wait\./)
    expect(lines[0].tone).toBe('bad')
  })

  it('home defence: an army that is out leaves the homeland easier to take', () => {
    const { s, map } = hub()
    // r1 is strong enough to threaten r0 when r0's army is away.
    setMilitary(s, 'r1', { infantry: 26, armor: 6 })
    setMilitary(s, 'r0', { infantry: 18, armor: 4 })
    s.regions.r0.buildings.barracks = 0
    const away = { ...attackPool(s, 'r0'), infantry: 14 }
    const threats = incomingThreats(s, map, 'r0', away)
    const t = threats.find((x) => x.enemy === 'r1')
    if (t) expect(t.chanceAfter!).toBeGreaterThanOrEqual(t.chance - 1e-9)
  })

  it('what-if rows say which side of each line is better', () => {
    const { s, map } = hub()
    const small = forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', units: { infantry: 6 } })!
    const rec = planAttack(s, map, 'r0', 'r1', { objective: 'win', stance: 'assault' })!
    const rows = whatIf(small, rec.forecast)
    expect(rows.find((r) => r.label === 'Chance to win')!.better).toBe(true)
  })
})

describe('auto-command', () => {
  it('plans within the limits: attacks allowed, reserve kept, least chance to win; every order valid', () => {
    const { s, map } = hub()
    const auto = { ...DEFAULT_AUTO, on: true, maxAttacks: 2, reserve: 0.3, minWin: 0.5 }
    const month = planMonth(s, map, 'r0', auto)
    expect(month.length).toBeGreaterThan(0)
    expect(month.length).toBeLessThanOrEqual(2)
    const pool = totalUnits(attackPool(s, 'r0'))
    let used = 0
    const queue: ReturnType<typeof planMonth>[number]['order'][] = []
    for (const m of month) {
      expect(validateOrder(s, map, m.order, queue)).toBeNull()
      expect(m.planned.forecast.winChance).toBeGreaterThanOrEqual(0.5)
      used += totalUnits(cleanUnits(m.order.units))
      queue.push(m.order)
    }
    expect(used).toBeLessThanOrEqual(pool * 0.7 + 0.5)
    expect(new Set(month.map((m) => m.target)).size).toBe(month.length)
    // The nation holds missiles, but an attack the player's AI plans never carries one: they are fired from Missile War.
    for (const m of month) expect('missiles' in m.order).toBe(false)
  })

  it('the planner fires missiles with an attack only when asked to (an option off for the player), and never advises it', () => {
    const { s, map } = hub()
    for (const o of ['win', 'fast', 'defend'] as const) {
      const p = planAttack(s, map, 'r0', 'r1', { objective: o, stance: 'assault' })!
      expect(p.plan.missiles ?? 0).toBe(0)
    }
    // The option still works, so the search is unchanged behind it.
    s.regions.r1.line = 9
    const armed = planAttack(s, map, 'r0', 'r1', { objective: 'fast', stance: 'assault', missiles: true })!
    expect(armed.plan.missiles ?? 0).toBeGreaterThan(0)
    const words = advise(s, map, 'r0', { target: 'r1', stance: 'assault', commit: 'main' }, 3, null).map((a) => a.text).join(' ')
    expect(words).not.toMatch(/missile/i)
  })

  it('never plans more than the nation may attack, counting what is queued', () => {
    const { s, map } = hub()
    s.nations.r0.military.lastAttackTurn = s.turn
    s.nations.r0.military.attacksThisTurn = 2
    // maxAttacks is 3 for a one-country nation: only one more.
    const month = planMonth(s, map, 'r0', { ...DEFAULT_AUTO, on: true, maxAttacks: 5, reserve: 0, minWin: 0.3 })
    expect(month.length).toBeLessThanOrEqual(1)
  })

  it('plans nothing when no attack clears the bar', () => {
    const { s, map } = hub()
    setMilitary(s, 'r1', { infantry: 90 })
    setMilitary(s, 'r2', { infantry: 90 })
    setMilitary(s, 'r3', { infantry: 90 })
    expect(planMonth(s, map, 'r0', { ...DEFAULT_AUTO, on: true, minWin: 0.6 })).toHaveLength(0)
  })
})
