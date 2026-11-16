import { addOpinion, opinionOf, storedOpinion } from '../ai/opinion'
import { FAVOUR_ASKS, ACTS, AID, PROGRAMS, RELATIONS, VISIT } from '../data/relations'
import { INVEST, SECTORS, SECTOR_IDS } from '../data/business'
import { TECH_BY_ID } from '../data/techTree'
import { DIPLOMACY } from '../data/unitTypes'
import { addToSector, investedIn, makeInvestment } from './business'
import { isLive } from './calendar'
import { nationWorkforce } from './economy'
import { addLog, atWar, clamp, enemiesOf, hasCasusBelli, hasPact, isAllied, newId, pairKey } from './helpers'
import { createRng, type Rng } from './rng'
import { relationLines } from './relationParts'
import { cancelDeal } from './diplomacy'
import { marketPrices } from './trade'
import { regionValue } from './warscore'
import { canAttackRegion, transferRegion } from './warfare'
import type { Embassy, GameState, NationId, RelateOrder, RelationsState, RelEntry, RelProgram, RelRequest, WarPlan, WorldMap } from './types'

const key = (a: NationId, b: NationId) => `${a}>${b}`
const name = (s: GameState, id: NationId) => s.nations[id]?.name ?? id
const isHuman = (s: GameState, id: NationId) => s.humans.includes(id) || !!s.nations[id]?.isPlayer

export const relationsOf = (s: GameState): RelationsState | undefined => s.relations

/** The relationship state, made on first use. Reading functions never call this, so a game that never uses the desk carries nothing. */
export function ensureRelations(s: GameState): RelationsState {
  return (s.relations ??= { last: {}, soft: {}, embassies: [], programs: [], plans: [], favours: {}, requests: [], log: [], since: {}, contact: {} })
}

/** The cooldown an order is under: the act, or the act and its kind (aid by resource). */
export function cooldownKey(o: RelateOrder): string {
  const sub = o.act === 'aid' ? `:${o.resource ?? ''}` : o.act === 'ask' ? `:${o.kind ?? ''}` : ''
  return `${key(o.nationId, o.target)}:${o.act}${sub}`
}

/** Months until the same partner can be given this again (0 when it can be done now). */
export function cooldownLeft(s: GameState, o: RelateOrder): number {
  const spec = ACTS[o.act]
  const months = spec?.cooldown ?? (o.act === 'callFavour' ? 3 : o.act === 'ask' ? 8 : 0)
  if (!months) return 0
  const last = s.relations?.last[cooldownKey(o)]
  return last === undefined ? 0 : Math.max(0, months - (s.turn - last))
}

// ---- opinion: what an act is worth ---------------------------------------------------------------------------------------

/** Every opinion line these rules add, so the total they can give one nation is capped. */
const EARNED = new Set<string>([...Object.values(ACTS).map((a) => a!.label), 'Rescued us', 'Answered our call', 'Embassy', 'Treaty anniversary', 'Steadfast ally', 'Fought beside us', 'Exchange students', 'Trade routes', 'Joint research', 'Mediated for us', 'Backed us at the Council', 'Warm reception'])

function earnedSum(s: GameState, holder: NationId, target: NationId): number {
  let sum = 0
  for (const m of storedOpinion(s, holder, target)) if (m.value > 0 && EARNED.has(m.label)) sum += m.value
  for (const l of relationLines(s, holder, target)) if (l.value > 0) sum += l.value
  return sum
}

/** How much of its full worth the next gift to this nation is worth: 1 at first, less the more has been given lately. */
export function warmthFactor(s: GameState, holder: NationId, target: NationId): number {
  const soft = s.relations?.soft[key(holder, target)] ?? 0
  return clamp(1 - soft / RELATIONS.softCap, RELATIONS.softMin, 1)
}

/**
 * Gives `holder` (a rival) warmth toward `target`: worth less the more it has been given lately, and never past the ceiling of what actions can give.
 * Returns what was actually added. A player holds no opinions, so nothing happens for one.
 */
export function warm(s: GameState, holder: NationId, target: NationId, label: string, value: number, decay: number): number {
  if (value <= 0 || isHuman(s, holder) || !s.nations[holder]?.alive || holder === target) return 0
  const r = ensureRelations(s)
  const soft = r.soft[key(holder, target)] ?? 0
  let v = value * clamp(1 - soft / RELATIONS.softCap, RELATIONS.softMin, 1)
  v = Math.min(v, Math.max(0, RELATIONS.earnedCap - earnedSum(s, holder, target)))
  if (v < 0.5) return 0
  addOpinion(s, holder, target, label, v, decay)
  r.soft[key(holder, target)] = soft + v
  return v
}

/** A bad turn: unlike warmth it is not softened. */
const cool = (s: GameState, holder: NationId, target: NationId, label: string, value: number, decay: number) => {
  if (!isHuman(s, holder)) addOpinion(s, holder, target, label, value, decay)
}

// ---- favours -------------------------------------------------------------------------------------------------------------

/** Favours `debtor` owes `creditor` that can still be called in. */
export function favoursOwed(s: GameState, debtor: NationId, creditor: NationId): number {
  return (s.relations?.favours[key(debtor, creditor)] ?? []).filter((u) => u >= s.turn).length
}

function addFavour(s: GameState, debtor: NationId, creditor: NationId, n = 1) {
  const r = ensureRelations(s)
  const list = (r.favours[key(debtor, creditor)] ??= []).filter((u) => u >= s.turn)
  for (let i = 0; i < n && list.length < RELATIONS.favourMax; i++) list.push(s.turn + RELATIONS.favourMonths)
  r.favours[key(debtor, creditor)] = list
}

// ---- helpers about two nations -------------------------------------------------------------------------------------------

export const embassyOf = (s: GameState, from: NationId, to: NationId): Embassy | undefined => s.relations?.embassies.find((e) => e.from === from && e.to === to)

export const programsBetween = (s: GameState, a: NationId, b: NationId): RelProgram[] => (s.relations?.programs ?? []).filter((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))

export const plansBetween = (s: GameState, a: NationId, b: NationId): WarPlan[] => (s.relations?.plans ?? []).filter((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))

/** Whether two nations are partners in a running joint war plan. */
export const inPlanTogether = (s: GameState, a: NationId, b: NationId): boolean => plansBetween(s, a, b).length > 0

const plansOf = (s: GameState, id: NationId) => (s.relations?.plans ?? []).filter((p) => p.a === id || p.b === id)

const tradeDealBetween = (s: GameState, a: NationId, b: NationId) => s.deals.some((d) => d.kind === 'trade' && ((d.from === a && d.to === b) || (d.from === b && d.to === a)))

/** Warmth they carry against you that an apology can soften: stored grudges, worst first. */
export function grudges(s: GameState, holder: NationId, target: NationId) {
  return storedOpinion(s, holder, target)
    .filter((m) => m.value <= -3)
    .sort((a, b) => a.value - b.value)
}

const sanctionedBy = (s: GameState, from: NationId, to: NationId) => (s.sanctions ?? []).some((x) => x.from === from && x.to === to && x.until >= s.turn)

/** How a rival is placed to take a given kind of aid: dire, short, ok or flush. */
export function needLevel(s: GameState, id: NationId, r: 'food' | 'oil' | 'steel'): keyof typeof AID.needMult {
  const n = s.nations[id]
  if (!n) return 'ok'
  if ((r === 'food' && n.foodShortage) || (r === 'oil' && n.oilShortage)) return 'dire'
  const have = n.resources[r]
  const low = r === 'food' ? 14 : r === 'oil' ? 6 : 8
  const high = r === 'food' ? 90 : r === 'oil' ? 40 : 80
  return have < low ? 'short' : have > high ? 'flush' : 'ok'
}

// ---- what a rival will take ----------------------------------------------------------------------------------------------

export interface Reception {
  ok: boolean
  /** Their opinion of the giver, the opinion the act needs, and the sentence a human diplomat would give. */
  opinion: number
  need: number
  reason: string
}

/** The opinion a rival needs to take this act from this giver: the act's own line, bent by temperament and by difficulty. */
export function opinionNeeded(s: GameState, rival: NationId, act: RelateOrder['act']): number {
  const spec = ACTS[act]
  if (!spec) return -100
  const persona = s.nations[rival]?.personality
  let need = spec.minOpinion
  if (persona === 'trader' && spec.group === 'economy') need -= 5
  if (persona === 'turtle' && spec.group === 'military') need += 5
  if (persona === 'expansionist' && spec.group === 'goodwill') need += 5
  const diff = s.settings.difficulty
  if (diff === 'easy') need += RELATIONS.gentle
  else if (diff === 'hard') need += RELATIONS.strict
  return need
}

/** Whether a rival will take this act from this nation. Deterministic: the same state always answers the same, so the screen can say so before you try. */
export function reception(s: GameState, map: WorldMap, rival: NationId, from: NationId, act: RelateOrder['act'], opinion?: number): Reception {
  const op = opinion ?? opinionOf(s, map, rival, from)
  const need = opinionNeeded(s, rival, act)
  if (op >= need) return { ok: true, opinion: op, need, reason: '' }
  return { ok: false, opinion: op, need, reason: op <= -25 ? 'We do not trust you.' : act === 'visit' ? 'We would rather not receive you now.' : 'The time is not right.' }
}

// ---- costs ---------------------------------------------------------------------------------------------------------------

export interface RelCost {
  capital: number
  pp: number
  tp: number
  steel: number
}

/** What an order costs. Food and oil sent as aid come out of the store in the act itself, and are checked there. */
export function relationCost(s: GameState, o: RelateOrder): RelCost {
  const c: RelCost = { capital: 0, pp: 0, tp: 0, steel: 0 }
  const spec = ACTS[o.act]
  if (o.act === 'answer') {
    const u = underlying(s, o)
    return u ? relationCost(s, u) : c
  }
  if (!spec) return c
  c.capital = spec.money
  c.pp = spec.pp
  c.tp = spec.tp ?? 0
  c.steel = spec.steel ?? 0
  if (o.act === 'venture') c.capital = Number.isFinite(o.amount) ? Math.round(o.amount as number) : 0
  if (o.act === 'apology') c.capital = Number.isFinite(o.amount) ? Math.max(0, Math.round(o.amount as number)) : 0
  if (o.act === 'aid') c.steel = o.resource === 'steel' && Number.isFinite(o.amount) ? Math.max(0, Math.round(o.amount as number)) : 0
  if (o.act === 'sanction') c.pp = DIPLOMACY.sanctions.cost
  if (o.act === 'forgive' || o.act === 'closeEmbassy' || o.act === 'endProgram' || o.act === 'endPlan') c.pp = 0
  return c
}

/** The ordinary order an answer to a rival's request stands for, or null when the request is gone. */
function underlying(s: GameState, o: RelateOrder): RelateOrder | null {
  const q = s.relations?.requests.find((x) => x.id === o.id && x.to === o.nationId)
  if (!q || !o.accept) return null
  const base = { type: 'relate' as const, nationId: o.nationId, target: q.from }
  switch (q.kind) {
    case 'aid':
      return { ...base, act: 'aid', resource: q.resource, amount: q.amount }
    case 'support':
      return { ...base, act: 'support' }
    default:
      return null
  }
}

// ---- validation ----------------------------------------------------------------------------------------------------------

const AID_MAX = 60

/** Why an order of the relationship desk cannot be done, or null. */
export function relationProblem(s: GameState, map: WorldMap, o: RelateOrder, pending: { type: string }[] = []): string | null {
  const me = s.nations[o.nationId]
  const them = s.nations[o.target]
  if (!RELATIONS.on) return 'Relationships are switched off'
  if (!me?.alive) return 'Your nation has fallen'
  if (!them?.alive || o.target === o.nationId) return 'Choose another nation'
  if (typeof o.act !== 'string') return 'Unknown action'
  const spec = ACTS[o.act]
  const bookkeeping = ['closeEmbassy', 'endProgram', 'endPlan', 'strikeWindow', 'callFavour', 'ask', 'answer', 'forgive'].includes(o.act)
  if (!spec && !bookkeeping) return 'Unknown action'
  const meHuman = isHuman(s, o.nationId)
  const themHuman = isHuman(s, o.target)
  if (o.act === 'ask') return askProblem(s, o)
  if (o.act === 'answer') return answerProblem(s, map, o, pending)
  if (themHuman && !['endProgram', 'endPlan'].includes(o.act)) return 'Another player decides for themselves: use a Diplomacy offer'
  if (atWar(s, o.nationId, o.target) && !['endProgram', 'endPlan', 'closeEmbassy'].includes(o.act)) return `You are at war with ${them.name}`
  if (them.overlord === o.nationId && o.act !== 'closeEmbassy' && o.act !== 'endProgram') return 'They are your puppet: rule them from the Empire desk'
  const left = cooldownLeft(s, o)
  if (left > 0) return `Wait ${left} more month${left === 1 ? '' : 's'} before doing that for them again`
  if (pending.some((p) => p.type === 'relate' && (p as RelateOrder).act === o.act && (p as RelateOrder).target === o.target && (p as RelateOrder).nationId === o.nationId && o.act !== 'strikeWindow')) return 'Already ordered'
  if (spec?.embassy && meHuman) {
    const e = embassyOf(s, o.nationId, o.target)
    if (!e) return 'Open an embassy there first'
    if (spec.embassy === 'attache' && !e.attache) return 'Send a military attaché there first'
  }
  const r = ensureView(s)
  const detail = (): string | null => {
  switch (o.act) {
    case 'visit':
    case 'culture':
    case 'festival':
    case 'recognise':
      return null
    case 'support': {
      const dispute = enemiesOf(s, o.target).length > 0 || (s.sanctions ?? []).some((x) => x.to === o.target && x.until >= s.turn)
      return dispute ? null : 'They are in no dispute that needs your backing'
    }
    case 'mediate': {
      const e = o.enemy ? s.nations[o.enemy] : undefined
      if (!e?.alive || o.enemy === o.nationId || o.enemy === o.target) return 'Choose the nation they are at odds with'
      if (atWar(s, o.nationId, o.enemy as string)) return 'You are at war with them: you cannot mediate'
      const sore = atWar(s, o.target, o.enemy as string) || opinionOf(s, map, o.target, o.enemy as string) <= -20
      return sore ? null : 'They are not at odds with that nation'
    }
    case 'apology': {
      if (!grudges(s, o.target, o.nationId).length && !hasCasusBelli(s, o.target, o.nationId)) return 'They hold nothing against you that an apology can soften'
      if (o.amount !== undefined && (!Number.isFinite(o.amount) || o.amount < 0 || o.amount > 100)) return 'Offer between 0 and 100 in compensation'
      return null
    }
    case 'embassy':
      return embassyOf(s, o.nationId, o.target) ? 'You already have an embassy there' : null
    case 'attache': {
      const e = embassyOf(s, o.nationId, o.target)
      if (!e) return 'Open an embassy there first'
      return e.attache ? 'An attaché is already there' : null
    }
    case 'closeEmbassy':
      return embassyOf(s, o.nationId, o.target) ? null : 'You have no embassy there'
    case 'students':
    case 'science':
    case 'tradeMission':
    case 'tariff':
    case 'basing': {
      const kind = o.act === 'tradeMission' ? 'route' : o.act
      if (programsBetween(s, o.nationId, o.target).some((p) => p.kind === kind)) return 'That is already running between you'
      if (o.act === 'science' && (r.programs.filter((p) => p.kind === 'science' && (p.a === o.nationId || p.b === o.nationId)).length >= 2)) return 'You are already running two joint research programs'
      if (o.act === 'tariff' && !tradeDealBetween(s, o.nationId, o.target)) return 'You need a running trade deal first'
      if (o.act === 'tradeMission' && (sanctionedBy(s, o.nationId, o.target) || sanctionedBy(s, o.target, o.nationId))) return 'Sanctions are in force between you'
      if (o.act === 'basing' && !isAllied(s, o.nationId, o.target) && !hasPact(s, o.nationId, o.target)) return 'Basing rights need a pact or an alliance'
      return null
    }
    case 'endProgram': {
      const p = r.programs.find((x) => x.id === o.id)
      return p && (p.a === o.nationId || p.b === o.nationId) ? null : 'No such program'
    }
    case 'venture': {
      if (!o.sector || !SECTOR_IDS.includes(o.sector)) return 'Choose a business sector'
      if (!Number.isFinite(o.amount) || (o.amount as number) < PROGRAMS.venture.min || (o.amount as number) > PROGRAMS.venture.max) return `Each side puts in between ${PROGRAMS.venture.min} and ${PROGRAMS.venture.max}`
      if (r.programs.filter((p) => p.kind === 'venture' && (p.a === o.nationId || p.b === o.nationId)).length >= 2) return 'You already run two joint ventures'
      if (programsBetween(s, o.nationId, o.target).some((p) => p.kind === 'venture')) return 'You already have a venture with them'
      const amount = o.amount as number
      if (them.resources.capital < amount + 30) return `${them.name} cannot match that: it has ${Math.floor(them.resources.capital)}`
      if (investedIn(s, o.target, o.sector) + amount > Math.max(1, them.sectors[o.sector] ?? 0) * INVEST.maxPerSize) return `${them.name}'s ${SECTORS[o.sector].name.toLowerCase()} cannot take that much outside money`
      return null
    }
    case 'aid': {
      if (o.resource !== 'food' && o.resource !== 'oil' && o.resource !== 'steel') return 'Choose food, oil or steel'
      if (!Number.isFinite(o.amount) || (o.amount as number) < 1 || (o.amount as number) > AID_MAX) return `Send between 1 and ${AID_MAX}`
      if (o.resource !== 'steel' && me.resources[o.resource] < (o.amount as number)) return `You do not have that much ${o.resource}`
      return null
    }
    case 'forgive': {
      const d = s.deals.find((x) => x.id === o.id)
      if (!d || d.to !== o.nationId || d.from !== o.target || (d.kind !== 'loan' && d.kind !== 'reparations')) return 'They owe you nothing you can forgive'
      return null
    }
    case 'techShare': {
      const t = o.techId ? TECH_BY_ID[o.techId] : undefined
      if (!t) return 'Choose a technology'
      if (!me.techs.includes(t.id)) return 'You do not have that technology'
      if (them.techs.includes(t.id)) return 'They already have it'
      if (!t.requires.every((q) => them.techs.includes(q))) return 'They are not ready for it: they lack what it builds on'
      return null
    }
    case 'cede': {
      const reg = o.give ? s.regions[o.give] : undefined
      if (!reg || reg.owner !== o.nationId) return 'Choose one of your countries'
      if (o.give === me.capital) return 'You cannot give away your capital'
      if (Object.values(s.regions).filter((x) => x.owner === o.nationId).length < 2) return 'You must keep at least one country'
      const m = map.regions[o.give as string]
      if (!m || !m.neighbors.some((n) => s.regions[n]?.owner === o.target)) return 'It must border them'
      if (s.occupied?.[o.give as string]) return 'You cannot give away land you hold by conquest'
      return null
    }
    case 'exercise':
      return null
    case 'training':
      return null
    case 'armsSale': {
      if (me.programs.armsExports === 'off') return 'Your arms exports are off (set them in the Government tab)'
      if (me.programs.armsExports === 'friends' && !isAllied(s, o.nationId, o.target) && !themHuman && opinionOf(s, map, o.target, o.nationId) < 15) return 'You sell arms to friends only, and they are not one yet'
      if (them.resources.capital < armsPrice(s) + 30) return 'They cannot afford it'
      return null
    }
    case 'intelShare':
      return null
    case 'sanction': {
      const e = o.enemy ? s.nations[o.enemy] : undefined
      if (!e?.alive || o.enemy === o.nationId || o.enemy === o.target) return 'Choose the nation they are sanctioning'
      if (!sanctionedBy(s, o.target, o.enemy as string)) return 'They are not sanctioning that nation'
      if (isAllied(s, o.nationId, o.enemy as string)) return 'You are allied with them'
      if (sanctionedBy(s, o.nationId, o.enemy as string)) return 'You are already sanctioning them'
      return null
    }
    case 'warPlan': {
      const e = o.enemy ? s.nations[o.enemy] : undefined
      if (!e?.alive || o.enemy === o.nationId || o.enemy === o.target) return 'Choose the enemy you will fight together'
      if (!atWar(s, o.nationId, o.enemy as string) || !atWar(s, o.target, o.enemy as string)) return 'You must both be at war with that enemy'
      const months = o.months ?? RELATIONS.plan.months
      if (!Number.isInteger(months) || months < RELATIONS.plan.minMonths || months > RELATIONS.plan.maxMonths) return `A plan runs ${RELATIONS.plan.minMonths} to ${RELATIONS.plan.maxMonths} months`
      const split = o.split ?? 0.25
      if (!Number.isFinite(split) || split < 0 || split > 0.5) return 'The partner gets between 0% and 50% of the spoils'
      if (plansBetween(s, o.nationId, o.target).some((p) => p.enemy === o.enemy)) return 'You already have a plan against them'
      if (plansOf(s, o.nationId).length >= RELATIONS.plan.perNation || plansOf(s, o.target).length >= RELATIONS.plan.perNation) return `Nobody can be in more than ${RELATIONS.plan.perNation} plans`
      return null
    }
    case 'endPlan': {
      const p = r.plans.find((x) => x.id === o.id)
      return p && (p.a === o.nationId || p.b === o.nationId) ? null : 'No such plan'
    }
    case 'strikeWindow': {
      const p = r.plans.find((x) => x.id === o.id && (x.a === o.nationId || x.b === o.nationId))
      if (!p) return 'No such plan'
      if (!o.region || s.regions[o.region]?.owner !== p.enemy) return `Choose one of ${name(s, p.enemy)}'s countries`
      const partner = p.a === o.nationId ? p.b : p.a
      if (!canAttackRegion(s, map, o.nationId, o.region).ok) return 'Your forces cannot reach it'
      if (isHuman(s, partner) === false && !canAttackRegion(s, map, partner, o.region).ok) return 'Their forces cannot reach it'
      return null
    }
    case 'callFavour': {
      if (favoursOwed(s, o.target, o.nationId) < 1) return 'They owe you no favour'
      const ask = o.ask && FAVOUR_ASKS[o.ask]
      if (!ask) return 'Choose what to ask for'
      const have = o.ask === 'money' ? them.resources.capital : o.ask === 'influence' ? them.resources.pp : them.resources.tp
      if (have < ask.amount + ask.keep) return 'They cannot spare it just now'
      return null
    }
  }
  return null
  }
  const specific = detail()
  if (specific) return specific
  // A rival takes only what its opinion of you allows. (Asked last, so the more useful reason comes first.)
  if (spec && spec.minOpinion > -100 && !themHuman && o.act !== 'apology') {
    const r = reception(s, map, o.target, o.nationId, o.act)
    if (!r.ok && !(o.act === 'aid' && needLevel(s, o.target, o.resource ?? 'food') !== 'flush' && r.opinion > -60)) return `${them.name} will not take it: ${r.reason} (their opinion of you is ${r.opinion}; this needs ${r.need})`
  }
  return null
}

/** What a unit of arms sold earns. */
export const armsPrice = (s: GameState) => Math.round(marketPrices(s).steel * 4 * 3)

function ensureView(s: GameState): RelationsState {
  return s.relations ?? { last: {}, soft: {}, embassies: [], programs: [], plans: [], favours: {}, requests: [], log: [], since: {}, contact: {} }
}

function askProblem(s: GameState, o: RelateOrder): string | null {
  if (!isHuman(s, o.target) || isHuman(s, o.nationId)) return 'Rivals ask players, never the other way round'
  const kinds = ['aid', 'venture', 'plan', 'trade', 'visit', 'support']
  if (!o.kind || !kinds.includes(o.kind)) return 'Unknown request'
  const r = ensureView(s)
  if (r.requests.filter((q) => q.to === o.target).length >= RELATIONS.maxRequests) return 'They are already weighing enough requests'
  if (r.requests.some((q) => q.from === o.nationId && q.to === o.target)) return 'They already have a request from us'
  const left = cooldownLeft(s, o)
  if (left > 0) return `Asked recently: wait ${left} more months`
  if (o.kind === 'aid' && (!o.resource || !(o.amount && o.amount > 0))) return 'Say what we need'
  if (o.kind === 'plan' && (!o.enemy || !atWar(s, o.nationId, o.enemy) || !atWar(s, o.target, o.enemy))) return 'A plan needs a shared enemy'
  if (o.kind === 'venture' && (!o.sector || !o.amount)) return 'Say what we would build'
  if (atWar(s, o.nationId, o.target)) return 'At war'
  return null
}

function answerProblem(s: GameState, map: WorldMap, o: RelateOrder, pending: { type: string }[]): string | null {
  const q = s.relations?.requests.find((x) => x.id === o.id && x.to === o.nationId)
  if (!q) return 'No such request'
  if (pending.some((p) => p.type === 'relate' && (p as RelateOrder).act === 'answer' && (p as RelateOrder).id === o.id)) return 'Already answered'
  if (!o.accept) return null
  switch (q.kind) {
    case 'aid':
    case 'support': {
      const u = underlying(s, o)
      return u ? relationProblem(s, map, { ...u, act: u.act }, pending) : null
    }
    case 'plan':
      if (!q.enemy || !atWar(s, o.nationId, q.enemy) || !atWar(s, q.from, q.enemy)) return 'You are no longer at war with the same enemy'
      if (plansBetween(s, o.nationId, q.from).some((p) => p.enemy === q.enemy)) return 'You already have that plan'
      if (plansOf(s, o.nationId).length >= RELATIONS.plan.perNation) return `You cannot be in more than ${RELATIONS.plan.perNation} plans`
      return null
    case 'venture': {
      const amount = q.amount ?? PROGRAMS.venture.min
      if (!q.sector) return 'No sector'
      const me = s.nations[o.nationId]
      if (me.resources.capital < amount) return `Not enough money (costs ${amount})`
      return null
    }
    default:
      return null
  }
}

// ---- doing it ------------------------------------------------------------------------------------------------------------

function note(s: GameState, a: NationId, b: NationId, act: string, text: string, news = false) {
  const r = ensureRelations(s)
  const e: RelEntry = { turn: s.turn, a, b, act, text }
  r.log.push(e)
  if (r.log.length > RELATIONS.logCap) r.log.splice(0, r.log.length - RELATIONS.logCap)
  if (news || isHuman(s, a) || isHuman(s, b)) addLog(s, 'diplomacy', text, [a, b])
  touch(s, a, b)
}

/** Records that two nations had warm contact this month: it starts the clock of neglect again. */
function touch(s: GameState, a: NationId, b: NationId) {
  ensureRelations(s).contact[pairKey(a, b)] = s.turn
}

/** A rng for an act that depends on nothing but the state and the act: asking twice, or undoing and asking again, gives the same answer. */
function actRng(s: GameState, o: RelateOrder): Rng {
  let h = 2166136261
  for (const ch of `${o.nationId}>${o.target}:${o.act}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return createRng((s.seed ^ h) >>> 0, s.turn)
}

const sameGovernment = (s: GameState, a: NationId, b: NationId) => s.nations[a]?.government === s.nations[b]?.government

/** Runs an order that has passed `relationProblem` and been paid for. Mutates `s`. */
export function applyRelate(s: GameState, map: WorldMap, o: RelateOrder): void {
  const r = ensureRelations(s)
  const me = s.nations[o.nationId]
  const them = s.nations[o.target]
  const spec = ACTS[o.act]
  const set = () => {
    r.last[cooldownKey(o)] = s.turn
  }
  const text = (t: string) => note(s, o.nationId, o.target, o.act, t)
  const both = (label: string, value: number, decay: number) => {
    warm(s, o.target, o.nationId, label, value, decay)
    warm(s, o.nationId, o.target, label, value, decay)
  }
  switch (o.act) {
    case 'visit': {
      set()
      const rng = actRng(s, o)
      const op = isHuman(s, o.target) ? 0 : opinionOf(s, map, o.target, o.nationId)
      let extra = ''
      if (op < VISIT.riskBelow && rng.chance(VISIT.incident)) {
        cool(s, o.target, o.nationId, 'Protocol incident', VISIT.incidentCost, 0.8)
        extra = ' A protocol incident marred it.'
      } else {
        warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
        if (op >= VISIT.warmAbove && rng.chance(VISIT.warm)) {
          warm(s, o.target, o.nationId, 'Warm reception', VISIT.warmBonus, 0.6)
          extra = ' They gave you a warm reception.'
        }
      }
      text(`${me.name}'s leader visited ${them.name}.${extra}`)
      return
    }
    case 'culture': {
      set()
      const v = spec!.boost * (sameGovernment(s, o.nationId, o.target) ? 1.3 : 1)
      warm(s, o.target, o.nationId, spec!.label, v, spec!.decay)
      text(`${me.name} held a cultural exchange with ${them.name}.`)
      return
    }
    case 'festival':
      set()
      warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
      text(`${me.name} hosted ${them.name} as guest of honour at a festival.`)
      return
    case 'recognise': {
      set()
      let w = spec!.boost
      let extra = ''
      if (hasCasusBelli(s, o.target, o.nationId)) {
        delete s.casusBelli[`${o.target}|${o.nationId}`]
        delete s.reasons[`${o.target}|${o.nationId}`]
        w = 14
        extra = ' Their grievance was withdrawn.'
      }
      warm(s, o.target, o.nationId, spec!.label, w, spec!.decay)
      text(`${me.name} recognised ${them.name}'s claims.${extra}`)
      return
    }
    case 'apology': {
      set()
      const pay = Math.max(0, Math.round(o.amount ?? 0))
      let heal = 8 + pay * 0.2
      let softened = 0
      for (const m of grudges(s, o.target, o.nationId)) {
        if (heal <= 0) break
        const part = Math.min(heal, -m.value)
        addOpinion(s, o.target, o.nationId, m.label, part, m.decay)
        heal -= part
        softened += part
      }
      if (hasCasusBelli(s, o.target, o.nationId) && pay >= 60) {
        delete s.casusBelli[`${o.target}|${o.nationId}`]
        delete s.reasons[`${o.target}|${o.nationId}`]
      }
      if (pay > 0 && !isHuman(s, o.target)) them.resources.capital += pay
      text(`${me.name} apologised to ${them.name}${pay ? ` and paid ${pay} in compensation` : ''}. Old grudges eased by ${softened.toFixed(0)}.`)
      return
    }
    case 'support':
      set()
      warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
      addFavour(s, o.target, o.nationId)
      text(`${me.name} backed ${them.name} in the World Council. ${them.name} owes it a favour.`)
      return
    case 'mediate': {
      set()
      warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
      if (o.enemy) warm(s, o.enemy, o.nationId, spec!.label, 5, spec!.decay)
      if (o.enemy && atWar(s, o.target, o.enemy)) {
        them.warWeariness = Math.max(0, them.warWeariness - 2)
        if (s.nations[o.enemy]) s.nations[o.enemy].warWeariness = Math.max(0, s.nations[o.enemy].warWeariness - 2)
      }
      text(`${me.name} mediated between ${them.name} and ${name(s, o.enemy ?? '')}.`)
      return
    }
    case 'embassy':
      set()
      r.embassies.push({ from: o.nationId, to: o.target, since: s.turn })
      s.intel[`${o.nationId}|${o.target}`] = Math.max(s.intel[`${o.nationId}|${o.target}`] ?? 0, s.turn + RELATIONS.embassyIntel)
      text(`${me.name} opened an embassy in ${them.name}.`)
      return
    case 'attache': {
      set()
      const e = embassyOf(s, o.nationId, o.target)
      if (e) {
        e.attache = true
        e.attacheSince = s.turn
      }
      text(`${me.name} posted a military attaché to ${them.name}.`)
      return
    }
    case 'closeEmbassy':
      r.embassies = r.embassies.filter((e) => !(e.from === o.nationId && e.to === o.target))
      cool(s, o.target, o.nationId, 'Closed our embassy', -4, 0.4)
      text(`${me.name} closed its embassy in ${them.name}.`)
      return
    case 'students':
    case 'science':
    case 'tradeMission':
    case 'tariff':
    case 'basing': {
      set()
      const kind = o.act === 'tradeMission' ? 'route' : o.act
      r.programs.push({ id: newId(s, 'rp'), kind, a: o.nationId, b: o.target, start: s.turn, until: s.turn + (spec!.months ?? 12) - 1 })
      warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
      if (!isHuman(s, o.nationId)) warm(s, o.nationId, o.target, spec!.label, spec!.boost * 0.5, spec!.decay)
      text(`${me.name} and ${them.name} began ${spec!.name.toLowerCase()} (${spec!.months} months).`)
      return
    }
    case 'endProgram': {
      const p = r.programs.find((x) => x.id === o.id)
      if (!p) return
      const other = p.a === o.nationId ? p.b : p.a
      endProgram(s, map, p, o.nationId)
      text(`${name(s, o.nationId)} ended the ${p.kind === 'route' ? 'trade mission' : p.kind} with ${name(s, other)}.`)
      return
    }
    case 'venture': {
      set()
      const amount = Math.round(o.amount as number)
      const sector = o.sector!
      them.resources.capital -= amount
      addToSector(them, sector, amount * 2, nationWorkforce(s, map, o.target), INVEST.efficiency)
      makeInvestment(s, o.nationId, o.target, sector, amount)
      r.programs.push({ id: newId(s, 'rp'), kind: 'venture', a: o.nationId, b: o.target, start: s.turn, until: s.turn + 35, sector, host: o.target, stake: amount })
      warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
      text(`${me.name} and ${them.name} each put ${amount} into ${them.name}'s ${SECTORS[sector].name.toLowerCase()}.`)
      return
    }
    case 'aid': {
      set()
      const res = o.resource as 'food' | 'oil' | 'steel'
      const amount = Math.round(o.amount as number)
      const level = needLevel(s, o.target, res) // need as it was, before the gift arrives
      // Steel is paid as the order's cost; food and oil leave the store here.
      if (res !== 'steel') me.resources[res] -= amount
      if (!isHuman(s, o.target)) them.resources[res] += amount
      const price = marketPrices(s)[res] ?? 1
      const base = clamp(amount * price * AID.perMoney, AID.min, AID.max)
      const mult = AID.needMult[level]
      const label = level === 'dire' ? 'Rescued us' : spec!.label
      warm(s, o.target, o.nationId, label, base * mult, spec!.decay)
      if (level === 'dire') addFavour(s, o.target, o.nationId)
      text(`${me.name} sent ${them.name} ${amount} ${res}${level === 'dire' ? ' in their hour of need. They owe it a favour' : level === 'flush' ? ', which they hardly needed' : ''}.`)
      return
    }
    case 'forgive': {
      set()
      // The deal's own rules give the thanks (src/engine/diplomacy.ts).
      cancelDeal(s, o.nationId, o.id as string)
      addFavour(s, o.target, o.nationId)
      text(`${me.name} forgave what ${them.name} owed. They owe it a favour.`)
      return
    }
    case 'techShare': {
      set()
      them.techs.push(o.techId as string)
      warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
      text(`${me.name} shared ${TECH_BY_ID[o.techId as string].name} with ${them.name}.`, )
      return
    }
    case 'cede': {
      set()
      const regionName = map.regions[o.give as string]?.name ?? (o.give as string)
      transferRegion(s, map, o.give as string, o.target, false)
      warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
      addFavour(s, o.target, o.nationId, 2)
      note(s, o.nationId, o.target, o.act, `${me.name} ceded ${regionName} to ${them.name}. They owe it two favours.`, true)
      return
    }
    case 'exercise':
      set()
      both(spec!.label, spec!.boost, spec!.decay)
      text(`${me.name} and ${them.name} held joint exercises.`)
      return
    case 'training':
      set()
      warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
      s.intel[`${o.nationId}|${o.target}`] = Math.max(s.intel[`${o.nationId}|${o.target}`] ?? 0, s.turn + 6)
      text(`${me.name} sent instructors to ${them.name}.`)
      return
    case 'armsSale': {
      set()
      const price = armsPrice(s)
      me.resources.capital += price
      if (!isHuman(s, o.target)) them.resources.capital -= price
      const needy = enemiesOf(s, o.target).length > 0
      warm(s, o.target, o.nationId, spec!.label, needy ? spec!.boost + 3 : spec!.boost, spec!.decay)
      text(`${me.name} sold arms to ${them.name} for ${price}.`)
      return
    }
    case 'intelShare':
      set()
      s.intel[`${o.nationId}|${o.target}`] = Math.max(s.intel[`${o.nationId}|${o.target}`] ?? 0, s.turn + 12)
      s.intel[`${o.target}|${o.nationId}`] = Math.max(s.intel[`${o.target}|${o.nationId}`] ?? 0, s.turn + 12)
      both(spec!.label, spec!.boost, spec!.decay)
      text(`${me.name} and ${them.name} agreed to share intelligence for a year.`)
      return
    case 'sanction': {
      set()
      s.sanctions.push({ from: o.nationId, to: o.enemy as string, until: s.turn + DIPLOMACY.sanctions.months })
      warm(s, o.target, o.nationId, spec!.label, spec!.boost, spec!.decay)
      text(`${me.name} joined ${them.name}'s sanctions on ${name(s, o.enemy ?? '')}.`)
      return
    }
    case 'warPlan': {
      set()
      const months = o.months ?? RELATIONS.plan.months
      const plan: WarPlan = { id: newId(s, 'wp'), a: o.nationId, b: o.target, enemy: o.enemy as string, start: s.turn, until: s.turn + months - 1, split: o.split ?? 0.25 }
      r.plans.push(plan)
      both(spec!.label, spec!.boost, spec!.decay)
      note(s, o.nationId, o.target, o.act, `${me.name} and ${them.name} agreed a joint war plan against ${name(s, plan.enemy)} for ${months} months.`, true)
      return
    }
    case 'endPlan': {
      const p = r.plans.find((x) => x.id === o.id)
      if (p) endPlan(s, p, o.nationId, 'left')
      return
    }
    case 'strikeWindow': {
      const p = r.plans.find((x) => x.id === o.id)
      if (!p) return
      const day = isLive(s) ? 8 + (Number.parseInt(p.id.replace(/\D/g, '') || '0', 10) % 12) : undefined
      p.strike = { region: o.region as string, turn: s.turn + (o.months === 1 ? 1 : 0), ...(day !== undefined ? { day } : {}) }
      note(s, o.nationId, p.a === o.nationId ? p.b : p.a, o.act, `${me.name} and its partner will strike ${map.regions[o.region as string]?.name ?? 'the enemy'} together${day !== undefined ? ` on day ${day + 1}` : ' this month'}.`)
      return
    }
    case 'callFavour': {
      const list = (r.favours[key(o.target, o.nationId)] ?? []).filter((u) => u >= s.turn).sort((x, y) => x - y)
      list.shift()
      r.favours[key(o.target, o.nationId)] = list
      const ask = FAVOUR_ASKS[o.ask as 'money']
      if (o.ask === 'money') {
        them.resources.capital -= ask.amount
        me.resources.capital += ask.amount
      } else if (o.ask === 'influence') {
        them.resources.pp -= ask.amount
        me.resources.pp += ask.amount
      } else {
        them.resources.tp -= ask.amount
        me.resources.tp += ask.amount
      }
      r.last[cooldownKey(o)] = s.turn
      cool(s, o.target, o.nationId, 'Called in a favour', -2, 0.5)
      text(`${me.name} called in a favour with ${them.name}: ${ask.text.toLowerCase()}.`)
      return
    }
    case 'ask': {
      r.last[cooldownKey(o)] = s.turn
      const q: RelRequest = { id: newId(s, 'rq'), from: o.nationId, to: o.target, kind: o.kind!, created: s.turn, expires: s.turn + RELATIONS.requestMonths - 1, text: requestText(s, o), ...(o.resource ? { resource: o.resource } : {}), ...(o.amount ? { amount: o.amount } : {}), ...(o.enemy ? { enemy: o.enemy } : {}), ...(o.sector ? { sector: o.sector } : {}), ...(o.months ? { months: o.months } : {}) }
      r.requests.push(q)
      s.dispatches.push({ kind: 'proposal', from: o.nationId, to: o.target, proposalKind: 'deal', text: `${me.name} asks for your help: ${q.text}` })
      addLog(s, 'diplomacy', `${me.name} asks for your help: ${q.text}`, [o.nationId, o.target])
      return
    }
    case 'answer':
      answerRequest(s, map, o)
      return
  }
}

function requestText(s: GameState, o: RelateOrder): string {
  switch (o.kind) {
    case 'aid':
      return `send ${o.amount} ${o.resource}. We are short.`
    case 'venture':
      return `build a joint venture in ${SECTORS[o.sector ?? 'manufacturing'].name.toLowerCase()}, ${o.amount} each.`
    case 'plan':
      return `agree a joint war plan against ${name(s, o.enemy ?? '')}.`
    case 'trade':
      return 'open a trade mission with us.'
    case 'visit':
      return 'receive our leader on a state visit.'
    default:
      return 'back us in the World Council.'
  }
}

function answerRequest(s: GameState, map: WorldMap, o: RelateOrder) {
  const r = ensureRelations(s)
  const q = r.requests.find((x) => x.id === o.id)
  if (!q) return
  const u = underlying(s, o)
  r.requests = r.requests.filter((x) => x.id !== q.id)
  const me = s.nations[o.nationId]
  const from = s.nations[q.from]
  touch(s, q.from, q.to)
  if (!o.accept) {
    if (s.settings.difficulty !== 'easy') cool(s, q.from, q.to, 'Turned us down', RELATIONS.refuseCost, 0.5)
    note(s, o.nationId, q.from, 'answer', `${me.name} turned down ${from.name}'s request.`)
    return
  }
  switch (q.kind) {
    case 'aid':
    case 'support': {
      if (u) applyRelate(s, map, u)
      break
    }
    case 'plan': {
      const plan: WarPlan = { id: newId(s, 'wp'), a: q.from, b: o.nationId, enemy: q.enemy as string, start: s.turn, until: s.turn + (q.months ?? RELATIONS.plan.months) - 1, split: 0.25 }
      r.plans.push(plan)
      warm(s, q.from, o.nationId, 'Joint war plan', 4, 0.3)
      break
    }
    case 'venture': {
      const amount = q.amount ?? PROGRAMS.venture.min
      me.resources.capital -= amount
      from.resources.capital -= Math.min(amount, Math.max(0, from.resources.capital - 20))
      addToSector(from, q.sector!, amount * 2, nationWorkforce(s, map, q.from), INVEST.efficiency)
      makeInvestment(s, o.nationId, q.from, q.sector!, amount)
      r.programs.push({ id: newId(s, 'rp'), kind: 'venture', a: o.nationId, b: q.from, start: s.turn, until: s.turn + 35, sector: q.sector, host: q.from, stake: amount })
      break
    }
    case 'trade':
      r.programs.push({ id: newId(s, 'rp'), kind: 'route', a: q.from, b: o.nationId, start: s.turn, until: s.turn + 11 })
      break
    case 'visit':
      me.resources.pp += 2
      warm(s, q.from, o.nationId, 'State visit', 8, 0.8)
      break
  }
  warm(s, q.from, o.nationId, 'Answered our call', 5, 0.5)
  addFavour(s, q.from, o.nationId)
  note(s, o.nationId, q.from, 'answer', `${me.name} answered ${from.name}'s call. ${from.name} owes it a favour.`)
}

// ---- running programs, plans and the month ------------------------------------------------------------------------------

function endProgram(s: GameState, map: WorldMap, p: RelProgram, by: NationId | null) {
  const r = ensureRelations(s)
  r.programs = r.programs.filter((x) => x.id !== p.id)
  const other = by === p.a ? p.b : p.a
  if (p.kind === 'venture') {
    // Walking out hands back half of what is left of the stake.
    const inv = (s.investments ?? []).find((i) => i.investor === p.a && i.target === p.host && i.sector === p.sector)
    if (by && inv) {
      const back = inv.amount * PROGRAMS.venture.walkOutRefund
      if (s.nations[by]?.alive) s.nations[by].resources.capital += back
      inv.amount -= inv.amount
      s.investments = (s.investments ?? []).filter((i) => i !== inv && i.amount >= 1)
    }
    if (by) cool(s, other, by, 'Walked out of our venture', PROGRAMS.venture.walkOutOpinion, 0.4)
  } else if (by && p.kind !== 'basing') cool(s, other, by, 'Left our program', PROGRAMS.walkOutOpinion, 0.4)
  else if (by && p.kind === 'basing') cool(s, other, by, 'Revoked basing rights', -8, 0.4)
  void map
}

function endPlan(s: GameState, p: WarPlan, by: NationId | null, why: 'left' | 'over' | 'time' | 'peace') {
  const r = ensureRelations(s)
  r.plans = r.plans.filter((x) => x.id !== p.id)
  const lasted = s.turn - p.start
  const text = `${name(s, p.a)} and ${name(s, p.b)}'s joint war plan against ${name(s, p.enemy)} ${why === 'left' ? `was ended by ${name(s, by ?? p.a)}` : why === 'peace' ? 'ended with the war' : 'ran its course'}.`
  note(s, p.a, p.b, 'endPlan', text, true)
  if (why === 'left' && by) {
    const other = by === p.a ? p.b : p.a
    cool(s, other, by, 'Abandoned our war plan', RELATIONS.plan.abandon, 0.4)
  } else if (lasted >= 3) {
    warm(s, p.a, p.b, 'Fought beside us', RELATIONS.plan.bond, 0.5)
    warm(s, p.b, p.a, 'Fought beside us', RELATIONS.plan.bond, 0.5)
  }
}

/** The partners of a nation whose war credit it shares: nations in a joint war plan with it against the same enemy. */
export function planPartners(s: GameState, nationId: NationId, enemy: NationId): NationId[] {
  const out: NationId[] = []
  for (const p of s.relations?.plans ?? []) {
    if (p.enemy !== enemy) continue
    if (p.a === nationId) out.push(p.b)
    else if (p.b === nationId) out.push(p.a)
  }
  return out
}

/**
 * Called as an attack lands: records the blow, and if the partner struck the same country inside the window (this month in a turn game, within a
 * few days in a live one) the second blow is a combined strike and pushes the Defense Line back further. Returns the line left.
 */
export function combinedStrike(s: GameState, nationId: NationId, target: string, enemy: NationId, lineAfter: number, won: boolean): number {
  const plans = (s.relations?.plans ?? []).filter((p) => p.enemy === enemy && (p.a === nationId || p.b === nationId))
  if (!plans.length) return lineAfter
  let line = lineAfter
  for (const p of plans) {
    const partner = p.a === nationId ? p.b : p.a
    const hits = (p.hits ??= [])
    const near = hits.find((h) => h.nation === partner && h.region === target && h.turn === s.turn && (!isLive(s) || Math.abs((h.day ?? 0) - (s.day ?? 0)) <= RELATIONS.plan.windowDays))
    if (near && won && line > 0) {
      line = Math.max(0, line - RELATIONS.plan.combinedPush)
      addLog(s, 'war', `COMBINED STRIKE: ${name(s, nationId)} and ${name(s, partner)} hit ${name(s, enemy)}'s country together.`, [nationId, partner, enemy])
    }
    hits.push({ nation: nationId, region: target, turn: s.turn, ...(s.day !== undefined ? { day: s.day } : {}) })
    if (hits.length > 6) hits.splice(0, hits.length - 6)
  }
  return line
}

/** A country was taken from `enemy` by `taker`: its partners in a joint plan are paid their share of its value. */
export function shareSpoils(s: GameState, map: WorldMap, taker: NationId, region: string, enemy: NationId) {
  for (const p of s.relations?.plans ?? []) {
    if (p.enemy !== enemy || (p.a !== taker && p.b !== taker)) continue
    const partner = p.a === taker ? p.b : p.a
    const pn = s.nations[partner]
    const tn = s.nations[taker]
    if (!pn?.alive || !tn?.alive) continue
    const owed = Math.round(regionValue(s, map, region) * p.split)
    const pay = Math.min(owed, Math.max(0, Math.floor(tn.resources.capital)))
    if (pay <= 0) continue
    tn.resources.capital -= pay
    pn.resources.capital += pay
    p.paid = (p.paid ?? 0) + pay
    addLog(s, 'diplomacy', `${tn.name} paid ${pn.name} ${pay} as its share of the spoils of ${map.regions[region]?.name ?? 'the war'}.`, [taker, partner])
    warm(s, partner, taker, 'Fought beside us', 3, 0.5)
  }
}

/** Whether a nation holds a pact, an alliance or a trade deal with anyone. */
function hasArrangement(s: GameState, id: NationId): boolean {
  for (const [k, until] of Object.entries(s.pacts)) if (until >= s.turn && k.split('|').includes(id)) return true
  return s.alliances.some((k) => k.split('|').includes(id)) || s.deals.some((d) => d.kind === 'trade' && (d.from === id || d.to === id))
}

/** The month's work for relationships. Runs after the economy. Does nothing until someone has used the desk. */
export function runRelations(s: GameState, map: WorldMap, rng: Rng): void {
  if (!RELATIONS.on) return
  // Nothing to keep up until someone does something in the desk or a player holds a treaty, a trade deal or an embassy.
  if (!s.relations && !s.humans.some((h) => hasArrangement(s, h))) return
  const r = ensureRelations(s)
  // Warmth earned lately fades, so the next gift is worth more again.
  for (const k of Object.keys(r.soft)) {
    r.soft[k] *= 1 - RELATIONS.softFade
    if (r.soft[k] < 0.5) delete r.soft[k]
  }
  // Favours lapse.
  for (const k of Object.keys(r.favours)) {
    r.favours[k] = r.favours[k].filter((u) => u >= s.turn)
    if (!r.favours[k].length) delete r.favours[k]
  }
  // Embassies: the bill, the slow warmth, a window onto them.
  for (const e of [...r.embassies]) {
    const owner = s.nations[e.from]
    const host = s.nations[e.to]
    if (!owner?.alive || !host?.alive || atWar(s, e.from, e.to)) {
      r.embassies = r.embassies.filter((x) => x !== e)
      continue
    }
    const bill = (ACTS.embassy?.upkeep ?? 0) + (e.attache ? (ACTS.attache?.upkeep ?? 0) : 0)
    if (owner.resources.capital < bill) {
      r.embassies = r.embassies.filter((x) => x !== e)
      cool(s, e.to, e.from, 'Closed our embassy', -3, 0.4)
      if (isHuman(s, e.from)) addLog(s, 'diplomacy', `Your embassy in ${host.name} closed: you could not pay its bill.`, [e.from, e.to])
      continue
    }
    owner.resources.capital -= bill
    s.intel[`${e.from}|${e.to}`] = Math.max(s.intel[`${e.from}|${e.to}`] ?? 0, s.turn + RELATIONS.embassyIntel)
    touch(s, e.from, e.to)
  }
  // Programs.
  for (const p of [...r.programs].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const a = s.nations[p.a]
    const b = s.nations[p.b]
    if (!a?.alive || !b?.alive) {
      r.programs = r.programs.filter((x) => x.id !== p.id)
      continue
    }
    if (atWar(s, p.a, p.b)) {
      r.programs = r.programs.filter((x) => x.id !== p.id)
      note(s, p.a, p.b, 'endProgram', `The ${p.kind === 'route' ? 'trade mission' : p.kind} between ${a.name} and ${b.name} ended with the war.`)
      continue
    }
    const research = PROGRAMS.researchPerMonth[p.kind] ?? 0
    if (research) {
      a.resources.tp += research
      b.resources.tp += research
    }
    if (p.kind === 'route') {
      a.resources.capital += PROGRAMS.routeMoney
      b.resources.capital += PROGRAMS.routeMoney
    } else if (p.kind === 'tariff') {
      a.resources.capital += PROGRAMS.tariffMoney
      b.resources.capital += PROGRAMS.tariffMoney
    } else if (p.kind === 'venture') {
      const y = (p.stake ?? 0) * PROGRAMS.venture.yield
      a.resources.capital += y
      b.resources.capital += y
    }
    touch(s, p.a, p.b)
    if (s.turn >= p.until) {
      r.programs = r.programs.filter((x) => x.id !== p.id)
      note(s, p.a, p.b, 'endProgram', `The ${p.kind === 'route' ? 'trade mission' : p.kind === 'venture' ? 'joint venture' : p.kind} between ${a.name} and ${b.name} ran its course.`)
    }
  }
  // Joint war plans.
  for (const p of [...r.plans].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const a = s.nations[p.a]
    const b = s.nations[p.b]
    const e = s.nations[p.enemy]
    if (!a?.alive || !b?.alive || !e?.alive) {
      endPlan(s, p, null, 'over')
      continue
    }
    const aWar = atWar(s, p.a, p.enemy)
    const bWar = atWar(s, p.b, p.enemy)
    if (!aWar || !bWar) {
      // Whoever made a separate peace walked out on the other.
      if (aWar !== bWar) {
        const quitter = aWar ? p.b : p.a
        r.plans = r.plans.filter((x) => x.id !== p.id)
        const other = quitter === p.a ? p.b : p.a
        cool(s, other, quitter, 'Abandoned our war plan', RELATIONS.plan.abandon, 0.4)
        note(s, p.a, p.b, 'endPlan', `${name(s, quitter)} made a separate peace with ${e.name}, ending the joint war plan.`, true)
      } else endPlan(s, p, null, 'peace')
      continue
    }
    if (s.turn >= p.until) {
      endPlan(s, p, null, 'time')
      continue
    }
    if (p.strike && p.strike.turn < s.turn) delete p.strike
    touch(s, p.a, p.b)
  }
  // Treaties: how long they have held, for anniversaries and steadfast friendship.
  const live = new Set<string>()
  for (const [k, until] of Object.entries(s.pacts)) if (until >= s.turn) live.add(k)
  for (const k of s.alliances) live.add(k)
  for (const k of live) if (r.since[k] === undefined) r.since[k] = s.turn
  for (const k of Object.keys(r.since)) if (!live.has(k)) delete r.since[k]
  for (const [k, since] of Object.entries(r.since)) {
    const [x, y] = k.split('|')
    const age = s.turn - since
    if (age > 0 && age % RELATIONS.anniversary.every === 0) {
      warm(s, x, y, 'Treaty anniversary', RELATIONS.anniversary.boost, RELATIONS.anniversary.decay)
      warm(s, y, x, 'Treaty anniversary', RELATIONS.anniversary.boost, RELATIONS.anniversary.decay)
      if (isHuman(s, x) || isHuman(s, y)) addLog(s, 'diplomacy', `${name(s, x)} and ${name(s, y)} marked the anniversary of their ${s.alliances.includes(k) ? 'alliance' : 'pact'}.`, [x, y])
    }
  }
  // Requests that ran out unanswered.
  for (const q of [...r.requests]) {
    if (s.turn <= q.expires) continue
    r.requests = r.requests.filter((x) => x.id !== q.id)
    if (s.settings.difficulty !== 'easy') cool(s, q.from, q.to, 'Ignored our request', RELATIONS.ignoreCost, 0.4)
    s.dispatches.push({ kind: 'ignored', from: q.to, to: q.from, proposalKind: 'deal', text: `Your silence on ${name(s, q.from)}'s request was noted${s.settings.difficulty === 'easy' ? '' : '. They think less of you'}.` })
  }
  void map
  void rng
}

/** How far a joint program's neglect line goes. */
export const NEGLECT_FLOOR = -RELATIONS.neglectCap
