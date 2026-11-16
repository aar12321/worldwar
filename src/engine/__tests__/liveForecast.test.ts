import { describe, expect, it } from 'vitest'
import { launchArmy } from '../armies'
import { forecastPlan } from '../forecast'
import { startLive } from '../live'
import { forecastAttack } from '../warfare'
import { lineMap, setMilitary, startState } from './fixtures'

/** A live game: the forecast must describe the army that really marches, home guard and all. */
function liveWar() {
  const map = lineMap(4)
  const s = startLive(startState(map))
  s.wars.push('r0|r1')
  setMilitary(s, 'r0', { infantry: 20, armor: 4 })
  setMilitary(s, 'r1', { infantry: 6 })
  return { map, s }
}

describe('the live forecast describes the army that really leaves', () => {
  it('an all-in attack keeps the home guard, in the forecast as in the army', () => {
    const { map, s } = liveWar()
    const f = forecastAttack(s, map, 'r0', 'r1', 'allin', 'assault')!
    const army = launchArmy(structuredClone(s), map, { type: 'attack', nationId: 'r0', target: 'r1', commit: 'allin', stance: 'assault' }, 0)!
    const sent = army.units.infantry / 20
    expect(sent).toBeCloseTo(0.9)
    expect(f.share).toBeCloseTo(sent)
    const g = forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', commit: 'allin' })!
    // The same fight: the odds of the plan equal the odds of fighting with exactly the army that was launched.
    const named = forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', units: { infantry: army.units.infantry, armor: army.units.armor } })!
    expect(g.winChance).toBeCloseTo(named.winChance, 5)
  })

  it('a named force never exceeds what the army could take', () => {
    const { map, s } = liveWar()
    const all = { infantry: 20, armor: 4 }
    const army = launchArmy(structuredClone(s), map, { type: 'attack', nationId: 'r0', target: 'r1', stance: 'assault', units: all }, 0)!
    const plan = forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', units: all })!
    const exact = forecastPlan(s, map, 'r0', { target: 'r1', stance: 'assault', units: { infantry: army.units.infantry, armor: army.units.armor } })!
    expect(plan.winChance).toBeCloseTo(exact.winChance, 5)
  })

  it('a turn game is unchanged: all in sends everything', () => {
    const { map, s } = liveWar()
    delete s.settings.mode
    expect(forecastAttack(s, map, 'r0', 'r1', 'allin', 'assault')!.share).toBeCloseTo(1)
  })
})
