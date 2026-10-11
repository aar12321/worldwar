import { TECH_BY_ID, type TechModifiers } from '../data/techTree'
import { asTraining, type UnitTraining } from '../data/unitTypes'
import type { Army, GameState, LogKind, Nation, NationId, RegionId, UnitCounts, UnitType, WorldMap } from './types'

export const pairKey = (a: NationId, b: NationId) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export const atWar = (s: GameState, a: NationId, b: NationId) => a !== b && s.wars.includes(pairKey(a, b))

export const hasPact = (s: GameState, a: NationId, b: NationId) => (s.pacts[pairKey(a, b)] ?? -1) >= s.turn

export const hasCasusBelli = (s: GameState, holder: NationId, target: NationId) =>
  (s.casusBelli[`${holder}|${target}`] ?? -1) >= s.turn

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

export function armiesOf(s: GameState, id: NationId): Army[] {
  return Object.values(s.armies)
    .filter((a) => a.owner === id)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

export function armiesIn(s: GameState, regionId: RegionId, owner?: NationId): Army[] {
  return Object.values(s.armies)
    .filter((a) => a.location === regionId && (owner === undefined || a.owner === owner))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** The army this nation raises from a muster, if it still has one. */
export function boundArmy(s: GameState, territoryId: string, owner: NationId): Army | undefined {
  for (const a of Object.values(s.armies)) if (a.homeTerritoryId === territoryId && a.owner === owner) return a
  return undefined
}

/** True when the army is standing in the country of the muster it was raised from, and that country is still theirs. */
export function armyIsHome(s: GameState, map: WorldMap, army: Army): boolean {
  const t = map.territories[army.homeTerritoryId]
  return !!t && army.location === t.regionId && s.regions[t.regionId]?.owner === army.owner
}

export function factoryCount(s: GameState, id: NationId): number {
  let n = 0
  for (const r of Object.values(s.regions)) if (r.owner === id) n += r.buildings.factory
  return n
}

export function formatDivisions(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export const emptyUnits = (): UnitCounts => ({ infantry: 0, armor: 0, air: 0, naval: 0 })

export const totalUnits = (u: UnitCounts) => u.infantry + u.armor + u.air + u.naval

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
  supplyRange: number
  seaSupplyRange: number
  allOutput: number
  amphibiousPenaltyReduction: number
  seaInvasion: boolean
  globalVision: boolean
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
    supplyRange: 0,
    seaSupplyRange: 0,
    allOutput: 0,
    amphibiousPenaltyReduction: 0,
    seaInvasion: false,
    globalVision: false,
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
    m.supplyRange += mod.supplyRange ?? 0
    m.seaSupplyRange += mod.seaSupplyRange ?? 0
    m.allOutput += mod.allOutput ?? 0
    m.amphibiousPenaltyReduction += mod.amphibiousPenaltyReduction ?? 0
    m.seaInvasion ||= !!tech.enablesSeaInvasion
    m.globalVision ||= !!tech.globalVision
  }
  return m
}

export function canUseUnit(n: Nation, unit: UnitType): boolean {
  const required: Record<UnitType, string> = {
    infantry: 'land_rifles',
    armor: 'land_light_tanks',
    air: 'air_propeller',
    naval: 'naval_gunboats',
  }
  return hasTech(n, required[unit])
}

export function addLog(s: GameState, kind: LogKind, text: string, nations: NationId[]) {
  s.log.push({ turn: s.turn, kind, text, nations })
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300)
}

export const newId = (s: GameState, prefix: string) => `${prefix}${s.nextId++}`

export function createArmy(
  s: GameState,
  spec: { owner: NationId; location: RegionId; units: UnitCounts; homeTerritoryId: string; training?: number | UnitTraining },
): Army {
  const army: Army = {
    id: newId(s, 'a'),
    owner: spec.owner,
    location: spec.location,
    units: spec.units,
    generalId: null,
    outOfSupplyTurns: 0,
    entrenched: 0,
    homeTerritoryId: spec.homeTerritoryId,
    training: asTraining(spec.training, spec.units),
  }
  s.armies[army.id] = army
  return army
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const START_YEAR = 1936

export function turnDate(turn: number): string {
  const m = (turn - 1) % 12
  const y = START_YEAR + Math.floor((turn - 1) / 12)
  return `${MONTHS[m]} ${y}`
}
