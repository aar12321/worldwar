import { ACADEMY, ARMS_EXPORTS, ENTERPRISE, INDUSTRY, INDUSTRY_SKILLS, PROGRAM_RULES, PROJECT_IDS, PROJECT_RULES, PROJECTS, WORKS, programCost } from '../data/projects'
import { SECTORS } from '../data/business'
import { addOpinion } from '../ai/opinion'
import { tierGate, tierOf } from './empire'
import { addInfamy, addLog, alliesOf, clamp, sanctionersOf } from './helpers'
import type { GameState, Nation, NationId, ProjectId, ResearchTrack, SectorId, WorldMap } from './types'

// ---- National projects ----

export const activeProjects = (n: Pick<Nation, 'projects'>) => PROJECT_IDS.filter((id) => n.projects?.[id] && !n.projects[id]!.done)
export const doneProject = (n: Pick<Nation, 'projects'> | undefined, id: ProjectId) => !!n?.projects?.[id]?.done

/** Why a nation cannot start this project, or null. */
export function projectProblem(s: GameState, map: WorldMap, n: Nation, id: ProjectId): string | null {
  const spec = PROJECTS[id]
  if (!spec) return 'Unknown project'
  if (n.projects?.[id]) return n.projects[id]!.done ? 'Already built' : 'Already under way'
  const gate = tierGate(s, n.id, spec.tier)
  if (gate) return gate
  if (spec.coastal && !Object.values(s.regions).some((r) => r.owner === n.id && map.regions[r.id]?.coastal)) return 'Needs a coastline'
  const slots = tierOf(n).projectSlots
  if (activeProjects(n).length >= slots) return `A ${tierOf(n).name} can build ${slots} project${slots === 1 ? '' : 's'} at once`
  return null
}

export function startProject(n: Nation, id: ProjectId) {
  ;(n.projects ??= {})[id] = { progress: 0, done: false }
}

/** Money projects cost this month: those being built (unless paused) and the upkeep of those finished. */
export function projectBill(n: Nation): { building: number; upkeep: number } {
  let building = 0
  let upkeep = 0
  for (const id of PROJECT_IDS) {
    const p = n.projects?.[id]
    if (!p) continue
    if (p.done) upkeep += PROJECTS[id].cost * PROJECT_RULES.maintenance
    else if (!p.paused) building += PROJECTS[id].cost / PROJECTS[id].months
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
  const speed = clamp(Math.min(1.1, engineerCoverage), 0.4, 1.1) * (1 + PROJECT_RULES.worksSpeed * ((n.spending?.works ?? 2) - 2))
  for (const id of PROJECT_IDS) {
    const p = n.projects?.[id]
    if (!p || p.done || p.paused) continue
    const month = PROJECTS[id].cost / PROJECTS[id].months
    if (n.resources.capital < 0) {
      refund += month
      continue
    }
    p.progress = Math.min(PROJECTS[id].months, p.progress + speed)
    if (p.progress >= PROJECTS[id].months - 1e-9) {
      p.done = true
      addLog(s, n.isPlayer ? 'economy' : 'news', `${n.name} finished its ${PROJECTS[id].name.toLowerCase()}.`, [n.id])
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
export function powerMult(n: Nation, factories: number, oilProduction: number): number {
  if (factories <= INDUSTRY.powerFree) return 1
  const demand = (factories - INDUSTRY.powerFree) * INDUSTRY.powerPerFactory
  const supply = (n.sectors.energy ?? 0) * INDUSTRY.powerPerEnergy + oilProduction * INDUSTRY.powerPerOil + (n.projects?.grid?.done ? INDUSTRY.powerGrid : 0)
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
