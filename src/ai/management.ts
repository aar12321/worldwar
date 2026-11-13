import { CITY_RULES } from '../data/cities'
import { LAW_SPECS } from '../data/unitTypes'
import { cityDevelopCost } from '../engine/cities'
import type { EconomyReport } from '../engine/economy'
import { enemiesOf } from '../engine/helpers'
import type { Rng } from '../engine/rng'
import type { Budget, CityFocus, GameState, LawId, Nation, NationId, Order, SectorId } from '../engine/types'

const budgetOf = (m: number, e: number, h: number, i: number): Budget => ({ military: m, education: e, health: h, infrastructure: i })

/** What a thoughtful government would spend tax money on right now. */
export function wantedBudget(n: Nation, econ: EconomyReport, atWar: boolean): Budget {
  if (n.stability < 45) return budgetOf(0.2, 0.15, 0.45, 0.2)
  if (atWar) return budgetOf(0.45, 0.2, 0.2, 0.15)
  if (econ.netCapital < 0) return budgetOf(0.15, 0.2, 0.2, 0.45)
  return budgetOf(0.15, 0.4, 0.2, 0.25)
}

/** Business tax a bot can afford: lower when money is plentiful, so firms grow. */
export function wantedCorporateTax(n: Nation, econ: EconomyReport): number {
  if (econ.netCapital < 0 || n.resources.capital < 40) return 0.25
  return n.resources.capital > 300 ? 0.08 : 0.15
}

/** The focus that would help a city's country most right now. */
function wantedFocus(n: Nation, econ: EconomyReport, atWar: boolean, capitalCity: boolean, port: boolean): CityFocus {
  if (econ.netFood < 0) return 'farming'
  if (econ.netGoods < 0 || econ.steelProduction < 3) return 'industry'
  if (atWar && capitalCity) return 'fortress'
  if (n.resources.tp < 15 && !atWar) return 'research'
  if (port && econ.tradeCapacity < 25) return 'harbor'
  return n.resources.capital > 250 ? 'finance' : 'balanced'
}

/**
 * Everything beyond war and diplomacy that a capable bot does with its country: cities, budget, laws, business and,
 * for the strongest tier, bonds, investment and sanctions. Returns orders that each pass validation.
 */
export function manageCountry(
  s: GameState,
  nationId: NationId,
  econ: EconomyReport,
  skill: 1 | 2,
  rng: Rng,
  tryAdd: (o: Order) => boolean,
  budget: number,
  neighbors: Set<NationId>,
): number {
  const n = s.nations[nationId]
  const atWar = enemiesOf(s, nationId).length > 0
  let spent = 0

  // Laws: a war economy while fighting, and a few steady ones in peace.
  const wants: LawId[] = []
  if (atWar) wants.push('war_economy')
  if (n.stability < 40) wants.push('universal_healthcare')
  if (skill === 2 && !atWar) wants.push('free_trade', 'research_grants', 'industrial_policy')
  if (skill === 2 && econ.netFood < 0) wants.push('rationing')
  for (const law of wants) {
    if (n.laws.includes(law) || n.resources.pp < LAW_SPECS[law].cost + 15) continue
    if (tryAdd({ type: 'enactLaw', nationId, law })) break
  }
  if (!atWar && n.laws.includes('war_economy')) tryAdd({ type: 'repealLaw', nationId, law: 'war_economy' })

  // Cities: set a focus where it helps, and grow one when there is money to spare.
  const cities = Object.values(s.regions)
    .filter((r) => r.owner === nationId)
    .flatMap((r) => r.cities.map((c) => ({ r, c })))
    .sort((a, b) => b.c.level - a.c.level || (a.c.id < b.c.id ? -1 : 1))
  const first = cities.find(({ c }) => c.focus === 'balanced')
  if (first && n.resources.capital > CITY_RULES.focusCost + 30) {
    const focus = wantedFocus(n, econ, atWar, first.r.id === n.capital && first.c === first.r.cities[0], first.c.port)
    if (focus !== 'balanced' && tryAdd({ type: 'setCityFocus', nationId, regionId: first.r.id, cityId: first.c.id, focus })) spent += CITY_RULES.focusCost
  }
  if (budget - spent > 120 && rng.chance(0.35)) {
    const grow = [...cities].sort((a, b) => a.c.level - b.c.level)[0]
    if (grow && cityDevelopCost(grow.c) + 40 < budget - spent && tryAdd({ type: 'developCity', nationId, regionId: grow.r.id, cityId: grow.c.id })) spent += cityDevelopCost(grow.c)
  }

  // Business: back the sector the country is short of.
  if (budget - spent > 200 && rng.chance(0.25)) {
    const need: SectorId = econ.netFood < 0 ? 'farming' : n.oilShortage || econ.netOil < 0 ? 'energy' : econ.netGoods < 0 ? 'manufacturing' : atWar ? 'arms' : 'technology'
    if (tryAdd({ type: 'fundSector', nationId, sector: need, amount: 80 })) spent += 80
  }

  if (skill < 2) return spent

  // The strongest tier borrows to keep up, repays when rich, invests in friends, and sanctions rivals.
  if (econ.netCapital < -2 && !n.inDebt && econ.credit.room > 60 && n.resources.capital < -econ.netCapital * 6) {
    tryAdd({ type: 'issueBonds', nationId, amount: Math.min(150, Math.floor(econ.credit.room)) })
  } else if (n.debt > 0 && n.resources.capital > 500) {
    tryAdd({ type: 'repayDebt', nationId, amount: Math.min(n.debt, 200) })
  }
  if (!atWar && budget - spent > 300 && rng.chance(0.2)) {
    const friends = [...neighbors].filter((id) => s.nations[id]?.alive && !s.nations[id].overlord && !enemiesOf(s, id).includes(nationId)).sort()
    const target = friends[Math.floor(rng.next() * friends.length)]
    if (target) {
      const sector: SectorId = rng.chance(0.5) ? 'manufacturing' : 'finance'
      if (tryAdd({ type: 'invest', nationId, target, sector, amount: 60 })) spent += 60
    }
  }
  if (atWar && n.resources.pp > 40) {
    const e = enemiesOf(s, nationId).sort()[0]
    if (e && !s.sanctions.some((x) => x.from === nationId && x.to === e)) tryAdd({ type: 'imposeSanctions', nationId, target: e })
  }
  return spent
}
