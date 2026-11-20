import { BODIES, BODY_IDS, type BodyId, COMPANIES, DOMESTIC, LABS, MINES, MINE_LEVELS, MISSIONS, NODES, OUTPOST, PAD, ROCKETS, ROCKET_IDS, ROCKET_RULES, SAMPLE_NAMES, SPACE, type CompanySpec, type Mission, type MissionId, type MissionSpec, type RocketId, type SampleKind, type SpaceAction, type SpaceState, type SpaceWorld } from '../data/space'
import { addToSector } from './business'
import { addLog, clamp, enemiesOf, hasTech } from './helpers'
import { programStaff } from './programEffects'
import { createRng } from './rng'
import { discoveryBonus, expBonus, industryOf, industryProgress, mineCostFor, mineMonthsFor, orbitalLevel, outpostCostFor, rocketBuildCost, rocketDevCost, rocketDevMonths, spaceBill, spaceComplexLevel } from './spaceEffects'
import { SAT_RULES } from '../data/space'
import type { Advice } from './advisor'
import type { GameState, Nation, NationId, WorldMap } from './types'

export { spaceEffects, spaceBill, spaceYield, discoveryBonus } from './spaceEffects'

// ---- The agency ----

export const newSpace = (): SpaceState => ({ engineers: 0, astronauts: 0, exp: 0, prestige: 0, rockets: {}, hangar: {}, builds: [], pads: 0, missions: [], done: {}, launches: 0, failures: 0, sats: [], samples: {}, labs: 0, research: [], discoveries: [], bodies: {}, seq: 0, events: [] })

/** The agency, made on first use. */
export function ensureSpace(s: GameState, n: Nation): SpaceState {
  s.space ??= { claims: {}, launches: 0 }
  return (n.space ??= newSpace())
}

export const spaceWorld = (s: GameState): SpaceWorld => s.space ?? { claims: {}, launches: 0 }

/** An advisor item the space program raises. */
export type SpaceAdvice = Omit<Advice, 'weight' | 'urgency'> & { urgency: Advice['urgency']; bonus: number }

/** Why a nation cannot run a space program yet, or null. */
export const spaceLocked = (n: Nation): string | null => (hasTech(n, SPACE.tech) ? null : 'Needs Fifth-Generation Fighters (Research, Aerospace) before a space program can begin')

/** How many engineers and astronauts the people can spare: a share of the specialists. */
export function talentCap(n: Nation, workforce: number): number {
  const sk = n.people?.skills
  const mix = sk ? sk.engineers * 0.65 + sk.scientists * 0.35 : 0.02
  // The missile program draws on the same people: two of its hires take one place here.
  return Math.max(2, Math.floor(workforce * mix * SPACE.talentPerWork * (1 + discoveryBonus(n.space).talent))) - Math.ceil(programStaff(n) / 2)
}

export const staffOf = (sp: SpaceState | undefined) => (sp ? sp.engineers + sp.astronauts : 0)

/** Engineers the agency draws away from the factories, as a share of the workforce. Zero without an agency. */
export const spaceEngineerDemand = (n: Nation, workforce: number): number => (n.space && workforce > 0 ? ((n.space.engineers + n.space.astronauts * 0.5) / (SPACE.talentPerWork * workforce)) * SPACE.engineerDraw : 0)

/** Staff tied up by flights under way. */
export function reservedStaff(sp: SpaceState) {
  let engineers = 0
  let astronauts = 0
  for (const m of sp.missions) {
    if (m.mode === 'house') engineers += m.engineers
    astronauts += m.crew
  }
  return { engineers, astronauts }
}
export const freeEngineers = (sp: SpaceState) => sp.engineers - reservedStaff(sp).engineers
export const freeAstronauts = (sp: SpaceState) => sp.astronauts - reservedStaff(sp).astronauts

/** Places on the launch site: rockets building and in-house flights being built or launched use one each. */
export const padSlots = (n: Nation) => (n.space?.pads ?? 0) + spaceComplexLevel(n)
export const padsInUse = (sp: SpaceState) => sp.builds.length + sp.missions.filter((m) => m.mode === 'house' && (m.phase === 'build' || m.phase === 'launch')).length

// ---- Companies ----

export interface CompanyView {
  id: string
  name: string
  blurb: string
  /** Multiple of the usual premium. */
  price: number
  /** Launch odds. */
  reliability: number
  /** The heaviest rocket rank it flies today. */
  ceiling: number
  deep: number
  domestic: boolean
  home: NationId | null
  /** True once the sector has grown enough for it to exist. */
  open: boolean
  /** The sector size at which it begins, and when it next flies a heavier class. */
  next: number | null
}

export function industryNow(s: GameState): number {
  return industryOf(s.turn, s.space?.launches ?? 0)
}

function viewOf(id: string, c: CompanySpec, industry: number, domestic: boolean, name: string): CompanyView {
  const p = industryProgress(industry)
  const ceiling = Math.min(c.maxClass, c.baseClass + Math.floor(industry / c.step))
  return {
    id,
    name,
    blurb: c.blurb,
    price: c.price * (1 - 0.3 * p),
    reliability: clamp(c.reliability + 0.12 * p, 0, 0.95),
    ceiling,
    deep: c.deep ?? 0,
    domestic,
    home: c.home,
    open: industry >= c.minIndustry,
    next: ceiling < c.maxClass ? (Math.floor(industry / c.step) + 1) * c.step : null,
  }
}

/** The private companies a nation can hire right now, with the price and record each has reached as the sector grew. */
export function companiesFor(s: GameState, n: Nation): CompanyView[] {
  const industry = industryNow(s)
  const out: CompanyView[] = []
  for (const [id, c] of Object.entries(COMPANIES)) out.push(viewOf(id, c, industry, false, c.name))
  if ((n.sectors?.technology ?? 0) >= DOMESTIC.sector) {
    const d: CompanySpec = { name: `${n.name} Space Systems`, blurb: 'A private firm of your own. It works at home, pays your taxes and buys from your engineers.', home: n.id, price: DOMESTIC.price, reliability: DOMESTIC.reliability + Math.min(0.05, (n.sectors.technology - DOMESTIC.sector) * 0.01), baseClass: DOMESTIC.baseClass, maxClass: DOMESTIC.maxClass, step: DOMESTIC.step, minIndustry: 0 }
    out.push(viewOf(DOMESTIC.id, d, industry, true, d.name))
  }
  return out
}

export const companyById = (s: GameState, n: Nation, id: string | undefined) => (id ? companiesFor(s, n).find((c) => c.id === id) : undefined)

// ---- Odds, prices and time ----

/** The smallest rocket in the hangar that can fly a mission, or null. */
export function pickRocket(sp: SpaceState, mission: MissionId): RocketId | null {
  const need = ROCKETS[MISSIONS[mission].rocket].rank
  return ROCKET_IDS.filter((r) => ROCKETS[r].rank >= need && (sp.hangar[r] ?? 0) > 0).sort((a, b) => ROCKETS[a].rank - ROCKETS[b].rank)[0] ?? null
}

export interface Odds {
  launch: number
  arrival: number
  total: number
}

/** The odds of a flight, as the nation or company that flies it stands today. */
export function oddsFor(s: GameState, n: Nation, spec: MissionSpec, mode: 'house' | 'outsource', company: string | undefined, rocket: RocketId): Odds {
  const sp = n.space ?? newSpace()
  const bonus = discoveryBonus(sp)
  const crewed = spec.crew > 0
  const orbit = spec.sat ? SAT_RULES.orbitalOdds * orbitalLevel(n) : 0
  let launch: number
  let arrival: number
  if (mode === 'house') {
    const level = sp.rockets[rocket] ?? 1
    launch = ROCKETS[rocket].reliability + ROCKET_RULES.perLevel * (level - 1) + bonus.reliability + expBonus(sp.exp) + 0.02 * Math.max(0, sp.pads - 1)
    arrival = spec.arrival + bonus.reliability * 0.5 + expBonus(sp.exp) * 0.8 + orbit + (crewed ? bonus.crew + 0.02 * Math.min(2, Math.max(0, sp.astronauts - spec.crew) / Math.max(1, spec.crew)) : 0)
  } else {
    const c = companyById(s, n, company)
    launch = c?.reliability ?? 0.7
    arrival = spec.arrival - 0.02 + orbit + (spec.rocket === 'deep' || spec.rocket === 'interplanetary' ? (c?.deep ?? 0) : 0)
  }
  launch = clamp(launch, SPACE.minOdds, SPACE.maxOdds)
  arrival = clamp(arrival, SPACE.minOdds, SPACE.maxOdds)
  return { launch, arrival, total: launch * arrival }
}

export interface Quote {
  mode: 'house' | 'outsource'
  company?: string
  /** Money due at once (outsource), and the payload cost over the build (in-house). */
  price: number
  payload: number
  /** Money per month while it is built, in-house. */
  monthly: number
  /** What the rocket costs to build: already in the hangar for an in-house flight, part of the price for an outsourced one. */
  rocketCost: number
  months: [number, number, number, number]
  total: number
  odds: Odds
  rocket: RocketId
  /** Why this way cannot be chosen now, or null. */
  problem: string | null
}

const sum4 = (m: number[]) => m.reduce((a, b) => a + b, 0)

/** The price, time, odds and obstacles of flying a mission one way. */
export function quote(s: GameState, n: Nation, id: MissionId, mode: 'house' | 'outsource', company?: string, workforce = 0, pending: SpaceAction[] = []): Quote {
  const spec = MISSIONS[id]
  const sp = n.space ?? newSpace()
  const bonus = discoveryBonus(sp)
  const base = ROCKETS[spec.rocket]
  const have = pickRocket(sp, id)
  const rocket = mode === 'house' ? (have ?? spec.rocket) : spec.rocket
  const rocketCost = rocketBuildCost(rocket, sp, n)
  const industry = industryNow(s)
  const co = mode === 'outsource' ? companyById(s, n, company) : undefined
  let months: [number, number, number, number]
  let price = 0
  let payload = 0
  if (mode === 'house') {
    const t = spec.months[2] > 0 ? Math.max(1, Math.round(spec.months[2] * (1 + bonus.transit))) : 0
    months = [spec.months[0], spec.months[1], t, spec.months[3]]
    payload = spec.payload
  } else {
    months = [Math.max(1, Math.ceil(spec.months[0] * SPACE.outsourceBuild)), spec.months[1], spec.months[2], spec.months[3]]
    price = Math.round((base.cost + spec.payload) * SPACE.premium * (co?.price ?? 1))
    void industry
  }
  const problem = launchProblem(s, n, id, mode, company, workforce, pending)
  return { mode, company, price, payload, monthly: mode === 'house' ? payload / Math.max(1, months[0]) : 0, rocketCost, months, total: sum4(months), odds: oddsFor(s, n, spec, mode, company, rocket), rocket, problem }
}

/** Why a flight cannot be ordered this way, or null. */
export function launchProblem(s: GameState, n: Nation, id: MissionId, mode: 'house' | 'outsource', company: string | undefined, workforce: number, pending: SpaceAction[] = []): string | null {
  const spec = MISSIONS[id]
  if (!spec) return 'Unknown mission'
  const sp = n.space ?? newSpace()
  for (const r of spec.requires) if (!(sp.done[r] ?? 0)) return `First fly: ${MISSIONS[r].name}`
  if (sp.missions.some((m) => m.kind === id) || pending.some((p) => p.kind === 'launch' && p.mission === id)) return 'That mission is already under way'
  if (spec.sat) {
    const live = sp.sats.filter((x) => x.kind === spec.sat).length + sp.missions.filter((m) => MISSIONS[m.kind].sat === spec.sat).length
    if (live >= 2) return 'You already have two of that satellite'
  }
  if (spec.stage === 'outpost' && spec.body) {
    if (s.space?.claims[spec.body]?.owner !== n.id) return `Claim ${BODIES[spec.body].name} first`
    if (sp.bodies[spec.body]?.outpost) return `You already have an outpost on ${BODIES[spec.body].name}`
  }
  if (spec.crew > 0 && freeAstronauts(sp) < spec.crew) return `Needs ${spec.crew} free astronauts (you have ${freeAstronauts(sp)})`
  if (mode === 'house') {
    if (sp.exp < spec.exp) return `Needs ${spec.exp} experience (you have ${Math.floor(sp.exp)}). Outsourcing skips this.`
    if (!pickRocket(sp, id)) return `Needs a ${ROCKETS[spec.rocket].name.toLowerCase()} in the hangar`
    if (freeEngineers(sp) < spec.engineers) return `Needs ${spec.engineers} free engineers (you have ${freeEngineers(sp)})`
    if (padsInUse(sp) >= padSlots(n)) return `The launch site has no free place (${padSlots(n)} in use)`
    if (n.resources.capital < spec.payload / Math.max(1, spec.months[0])) return 'Not enough money for the first month'
    void workforce
    return null
  }
  const co = companyById(s, n, company)
  if (!co) return 'Choose a company'
  if (!co.open) return `${co.name} does not exist yet`
  if (ROCKETS[spec.rocket].rank > co.ceiling) return `${co.name} cannot fly a ${ROCKETS[spec.rocket].name.toLowerCase()} yet`
  return null
}

// ---- Problems and costs of every action ----

export interface SpaceCost {
  capital: number
  tp: number
  pp: number
  steel: number
}

export function spaceCost(s: GameState, n: Nation, a: SpaceAction): SpaceCost {
  const c: SpaceCost = { capital: 0, tp: 0, pp: 0, steel: 0 }
  const sp = n.space
  switch (a.kind) {
    case 'hire':
      c.capital = a.count * (a.role === 'engineer' ? SPACE.hireEngineer : SPACE.hireAstronaut)
      break
    case 'build':
      c.steel = ROCKETS[a.rocket]?.steel ?? 0
      break
    case 'lab':
      c.tp = LABS.tp[Math.min(LABS.max, (sp?.labs ?? 0) + 1)]
      break
    case 'research':
      c.tp = NODES[a.node]?.tp ?? 0
      break
    case 'claim':
      c.pp = SPACE.claimCost
      break
    case 'launch':
      if (a.mode === 'outsource' && MISSIONS[a.mission]) c.capital = quote(s, n, a.mission, 'outsource', a.company).price
      break
    default:
      break
  }
  return c
}

/** Money for the first month of something that is paid monthly. The order is refused when the treasury cannot cover it. */
function firstMonth(n: Nation, a: SpaceAction): number {
  const sp = n.space ?? newSpace()
  switch (a.kind) {
    case 'develop': {
      const level = (sp.rockets[a.rocket] ?? 0) + 1
      return rocketDevCost(a.rocket, level) / rocketDevMonths(a.rocket, level)
    }
    case 'build':
      return rocketBuildCost(a.rocket, sp, n) / ROCKETS[a.rocket].months
    case 'pad':
      return PAD.cost[sp.pads + 1] / PAD.months[sp.pads + 1]
    case 'lab':
      return LABS.cost[sp.labs + 1] / LABS.months[sp.labs + 1]
    case 'research':
      return NODES[a.node].money / NODES[a.node].months
    case 'outpost':
      return outpostCostFor(a.body, (sp.bodies[a.body]?.outpost?.level ?? 0) + 1, sp) / OUTPOST.months[(sp.bodies[a.body]?.outpost?.level ?? 0) + 1]
    case 'mine': {
      const lv = (sp.bodies[a.body]?.outpost?.mines[a.mine]?.level ?? 0) + 1
      return mineCostFor(a.body, a.mine, lv) / mineMonthsFor(a.mine, lv)
    }
    default:
      return 0
  }
}

/** Why an action cannot be taken, or null. `workforce` is the nation's, to cap the staff. */
export function spaceProblem(s: GameState, n: Nation, a: SpaceAction, workforce: number, pending: SpaceAction[] = []): string | null {
  const locked = spaceLocked(n)
  if (locked) return locked
  const sp = n.space ?? newSpace()
  const world = spaceWorld(s)
  const needMoney = firstMonth(n, a)
  const asked = pending.filter((p) => p.kind === a.kind)
  if (needMoney > 0 && n.resources.capital < needMoney) return `Not enough money for the first month (${needMoney.toFixed(0)})`
  switch (a.kind) {
    case 'hire': {
      if (!Number.isInteger(a.count) || a.count < 1) return 'Choose how many to hire'
      const queued = pending.reduce((sum, p) => (p.kind === 'hire' ? sum + p.count : sum), 0)
      const cap = talentCap(n, workforce)
      if (staffOf(sp) + queued + a.count > cap) return cap - staffOf(sp) - queued <= 0 ? `Your people can spare no more specialists (${cap} at most). More schooling and engineers raise it.` : `Your people can spare only ${cap - staffOf(sp) - queued} more (${cap} at most)`
      return null
    }
    case 'dismiss': {
      if (!Number.isInteger(a.count) || a.count < 1) return 'Choose how many'
      const free = a.role === 'engineer' ? freeEngineers(sp) : freeAstronauts(sp)
      return free >= a.count ? null : `Only ${Math.max(0, free)} are not on a flight`
    }
    case 'develop': {
      const spec = ROCKETS[a.rocket]
      if (!spec) return 'Unknown rocket'
      if (sp.dev) return 'Engineers are already developing a rocket'
      const level = (sp.rockets[a.rocket] ?? 0) + 1
      if (level > ROCKET_RULES.maxLevel) return 'That rocket is as good as it will get'
      const prev = ROCKET_IDS[ROCKET_IDS.indexOf(a.rocket) - 1]
      if (prev && !(sp.rockets[prev] ?? 0)) return `Develop the ${ROCKETS[prev].name.toLowerCase()} first`
      if (sp.engineers < spec.engineers) return `Needs ${spec.engineers} engineers (you have ${sp.engineers})`
      return null
    }
    case 'build': {
      const spec = ROCKETS[a.rocket]
      if (!spec) return 'Unknown rocket'
      if (!(sp.rockets[a.rocket] ?? 0)) return `Develop the ${spec.name.toLowerCase()} first`
      if (sp.pads < spec.pad) return `Needs a launch site of level ${spec.pad}`
      if (padsInUse(sp) + asked.length >= padSlots(n)) return `The launch site has no free place (${padSlots(n)} in use)`
      return null
    }
    case 'pad': {
      if (sp.padBuild) return 'The launch site is already being built'
      if (sp.pads >= PAD.max) return 'The launch site is as big as it will be'
      if (sp.pads + 1 >= PAD.complexLevel && spaceComplexLevel(n) < 1) return 'The biggest launch site needs the national space launch complex (Economy, Projects)'
      if (sp.engineers < 2) return 'Hire engineers to run it'
      return null
    }
    case 'launch': {
      if (a.mode !== 'house' && a.mode !== 'outsource') return 'Choose in-house or a company'
      return launchProblem(s, n, a.mission, a.mode, a.company, workforce, pending.filter((p) => p !== a))
    }
    case 'lab': {
      if (sp.labBuild) return 'The labs are already being built'
      if (sp.labs >= LABS.max) return 'The labs are as big as they will be'
      if (sp.engineers < 2) return 'Hire engineers first'
      return null
    }
    case 'research': {
      const node = NODES[a.node]
      if (!node) return 'Unknown discovery'
      if (sp.discoveries.includes(a.node)) return 'Already discovered'
      if (sp.research.some((r) => r.node === a.node)) return 'Already being researched'
      if (sp.research.length + asked.length >= sp.labs) return sp.labs === 0 ? 'Build the labs first' : `Your labs can work on ${sp.labs} at a time`
      if (sp.labs < node.lab) return `Needs labs of level ${node.lab}`
      for (const r of node.requires) if (!sp.discoveries.includes(r)) return `First discover: ${NODES[r].name}`
      for (const [k, v] of Object.entries(node.samples ?? {})) if ((sp.samples[k as SampleKind] ?? 0) < (v ?? 0)) return `Needs ${v} ${SAMPLE_NAMES[k as SampleKind].toLowerCase()} (you have ${sp.samples[k as SampleKind] ?? 0})`
      return null
    }
    case 'claim': {
      const body = BODIES[a.body]
      if (!body) return 'Unknown world'
      const held = world.claims[a.body]
      if (held) return held.owner === n.id ? 'Already yours' : `${s.nations[held.owner]?.name ?? 'Another nation'} claimed it first`
      if (!sp.bodies[a.body]?.landed) return `Land on ${body.name} first`
      return null
    }
    case 'outpost': {
      const body = BODIES[a.body]
      if (!body) return 'Unknown world'
      if (world.claims[a.body]?.owner !== n.id) return `Claim ${body.name} first`
      const op = sp.bodies[a.body]?.outpost
      if (!op) return `Fly the cargo mission to ${body.name} first`
      if (op.building) return 'Already being built'
      if (op.level >= OUTPOST.max) return 'Already a colony'
      if (sp.exp < OUTPOST.exp[op.level + 1]) return `Needs ${OUTPOST.exp[op.level + 1]} experience (you have ${Math.floor(sp.exp)})`
      if (op.unsupplied > 0) return 'It is short of supplies. Get the treasury out of the red.'
      return null
    }
    case 'mine': {
      const body = BODIES[a.body]
      const mine = MINES[a.mine]
      if (!body || !mine) return 'Unknown mine'
      if (!body.mines.includes(a.mine)) return `${body.name} has none of that`
      const op = sp.bodies[a.body]?.outpost
      if (!op || op.level < 1) return `Found an outpost on ${body.name} first`
      if (!sp.discoveries.includes('isru')) return 'Needs the discovery: In-situ resource use (Labs)'
      const have = op.mines[a.mine]
      if (have?.building) return 'Already being built'
      const level = (have?.level ?? 0) + 1
      if (level > MINE_LEVELS.max) return 'Already as big as a mine gets'
      const slots = Object.values(op.mines).filter((m) => m && (m.level > 0 || m.building)).length
      if (!have?.level && slots >= op.level) return `A ${OUTPOST.names[op.level].toLowerCase()} can run ${op.level} mine${op.level === 1 ? '' : 's'}. Raise the outpost.`
      if (sp.exp < mine.exp) return `Needs ${mine.exp} experience (you have ${Math.floor(sp.exp)})`
      if (op.unsupplied > 0) return 'It is short of supplies. Get the treasury out of the red.'
      return null
    }
  }
}

// ---- Doing things ----

const hashStr = (str: string) => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

function note(s: GameState, n: Nation, text: string, good: boolean, news = false) {
  const sp = n.space!
  sp.events.unshift({ turn: s.turn, text, good })
  if (sp.events.length > 14) sp.events.length = 14
  if (n.isPlayer) addLog(s, news ? 'news' : 'economy', text, [n.id])
  else if (news) addLog(s, 'news', text, [n.id])
}

/** Carries out an action. The order's costs that are paid at once have already been taken. */
export function applySpace(s: GameState, n: Nation, a: SpaceAction) {
  const sp = ensureSpace(s, n)
  switch (a.kind) {
    case 'hire':
      if (a.role === 'engineer') sp.engineers += a.count
      else sp.astronauts += a.count
      note(s, n, `${n.name} hired ${a.count} ${a.role}${a.count === 1 ? '' : 's'} for its space agency.`, true)
      break
    case 'dismiss':
      if (a.role === 'engineer') sp.engineers -= a.count
      else sp.astronauts -= a.count
      break
    case 'develop':
      sp.dev = { rocket: a.rocket, progress: 0 }
      note(s, n, `Engineers began developing the ${ROCKETS[a.rocket].name.toLowerCase()}${(sp.rockets[a.rocket] ?? 0) > 0 ? ` (level ${(sp.rockets[a.rocket] ?? 0) + 1})` : ''}.`, true)
      break
    case 'build':
      sp.builds.push({ rocket: a.rocket, progress: 0 })
      break
    case 'pad':
      sp.padBuild = { progress: 0 }
      break
    case 'lab':
      n.resources.tp -= LABS.tp[sp.labs + 1]
      sp.labBuild = { progress: 0 }
      break
    case 'research': {
      const node = NODES[a.node]
      n.resources.tp -= node.tp
      sp.research.push({ node: a.node, progress: 0 })
      for (const [k, v] of Object.entries(node.samples ?? {})) sp.samples[k as SampleKind] = (sp.samples[k as SampleKind] ?? 0) - (v ?? 0)
      note(s, n, `The labs began work on ${node.name.toLowerCase()}.`, true)
      break
    }
    case 'claim':
      spaceWorld(s)
      s.space!.claims[a.body] = { owner: n.id, turn: s.turn }
      note(s, n, `${n.name} claimed ${BODIES[a.body].name}. Nobody else may build there.`, true, true)
      sp.prestige = Math.min(100, sp.prestige + 4)
      break
    case 'outpost': {
      const op = sp.bodies[a.body]!.outpost!
      op.building = { progress: 0 }
      break
    }
    case 'mine': {
      const op = sp.bodies[a.body]!.outpost!
      const have = (op.mines[a.mine] ??= { level: 0 })
      have.building = { progress: 0 }
      break
    }
    case 'launch': {
      const spec = MISSIONS[a.mission]
      const q = quote(s, n, a.mission, a.mode, a.company)
      const rocket = a.mode === 'house' ? pickRocket(sp, a.mission)! : spec.rocket
      if (a.mode === 'house') sp.hangar[rocket] = (sp.hangar[rocket] ?? 0) - 1
      const co = a.mode === 'outsource' ? companyById(s, n, a.company) : undefined
      sp.seq++
      const m: Mission = { id: `m${sp.seq}`, kind: a.mission, mode: a.mode, company: a.company, rocket, crew: spec.crew, engineers: a.mode === 'house' ? spec.engineers : 0, phase: 'build', left: q.months[0], of: q.months[0], started: s.turn, owed: a.mode === 'house' ? spec.payload : 0, odds: [q.odds.launch, q.odds.arrival], by: co?.name }
      sp.missions.push(m)
      // An outsourced price goes to the company, and some of it comes back to a business sector at home.
      if (co && a.mode === 'outsource') payCompany(s, n, co, q.price)
      note(s, n, a.mode === 'house' ? `${n.name} began building the ${spec.name.toLowerCase()} itself: about ${q.total} months.` : `${n.name} hired ${co?.name ?? 'a company'} to fly the ${spec.name.toLowerCase()}: about ${q.total} months.`, true)
      break
    }
  }
}

/** Money paid to a private company lifts a technology sector: at home, a lot of it, and abroad, a little. */
function payCompany(s: GameState, n: Nation, co: CompanyView, price: number) {
  const homeId = co.domestic ? n.id : co.home
  const home = homeId ? s.nations[homeId] : undefined
  if (!home?.alive) return
  const share = co.domestic ? DOMESTIC.share : DOMESTIC.abroadShare
  const sector = home.sectors
  if (!sector) return
  // The size the money buys: the same rate a grant buys, at a modest workforce reference so it is a nudge, not a windfall.
  addToSector(home, 'technology', price * share, 20)
}

/** A mission is over. */
function finish(s: GameState, n: Nation, m: Mission, ok: boolean, where: 'launch' | 'arrival' | 'done') {
  const sp = n.space!
  const spec = MISSIONS[m.kind]
  sp.missions = sp.missions.filter((x) => x.id !== m.id)
  const house = m.mode === 'house'
  const by = house ? n.name : (m.by ?? 'a company')
  if (ok) {
    sp.done[m.kind] = (sp.done[m.kind] ?? 0) + 1
    if (house) sp.exp += spec.gain
    sp.prestige = Math.min(100, sp.prestige + spec.prestige * (house ? 1 : 0.5))
    if (spec.sat) sp.sats.push({ kind: spec.sat, until: s.turn + SPACE.satLife })
    for (const [k, v] of Object.entries(spec.samples ?? {})) {
      const got = house ? (v ?? 0) : Math.max(1, Math.round((v ?? 0) * 0.75))
      sp.samples[k as SampleKind] = (sp.samples[k as SampleKind] ?? 0) + got
    }
    if (spec.body) {
      const b = (sp.bodies[spec.body] ??= {})
      b.surveyed = true
      if (spec.stage === 'landing') b.landed = true
      if (spec.stage === 'outpost') b.outpost = { level: 1, mines: {}, unsupplied: 0 }
    }
    if (spec.tp) n.resources.tp += spec.tp
    const big = spec.prestige >= 10 || spec.stage === 'landing'
    note(s, n, `${spec.name} succeeded${house ? '' : ` (flown by ${by})`}.${spec.stage === 'landing' && spec.body ? ` ${n.name} has landed on ${BODIES[spec.body].name}.` : ''}${spec.sat ? ' The satellite is working.' : ''}${spec.samples ? ' Samples are in the labs.' : ''}`, true, big)
    return
  }
  // A failure: the payload is lost, and with it (in-house) the rocket that was taken from the hangar, and the people on board.
  sp.failures++
  if (house) sp.exp += Math.round(spec.gain * SPACE.failExp)
  let dead = 0
  if (spec.crew > 0) dead = where === 'launch' ? Math.ceil(spec.crew * SPACE.launchCrewLoss) : spec.crew
  sp.astronauts = Math.max(0, sp.astronauts - dead)
  let lostEngineers = 0
  if (house && (spec.crew > 0 || spec.payload >= 150)) {
    lostEngineers = Math.min(sp.engineers, Math.ceil(spec.engineers * 0.08))
    sp.engineers -= lostEngineers
  }
  const hit = (house ? 4 : 2) + (where === 'arrival' ? 2 : 0) + dead * 4 + spec.prestige * 0.4
  sp.prestige = Math.max(0, sp.prestige - hit)
  if (dead > 0) n.stability = Math.max(0, n.stability - (2 + dead))
  note(
    s,
    n,
    `${spec.name} failed${where === 'launch' ? ' on the launch pad' : where === 'arrival' ? ' on arrival' : ''}${house ? '' : ` (flown by ${by})`}. The payload ${house ? 'and the rocket ' : ''}were lost.${dead ? ` ${dead} astronaut${dead === 1 ? '' : 's'} died.` : ''}${lostEngineers ? ` ${lostEngineers} engineer${lostEngineers === 1 ? '' : 's'} left after the inquiry.` : ''} Standing in space ${Math.round(sp.prestige)}.`,
    false,
    dead > 0 || spec.prestige >= 10,
  )
}

function oddsNow(s: GameState, n: Nation, m: Mission): Odds {
  return oddsFor(s, n, MISSIONS[m.kind], m.mode, m.company, m.rocket)
}

/** One month of a flight. Phases run build, launch, transit, arrival; a seeded roll decides the launch and the arrival. */
function stepMission(s: GameState, n: Nation, m: Mission, broke: boolean) {
  const sp = n.space!
  const spec = MISSIONS[m.kind]
  const bonus = discoveryBonus(sp)
  if (m.phase === 'build') {
    // A month the treasury cannot pay is not worked.
    if (broke && m.mode === 'house') return
    if (m.mode === 'house') m.owed -= m.owed / Math.max(1, m.left)
  }
  m.left -= 1
  const rng = createRng((s.seed ^ SPACE.salt ^ hashStr(n.id)) >>> 0, s.turn * 977 + parseInt(m.id.slice(1), 10))
  // Phases can pass at once when one has no months at all.
  for (let guard = 0; guard < 6 && m.left <= 0; guard++) {
    if (m.phase === 'build') {
      m.phase = 'launch'
      m.left = m.of = spec.months[1]
      if (m.left > 0) break
    }
    if (m.phase === 'launch') {
      const o = oddsNow(s, n, m)
      sp.launches++
      if (!rng.chance(o.launch)) {
        finish(s, n, m, false, 'launch')
        return
      }
      s.space!.launches++
      const t = m.mode === 'house' ? (spec.months[2] > 0 ? Math.max(1, Math.round(spec.months[2] * (1 + bonus.transit))) : 0) : spec.months[2]
      m.phase = 'transit'
      m.left = m.of = t
      if (m.left > 0) break
    }
    if (m.phase === 'transit') {
      const o = oddsNow(s, n, m)
      if (!rng.chance(o.arrival)) {
        finish(s, n, m, false, 'arrival')
        return
      }
      m.phase = 'arrival'
      m.left = m.of = spec.months[3]
      if (m.left > 0) break
    }
    if (m.phase === 'arrival') {
      finish(s, n, m, true, 'done')
      return
    }
  }
}

// ---- How fast the work goes (the screen counts months with these, so it says what the month end will do) ----

/** Rockets on the line: a month of work a month, faster with discoveries. */
export const rocketBuildRate = (sp: SpaceState | undefined) => 1 + discoveryBonus(sp).buildSpeed

/** Rocket development: the build rate, slowed (to 30% at worst) when the agency has fewer engineers than the class asks. */
export const rocketDevRate = (sp: SpaceState | undefined, rocket: RocketId) => rocketBuildRate(sp) * clamp((sp?.engineers ?? 0) / ROCKETS[rocket].engineers, 0.3, 1)

/** A bench in the labs: the lab level's speed times how well the universities are staffed with scientists (`researchStaff`). */
export const benchRate = (sp: SpaceState | undefined, researchStaff: number) => LABS.speed[sp?.labs ?? 0] * researchStaff

/**
 * Month ends until `progress` reaches `need` at `rate` a month, adding the rate the way `runSpace` does (same sums, same tolerance),
 * so it is exact. Null when the work does not move (no labs, no scientists).
 */
export function monthsToFinish(progress: number, need: number, rate: number): number | null {
  if (!(rate > 0)) return null
  let p = progress
  let months = 0
  while (p < need - 1e-9 && months < 1200) {
    p += rate
    months++
  }
  return months
}

/** The agency's month: rockets and labs advance, flights fly, outposts are supplied and mines dig. Returns money to give back for work the treasury could not pay. */
export function runSpace(s: GameState, map: WorldMap, n: Nation, researchStaff: number): number {
  const sp = n.space
  if (!sp) return 0
  void map
  s.space ??= { claims: {}, launches: 0 }
  const broke = n.resources.capital < 0
  const bill = spaceBill(sp, n)
  const refund = broke ? bill.building : 0
  const speed = rocketBuildRate(sp)

  if (!broke) {
    // Rocket development.
    if (sp.dev) {
      const spec = ROCKETS[sp.dev.rocket]
      const level = (sp.rockets[sp.dev.rocket] ?? 0) + 1
      sp.dev.progress += rocketDevRate(sp, sp.dev.rocket)
      if (sp.dev.progress >= rocketDevMonths(sp.dev.rocket, level) - 1e-9) {
        sp.rockets[sp.dev.rocket] = level
        note(s, n, `The ${spec.name.toLowerCase()} ${level === 1 ? 'is certified for flight' : `reached level ${level}`}.`, true, level === 1 && spec.rank >= 3)
        delete sp.dev
      }
    }
    // Rockets on the line.
    for (const b of [...sp.builds]) {
      b.progress += speed
      if (b.progress >= ROCKETS[b.rocket].months - 1e-9) {
        sp.builds.splice(sp.builds.indexOf(b), 1)
        sp.hangar[b.rocket] = (sp.hangar[b.rocket] ?? 0) + 1
        note(s, n, `A ${ROCKETS[b.rocket].name.toLowerCase()} rolled out of the hangar.`, true)
      }
    }
    if (sp.padBuild) {
      sp.padBuild.progress += 1
      if (sp.padBuild.progress >= PAD.months[sp.pads + 1] - 1e-9) {
        sp.pads++
        delete sp.padBuild
        note(s, n, `The launch site reached level ${sp.pads}.`, true)
      }
    }
    if (sp.labBuild) {
      sp.labBuild.progress += 1
      if (sp.labBuild.progress >= LABS.months[sp.labs + 1] - 1e-9) {
        sp.labs++
        delete sp.labBuild
        note(s, n, `The space labs reached level ${sp.labs}.`, true)
      }
    }
    // Discoveries.
    for (const r of [...sp.research]) {
      const node = NODES[r.node]
      r.progress += benchRate(sp, researchStaff)
      if (r.progress >= node.months - 1e-9) {
        sp.research.splice(sp.research.indexOf(r), 1)
        sp.discoveries.push(r.node)
        const grant = node.effect.grantsTech
        if (grant && !n.techs.includes(grant)) n.techs.push(grant)
        note(s, n, `Discovery: ${node.name}. ${node.says}`, true, true)
      }
    }
    // Outposts and mines being built.
    for (const body of BODY_IDS) {
      const op = sp.bodies[body]?.outpost
      if (!op) continue
      if (op.building) {
        op.building.progress += 1
        if (op.building.progress >= OUTPOST.months[op.level + 1] - 1e-9) {
          op.level++
          delete op.building
          note(s, n, `${BODIES[body].name}: the base is now a ${OUTPOST.names[op.level].toLowerCase()}.`, true, op.level === 3)
        }
      }
      for (const [id, m] of Object.entries(op.mines)) {
        if (!m?.building) continue
        m.building.progress += 1
        const next = m.level + 1
        if (m.building.progress >= mineMonthsFor(id as keyof typeof MINES, next) - 1e-9) {
          m.level = next
          delete m.building
          note(s, n, `${MINES[id as keyof typeof MINES].name} on ${BODIES[body].name} (level ${next}) is producing.`, true)
        }
      }
    }
  }

  // Flights.
  for (const m of [...sp.missions]) stepMission(s, n, m, broke)

  // Supplies: an outpost needs the treasury. Starved long enough, it loses a level.
  for (const body of BODY_IDS) {
    const op = sp.bodies[body]?.outpost
    if (!op || op.level < 1) continue
    if (broke) {
      op.unsupplied++
      if (op.unsupplied >= SPACE.starveMonths) {
        op.unsupplied = 1
        if (op.level > 1) {
          op.level--
          for (const [id, mine] of Object.entries(op.mines)) if (mine && Object.values(op.mines).filter((x) => x && x.level > 0).length > op.level && mine.level > 0) {
            mine.level = 0
            note(s, n, `${MINES[id as keyof typeof MINES].name} on ${BODIES[body].name} shut down for lack of supplies.`, false)
          }
          note(s, n, `${BODIES[body].name} could not be supplied and shrank to a ${OUTPOST.names[op.level].toLowerCase()}.`, false, true)
        } else note(s, n, `${BODIES[body].name} is short of supplies. Get the treasury out of the red before it is lost.`, false)
      }
    } else op.unsupplied = 0
  }

  // Satellites wear out. Reconnaissance satellites watch every enemy.
  sp.sats = sp.sats.filter((x) => x.until > s.turn)
  if (sp.sats.some((x) => x.kind === 'recon')) for (const e of enemiesOf(s, n.id)) if (s.nations[e]?.alive) s.intel[`${n.id}|${e}`] = Math.max(s.intel[`${n.id}|${e}`] ?? 0, s.turn + 1)
  sp.prestige = Math.max(0, sp.prestige * 0.99)
  return refund
}

// ---- The advisor and the rest of the world ----

export function spaceAdvice(s: GameState, n: Nation, workforce: number): SpaceAdvice[] {
  const sp = n.space
  const out: SpaceAdvice[] = []
  if (!sp) return out
  const target = { desk: 'economy', tab: 'space' } as const
  const idleLab = sp.labs > sp.research.length && Object.values(sp.samples).some((v) => (v ?? 0) > 0)
  if (idleLab) out.push({ urgency: 'idea', bonus: 20, id: 'space-samples', title: 'Samples are waiting in the labs', detail: 'Your labs have free benches and samples from your flights. A discovery can cut launch costs, raise reliability or help the whole economy.', action: 'Open the labs', target })
  for (const body of BODY_IDS) {
    const c = s.space?.claims[body]
    if (c && c.owner !== n.id && sp.bodies[body]?.landed && s.turn - c.turn <= 2) out.push({ urgency: 'soon', bonus: 10, id: `space-lost-${body}`, title: `${s.nations[c.owner]?.name ?? 'A rival'} claimed ${BODIES[body].name}`, detail: 'You landed there too, but they were first to file the claim. Claim the next world sooner.', action: 'Open space', target })
    if (!c && sp.bodies[body]?.landed) out.push({ urgency: 'now', bonus: 30, id: `space-claim-${body}`, title: `Claim ${BODIES[body].name} before a rival does`, detail: `You have landed. A claim costs ${SPACE.claimCost} influence and lets only you build there.`, action: 'Claim it', target })
    const op = sp.bodies[body]?.outpost
    if (op && op.unsupplied > 0) out.push({ urgency: 'now', bonus: 25, id: `space-starve-${body}`, title: `${BODIES[body].name} is short of supplies`, detail: 'The treasury is in the red, so nothing reaches the outpost. After a few months it will lose a level.', action: 'Open space', target })
  }
  const short = staffOf(sp) > talentCap(n, workforce)
  if (short) out.push({ urgency: 'soon', bonus: 5, id: 'space-talent', title: 'The agency has more staff than your people can spare', detail: 'Factories lose engineers to the space program. Dismiss some staff or raise schooling.', action: 'Open space', target })
  const ready = Object.values(sp.hangar).some((v) => (v ?? 0) > 0) && sp.missions.length === 0
  if (ready) out.push({ urgency: 'idea', bonus: 5, id: 'space-ready', title: 'A rocket is waiting in the hangar', detail: 'Fly a mission: satellites bring trade and research, probes bring samples, landings win a world.', action: 'Open missions', target })
  return out
}

/** A flight's place in its journey, from 0 to 1, with the day of the month making it smooth in a live game. */
export function missionProgress(s: GameState, m: Mission, daysInMonthNow: number): number {
  const spec = MISSIONS[m.kind]
  const total = Math.max(1, spec.months[0] + spec.months[1] + spec.months[2] + spec.months[3])
  const order: Mission['phase'][] = ['build', 'launch', 'transit', 'arrival']
  const done = order.indexOf(m.phase)
  let spent = 0
  for (let i = 0; i < done; i++) spent += spec.months[i]
  const within = m.of > 0 ? m.of - m.left + (s.day !== undefined ? s.day / daysInMonthNow : 0) : 0
  return clamp((spent + Math.min(spec.months[done], Math.max(0, within))) / total, 0, 1)
}

export { ROCKET_IDS }

/**
 * The world's month for space: a claim belongs to a nation, so when that nation falls the world is free again. Does nothing, and
 * touches nothing, in a game where nobody has begun a space program.
 */
export function runSpaceWorld(s: GameState) {
  const claims = s.space?.claims
  if (!claims) return
  for (const [body, c] of Object.entries(claims) as [BodyId, { owner: NationId; turn: number }][]) {
    const owner = s.nations[c.owner]
    if (owner?.alive) {
      // A claim nobody settles lapses: squatting on a world blocks everyone else.
      if (s.turn - c.turn <= SPACE.claimMonths || (owner.space?.bodies[body]?.outpost?.level ?? 0) >= 1) continue
      delete claims[body]
      addLog(s, 'news', `${owner.name}'s claim on ${BODIES[body].name} lapsed: nothing was built there in ${SPACE.claimMonths} months. Any nation that has landed may claim it.`, [c.owner])
      continue
    }
    delete claims[body]
    addLog(s, 'news', `${BODIES[body].name} is unclaimed again: ${s.nations[c.owner]?.name ?? 'its owner'} is gone.`, [c.owner])
  }
}

/** One line for the order list. */
export function describeSpace(a: SpaceAction): string {
  switch (a.kind) {
    case 'hire':
      return `Hire ${a.count} ${a.role}${a.count === 1 ? '' : 's'} for the space agency`
    case 'dismiss':
      return `Dismiss ${a.count} ${a.role}${a.count === 1 ? '' : 's'}`
    case 'develop':
      return `Develop the ${ROCKETS[a.rocket].name.toLowerCase()}`
    case 'build':
      return `Build a ${ROCKETS[a.rocket].name.toLowerCase()}`
    case 'pad':
      return 'Raise the launch site'
    case 'launch':
      return `${a.mode === 'house' ? 'Fly' : 'Hire a company to fly'} the ${MISSIONS[a.mission].name.toLowerCase()}`
    case 'lab':
      return 'Raise the space labs'
    case 'research':
      return `Discover: ${NODES[a.node].name}`
    case 'claim':
      return `Claim ${BODIES[a.body].name}`
    case 'outpost':
      return `Raise the base on ${BODIES[a.body].name}`
    case 'mine':
      return `${MINES[a.mine].name} on ${BODIES[a.body].name}`
  }
}
