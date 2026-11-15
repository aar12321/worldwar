import { COVERAGE, DEMAND, FOCUSES, IMMIGRATION, MEDICINE, PEOPLE, SKILL_TARGETS, SPENDING_COST, STAGES, STANDARD_SPENDING } from '../data/people'
import { PROGRAM_RULES } from '../data/projects'
import { BANKING } from '../data/banking'
import { tierOf } from './empire'
import { clamp } from './helpers'
import type { GameState, MapRegion, Nation, NationId, People, RegionState, SkillKey, Spending, WorldMap } from './types'
import { SKILL_KEYS } from './types'

/** What a nation's land and buildings look like to the people model. Built once by the economy and handed in. */
export interface PeopleBasis {
  workforce: number
  factories: number
  universities: number
  hospitals: number
  buildings: number
  /** Workforce-weighted development of its land, 0 to 1. */
  development: number
  /** Share of its countries not yet settled. */
  occupiedShare: number
  systemLevels: number
  activeProjects: number
}

export interface Demand {
  engineers: number
  scientists: number
  doctors: number
  skilled: number
}

/** Specialists a nation's work needs, as shares of its workforce. A square root, so a dense city-state is not crushed by it. */
export function demandOf(n: Pick<Nation, 'spending'>, b: PeopleBasis): Demand {
  const w = Math.max(0.05, b.workforce)
  return {
    engineers: DEMAND.engineersBase + DEMAND.engineersPerFactory * Math.sqrt(b.factories / w) + DEMAND.engineersPerSystem * b.systemLevels + DEMAND.engineersPerProject * b.activeProjects,
    scientists: DEMAND.scientistsBase + DEMAND.scientistsPerUniversity * Math.sqrt(b.universities / w),
    doctors: DEMAND.doctorsBase + DEMAND.doctorsPerHealth * (n.spending?.health ?? 2) + DEMAND.doctorsPerHospital * Math.sqrt(b.hospitals / w),
    skilled: DEMAND.skilledBase,
  }
}

/** How well each kind of work is staffed: 1 is exactly enough. The focused skill works harder as the schools specialize. */
export function coverageOf(n: Pick<Nation, 'people' | 'programs' | 'techs'>, d: Demand) {
  const p = n.people
  const focus = FOCUSES[n.programs?.focus ?? 'balanced'].skill
  const boost = (k: SkillKey) => (focus === k ? 1 + PEOPLE.specializationBoost * p.specialization : 1)
  const surgery = n.techs?.includes('med_surgery') ? 1 + (MEDICINE.med_surgery.doctorReach ?? 0) : 1
  return {
    engineers: (p.skills.engineers * boost('engineers')) / Math.max(1e-4, d.engineers),
    scientists: (p.skills.scientists * boost('scientists')) / Math.max(1e-4, d.scientists),
    doctors: (p.skills.doctors * boost('doctors') * surgery) / Math.max(1e-4, d.doctors),
    skilled: (p.skills.skilled * boost('skilled')) / Math.max(1e-4, d.skilled),
  }
}

/**
 * What staffing does to a building's output: a small shortfall goes unnoticed, a real one bites down to `min`, and a generous staff
 * lifts it toward `max`. Full staff, and anything up to a fifth more, is exactly 1.
 */
export function coverageMult(c: number, range: { min: number; max: number }): number {
  if (c >= 1.2) return 1 + (range.max - 1) * Math.min(1, (c - 1.2) / 0.6)
  if (c >= 1 - COVERAGE.slack) return 1
  return range.min + (1 - range.min) * Math.max(0, c) / (1 - COVERAGE.slack)
}

/** Where the schools lead each skill, from today's schooling and focus. */
export function skillTargets(n: Pick<Nation, 'people' | 'programs'>): Record<SkillKey, number> {
  const p = n.people
  const focus = n.programs?.focus ?? 'balanced'
  const focusSkill = FOCUSES[focus].skill
  const out = { basic: 0, skilled: 0, engineers: 0, doctors: 0, scientists: 0 } as Record<SkillKey, number>
  // Scientists come only from universities.
  const uni = n.programs?.stage === 'university' ? 1 : n.programs?.stage === 'secondary' ? 0.6 : 0.3
  for (const k of ['skilled', 'engineers', 'doctors', 'scientists'] as const) {
    const t = SKILL_TARGETS[k]
    let v = t.floor + t.perSchooling * p.schooling * (k === 'scientists' ? uni : 1)
    if (focusSkill === k) v *= 1.5
    else if (focusSkill && k !== 'skilled') v *= 0.85
    out[k] = v
  }
  out.basic = Math.max(0.05, 1 - out.skilled - out.engineers - out.doctors - out.scientists)
  return normalize(out)
}

function normalize(sk: Record<SkillKey, number>): Record<SkillKey, number> {
  const total = SKILL_KEYS.reduce((a, k) => a + Math.max(0, sk[k]), 0) || 1
  const out = {} as Record<SkillKey, number>
  for (const k of SKILL_KEYS) out[k] = Math.max(0, sk[k]) / total
  return out
}

/** Health the nation is heading toward: spending, staffed hospitals, housing, medicine, wealth. */
export function healthTarget(n: Nation, b: PeopleBasis, doctorCoverage: number): number {
  const sp = n.spending ?? STANDARD_SPENDING
  const staffed = Math.min(1, doctorCoverage)
  const hospitals = Math.min(PEOPLE.healthHospitalCap, PEOPLE.healthPerHospital * (b.hospitals / Math.max(0.3, b.workforce)) * 10 * staffed)
  let med = 0
  for (const t of n.techs) med += MEDICINE[t]?.health ?? 0
  const program = (n.research2?.medicine ?? 0) * PROGRAM_RULES.health
  const centre = n.projects?.medCentre?.done ? 0.05 : 0
  return clamp(PEOPLE.healthBase + PEOPLE.healthPerLevel * sp.health + hospitals + PEOPLE.healthPerHousing * sp.housing + med + program + centre + 0.2 * b.development, 0, 0.98)
}

/** Schooling the nation is heading toward: the stage sets the ceiling, spending how close it gets. */
export function schoolingTarget(n: Nation): number {
  const stage = STAGES[n.programs?.stage ?? 'secondary']
  const level = clamp(Math.round(n.spending?.schools ?? 2), 0, 4)
  return clamp(stage.cap * PEOPLE.schoolingByLevel[level], 0, 0.98)
}

/** Unemployment the nation is heading toward. */
export function jobsTarget(n: Nation, b: PeopleBasis): number {
  const perW = b.buildings / Math.max(0.3, b.workforce)
  const rate = n.bank?.rate ?? BANKING.neutralRate
  const retrain = (n.spending?.jobless ?? 1) >= 2 ? PEOPLE.jobsRetrain : 0
  const v =
    PEOPLE.jobsBase +
    PEOPLE.jobsPerOccupied * b.occupiedShare +
    PEOPLE.jobsPerUnrest * Math.max(0, 50 - n.stability) +
    PEOPLE.jobsPerRate * (rate - BANKING.neutralRate) -
    PEOPLE.jobsPerBuilding * clamp(perW - 1, -1, 3) -
    retrain
  return clamp(v, PEOPLE.jobsMin, PEOPLE.jobsMax)
}

/** Money each kind of spending costs this month. Public works is priced from the buildings' upkeep. */
export function spendingBill(n: Nation, workforce: number, buildingUpkeep: number) {
  const sp = n.spending ?? STANDARD_SPENDING
  const stage = STAGES[n.programs?.stage ?? 'secondary']
  let pensionCut = 0
  for (const t of n.techs) pensionCut += MEDICINE[t]?.pensionCost ?? 0
  const u = n.people?.unemployment ?? PEOPLE.jobsBase
  const lines = {
    schools: SPENDING_COST.schools * sp.schools * workforce * stage.cost,
    health: SPENDING_COST.health * sp.health * workforce,
    works: buildingUpkeep * (sp.works / 2),
    pensions: SPENDING_COST.pensions * sp.pensions * workforce * Math.max(0.3, 1 + pensionCut),
    jobless: SPENDING_COST.jobless * sp.jobless * u * workforce,
    housing: SPENDING_COST.housing * sp.housing * workforce,
  }
  return { ...lines, people: lines.schools + lines.health + lines.pensions + lines.jobless + lines.housing }
}

/** Stability from the people's lives: health, welfare, unemployment softened by jobless support. */
export function peopleStability(n: Nation): number {
  const p = n.people
  const sp = n.spending ?? STANDARD_SPENDING
  const idle = Math.max(0, p.unemployment - 0.06) * 100 * PEOPLE.joblessAnger * (1 - 0.3 * sp.jobless)
  return (p.health - 0.55) * PEOPLE.healthStability + sp.pensions * PEOPLE.pensionStability + sp.housing * PEOPLE.housingStability - idle - PEOPLE.pensionStability - PEOPLE.housingStability
}

/** Stability a government needs to win an election, after welfare and unemployment. */
export function electionNeed(n: Nation, base: number): number {
  const sp = n.spending ?? STANDARD_SPENDING
  const u = n.people?.unemployment ?? 0.05
  return base - (sp.pensions - 1) * PEOPLE.pensionElection - (sp.housing - 1) * PEOPLE.housingElection + Math.max(0, u - 0.08) * 100
}

export const lifeExpectancy = (health: number) => PEOPLE.lifeBase + PEOPLE.lifeSpan * health

/** Monthly population growth from health, housing, medicine and food. */
export function populationGrowth(n: Nation): number {
  const sp = n.spending ?? STANDARD_SPENDING
  let med = 0
  for (const t of n.techs) med += MEDICINE[t]?.growth ?? 0
  return (
    PEOPLE.growthBase +
    PEOPLE.growthHealth * n.people.health +
    PEOPLE.growthHousing * sp.housing +
    med +
    (n.research2?.medicine ?? 0) * PROGRAM_RULES.growthPop +
    (n.foodShortage ? PEOPLE.growthHunger : 0)
  )
}

/** A nation's people at the start of a game: schooled and healthy as its land is developed, and exactly staffed for what it has built. */
export function startingPeople(n: Nation, b: PeopleBasis): People {
  const schooling = clamp(0.25 + 0.55 * b.development, 0.15, 0.85)
  const people: People = { skills: { basic: 0.6, skilled: 0.3, engineers: 0.04, doctors: 0.02, scientists: 0.02 }, schooling, health: 0.5, unemployment: PEOPLE.jobsBase, specialization: 0, focusSince: 0, epidemic: 0, migration: 0 }
  const shell = { ...n, people } as Nation
  const d = demandOf(shell, b)
  const t = skillTargets(shell)
  const sk = { basic: 0, skilled: Math.max(d.skilled, t.skilled), engineers: d.engineers, doctors: d.doctors, scientists: d.scientists } as Record<SkillKey, number>
  sk.basic = Math.max(0.05, 1 - sk.skilled - sk.engineers - sk.doctors - sk.scientists)
  people.skills = normalize(sk)
  people.health = healthTarget({ ...shell, people } as Nation, b, 1)
  people.unemployment = jobsTarget({ ...shell, people } as Nation, b)
  return people
}

/** One month of the people's lives: schooling, skills, specialization, health and jobs move toward where the nation leads them. */
export function runPeople(s: GameState, n: Nation, b: PeopleBasis) {
  const p = n.people
  const stage = STAGES[n.programs?.stage ?? 'secondary']
  p.schooling = clamp(p.schooling + (schoolingTarget(n) - p.schooling) * PEOPLE.schoolingRate * stage.speed, 0, 0.98)
  const target = skillTargets(n)
  const next = {} as Record<SkillKey, number>
  for (const k of SKILL_KEYS) next[k] = p.skills[k] + (target[k] - p.skills[k]) * PEOPLE.skillRate
  p.skills = normalize(next)
  // Specialization grows in the chosen field, up to what the tier allows; a science park doubles the pace.
  if ((n.programs?.focus ?? 'balanced') !== 'balanced') {
    const months = PEOPLE.specializationMonths / (n.projects?.sciencePark?.done ? 2 : 1)
    p.specialization = Math.min(tierOf(n).specializationCap, p.specialization + 1 / months)
  } else p.specialization = 0
  const d = demandOf(n, b)
  const cov = coverageOf(n, d)
  p.health = clamp(p.health + (healthTarget(n, b, cov.doctors) - p.health) * PEOPLE.healthRate, 0, 0.98)
  p.unemployment = clamp(p.unemployment + (jobsTarget(n, b) - p.unemployment) * PEOPLE.jobsRate, PEOPLE.jobsMin, PEOPLE.jobsMax)
  void s
}

/** How good life is in a nation, for migration: income per worker, health, calm and jobs. */
export function livingStandard(n: Nation, grossPerWorker: number): number {
  return grossPerWorker * (0.5 + n.people.health) * (0.6 + n.stability / 250) * (1 - n.people.unemployment)
}

/**
 * People move toward a better life. Each nation gains or loses a little population each month against the world's median living
 * standard, as its immigration policy allows. Selective immigration brings professionals.
 */
export function runMigration(s: GameState, standards: Map<NationId, number>, median: number) {
  if (median <= 0) return
  for (const [id, ls] of [...standards].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const n = s.nations[id]
    if (!n?.alive) continue
    const policy = IMMIGRATION[n.programs?.immigration ?? 'normal']
    let rate = clamp(((ls - median) / median) * PEOPLE.migrationRate, -PEOPLE.migrationCap, PEOPLE.migrationCap)
    if (rate > 0) rate *= policy.inflow
    n.people.migration = rate
    if (Math.abs(rate) < 1e-7) continue
    for (const r of Object.values(s.regions)) if (r.owner === id) r.population *= 1 + rate
    if (rate > 0 && policy.professionals > 0) {
      // Engineers, doctors and scientists come first.
      const shift = rate * 4
      const sk = n.people.skills
      const take = Math.min(sk.basic, shift)
      sk.basic -= take
      sk.engineers += take * 0.4
      sk.doctors += take * 0.3
      sk.scientists += take * 0.3
    }
  }
}

/** Land changing hands brings its people: the new owner's averages move toward the old owner's, by the land's share of the workforce. */
export function blendPeople(to: Nation, from: Nation | undefined, share: number) {
  if (!from?.people || !to.people || share <= 0) return
  const w = clamp(share, 0, 0.5)
  to.people.schooling += (from.people.schooling - to.people.schooling) * w
  to.people.health += (from.people.health - to.people.health) * w
  const mix = {} as Record<SkillKey, number>
  for (const k of SKILL_KEYS) mix[k] = to.people.skills[k] + (from.people.skills[k] - to.people.skills[k]) * w
  to.people.skills = normalize(mix)
}

/** The workforce-weighted development of a nation's land. */
export function developmentOf(s: GameState, map: WorldMap, id: NationId, weight: (r: RegionState, m: MapRegion) => number): number {
  let sum = 0
  let total = 0
  for (const r of Object.values(s.regions)) {
    if (r.owner !== id) continue
    const m = map.regions[r.id]
    if (!m) continue
    const w = weight(r, m)
    sum += m.development * w
    total += w
  }
  return total > 0 ? sum / total : 0.3
}

/** Clamps a spending plan to the levels each kind allows. */
export function cleanSpending(sp: Partial<Spending> | undefined): Spending {
  const out = { ...STANDARD_SPENDING }
  for (const k of Object.keys(out) as (keyof Spending)[]) {
    const v = sp?.[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(Math.round(v), 0, k === 'pensions' || k === 'jobless' || k === 'housing' ? 2 : 4)
  }
  return out
}
