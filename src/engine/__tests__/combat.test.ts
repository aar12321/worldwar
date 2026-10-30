import { describe, expect, it } from 'vitest'
import { computeEconomy, lineMax } from '../economy'
import { forecastAttack } from '../warfare'
import { hasCombinedArms, resolveBattle, sidePower, type Combatant } from '../combat'
import { combatMods } from '../arms'
import { createRng } from '../rng'
import { validateOrder } from '../orders'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'

const even = { infantry: 1, armor: 1, air: 1, naval: 1 }
const side = (units: Partial<Combatant['units']>): Combatant => ({
  units: { infantry: 0, armor: 0, air: 0, naval: 0, ...units },
  mods: null,
  penalty: 1,
  penaltyNotes: [],
})

describe('combat math', () => {
  it('armor is far weaker in mountains than on plains', () => {
    const tanks = side({ armor: 5 })
    expect(sidePower(tanks, even, 'mountain', false, false)).toBeLessThan(sidePower(tanks, even, 'plains', false, false) * 0.4)
  })

  it('combined arms beats the same divisions without the mix', () => {
    const mixed = side({ infantry: 2, armor: 2, air: 2 })
    expect(hasCombinedArms(mixed.units)).toBe(true)
    const raw =
      sidePower(side({ infantry: 2 }), even, 'plains', false, false) +
      sidePower(side({ armor: 2 }), even, 'plains', false, false) +
      sidePower(side({ air: 2 }), even, 'plains', false, false)
    expect(sidePower(mixed, even, 'plains', false, false)).toBeCloseTo(raw * 1.25)
  })

  it('mountain defenders get a terrain bonus', () => {
    const inf = side({ infantry: 5 })
    expect(sidePower(inf, even, 'mountain', false, true)).toBeGreaterThan(sidePower(inf, even, 'plains', false, true))
  })

  it('an overwhelming attacker wins and battles are reproducible', () => {
    const input = { attacker: side({ infantry: 20, armor: 6 }), defender: side({ infantry: 3 }), terrain: 'plains' as const, coastal: false }
    const a = resolveBattle(input, createRng(5))
    const b = resolveBattle(input, createRng(5))
    expect(a.winner).toBe('attacker')
    expect(a).toEqual(b)
    expect(a.rounds.length).toBeGreaterThan(0)
  })

  it('a weak attacker is repulsed', () => {
    const out = resolveBattle({ attacker: side({ infantry: 1 }), defender: side({ infantry: 8 }), terrain: 'mountain', coastal: false }, createRng(2))
    expect(out.winner).toBe('defender')
  })
})

describe('attacks', () => {
  it('a successful attack captures the whole country and ends a nation with no land left', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 30, armor: 10, air: 5 })
    setMilitary(s, 'r1', { infantry: 1 })
    const result = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin' })
    expect(result.error).toBeNull()
    expect(result.battle?.captured).toBe(true)
    expect(s.regions.r1.owner).toBe('r0')
    expect(s.nations.r1.alive).toBe(false)
    expect(s.nations.r0.military.lastAttackTurn).toBe(s.turn)
  })

  it('cannot attack a nation you are not at war with', () => {
    const map = lineMap(2)
    const s = startState(map)
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })).toMatch(/Not at war/)
  })

  it('a nation can attack at most three times a turn, and only while it has fresh units', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 30, armor: 10, air: 5 })
    setMilitary(s, 'r1', { infantry: 60 })
    s.regions.r1.line = 99
    expect(applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'probe' }).error).toBeNull()
    expect(applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'probe' }).error).toBeNull()
    expect(applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'probe' }).error).toBeNull()
    // Three probes spend 99%; the next has nothing fresh to send.
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'probe' })).toMatch(/already attacked 3 times|spent/)
  })

  it('the defender fights with its whole military plus the garrison', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 6 })
    setMilitary(s, 'r1', { infantry: 20 })
    const result = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })
    expect(result.battle?.defender.units.infantry).toBeGreaterThan(20)
    expect(result.battle?.winner).toBe('defender')
    expect(s.regions.r1.owner).toBe('r1')
  })

  it('a battle report lists the losses of every round', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 12, armor: 4, air: 3 })
    setMilitary(s, 'r1', { infantry: 6 })
    const { battle } = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1' })
    expect(battle?.rounds).toHaveLength(3)
    const lost = battle!.rounds.reduce((sum, r) => sum + r.defenderLosses.infantry, 0)
    expect(lost).toBeCloseTo(battle!.defender.losses.infantry, 6)
  })

  it('weapons raise both attack and defense', () => {
    const map = lineMap(2)
    const s = startState(map)
    const plain = combatMods(s.nations.r0)
    s.nations.r0.military.weapons.infantry = 3
    const armed = combatMods(s.nations.r0)
    expect(armed.unitAttack.infantry).toBeCloseTo(plain.unitAttack.infantry + 0.18)
    expect(armed.unitDefense.infantry).toBeCloseTo(plain.unitDefense.infantry + 0.18)
  })

  it('a rebel uprising that overwhelms the garrison secedes the region', () => {
    const map = lineMap(3)
    const s = startState(map)
    giveRegions(s, 'r0', ['r1'])
    s.regions.r1.rebels = 60
    setMilitary(s, 'r0', { infantry: 1 })
    const next = resolveTurn(s, map, [])
    expect(next.regions.r1.owner).not.toBe('r0')
    expect(next.nations[next.regions.r1.owner].alive).toBe(true)
    expect(next.wars.some((k) => k.includes('r0'))).toBe(true)
  })
})

describe('campaigns', () => {
  function front(units = { infantry: 14, armor: 4, air: 3 }, defenders = { infantry: 10 }) {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', units)
    setMilitary(s, 'r1', defenders)
    return { map, s }
  }

  it('a win pushes the Defense Line back but only the last push captures the country', () => {
    const { map, s } = front()
    const full = s.regions.r1.line
    expect(full).toBeGreaterThan(2)
    const first = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin' })
    expect(first.battle?.winner).toBe('attacker')
    expect(first.battle?.lineBefore).toBeCloseTo(full)
    expect(first.battle!.lineAfter!).toBeLessThan(full)
    if (!first.battle!.captured) {
      expect(s.regions.r1.owner).toBe('r1')
      expect(s.regions.r1.line).toBeGreaterThan(0)
    }
  })

  it('a bigger force pushes the line further', () => {
    const small = front()
    const big = front()
    const a = applyOrderNow(small.s, small.map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'probe' }).battle!
    const b = applyOrderNow(big.s, big.map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin' }).battle!
    expect(b.lineBefore! - b.lineAfter!).toBeGreaterThanOrEqual(a.lineBefore! - a.lineAfter!)
  })

  it('big countries have longer lines than small ones, and capitals hold out longer', () => {
    const map = lineMap(3)
    const s = startState(map)
    s.regions.r1.population = 80
    s.regions.r2.population = 2
    expect(lineMax(s, map, 'r1')).toBeGreaterThan(lineMax(s, map, 'r2'))
    expect(lineMax(s, map, 'r0')).toBeGreaterThan(lineMax(s, map, 'r2') - 0.001)
  })

  it('units committed abroad defend home at half strength until the turn ends', () => {
    const { map, s } = front({ infantry: 20, armor: 0, air: 0 }, { infantry: 4 })
    applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin' })
    expect(s.nations.r0.military.exposed).toBe(1)
    const next = resolveTurn(s, map, [])
    expect(next.nations.r0.military.exposed).toBe(0)
  })

  it('a quiet country heals its line each month', () => {
    const { map, s } = front()
    s.regions.r1.line = 1
    const next = resolveTurn(s, map, [])
    expect(next.regions.r1.line).toBeGreaterThan(1)
  })

  it('a siege stops the target factories for two months', () => {
    const { map, s } = front()
    const result = applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin', stance: 'siege' })
    if (result.battle?.winner === 'attacker' && !result.battle.captured) expect(s.regions.r1.sabotaged).toBeGreaterThanOrEqual(2)
  })

  it('a blitz costs money to launch', () => {
    const { map, s } = front()
    s.nations.r0.resources.capital = 3
    expect(validateOrder(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'main', stance: 'blitz' })).toMatch(/Not enough money/)
  })
})

describe('the forecast', () => {
  it('says Likely for a crushing force and Risky for a hopeless one, without changing the game', () => {
    const strong = (() => {
      const map = lineMap(2)
      const s = startState(map)
      s.wars = ['r0|r1']
      setMilitary(s, 'r0', { infantry: 40, armor: 10, air: 6 })
      setMilitary(s, 'r1', { infantry: 1 })
      return { map, s }
    })()
    const before = JSON.stringify(strong.s)
    const f = forecastAttack(strong.s, strong.map, 'r0', 'r1', 'allin', 'assault')!
    expect(f.label).toBe('Likely')
    expect(f.lineDamage).toBeGreaterThan(0)
    expect(JSON.stringify(strong.s)).toBe(before)
    const weak = (() => {
      const map = lineMap(2)
      const s = startState(map)
      s.wars = ['r0|r1']
      setMilitary(s, 'r0', { infantry: 1 })
      setMilitary(s, 'r1', { infantry: 40, armor: 10 })
      return { map, s }
    })()
    expect(forecastAttack(weak.s, weak.map, 'r0', 'r1', 'allin', 'assault')!.label).toBe('Risky')
  })
})

describe('the cost of war', () => {
  it('every war adds a monthly bill that grows with your military', () => {
    const map = lineMap(3)
    const s = startState(map)
    const peace = computeEconomy(s, map, 'r0')
    s.wars = ['r0|r1']
    const war = computeEconomy(s, map, 'r0')
    expect(war.warBills).toHaveLength(1)
    expect(war.netCapital).toBeLessThan(peace.netCapital)
    setMilitary(s, 'r0', { infantry: 40 })
    expect(computeEconomy(s, map, 'r0').warBillTotal).toBeGreaterThan(war.warBillTotal)
  })

  it('a country can be in at most three wars', () => {
    const map = lineMap(6)
    const s = startState(map)
    s.wars = ['r0|r1', 'r0|r2', 'r0|r3']
    expect(validateOrder(s, map, { type: 'declareWar', nationId: 'r0', target: 'r4' })).toMatch(/already fighting 3 wars/)
    s.wars = ['r1|r4', 'r2|r4', 'r3|r4']
    expect(validateOrder(s, map, { type: 'declareWar', nationId: 'r0', target: 'r4' })).toMatch(/already fighting 3 wars/)
  })

  it('conquered land starts restless and half productive, then settles', () => {
    const map = lineMap(2)
    const s = startState(map)
    s.wars = ['r0|r1']
    setMilitary(s, 'r0', { infantry: 40, armor: 10, air: 6 })
    setMilitary(s, 'r1', { infantry: 1 })
    let tries = 0
    while (s.regions.r1.owner !== 'r0' && tries++ < 3) {
      s.nations.r0.military.exposed = 0
      s.nations.r0.military.lastAttackTurn = -1
      applyOrderNow(s, map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin' })
    }
    expect(s.regions.r1.owner).toBe('r0')
    expect(s.regions.r1.integration).toBe(0)
    const next = resolveTurn(s, map, [])
    expect(next.regions.r1.integration).toBeGreaterThan(0)
  })
})
