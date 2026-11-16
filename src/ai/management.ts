import { CITY_RULES } from '../data/cities'
import { LAW_SPECS } from '../data/unitTypes'
import { cityDevelopCost } from '../engine/cities'
import type { EconomyReport } from '../engine/economy'
import { enemiesOf } from '../engine/helpers'
import type { Rng } from '../engine/rng'
import type { CityFocus, GameState, LawId, Nation, NationId, Order, Programs, SchoolFocus, SectorId, Spending } from '../engine/types'
import { BANKING } from '../data/banking'
import { programCost, ACADEMY } from '../data/projects'
import { STANDARD_SPENDING } from '../data/people'
import { TECHS } from '../data/techTree'
import { tierOf } from '../engine/empire'
import { activeProjects, levelCost, monthlyCost, projectLevel } from '../engine/industry'
import { LOCAL } from '../data/localProjects'
import { SOCIAL } from '../data/society'
import { socialLevel } from '../engine/society'
import { manageSpace } from './space'
import { activeLocal, localLevel } from '../engine/works'
import type { ProjectId, SocialId } from '../engine/types'

const spend = (schools: number, health: number, works: number, pensions: number, jobless: number, housing: number): Spending => ({ schools, health, works, pensions, jobless, housing })

/** What a thoughtful government would spend on its people right now. */
export function wantedSpending(n: Nation, econ: EconomyReport, atWar: boolean): Spending {
  if (n.stability < 40) return spend(2, 3, 2, 1, 2, 2)
  if (econ.netCapital < 0 && n.resources.capital < 80) return spend(1, 1, 2, 1, 1, 0)
  if (atWar) return spend(1, 2, 2, 1, 1, 1)
  if (n.resources.capital > 300 && econ.netCapital > econ.gross * 0.15) return spend(3, 3, 3, 1, 1, 1)
  return { ...STANDARD_SPENDING }
}

const sameSpending = (a: Spending, b: Spending) => (Object.keys(a) as (keyof Spending)[]).every((k) => a[k] === b[k])
export { sameSpending }

/** The interest rate a central bank would set: up when prices run, down when people are out of work. */
export function taylorRate(n: Nation): number {
  return Math.round(BANKING.neutralRate + 0.8 * (n.bank.inflation - BANKING.targetInflation) - 40 * (n.people.unemployment - 0.05))
}

/** The school focus a country is most short of. */
function wantedSchoolFocus(econ: EconomyReport): SchoolFocus {
  const c = econ.coverage
  if (c.engineers < 1) return 'engineering'
  if (c.doctors < 0.9) return 'medicine'
  if (econ.buildings.university > 0 && c.scientists < 1) return 'science'
  return 'trades'
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
  if (n.stability < 40 && n.government !== 'democracy') wants.push('press_control')
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

  spent += manageStatecraft(s, nationId, econ, skill, rng, tryAdd, budget - spent)
  if (skill < 2) return spent

  // The strongest tier borrows to keep up, repays when rich, invests in friends, and sanctions rivals.
  const bondTerm = tierOf(n).bondTerms.includes(60) && n.bank.rate < BANKING.neutralRate ? 60 : 36
  if (econ.netCapital < -2 && !n.inDebt && econ.credit.room > 60 && n.resources.capital < -econ.netCapital * 6) {
    tryAdd({ type: 'issueBonds', nationId, amount: Math.min(150, Math.floor(econ.credit.room)), term: bondTerm })
  } else if (atWar && n.resources.capital < 60 && n.stability >= BANKING.warBondMinStability && n.bank.warBonds < econ.gross) {
    tryAdd({ type: 'issueBonds', nationId, amount: Math.max(20, Math.floor(econ.gross * 0.5)), war: true })
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

/**
 * The Statecraft side of running a country: the central bank, the schools, health in an epidemic, conquered land, arms sales,
 * national projects, hospitals, the academy and the research programs. Medium bots do the basics; Hard bots do all of it.
 */
function manageStatecraft(s: GameState, nationId: NationId, econ: EconomyReport, skill: 1 | 2, rng: Rng, tryAdd: (o: Order) => boolean, budget: number): number {
  const n = s.nations[nationId]
  const spec = tierOf(n)
  const atWar = enemiesOf(s, nationId).length > 0
  let spent = 0

  // Programs and the interest rate, in one order when anything should change.
  const want: Partial<Programs> = {}
  const focus = wantedSchoolFocus(econ)
  if (focus !== n.programs.focus && rng.chance(0.3)) want.focus = focus
  if (econ.buildings.university > 0 && n.programs.stage !== 'university' && n.people.schooling > 0.5) want.stage = 'university'
  const quarantine = n.people.epidemic > 0.12
  if (quarantine !== n.programs.quarantine) want.quarantine = quarantine
  if (econ.occupied >= 3 && spec.occupation.includes('autonomy') && n.programs.occupation === 'standard') want.occupation = 'autonomy'
  if (econ.occupied === 0 && n.programs.occupation !== 'standard') want.occupation = 'standard'
  const arms = (n.sectors.arms ?? 0) >= 1.5 ? (skill === 2 && spec.armsToAnyone && n.personality !== 'honorable' ? 'anyone' : 'friends') : 'off'
  if (arms !== n.programs.armsExports) want.armsExports = arms
  if (skill === 2 && spec.directedCredit && !n.programs.creditSector && n.stability > 55 && n.bank.inflation < 6) want.creditSector = atWar ? 'arms' : 'technology'
  if (n.programs.creditSector && (n.stability < 45 || n.bank.inflation > 10)) want.creditSector = null
  let rate: number | undefined
  if (spec.rate) {
    const r = Math.max(spec.rate[0], Math.min(spec.rate[1], taylorRate(n)))
    if (Math.abs(r - n.bank.rate) >= 1) rate = r
  }
  if (Object.keys(want).length || rate !== undefined) tryAdd({ type: 'setPrograms', nationId, programs: want, ...(rate !== undefined ? { rate } : {}) })

  // A Hard bot at war with an empty treasury prints, as far as its tier lets it.
  if (skill === 2 && atWar && n.resources.capital < 0 && n.bank.inflation < 15) tryAdd({ type: 'printMoney', nationId, share: Math.min(spec.printCap, 0.1) })

  // National projects: one at a time when the money is there. Hard bots go on to the new ones, and build the best of them up.
  if (budget - spent > 150 && activeProjects(n).length < spec.projectSlots && econ.netCapital > 6 && rng.chance(skill === 2 ? 0.25 : 0.12)) {
    const order: ProjectId[] = ['rail', 'grid', 'medCentre', 'sciencePark', 'ports', 'digitalGov', 'spaceComplex', 'waterNetwork', 'broadband']
    if (skill === 2) order.push('openUniversity', 'aiLab', 'fusion', 'expo', 'plannedCity', 'marsMission')
    let started = false
    for (const id of order) {
      if (n.projects[id]) continue
      if (econ.netCapital < monthlyCost(id, 1)) continue
      if (tryAdd({ type: 'startProject', nationId, project: id })) {
        started = true
        break
      }
    }
    // With everything open built, a rich Hard bot builds the next level of what it has.
    if (!started && skill === 2 && n.resources.capital > 500) {
      for (const id of order) {
        const level = projectLevel(n, id)
        if (level < 1 || level >= 2 || n.projects[id]?.done === false) continue
        if (n.resources.capital < levelCost(id, level + 1) * 1.5 || econ.netCapital < monthlyCost(id, level + 1)) continue
        if (tryAdd({ type: 'startProject', nationId, project: id })) break
      }
    }
  }

  spent += manageSociety(s, nationId, econ, skill, rng, tryAdd, budget - spent)

  // Hospitals where the doctors can staff them.
  if (budget - spent > 80 && econ.coverage.doctors > 1.1 && n.people.health < 0.75 && rng.chance(0.15)) {
    const place = Object.values(s.regions).filter((r) => r.owner === nationId).sort((a, b) => (a.buildings.hospital ?? 0) - (b.buildings.hospital ?? 0) || b.population - a.population)[0]
    if (place && tryAdd({ type: 'build', nationId, regionId: place.id, building: 'hospital' })) spent += 60
  }

  // The academy, for those who can afford a better army.
  if (budget - spent > (ACADEMY.cost[Math.min(2, n.academy)] ?? 999) + 150 && rng.chance(skill === 2 ? 0.15 : 0.06) && tryAdd({ type: 'fundAcademy', nationId })) spent += ACADEMY.cost[Math.min(2, n.academy - 1)] ?? 0

  // Research programs once the tree runs dry or research piles up.
  const techLeft = TECHS.some((t) => !n.techs.includes(t.id) && t.requires.every((r) => n.techs.includes(r)))
  const track = atWar ? 'weapons' : n.people.health < 0.6 ? 'medicine' : 'productivity'
  if ((!techLeft || n.resources.tp > programCost(n.research2[track]) * 2.5) && n.resources.tp >= programCost(n.research2[track])) tryAdd({ type: 'researchProgram', nationId, track })

  // A great power with money to spare builds a wealth fund.
  if (skill === 2 && spec.wealthFund && n.resources.capital > 900 && !atWar && rng.chance(0.2)) {
    if (tryAdd({ type: 'wealthFund', nationId, amount: 200 })) spent += 200
  } else if (spec.wealthFund && n.resources.capital < 0 && n.bank.fund > 50) tryAdd({ type: 'wealthFund', nationId, amount: -Math.floor(n.bank.fund * 0.25) })

  // A command economy takes over its energy or arms makers.
  if (skill === 2 && (n.government === 'one_party' || n.government === 'junta') && n.stateOwned.length < spec.enterpriseSlots && budget - spent > 200 && rng.chance(0.08)) {
    const sector: SectorId = atWar ? 'arms' : 'energy'
    if (tryAdd({ type: 'setStateOwned', nationId, sector, mode: 'buy' })) spent += Math.round(10 * (n.sectors[sector] ?? 0))
  }

  // Regional capitals for a superpower's far provinces.
  if (spec.regionalCapitals > n.regionalCapitals.length && econ.admin.over > 0 && n.resources.pp > 60) {
    const far = Object.values(s.regions)
      .filter((r) => r.owner === nationId && r.integration >= 1 && r.id !== n.capital && !n.regionalCapitals.includes(r.id))
      .sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1))[0]
    if (far) tryAdd({ type: 'setRegionalCapital', nationId, regionId: far.id, on: true })
  }

  // The World Council: a Hard superpower cleans its name or turns the world on its strongest enemy.
  if (skill === 2 && spec.council && s.turn - n.lastResolution >= 12 && n.resources.pp > 70 && rng.chance(0.2)) {
    if ((s.infamy[nationId] ?? 0) > 30) tryAdd({ type: 'resolution', nationId, kind: 'recognition' })
    else {
      const foe = enemiesOf(s, nationId).sort()[0]
      if (foe) tryAdd({ type: 'resolution', nationId, kind: 'sanctions', target: foe })
    }
  }

  // A space program: modest for a Medium rival, serious for a Hard one, always inside what the country can spare.
  spent += manageSpace(s, nationId, econ, skill, tryAdd, budget - spent)
  return spent
}

/**
 * The people's side of a country: programs for calm and growth, a campaign in a crisis, and projects in the countries it holds.
 * Medium bots add stability programs when calm is low; Hard bots also invest in growth when rich, run campaigns and build in their
 * countries. A bot never takes a program to a level it cannot keep paying for, and a democracy never spies on its own people.
 */
function manageSociety(s: GameState, nationId: NationId, econ: EconomyReport, skill: 1 | 2, rng: Rng, tryAdd: (o: Order) => boolean, budget: number): number {
  const n = s.nations[nationId]
  const spec = tierOf(n)
  let spent = 0
  const monthly = (id: SocialId) => SOCIAL[id].cost * econ.workforce
  // A program is worth taking up only if the budget stays in the black after it.
  const keeps = (id: SocialId) => econ.netCapital - monthly(id) > 4

  const raise = (ids: SocialId[], cap: number): boolean => {
    for (const id of ids) {
      const level = socialLevel(n, id)
      if (level >= cap || !keeps(id)) continue
      if (tryAdd({ type: 'setSocial', nationId, policy: id, level: level + 1 })) return true
    }
    return false
  }

  if (n.stability < 48 && budget > 60 && rng.chance(0.5)) {
    const calm: SocialId[] = ['festivals', 'workerRights', 'minimumWage', 'mentalHealth', 'policing', 'libraries', 'elderCare']
    if (n.government !== 'democracy' && n.stability < 35) calm.unshift('surveillance')
    raise(calm, 2)
  } else if (skill === 2 && budget > 260 && n.resources.capital > 260 && econ.netCapital > econ.gross * 0.15 && rng.chance(0.25)) {
    raise(['courts', 'transit', 'smallLoans', 'apprenticeships', 'clinics', 'scholarships'], 2)
  }

  // A campaign when calm is shaken and the money is there.
  if (skill === 2 && n.stability < 38 && n.resources.capital > 150 && !n.campaigns?.celebration && rng.chance(0.4)) {
    if (tryAdd({ type: 'campaign', nationId, campaign: 'celebration' })) spent += 40
  } else if (skill === 2 && n.people.epidemic > 0.2 && n.resources.capital > 120 && !n.campaigns?.vaccination && tryAdd({ type: 'campaign', nationId, campaign: 'vaccination' })) spent += 50

  // Projects in the countries it holds. One a month, where it helps most.
  if (skill === 2 && budget - spent > 200 && activeLocal(s, nationId).length < spec.localSlots && econ.netCapital > 6 && rng.chance(0.2)) {
    const owned = Object.values(s.regions).filter((r) => r.owner === nationId).sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1))
    const loose = owned.filter((r) => r.integration < 0.7).sort((a, b) => a.integration - b.integration)
    const tries: { id: keyof typeof LOCAL; region: string }[] = []
    for (const r of loose) tries.push({ id: 'culturalCentre', region: r.id })
    if (econ.netFood < 0 && owned[0]) tries.push({ id: 'irrigation', region: owned[0].id })
    for (const r of [...owned].sort((a, b) => b.buildings.factory - a.buildings.factory)) if (r.buildings.factory >= 3) tries.push({ id: 'industrialPark', region: r.id })
    for (const r of owned.slice(0, 3)) {
      tries.push({ id: 'resort', region: r.id })
      tries.push({ id: 'sez', region: r.id })
    }
    for (const t of tries) {
      if (localLevel(s.regions[t.region], t.id) > 0 || s.regions[t.region].works?.[t.id]) continue
      if (tryAdd({ type: 'startProject', nationId, project: t.id, regionId: t.region })) break
    }
  }
  return spent
}
