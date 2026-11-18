import {
  CABINET,
  CIVICS,
  EMPLOYMENT,
  GROUPS,
  GROUPS_RULES,
  GROUP_SPECS,
  IDEOLOGIES,
  IDEOLOGY_SPECS,
  MINISTRIES,
  MINISTRY_SPECS,
  NAME_PARTS,
  PIPELINE,
  POLICY_AREAS,
  POLICY_SPECS,
  PROFESSIONS,
  SECTORS_ORDER,
  SERVICE,
  TALENT,
  type Bill,
  type CivicEffect,
  type CivicsAction,
  type CivicsState,
  type GroupId,
  type Minister,
  type MinistryId,
  type PolicyAreaId,
  type Profession,
  type Sector,
} from '../data/civics'
import { NO_EFFECTS, type PolicyEffects } from '../data/government'
import { DEMAND } from '../data/people'
import { createRng } from './rng'
import { clamp } from './helpers'
import type { GameState, Nation, NationId } from './types'

/**
 * The government desk (data in `data/civics.ts`): talent by profession and who uses it, the cabinet, the civil service, the jobs
 * picture, national policies drafted, voted and phased in, and the interest groups. Everything here is a pure function of the state,
 * except `applyCivics` (an order) and `runCivics` in `civicsMonth.ts` (the month end). A nation without `civics` gets zeros everywhere.
 */

const POLICY_FIELDS = Object.keys(NO_EFFECTS) as (keyof PolicyEffects)[]

/** A fresh, neutral desk: no ministers, a standard civil service, no reforms. Changes nothing on its own. */
export function newCivics(): CivicsState {
  return { cabinet: {}, service: SERVICE.standard, policies: {}, bills: [], nextBill: 1, drain: 0, force: 10, vacantUntil: {}, history: [] }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Repairs a desk from an old save or a damaged file: unknown ministries, areas and options are dropped, numbers held to range. */
export function cleanCivics(c: unknown): CivicsState | undefined {
  if (!c || typeof c !== 'object') return undefined
  const raw = c as Partial<CivicsState>
  const out = newCivics()
  out.service = isNum(raw.service) ? clamp(Math.round(raw.service), 0, SERVICE.levels.length - 1) : SERVICE.standard
  out.nextBill = isNum(raw.nextBill) ? Math.max(1, Math.round(raw.nextBill)) : 1
  out.drain = isNum(raw.drain) ? clamp(raw.drain, 0, TALENT.drainMax) : 0
  out.force = isNum(raw.force) && raw.force > 0 ? raw.force : 10
  for (const id of MINISTRIES) {
    const m = raw.cabinet?.[id]
    if (m && typeof m === 'object' && typeof m.id === 'string' && IDEOLOGIES.includes(m.ideology))
      out.cabinet[id] = {
        id: m.id,
        name: typeof m.name === 'string' ? m.name : 'A minister',
        ministry: id,
        competence: clamp(isNum(m.competence) ? m.competence : 50, 0, 100),
        loyalty: clamp(isNum(m.loyalty) ? m.loyalty : 50, 0, 100),
        ideology: m.ideology,
        corruption: clamp(isNum(m.corruption) ? m.corruption : 0, 0, 100),
        popularity: clamp(isNum(m.popularity) ? m.popularity : 50, 0, 100),
        since: isNum(m.since) ? m.since : 0,
      }
    const v = raw.vacantUntil?.[id]
    if (isNum(v)) out.vacantUntil[id] = v
  }
  for (const area of POLICY_AREAS) {
    const p = raw.policies?.[area]
    if (p && typeof p.option === 'string' && POLICY_SPECS[area].options[p.option] && p.option !== POLICY_SPECS[area].standard)
      out.policies[area] = { option: p.option, phase: clamp(isNum(p.phase) ? p.phase : 1, 0, 1), since: isNum(p.since) ? p.since : 0 }
  }
  for (const b of Array.isArray(raw.bills) ? raw.bills : []) {
    if (!b || !POLICY_AREAS.includes(b.area) || !POLICY_SPECS[b.area].options[b.option] || out.bills.some((x) => x.area === b.area)) continue
    if (out.bills.length >= PIPELINE.maxBills) break
    out.bills.push({
      id: isNum(b.id) ? b.id : out.nextBill++,
      area: b.area,
      option: b.option,
      stage: b.stage === 'vote' ? 'vote' : 'drafting',
      left: clamp(isNum(b.left) ? b.left : 1, 0, 24),
      total: clamp(isNum(b.total) ? b.total : 1, 0.5, 24),
      lobby: clamp(isNum(b.lobby) ? Math.round(b.lobby) : 0, 0, PIPELINE.lobbyMax),
    })
  }
  for (const b of out.bills) out.nextBill = Math.max(out.nextBill, b.id + 1)
  for (const h of Array.isArray(raw.history) ? raw.history.slice(-36) : []) {
    if (h && isNum(h.turn) && isNum(h.force) && isNum(h.unemployment) && Array.isArray(h.sectors) && h.sectors.length === SECTORS_ORDER.length && h.sectors.every(isNum))
      out.history.push({ turn: h.turn, force: h.force, sectors: [...h.sectors], unemployment: h.unemployment })
  }
  return out
}

// ---------------------------------------------------------------- talent

type TalentNation = Pick<Nation, 'people' | 'draftRate' | 'academy' | 'agencies' | 'spending' | 'military' | 'civics' | 'missileProgram'> & Partial<Pick<Nation, 'space'>>

/** Share of the labour force in each profession. Brain drain takes some away; talent visas add some. */
export function talentSupply(n: TalentNation): Record<Profession, number> {
  const sk = n.people?.skills ?? { basic: 0.6, skilled: 0.3, engineers: 0.03, doctors: 0.014, scientists: 0.013 }
  const school = 0.6 + 0.8 * (n.people?.schooling ?? 0.5)
  const ag = (n.agencies?.foreign?.level ?? 0) + (n.agencies?.domestic?.level ?? 0)
  const out: Record<Profession, number> = {
    administrators: sk.skilled * TALENT.ofSkilled.administrators * school,
    economists: sk.skilled * TALENT.ofSkilled.economists * school,
    diplomats: sk.skilled * TALENT.ofSkilled.diplomats * school,
    teachers: sk.skilled * TALENT.ofSkilled.teachers * school,
    engineers: sk.engineers,
    scientists: sk.scientists,
    doctors: sk.doctors,
    officers: TALENT.officers + TALENT.officersPerAcademy * (n.academy ?? 0),
    spies: TALENT.spies * (1 + TALENT.spiesPerAgencyLevel * ag),
  }
  const m = talentMult(n)
  if (m !== 1) for (const p of PROFESSIONS) out[p] *= m
  return out
}

/** Brain drain and talent visas, as one multiplier on the professionals. 1 without a desk. */
export function talentMult(n: Pick<Nation, 'civics'>): number {
  const c = n.civics
  if (!c || !CIVICS.on) return 1
  // Read from the policies directly: the ministers' power depends on the talent, so this must not go through `civicsEffects`.
  let visas = 0
  for (const area of POLICY_AREAS) {
    const p = c.policies[area]
    if (p) visas += (POLICY_SPECS[area].options[p.option]?.effects.talent ?? 0) * p.phase
  }
  return Math.max(0.5, 1 - c.drain + visas)
}

export interface TalentUse {
  label: string
  /** Share of the labour force. */
  share: number
}

/** Who uses each profession, as shares of the labour force, from the state alone. Engineers, scientists and doctors: see `talentReport`. */
export function talentUsers(n: TalentNation): Record<Profession, TalentUse[]> {
  const c = n.civics
  const service = SERVICE.share[c?.service ?? SERVICE.standard]
  const staff = (p: Profession) => {
    let k = 0
    for (const id of MINISTRIES) if (c?.cabinet[id] && MINISTRY_SPECS[id].profession === p) k++
    return k
  }
  // Thousands of people as a share of the labour force the desk last counted (10 million before its first month).
  const lf = Math.max(1, (c?.force ?? 10) * 1000)
  const units = (thousands: number) => thousands / lf
  const divisions = Object.values(n.military?.units ?? {}).reduce((a, b) => a + (b ?? 0), 0)
  const bills = c?.bills.filter((b) => b.stage === 'drafting').length ?? 0
  const fa = n.agencies?.foreign?.level ?? 0
  const da = n.agencies?.domestic?.level ?? 0
  const list = (...xs: [string, number][]) => xs.filter(([, v]) => v > 0).map(([label, share]) => ({ label, share }))
  return {
    administrators: list(['Civil service', service * TALENT.adminPerService], ['Ministry staff', units(staff('administrators') * TALENT.ministryStaff)]),
    economists: list(['Treasury and central bank', TALENT.economistsBase], ['Drafting bills', units(bills * TALENT.economistsPerBill)], ['Ministry staff', units(staff('economists') * TALENT.ministryStaff)]),
    diplomats: list(['Embassies', TALENT.diplomatsBase], ['Foreign agency', TALENT.diplomatsPerAgency * fa], ['Ministry staff', units(staff('diplomats') * TALENT.ministryStaff)]),
    teachers: list(['Schools', TALENT.teachersPerSchools * (n.spending?.schools ?? 2)], ['Ministry staff', units(staff('teachers') * TALENT.ministryStaff)]),
    officers: list(['Divisions', units(divisions * TALENT.officersPerDivision)], ['Academy', units((n.academy ?? 0) * 3)], ['Ministry staff', units(staff('officers') * TALENT.ministryStaff)]),
    spies: list(['Foreign agency', TALENT.spiesPerAgency * fa], ['Domestic agency', TALENT.spiesPerAgency * da]),
    // These three are counted by the people model (see `talentReport`): only the ministries' own staff is added here.
    engineers: list(['Ministry staff', units(staff('engineers') * TALENT.ministryStaff)]),
    scientists: list(['Ministry staff', units(staff('scientists') * TALENT.ministryStaff)]),
    doctors: list(['Ministry staff', units(staff('doctors') * TALENT.ministryStaff)]),
  }
}

/** How well each profession the desk counts itself is staffed: 1 is exactly enough. Engineers, scientists and doctors count as 1 here (the economy already feels their shortage). */
export function professionCoverage(n: TalentNation): Record<Profession, number> {
  const supply = talentSupply(n)
  const users = talentUsers(n)
  const out = {} as Record<Profession, number>
  for (const p of PROFESSIONS) {
    if (p === 'engineers' || p === 'scientists' || p === 'doctors') {
      out[p] = 1
      continue
    }
    const demand = users[p].reduce((a, u) => a + u.share, 0)
    out[p] = demand > 0 ? supply[p] / demand : 2
  }
  return out
}

/** Engineers the missile program draws from the factories, as a share of the workforce. Only with the desk, which counts it. */
export const missileEngineerDraw = (n: Pick<Nation, 'civics' | 'missileProgram'>): number => (n.civics && CIVICS.on ? (n.missileProgram ?? 0) * TALENT.missileEngineers : 0)

export interface TalentRow {
  profession: Profession
  /** Thousands of people. */
  pool: number
  demand: number
  users: { label: string; amount: number }[]
  coverage: number
}

/** The economy's view the talent report needs. */
export interface TalentEcon {
  population: number
  basis: { workforce: number; factories: number; universities: number; hospitals: number; systemLevels: number; activeProjects: number; extraEngineers?: number }
  demand: { engineers: number; scientists: number; doctors: number }
  coverage: { engineers: number; scientists: number; doctors: number }
}

/** The talent pool in thousands of people, who uses it and how well each kind of work is staffed. */
export function talentReport(n: TalentNation, e: TalentEcon): TalentRow[] {
  const lf = e.population * TALENT.participation * 1000
  const supply = talentSupply(n)
  const users = talentUsers(n)
  const w = Math.max(0.05, e.basis.workforce)
  const space = n.space ? Math.max(0, (e.basis.extraEngineers ?? 0) - missileEngineerDraw(n)) : 0
  // The people model's demand, split into who asks for it. It sums to `e.demand` exactly.
  const engineers: [string, number][] = [
    ['Industry and building', DEMAND.engineersBase + DEMAND.engineersPerFactory * Math.sqrt(e.basis.factories / w)],
    ['Frontier systems', DEMAND.engineersPerSystem * e.basis.systemLevels],
    ['National projects', DEMAND.engineersPerProject * e.basis.activeProjects],
    ['Space agency', space],
    ['Missile program', missileEngineerDraw(n)],
  ]
  const scientists: [string, number][] = [
    ['Labs and industry', DEMAND.scientistsBase],
    ['Universities', DEMAND.scientistsPerUniversity * Math.sqrt(e.basis.universities / w)],
  ]
  const doctors: [string, number][] = [
    ['Health care', DEMAND.doctorsBase + DEMAND.doctorsPerHealth * (n.spending?.health ?? 2)],
    ['Hospitals', DEMAND.doctorsPerHospital * Math.sqrt(e.basis.hospitals / w)],
  ]
  // Space staff work in labs too: the agency's scientists show beside the universities.
  if (n.space) scientists.push(['Space agency', ((n.space.engineers + n.space.astronauts) / Math.max(1, lf)) * 0.3])
  const fromEngine: Partial<Record<Profession, [string, number][]>> = { engineers, scientists, doctors }
  return PROFESSIONS.map((p) => {
    const parts: { label: string; amount: number }[] = []
    const own = fromEngine[p]
    if (own) for (const [label, share] of own) if (share > 0) parts.push({ label, amount: share * lf })
    for (const u of users[p]) parts.push({ label: u.label, amount: u.share * lf })
    const pool = supply[p] * lf
    const demand = parts.reduce((a, u) => a + u.amount, 0)
    const coverage = p === 'engineers' || p === 'scientists' || p === 'doctors' ? e.coverage[p] : demand > 0 ? pool / demand : 2
    return { profession: p, pool, demand, users: parts.sort((a, b) => b.amount - a.amount), coverage }
  })
}

// ---------------------------------------------------------------- cabinet

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The draw of candidates this month belongs to: a new list every `regenMonths`. */
export const candidateEpoch = (turn: number) => Math.floor(Math.max(0, turn) / CABINET.regenMonths)

/** Months until a new list of candidates is drawn. */
export const monthsToNewCandidates = (turn: number) => CABINET.regenMonths - (Math.max(0, turn) % CABINET.regenMonths)

/**
 * The candidates for a ministry this year. Drawn from the game's seed, the nation and the ministry alone, so every client of an online
 * game sees exactly the same people and nothing about them is stored until one is appointed. Competence follows how well the ministry's
 * profession is staffed.
 */
export function candidatesFor(s: Pick<GameState, 'seed' | 'turn'>, n: Pick<Nation, 'id'> & TalentNation, ministry: MinistryId): Minister[] {
  const epoch = candidateEpoch(s.turn)
  const rng = createRng((s.seed ^ 0x6c1c5) >>> 0, hashString(`${n.id}|${ministry}|${epoch}`))
  const cov = professionCoverage(n)[MINISTRY_SPECS[ministry].profession]
  const lift = clamp((cov - 1) * 10 * CABINET.competencePerCoverage, -10, 10)
  const anti = n.civics?.policies.antiCorruption
  const clean = anti && anti.phase >= 1 ? (anti.option === 'purge' ? 0.4 : 0.7) : 1
  const out: Minister[] = []
  for (let i = 0; i < CABINET.candidates; i++) {
    const r = (range: [number, number]) => Math.round(range[0] + rng.next() * (range[1] - range[0]))
    out.push({
      id: `${ministry}-${epoch}-${i}`,
      name: `${rng.pick(NAME_PARTS.first)} ${rng.pick(NAME_PARTS.last)}`,
      ministry,
      competence: clamp(r(CABINET.competence) + Math.round(lift), 5, 99),
      loyalty: r(CABINET.loyalty),
      ideology: rng.pick(IDEOLOGIES),
      corruption: Math.round(r(CABINET.corruption) * clean),
      popularity: r(CABINET.popularity),
      since: s.turn,
    })
  }
  return out
}

/** People in a nation, in millions: what salaries are scaled by. */
export function nationPopulation(s: Pick<GameState, 'regions'>, id: NationId): number {
  let pop = 0
  for (const r of Object.values(s.regions)) if (r.owner === id) pop += r.population
  return pop
}

/** A minister's salary a month: more for a bigger nation and a better minister. */
export const salaryOf = (m: Pick<Minister, 'competence'>, population: number) => CABINET.salaryFloor + CABINET.salaryPerPop * Math.sqrt(Math.max(0, population) / 10) * (0.5 + m.competence / 100)

/** What a minister delivers, 0 to 1: competence, times how well their ministry is staffed. */
export function ministerPower(n: TalentNation, m: Minister, cov?: Record<Profession, number>): number {
  const c = (cov ?? professionCoverage(n))[MINISTRY_SPECS[m.ministry].profession]
  return (m.competence / 100) * clamp(c, 0.4, 1)
}

// ---------------------------------------------------------------- effects

export interface CivicsReport {
  /** Output, research, upkeep and the rest, to add to the government's and laws'. Stability and money are left out: see below. */
  policy: PolicyEffects
  /** Stability from the desk, with its causes. */
  stability: number
  parts: { label: string; value: number }[]
  jobs: number
  health: number
  schooling: number
  admin: number
  /** Share of gross income gained (or lost) on the Government money line. */
  treasury: number
  /** Share by which the talent pool grows. */
  talent: number
  /** Each interest group's feeling from what the government chose, before the cap. */
  groups: Record<GroupId, number>
}

const ZERO_GROUPS = (): Record<GroupId, number> => ({ business: 0, labour: 0, military: 0, faithful: 0, regions: 0 })

const NONE: CivicsReport = Object.freeze({ policy: Object.freeze({ ...NO_EFFECTS }) as PolicyEffects, stability: 0, parts: [], jobs: 0, health: 0, schooling: 0, admin: 0, treasury: 0, talent: 0, groups: Object.freeze(ZERO_GROUPS()) }) as CivicsReport

/** Everything the desk does to a nation. A nation without one (or with the layer off) gets the same zeros every time. */
export function civicsEffects(n: Pick<Nation, 'civics'> & Partial<TalentNation> & Partial<Pick<Nation, 'government'>>): CivicsReport {
  const c = n.civics
  if (!c || !CIVICS.on) return NONE
  const policy: PolicyEffects = { ...NO_EFFECTS }
  const out: CivicsReport = { policy, stability: 0, parts: [], jobs: 0, health: 0, schooling: 0, admin: 0, treasury: 0, talent: 0, groups: ZERO_GROUPS() }
  let ministers = 0
  let reforms = 0
  const add = (e: CivicEffect, power: number) => {
    for (const k of POLICY_FIELDS) if (k !== 'stability' && k !== 'money') policy[k] += (e[k] ?? 0) * power
    out.jobs += (e.jobs ?? 0) * power
    out.health += (e.health ?? 0) * power
    out.schooling += (e.schooling ?? 0) * power
    out.admin += (e.admin ?? 0) * power
    out.treasury += ((e.treasury ?? 0) + (e.money ?? 0)) * power
    out.talent += (e.talent ?? 0) * power
    return (e.stability ?? 0) * power
  }
  // Talent visas feed the coverage the ministers are judged by, so they are counted first, without the ministers.
  const cov = professionCoverage(n as TalentNation)
  const anti = c.policies.antiCorruption
  const waste = anti ? (anti.option === 'purge' ? 0.2 : anti.option === 'agency' ? 0.5 : 1) * anti.phase + (1 - anti.phase) : 1
  for (const id of MINISTRIES) {
    const m = c.cabinet[id]
    if (!m) continue
    ministers += add(MINISTRY_SPECS[id].effects, ministerPower(n as TalentNation, m, cov))
    out.treasury -= (m.corruption / 100) * CABINET.wastePerCorruption * waste
    const g = IDEOLOGY_SPECS[m.ideology].groups
    for (const k of GROUPS) out.groups[k] += g[k] ?? 0
  }
  // The civil service: its jobs and output in full, its services and capacity as far as administrators can staff it.
  const lvl = clamp(Math.round(c.service), 0, SERVICE.levels.length - 1)
  const adminCov = clamp(cov.administrators, 0.4, 1)
  out.jobs += SERVICE.jobs[lvl]
  policy.output += SERVICE.output[lvl]
  out.admin += SERVICE.admin[lvl] * (SERVICE.admin[lvl] > 0 ? adminCov : 1)
  const service = SERVICE.stability[lvl] * (SERVICE.stability[lvl] > 0 ? adminCov : 1)
  for (const k of GROUPS) out.groups[k] += SERVICE.groups[lvl][k] ?? 0
  for (const area of POLICY_AREAS) {
    const p = c.policies[area]
    if (!p) continue
    const spec = POLICY_SPECS[area].options[p.option]
    if (!spec) continue
    reforms += add(spec.effects, p.phase)
    for (const k of GROUPS) out.groups[k] += (spec.groups[k] ?? 0) * p.phase
  }
  // What the groups feel about the government's choices moves stability a little, weighted by who counts under this government.
  const weights = GROUPS_RULES.weight[n.government ?? 'monarchy'] ?? GROUPS_RULES.weight.monarchy
  let groups = 0
  for (const k of GROUPS) groups += clamp(out.groups[k], -GROUPS_RULES.choiceCap, GROUPS_RULES.choiceCap) * weights[k] * GROUPS_RULES.stabilityPerPoint
  out.parts = [
    { label: 'Ministers', value: ministers },
    { label: 'Civil service', value: service },
    { label: 'Reforms', value: reforms },
    { label: 'Interest groups', value: groups },
  ].filter((x) => Math.abs(x.value) > 1e-9)
  out.stability = ministers + service + reforms + groups
  return out
}

/** What the desk costs and earns a month: salaries, the civil service against the standard, and the government's own money line. */
export function civicsMoney(n: Pick<Nation, 'civics'> & Partial<TalentNation> & Partial<Pick<Nation, 'government'>>, population: number, workforce: number, gross: number) {
  const c = n.civics
  if (!c || !CIVICS.on) return { salaries: 0, service: 0, treasury: 0 }
  let salaries = 0
  for (const id of MINISTRIES) {
    const m = c.cabinet[id]
    if (m) salaries += salaryOf(m, population)
  }
  return { salaries, service: SERVICE.cost[clamp(Math.round(c.service), 0, SERVICE.levels.length - 1)] * workforce, treasury: civicsEffects(n).treasury * Math.max(0, gross) }
}

/** Opinion of every other nation from this one's foreign minister. */
export function foreignMinisterOpinion(n: Nation | undefined): number {
  const m = n?.civics?.cabinet.foreign
  if (!m || !CIVICS.on) return 0
  return CABINET.foreignOpinion * ministerPower(n, m)
}

// ---------------------------------------------------------------- interest groups and votes

export interface GroupRow {
  id: GroupId
  /** From choices: ministers, policies, the civil service (capped). */
  choice: number
  /** From the times: taxes, unemployment, war, unrest. */
  mood: number
  /** 0 to 100. */
  satisfaction: number
  weight: number
}

/** How each interest group feels, and the government's approval: their weighted satisfaction, plus popular ministers. */
export function groupReport(s: Pick<GameState, 'regions' | 'wars'>, n: Nation): { groups: GroupRow[]; approval: number } {
  const eff = civicsEffects(n)
  const R = GROUPS_RULES.mood
  const weights = GROUPS_RULES.weight[n.government] ?? GROUPS_RULES.weight.monarchy
  let occupied = 0
  for (const r of Object.values(s.regions)) if (r.owner === n.id && r.integration < 1) occupied++
  const atWar = s.wars.some((k) => k.split('|').includes(n.id))
  const mood: Record<GroupId, number> = {
    business: R.businessCorpTax * Math.max(0, (n.corporateTax - 0.15) * 100) + R.businessTax * Math.max(0, (n.taxRate - 0.25) * 100),
    labour: R.labourJobless * Math.max(0, ((n.people?.unemployment ?? 0.05) - 0.06) * 100),
    military: (atWar ? R.militaryWar : 0) + R.militaryWeariness * n.warWeariness,
    faithful: R.faithfulStability * (n.stability - 50),
    regions: R.regionsOccupied * occupied,
  }
  let sum = 0
  let wsum = 0
  const groups = GROUPS.map((id) => {
    const choice = clamp(eff.groups[id], -GROUPS_RULES.choiceCap, GROUPS_RULES.choiceCap)
    const satisfaction = clamp(50 + choice * 1.5 + mood[id], 0, 100)
    sum += satisfaction * weights[id]
    wsum += weights[id]
    return { id, choice, mood: mood[id], satisfaction, weight: weights[id] }
  })
  let pop = 0
  for (const id of MINISTRIES) {
    const m = n.civics?.cabinet[id]
    if (m) pop += (m.popularity - 50) * 0.04
  }
  return { groups, approval: clamp(sum / wsum + pop, 0, 100) }
}

/** How the groups, weighted, feel about one option: -1 to 1. */
export function optionSupport(n: Pick<Nation, 'government'>, area: PolicyAreaId, option: string): number {
  const spec = POLICY_SPECS[area].options[option]
  if (!spec) return 0
  const weights = GROUPS_RULES.weight[n.government] ?? GROUPS_RULES.weight.monarchy
  let sum = 0
  let wsum = 0
  for (const k of GROUPS) {
    sum += (spec.groups[k] ?? 0) * weights[k]
    wsum += weights[k]
  }
  return clamp(sum / (wsum * 4), -1, 1)
}

/** Chance a bill passes its vote now: the government's base, approval, stability, the groups' feelings and lobbying. */
export function passChance(s: Pick<GameState, 'regions' | 'wars'>, n: Nation, bill: Pick<Bill, 'area' | 'option' | 'lobby'>): number {
  const { approval } = groupReport(s, n)
  const base = PIPELINE.base[n.government] ?? 0.6
  return clamp(
    base + (approval - 50) * PIPELINE.perApproval + (n.stability - 50) * PIPELINE.perStability + optionSupport(n, bill.area, bill.option) * PIPELINE.support + bill.lobby * PIPELINE.lobbyChance,
    PIPELINE.min,
    PIPELINE.max,
  )
}

/** Months of drafting work a ministry does in one month: faster with a good minister and enough economists. */
export function draftSpeed(n: TalentNation & Pick<Nation, 'civics'>, area: PolicyAreaId): number {
  const m = n.civics?.cabinet[POLICY_SPECS[area].ministry]
  const cov = professionCoverage(n)
  return (1 + (m ? ministerPower(n, m, cov) * PIPELINE.ministerSpeed : 0)) * clamp(cov.economists, PIPELINE.staffMin, PIPELINE.staffMax)
}

/** The option an area has now: the one in force, or the standard. */
export const currentOption = (n: Pick<Nation, 'civics'>, area: PolicyAreaId) => n.civics?.policies[area]?.option ?? POLICY_SPECS[area].standard

// ---------------------------------------------------------------- jobs

export interface Employment {
  /** Millions of people. */
  force: number
  employed: number
  unemployed: number
  rate: number
  sectors: Record<Sector, number>
}

/** The jobs picture from the economy's numbers: the labour force, who works where and who is out of work. */
export function employmentOf(n: Pick<Nation, 'people' | 'civics' | 'space'>, e: { population: number; divisions: number; basis: { workforce: number; factories: number; development: number }; buildings: { farm: number } }): Employment {
  const force = e.population * TALENT.participation
  const rate = clamp(n.people?.unemployment ?? 0.05, 0, 1)
  const unemployed = force * rate
  const employed = force - unemployed
  const E = EMPLOYMENT
  const w = Math.max(0.3, e.basis.workforce)
  const military = Math.min(employed * 0.15, (e.divisions * E.perDivision) / 1000)
  const pub = Math.min(employed * 0.4, force * SERVICE.share[n.civics?.service ?? SERVICE.standard])
  const research = Math.min(employed * 0.1, force * (n.people?.skills.scientists ?? 0.013) * E.researchShare + (n.space ? (n.space.engineers + n.space.astronauts) / 1000 : 0))
  const privateJobs = Math.max(0, employed - military - pub - research)
  const farm = clamp(E.farmBase + E.farmPerDevelopment * e.basis.development + (E.farmPerFarm * e.buildings.farm) / w, E.farmMin, E.farmMax)
  const industry = clamp(E.industryBase + (E.industryPerFactory * e.basis.factories) / w, 0, E.industryMax)
  const services = Math.max(0, 1 - farm - industry)
  const t = farm + industry + services
  return {
    force,
    employed,
    unemployed,
    rate,
    sectors: { agriculture: (privateJobs * farm) / t, industry: (privateJobs * industry) / t, services: (privateJobs * services) / t, public: pub, military, research },
  }
}

// ---------------------------------------------------------------- orders

/** Influence a draft costs. */
export const draftCost = (area: PolicyAreaId) => POLICY_SPECS[area].cost

export interface CivicsCost {
  capital: number
  pp: number
}

/** What a desk order costs: a signing fee for a minister, influence for a draft or a round of lobbying. */
export function civicsCost(s: GameState, n: Nation, a: CivicsAction): CivicsCost {
  if (!a || typeof a !== 'object') return { capital: 0, pp: 0 }
  switch (a.kind) {
    case 'appoint': {
      const m = MINISTRIES.includes(a.ministry) ? candidatesFor(s, n, a.ministry).find((x) => x.id === a.candidate) : undefined
      return { capital: m ? Math.round(salaryOf(m, nationPopulation(s, n.id)) * CABINET.signing * 10) / 10 : 0, pp: 0 }
    }
    case 'draft':
      return { capital: 0, pp: POLICY_AREAS.includes(a.area) ? draftCost(a.area) : 0 }
    case 'lobby':
      return { capital: 0, pp: PIPELINE.lobbyCost }
    default:
      return { capital: 0, pp: 0 }
  }
}

/** Stability a dismissal costs: more for a popular minister. */
export const dismissCost = (m: Pick<Minister, 'popularity'>) => CABINET.fireStability + Math.max(0, (m.popularity - 50) / 10) * CABINET.firePerPopularity

/** Why a desk order cannot be given now, or null. */
export function civicsProblem(s: GameState, n: Nation, a: CivicsAction): string | null {
  if (!CIVICS.on) return 'The government desk is switched off'
  if (!a || typeof a !== 'object') return 'Nothing to do'
  const c = n.civics
  const cost = civicsCost(s, n, a)
  switch (a.kind) {
    case 'appoint': {
      if (!MINISTRIES.includes(a.ministry)) return 'No such ministry'
      if ((c?.vacantUntil[a.ministry] ?? -1) > s.turn) return 'The ministry is being reorganized until next month'
      const m = candidatesFor(s, n, a.ministry).find((x) => x.id === a.candidate)
      if (!m) return 'That candidate is no longer available'
      if (c?.cabinet[a.ministry]?.id === m.id) return 'Already the minister'
      if (n.resources.capital < cost.capital) return `Needs ${cost.capital} money for the first months' salary`
      return null
    }
    case 'dismiss':
      if (!MINISTRIES.includes(a.ministry)) return 'No such ministry'
      if (!c?.cabinet[a.ministry]) return 'Nobody holds that ministry'
      return null
    case 'service':
      if (!Number.isInteger(a.level) || a.level < 0 || a.level >= SERVICE.levels.length) return 'No such size'
      if ((c?.service ?? SERVICE.standard) === a.level) return 'Already that size'
      return null
    case 'draft': {
      if (!POLICY_AREAS.includes(a.area)) return 'No such policy'
      const spec = POLICY_SPECS[a.area]
      if (typeof a.option !== 'string' || !Object.prototype.hasOwnProperty.call(spec.options, a.option)) return 'No such option'
      if (currentOption(n, a.area) === a.option) return 'Already the policy'
      if (c?.bills.some((b) => b.area === a.area)) return 'A bill on this is already in the pipeline'
      if ((c?.bills.length ?? 0) >= PIPELINE.maxBills) return `At most ${PIPELINE.maxBills} bills at once`
      if (n.resources.pp < cost.pp) return `Needs ${cost.pp} influence`
      return null
    }
    case 'lobby': {
      const b = c?.bills.find((x) => x.id === a.bill)
      if (!b) return 'No such bill'
      if (b.lobby >= PIPELINE.lobbyMax) return 'Lobbied as hard as it can be'
      if (n.resources.pp < cost.pp) return `Needs ${cost.pp} influence`
      return null
    }
    case 'withdraw':
      if (!c?.bills.some((x) => x.id === a.bill)) return 'No such bill'
      return null
    default:
      return 'Nothing to do'
  }
}

function note(s: GameState, n: Nation, text: string) {
  if (!n.isPlayer && !s.humans?.includes(n.id)) return
  s.log.push(s.day === undefined ? { turn: s.turn, kind: 'economy', text, nations: [n.id] } : { turn: s.turn, day: s.day, kind: 'economy', text, nations: [n.id] })
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300)
}

/** Carries out a desk order (already checked and paid for). The desk is made the first time it is needed. */
export function applyCivics(s: GameState, n: Nation, a: CivicsAction) {
  const c = (n.civics ??= newCivics())
  switch (a.kind) {
    case 'appoint': {
      const m = candidatesFor(s, n, a.ministry).find((x) => x.id === a.candidate)
      if (!m) return
      const old = c.cabinet[a.ministry]
      if (old) n.stability = clamp(n.stability - dismissCost(old), 0, 100)
      c.cabinet[a.ministry] = { ...m, since: s.turn }
      note(s, n, `${m.name} is the new ${MINISTRY_SPECS[a.ministry].title}${old ? `, replacing ${old.name}` : ''}.`)
      break
    }
    case 'dismiss': {
      const old = c.cabinet[a.ministry]
      if (!old) return
      delete c.cabinet[a.ministry]
      n.stability = clamp(n.stability - dismissCost(old), 0, 100)
      c.vacantUntil[a.ministry] = s.turn + CABINET.vacancyMonths
      note(s, n, `${old.name} was dismissed as ${MINISTRY_SPECS[a.ministry].title}.`)
      break
    }
    case 'service':
      c.service = a.level
      note(s, n, `The civil service will be ${SERVICE.levels[a.level].toLowerCase()}.`)
      break
    case 'draft': {
      const spec = POLICY_SPECS[a.area]
      const total = spec.draftMonths
      c.bills.push({ id: c.nextBill++, area: a.area, option: a.option, stage: 'drafting', left: total, total, lobby: 0 })
      note(s, n, `Drafting began: ${spec.name}, ${spec.options[a.option].name.toLowerCase()}.`)
      break
    }
    case 'lobby': {
      const b = c.bills.find((x) => x.id === a.bill)
      if (b) b.lobby++
      break
    }
    case 'withdraw':
      c.bills = c.bills.filter((x) => x.id !== a.bill)
      break
  }
}

/** One line for the order list and the log. */
export function describeCivics(s: GameState, a: CivicsAction): string {
  switch (a?.kind) {
    case 'appoint':
      return `Appoint a ${MINISTRY_SPECS[a.ministry]?.title ?? 'minister'}`
    case 'dismiss':
      return `Dismiss the ${MINISTRY_SPECS[a.ministry]?.title ?? 'minister'}`
    case 'service':
      return `Civil service: ${SERVICE.levels[a.level] ?? a.level}`
    case 'draft':
      return `Draft ${POLICY_SPECS[a.area]?.name.toLowerCase() ?? 'a policy'}: ${POLICY_SPECS[a.area]?.options[a.option]?.name.toLowerCase() ?? a.option}`
    case 'lobby':
      return 'Lobby for a bill'
    case 'withdraw':
      return 'Withdraw a bill'
    default:
      void s
      return 'A government order'
  }
}

export { GROUP_SPECS }
