import { describe, expect, it } from 'vitest'
import { UPGRADE_SPECS } from '../../data/development'
import { BUILDING_SPECS, TRAIN_MONTHS, TRAIN_QUEUE_LIMIT, UNIT_SPECS } from '../../data/unitTypes'
import { computeEconomy } from '../economy'
import { developmentBonus } from '../development'
import { validateOrder } from '../orders'
import { BUILD_MONTHS, UPGRADE_MONTHS } from '../pace'
import { advance, applyImmediate, cancelProject, endMonth } from '../realtime'
import { lineMap, startState } from './fixtures'

function quiet(map = lineMap(1)) {
  const s = startState(map)
  s.nations.r0.resources.capital = 500
  s.nations.r0.militaryPool = 80
  return { map, s }
}

describe('building and training', () => {
  it('shows a reason and spends nothing when a build is unaffordable or illegal', () => {
    const { map, s } = quiet()
    s.nations.r0.resources.capital = 10
    const order = { type: 'build' as const, nationId: 'r0', regionId: 'r0', building: 'factory' as const }
    expect(validateOrder(s, map, order)).toBe(`Not enough money (costs ${BUILDING_SPECS.factory.cost})`)
    const blocked = applyImmediate(s, map, order)
    expect(blocked.error).toMatch(/Not enough money/)
    expect(blocked.state.nations.r0.resources.capital).toBe(10)
    expect(blocked.state.projects).toHaveLength(0)

    const port = applyImmediate(s, map, { type: 'build', nationId: 'r0', regionId: 'r0', building: 'port' })
    expect(port.error).toBe('Requires a coastline')
    expect(port.state.projects).toHaveLength(0)
  })

  it('spends the cost at once and finishes a farm when the month ends', () => {
    const { map, s } = quiet()
    const before = s.regions.r0.buildings.farm
    const capital = s.nations.r0.resources.capital
    const started = applyImmediate(s, map, { type: 'build', nationId: 'r0', regionId: 'r0', building: 'farm' })
    expect(started.error).toBeNull()
    expect(started.state.nations.r0.resources.capital).toBe(capital - BUILDING_SPECS.farm.cost)
    expect(started.state.projects).toHaveLength(1)
    expect(started.state.projects[0].total).toBe(BUILD_MONTHS.farm)
    expect(started.state.projects[0].remaining).toBe(BUILD_MONTHS.farm)

    const again = applyImmediate(started.state, map, { type: 'build', nationId: 'r0', regionId: 'r0', building: 'farm' })
    expect(again.error).toBe('Already building one here')
    expect(again.state.projects).toHaveLength(1)

    const waiting = advance(started.state, map, 0)
    expect(waiting.state).toBe(started.state)
    expect(waiting.state.regions.r0.buildings.farm).toBe(before)

    const done = endMonth(started.state, map)
    expect(done.state.projects.filter((p) => p.building === 'farm')).toHaveLength(0)
    expect(done.state.regions.r0.buildings.farm).toBe(before + 1)
    expect(done.state.log.some((entry) => entry.text.includes('Farm'))).toBe(true)
    expect(done.notices.some((notice) => notice.type === 'built' && notice.pause === false)).toBe(true)
    expect(computeEconomy(done.state, map, 'r0').buildings.farm).toBe(computeEconomy(started.state, map, 'r0').buildings.farm + 1)
  })

  it('refunds a cancelled building and keeps a two-month factory until the second month', () => {
    const { map, s } = quiet()
    const capital = s.nations.r0.resources.capital
    const started = applyImmediate(s, map, { type: 'build', nationId: 'r0', regionId: 'r0', building: 'factory' })
    const id = started.state.projects[0].id
    expect(started.state.projects[0].total).toBe(2)
    const full = cancelProject(started.state, id)
    expect(full.projects).toHaveLength(0)
    expect(full.nations.r0.resources.capital).toBe(capital)
    expect(applyImmediate(full, map, { type: 'build', nationId: 'r0', regionId: 'r0', building: 'factory' }).error).toBeNull()

    const partial = endMonth(started.state, map)
    expect(partial.state.projects[0].remaining).toBe(1)
    expect(partial.state.regions.r0.buildings.factory).toBe(s.regions.r0.buildings.factory)
    const beforeCancel = partial.state.nations.r0.resources.capital
    const half = cancelProject(partial.state, id)
    expect(half.projects).toHaveLength(0)
    expect(half.nations.r0.resources.capital - beforeCancel).toBeCloseTo(BUILDING_SPECS.factory.cost * 0.5, 5)
  })

  it('applies a territory upgrade after its months and blocks a second copy', () => {
    const { map, s } = quiet()
    const territoryId = 'r0:0'
    const before = developmentBonus(s, map, 'r0').capital
    const started = applyImmediate(s, map, { type: 'develop', nationId: 'r0', territoryId, upgrade: 'works' })
    expect(started.error).toBeNull()
    expect(started.state.nations.r0.resources.capital).toBe(500 - 32)
    expect(started.state.projects[0].total).toBe(UPGRADE_MONTHS.works)
    expect(applyImmediate(started.state, map, { type: 'develop', nationId: 'r0', territoryId, upgrade: 'works' }).error).toBe('Already building one here')

    const halfway = endMonth(started.state, map)
    expect(halfway.state.territoryDev[territoryId]?.works ?? 0).toBe(0)
    const done = endMonth(halfway.state, map)
    expect(done.state.projects.filter((p) => p.upgrade === 'works')).toHaveLength(0)
    expect(done.state.territoryDev[territoryId].works).toBe(1)
    expect(developmentBonus(done.state, map, 'r0').capital).toBeCloseTo(before + UPGRADE_SPECS.works.capital, 5)
    expect(done.notices.some((notice) => notice.type === 'built' && notice.text.includes('Works'))).toBe(true)
  })

  it('trains one unit at a time and finishes infantry in one month', () => {
    const { map, s } = quiet()
    const army = Object.values(s.armies).find((item) => item.owner === 'r0')!
    const infantry = army.units.infantry
    const capital = s.nations.r0.resources.capital
    const pool = s.nations.r0.militaryPool
    const order = { type: 'queueTrain' as const, nationId: 'r0', territoryId: 'r0:0', unit: 'infantry' as const }
    expect(validateOrder({ ...s, nations: { ...s.nations, r0: { ...s.nations.r0, militaryPool: 1 } } }, map, order)).toMatch(/Not enough soldiers/)

    const started = applyImmediate(s, map, order)
    expect(started.error).toBeNull()
    expect(started.state.nations.r0.resources.capital).toBe(capital - UNIT_SPECS.infantry.capitalCost)
    expect(started.state.nations.r0.militaryPool).toBe(pool - UNIT_SPECS.infantry.manpowerCost)
    expect(started.state.trainingQueue[0].total).toBe(TRAIN_MONTHS.infantry)

    const second = applyImmediate(started.state, map, order)
    expect(second.error).toBeNull()
    expect(second.state.trainingQueue).toHaveLength(2)

    expect(advance(second.state, map, 0).state.trainingQueue[0].remaining).toBe(TRAIN_MONTHS.infantry)
    const fast = endMonth(second.state, map)
    expect(fast.state.armies[army.id].units.infantry).toBe(infantry + 1)
    expect(fast.state.trainingQueue).toHaveLength(1)
    expect(fast.state.trainingQueue[0].remaining).toBe(TRAIN_MONTHS.infantry)
    expect(fast.notices.some((notice) => notice.type === 'trained' && notice.pause)).toBe(true)

    const both = endMonth(fast.state, map)
    expect(both.state.trainingQueue).toHaveLength(0)
    expect(both.state.armies[army.id].units.infantry).toBe(infantry + 2)

    const fresh = applyImmediate(both.state, map, order)
    const job = fresh.state.trainingQueue[fresh.state.trainingQueue.length - 1]
    const refunded = applyImmediate(fresh.state, map, { type: 'cancelTrain', nationId: 'r0', jobId: job.id })
    expect(refunded.error).toBeNull()
    expect(refunded.state.trainingQueue.some((item) => item.id === job.id)).toBe(false)
    expect(refunded.state.nations.r0.resources.capital).toBe(fresh.state.nations.r0.resources.capital + UNIT_SPECS.infantry.capitalCost)
  })

  it('stops recruiting once four units are already training', () => {
    const { map, s } = quiet()
    const order = { type: 'recruit' as const, nationId: 'r0', territoryId: 'r0:0', unit: 'infantry' as const }
    let state = s
    for (let i = 0; i < TRAIN_QUEUE_LIMIT; i++) {
      const next = applyImmediate(state, map, order)
      expect(next.error).toBeNull()
      state = next.state
    }
    expect(state.trainingQueue).toHaveLength(TRAIN_QUEUE_LIMIT)
    expect(applyImmediate(state, map, order).error).toMatch(/queue/i)
  })
})
