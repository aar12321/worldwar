import { MISSILES, PROGRAM_MISSILES } from '../data/missiles'
import { clockOf } from '../engine/calendar'
import { getsThrough, incomingMissiles } from '../engine/missiles'
import type { GameState, MissileFlight, MissileType, NationId } from '../engine/types'

/** Plain words and numbers for missiles, shared by the Missile War tab, the program card, the globe and the toasts. Pure, so they are tested. */

/** The two ends of a missile's arc on the globe. Each kind has its own look, so a glance tells a cruise swarm from a ballistic salvo. */
export const MISSILE_ARC: Record<MissileType, [string, string]> = {
  cruise: ['rgba(120,220,255,0.95)', 'rgba(10,132,255,0.95)'],
  tactical: ['rgba(120,255,160,0.95)', 'rgba(48,209,88,0.95)'],
  hypersonic: ['rgba(255,214,10,0.95)', 'rgba(255,69,58,0.95)'],
  ballistic: ['rgba(255,140,220,0.95)', 'rgba(191,90,242,0.95)'],
  decoy: ['rgba(200,200,210,0.7)', 'rgba(150,150,165,0.7)'],
}

/** One solid color for a kind (a swatch beside its name). */
export const MISSILE_SWATCH: Record<MissileType, string> = {
  cruise: '#4dc3ff',
  tactical: '#30d158',
  hypersonic: '#ffd60a',
  ballistic: '#d56bff',
  decoy: '#9a9aa8',
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Hypersonic missiles keep the plain word "missile"; the others use their own name. */
export const missileName = (kind: MissileType, count = 1) => {
  const name = MISSILES[kind].name.toLowerCase()
  return count === 1 ? name : `${name}s`
}

/** What a missile of this kind does, from its numbers, one short clause each. The world's anger is left to `effectText`. */
export function effectParts(kind: MissileType): string[] {
  const m = MISSILES[kind]
  const out: string[] = []
  if (m.line > 0) out.push(`cuts the Defense Line by ${m.line} each (up to ${m.lineMax} in a salvo)`)
  if (m.army > 0) out.push(`destroys ${pct(m.army)} of their army each (up to ${pct(m.armyMax)})`)
  if (m.perBuilding > 0) out.push(`destroys a building for every ${m.perBuilding} that land`)
  if (m.people > 0) out.push(`kills ${pct(m.people)} of the people each (up to ${pct(m.peopleMax)})`)
  if (m.factoryTurns > 0) out.push(`stops its factories for ${plural(m.factoryTurns, 'month')}`)
  return out
}

/** The same, as sentences: "Cuts the Defense Line by 0.25 each (...), stops its factories for 1 month." */
export function effectText(kind: MissileType): string {
  const parts = effectParts(kind)
  const head = parts.length ? `${parts[0][0].toUpperCase()}${parts[0].slice(1)}${parts.slice(1).map((p) => `, ${p}`).join('')}.` : 'Little effect.'
  return MISSILES[kind].opinion < 0 ? `${head} The world will not forgive it.` : head
}

/** What a landed salvo did, in the past tense and a few words, for a toast. */
export function landedEffect(kind: MissileType): string {
  const m = MISSILES[kind]
  const out: string[] = []
  if (m.line > 0) out.push('cut the Defense Line')
  if (m.army > 0) out.push('destroyed part of the army')
  if (m.perBuilding > 0) out.push('destroyed buildings')
  if (m.people > 0) out.push('killed civilians')
  if (m.factoryTurns > 0) out.push('stopped the factories')
  return out.join(', ') || 'did little damage'
}

/** The shield a country has and how much of a salvo of this kind gets past it, for the line beside every Fire button. */
export function shieldNote(shield: number, kind: MissileType): { through: number; text: string } {
  const through = getsThrough(shield, kind)
  const pctThrough = Math.round(through * 100)
  if (shield < 1) return { through, text: 'No Interceptor Shield: every missile gets through.' }
  return { through, text: `Interceptor Shield level ${shield}: about ${pctThrough}% of ${missileName(kind, 2)} get through.` }
}

/** A custom count, kept to whole numbers between 1 and what there is to fire. A blank or nonsense box reads as one. */
export function clampCount(raw: number, max: number): number {
  const top = Math.max(1, Math.floor(Number.isFinite(max) ? max : 1))
  if (!Number.isFinite(raw)) return 1
  return Math.min(top, Math.max(1, Math.floor(raw)))
}

/** "6 money, 1 steel" for one missile, leaving out what is free. */
export function buildCostText(kind: MissileType): string {
  const m = MISSILES[kind]
  return [`${m.money} money`, m.steel > 0 ? `${m.steel} steel` : '', m.oil > 0 ? `${m.oil} oil` : ''].filter(Boolean).join(', ')
}

/** How long a kind takes to land, in the words of the game being played. */
export const flightText = (kind: MissileType, live: boolean) => (live ? `lands in ${plural(MISSILES[kind].days, 'day')}` : 'lands when the month ends')

/** Kinds the program builds, from the data, in level order. */
export const PROGRAM_KINDS = PROGRAM_MISSILES.slice().sort((a, b) => MISSILES[a].level - MISSILES[b].level)

/** The days a flight spends in the air. */
export const flightDays = (f: Pick<MissileFlight, 'launched' | 'lands'>) => Math.max(1, f.lands - f.launched)

export interface IncomingSalvo {
  from: NationId
  name: string
  count: number
  kinds: MissileType[]
  /** Whole days until the first of them lands. */
  days: number
}

/** The missiles on their way to the player's countries, grouped by who fired them, soonest first. */
export function incomingSalvos(game: GameState, playerId: NationId): IncomingSalvo[] {
  const now = clockOf(game)
  const by = new Map<NationId, IncomingSalvo>()
  for (const f of incomingMissiles(game, playerId)) {
    const kind = f.kind ?? 'hypersonic'
    const days = Math.max(0, Math.ceil(f.lands - now))
    const old = by.get(f.nationId)
    if (old) {
      old.count += f.count
      if (!old.kinds.includes(kind)) old.kinds.push(kind)
      old.days = Math.min(old.days, days)
    } else by.set(f.nationId, { from: f.nationId, name: game.nations[f.nationId]?.name ?? 'An enemy', count: f.count, kinds: [kind], days })
  }
  return [...by.values()].sort((a, b) => a.days - b.days || (a.from < b.from ? -1 : 1))
}

/** The chip's words: "Missiles incoming from Russia: 2 days" (and how many more nations, if several). */
export function incomingText(salvos: IncomingSalvo[]): string {
  if (salvos.length === 0) return ''
  const first = salvos[0]
  const when = first.days === 0 ? 'landing today' : plural(first.days, 'day')
  return `Missiles incoming from ${first.name}: ${when}${salvos.length > 1 ? ` (and ${plural(salvos.length - 1, 'other nation')})` : ''}`
}
