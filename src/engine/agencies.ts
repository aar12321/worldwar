import { addOpinion } from '../ai/opinion'
import { AGENCY, DOMESTIC_OPS, FOREIGN_OPS, levelsCost, agencyName, type AgencyId, type DomesticOp, type ForeignOp, type OpSpec } from '../data/agencies'
import { TECH_BY_ID } from '../data/techTree'
import { JUSTIFY } from '../data/war'
import { SPY } from './espionage'
import { addInfamy, addLog, alliesOf, atWar, clamp, grantJustification, hasTech, isAllied, nationModifiers, regionsOf } from './helpers'
import type { Rng } from './rng'
import type { GameState, NationId, Order, WorldMap } from './types'

const nm = (s: GameState, id: NationId) => s.nations[id]?.name ?? id

/** Money each month the agencies cost. */
export function agencyUpkeep(n: { agencies?: { foreign: { level: number }; domestic: { level: number } } }): number {
  return n.agencies ? (n.agencies.foreign.level + n.agencies.domestic.level) * AGENCY.upkeepPerLevel : 0
}

export interface Odds {
  chance: number
  /** The parts that made it, for the player to read. */
  parts: { label: string; value: number }[]
}

/** The chance a foreign operation works: the agency's level and experience, tech, partners, minus the target's security. */
export function operationOdds(s: GameState, nationId: NationId, op: ForeignOp, target: NationId): Odds {
  const n = s.nations[nationId]
  const t = s.nations[target]
  const spec = FOREIGN_OPS[op]
  const a = n.agencies.foreign
  const parts: { label: string; value: number }[] = [{ label: 'Base', value: 0.4 }, { label: `Agency level ${a.level}`, value: a.level * 0.07 }]
  const bonus = nationModifiers(n).agencyBonus
  if (bonus > 0) parts.push({ label: 'Frontier technology', value: bonus })
  const exp = Math.min(AGENCY.expCap, a.exp * AGENCY.expBonus)
  if (exp > 0) parts.push({ label: 'Experience', value: exp })
  const tech = Math.min(AGENCY.techCap, n.techs.length * AGENCY.techBonus)
  if (tech > 0) parts.push({ label: 'Technology', value: tech })
  const partners = Math.min(AGENCY.partnerCap, alliesOf(s, nationId).length * AGENCY.partnerBonus)
  if (partners > 0) parts.push({ label: 'Partners', value: partners })
  if (t) {
    const security = t.agencies.domestic.level * AGENCY.securityPerLevel
    if (security > 0) parts.push({ label: `${nm(s, target)}'s security`, value: -security })
    if (t.secureUntil >= s.turn) parts.push({ label: 'Hunting our agents', value: -AGENCY.counterBonus })
    if (hasTech(t, 'cyber_warfare') && (op === 'cyber' || op === 'intel')) parts.push({ label: 'Cyber defense', value: -0.08 })
  }
  if (spec.hard > 0) parts.push({ label: 'Hard operation', value: -spec.hard })
  const chance = clamp(parts.reduce((sum, p) => sum + p.value, 0), 0.05, 0.9)
  return { chance, parts }
}

/** Teams an agency can send at once: one per level. */
export const teams = (s: GameState, id: NationId, agency: AgencyId) => s.nations[id]?.agencies[agency].level ?? 0

export function validateOperation(s: GameState, o: Extract<Order, { type: 'operation' }>, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const t = s.nations[o.target]
  const spec: OpSpec | undefined = FOREIGN_OPS[o.op]
  if (!spec) return 'Unknown operation'
  if (!t?.alive || o.target === o.nationId) return 'Choose another nation'
  const name = agencyName(n.name, 'foreign')
  if (n.agencies.foreign.level < spec.level) return `Needs ${name} level ${spec.level}`
  if (spec.tech && !hasTech(n, spec.tech)) return `Needs ${TECH_BY_ID[spec.tech]?.name ?? 'a technology'}`
  const used = pending.filter((p) => p.type === 'operation' && p.nationId === o.nationId).length
  if (used >= teams(s, o.nationId, 'foreign')) return `All ${name} teams are busy this month`
  if (pending.some((p) => p.type === 'operation' && p.op === o.op && p.target === o.target)) return 'Already ordered'
  if (spec.needsShaky && t.stability >= 45) return `${t.name} is too stable for that (stability ${Math.round(t.stability)}%, needs under 45%)`
  if (o.op === 'coup' && t.overlord) return 'They already have an overlord'
  if (o.op === 'case' && s.casusBelli[`${o.nationId}|${o.target}`] !== undefined && s.casusBelli[`${o.nationId}|${o.target}`] >= s.turn) return 'You already have a reason to fight them'
  if (o.op === 'steal' && !stealable(s, o.nationId, o.target)) return 'They have nothing you can use yet'
  if (o.op === 'aid' && atWar(s, o.nationId, o.target)) return 'Not while at war'
  return null
}

export function validateDomestic(s: GameState, o: Extract<Order, { type: 'domestic' }>, pending: Order[]): string | null {
  const n = s.nations[o.nationId]
  const spec: OpSpec | undefined = DOMESTIC_OPS[o.op]
  if (!spec) return 'Unknown operation'
  const name = agencyName(n.name, 'domestic')
  if (n.agencies.domestic.level < spec.level) return `Needs ${name} level ${spec.level}`
  const used = pending.filter((p) => p.type === 'domestic' && p.nationId === o.nationId).length
  if (used >= teams(s, o.nationId, 'domestic')) return `All ${name} teams are busy this month`
  if (pending.some((p) => p.type === 'domestic' && p.op === o.op && p.regionId === o.regionId)) return 'Already ordered'
  if (o.op === 'crackdown') {
    const r = o.regionId ? s.regions[o.regionId] : undefined
    if (!r || r.owner !== o.nationId || r.rebels <= 0) return 'Choose one of your countries with rebels'
  }
  if (o.op === 'calm' && n.stability >= 98) return 'People are already calm'
  return null
}

export function validateFund(s: GameState, o: Extract<Order, { type: 'fundAgency' }>, pending: Order[]): string | null {
  const a = s.nations[o.nationId]?.agencies[o.agency]
  if (!a) return 'Unknown agency'
  const levels = o.levels ?? 1
  if (!Number.isInteger(levels) || levels < 1) return 'Choose how many levels to buy'
  const queued = pending.reduce((sum, p) => (p.type === 'fundAgency' && p.agency === o.agency ? sum + (p.levels ?? 1) : sum), 0)
  if (a.level + queued >= AGENCY.maxLevel) return 'Already at the highest level'
  if (a.level + queued + levels > AGENCY.maxLevel) return `Only ${AGENCY.maxLevel - a.level - queued} more level${AGENCY.maxLevel - a.level - queued === 1 ? '' : 's'} to the top (level ${AGENCY.maxLevel})`
  return null
}

export function opCost(o: Extract<Order, { type: 'operation' | 'domestic' | 'fundAgency' }>, s: GameState): { capital: number; pp: number } {
  if (o.type === 'operation') return { capital: FOREIGN_OPS[o.op].money, pp: FOREIGN_OPS[o.op].pp }
  if (o.type === 'domestic') return { capital: DOMESTIC_OPS[o.op].money, pp: DOMESTIC_OPS[o.op].pp }
  return { capital: levelsCost(s.nations[o.nationId].agencies[o.agency].level, o.levels ?? 1), pp: 0 }
}

/** Technologies the target has that the nation could learn now. */
function stealable(s: GameState, nationId: NationId, target: NationId): string[] {
  const n = s.nations[nationId]
  return s.nations[target].techs.filter((id) => !n.techs.includes(id) && TECH_BY_ID[id]?.requires.every((r) => n.techs.includes(r))).sort()
}

export function fundAgency(s: GameState, nationId: NationId, agency: AgencyId, levels = 1) {
  const n = s.nations[nationId]
  n.agencies[agency].level = Math.min(AGENCY.maxLevel, n.agencies[agency].level + levels)
  if (n.isPlayer) addLog(s, 'info', `${agencyName(n.name, agency)} grew to level ${n.agencies[agency].level}.`, [nationId])
}

function caught(s: GameState, nationId: NationId, target: NationId, what: string) {
  addInfamy(s, nationId, JUSTIFY.infamyCaught)
  addOpinion(s, target, nationId, 'Caught our agents', -25, 0.4)
  grantJustification(s, target, nationId, 'Caught agents', JUSTIFY.reasonTurns)
  addLog(s, 'spy', `${nm(s, target)} caught ${nm(s, nationId)}'s agents ${what}. ${nm(s, target)} now has a reason to fight.`, [nationId, target])
}

/** Carries out one foreign operation. */
export function runOperation(s: GameState, map: WorldMap, nationId: NationId, op: ForeignOp, target: NationId, rng: Rng) {
  const n = s.nations[nationId]
  const t = s.nations[target]
  const spec = FOREIGN_OPS[op]
  const { chance } = operationOdds(s, nationId, op, target)
  const mine = (text: string) => addLog(s, 'spy', text, [nationId])
  if (!rng.chance(chance)) {
    if (!spec.friendly && rng.chance(AGENCY.caughtChance)) caught(s, nationId, target, `trying to ${spec.name.toLowerCase()}`)
    else mine(`${agencyName(n.name, 'foreign')}: the operation (${spec.name.toLowerCase()}) in ${t.name} failed quietly.`)
    return
  }
  n.agencies.foreign.exp++
  const regions = regionsOf(s, target).sort()
  switch (op) {
    case 'intel':
      s.intel[`${nationId}|${target}`] = s.turn + AGENCY.intelMonths
      mine(`${agencyName(n.name, 'foreign')} has eyes inside ${t.name}. Its real numbers are open to you for a year.`)
      break
    case 'case':
      grantJustification(s, nationId, target, 'Evidence of plotting', JUSTIFY.reasonTurns)
      mine(`Your agents found proof that ${t.name} has been plotting against you. You have a reason for war.`)
      break
    case 'sabotage': {
      const best = regions.reduce((b, id) => (s.regions[id].buildings.factory > s.regions[b].buildings.factory ? id : b), regions[0])
      s.regions[best].sabotaged = SPY.sabotageTurns
      addLog(s, 'spy', `Factories in ${map.regions[best].name} stopped working for ${SPY.sabotageTurns} months.`, [nationId, target])
      break
    }
    case 'rebels': {
      const lands = regions.filter((id) => id !== t.capital)
      const hit = lands.length ? lands[rng.int(0, lands.length - 1)] : regions[0]
      s.regions[hit].rebels = Math.max(s.regions[hit].rebels, 2.5)
      t.stability = Math.max(0, t.stability - 8)
      addInfamy(s, nationId, 5)
      addLog(s, 'spy', `Rebels rose in ${map.regions[hit].name}. ${t.name} is shaken. Some whisper about outside hands.`, [nationId, target])
      break
    }
    case 'aid':
      for (const id of regions) if (s.regions[id].rebels > 0) s.regions[id].rebels *= 0.4
      t.stability = clamp(t.stability + 8, 0, 100)
      addOpinion(s, target, nationId, 'Helped us keep order', 15, 0.2)
      for (const c of s.crises) if (c.kind === 'unrest' && c.nation === target) c.boil = Math.max(0, c.boil - 0.3)
      mine(`${agencyName(n.name, 'foreign')} helped ${t.name} restore order. ${t.name} is grateful.`)
      break
    case 'steal': {
      const pick = stealable(s, nationId, target)[0]
      if (pick) {
        n.techs.push(pick)
        mine(`Your agents copied ${TECH_BY_ID[pick]?.name ?? pick} from ${t.name}.`)
      }
      break
    }
    case 'coup':
      t.overlord = nationId
      t.overlordSince = s.turn
      t.stability = 40
      for (const k of s.alliances.filter((a) => a.split('|').includes(target))) {
        const other = k.split('|').find((x) => x !== target)!
        if (atWar(s, nationId, other) || !isAllied(s, nationId, other)) s.alliances = s.alliances.filter((a) => a !== k)
      }
      addInfamy(s, nationId, 15)
      addLog(s, 'news', `A coup in ${t.name}. The new government answers to ${n.name}, and the world suspects who helped.`, [nationId, target])
      break
    case 'cyber':
      t.resources.capital *= 0.7
      if (regions.length) s.regions[regions[0]].sabotaged = 2
      addInfamy(s, nationId, 4)
      addLog(s, 'spy', `A cyber attack hit ${t.name}'s banks and power grid.`, [nationId, target])
      break
  }
}

export function runDomestic(s: GameState, nationId: NationId, op: DomesticOp, regionId: string | undefined) {
  const n = s.nations[nationId]
  const level = n.agencies.domestic.level
  n.agencies.domestic.exp++
  const mine = (text: string) => addLog(s, 'spy', text, [nationId])
  switch (op) {
    case 'counter':
      n.secureUntil = s.turn + AGENCY.counterMonths
      mine(`${agencyName(n.name, 'domestic')} is hunting foreign agents. Operations against you are harder for a year.`)
      break
    case 'calm':
      n.stability = clamp(n.stability + 6, 0, 100)
      mine(`${agencyName(n.name, 'domestic')} calmed the streets. Stability rose.`)
      break
    case 'crackdown': {
      const r = regionId ? s.regions[regionId] : undefined
      if (!r) break
      r.rebels *= 0.3
      if (r.rebels < 0.2) r.rebels = 0
      mine(`${agencyName(n.name, 'domestic')} broke up the rebels.`)
      break
    }
    case 'corruption':
      n.resources.capital += 10 + 12 * level
      n.stability = clamp(n.stability + 2, 0, 100)
      mine(`${agencyName(n.name, 'domestic')} recovered stolen money and won back some trust.`)
      break
  }
}
