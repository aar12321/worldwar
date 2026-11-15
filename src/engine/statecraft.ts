import { BANKING } from '../data/banking'
import { STANDARD_SPENDING } from '../data/people'
import { startingBank, startingWorldStats, syncDebt, updateWorldStats } from './bank'
import { countRegions, empireCount, tierFor } from './empire'
import { activeProjects } from './industry'
import { militaryPower } from './militaryStats'
import { cleanSpending, developmentOf, livingStandard, runMigration, startingPeople, type PeopleBasis } from './people'
import type { Budget, GameState, Nation, NationId, Programs, Spending, WorldMap } from './types'

export const defaultPrograms = (): Programs => ({ stage: 'secondary', focus: 'balanced', immigration: 'normal', occupation: 'standard', armsExports: 'off', quarantine: false, creditSector: null })

/** The old zero-sum budget as spending levels: an even share of 25% is the standard level 2. */
export function spendingFromBudget(b: Budget | undefined, healthcareLaw: boolean): Spending {
  const lvl = (share: number | undefined) => Math.round((share ?? 0.25) / 0.125)
  return cleanSpending({ ...STANDARD_SPENDING, schools: lvl(b?.education), health: lvl(b?.health) + (healthcareLaw ? 1 : 0), works: lvl(b?.infrastructure) })
}

/** What the people model needs to know about a nation's land and buildings, read straight from the map. */
export function peopleBasis(s: GameState, map: WorldMap, id: NationId): PeopleBasis {
  const n = s.nations[id]
  let workforce = 0
  let factories = 0
  let universities = 0
  let hospitals = 0
  let buildings = 0
  let regions = 0
  let occupied = 0
  for (const r of Object.values(s.regions)) {
    if (r.owner !== id) continue
    const m = map.regions[r.id]
    if (!m) continue
    regions++
    if (r.integration < 1) occupied++
    const w = Math.pow(Math.max(0.05, r.population), 0.6) * (0.3 + 0.7 * m.development)
    workforce += w
    factories += r.buildings.factory
    universities += r.buildings.university
    hospitals += r.buildings.hospital ?? 0
    for (const v of Object.values(r.buildings)) buildings += v
  }
  return {
    workforce,
    factories,
    universities,
    hospitals,
    buildings,
    development: developmentOf(s, map, id, (r, m) => Math.pow(Math.max(0.05, r.population), 0.6) * (0.3 + 0.7 * m.development)),
    occupiedShare: regions > 0 ? occupied / regions : 0,
    systemLevels: Object.values(n?.systems ?? {}).reduce((a, b) => a + (b ?? 0), 0),
    activeProjects: n ? activeProjects(n).length : 0,
  }
}

/**
 * Fills in everything a nation needs for the Statecraft systems: a new game's nations, a secession's, or an older save's. Old budget
 * shares become spending levels, the retired healthcare law becomes health spending, and old debt becomes one bond.
 */
export function ensureStatecraft(s: GameState, map: WorldMap) {
  s.worldStats ??= startingWorldStats()
  const counts = countRegions(s)
  for (const n of Object.values(s.nations).sort((a, b) => (a.id < b.id ? -1 : 1))) ensureNation(s, map, n, counts)
}

export function ensureNation(s: GameState, map: WorldMap, n: Nation, counts = countRegions(s)) {
  const healthcare = (n.laws ?? []).includes('universal_healthcare')
  if (!n.spending) {
    n.spending = spendingFromBudget(n.budget, healthcare)
    delete n.budget
  } else n.spending = cleanSpending(n.spending)
  if (healthcare) n.laws = n.laws.filter((l) => l !== 'universal_healthcare')
  n.programs = { ...defaultPrograms(), ...(n.programs ?? {}) }
  n.bank = { ...startingBank(), ...(n.bank ?? {}) }
  if (!Array.isArray(n.bonds)) {
    n.bonds = n.debt > 0 ? [{ id: `bd-${n.id}`, amount: n.debt, rate: 0.006, due: s.turn + BANKING.migratedTerm, term: BANKING.migratedTerm }] : []
  }
  syncDebt(n)
  n.stateOwned ??= []
  n.seizedUntil ??= 0
  n.projects ??= {}
  n.academy ??= 0
  n.research2 ??= { productivity: 0, medicine: 0, weapons: 0 }
  for (const k of ['productivity', 'medicine', 'weapons'] as const) n.research2[k] ??= 0
  n.tier ??= tierFor(empireCount(s, n.id, counts))
  n.regionalCapitals ??= []
  n.capitalMoved ??= -99
  n.lastResolution ??= -99
  if (!n.people?.skills) n.people = startingPeople(n, peopleBasis(s, map, n.id))
}

/** The fields every new nation starts with. Its people are filled in once the whole map is laid out (see `seedPeople`). */
export function freshStatecraft(): Pick<Nation, 'bonds' | 'spending' | 'programs' | 'people' | 'bank' | 'stateOwned' | 'seizedUntil' | 'projects' | 'academy' | 'research2' | 'tier' | 'regionalCapitals' | 'capitalMoved' | 'lastResolution'> {
  return {
    bonds: [],
    spending: { ...STANDARD_SPENDING },
    programs: defaultPrograms(),
    people: { skills: { basic: 0.62, skilled: 0.3, engineers: 0.04, doctors: 0.02, scientists: 0.02 }, schooling: 0.4, health: 0.55, unemployment: 0.05, specialization: 0, focusSince: 0, epidemic: 0, migration: 0 },
    bank: startingBank(),
    stateOwned: [],
    seizedUntil: 0,
    projects: {},
    academy: 0,
    research2: { productivity: 0, medicine: 0, weapons: 0 },
    tier: 1,
    regionalCapitals: [],
    capitalMoved: -99,
    lastResolution: -99,
  }
}

/** A new game's people: schooled and healthy as each land is developed, and exactly staffed for what each nation has built. */
export function seedPeople(s: GameState, map: WorldMap) {
  const counts = countRegions(s)
  for (const n of Object.values(s.nations)) {
    n.people = startingPeople(n, peopleBasis(s, map, n.id))
    n.tier = tierFor(empireCount(s, n.id, counts))
  }
}

/** Most months of history kept. */
export const HISTORY_CAP = 600

/** One snapshot of each human nation for the charts and the monthly report. Called once a month, after the economy has run. */
export function recordHistory(s: GameState, gross: Map<NationId, number>, netIncome: Map<NationId, number>) {
  const ranked = [...gross].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id)
  const list = (s.history ??= [])
  for (const id of s.humans) {
    const n = s.nations[id]
    if (!n?.alive) continue
    let countries = 0
    let population = 0
    for (const r of Object.values(s.regions)) if (r.owner === id) {
      countries++
      population += r.population
    }
    list.push({
      turn: s.turn,
      nation: id,
      money: n.resources.capital,
      income: netIncome.get(id) ?? 0,
      power: militaryPower(s, id),
      countries,
      stability: n.stability,
      population,
      schooling: n.people.schooling,
      inflation: n.bank.inflation,
      unemployment: n.people.unemployment,
      rank: Math.max(1, ranked.indexOf(id) + 1),
    })
  }
  if (list.length > HISTORY_CAP * Math.max(1, s.humans.length)) list.splice(0, list.length - HISTORY_CAP * Math.max(1, s.humans.length))
}

/**
 * The end of the month's world-level work: people move toward a better life, and the world's interest rate, inflation, living
 * standard and reserve currency are worked out for next month.
 */
export function runWorld(s: GameState, gross: Map<NationId, number>, workforce: Map<NationId, number>) {
  const standards = new Map<NationId, number>()
  for (const [id, g] of gross) {
    const n = s.nations[id]
    if (!n?.alive) continue
    standards.set(id, livingStandard(n, g / Math.max(0.3, workforce.get(id) ?? 1)))
  }
  const sorted = [...standards.values()].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  runMigration(s, standards, median)
  updateWorldStats(s, gross, median)
}
