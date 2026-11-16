import { LOCAL, LOCAL_FIELDS, LOCAL_IDS, NO_LOCAL, NEED_TEXT, SCALED_YIELDS, type LocalYield } from '../data/localProjects'
import { OIL_DEPOSITS, STEEL_DEPOSITS } from '../data/deposits'
import { PROJECT_LEVELS, PROJECT_RULES, PROJECTS } from '../data/projects'
import { tierGate, tierOf } from './empire'
import { levelMonths, monthlyCost, projectLevel, projectSpeed } from './industry'
import { addLog } from './helpers'
import type { GameState, LocalProjectId, MapRegion, Nation, NationId, ProjectId, ProjectState, RegionId, RegionState, Tier, WorldMap } from './types'

/** Rushing a project: pay this many months of its cost to bring it this many months closer. The extra is real, but a shorter build also saves bills. */
export const RUSH = { cost: 4, months: 2 }

// ---- Levels, costs and time ----

export const localLevel = (r: RegionState | undefined, id: LocalProjectId): number => {
  const p = r?.works?.[id]
  return !p ? 0 : (p.level ?? (p.done ? 1 : 0))
}
export const localPower = (r: RegionState | undefined, id: LocalProjectId) => PROJECT_LEVELS.power[localLevel(r, id)]
/**
 * Big countries cost more to build in and give more back, on the same curve as their workforce, so a project returns much the same
 * wherever it is built. A country of middling size is 1.
 */
export const localScale = (r: RegionState) => Math.min(4, Math.max(0.5, Math.pow(Math.max(0.05, r.population), 0.6) / 12))
export const localCost = (id: LocalProjectId, level: number, r: RegionState) => Math.round(LOCAL[id].cost * PROJECT_LEVELS.cost[level] * localScale(r))
export const localMonths = (id: LocalProjectId, level: number) => Math.round(LOCAL[id].months * PROJECT_LEVELS.months[level])
export const localMonthly = (id: LocalProjectId, level: number, r: RegionState) => localCost(id, level, r) / localMonths(id, level)
export const localInvested = (id: LocalProjectId, level: number, r: RegionState) => {
  let total = 0
  for (let l = 1; l <= level; l++) total += localCost(id, l, r)
  return total
}
const localTier = (id: LocalProjectId, level: number): Tier => (level >= 3 ? (Math.max(2, LOCAL[id].tier) as Tier) : LOCAL[id].tier)

/** Projects with work under way in the countries a nation holds. */
export function activeLocal(s: GameState, nationId: NationId): { regionId: RegionId; id: LocalProjectId }[] {
  const out: { regionId: RegionId; id: LocalProjectId }[] = []
  for (const r of Object.values(s.regions)) {
    if (r.owner !== nationId || !r.works) continue
    for (const id of LOCAL_IDS) if (r.works[id] && !r.works[id]!.done) out.push({ regionId: r.id, id })
  }
  return out
}

/** Every project built or under way in the countries a nation holds. */
export function localCount(s: GameState, nationId: NationId): number {
  let n = 0
  for (const r of Object.values(s.regions)) if (r.owner === nationId && r.works) n += Object.keys(r.works).length
  return n
}

// ---- What a country has ----

/** Whether the country has what a project needs, or what it lacks. */
export function localNeed(map: WorldMap, r: RegionState, id: LocalProjectId): string | null {
  const need = LOCAL[id].needs
  const mr = map.regions[r.id]
  if (!need || !mr) return null
  const ok =
    need === 'university' ? r.buildings.university > 0
    : need === 'port' ? r.buildings.port > 0
    : need === 'coast' ? mr.coastal
    : need === 'deposit' ? (OIL_DEPOSITS[r.id] ?? 0) + (STEEL_DEPOSITS[r.id] ?? 0) > 0
    : mr.terrain === 'mountain' || mr.terrain === 'forest'
  return ok ? null : `Needs ${NEED_TEXT[need]}`
}

/** Why a project cannot be started (or upgraded) in a country, or null. */
export function localProblem(s: GameState, map: WorldMap, n: Nation, id: LocalProjectId, regionId: RegionId | undefined): string | null {
  const spec = LOCAL[id]
  if (!spec) return 'Unknown project'
  const r = regionId ? s.regions[regionId] : undefined
  if (!r || r.owner !== n.id) return 'You do not hold that country'
  const have = r.works?.[id]
  if (have && !have.done) return 'Already under way'
  const level = localLevel(r, id) + 1
  if (level > PROJECT_LEVELS.max) return 'Already built to its highest level'
  const gate = tierGate(s, n.id, localTier(id, level))
  if (gate) return gate
  const lacks = localNeed(map, r, id)
  if (lacks) return lacks
  const slots = tierOf(n).localSlots
  if (activeLocal(s, n.id).length >= slots) return `A ${tierOf(n).name} can build ${slots} project${slots === 1 ? '' : 's'} in its countries at once`
  return null
}

export function startLocal(s: GameState, n: Nation, id: LocalProjectId, regionId: RegionId) {
  const r = s.regions[regionId]
  const have = r.works?.[id]
  if (have?.done) {
    have.level = localLevel(r, id)
    have.done = false
    have.progress = 0
    have.by = n.id
    delete have.paused
    return
  }
  ;(r.works ??= {})[id] = { progress: 0, done: false, by: n.id }
}

/** Money the countries' projects cost this month: those being built (unless paused), and the upkeep of every level built. */
export function localBill(s: GameState, nationId: NationId): { building: number; upkeep: number } {
  let building = 0
  let upkeep = 0
  for (const r of Object.values(s.regions)) {
    if (r.owner !== nationId || !r.works) continue
    for (const id of LOCAL_IDS) {
      const p = r.works[id]
      if (!p) continue
      const built = localLevel(r, id)
      if (built > 0) upkeep += localInvested(id, built, r) * PROJECT_RULES.maintenance
      if (!p.done && !p.paused && (p.by === undefined || p.by === nationId)) building += localMonthly(id, built + 1, r)
    }
  }
  return { building, upkeep }
}

/**
 * A month of work on every project in the nation's countries, at the pace the engineers allow. A project begun by an earlier owner and
 * not finished is dropped when the land changes hands. Returns the money to give back for months the treasury could not pay.
 */
export function runLocalProjects(s: GameState, n: Nation, speed: number): number {
  let refund = 0
  for (const r of Object.values(s.regions)) {
    if (r.owner !== n.id || !r.works) continue
    for (const id of LOCAL_IDS) {
      const p = r.works[id]
      if (!p || p.done) continue
      if (p.by !== undefined && p.by !== n.id) {
        // Left half built by the country's last owner.
        if (localLevel(r, id) === 0) delete r.works[id]
        else {
          p.done = true
          delete p.paused
        }
        continue
      }
      if (p.paused) continue
      const level = localLevel(r, id) + 1
      const months = localMonths(id, level)
      if (n.resources.capital < 0) {
        refund += localMonthly(id, level, r)
        continue
      }
      p.progress = Math.min(months, p.progress + speed)
      if (p.progress >= months - 1e-9) {
        p.done = true
        if (level >= 2) p.level = level
        if (n.isPlayer) addLog(s, 'economy', `${LOCAL[id].name}${level >= 2 ? ` (level ${level})` : ''} finished in ${r.id}.`, [n.id])
      }
    }
    if (Object.keys(r.works).length === 0) delete r.works
  }
  return refund
}

// ---- What they do ----

const ZERO = Object.freeze({ ...NO_LOCAL }) as LocalYield

/** What the projects in one country add, scaled by their levels. A country with none gets the same zeros every time. */
export function localEffects(r: RegionState, mr: MapRegion | undefined): LocalYield {
  if (!r.works) return ZERO
  const out: LocalYield = { ...NO_LOCAL }
  let any = false
  for (const id of LOCAL_IDS) {
    const level = localLevel(r, id)
    if (level < 1) continue
    any = true
    const power = PROJECT_LEVELS.power[level]
    const spec = LOCAL[id]
    const scale = localScale(r)
    for (const k of LOCAL_FIELDS) out[k] += (spec.yields[k] ?? 0) * power * (SCALED_YIELDS.includes(k) ? scale : 1)
    if (spec.perDevelopment) out.money += spec.perDevelopment * (mr?.development ?? 0.5) * power * scale
  }
  return any ? out : ZERO
}

// ---- Rushing ----

type Ref = { id: ProjectId | LocalProjectId; regionId?: RegionId }

function stateOf(s: GameState, n: Nation, ref: Ref): ProjectState | undefined {
  if (ref.id in LOCAL) return ref.regionId ? s.regions[ref.regionId]?.works?.[ref.id as LocalProjectId] : undefined
  return n.projects?.[ref.id as ProjectId]
}

/** The level a project is working on, and what it costs a month. */
function building(s: GameState, n: Nation, ref: Ref): { level: number; months: number; monthly: number } {
  if (ref.id in LOCAL) {
    const id = ref.id as LocalProjectId
    const level = localLevel(s.regions[ref.regionId!], id) + 1
    return { level, months: localMonths(id, level), monthly: localMonthly(id, level, s.regions[ref.regionId!]) }
  }
  const id = ref.id as ProjectId
  const level = projectLevel(n, id) + 1
  return { level, months: levelMonths(id, level), monthly: monthlyCost(id, level) }
}

/** Money a rush costs. */
export function rushCost(s: GameState, n: Nation, id: ProjectId | LocalProjectId, regionId?: RegionId): number {
  if (!stateOf(s, n, { id, regionId })) return 0
  return Math.round(RUSH.cost * building(s, n, { id, regionId }).monthly)
}

export function rushProblem(s: GameState, n: Nation, id: ProjectId | LocalProjectId, regionId?: RegionId): string | null {
  if (id in LOCAL && (!regionId || s.regions[regionId]?.owner !== n.id)) return 'You do not hold that country'
  const p = stateOf(s, n, { id, regionId })
  if (!p || p.done) return 'That project is not under way'
  if (p.paused) return 'Resume it first'
  if (p.rushed === s.turn) return 'Already rushed this month'
  const b = building(s, n, { id, regionId })
  if (p.progress >= b.months - 1) return 'It will be finished next month anyway'
  return null
}

/**
 * Months of work a rush buys: two at the usual pace, fewer while engineers are scarce. Extra crews cannot make engineers, so a rush
 * is worth no more than the engineers can use (without this, a rush was cheaper per month of work the fewer engineers there were).
 */
export const rushGain = (n: Pick<Nation, 'spending'>, engineerCoverage = 1) => RUSH.months * Math.min(1, projectSpeed(n, engineerCoverage))

export function applyRush(s: GameState, n: Nation, id: ProjectId | LocalProjectId, regionId?: RegionId, engineerCoverage = 1) {
  const p = stateOf(s, n, { id, regionId })
  if (!p) return
  const b = building(s, n, { id, regionId })
  const gain = rushGain(n, engineerCoverage)
  p.progress = Math.min(b.months, p.progress + gain)
  p.rushed = s.turn
  const name = id in LOCAL ? LOCAL[id as LocalProjectId].name : PROJECTS[id as ProjectId].name
  if (n.isPlayer) addLog(s, 'economy', `Extra crews rushed the ${name.toLowerCase()}: ${Math.round(gain * 10) / 10} months closer.`, [n.id])
}
