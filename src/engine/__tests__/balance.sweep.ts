/**
 * Balance sweep: long headless games on the real world map with a bot in every seat, and a scripted "optimizer" player who
 * squeezes the new systems as hard as the rules allow. NOT a test file (the name does not end in .test.ts), so the normal suite
 * never runs it. See docs/BALANCE.md, "How to re-run the sweep".
 *
 *   // src/engine/__tests__/x.scratch.test.ts   (delete it afterwards; the name is git-ignored locally)
 *   import { it } from 'vitest'
 *   import { sweepWorlds, printSweep } from './balance.sweep'
 *   it('sweep', () => { printSweep(sweepWorlds({ difficulties: ['easy', 'normal', 'hard'], seeds: [1, 2], months: 120 })) }, 3_600_000)
 *   // then:  npx vitest run src/engine/__tests__/x.scratch.test.ts
 */
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { CAMPAIGN_IDS, SOCIAL } from '../../data/society'
import { LOCAL_IDS } from '../../data/localProjects'
import { PROJECT_IDS } from '../../data/projects'
import { computeEconomy } from '../economy'
import { monthlyCost, projectLevel } from '../industry'
import { buildRoom } from '../missiles'
import { validateOrder } from '../orders'
import { campaignPrice } from '../society'
import { localLevel, localMonthly, rushCost } from '../works'
import { resolveTurn } from '../resolveTurn'
import type { Difficulty, GameState, MissileType, Nation, Order, ProjectId, SocialId } from '../types'
import { invariantProblems } from './invariants'

export interface Sample {
  month: number
  alive: number
  /** Share of all countries held by the biggest nation (0-1), and its id. */
  topShare: number
  topId: string
  /** Gross income of every living nation added together, and the median nation's gross. */
  worldGross: number
  medianGross: number
  /** Median and minimum treasury, and how many nations are in the red. */
  medianCapital: number
  minCapital: number
  inRed: number
  defaulted: number
  debtTotal: number
  /** Stability: mean, 10th percentile, and how many nations are under 30 or over 95. */
  stabMean: number
  stabP10: number
  stabLow: number
  stabHigh: number
  rebelRegions: number
  /** Nations holding at least one social program / national project / project in a country / the missile program. */
  withPrograms: number
  withProjects: number
  withLocal: number
  withMissileProgram: number
  /** Average program levels per nation holding any, average care bill over gross. */
  avgLevels: number
  careShare: number
  projectShare: number
  wars: number
  arsenal: Record<MissileType, number>
  tiers: number[]
}

export interface Tally {
  strikes: Record<MissileType, number>
  strikeOrders: Record<MissileType, number>
  built: Record<MissileType, number>
  chains: number
  orders: Record<string, number>
  /** Invariant violations seen (first few distinct), checked every sample. */
  problems: string[]
}

export interface RunResult {
  seed: number
  difficulty: Difficulty
  samples: Sample[]
  tally: Tally
  final: GameState
}

const KINDS: MissileType[] = ['cruise', 'tactical', 'hypersonic', 'ballistic']
const zeroKinds = (): Record<MissileType, number> => ({ cruise: 0, tactical: 0, hypersonic: 0, ballistic: 0 })
const pct = (xs: number[], q: number) => {
  const a = [...xs].sort((x, y) => x - y)
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0
}

export function sample(s: GameState, map: ReturnType<typeof getWorld>['map']): Sample {
  const alive = Object.values(s.nations).filter((n) => n.alive)
  const count: Record<string, number> = {}
  for (const r of Object.values(s.regions)) count[r.owner] = (count[r.owner] ?? 0) + 1
  const total = Object.keys(s.regions).length
  let top = ''
  let topN = 0
  for (const [id, c] of Object.entries(count)) {
    if (c > topN) {
      top = id
      topN = c
    }
  }
  const econ = alive.map((n) => computeEconomy(s, map, n.id))
  const gross = econ.map((e) => e.gross)
  const cap = alive.map((n) => n.resources.capital)
  const stab = alive.map((n) => n.stability)
  const programmed = alive.filter((n) => n.social && Object.values(n.social).some((p) => p && p.level > 0))
  const levels = programmed.map((n) => Object.values(n.social!).reduce((a, p) => a + (p?.level ?? 0), 0))
  const arsenal = zeroKinds()
  for (const n of alive) for (const k of KINDS) arsenal[k] += k === 'hypersonic' ? n.military.units.missile : (n.arsenal?.[k] ?? 0)
  const grossSum = gross.reduce((a, b) => a + b, 0)
  return {
    month: s.turn - 1,
    alive: alive.length,
    topShare: topN / total,
    topId: top,
    worldGross: grossSum,
    medianGross: pct(gross, 0.5),
    medianCapital: pct(cap, 0.5),
    minCapital: Math.min(...cap),
    inRed: alive.filter((n) => n.resources.capital < 0).length,
    defaulted: alive.filter((n) => (n.defaultedUntil ?? 0) > s.turn).length,
    debtTotal: alive.reduce((a, n) => a + n.debt, 0),
    stabMean: stab.reduce((a, b) => a + b, 0) / Math.max(1, stab.length),
    stabP10: pct(stab, 0.1),
    stabLow: stab.filter((x) => x < 30).length,
    stabHigh: stab.filter((x) => x > 95).length,
    rebelRegions: Object.values(s.regions).filter((r) => r.rebels > 0).length,
    withPrograms: programmed.length,
    withProjects: alive.filter((n) => Object.keys(n.projects ?? {}).length > 0).length,
    withLocal: new Set(Object.values(s.regions).filter((r) => r.works && Object.keys(r.works).length > 0).map((r) => r.owner)).size,
    withMissileProgram: alive.filter((n) => (n.missileProgram ?? 0) > 0).length,
    avgLevels: levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 0,
    careShare: grossSum > 0 ? econ.reduce((a, e) => a + e.society.bill, 0) / grossSum : 0,
    projectShare: grossSum > 0 ? econ.reduce((a, e) => a + e.projects.building + e.projects.upkeep, 0) / grossSum : 0,
    wars: s.wars.length,
    arsenal,
    tiers: [1, 2, 3, 4, 5].map((t) => alive.filter((n) => n.tier === t).length),
  }
}

export function tallyOrders(tally: Tally, orders: Order[], s: GameState) {
  for (const o of orders) {
    tally.orders[o.type] = (tally.orders[o.type] ?? 0) + 1
    if (o.type === 'strike' && o.weapon === 'missile') {
      const k = o.kind ?? 'hypersonic'
      tally.strikes[k] += o.count ?? 1
      tally.strikeOrders[k]++
      const victim = s.regions[o.target]?.owner
      if (victim && s.nations[o.nationId]?.struckBy?.[victim] !== undefined && s.turn - (s.nations[o.nationId].struckBy![victim] ?? -99) <= 2) tally.chains++
    }
    if (o.type === 'buildMissiles') tally.built[o.kind] += o.count
  }
}

export interface RunOptions {
  seed: number
  difficulty: Difficulty
  months: number
  player?: string
  sampleEvery?: number
  /** Edit the starting world before month 1. */
  setup?: (s: GameState) => void
  /** Extra orders for a nation that is not the bots' (e.g. an optimizer), added each month. */
  extra?: (s: GameState, map: ReturnType<typeof getWorld>['map']) => Order[]
  /** Nations the bots must leave alone (their orders are dropped), for a scripted player. */
  scripted?: string[]
}

export function runBotWorld(o: RunOptions): RunResult {
  const { map } = getWorld()
  let s = createInitialState(map, { playerRegionId: o.player ?? 'poland', seed: o.seed, difficulty: o.difficulty, goal: 'classic', victoryShare: 2 })
  s.nextEventTurn = 99999
  o.setup?.(s)
  const tally: Tally = { strikes: zeroKinds(), strikeOrders: zeroKinds(), built: zeroKinds(), chains: 0, orders: {}, problems: [] }
  const samples: Sample[] = [sample(s, map)]
  const every = o.sampleEvery ?? 12
  const skip = new Set(o.scripted ?? [])
  for (let i = 0; i < o.months; i++) {
    // The bots play every seat, so a fallen "player" must not end the run.
    s.outcome = 'playing'
    s.winner = null
    let orders = [...generateAllBotOrders(s, map), ...(skip.has(s.playerId) ? [] : generateBotOrders(s, map, s.playerId, true))]
    if (skip.size) orders = orders.filter((x) => !skip.has(x.nationId))
    if (o.extra) orders.push(...o.extra(s, map))
    tallyOrders(tally, orders, s)
    s = resolveTurn(s, map, orders)
    if ((i + 1) % every === 0) samples.push(sample(s, map))
    if ((i + 1) % 6 === 0) for (const p of invariantProblems(s)) if (tally.problems.length < 12 && !tally.problems.includes(p)) tally.problems.push(`m${i + 1} ${p}`)
  }
  return { seed: o.seed, difficulty: o.difficulty, samples, tally, final: s }
}

export interface SweepOptions {
  difficulties: Difficulty[]
  seeds: number[]
  months: number
  player?: string
  sampleEvery?: number
}

export function sweepWorlds(o: SweepOptions): RunResult[] {
  const out: RunResult[] = []
  for (const difficulty of o.difficulties) for (const seed of o.seeds) out.push(runBotWorld({ seed, difficulty, months: o.months, player: o.player, sampleEvery: o.sampleEvery }))
  return out
}

const f = (x: number, d = 0) => x.toFixed(d)

export function printSweep(runs: RunResult[]) {
  for (const r of runs) {
    const lines: string[] = [`=== ${r.difficulty} seed ${r.seed} ===`]
    lines.push('mo  alive top%  topId        wGross  medGross medCap  inRed dflt stabM p10 <30 >95 rebel prog proj loc msl lvls care% proj% wars tiers')
    for (const x of r.samples)
      lines.push(
        `${String(x.month).padStart(3)} ${String(x.alive).padStart(4)} ${f(x.topShare * 100, 1).padStart(5)} ${x.topId.padEnd(12)} ${f(x.worldGross).padStart(7)} ${f(x.medianGross, 1).padStart(7)} ${f(x.medianCapital).padStart(7)} ${String(x.inRed).padStart(4)} ${String(x.defaulted).padStart(4)} ${f(x.stabMean, 1).padStart(5)} ${f(x.stabP10).padStart(3)} ${String(x.stabLow).padStart(3)} ${String(x.stabHigh).padStart(3)} ${String(x.rebelRegions).padStart(4)} ${String(x.withPrograms).padStart(4)} ${String(x.withProjects).padStart(4)} ${String(x.withLocal).padStart(3)} ${String(x.withMissileProgram).padStart(3)} ${f(x.avgLevels, 1).padStart(4)} ${f(x.careShare * 100, 1).padStart(5)} ${f(x.projectShare * 100, 1).padStart(5)} ${String(x.wars).padStart(4)} ${x.tiers.join('/')}`,
      )
    const t = r.tally
    const last = r.samples[r.samples.length - 1]
    lines.push(`strikes fired ${JSON.stringify(t.strikes)} (orders ${JSON.stringify(t.strikeOrders)}), built ${JSON.stringify(t.built)}, answers-to-strikes ${t.chains}, arsenal at end ${JSON.stringify(last.arsenal)}`)
    lines.push(`invariant problems: ${t.problems.length ? t.problems.join(' ; ') : 'none'}`)
    lines.push(`orders ${Object.entries(t.orders).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`)
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }
}

export type { Nation }

// ---------------------------------------------------------------------------------------------------------------------
// Twin runs: the same quiet world twice, once with a change, to measure what the change is worth in money.
// ---------------------------------------------------------------------------------------------------------------------

export interface TwinPoint {
  gross: number
  net: number
  capital: number
  societyBill: number
  projectBill: number
  stability: number
  tp: number
  pp: number
  population: number
  health: number
  schooling: number
  unemployment: number
  regions: number
}

type Map_ = ReturnType<typeof getWorld>['map']

/** Runs a nation forward with the given orders (none by default: every other nation sits still) and records each month. */
export function twinSeries(state: GameState, map: Map_, nationId: string, months: number, orders?: (s: GameState, month: number) => Order[]): TwinPoint[] {
  let s = state
  const out: TwinPoint[] = []
  for (let i = 0; i < months; i++) {
    const e = computeEconomy(s, map, nationId)
    const n = s.nations[nationId]
    out.push({
      gross: e.gross,
      net: e.netCapital,
      capital: n.resources.capital,
      societyBill: e.society.bill,
      projectBill: e.projects.building + e.projects.upkeep,
      stability: n.stability,
      tp: n.resources.tp,
      pp: n.resources.pp,
      population: e.population,
      health: n.people.health,
      schooling: n.people.schooling,
      unemployment: n.people.unemployment,
      regions: e.regionCount,
    })
    s = resolveTurn(s, map, orders ? orders(s, i) : [])
  }
  return out
}

export function freshWorld(seed: number, difficulty: Difficulty, player: string) {
  const { map } = getWorld()
  const s = createInitialState(map, { playerRegionId: player, seed, difficulty, goal: 'classic', victoryShare: 2 })
  s.nextEventTurn = 99999
  return { s, map }
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

// ---------------------------------------------------------------------------------------------------------------------
// The optimizer: a scripted player who squeezes programs, projects, rushing and missiles as hard as the rules allow.
// ---------------------------------------------------------------------------------------------------------------------

/** Programs in the order an optimizer takes them: best money back first, then calm. */
export const OPTIMIZER_PROGRAMS: SocialId[] = ['courts', 'transit', 'smallLoans', 'apprenticeships', 'mentalHealth', 'scholarships', 'libraries', 'minimumWage', 'festivals', 'workerRights', 'policing', 'clinics', 'cleanWater', 'schoolMeals', 'childBenefit', 'integration', 'elderCare', 'foodAid', 'broadcasting', 'surveillance', 'jobsGuarantee', 'parentalLeave']
export const OPTIMIZER_PROJECTS: ProjectId[] = ['rail', 'grid', 'broadband', 'waterNetwork', 'sciencePark', 'digitalGov', 'openUniversity', 'ports', 'medCentre', 'aiLab', 'stadium', 'grainReserve', 'fusion', 'expo', 'plannedCity', 'spaceComplex', 'marsMission']

export interface OptimizerOptions {
  /** Highest program level to aim for (3 needs a Regional power). */
  programLevel?: number
  rush?: boolean
  missiles?: boolean
  local?: boolean
  /** Run a campaign whenever one is ready. */
  campaigns?: boolean
  /** Cash kept back, default 80. */
  reserve?: number
}

/**
 * One month of the optimizer's orders for a nation. Every order is validated, as the bots' are, and a monthly budget keeps it
 * out of debt (an optimizer that spends everything goes bankrupt in a year: the sweep showed it). `reserve` is the cash kept back.
 */
export function optimizerOrders(s: GameState, map: Map_, nationId: string, o: OptimizerOptions = {}): Order[] {
  const orders: Order[] = []
  const n = s.nations[nationId]
  if (!n?.alive) return orders
  const tryAdd = (x: Order) => {
    if (validateOrder(s, map, x, orders) === null) {
      orders.push(x)
      return true
    }
    return false
  }
  const e = computeEconomy(s, map, nationId)
  const reserve = o.reserve ?? 80
  // Surplus a month that new bills may use, and cash that one-off prices may use.
  let room = e.netCapital - 2
  let cash = n.resources.capital - reserve
  const want = o.programLevel ?? 3
  // Programs: up to three raises a month, each only if the monthly bill fits in the surplus.
  let raised = 0
  for (const id of OPTIMIZER_PROGRAMS) {
    const lvl = n.social?.[id]?.level ?? 0
    const bill = SOCIAL[id].cost * e.workforce
    if (lvl >= want || raised >= 3 || bill > room) continue
    if (tryAdd({ type: 'setSocial', nationId, policy: id, level: lvl + 1 })) {
      raised++
      room -= bill
    }
  }
  if (o.campaigns !== false) {
    for (const c of CAMPAIGN_IDS) {
      const price = campaignPrice(s, n, c)
      if (price * 3 < cash && tryAdd({ type: 'campaign', nationId, campaign: c })) cash -= price
    }
  }
  // National projects: fill every slot the surplus can feed, and rush what is under way when cash allows.
  for (const id of OPTIMIZER_PROJECTS) {
    const lvl = projectLevel(n, id)
    if (lvl >= 3) continue
    const monthly = monthlyCost(id, lvl + 1)
    if (monthly * 1.5 > room) continue
    if (tryAdd({ type: 'startProject', nationId, project: id })) room -= monthly * 1.5
  }
  if (o.rush !== false) {
    for (const id of PROJECT_IDS) {
      const p = n.projects[id]
      if (!p || p.done) continue
      const price = rushCost(s, n, id)
      if (price * 2 < cash && tryAdd({ type: 'rushProject', nationId, project: id })) cash -= price
    }
  }
  if (o.local !== false) {
    const mine = Object.values(s.regions).filter((r) => r.owner === nationId)
    for (const id of LOCAL_IDS) {
      for (const r of mine) {
        const monthly = localMonthly(id, localLevel(r, id) + 1, r)
        if (monthly * 1.5 > room) continue
        if (tryAdd({ type: 'startProject', nationId, project: id, regionId: r.id })) {
          room -= monthly * 1.5
          break
        }
      }
    }
    if (o.rush !== false) {
      for (const r of mine) {
        for (const id of LOCAL_IDS) {
          if (!r.works?.[id] || r.works[id]!.done) continue
          const price = rushCost(s, n, id, r.id)
          if (price * 2 < cash && tryAdd({ type: 'rushProject', nationId, project: id, regionId: r.id })) cash -= price
        }
      }
    }
  }
  if (o.missiles !== false && cash > 500) {
    tryAdd({ type: 'fundMissiles', nationId })
    for (const kind of ['cruise', 'tactical'] as const) tryAdd({ type: 'buildMissiles', nationId, kind, count: Math.min(buildRoom(n, s.turn), Math.floor((cash - 400) / 20)) })
  }
  return orders
}
