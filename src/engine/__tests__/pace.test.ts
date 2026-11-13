import { describe, expect, it } from 'vitest'
import { EMPIRE, WAR } from '../../data/war'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { computeEconomy, integrationFactor } from '../economy'
import { maxAttacks, maxWars } from '../helpers'
import { resolveTurn } from '../resolveTurn'
import { trainingSlots } from '../training'
import { puppetValue } from '../warscore'
import { transferRegion } from '../warfare'
import { setMilitary } from './fixtures'

const { map } = getWorld()
const big = () => {
  const s = createInitialState(map, { playerRegionId: 'china', seed: 3 })
  const me = s.playerId
  for (const id of Object.keys(s.regions).slice(1, 37)) {
    s.regions[id].owner = me
    if (s.nations[id]) s.nations[id].alive = id === me
  }
  return { s, me }
}

describe('pace of a long game', () => {
  it('conquered land settles in about six months', () => {
    expect(WAR.integrationTurns).toBe(6)
    const { s, me } = big()
    const id = Object.keys(s.regions).find((x) => s.regions[x].owner === me && x !== me)!
    s.regions[id].integration = 0
    expect(integrationFactor(s.regions[id])).toBeCloseTo(WAR.integrationFloor)
    let cur = s
    for (let i = 0; i < 6; i++) cur = resolveTurn(cur, map, [])
    expect(cur.regions[id].integration).toBeGreaterThanOrEqual(0.99)
  })

  it('a bigger empire can fight more wars, launch more attacks and train more at once', () => {
    const small = createInitialState(map, { playerRegionId: 'poland', seed: 1 })
    const { s, me } = big()
    expect(maxWars(s, me)).toBeGreaterThan(maxWars(small, small.playerId))
    expect(maxAttacks(s, me)).toBeGreaterThan(maxAttacks(small, small.playerId))
    expect(maxAttacks(s, me)).toBeLessThanOrEqual(EMPIRE.maxAttacksCap)
    expect(trainingSlots(s, me)).toBeGreaterThan(trainingSlots(small, small.playerId) + 5)
  })

  it('every country adds influence for its officials', () => {
    const { s, me } = big()
    const small = createInitialState(map, { playerRegionId: 'china', seed: 3 })
    expect(computeEconomy(s, map, me).ppGain).toBeGreaterThan(computeEconomy(small, map, me).ppGain + 3)
  })

  it('no nation costs more than the cap to make a puppet, however big', () => {
    const { s, me } = big()
    expect(puppetValue(s, map, me)).toBe(EMPIRE.puppetCap)
  })

  it('a player who crushes an army wins the whole war when the capital falls', () => {
    const s = createInitialState(map, { playerRegionId: 'china', seed: 4 })
    const target = 'mongolia'
    const nation = s.nations[target]
    s.regions['kazakhstan'].owner = target
    setMilitary(s, target, { infantry: 2 })
    setMilitary(s, 'china', { infantry: 40 })
    transferRegion(s, map, nation.capital, 'china')
    expect(nation.alive).toBe(false)
    expect(s.regions['kazakhstan'].owner).toBe('china')
  })
})
