import { describe, expect, it } from 'vitest'
import { CITY_RULES, FOCUS, FOCUS_IDS, cityDefs, hasCityData } from '../../data/cities'
import { cityDevelopCost, cityEffects, cityLevelCap, cityWorkforceBonus, razeCities, startingCities } from '../cities'
import { computeEconomy, lineMax, regionWorkforce } from '../economy'
import { validateOrder } from '../orders'
import { applyOrderNow } from '../resolveTurn'
import { garrisonStrength, transferRegion } from '../warfare'
import type { GameState } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(3)
const P = 'r0'

function base(): GameState {
  const s = startState(map)
  s.nations[P].resources.capital = 1000
  s.regions.r0.population = 60
  return s
}

describe('cities', () => {
  it('real countries have real cities, the rest a capital', () => {
    expect(cityDefs('germany', 'Germany').map((c) => c.name)).toEqual(['Berlin', 'Hamburg', 'Munich', 'Frankfurt'])
    expect(cityDefs('bhutan', 'Bhutan').map((c) => c.name)).toEqual(['Thimphu'])
    expect(cityDefs('narnia', 'Narnia')[0].name).toBe('Narnia City')
    const cities = startingCities({ ...map.regions.r0, id: 'germany', name: 'Germany', coastal: false })
    expect(cities[0].level).toBe(2)
    expect(cities.slice(1).every((c) => c.level === 1)).toBe(true)
    expect(new Set(cities.map((c) => c.id)).size).toBe(cities.length)
  })

  it('every country in the game has a named capital', async () => {
    const { getWorld } = await import('../../map/world')
    const { map: world } = getWorld()
    const generic = Object.values(world.regions).filter((r) => !hasCityData(r.id))
    expect(generic.map((r) => r.id)).toEqual([])
  })

  it('each focus does what it says, per city level', () => {
    const s = base()
    const plain = computeEconomy(s, map, P)
    const city = s.regions.r0.cities[0]
    city.port = true
    const gain = (focus: (typeof FOCUS_IDS)[number]) => {
      const t = structuredClone(s)
      t.regions.r0.cities[0].focus = focus
      return computeEconomy(t, map, P)
    }
    city.focus = 'balanced'
    const base0 = computeEconomy(s, map, P)
    expect(gain('farming').foodProduction).toBeGreaterThan(base0.foodProduction)
    expect(gain('research').tpGain).toBeGreaterThan(base0.tpGain)
    expect(gain('industry').steelProduction).toBeGreaterThan(base0.steelProduction)
    expect(gain('industry').factoryIncome).toBeGreaterThan(base0.factoryIncome)
    expect(gain('harbor').tradeCapacity).toBeGreaterThan(base0.tradeCapacity)
    expect(gain('finance').netCapital).toBeGreaterThan(base0.netCapital)
    expect(gain('finance').credit.score).toBeGreaterThan(base0.credit.score)
    expect(plain.workforce).toBeGreaterThan(0)
    expect(cityEffects({ cities: [{ ...city, focus: 'farming', level: 4 }] }).food).toBeCloseTo(FOCUS.farming.food * 4)
  })

  it('bigger cities add workforce, up to a limit', () => {
    const s = base()
    const r = s.regions.r0
    r.cities = r.cities.map((c) => ({ ...c, level: 1 }))
    const before = regionWorkforce(r, map.regions.r0)
    r.cities[0].level = 3
    expect(regionWorkforce(r, map.regions.r0)).toBeCloseTo(before * (1 + 2 * CITY_RULES.workforcePerLevel))
    expect(cityWorkforceBonus({ cities: [{ ...r.cities[0], level: 5 }, { ...r.cities[0], level: 5 }, { ...r.cities[0], level: 5 }, { ...r.cities[0], level: 5 }] })).toBe(CITY_RULES.workforceCap)
  })

  it('a fortress city lengthens the Defense Line and the garrison', () => {
    const s = base()
    const line = lineMax(s, map, 'r0')
    const guard = garrisonStrength(s, map, 'r0')
    s.regions.r0.cities[0].focus = 'fortress'
    expect(lineMax(s, map, 'r0')).toBeGreaterThan(line)
    expect(garrisonStrength(s, map, 'r0')).toBeGreaterThan(guard)
  })

  it('developing a city costs more each level and is limited by the size of the country', () => {
    const s = base()
    const city = s.regions.r0.cities[0]
    city.level = 2
    const order = { type: 'develop' as never, nationId: P, regionId: 'r0', cityId: city.id }
    const develop = { type: 'developCity', nationId: P, regionId: 'r0', cityId: city.id } as const
    expect(order).toBeTruthy()
    const cost = cityDevelopCost(city)
    expect(cost).toBe(CITY_RULES.developCost * 2)
    const money = s.nations[P].resources.capital
    expect(applyOrderNow(s, map, develop).error).toBeNull()
    expect(city.level).toBe(3)
    expect(s.nations[P].resources.capital).toBe(money - cost)
    expect(cityDevelopCost(city)).toBeGreaterThan(cost)
    city.level = CITY_RULES.maxLevel
    expect(validateOrder(s, map, develop)).toMatch(/as big as/)
    city.level = 2
    s.regions.r0.population = 0.3
    expect(cityLevelCap(regionWorkforce(s.regions.r0, map.regions.r0))).toBe(2)
    expect(validateOrder(s, map, develop)).toMatch(/cannot grow past level 2/)
    expect(validateOrder(s, map, { ...develop, nationId: 'r1' })).toMatch(/do not hold/)
  })

  it('a harbor needs a coast, and changing focus costs money', () => {
    const s = base()
    const city = s.regions.r0.cities[0]
    city.port = false
    const focus = { type: 'setCityFocus', nationId: P, regionId: 'r0', cityId: city.id, focus: 'harbor' } as const
    expect(validateOrder(s, map, focus)).toMatch(/not on the coast/)
    city.port = true
    const money = s.nations[P].resources.capital
    expect(applyOrderNow(s, map, focus).error).toBeNull()
    expect(city.focus).toBe('harbor')
    expect(s.nations[P].resources.capital).toBe(money - CITY_RULES.focusCost)
    expect(validateOrder(s, map, focus)).toMatch(/already/)
  })

  it('conquest costs a city a level and its focus', () => {
    const s = base()
    const city = s.regions.r1.cities[0]
    city.level = 4
    city.focus = 'finance'
    transferRegion(s, map, 'r1', P)
    expect(s.regions.r1.cities[0].level).toBe(3)
    expect(s.regions.r1.cities[0].focus).toBe('balanced')
    const t = [{ level: 1, focus: 'research' as const }]
    razeCities({ cities: t as never })
    expect(t[0].level).toBe(1)
  })
})
