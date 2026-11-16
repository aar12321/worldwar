import { ACADEMY, ARMS_EXPORTS, ENTERPRISE, INDUSTRY, INDUSTRY_SKILLS, PROGRAM_RULES, PROJECT_IDS, PROJECT_LEVELS, PROJECT_RULES, PROJECTS, WORKS, programCost } from '../data/projects'
import { SECTORS } from '../data/business'
import { addOpinion } from '../ai/opinion'
import { tierGate, tierOf } from './empire'
import { addInfamy, addLog, alliesOf, clamp, sanctionersOf } from './helpers'
import type { GameState, Nation, NationId, ProjectId, ResearchTrack, SectorId, Tier, WorldMap } from './types'

// ---- National projects ----

/** Levels of a project finished and working: 0 when none. An upgrade under way does not take the earlier levels away. */
export const projectLevel = (n: Pick<Nation, 'projects'> | undefined, id: ProjectId): number => {
  const p = n?.projects?.[id]
  return !p ? 0 : (p.level ?? (p.done ? 1 : 0))
}
/** A project built at least once. */
export const doneProject = (n: Pick<Nation, 'projects'> | undefined, id: ProjectId) => projectLevel(n, id) >= 1
/** What a project's levels are worth right now, as a multiple of level 1: 0 if not built, 1, 1.6 or 2. */
export const projectPower = (n: Pick<Nation, 'projects'> | undefined, id: ProjectId) => PROJECT_LEVELS.power[projectLevel(n, id)]
/** A bonus of `base` at level 1, scaled for more levels. Exactly `base` at level 1 and 0 when not built. */
export const scaleBonus = (base: number, power: number) => (power === 1 ? base : base * power)
/** A multiplier of `factor` at level 1 (1.25, or 0.75 for a discount), scaled around 1 for more levels. Exactly `factor` at level 1 and 1 when not built. */
export const scaleFactor = (factor: number, power: number) => (power === 1 ? factor : power === 0 ? 1 : 1 + (factor - 1) * power)

/** How fast projects advance, in months of work each month: the engineers set the pace, and public works speed it up or slow it. */
export const projectSpeed = (n: Pick<Nation, 'spending'>, engineerCoverage: number) => clamp(Math.min(1.1, engineerCoverage), 0.4, 1.1) * (1 + PROJECT_RULES.worksSpeed * ((n.spending?.works ?? 2) - 2))

/** Power the finished projects add for factories (a fusion plant), beyond the grid, scaled by level. */
export function projectPowerSupply(n: Pick<Nation, 'projects'>): number {
  let total = 0
  for (const id of PROJECT_IDS) {
    const spec = PROJECTS[id]
    if (spec.power) total += spec.power * projectPower(n, id)
  }
  return total
}

/** On finishing a project the world may notice: a World Expo makes every nation think better of its host. */
export function onProjectFinished(s: GameState, n: Nation, id: ProjectId) {
  const spec = PROJECTS[id]
  if (!spec?.opinion) return
  for (const other of Object.values(s.nations)) if (other.alive && other.id !== n.id && !other.isPlayer) addOpinion(s, other.id, n.id, spec.name, spec.opinion, 0.4)
}

/** Projects with work under way: first builds and upgrades. */
export const activeProjects = (n: Pick<Nation, 'projects'>) => PROJECT_IDS.filter((id) => n.projects?.[id] && !n.projects[id]!.done)

/** The level a project is building (or would build next). */
export const nextLevel = (n: Pick<Nation, 'projects'>, id: ProjectId) => projectLevel(n, id) + 1
export const levelCost = (id: ProjectId, level: number) => Math.round(PROJECTS[id].cost * PROJECT_LEVELS.cost[level])
export const levelMonths = (id: ProjectId, level: number) => Math.round(PROJECTS[id].months * PROJECT_LEVELS.months[level])
/** Everything put into a project up to a level, which its upkeep is a share of. */
export const investedIn = (id: ProjectId, level: number) => {
  let total = 0
  for (let l = 1; l <= level; l++) total += levelCost(id, l)
  return total
}
/** Money a month while the next level is built. */
export const monthlyCost = (id: ProjectId, level: number) => levelCost(id, level) / levelMonths(id, level)
/** The empire size an upgrade needs: the project's own tier, and for the third level at least a Regional power. */
const levelTier = (id: ProjectId, level: number): Tier => (level >= 3 ? (Math.max(2, PROJECTS[id].tier) as Tier) : PROJECTS[id].tier)

/** Why a nation cannot start (or upgrade) this project, or null. */
export function projectProblem(s: GameState, map: WorldMap, n: Nation, id: ProjectId): string | null {
  const spec = PROJECTS[id]
  if (!spec) return 'Unknown project'
  const have = n.projects?.[id]
  if (have && !have.done) return 'Already under way'
  const level = nextLevel(n, id)
  if (level > PROJECT_LEVELS.max) return 'Already built to its highest level'
  const gate = tierGate(s, n.id, levelTier(id, level))
  if (gate) return gate
  if (spec.coastal && !Object.values(s.regions).some((r) => r.owner === n.id && map.regions[r.id]?.coastal)) return 'Needs a coastline'
  const slots = tierOf(n).projectSlots
  if (activeProjects(n).length >= slots) return `A ${tierOf(n).name} can build ${slots} project${slots === 1 ? '' : 's'} at once`
  return null
}

/** Begins a project, or the next level of a finished one. */
export function startProject(n: Nation, id: ProjectId) {
  const have = n.projects?.[id]
  if (have?.done) {
    // The levels already built keep working while the next is under way.
    have.level = projectLevel(n, id)
    have.done = false
    have.progress = 0
    delete have.paused
    return
  }
  ;(n.projects ??= {})[id] = { progress: 0, done: false }
}

/** Money projects cost this month: those being built (unless paused) and the upkeep of every level already built. */
export function projectBill(n: Nation): { building: number; upkeep: number } {
  let building = 0
  let upkeep = 0
  for (const id of PROJECT_IDS) {
    const p = n.projects?.[id]
    if (!p) continue
    const built = projectLevel(n, id)
    if (built > 0) upkeep += investedIn(id, built) * PROJECT_RULES.maintenance
    if (!p.done && !p.paused) building += monthlyCost(id, built + 1)
  }
  return { building, upkeep }
}

/**
 * A month of work on every project. Engineers set the pace and public works speed it up; a project stalls, and costs nothing, while
 * the treasury cannot pay for its month. Returns the money actually spent, which the economy has already charged in full, so the
 * caller refunds any stalled month.
 */
export function runProjects(s: GameState, n: Nation, engineerCoverage: number): number {
  let refund = 0
  const speed = projectSpeed(n, engineerCoverage)
  for (const id of PROJECT_IDS) {
    const p = n.projects?.[id]
    if (!p || p.done || p.paused) continue
    const level = projectLevel(n, id) + 1
    const months = levelMonths(id, level)
    if (n.resources.capital < 0) {
      refund += monthlyCost(id, level)
      continue
    }
    p.progress = Math.min(months, p.progress + speed)
    if (p.progress >= months - 1e-9) {
      p.done = true
      // Only a second or third level is written down: a single level is simply "done", as it has always been.
      if (level >= 2) p.level = level
      addLog(s, n.isPlayer ? 'economy' : 'news', `${n.name} finished ${level >= 2 ? `level ${level} of its` : 'its'} ${PROJECTS[id].name.toLowerCase()}.`, [n.id])
      if (level === 1) onProjectFinished(s, n, id)
    }
  }
  return refund
}

// ---- Public works ----

/** What public works above or below standard does: trade, factories, line healing, build prices. */
export function worksEffects(n: Pick<Nation, 'spending'>) {
  const d = (n.spending?.works ?? 2) - 2
  return { trade: WORKS.trade * d, factory: WORKS.factory * d, heal: WORKS.heal * d, buildCost: -WORKS.buildCost * d }
}

// ---- State enterprises ----

export function enterpriseProblem(s: GameState, n: Nation, sector: SectorId, mode: 'buy' | 'seize' | 'sell'): string | null {
  if (!SECTORS[sector]) return 'Unknown sector'
  const owned = (n.stateOwned ?? []).includes(sector)
  if (mode === 'sell') return owned ? null : 'The state does not own it'
  if (owned) return 'The state already owns it'
  const slots = tierOf(n).enterpriseSlots
  if ((n.stateOwned ?? []).length >= slots) return `A ${tierOf(n).name} can run ${slots} state enterprise${slots === 1 ? '' : 's'}`
  if ((n.sectors[sector] ?? 0) < 0.5) return 'There is nothing there to take over yet'
  void s
  return null
}

export const enterpriseCost = (n: Nation, sector: SectorId, mode: 'buy' | 'seize' | 'sell') => (mode === 'buy' ? Math.round(ENTERPRISE.buyPerSize * (n.sectors[sector] ?? 0)) : 0)

export function setStateOwned(s: GameState, n: Nation, sector: SectorId, mode: 'buy' | 'seize' | 'sell') {
  const name = SECTORS[sector].name.toLowerCase()
  if (mode === 'sell') {
    n.stateOwned = (n.stateOwned ?? []).filter((x) => x !== sector)
    n.resources.capital += ENTERPRISE.sellPerSize * (n.sectors[sector] ?? 0)
    if (n.isPlayer) addLog(s, 'economy', `You sold the state's ${name} business back to private owners.`, [n.id])
    return
  }
  n.stateOwned = [...new Set([...(n.stateOwned ?? []), sector])]
  if (mode === 'seize') {
    n.stability = Math.max(0, n.stability - ENTERPRISE.seizeStability)
    n.seizedUntil = s.turn + ENTERPRISE.seizeMonths
    // Foreign investors in the sector lose their stake, and remember it.
    for (const inv of (s.investments ?? []).filter((i) => i.target === n.id && i.sector === sector)) addOpinion(s, inv.investor, n.id, 'Seized our investment', -30, 0.3)
    s.investments = (s.investments ?? []).filter((i) => !(i.target === n.id && i.sector === sector))
    addInfamy(s, n.id, 3)
    addLog(s, 'economy', `${n.name} seized its ${name} business. Investors are alarmed.`, [n.id])
  } else if (n.isPlayer) addLog(s, 'economy', `The state bought the ${name} business.`, [n.id])
}

/** Share of a state sector's profit the state keeps: command economies run them a little better. */
export const enterpriseEfficiency = (n: Pick<Nation, 'government'>) => (n.government === 'one_party' || n.government === 'junta' ? ENTERPRISE.commandEfficiency : ENTERPRISE.efficiency)

/** Profit the state takes from the sectors it owns this month. */
export function enterpriseIncome(n: Nation): number {
  let sum = 0
  for (const id of n.stateOwned ?? []) sum += (n.sectors[id] ?? 0) * SECTORS[id].profit * enterpriseEfficiency(n)
  return sum
}

// ---- Industrial base ----

/** How big a sector can grow, as a multiple of the usual cap, from the skills it needs. */
export function industryCapMult(n: Pick<Nation, 'people'>, sector: SectorId): number {
  const need = INDUSTRY_SKILLS[sector]
  if (!need || !n.people) return 1
  return clamp(0.7 + 0.3 * (n.people.skills[need.skill] / need.reference), INDUSTRY.min, INDUSTRY.max)
}

/** Factories need power past a point: the energy sector, oil and the grid supply it. Returns the factory multiplier. */
export function powerMult(n: Nation, factories: number, oilProduction: number, extraPower = 0): number {
  if (factories <= INDUSTRY.powerFree) return 1
  const demand = (factories - INDUSTRY.powerFree) * INDUSTRY.powerPerFactory
  const supply = (n.sectors.energy ?? 0) * INDUSTRY.powerPerEnergy + oilProduction * INDUSTRY.powerPerOil + scaleBonus(INDUSTRY.powerGrid, projectPower(n, 'grid')) + projectPowerSupply(n) + extraPower
  return clamp(supply / Math.max(1e-6, demand), INDUSTRY.powerFloor, 1)
}

// ---- Military academies ----

export function academyProblem(s: GameState, n: Nation): string | null {
  const level = n.academy ?? 0
  const max = tierOf(n).academyMax
  if (level >= 3) return 'The academy is at its best'
  if (level >= max) return tierGate(s, n.id, level + 1 >= 3 ? 3 : 2) ?? `Your tier allows level ${max}`
  if (n.people.schooling < ACADEMY.schooling[level]) return `Needs schooling of ${Math.round(ACADEMY.schooling[level] * 100)}% (yours is ${Math.round(n.people.schooling * 100)}%)`
  return null
}

export const academyCost = (n: Pick<Nation, 'academy'>) => ACADEMY.cost[Math.min(2, n.academy ?? 0)]

// ---- Arms exports ----

/** Money arms sales bring in this month, capped at a tenth of gross, and none while sanctioned. */
export function armsExportIncome(s: GameState, n: Nation, gross: number): number {
  const mode = n.programs?.armsExports ?? 'off'
  if (mode === 'off' || sanctionersOf(s, n.id).length > 0) return 0
  const raw = (n.sectors.arms ?? 0) * ARMS_EXPORTS.perSize * (mode === 'anyone' ? ARMS_EXPORTS.anyone : 1)
  return Math.min(ARMS_EXPORTS.cap * Math.max(0, gross), raw)
}

/** Selling to anyone costs reputation each month; selling to friends wins their goodwill. */
export function runArmsExports(s: GameState, n: Nation) {
  const mode = n.programs?.armsExports ?? 'off'
  if (mode === 'off' || sanctionersOf(s, n.id).length > 0) return
  if (mode === 'anyone') addInfamy(s, n.id, ARMS_EXPORTS.infamy)
  else for (const ally of alliesOf(s, n.id)) addOpinion(s, ally, n.id, 'Sells us arms', ARMS_EXPORTS.opinion, 0.5)
}

// ---- Future research programs ----

export function programProblem(n: Nation, track: ResearchTrack): string | null {
  const level = n.research2?.[track] ?? 0
  if (level >= PROGRAM_RULES.maxLevel) return 'This program is complete'
  if (n.resources.tp < programCost(level)) return `Needs ${programCost(level)} research`
  return null
}

/** What the research programs add up to. */
export function programEffects(n: Pick<Nation, 'research2'> | undefined) {
  const r = n?.research2
  return { output: (r?.productivity ?? 0) * PROGRAM_RULES.output, weapons: (r?.weapons ?? 0) * PROGRAM_RULES.weapons }
}

export type { NationId }
