import { describe, expect, it } from 'vitest'
import { INVEST } from '../../data/business'
import { DIPLOMACY } from '../../data/unitTypes'
import { coalitionActive } from '../../ai/opinion'
import { cleanInvestments } from '../business'
import { hasCombinedArms, resolveBattle, type Combatant } from '../combat'
import { annexPuppet, breakPact, cancelDeal, declareWar } from '../diplomacy'
import { emptyUnits, totalUnits } from '../helpers'
import { createRng } from '../rng'
import { runDomestic } from '../agencies'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { marketPrices, pushMarket } from '../trade'
import type { GameState, UnitCounts } from '../types'
import { forecastAttack } from '../warfare'
import { lineMap, setMilitary, startState } from './fixtures'

const map = lineMap(6)
const units = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u })
const side = (u: Partial<UnitCounts>): Combatant => ({ units: units(u), mods: null, penalty: 1, penaltyNotes: [] })

describe('combat', () => {
  it('drones take more than their share of losses, but not all of them', () => {
    const out = resolveBattle({ attacker: side({ infantry: 30 }), defender: side({ infantry: 10, drone: 10 }), terrain: 'plains', coastal: false }, createRng(1, 1))
    expect(out.defenderLosses.drone).toBeGreaterThan(0)
    expect(out.defenderLosses.infantry).toBeGreaterThan(0)
  })

  it('a token tank and plane do not make an army combined', () => {
    expect(hasCombinedArms(units({ infantry: 40, armor: 0.6, fighter: 0.6 }))).toBe(false)
    expect(hasCombinedArms(units({ infantry: 20, armor: 5, fighter: 5 }))).toBe(true)
  })

  it('the forecast counts artillery, as the real fight does', () => {
    const s = startState(map)
    s.wars.push('r0|r1')
    setMilitary(s, 'r0', { infantry: 20 })
    setMilitary(s, 'r1', { infantry: 2 })
    s.regions.r1.line = 30
    const plain = forecastAttack(s, map, 'r0', 'r1', 'main', 'siege')!
    setMilitary(s, 'r0', { infantry: 14, artillery: 6 })
    const guns = forecastAttack(s, map, 'r0', 'r1', 'main', 'siege')!
    expect(guns.lineDamage).toBeGreaterThan(plain.lineDamage)
  })

  it('a military attacked on two fronts in a month stands with less of itself in the second fight', () => {
    const fight = (twoFronts: boolean) => {
      const s = startState(map)
      s.wars.push('r0|r1')
      setMilitary(s, 'r0', { infantry: 10 })
      setMilitary(s, 'r1', { infantry: 10 })
      s.regions.r2.owner = 'r1'
      if (twoFronts) s.regions.r2.attackedTurn = s.turn
      return applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault' }).battle!
    }
    const one = fight(false)
    const two = fight(true)
    expect(two.defender.units.infantry).toBeLessThan(one.defender.units.infantry)
    expect(two.modifiers.some((m) => /2 fronts/.test(m))).toBe(true)
  })

  it('losing drones and robots tires nobody', () => {
    const s = startState(map)
    s.wars.push('r0|r1')
    setMilitary(s, 'r0', { robot: 20, drone: 10 })
    setMilitary(s, 'r1', { infantry: 6 })
    s.nations.r0.techs.push('frontier_drones', 'frontier_robotics')
    applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'assault' })
    expect(s.nations.r0.warWeariness).toBe(0)
  })
})

describe('diplomacy', () => {
  it('annexing a puppet brings its army and treasury', () => {
    const s = startState(map)
    s.nations.r1.overlord = 'r0'
    setMilitary(s, 'r1', { infantry: 7 })
    s.nations.r1.resources.capital = 90
    const before = totalUnits(s.nations.r0.military.units)
    const cash = s.nations.r0.resources.capital
    annexPuppet(s, map, 'r0', 'r1')
    expect(totalUnits(s.nations.r0.military.units)).toBeCloseTo(before + 7)
    expect(s.nations.r0.resources.capital).toBeGreaterThanOrEqual(cash + 90)
    expect(s.nations.r1.alive).toBe(false)
  })

  it('puppets follow their overlord into war', () => {
    const s = startState(map)
    s.nations.r2.overlord = 'r0'
    declareWar(s, map, 'r0', 'r3', createRng(1, 1))
    expect(s.wars).toContain('r2|r3')
  })

  it('tribute paid under threat sours the payer', () => {
    const s = startState(map)
    s.nations.r1.resources.capital = 500
    s.nations.r0.resources.pp = 50
    // A mighty neighbor: r1 gives in.
    setMilitary(s, 'r0', { infantry: 200 })
    s.nations.r1.military.units.infantry = 1
    const next = resolveTurn(s, map, [{ type: 'propose', nationId: 'r0', target: 'r1', proposal: { kind: 'trade', terms: { give: {}, receive: { capital: 30 }, months: 0 } } }])
    const mods = next.opinions['r1>r0'] ?? []
    if (next.nations.r0.resources.capital > s.nations.r0.resources.capital) expect(mods.some((m) => m.label === 'Forced us to pay tribute')).toBe(true)
    expect(mods.some((m) => m.label === 'Fair dealing')).toBe(false)
  })

  it('walking away from a loan is a default', () => {
    const s = startState(map)
    s.deals.push({ id: 'd1', kind: 'loan', from: 'r0', to: 'r1', give: { capital: 10 }, receive: {}, until: 20 })
    cancelDeal(s, 'r0', 'd1')
    expect(s.infamy.r0).toBeGreaterThanOrEqual(DIPLOMACY.loan.defaultInfamy - 1e-9)
    expect(s.nations.r0.defaultedUntil).toBeGreaterThan(s.turn)
    expect(s.casusBelli['r1|r0']).toBeGreaterThan(s.turn)
  })

  it('a pact can be broken, at a price in trust', () => {
    const s = startState(map)
    s.pacts['r0|r1'] = 30
    breakPact(s, 'r0', 'r1')
    expect(s.pacts['r0|r1']).toBeUndefined()
    expect(s.infamy.r0).toBeGreaterThan(0)
    expect(s.casusBelli['r1|r0']).toBeGreaterThan(s.turn)
  })

  it('a dreadful reputation sets off the coalition', () => {
    const s = startState(map)
    expect(coalitionActive(s, map)).toBe(false)
    s.infamy.r0 = 70
    expect(coalitionActive(s, map)).toBe(true)
  })
})

describe('money', () => {
  it('a corruption sweep finds less the sooner it follows the last', () => {
    const s = startState(map)
    s.nations.r0.agencies.domestic.level = 2
    const a = s.nations.r0.resources.capital
    runDomestic(s, 'r0', 'corruption', undefined)
    const first = s.nations.r0.resources.capital - a
    const b = s.nations.r0.resources.capital
    runDomestic(s, 'r0', 'corruption', undefined)
    expect(s.nations.r0.resources.capital - b).toBeLessThan(first * 0.2)
  })

  it('an investment runs down as it pays', () => {
    const s = startState(map)
    s.investments.push({ id: 'i1', investor: 'r0', target: 'r1', sector: 'farming', amount: 100 })
    cleanInvestments(s)
    expect(s.investments[0].amount).toBeCloseTo(100 * (1 - INVEST.amortize))
    // Over its life it pays back a little more than itself, not forever.
    expect(INVEST.dividend / INVEST.amortize).toBeLessThan(1.5)
  })

  it('big purchases raise the world price, and it settles back over the months', () => {
    const s = startState(map)
    const before = marketPrices(s).oil
    pushMarket(s, 'oil', 600)
    expect(marketPrices(s).oil).toBeGreaterThan(before)
    let next: GameState = s
    for (let i = 0; i < 8; i++) next = resolveTurn(next, map, [])
    expect(Math.abs(next.marketPressure?.oil ?? 0)).toBeLessThan(0.01)
  })
})

describe('rival AIs answer crises', () => {
  it('a Medium rival with a friend in unrest sends aid', async () => {
    const { generateBotOrders } = await import('../../ai/bot')
    const s = startState(map)
    s.settings.difficulty = 'normal'
    s.humans = ['r0']
    s.nations.r2.resources.pp = 80
    s.nations.r2.resources.capital = 400
    // r3 is in unrest; r2 likes r3.
    s.crises.push({ id: 'cr1', kind: 'unrest', nation: 'r3', rival: null, area: 'Somewhere', stage: 1, next: 99, boil: 0.5, answered: [] })
    s.opinions['r2>r3'] = [{ label: 'friend', value: 40, decay: 0 }]
    let sent = false
    for (let seed = 1; seed <= 30 && !sent; seed++) {
      s.seed = seed
      sent = generateBotOrders(s, map, 'r2').some((o) => o.type === 'crisisAction' && o.action === 'aid')
    }
    expect(sent).toBe(true)
  })
})
