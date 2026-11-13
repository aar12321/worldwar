import { TECH_BY_ID, type TechModifiers } from '../data/techTree'
import { EMPIRE, MAX_WARS, WAR } from '../data/war'
import type { GameState, LogKind, Milestone, Nation, NationId, RegionId, UnitCounts, UnitType } from './types'

export const pairKey = (a: NationId, b: NationId) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export const atWar = (s: GameState, a: NationId, b: NationId) => a !== b && s.wars.includes(pairKey(a, b))

export const hasPact = (s: GameState, a: NationId, b: NationId) => (s.pacts[pairKey(a, b)] ?? -1) >= s.turn

export const hasCasusBelli = (s: GameState, holder: NationId, target: NationId) =>
  (s.casusBelli[`${holder}|${target}`] ?? -1) >= s.turn

/** Gives `holder` a reason to fight `target` for a while. A longer reason is never cut short. */
export function grantJustification(s: GameState, holder: NationId, target: NationId, reason: string, turns: number) {
  const key = `${holder}|${target}`
  const until = s.turn + turns
  if ((s.casusBelli[key] ?? -1) >= until) return
  s.casusBelli[key] = until
  s.reasons[key] = reason
}

/** The reason `holder` has to fight `target`, if any. */
export function justificationOf(s: GameState, holder: NationId, target: NationId): { reason: string; until: number } | null {
  const key = `${holder}|${target}`
  const until = s.casusBelli[key]
  if (until === undefined || until < s.turn) return null
  return { reason: s.reasons[key] ?? 'A grievance', until }
}

export function addInfamy(s: GameState, id: NationId, amount: number) {
  s.infamy[id] = Math.min(100, Math.max(0, (s.infamy[id] ?? 0) + amount))
}

/** Wars a nation can fight at once. It grows with the size of its empire. */
export function maxWars(s: GameState, id: NationId): number {
  return Math.min(EMPIRE.maxWarsCap, MAX_WARS + Math.floor(regionsOf(s, id).length / EMPIRE.warsPerRegions))
}

/** Attacks a nation's military can launch in one month. A bigger empire has more armies and more fronts. */
export function maxAttacks(s: GameState, id: NationId): number {
  return Math.min(EMPIRE.maxAttacksCap, WAR.maxAttacksPerTurn + Math.floor(regionsOf(s, id).length / EMPIRE.attacksPerRegions))
}

/** Nations that have promised to defend `id`. */
export const guarantorsOf = (s: GameState, id: NationId): NationId[] => (s.guarantees ?? []).filter((g) => g.to === id && g.until >= s.turn).map((g) => g.from)

/** Nations currently cutting off trade with `id`. */
export const sanctionersOf = (s: GameState, id: NationId): NationId[] => (s.sanctions ?? []).filter((x) => x.to === id && x.until >= s.turn && s.nations[x.from]?.alive).map((x) => x.from)

/** Nations that are puppets of `id`. */
export const puppetsOf = (s: GameState, id: NationId): NationId[] =>
  Object.values(s.nations)
    .filter((n) => n.alive && n.overlord === id)
    .map((n) => n.id)

export const isAllied = (s: GameState, a: NationId, b: NationId) => a !== b && s.alliances.includes(pairKey(a, b))

function partnersIn(keys: string[], id: NationId): NationId[] {
  const out: NationId[] = []
  const head = `${id}|`
  const tail = `|${id}`
  for (const k of keys) {
    if (k.startsWith(head)) out.push(k.slice(head.length))
    else if (k.endsWith(tail)) out.push(k.slice(0, k.length - tail.length))
  }
  return out
}

export const alliesOf = (s: GameState, id: NationId): NationId[] => partnersIn(s.alliances, id)

export const enemiesOf = (s: GameState, id: NationId): NationId[] => partnersIn(s.wars, id)

/** Every nation's partners under a list of "a|b" keys, built in one pass. */
export function partnerIndex(keys: string[]): Map<NationId, NationId[]> {
  const out = new Map<NationId, NationId[]>()
  const add = (a: NationId, b: NationId) => {
    const list = out.get(a)
    if (list) list.push(b)
    else out.set(a, [b])
  }
  for (const k of keys) {
    const i = k.indexOf('|')
    add(k.slice(0, i), k.slice(i + 1))
    add(k.slice(i + 1), k.slice(0, i))
  }
  return out
}

export function regionsOf(s: GameState, id: NationId): RegionId[] {
  return Object.values(s.regions)
    .filter((r) => r.owner === id)
    .map((r) => r.id)
    .sort()
}

/** Highest factory level in any country the nation owns, summed across countries. */
export function factoryCount(s: GameState, id: NationId): number {
  let n = 0
  for (const r of Object.values(s.regions)) if (r.owner === id) n += r.buildings.factory
  return n
}

export function formatDivisions(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export const emptyUnits = (): UnitCounts => ({ infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0 })

export const totalUnits = (u: UnitCounts) => (u.infantry ?? 0) + (u.armor ?? 0) + (u.artillery ?? 0) + (u.fighter ?? 0) + (u.air ?? 0) + (u.naval ?? 0)

export function sumUnits(list: UnitCounts[]): UnitCounts {
  const out = emptyUnits()
  for (const u of list) for (const k of Object.keys(out) as UnitType[]) out[k] += u[k]
  return out
}

export const hasTech = (n: Nation, techId: string) => n.techs.includes(techId)

export interface AggregatedModifiers {
  unitAttack: Record<UnitType, number>
  unitDefense: Record<UnitType, number>
  combinedArms: number
  ignoreMountainPenalty: boolean
  foodOutput: number
  factoryOutput: number
  jobsReduction: number
  researchOutput: number
  stability: number
  ppPerTurn: number
  allOutput: number
  amphibiousPenaltyReduction: number
  agencyBonus: number
  seaInvasion: boolean
}

export function nationModifiers(n: Nation): AggregatedModifiers {
  const m: AggregatedModifiers = {
    unitAttack: emptyUnits(),
    unitDefense: emptyUnits(),
    combinedArms: 0,
    ignoreMountainPenalty: false,
    foodOutput: 0,
    factoryOutput: 0,
    jobsReduction: 0,
    researchOutput: 0,
    stability: 0,
    ppPerTurn: 0,
    allOutput: 0,
    amphibiousPenaltyReduction: 0,
    agencyBonus: 0,
    seaInvasion: false,
  }
  for (const id of n.techs) {
    const tech = TECH_BY_ID[id]
    if (!tech) continue
    const mod: TechModifiers = tech.modifiers
    for (const [k, v] of Object.entries(mod.unitAttack ?? {})) m.unitAttack[k as UnitType] += v
    for (const [k, v] of Object.entries(mod.unitDefense ?? {})) m.unitDefense[k as UnitType] += v
    m.combinedArms += mod.combinedArms ?? 0
    m.ignoreMountainPenalty ||= !!mod.ignoreMountainPenalty
    m.foodOutput += mod.foodOutput ?? 0
    m.factoryOutput += mod.factoryOutput ?? 0
    m.jobsReduction += mod.jobsReduction ?? 0
    m.researchOutput += mod.researchOutput ?? 0
    m.stability += mod.stability ?? 0
    m.ppPerTurn += mod.ppPerTurn ?? 0
    m.allOutput += mod.allOutput ?? 0
    m.amphibiousPenaltyReduction += mod.amphibiousPenaltyReduction ?? 0
    m.agencyBonus += mod.agencyBonus ?? 0
    m.seaInvasion ||= !!tech.enablesSeaInvasion
  }
  return m
}

export function canUseUnit(n: Nation, unit: UnitType): boolean {
  const required: Record<UnitType, string> = {
    infantry: 'land_rifles',
    armor: 'land_light_tanks',
    artillery: 'land_artillery',
    fighter: 'air_propeller',
    air: 'air_bombers',
    naval: 'naval_gunboats',
  }
  return hasTech(n, required[unit])
}

export function addLog(s: GameState, kind: LogKind, text: string, nations: NationId[]) {
  s.log.push({ turn: s.turn, kind, text, nations })
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300)
}

/** Ticks off a first-game goal for a player nation. */
export function reach(n: Nation | undefined, m: Milestone) {
  if (!n?.isPlayer) return
  n.milestones ??= []
  if (!n.milestones.includes(m)) n.milestones.push(m)
}

export const newId = (s: GameState, prefix: string) => `${prefix}${s.nextId++}`

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const START_YEAR = 2026

export function turnDate(turn: number): string {
  const m = (turn - 1) % 12
  const y = START_YEAR + Math.floor((turn - 1) / 12)
  return `${MONTHS[m]} ${y}`
}
