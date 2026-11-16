import { BODIES, BODY_IDS, HE3, LABS, MINES, MINE_IDS, MINE_LEVELS, MISSIONS, NODES, OUTPOST, PAD, ROCKETS, ROCKET_IDS, ROCKET_RULES, SAT_EFFECT, SAT_RULES, SPACE, SPACE_UPKEEP, type BodyId, type MineId, type NodeEffect, type RocketId, type SpaceState } from '../data/space'
import type { PolicyEffects } from '../data/government'
import type { Nation } from './types'

/**
 * The pure arithmetic of the space program: what a nation's discoveries, satellites, outposts and mines add to its economy, and what
 * the agency costs each month. Nothing here touches the game, so the economy can read it for any nation, and a nation with no space
 * agency gets exactly the zeros it always had.
 */

type SpaceNation = Pick<Nation, 'space'> & Partial<Pick<Nation, 'systems' | 'projects'>>

/** What a nation's discoveries add up to. */
export function discoveryBonus(sp: SpaceState | undefined): Required<Omit<NodeEffect, 'grantsTech'>> {
  const out = { reliability: 0, rocketCost: 0, buildSpeed: 0, transit: 0, upkeep: 0, mining: 0, outpostCost: 0, talent: 0, crew: 0, output: 0, research: 0, stability: 0, factory: 0, trade: 0, growth: 0, foodUse: 0, influence: 0, health: 0 }
  if (!sp) return out
  for (const id of sp.discoveries) {
    const e = NODES[id]?.effect
    if (!e) continue
    for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] += e[k] ?? 0
  }
  // Soft ceilings: the last discoveries still help, but they never stack without limit.
  for (const [k, cap] of Object.entries(SPACE.discoveryCap)) if (k in out) out[k as keyof typeof out] = Math.min(out[k as keyof typeof out], cap)
  return out
}

export const spaceComplexLevel = (n: Pick<Nation, 'projects'>): number => {
  const p = n.projects?.spaceComplex
  return !p ? 0 : (p.level ?? (p.done ? 1 : 0))
}
export const orbitalLevel = (n: Partial<Pick<Nation, 'systems'>>): number => n.systems?.orbital ?? 0

/** Experience makes launches safer, with less and less to gain. */
export const expBonus = (exp: number) => SPACE.expBonus * (exp / (exp + SPACE.expHalf))

/** The world's space industry: it grows with time and with every flight. */
export const industryOf = (turn: number, launches: number) => turn * SPACE.industryPerMonth + launches * SPACE.industryPerLaunch
/** How far the industry has come, 0 to 1. */
export const industryProgress = (industry: number) => 1 - Math.exp(-industry / SPACE.industryHalf)

// ---- Costs of building things ----

export const rocketBuildCost = (id: RocketId, sp: SpaceState | undefined, n: SpaceNation) => {
  const b = discoveryBonus(sp)
  const complex = spaceComplexLevel(n as Nation) > 0 ? 0.9 : 1
  return ROCKETS[id].cost * Math.max(0.4, 1 + b.rocketCost) * complex
}
export const rocketDevCost = (id: RocketId, level: number) => Math.round(ROCKETS[id].dev * ROCKET_RULES.levelCost[level])
export const rocketDevMonths = (id: RocketId, level: number) => Math.max(1, Math.round(ROCKETS[id].devMonths * ROCKET_RULES.levelTime[level]))
export const outpostCostFor = (body: BodyId, level: number, sp: SpaceState | undefined) => Math.round(OUTPOST.cost[level] * BODIES[body].distance * Math.max(0.4, 1 + discoveryBonus(sp).outpostCost))
export const mineCostFor = (body: BodyId, mine: MineId, level: number) => Math.round(MINES[mine].cost * MINE_LEVELS.cost[level] * BODIES[body].distance)
export const mineMonthsFor = (mine: MineId, level: number) => Math.round(MINES[mine].months * MINE_LEVELS.months[level])

/** Everything put into an outpost up to a level (the first level is the cargo that landed): its upkeep is a share of this. */
export const outpostInvested = (body: BodyId, level: number) => {
  if (level < 1) return 0
  let total = MISSIONS[`outpost_${body}` as keyof typeof MISSIONS].payload
  for (let l = 2; l <= level; l++) total += Math.round(OUTPOST.cost[l] * BODIES[body].distance)
  return total
}
export const mineInvested = (body: BodyId, mine: MineId, level: number) => {
  let total = 0
  for (let l = 1; l <= level; l++) total += Math.round(MINES[mine].cost * MINE_LEVELS.cost[l] * BODIES[body].distance)
  return total
}

// ---- What the outposts make ----

export interface SpaceYield {
  steel: number
  oil: number
  money: number
  /** Helium-3 mined, in units a month. */
  he3: number
  /** Grid power from helium-3. */
  power: number
  research: number
  /** Share of upkeep that water saves. */
  water: number
  stability: number
  /** What each outpost makes, for the screen. */
  parts: { body: BodyId; mine?: MineId; text: string }[]
}

const ZERO_YIELD: SpaceYield = Object.freeze({ steel: 0, oil: 0, money: 0, he3: 0, power: 0, research: 0, water: 0, stability: 0, parts: [] }) as SpaceYield

/** Monthly output of every outpost and mine a nation has. An outpost the treasury cannot supply makes nothing. */
export function spaceYield(sp: SpaceState | undefined): SpaceYield {
  if (!sp) return ZERO_YIELD
  const bonus = discoveryBonus(sp)
  const out: SpaceYield = { steel: 0, oil: 0, money: 0, he3: 0, power: 0, research: 0, water: 0, stability: 0, parts: [] }
  let colonies = 0
  for (const body of BODY_IDS) {
    const op = sp.bodies[body]?.outpost
    if (!op || op.level < 1 || op.unsupplied > 0) continue
    out.research += BODIES[body].research * op.level
    if (op.level >= 3) colonies++
    for (const id of MINE_IDS) {
      const m = op.mines[id]
      if (!m || m.level < 1) continue
      const spec = MINES[id]
      const k = MINE_LEVELS.power[m.level] * BODIES[body].richness * (1 + bonus.mining)
      const steel = (spec.steel ?? 0) * k
      const oil = (spec.oil ?? 0) * k
      const money = (spec.money ?? 0) * k
      const he3 = (spec.he3 ?? 0) * k
      out.steel += steel
      out.oil += oil
      out.money += money
      out.he3 += he3
      out.water += (spec.water ?? 0) * MINE_LEVELS.power[m.level]
      const bits = [steel && `${steel.toFixed(1)} steel`, oil && `${oil.toFixed(1)} oil`, money && `${money.toFixed(1)} money`, he3 && `${he3.toFixed(1)} helium-3`].filter(Boolean)
      if (spec.water) bits.push(`upkeep ${Math.round(spec.water * MINE_LEVELS.power[m.level] * 100)}% less`)
      out.parts.push({ body, mine: id, text: bits.join(', ') })
    }
  }
  out.power = out.he3 * HE3.power
  out.water = Math.min(0.4, out.water)
  out.stability = Math.min(3, colonies * OUTPOST.colonyStability)
  return out
}

/** What one mine at a level makes each month on a body, for the screen to show before it is built. */
export function mineOutput(body: BodyId, mine: MineId, level: number, sp: SpaceState | undefined) {
  const spec = MINES[mine]
  const k = MINE_LEVELS.power[level] * BODIES[body].richness * (1 + discoveryBonus(sp).mining)
  return { steel: (spec.steel ?? 0) * k, oil: (spec.oil ?? 0) * k, money: (spec.money ?? 0) * k, he3: (spec.he3 ?? 0) * k, water: (spec.water ?? 0) * MINE_LEVELS.power[level] }
}

// ---- The monthly bill ----

export interface SpaceBill {
  /** Pay of the engineers and astronauts. */
  staff: number
  /** Upkeep of the launch site, the labs and every finished outpost and mine. */
  upkeep: number
  /** Money that moves things forward: development, rockets, payloads, the labs' work and what is being built out there. A month the treasury cannot pay is not worked. */
  building: number
  total: number
}

/** The agency's cost this month. */
export function spaceBill(sp: SpaceState | undefined, n: SpaceNation = { space: sp }): SpaceBill {
  if (!sp) return { staff: 0, upkeep: 0, building: 0, total: 0 }
  const bonus = discoveryBonus(sp)
  const y = spaceYield(sp)
  const eased = Math.max(0.3, 1 + bonus.upkeep)
  const staff = (sp.engineers * SPACE.salaryEngineer + sp.astronauts * SPACE.salaryAstronaut) * eased
  let upkeep = PAD.upkeep[sp.pads] + LABS.upkeep[sp.labs]
  let held = 0
  for (const body of BODY_IDS) {
    const op = sp.bodies[body]?.outpost
    if (!op) continue
    held += outpostInvested(body, op.level) * SPACE_UPKEEP
    for (const id of MINE_IDS) held += mineInvested(body, id, op.mines[id]?.level ?? 0) * SPACE_UPKEEP
  }
  upkeep = (upkeep + held * (1 - y.water)) * eased
  let building = 0
  if (sp.dev) {
    const level = (sp.rockets[sp.dev.rocket] ?? 0) + 1
    building += rocketDevCost(sp.dev.rocket, level) / rocketDevMonths(sp.dev.rocket, level)
  }
  for (const b of sp.builds) building += rocketBuildCost(b.rocket, sp, n) / ROCKETS[b.rocket].months
  if (sp.padBuild) building += PAD.cost[sp.pads + 1] / PAD.months[sp.pads + 1]
  if (sp.labBuild) building += LABS.cost[sp.labs + 1] / LABS.months[sp.labs + 1]
  for (const r of sp.research) building += NODES[r.node].money / NODES[r.node].months
  for (const m of sp.missions) if (m.mode === 'house' && m.phase === 'build') building += m.owed / Math.max(1, m.left)
  for (const body of BODY_IDS) {
    const op = sp.bodies[body]?.outpost
    if (!op) continue
    if (op.building) building += outpostCostFor(body, op.level + 1, sp) / OUTPOST.months[op.level + 1]
    for (const id of MINE_IDS) {
      const m = op.mines[id]
      if (m?.building) building += mineCostFor(body, id, m.level + 1) / mineMonthsFor(id, m.level + 1)
    }
  }
  return { staff, upkeep, building, total: staff + upkeep + building }
}

// ---- What it does for the economy ----

export interface SpaceEffects {
  policy: Partial<PolicyEffects>
  steel: number
  oil: number
  /** Money a month from mines. */
  money: number
  /** Research a month, added to what universities make. */
  research: number
  /** Extra power for factories from helium-3. */
  power: number
  health: number
  /** The money line the economy shows. */
  bill: SpaceBill
  yield: SpaceYield
}

const NONE: SpaceEffects = Object.freeze({ policy: Object.freeze({}), steel: 0, oil: 0, money: 0, research: 0, power: 0, health: 0, bill: Object.freeze({ staff: 0, upkeep: 0, building: 0, total: 0 }), yield: ZERO_YIELD }) as SpaceEffects

/** Everything the space program adds to a nation's economy this month. A nation with no agency gets the same zeros every time. */
export function spaceEffects(n: SpaceNation): SpaceEffects {
  const sp = n.space
  if (!sp) return NONE
  const b = discoveryBonus(sp)
  const y = spaceYield(sp)
  const orbital = 1 + SAT_RULES.perOrbitalLevel * orbitalLevel(n)
  const policy: Partial<PolicyEffects> = { output: b.output, research: b.research, factory: b.factory, trade: b.trade, growth: b.growth, foodUse: b.foodUse, influence: b.influence, stability: b.stability + y.stability + sp.prestige * 0.015 }
  policy.influence = (policy.influence ?? 0) + sp.prestige * 0.004
  const seen: Partial<Record<string, number>> = {}
  const live = [...sp.sats].sort((a, c) => a.until - c.until)
  for (const sat of live) {
    const e = SAT_EFFECT[sat.kind]
    const k = (seen[sat.kind] ?? 0) === 0 ? 1 : SAT_RULES.second
    seen[sat.kind] = (seen[sat.kind] ?? 0) + 1
    policy.trade = (policy.trade ?? 0) + (e.trade ?? 0) * k * orbital
    policy.research = (policy.research ?? 0) + (e.research ?? 0) * k * orbital
    policy.stability = (policy.stability ?? 0) + (e.stability ?? 0) * k * orbital
    policy.foodUse = (policy.foodUse ?? 0) + (e.foodUse ?? 0) * k * orbital
    policy.influence = (policy.influence ?? 0) + (e.influence ?? 0) * k * orbital
  }
  // Helium-3 and a national fusion plant: the fuel multiplies the plant.
  const fusion = n.projects?.fusion
  if (fusion && (fusion.level ?? (fusion.done ? 1 : 0)) >= 1 && y.he3 > 0) {
    policy.output = (policy.output ?? 0) + Math.min(0.03, HE3.output * y.he3)
    policy.factory = (policy.factory ?? 0) + Math.min(0.05, HE3.factory * y.he3)
  }
  return { policy, steel: y.steel, oil: y.oil, money: y.money, research: y.research, power: y.power, health: b.health, bill: spaceBill(sp, n), yield: y }
}

/** Rocket classes a nation could fly at its launch site. */
export const padAllows = (sp: SpaceState | undefined, id: RocketId) => (sp?.pads ?? 0) >= ROCKETS[id].pad
export const ROCKET_ORDER = ROCKET_IDS
