import { addOpinion } from '../ai/opinion'
import {
  CHIEF,
  CHIEF_TRAITS,
  CHIEF_TRAIT_IDS,
  CONTRACTORS,
  CONTRACTOR_IDS,
  DEVS,
  DEV_IDS,
  FACILITIES,
  FACILITY_IDS,
  MILESTONES,
  MPROG,
  POACH,
  PRODUCTION_RULES,
  PROGRAM_RULES,
  STAFF,
  STAFF_FX,
  STAFF_ROLES,
  TEST_RULES,
  type ChiefDesigner,
  type Contractor,
  type DevState,
  type FacilityId,
  type MilestoneId,
  type MissileDevId,
  type MissileProgramAction,
  type MissileProgramState,
  type MissileTestFlight,
  type ProgramKind,
  type StaffRole,
} from '../data/missileProgram'
import { MISSILES, PROGRAM_MISSILES } from '../data/missiles'
import { tierSpec } from '../data/empire'
import { absDay, clockOf, daysInMonth, fromAbsDay, isLive } from './calendar'
import { addLog, atWar, clamp, distanceKm } from './helpers'
import { arsenalSize, buildMissilesCost, programLevel, storageCap } from './missiles'
import { ledgerOf } from './missileWar'
import { branchSpeed, programFx, programStaff, usefulStaff } from './programEffects'
import { createRng } from './rng'
import type { GameState, LogKind, Nation, NationId, Order, WorldMap } from './types'

/**
 * The missile program as an organisation (data/missileProgram.ts has the numbers and the why). Pure rules over the state; the order
 * path (orders.ts, resolveTurn.ts) calls `programProblem`, `programCost` and `applyProgram`; the month (runMonth) calls
 * `runMissileProgram`; the live clock calls `programDueBy` and `runProgramDay` so work finishes on its own day. Everything random
 * draws from streams seeded by the game, so every screen of an online game gets the same result.
 *
 * Work is counted in months at pace 1. Between two "settles" every rate is constant, and every change to a rate (an order, a finished
 * facility, a test, a poaching, the month's end) settles first, so a live game and a turn game agree on the month things finish in.
 */

type Act = MissileProgramAction
type ProgramOrder = Extract<Order, { type: 'missileProgram' }>

// ---- Time ----

/** Where an absolute day sits in months: the turn, plus the share of its month gone. A whole month is exactly 1. */
export function monthPos(day: number): number {
  const { turn, day: d } = fromAbsDay(day)
  return turn + d / daysInMonth(turn)
}

export const monthsBetween = (a: number, b: number): number => monthPos(b) - monthPos(a)

/** The first absolute day by which `months` from `from` have passed. */
export function dayAfter(from: number, months: number): number {
  if (!Number.isFinite(months)) return Infinity
  const pos = monthPos(from) + Math.max(0, months)
  const turn = Math.floor(pos + 1e-9)
  const frac = Math.max(0, pos - turn)
  return absDay(turn, 0) + Math.ceil(frac * daysInMonth(turn) - 1e-6)
}

/** The month's end of the current turn, as an absolute day (the 1st of the next month). */
export const monthEnd = (s: Pick<GameState, 'turn'>): number => absDay(s.turn + 1, 0)

// ---- State ----

export function newProgram(s: GameState): MissileProgramState {
  return { fac: {}, builds: [], staff: {}, devs: {}, line: [], budget: 1, exp: 0, asOf: clockOf(s), stats: { tests: 0, successes: 0, failures: 0, built: 0, poached: 0, gained: 0 }, seq: 0 }
}

const ensure = (s: GameState, n: Nation): MissileProgramState => (n.mprog ??= newProgram(s))

const budgetPace = (p: MissileProgramState) => 0.6 + 0.4 * p.budget

/** Months of facility construction a month gets done. */
export const buildRate = (n: Nation): number => {
  const p = n.mprog
  if (!p || p.stalled) return 0
  return budgetPace(p)
}

/** Months of a development's work a month gets done: a contractor's own pace, or the program's people. */
export function devRate(n: Nation, id: MissileDevId): number {
  const p = n.mprog
  const d = p?.devs[id]
  if (!p || !d) return 0
  if (d.by !== 'house') return CONTRACTORS[d.by].pace
  if (p.stalled) return 0
  const fx = programFx(n)
  return budgetPace(p) * Math.max(0.2, 1 + (fx?.speed ?? 0) + branchSpeed(n, DEVS[id].branch))
}

/** Missiles a month the production line delivers. Zero without a plant. */
export function lineRate(n: Nation): number {
  const p = n.mprog
  const plant = p?.fac.plant ?? 0
  if (!p || plant <= 0 || p.stalled) return 0
  const chief = p.chief?.trait === 'industrial' ? 2 : 0
  return (plant * PRODUCTION_RULES.perLevel + usefulStaff(n, 'production') * STAFF_FX.productionCapacity + chief) * budgetPace(p)
}

// ---- Bringing the work up to date ----

const name = (n: Nation) => n.name
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

function note(s: GameState, n: Nation, text: string, kind: LogKind = 'tech', also: NationId[] = []) {
  // Only what a player should hear about goes to the log: its own program, and rival programs that touch it.
  if (n.isPlayer || s.humans?.includes(n.id) || also.some((id) => s.nations[id]?.isPlayer || s.humans?.includes(id))) addLog(s, kind, text, [n.id, ...also])
}

/**
 * Moves every job of a nation's program on to `now` and finishes what is due. Mutates `s`. Every rate change must call this first.
 * Order of completion is fixed (facilities in the table's order, then developments, then the line) so it is the same on every screen.
 */
export function settle(s: GameState, n: Nation, now: number) {
  const p = n.mprog
  if (!p || !MPROG.on) return
  if (now < p.asOf) return
  const dm = now > p.asOf ? monthsBetween(p.asOf, now) : 0
  if (dm > 0) {
    const br = buildRate(n)
    for (const b of p.builds) b.left -= dm * br
    for (const id of DEV_IDS) {
      const d = p.devs[id]
      if (d?.state === 'dev') d.left -= dm * devRate(n, id)
    }
    // The line works on its first batch; a finished batch hands the rest of the time to the next.
    let made = dm * lineRate(n)
    while (made > 1e-9 && p.line.length) {
      const b = p.line[0]
      const room = b.count - b.made
      const step = Math.min(room, made)
      const before = Math.floor(b.made + 1e-9)
      b.made += step
      made -= step
      const after = Math.floor(b.made + 1e-9)
      if (after > before) (n.arsenal ??= {})[b.kind] = (n.arsenal?.[b.kind] ?? 0) + (after - before)
      if (b.made >= b.count - 1e-9) {
        p.line.shift()
        note(s, n, `The production line finished ${plural(b.count, MISSILES[b.kind].name.toLowerCase())}.`)
      }
    }
  }
  p.asOf = now
  // Facilities that are finished.
  for (const id of FACILITY_IDS) {
    const b = p.builds.find((x) => x.facility === id)
    if (!b || b.left > 1e-6) continue
    p.builds = p.builds.filter((x) => x !== b)
    p.fac[id] = b.level
    p.exp = Math.min(PROGRAM_RULES.exp.max, p.exp + PROGRAM_RULES.exp.built)
    p.stats.built++
    note(s, n, `${name(n)}'s ${FACILITIES[id].name.toLowerCase()} reached level ${b.level}.`)
  }
  for (const id of DEV_IDS) {
    const d = p.devs[id]
    if (!d || d.state !== 'dev' || d.left > 1e-6) continue
    d.left = 0
    if (DEVS[id].test !== undefined) {
      d.state = 'test'
      note(s, n, `${DEVS[id].name} is ready for its test launch.`)
    } else {
      d.state = 'done'
      note(s, n, `${name(n)} finished developing ${DEVS[id].name.toLowerCase()}.`)
    }
  }
}

/** The next absolute day something of this program comes due (a facility, a development, a missile off the line), or Infinity. */
export function nextDue(n: Nation): number {
  const p = n.mprog
  if (!p) return Infinity
  let best = Infinity
  const br = buildRate(n)
  for (const b of p.builds) if (br > 0) best = Math.min(best, dayAfter(p.asOf, b.left / br))
  for (const id of DEV_IDS) {
    const d = p.devs[id]
    if (d?.state !== 'dev') continue
    const r = devRate(n, id)
    if (r > 0) best = Math.min(best, dayAfter(p.asOf, d.left / r))
  }
  const lr = lineRate(n)
  const b = p.line[0]
  if (b && lr > 0) {
    // The next whole missile.
    const need = Math.floor(b.made + 1e-9) + 1 - b.made
    best = Math.min(best, dayAfter(p.asOf, need / lr))
  }
  return best
}

const programNations = (s: GameState): Nation[] =>
  Object.values(s.nations)
    .filter((n) => n.mprog && n.alive)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/** Whether any program has something due by `today` (live games): the clock then runs the day. */
export function programDueBy(s: GameState, today: number): boolean {
  if (!MPROG.on) return false
  if (s.missileTests?.some((t) => t.lands <= today)) return true
  for (const n of programNations(s)) if (nextDue(n) <= today) return true
  return false
}

/** A live day: every program's work up to `today`, then the tests that land. */
export function runProgramDay(s: GameState, map: WorldMap, today: number) {
  if (!MPROG.on) return
  for (const n of programNations(s)) if (nextDue(n) <= today) settle(s, n, today)
  landTests(s, map, today)
}

// ---- Money ----

export interface ProgramBill {
  upkeep: number
  salaries: number
  ops: number
  total: number
}

/** What the program costs a month: facilities' upkeep, staff salaries, and operations scaled by the budget. Zero without one. */
export function programBill(n: Pick<Nation, 'mprog'>): ProgramBill {
  const p = MPROG.on ? n.mprog : undefined
  if (!p) return { upkeep: 0, salaries: 0, ops: 0, total: 0 }
  let upkeep = 0
  for (const id of FACILITY_IDS) {
    const lvl = p.fac[id] ?? 0
    if (lvl > 0) upkeep += FACILITIES[id].upkeep[lvl - 1]
  }
  let salaries = 0
  for (const r of STAFF_ROLES) salaries += (p.staff[r] ?? 0) * STAFF[r].salary
  if (p.chief) salaries += CHIEF.salary[0] + CHIEF.salary[1] * p.chief.skill
  const jobs = p.builds.length + DEV_IDS.filter((id) => p.devs[id]?.state === 'dev' && p.devs[id]!.by === 'house').length + (p.line.length ? 1 : 0)
  const ops = jobs > 0 ? (PROGRAM_RULES.opsBase + PROGRAM_RULES.opsPerJob * jobs) * p.budget : 0
  return { upkeep, salaries, ops, total: upkeep + salaries + ops }
}

// ---- Talent ----

/** The talent the people can spare for missiles, less what the space agency already employs (one space hire takes two places here). */
export function programTalentCap(n: Nation, workforce: number): number {
  const sk = n.people?.skills
  const mix = sk ? sk.engineers * 0.65 + sk.scientists * 0.35 : 0.02
  const space = n.space ? n.space.engineers + n.space.astronauts : 0
  return Math.max(2, Math.floor(workforce * mix * PROGRAM_RULES.talentPerWork)) - space * 2
}

/** Engineers the program draws away from the factories, as a share of the workforce. Zero without staff. */
export const programEngineerDemand = (n: Pick<Nation, 'mprog'>, workforce: number): number => {
  const staff = MPROG.on ? programStaff(n) : 0
  return staff > 0 && workforce > 0 ? (staff / (PROGRAM_RULES.talentPerWork * workforce)) * PROGRAM_RULES.engineerDraw : 0
}

// ---- The chief designer ----

function hashId(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** The candidates on offer this year: drawn from the game's seed, the nation and the year, so every screen sees the same three. */
export function chiefCandidates(s: Pick<GameState, 'seed' | 'turn'>, n: Pick<Nation, 'id'>): ChiefDesigner[] {
  const year = Math.floor((s.turn - 1) / 12)
  const rng = createRng((s.seed ^ 0xc41e) >>> 0, hashId(n.id) + year * 7919)
  const out: ChiefDesigner[] = []
  const traits = [...CHIEF_TRAIT_IDS]
  for (let i = 0; i < CHIEF.candidates; i++) {
    const trait = traits.splice(rng.int(0, traits.length - 1), 1)[0]
    out.push({ name: `${rng.pick(CHIEF.first)} ${rng.pick(CHIEF.last)}`, trait, skill: rng.int(1, 3), tests: 0, since: s.turn })
  }
  return out
}

export const chiefHireCost = (c: Pick<ChiefDesigner, 'skill'>) => CHIEF.hire[0] + CHIEF.hire[1] * c.skill
export const chiefSalary = (c: Pick<ChiefDesigner, 'skill'>) => CHIEF.salary[0] + CHIEF.salary[1] * c.skill

// ---- Development ----

export type DevStatus = 'done' | 'test' | 'dev' | 'ready' | 'locked'

/** Why a development cannot begin (ignoring money, slots and who does it), or null. */
export function devLock(n: Nation, id: MissileDevId): string | null {
  const spec = DEVS[id]
  const p = n.mprog
  const missing = spec.requires.find((r) => p?.devs[r]?.state !== 'done')
  if (missing) return `Needs ${DEVS[missing].name} first`
  if (programLevel(n) < spec.level) return `Needs the program at level ${spec.level}`
  if ((n.tier ?? 1) < spec.tier) return `Needs a ${tierSpec(spec.tier).name}`
  for (const [f, lvl] of Object.entries(spec.needs) as [FacilityId, number][]) if ((p?.fac[f] ?? 0) < lvl) return `Needs the ${FACILITIES[f].name.toLowerCase()} at level ${lvl}`
  return null
}

export function devStatus(n: Nation, id: MissileDevId): DevStatus {
  const d = n.mprog?.devs[id]
  if (d) return d.state
  return devLock(n, id) ? 'locked' : 'ready'
}

export const devSlots = (n: Nation): number => PROGRAM_RULES.slots[Math.min(PROGRAM_RULES.slots.length - 1, n.mprog?.fac.institute ?? 0)]
export const activeDevs = (n: Pick<Nation, 'mprog'>): MissileDevId[] => DEV_IDS.filter((id) => n.mprog?.devs[id]?.state === 'dev')

/** What a development costs from a contractor: money scaled by its price, research the same. */
export const devPrice = (id: MissileDevId, by: Contractor = 'house') => ({ capital: Math.ceil(DEVS[id].money * CONTRACTORS[by].price), tp: DEVS[id].tp })

/** The chance a test launch of a development succeeds now. */
export function testOdds(n: Nation, id: MissileDevId): number {
  const spec = DEVS[id]
  const d = n.mprog?.devs[id]
  const fx = programFx(n)
  let p = (spec.test ?? 1) + (fx?.reliability ?? 0) + (d ? CONTRACTORS[d.by].reliability + d.fails * TEST_RULES.learn : 0)
  if (spec.branch === 'propulsion') p += STAFF_FX.branchReliability * usefulStaff(n, 'propulsion')
  if (spec.branch === 'guidance' || spec.branch === 'payload') p += STAFF_FX.branchReliability * usefulStaff(n, 'guidance')
  return clamp(p, TEST_RULES.floor, TEST_RULES.ceiling)
}

export const testMoney = (n: Pick<Nation, 'mprog'>, id: MissileDevId): number => Math.ceil(Math.max(TEST_RULES.minMoney, DEVS[id].money * TEST_RULES.share) * (1 - TEST_RULES.standCut * (n.mprog?.fac.stand ?? 0)))
export const testsAllowed = (n: Pick<Nation, 'mprog'>): number => n.mprog?.fac.stand ?? 0
export const testsUsed = (s: Pick<GameState, 'turn'>, n: Pick<Nation, 'mprog'>): number => (n.mprog?.testsIn?.turn === s.turn ? n.mprog.testsIn.count : 0)

// ---- Orders ----

const isRole = (r: unknown): r is StaffRole => typeof r === 'string' && (STAFF_ROLES as string[]).includes(r)
const isFacility = (f: unknown): f is FacilityId => typeof f === 'string' && (FACILITY_IDS as string[]).includes(f)
const isDev = (d: unknown): d is MissileDevId => typeof d === 'string' && (DEV_IDS as string[]).includes(d)
const isCount = (c: unknown, max: number): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 1 && c <= max

/** Program actions of this nation already waiting in the same batch (the AI's list, a month's plan). */
const pendingActs = (pending: Order[], id: NationId): Act[] => pending.filter((p): p is ProgramOrder => p.type === 'missileProgram' && p.nationId === id && !!p.action).map((p) => p.action)

/** Why an action cannot be taken, or null. `workforce` caps the staff. Never throws on a malformed action. */
export function programProblem(s: GameState, n: Nation, a: Act, workforce: number, pending: Order[] = []): string | null {
  if (!MPROG.on) return 'The missile program is not available'
  if (!a || typeof a !== 'object' || typeof (a as { kind?: unknown }).kind !== 'string') return 'Choose what the program should do'
  const p = n.mprog
  const queued = pendingActs(pending, n.id)
  switch (a.kind) {
    case 'build': {
      if (!isFacility(a.facility)) return 'Unknown facility'
      const spec = FACILITIES[a.facility]
      if (p?.builds.some((b) => b.facility === a.facility) || queued.some((q) => q.kind === 'build' && q.facility === a.facility)) return 'Already under construction'
      const level = (p?.fac[a.facility] ?? 0) + 1
      if (level > spec.money.length) return 'It is at its highest level'
      const tierMax = PROGRAM_RULES.tierLevel[Math.max(1, Math.min(5, n.tier ?? 1)) - 1]
      if (level > tierMax) return `A ${tierSpec(n.tier ?? 1).name} can build it to level ${tierMax}. Grow your empire for more.`
      const charter = programLevel(n) + PROGRAM_RULES.aboveCharter
      if (level > charter) return `Raise the program to level ${level - PROGRAM_RULES.aboveCharter} first`
      const at = PROGRAM_RULES.builds[Math.max(1, Math.min(5, n.tier ?? 1)) - 1]
      const building = (p?.builds.length ?? 0) + queued.filter((q) => q.kind === 'build').length
      if (building >= at) return `A ${tierSpec(n.tier ?? 1).name} builds ${at === 1 ? 'one facility' : `${at} facilities`} at a time`
      return null
    }
    case 'hire': {
      if (!isRole(a.role)) return 'Unknown kind of staff'
      if (!isCount(a.count, PROGRAM_RULES.hireMax)) return `Hire 1 to ${PROGRAM_RULES.hireMax} at a time`
      const cap = programTalentCap(n, workforce)
      const more = queued.reduce((sum, q) => (q.kind === 'hire' && isCount(q.count, PROGRAM_RULES.hireMax) ? sum + q.count : sum), 0)
      const free = cap - programStaff(n) - more
      if (a.count > free) return free <= 0 ? `Your people can spare no more talent (${Math.max(0, cap)} at most, shared with the space agency). Schooling and engineers raise it.` : `Your people can spare only ${free} more`
      return null
    }
    case 'dismiss': {
      if (!isRole(a.role)) return 'Unknown kind of staff'
      if (!isCount(a.count, 50)) return 'Choose how many'
      return (p?.staff[a.role] ?? 0) < a.count ? `You have ${p?.staff[a.role] ?? 0}` : null
    }
    case 'chief': {
      if (!isCount(a.pick + 1, CHIEF.candidates)) return 'Choose a candidate'
      if (p?.chief) return 'You have a chief designer. Let them go first.'
      if (queued.some((q) => q.kind === 'chief')) return 'Already hiring one'
      return null
    }
    case 'dropChief':
      return p?.chief ? null : 'There is no chief designer'
    case 'develop': {
      if (!isDev(a.dev)) return 'Unknown development'
      const by = a.by ?? 'house'
      if (!(CONTRACTOR_IDS as string[]).includes(by)) return 'Unknown contractor'
      if (p?.devs[a.dev]) return p.devs[a.dev]!.state === 'done' ? 'Already developed' : 'Already under way'
      if (queued.some((q) => q.kind === 'develop' && q.dev === a.dev)) return 'Already ordered'
      const lock = devLock(n, a.dev)
      if (lock) return lock
      if (by === 'house') {
        if ((p?.fac.institute ?? 0) < 1) return 'In-house work needs a research institute (or hire a contractor)'
        if ((p?.staff.engineer ?? 0) < PROGRAM_RULES.houseEngineers) return `In-house work needs ${PROGRAM_RULES.houseEngineers} rocket engineers (or hire a contractor)`
      }
      const slots = devSlots(n)
      if (activeDevs(n).length + queued.filter((q) => q.kind === 'develop').length >= slots) return `${plural(slots, 'project')} at a time: a bigger institute adds slots`
      return null
    }
    case 'test': {
      if (!isDev(a.dev)) return 'Unknown development'
      const d = p?.devs[a.dev]
      if (!d) return 'Develop it first'
      if (d.state === 'done') return 'It has already passed its test'
      if (d.state === 'dev') return 'Still in development'
      if (s.missileTests?.some((t) => t.nationId === n.id && t.dev === a.dev) || queued.some((q) => q.kind === 'test' && q.dev === a.dev)) return 'A test is already on the pad'
      const allowed = testsAllowed(n)
      if (allowed < 1) return 'Test launches need an engine test stand'
      if (testsUsed(s, n) + queued.filter((q) => q.kind === 'test').length >= allowed) return `The test stand allows ${plural(allowed, 'test')} a month`
      return null
    }
    case 'budget':
      if (!PROGRAM_RULES.budgets.includes(a.level)) return 'Choose a budget'
      return (p?.budget ?? 1) === a.level ? 'That is the budget already' : null
    case 'produce': {
      if (typeof a.missile !== 'string' || !PROGRAM_MISSILES.includes(a.missile)) return 'Unknown missile'
      if (!isCount(a.count, PRODUCTION_RULES.batchMax)) return `A batch is 1 to ${PRODUCTION_RULES.batchMax}`
      if ((p?.fac.plant ?? 0) < 1) return 'The production line needs a production plant'
      if (programLevel(n) < MISSILES[a.missile].level) return `Needs the program at level ${MISSILES[a.missile].level}`
      const batches = (p?.line.length ?? 0) + queued.filter((q) => q.kind === 'produce').length
      if (batches >= PRODUCTION_RULES.queueMax) return `The line holds ${PRODUCTION_RULES.queueMax} batches`
      const onLine = (p?.line ?? []).reduce((sum, b) => sum + (b.count - Math.floor(b.made + 1e-9)) * MISSILES[b.kind].slots, 0) + queued.reduce((sum, q) => (q.kind === 'produce' && isCount(q.count, PRODUCTION_RULES.batchMax) ? sum + q.count * MISSILES[q.missile].slots : sum), 0)
      const room = Math.floor((storageCap(n) - arsenalSize(n) - onLine) / MISSILES[a.missile].slots + 1e-9)
      if (a.count > room) return room <= 0 ? `The stores are full (${storageCap(n)}). A silo field holds more.` : `The stores have room for ${room} more`
      if (n.resources.oil < MISSILES[a.missile].oil * a.count) return `Not enough oil (needs ${MISSILES[a.missile].oil * a.count})`
      return null
    }
    default:
      return 'Unknown program order'
  }
}

/** What an action costs, paid when it is given. Research (`tp`) is charged in `applyProgram`, as the generic charge leaves it. */
export function programCost(s: GameState, n: Nation | undefined, a: Act): { capital: number; tp: number; steel: number } {
  const none = { capital: 0, tp: 0, steel: 0 }
  if (!n || !a || typeof a !== 'object') return none
  switch (a.kind) {
    case 'build': {
      if (!isFacility(a.facility)) return none
      const level = (n.mprog?.fac[a.facility] ?? 0) + 1
      return { ...none, capital: FACILITIES[a.facility].money[level - 1] ?? 0 }
    }
    case 'hire':
      return isRole(a.role) && isCount(a.count, PROGRAM_RULES.hireMax) ? { ...none, capital: STAFF[a.role].hire * a.count } : none
    case 'chief': {
      const c = chiefCandidates(s, n)[a.pick]
      return c ? { ...none, capital: chiefHireCost(c) } : none
    }
    case 'develop': {
      if (!isDev(a.dev)) return none
      const k = devPrice(a.dev, (CONTRACTOR_IDS as string[]).includes(a.by ?? 'house') ? (a.by ?? 'house') : 'house')
      return { ...none, capital: k.capital, tp: k.tp }
    }
    case 'test':
      return isDev(a.dev) ? { ...none, capital: testMoney(n, a.dev) } : none
    case 'produce': {
      if (typeof a.missile !== 'string' || !PROGRAM_MISSILES.includes(a.missile) || !isCount(a.count, PRODUCTION_RULES.batchMax)) return none
      const k = buildMissilesCost({ type: 'buildMissiles', nationId: n.id, kind: a.missile, count: a.count }, n)
      return { capital: Math.ceil(k.capital * PRODUCTION_RULES.price), tp: 0, steel: k.steel }
    }
    default:
      return none
  }
}

/** Carries out an action already checked and paid for (money and steel by the order path; research here). Mutates `s`. */
export function applyProgram(s: GameState, map: WorldMap, n: Nation, a: Act) {
  const now = clockOf(s)
  const p = ensure(s, n)
  settle(s, n, now)
  switch (a.kind) {
    case 'build': {
      const level = (p.fac[a.facility] ?? 0) + 1
      const months = FACILITIES[a.facility].months[level - 1]
      p.builds.push({ facility: a.facility, level, left: months, total: months })
      note(s, n, `${name(n)} began building its ${FACILITIES[a.facility].name.toLowerCase()} (level ${level}): about ${plural(months, 'month')}.`)
      break
    }
    case 'hire':
      p.staff[a.role] = (p.staff[a.role] ?? 0) + a.count
      note(s, n, `${name(n)} hired ${plural(a.count, STAFF[a.role].one)} for the missile program.`)
      break
    case 'dismiss':
      p.staff[a.role] = Math.max(0, (p.staff[a.role] ?? 0) - a.count)
      if (!p.staff[a.role]) delete p.staff[a.role]
      break
    case 'chief': {
      const c = chiefCandidates(s, n)[a.pick]
      if (!c) break
      p.chief = { ...c, since: s.turn }
      note(s, n, `${c.name} is the missile program's new chief designer: ${CHIEF_TRAITS[c.trait].name.toLowerCase()}.`)
      break
    }
    case 'dropChief':
      if (p.chief) note(s, n, `${p.chief.name} left the post of chief designer.`)
      delete p.chief
      break
    case 'develop': {
      const by = a.by ?? 'house'
      n.resources.tp -= DEVS[a.dev].tp
      const months = DEVS[a.dev].months
      p.devs[a.dev] = { state: 'dev', left: months, total: months, by, fails: 0 }
      if (by === 'foreign') p.exposed = true
      note(s, n, `${name(n)} began developing ${DEVS[a.dev].name.toLowerCase()}${by === 'house' ? '' : ` with a ${CONTRACTORS[by].name.toLowerCase()}`}.`)
      break
    }
    case 'test':
      launchTest(s, map, n, a.dev)
      break
    case 'budget':
      p.budget = a.level
      break
    case 'produce':
      n.resources.oil -= MISSILES[a.missile].oil * a.count
      p.line.push({ id: `b${++p.seq}`, kind: a.missile, count: a.count, made: 0 })
      break
  }
}

export function describeProgram(a: Act): string {
  if (!a || typeof a !== 'object') return 'Missile program'
  switch (a.kind) {
    case 'build':
      return `Build the ${FACILITIES[a.facility]?.name.toLowerCase() ?? 'facility'}`
    case 'hire':
      return `Hire ${a.count} ${STAFF[a.role]?.name.toLowerCase() ?? 'staff'}`
    case 'dismiss':
      return `Dismiss ${a.count} ${STAFF[a.role]?.name.toLowerCase() ?? 'staff'}`
    case 'chief':
      return 'Hire a chief designer'
    case 'dropChief':
      return 'Let the chief designer go'
    case 'develop':
      return `Develop ${DEVS[a.dev]?.name.toLowerCase() ?? 'a missile project'}`
    case 'test':
      return `Test launch: ${DEVS[a.dev]?.name.toLowerCase() ?? 'a missile project'}`
    case 'budget':
      return `Set the missile budget to ${Math.round((a.level ?? 1) * 100)}%`
    case 'produce':
      return `Put ${a.count} ${MISSILES[a.missile]?.name.toLowerCase() ?? 'missile'}${a.count === 1 ? '' : 's'} on the production line`
    default:
      return 'Missile program'
  }
}

// ---- Test launches ----

/** Where tests land: out over the sea from the capital, a few hundred km off, the same spot every time for a nation. */
export function testRange(map: WorldMap, s: GameState, n: Nation): { from: string; to: { lat: number; lng: number } } | null {
  const from = map.regions[n.capital] ? n.capital : Object.values(s.regions).filter((r) => r.owner === n.id && map.regions[r.id]).map((r) => r.id).sort()[0]
  if (!from) return null
  const at = map.regions[from]
  const dir = hashId(n.id) % 4
  const dLat = [-7, 7, -5, 5][dir]
  const dLng = [9, -9, -11, 11][dir]
  return { from, to: { lat: clamp(at.lat + dLat, -70, 75), lng: ((at.lng + dLng + 540) % 360) - 180 } }
}

function launchTest(s: GameState, map: WorldMap, n: Nation, dev: MissileDevId) {
  const p = n.mprog!
  const range = testRange(map, s, n)
  const now = clockOf(s)
  // Live: a short countdown, then the flight. A turn game's test flies at once and is judged as the month ends.
  const launched = isLive(s) ? now + TEST_RULES.countdown : now
  const flight: MissileTestFlight = { id: `t${n.id}-${++p.seq}`, nationId: n.id, dev, from: range?.from ?? n.capital, to: range?.to ?? { lat: 0, lng: 0 }, launched, lands: launched + TEST_RULES.flight }
  ;(s.missileTests ??= []).push(flight)
  p.testsIn = { turn: s.turn, count: testsUsed(s, n) + 1 }
  note(s, n, `${name(n)} set a test launch of ${DEVS[dev].name.toLowerCase()} on the pad${isLive(s) ? `: launch in ${plural(TEST_RULES.countdown, 'day')}` : ''}.`)
}

/** The rivals that notice a test: enemies, and the nearest nations whose capitals the tested range reaches. */
function noticers(s: GameState, map: WorldMap, n: Nation): NationId[] {
  const home = map.regions[n.capital]
  const reach = MISSILES.ballistic.km * 0.6
  const near = Object.values(s.nations)
    .filter((o) => o.alive && o.id !== n.id && map.regions[o.capital])
    .map((o) => ({ id: o.id, km: home ? distanceKm(home, map.regions[o.capital]) : Infinity, war: atWar(s, n.id, o.id) }))
    .filter((o) => o.war || o.km <= reach)
    .sort((a, b) => Number(b.war) - Number(a.war) || a.km - b.km || (a.id < b.id ? -1 : 1))
  return near.slice(0, TEST_RULES.noticeMax).map((o) => o.id)
}

function landTests(s: GameState, map: WorldMap, upTo: number) {
  if (!s.missileTests?.some((t) => t.lands <= upTo)) return
  const due = s.missileTests.filter((t) => t.lands <= upTo).sort((a, b) => a.lands - b.lands || (a.id < b.id ? -1 : 1))
  s.missileTests = s.missileTests.filter((t) => t.lands > upTo)
  if (!s.missileTests.length) delete s.missileTests
  for (const t of due) resolveTest(s, map, t)
}

/** A test lands: a seeded roll against the odds, experience either way, and the world takes note. Mutates `s`. */
export function resolveTest(s: GameState, map: WorldMap, t: MissileTestFlight) {
  const n = s.nations[t.nationId]
  const d = n?.mprog?.devs[t.dev]
  if (!n?.alive || !d || d.state !== 'test') return
  settle(s, n, Math.max(n.mprog!.asOf, t.lands))
  const p = n.mprog!
  const odds = testOdds(n, t.dev)
  const ok = createRng((s.seed ^ 0x7e57) >>> 0, hashId(t.id)).next() < odds
  const spec = DEVS[t.dev]
  const who = noticers(s, map, n)
  p.stats.tests++
  if (ok) {
    d.state = 'done'
    p.stats.successes++
    p.exp = Math.min(PROGRAM_RULES.exp.max, p.exp + PROGRAM_RULES.exp.success)
    if (p.chief) {
      p.chief.tests++
      if (p.chief.tests >= CHIEF.testsPerSkill && p.chief.skill < CHIEF.maxSkill) {
        p.chief.tests = 0
        p.chief.skill++
      }
    }
    s.missileTension = clamp((s.missileTension ?? 0) + TEST_RULES.tension, 0, 100)
    for (const id of who) addOpinion(s, id, n.id, 'Tested missiles near us', TEST_RULES.opinion, 0.5)
  } else {
    d.fails++
    p.stats.failures++
    p.exp = Math.min(PROGRAM_RULES.exp.max, p.exp + PROGRAM_RULES.exp.failure)
    s.missileTension = clamp((s.missileTension ?? 0) + TEST_RULES.tension / 2, 0, 100)
  }
  const text = ok
    ? `TEST LAUNCH: ${name(n)} successfully tested ${spec.name.toLowerCase()}. ${who.length ? 'Its neighbours are watching.' : ''}`.trim()
    : `TEST LAUNCH: ${name(n)}'s test of ${spec.name.toLowerCase()} failed${d.fails > 1 ? ` again (${d.fails} failures)` : ''}. The engineers learned from it: the next try is likelier to work.`
  note(s, n, text, 'news', who)
}

// ---- The month ----

/**
 * The month's end for every program: work up to the 1st of the next month, tests that land, experience from missiles fired at enemies,
 * a stalled program if the treasury is empty, and staff poached by rivals. Called once from runMonth, after the economy charged the bill.
 */
export function runMissileProgram(s: GameState, map: WorldMap) {
  if (!MPROG.on) return
  const end = monthEnd(s)
  const nations = programNations(s)
  for (const n of nations) settle(s, n, end)
  landTests(s, map, end)
  for (const n of nations) {
    const p = n.mprog!
    // Missiles fired in anger teach the crews something.
    const fired = ledgerOf(n).fired
    const seen = p.firedSeen ?? fired
    if (fired > seen) p.exp = Math.min(PROGRAM_RULES.exp.max, p.exp + Math.min(PROGRAM_RULES.exp.firedMonth, (fired - seen) * PROGRAM_RULES.exp.fired))
    p.firedSeen = fired
    const stalled = n.resources.capital < 0
    if (stalled !== !!p.stalled) {
      if (stalled) {
        p.stalled = true
        note(s, n, `The treasury is empty: ${name(n)}'s missile program stands still this month.`, 'economy')
      } else delete p.stalled
    }
  }
  poach(s, nations)
}

function poach(s: GameState, nations: Nation[]) {
  for (const n of nations) {
    const p = n.mprog!
    const staff = programStaff(n)
    if (staff < POACH.minStaff) continue
    const rivals = nations.filter((o) => o.id !== n.id && o.alive && (atWar(s, n.id, o.id) || programStaff(o) > 0))
    const rng = createRng((s.seed ^ 0x9a7c) >>> 0, s.turn * 100003 + hashId(n.id))
    const guard = Math.max(0.2, 1 - STAFF_FX.analystGuard * usefulStaff(n, 'analyst'))
    const budget = p.budget < 1 ? POACH.leanBudget : p.budget > 1 ? POACH.richBudget : 1
    const chance = POACH.base * guard * budget * (rivals.length ? 1 : POACH.quiet)
    const roll = rng.next()
    if (roll >= chance) continue
    const to = [...rivals].sort((a, b) => Number(atWar(s, n.id, b.id)) - Number(atWar(s, n.id, a.id)) || programStaff(b) - programStaff(a) || (a.id < b.id ? -1 : 1))[0]
    settle(s, n, monthEnd(s))
    if (p.chief && p.chief.skill >= 3 && rng.chance(POACH.chief)) {
      const c = p.chief
      delete p.chief
      p.stats.poached++
      if (to?.mprog && !to.mprog.chief) to.mprog.chief = { ...c, since: s.turn }
      note(s, n, `Your chief designer ${c.name} defected${to ? ` to ${to.name}` : ''}. Hire another, and pay the program well: lean budgets lose people.`, 'news', to ? [to.id] : [])
      continue
    }
    const role = [...STAFF_ROLES].sort((a, b) => (p.staff[b] ?? 0) - (p.staff[a] ?? 0))[0]
    const heads = Math.min(p.staff[role] ?? 0, rng.int(POACH.heads[0], POACH.heads[1]))
    if (heads < 1) continue
    p.staff[role] = (p.staff[role] ?? 0) - heads
    if (!p.staff[role]) delete p.staff[role]
    p.stats.poached += heads
    if (to?.mprog) {
      settle(s, to, monthEnd(s))
      to.mprog.staff[role] = (to.mprog.staff[role] ?? 0) + heads
      to.mprog.stats.gained += heads
      to.mprog.exp = Math.min(PROGRAM_RULES.exp.max, to.mprog.exp + POACH.exp)
    }
    note(s, n, `${plural(heads, STAFF[role].one)} left ${name(n)}'s missile program${to ? ` for ${to.name}` : ''}. Analysts and a good budget keep people.`, 'news', to ? [to.id] : [])
  }
}

/** The monthly chance of losing staff to a rival, for the screen. */
export function poachRisk(s: GameState, n: Nation): number {
  const p = n.mprog
  if (!p || programStaff(n) < POACH.minStaff) return 0
  const rivals = programNations(s).filter((o) => o.id !== n.id && (atWar(s, n.id, o.id) || programStaff(o) > 0))
  const guard = Math.max(0.2, 1 - STAFF_FX.analystGuard * usefulStaff(n, 'analyst'))
  const budget = p.budget < 1 ? POACH.leanBudget : p.budget > 1 ? POACH.richBudget : 1
  return POACH.base * guard * budget * (rivals.length ? 1 : POACH.quiet)
}

// ---- What the screen reads ----

/** Milestones reached, for the strip on the screen. */
export function milestones(n: Nation): MilestoneId[] {
  const p = n.mprog
  if (!p) return []
  const fx = programFx(n)
  const have: Record<MilestoneId, boolean> = {
    founded: p.stats.built > 0,
    team: programStaff(n) >= 5,
    chief: !!p.chief,
    firstTest: p.stats.successes >= 1,
    veteran: p.stats.successes >= 5,
    reach: (fx?.range ?? 0) >= 0.4 - 1e-9,
    precision: (fx?.harm ?? 0) >= 0.25 - 1e-9,
    shield: p.devs.gen3?.state === 'done',
    mirv: p.devs.mirv?.state === 'done',
  }
  return MILESTONES.map((m) => m.id).filter((id) => have[id])
}

/** What a player should hear when the program changed between two states: finished work, tests, losses. For the toasts. */
export function programNews(before: GameState | null, after: GameState, player: NationId): { text: string; tone: 'info' | 'success' | 'error' }[] {
  const a = before?.nations[player]?.mprog
  const b = after.nations[player]?.mprog
  if (!b || !MPROG.on) return []
  const out: { text: string; tone: 'info' | 'success' | 'error' }[] = []
  for (const id of FACILITY_IDS) if ((b.fac[id] ?? 0) > (a?.fac[id] ?? 0)) out.push({ text: `Missile program: ${FACILITIES[id].name} level ${b.fac[id]} is open.`, tone: 'success' })
  for (const id of DEV_IDS) {
    const was = a?.devs[id]
    const now = b.devs[id]
    if (!now || was?.state === now.state) continue
    if (now.state === 'test') out.push({ text: `${DEVS[id].name} is ready for its test launch. Press Test launch in the Missile Program tab.`, tone: 'info' })
    else if (now.state === 'done') out.push({ text: DEVS[id].test !== undefined ? `Test launch succeeded: ${DEVS[id].name} is in service.` : `${DEVS[id].name} is in service.`, tone: 'success' })
  }
  for (const id of DEV_IDS) {
    const was = a?.devs[id]
    const now = b.devs[id]
    if (was && now && now.fails > was.fails) out.push({ text: `Test launch of ${DEVS[id].name.toLowerCase()} failed. Try again: each failure teaches the engineers.`, tone: 'error' })
  }
  if (a && b.stats.poached > a.stats.poached) out.push({ text: 'Rivals poached staff from your missile program. Analysts and a good budget keep people.', tone: 'error' })
  const had = new Set(a ? milestones(before!.nations[player]) : [])
  for (const m of milestones(after.nations[player])) if (!had.has(m) && a) out.push({ text: `Milestone: ${MILESTONES.find((x) => x.id === m)!.name}.`, tone: 'success' })
  return out.slice(0, 4)
}

export interface RivalProgram {
  id: NationId
  name: string
  /** Whether the viewer sees the details (analysts, intelligence, a foreign contractor, or war). */
  detail: boolean
  facilities: number
  devsDone: number
  active: MissileDevId[]
  staff: number
  tests: number
}

/** Rival programs as the viewer's intelligence sees them. Nothing for a viewer with no way to see. */
export function rivalPrograms(s: GameState, viewer: Nation): RivalProgram[] {
  const analysts = viewer.mprog?.staff.analyst ?? 0
  return programNations(s)
    .filter((o) => o.id !== viewer.id)
    .map((o) => {
      const p = o.mprog!
      const visible = analysts >= 1 || !!p.exposed || atWar(s, viewer.id, o.id)
      if (!visible) return null
      return {
        id: o.id,
        name: o.name,
        detail: analysts >= 3 || !!p.exposed,
        facilities: FACILITY_IDS.reduce((sum, f) => sum + (p.fac[f] ?? 0), 0),
        devsDone: DEV_IDS.filter((d) => p.devs[d]?.state === 'done').length,
        active: DEV_IDS.filter((d) => p.devs[d] && p.devs[d]!.state !== 'done'),
        staff: programStaff(o),
        tests: p.stats.tests,
      }
    })
    .filter((x): x is RivalProgram => x !== null)
    .sort((a, b) => b.facilities + b.devsDone - (a.facilities + a.devsDone) || (a.id < b.id ? -1 : 1))
}

/** When a job will be done, in absolute days (Infinity when stalled or not moving). */
export const buildDue = (n: Nation, f: FacilityId): number => {
  const b = n.mprog?.builds.find((x) => x.facility === f)
  const r = buildRate(n)
  return b && r > 0 ? dayAfter(n.mprog!.asOf, b.left / r) : Infinity
}
export const devDue = (n: Nation, id: MissileDevId): number => {
  const d = n.mprog?.devs[id]
  const r = devRate(n, id)
  return d?.state === 'dev' && r > 0 ? dayAfter(n.mprog!.asOf, d.left / r) : Infinity
}

/** Share of a job done as of the clock `now` (for a live progress bar that moves between settles). */
export function liveShare(n: Nation, left: number, total: number, rate: number, now: number): number {
  const p = n.mprog
  if (!p || total <= 0) return 0
  const extra = now > p.asOf ? monthsBetween(p.asOf, now) * rate : 0
  return clamp(1 - (left - extra) / total, 0, 1)
}

export type { DevState, ProgramKind }
