import { AIRCRAFT_CAPS, AIRCRAFT_IDS, AIRCRAFT_NODES, AIRCRAFT_RULES, type AircraftEffectKey, type AircraftEffects, type AircraftNodeId } from '../data/aircraft'
import { TECH_BY_ID } from '../data/techTree'
import { REACH } from '../data/war'
import { tierGate, tierOf } from './empire'
import { addLog, hasTech, totalUnits } from './helpers'
import type { AircraftState, GameState, Nation, NationId, Order, UnitCounts, UnitType } from './types'

type Start = Extract<Order, { type: 'startAircraftDev' }>
type Pause = Extract<Order, { type: 'pauseAircraftDev' }>

/**
 * Aircraft development: pure rules. A nation with no developments has no `aircraft` field, and every function here then returns
 * "nothing" (undefined, zero or the plain value), so the rest of the game is exactly as it was for nations that do not use it.
 */

const KEYS = Object.keys({
  fighterAttack: 0, fighterDefense: 0, bomberAttack: 0, bomberDefense: 0, droneAttack: 0, droneDefense: 0,
  hunt: 0, pierce: 0, bomberFloor: 0, jam: 0, airRange: 0, landing: 0, bomberLine: 0, droneEvade: 0, speed: 0,
} satisfies AircraftEffects) as AircraftEffectKey[]

const empty = (): AircraftEffects => Object.fromEntries(KEYS.map((k) => [k, 0])) as unknown as AircraftEffects

export const devState = (n: Pick<Nation, 'aircraft'>, id: AircraftNodeId): AircraftState | undefined => n.aircraft?.[id]
export const devDone = (n: Pick<Nation, 'aircraft'>, id: AircraftNodeId): boolean => !!n.aircraft?.[id]?.done

/** Finished developments, in the order of the tree. */
export const finishedDevs = (n: Pick<Nation, 'aircraft'>): AircraftNodeId[] => AIRCRAFT_IDS.filter((id) => devDone(n, id))

/** Developments being worked on now. A paused one has given up its slot. */
export const activeDevs = (n: Pick<Nation, 'aircraft'>): AircraftNodeId[] => AIRCRAFT_IDS.filter((id) => {
  const p = n.aircraft?.[id]
  return !!p && !p.done && !p.paused
})

/** Developments a nation can have in hand at once, by empire tier. */
export const devSlots = (n: Pick<Nation, 'tier'>): number => AIRCRAFT_RULES.slots[Math.max(1, Math.min(5, Math.round(n.tier ?? 1))) - 1]

/** What a nation's finished developments add up to, held to their caps. Undefined for a nation with none, so callers can skip all of it. */
export function aircraftEffects(n: Pick<Nation, 'aircraft'>): AircraftEffects | undefined {
  if (!n.aircraft) return undefined
  let any = false
  const sum = empty()
  for (const id of AIRCRAFT_IDS) {
    if (!n.aircraft[id]?.done) continue
    any = true
    const fx = AIRCRAFT_NODES[id].effects
    for (const k of KEYS) sum[k] += fx[k] ?? 0
  }
  if (!any) return undefined
  for (const k of KEYS) {
    const cap = AIRCRAFT_CAPS[k]
    if (cap !== undefined) sum[k] = Math.min(cap, sum[k])
  }
  return sum
}

/** The stat bonuses a nation's developments give one unit, for the combat modifiers. */
export function aircraftUnitBonus(fx: AircraftEffects | undefined, unit: UnitType): { attack: number; defense: number } {
  if (!fx) return { attack: 0, defense: 0 }
  if (unit === 'fighter') return { attack: fx.fighterAttack, defense: fx.fighterDefense }
  if (unit === 'air') return { attack: fx.bomberAttack, defense: fx.bomberDefense }
  if (unit === 'drone') return { attack: fx.droneAttack, defense: fx.droneDefense }
  return { attack: 0, defense: 0 }
}

/** Where a unit's bonus from aircraft development comes from, node by node, for the stat sheet. */
export function aircraftSources(n: Pick<Nation, 'aircraft'>, unit: UnitType): { label: string; attack: number; defense: number }[] {
  const out: { label: string; attack: number; defense: number }[] = []
  if (!n.aircraft) return out
  for (const id of finishedDevs(n)) {
    const fx = AIRCRAFT_NODES[id].effects
    const b = aircraftUnitBonus({ ...empty(), ...fx }, unit)
    if (b.attack || b.defense) out.push({ label: AIRCRAFT_NODES[id].name, attack: b.attack, defense: b.defense })
  }
  return out
}

// ---- What the developments do in a fight ----

/** The share of incoming missiles and drones a wing of `fighters` (in divisions) can shoot down. A wing of three or more covers it all. */
export function huntCover(fx: AircraftEffects | undefined, fighters: number): number {
  if (!fx || fx.hunt <= 0) return 0
  return fx.hunt * Math.min(1, Math.max(0, fighters) / AIRCRAFT_RULES.huntWing)
}

/**
 * The share of a salvo that gets past a shield and a wing of hunters. `shieldPass` is what the shield alone lets through. The
 * attacker's stealth cuts what shield and hunters stop; its electronic warfare blinds the hunters first. `hunted` says how well
 * fighters catch this kind of weapon. Call it only when either side has developments, so the plain path stays exactly as it was.
 */
export function pastDefenses(shieldPass: number, attacker: AircraftEffects | undefined, defender: AircraftEffects | undefined, defenderFighters: number, hunted = 1): number {
  const pierce = attacker?.pierce ?? 0
  const jam = attacker?.jam ?? 0
  const shieldStop = (1 - shieldPass) * (1 - pierce)
  const huntStop = Math.min(AIRCRAFT_RULES.huntMax, huntCover(defender, defenderFighters) * (1 - jam) * hunted) * (1 - pierce)
  return (1 - shieldStop) * (1 - huntStop)
}

/** How far fighters and bombers fly from an airbase. */
export const airReach = (n: Pick<Nation, 'aircraft'> | undefined): number => REACH.airKm + (n ? (aircraftEffects(n)?.airRange ?? 0) : 0)

/** Extra push on a Defense Line from bombers: full when they are a quarter of the force sent, less when fewer. */
export function bomberBonus(fx: AircraftEffects | undefined, units: UnitCounts): number {
  if (!fx || fx.bomberLine <= 0) return 1
  const share = units.air / Math.max(0.1, totalUnits(units))
  return 1 + fx.bomberLine * Math.min(1, share / AIRCRAFT_RULES.bomberShareFull)
}

// ---- Starting, pausing, paying ----

/** The money one month of work on a node costs at a pace (1 is a normal month). A node's money in all is paid in full whatever the pace. */
export function monthSpend(id: AircraftNodeId, progress: number, pace: number): { gain: number; money: number } {
  const node = AIRCRAFT_NODES[id]
  const gain = Math.max(0, Math.min(pace, node.months - progress))
  return { gain, money: (node.money * gain) / node.months }
}

/** The first month's money, which the treasury must hold to begin. */
export const firstMonth = (id: AircraftNodeId): number => Math.ceil(AIRCRAFT_NODES[id].money / AIRCRAFT_NODES[id].months)

/** Why a node cannot be started now, or null. `pending` counts developments already ordered in the same batch. */
export function startAircraftDevProblem(s: GameState, n: Nation, o: Start, pending: Order[]): string | null {
  const node = AIRCRAFT_NODES[o.node]
  if (!node) return 'Unknown development'
  const have = n.aircraft?.[o.node]
  if (have?.done) return 'Already developed'
  if (have) return have.paused ? 'It is on hold: resume it instead' : 'Already under way'
  if (pending.some((p) => p.type === 'startAircraftDev' && p.nationId === o.nationId && p.node === o.node)) return 'Already ordered'
  if (!hasTech(n, node.tech)) return `Needs ${TECH_BY_ID[node.tech]?.name ?? 'a technology'}`
  const missing = node.requires.find((r) => !devDone(n, r))
  if (missing) return `Needs ${AIRCRAFT_NODES[missing].name} first`
  const gate = tierGate(s, n.id, node.tier)
  if (gate) return gate
  const slots = devSlots(n)
  const queued = pending.filter((p) => p.type === 'startAircraftDev' && p.nationId === o.nationId).length
  if (activeDevs(n).length + queued >= slots) return `A ${tierOf(n).name} can develop ${slots} ${slots === 1 ? 'aircraft project' : 'aircraft projects'} at once. Finish or pause one first.`
  const need = firstMonth(o.node)
  if (n.resources.capital < need) return `Needs ${need} money in the treasury for the first month`
  return null
}

export function pauseAircraftDevProblem(n: Nation, o: Pause, pending: Order[]): string | null {
  const have = n.aircraft?.[o.node]
  if (!have || have.done) return 'That development is not under way'
  if (o.paused === !!have.paused) return o.paused ? 'Already on hold' : 'Not on hold'
  if (!o.paused) {
    const slots = devSlots(n)
    const queued = pending.filter((p) => p.type === 'startAircraftDev' && p.nationId === o.nationId).length
    if (activeDevs(n).length + queued >= slots) return `A ${tierOf(n).name} can develop ${slots} ${slots === 1 ? 'aircraft project' : 'aircraft projects'} at once`
  }
  return null
}

/** What starting a node costs on the day: its research. The money follows month by month. */
export const startAircraftDevCost = (o: Start): { tp: number } => ({ tp: AIRCRAFT_NODES[o.node].tp })

export function applyStartAircraftDev(s: GameState, n: Nation, o: Start) {
  n.resources.tp -= AIRCRAFT_NODES[o.node].tp
  ;(n.aircraft ??= {})[o.node] = { progress: 0, done: false }
  if (n.isPlayer) addLog(s, 'tech', `${n.name} began developing ${AIRCRAFT_NODES[o.node].name.toLowerCase()}. It takes about ${AIRCRAFT_NODES[o.node].months} months.`, [n.id])
}

export function applyPauseAircraftDev(n: Nation, o: Pause) {
  const p = n.aircraft?.[o.node]
  if (!p) return
  if (o.paused) p.paused = true
  else delete p.paused
}

/** Money the month's work on aircraft costs. Zero for a nation with nothing under way. */
export function aircraftBill(n: Pick<Nation, 'aircraft'>, basePace: number): number {
  if (!n.aircraft) return 0
  const pace = aircraftPace(n, basePace)
  let total = 0
  for (const id of activeDevs(n)) total += monthSpend(id, n.aircraft[id]!.progress, pace).money
  return total
}

/** Months of work a month gets done: the engineers' pace, quicker with the developments that speed work up. */
export function aircraftPace(n: Pick<Nation, 'aircraft'>, basePace: number): number {
  const speed = aircraftEffects(n)?.speed ?? 0
  return speed > 0 ? basePace * (1 + speed) : basePace
}

/**
 * A month of work on every development under way. Like a project it stalls, and costs nothing, while the treasury is empty: the
 * economy has already charged the month in full, so the caller gets the stalled months' money back. Returns that refund.
 */
export function runAircraft(s: GameState, n: Nation, basePace: number): number {
  if (!n.aircraft) return 0
  const pace = aircraftPace(n, basePace)
  let refund = 0
  for (const id of activeDevs(n)) {
    const p = n.aircraft[id]!
    const { gain, money } = monthSpend(id, p.progress, pace)
    if (n.resources.capital < 0) {
      refund += money
      continue
    }
    p.progress += gain
    if (p.progress >= AIRCRAFT_NODES[id].months - 1e-9) {
      p.progress = AIRCRAFT_NODES[id].months
      p.done = true
      addLog(s, n.isPlayer ? 'tech' : 'news', `${n.name} finished developing ${AIRCRAFT_NODES[id].name.toLowerCase()}.`, [n.id])
    }
  }
  return refund
}

// ---- The AI ----

const WAR_PATH: AircraftNodeId[] = ['radar', 'aam', 'coatings', 'hunters', 'stealthBombers', 'dropTanks', 'ew', 'payload', 'refuel', 'iads', 'blackout', 'strategic', 'wingmen', 'swarm', 'loyal', 'autonomous']
const MISSILE_PATH: AircraftNodeId[] = ['radar', 'hunters', 'aam', 'iads', 'ew', 'wingmen', 'loyal', 'coatings', 'stealthBombers', 'blackout']

const missilesHeld = (f: Nation) => f.military.units.missile + Object.values(f.arsenal ?? {}).reduce((sum, v) => sum + (v ?? 0), 0)

/**
 * The development a Hard bot would start now, or null: only at war or when a rival it faces holds missiles (or has struck it lately),
 * only with some planes to improve, and only with the money in hand for the work. Interceptors first when missiles threaten.
 */
export function wantedAircraft(s: GameState, n: Nation, enemies: NationId[]): AircraftNodeId | null {
  if (enemies.length === 0) return null
  if (n.military.units.fighter + n.military.units.air < 1) return null
  const foes = enemies.map((e) => s.nations[e]).filter((f): f is Nation => !!f?.alive)
  const threatened = foes.some((f) => missilesHeld(f) >= 1) || Object.entries(n.struckBy ?? {}).some(([id, turn]) => s.turn - turn <= 6 && s.nations[id]?.alive)
  const path = threatened ? MISSILE_PATH : WAR_PATH
  for (const id of path) {
    const node = AIRCRAFT_NODES[id]
    // Keep a cushion: the bot never starts what would empty its treasury in a few months.
    if (n.resources.capital < firstMonth(id) * 4 + 100 || n.resources.tp < node.tp) continue
    if (startAircraftDevProblem(s, n, { type: 'startAircraftDev', nationId: n.id, node: id }, []) === null) return id
  }
  return null
}

// ---- For the screen ----

export type DevStatus = 'done' | 'active' | 'paused' | 'ready' | 'locked'

export interface DevView {
  id: AircraftNodeId
  status: DevStatus
  progress: number
  /** Why it cannot be started (or null when it can); for a node not yet ready, the first thing in the way. */
  problem: string | null
  /** Months left at the pace of the nation's engineers. */
  monthsLeft: number
}

export function devView(s: GameState, n: Nation, id: AircraftNodeId, basePace = 1): DevView {
  const st = n.aircraft?.[id]
  const node = AIRCRAFT_NODES[id]
  const pace = Math.max(0.05, aircraftPace(n, basePace))
  if (st?.done) return { id, status: 'done', progress: node.months, problem: null, monthsLeft: 0 }
  if (st) return { id, status: st.paused ? 'paused' : 'active', progress: st.progress, problem: null, monthsLeft: Math.ceil((node.months - st.progress) / pace - 1e-9) }
  const problem = startAircraftDevProblem(s, n, { type: 'startAircraftDev', nationId: n.id, node: id }, [])
  const blocked = node.requires.some((r) => !devDone(n, r)) || !hasTech(n, node.tech) || !!tierGate(s, n.id, node.tier)
  return { id, status: blocked ? 'locked' : 'ready', progress: 0, problem, monthsLeft: Math.ceil(node.months / pace - 1e-9) }
}
