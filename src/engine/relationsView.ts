import { opinionLabel, opinionReport, nationNeighbors, storedOpinion, type OpinionContext, type OpinionPart, type OpinionReport } from '../ai/opinion'
import { SECTORS } from '../data/business'
import { TECH_BY_ID } from '../data/techTree'
import { ACTS, AID, FAVOUR_ASKS, PROGRAMS, RELATIONS, VISIT } from '../data/relations'
import { enemiesOf, hasPact, isAllied, pairKey } from './helpers'
import { militaryPower } from './economy'
import { sameFaction } from './factions'
import { relationLines, monthsQuiet } from './relationParts'
import { armsPrice, cooldownLeft, embassyOf, favoursOwed, needLevel, programsBetween, relationCost, relationProblem, warmthFactor } from './relations'
import type { GameState, NationId, RelateAct, RelateAid, RelateOrder, WorldMap } from './types'

const nm = (s: GameState, id: NationId) => s.nations[id]?.name ?? id

/** The order in words, for the order list and the log. */
export function describeRelate(s: GameState, map: WorldMap, o: RelateOrder): string {
  const them = nm(s, o.target)
  const enemy = nm(s, o.enemy ?? '')
  const spec = ACTS[o.act]
  switch (o.act) {
    case 'aid':
      return `Send ${them} ${Math.round(o.amount ?? 0)} ${o.resource ?? 'aid'}`
    case 'venture':
      return `Joint venture with ${them}: ${Math.round(o.amount ?? 0)} each in ${SECTORS[o.sector ?? 'manufacturing']?.name.toLowerCase() ?? 'business'}`
    case 'warPlan':
      return `Joint war plan with ${them} against ${enemy}`
    case 'endPlan':
      return 'End the joint war plan'
    case 'strikeWindow':
      return `Strike ${map.regions[o.region ?? '']?.name ?? 'the enemy'} together with your partner`
    case 'callFavour':
      return `Call in a favour with ${them}: ${FAVOUR_ASKS[o.ask ?? 'money']?.name.toLowerCase() ?? 'help'}`
    case 'closeEmbassy':
      return `Close the embassy in ${them}`
    case 'endProgram':
      return `End the program with ${them}`
    case 'techShare':
      return `Share ${TECH_BY_ID[o.techId ?? '']?.name ?? 'a technology'} with ${them}`
    case 'cede':
      return `Cede ${map.regions[o.give ?? '']?.name ?? 'a country'} to ${them}`
    case 'forgive':
      return `Forgive ${them}'s debt`
    case 'sanction':
      return `Join ${them}'s sanctions on ${enemy}`
    case 'mediate':
      return `Mediate between ${them} and ${enemy}`
    case 'apology':
      return `Apologise to ${them}${o.amount ? ` and pay ${Math.round(o.amount)}` : ''}`
    case 'ask':
      return `Ask ${them} for help`
    case 'answer': {
      const q = s.relations?.requests.find((x) => x.id === o.id)
      return `${o.accept ? 'Accept' : 'Decline'} ${q ? nm(s, q.from) : 'a'} request`
    }
    default:
      return `${spec?.name ?? 'Act'}: ${them}`
  }
}

export interface PreviewPart {
  label: string
  amount: number
  have?: number
}

export interface ActPreview {
  costs: PreviewPart[]
  effects: string[]
  /** Why it cannot be done, or null. */
  why: string | null
  /** Months until it can be done again for this partner, 0 when it can be done now. */
  wait: number
  /** A line on what could go wrong. */
  risk?: string
}

/** What an order will cost and do, before it is made. For the partner card's buttons. */
export function previewRelate(s: GameState, map: WorldMap, o: RelateOrder, pending: { type: string }[] = []): ActPreview {
  const me = s.nations[o.nationId]
  const spec = ACTS[o.act]
  const c = relationCost(s, o)
  const costs: PreviewPart[] = []
  if (c.capital) costs.push({ label: 'money', amount: c.capital, have: me?.resources.capital })
  if (c.pp) costs.push({ label: 'influence', amount: c.pp, have: me?.resources.pp })
  if (c.tp) costs.push({ label: 'research', amount: c.tp, have: me?.resources.tp })
  if (c.steel) costs.push({ label: 'steel', amount: c.steel, have: me?.resources.steel })
  if (o.act === 'aid' && o.resource && o.resource !== 'steel') costs.push({ label: o.resource, amount: Math.round(o.amount ?? 0), have: me?.resources[o.resource] })
  const effects: string[] = []
  let risk: string | undefined
  const factor = warmthFactor(s, o.target, o.nationId)
  const fade = (decay: number) => (decay > 0 ? ` (fades over about ${Math.round(Math.max(1, (spec?.boost ?? 0) / decay))} months)` : '')
  const worth = (boost: number) => `+${Math.max(0, boost * factor).toFixed(0)} opinion${fade(spec?.decay ?? 0)}${factor < 0.95 ? `, worth ${Math.round(factor * 100)}% because you have been generous lately` : ''}`
  switch (o.act) {
    case 'visit':
      effects.push(worth(spec!.boost))
      risk = `If they think poorly of you (under ${VISIT.riskBelow}), ${Math.round(VISIT.incident * 100)}% risk of a protocol incident (${VISIT.incidentCost}).`
      break
    case 'aid': {
      const level = o.resource ? needLevel(s, o.target, o.resource) : 'ok'
      const base = Math.min(AID.max, Math.max(AID.min, (o.amount ?? 0) * (o.resource === 'oil' ? 2 : o.resource === 'steel' ? 1.8 : 1.3) * AID.perMoney))
      effects.push(`+${(base * AID.needMult[level] * factor).toFixed(0)} opinion (${level === 'dire' ? 'they are desperate for it: they owe you a favour' : level === 'short' ? 'they are short of it' : level === 'flush' ? 'they hardly need it' : 'a fair gift'})`)
      break
    }
    case 'apology':
      effects.push('Softens their worst grudges by up to ' + (8 + (o.amount ?? 0) * 0.2).toFixed(0) + (o.amount && o.amount >= 60 ? ' and withdraws a grievance' : ''))
      break
    case 'embassy':
      effects.push(`+${spec!.boost} now, then slowly up to +${RELATIONS.embassyCap}`, `Shows you their real numbers; costs ${spec!.upkeep} money a month`)
      break
    case 'attache':
      effects.push(`Warmth builds faster, up to +${RELATIONS.attacheCap}; unlocks exercises, training and basing`, `Costs ${spec!.upkeep} more a month`)
      break
    case 'students':
    case 'science':
      effects.push(`Both gain ${PROGRAMS.researchPerMonth[o.act]} research a month for ${spec!.months} months`, `Warmth builds up to +${PROGRAMS.steady[o.act][1]}`)
      break
    case 'tradeMission':
      effects.push(`Both earn +${PROGRAMS.routeMoney} money a month for ${spec!.months} months`, worth(spec!.boost))
      break
    case 'tariff':
      effects.push(`Both earn +${PROGRAMS.tariffMoney} money a month for ${spec!.months} months`)
      break
    case 'venture': {
      const amount = o.amount ?? 0
      effects.push(`Each side puts in ${Math.round(amount)}; both earn about ${(amount * PROGRAMS.venture.yield).toFixed(1)} a month, and you also collect the usual dividend`, `Walking away: ${PROGRAMS.venture.walkOutOpinion} opinion and you keep only half your stake`)
      break
    }
    case 'techShare':
      effects.push(worth(spec!.boost), 'They gain the technology')
      break
    case 'cede':
      effects.push(worth(spec!.boost), 'They owe you two favours', 'You lose the country for good')
      break
    case 'armsSale':
      effects.push(`You earn ${armsPrice(s)} money`, worth(spec!.boost))
      break
    case 'warPlan':
      effects.push(`A joint plan for ${o.months ?? RELATIONS.plan.months} months; if either of you takes a country, the other is paid ${Math.round((o.split ?? 0.25) * 100)}% of its value`, 'Hit the same country in the same month (or within a few days, live) for a combined strike')
      break
    case 'callFavour': {
      const ask = FAVOUR_ASKS[o.ask ?? 'money']
      effects.push(`${ask.text}: +${ask.amount}`, 'Uses one favour; they think a little less of you')
      break
    }
    case 'sanction':
      effects.push(worth(spec!.boost), 'Cuts your trade with the target')
      break
    case 'forgive':
      effects.push('Thanks from them (about +18) and a favour owed to you', 'You lose the remaining payments')
      break
    default:
      if (spec && spec.boost > 0) effects.push(worth(spec.boost))
  }
  let why = relationProblem(s, map, o, pending)
  if (!why) {
    const short = costs.find((c) => c.have !== undefined && c.amount > c.have + 1e-9)
    if (short) why = `Not enough ${short.label} (costs ${Math.round(short.amount)})`
  }
  return { costs, effects, why, wait: cooldownLeft(s, o), risk }
}

// ---- why they feel this way ----------------------------------------------------------------------------------------------

export type ReasonGroup = 'Shared enemies' | 'Trade' | 'Treaties' | 'Aid and gifts' | 'Visits and exchange' | 'Military cooperation' | 'Faction' | 'Border tension' | 'Government and temperament' | 'Bad acts' | 'Other'

const GIFT = new Set(['Rescued us', 'Aid in kind', 'Forgave our debt', 'Forgave our loan', 'Forgave our debts', 'Shared technology', 'Ceded us land', 'Invested in our businesses', 'Answered our call', 'Recognised our claims'])
const EXCHANGE = new Set(['State visit', 'Warm reception', 'Cultural exchange', 'Festival guest', 'Embassy', 'Exchange students', 'Student exchange', 'Joint research', 'Trade mission', 'Trade routes', 'Preferential tariffs', 'Joint venture', 'Backed us at the Council', 'Mediated for us'])
const MILITARY = new Set(['Joint exercises', 'Training mission', 'Shared intelligence', 'Basing rights', 'Joined our sanctions', 'Arms sale', 'Joint war plan', 'Fought beside us'])
const TREATY = new Set(['Allies', 'Non-aggression pact', 'Treaty anniversary', 'Steadfast ally'])
const TRADE = new Set(['Trade partners', 'Honored our deal', 'Broke a trade deal', 'Defaulted on a deal', 'Broke a contract', 'Defaulted on our loan'])

export function reasonGroup(label: string, value: number): ReasonGroup {
  if (label === 'Common enemy') return 'Shared enemies'
  if (TRADE.has(label)) return 'Trade'
  if (TREATY.has(label)) return 'Treaties'
  if (GIFT.has(label)) return 'Aid and gifts'
  if (EXCHANGE.has(label)) return 'Visits and exchange'
  if (MILITARY.has(label)) return 'Military cooperation'
  if (label === 'Faction partners') return 'Faction'
  if (label === 'Border tensions') return 'Border tension'
  if (label === 'Temperament' || label === 'Same system of government' || label === 'Opposed systems of government') return 'Government and temperament'
  if (value < 0) return 'Bad acts'
  return 'Other'
}

export interface ReasonSet {
  group: ReasonGroup
  total: number
  parts: OpinionPart[]
}

/** The reasons for an opinion, grouped the way a person would say them: shared enemies, trade, treaties, aid, visits, bad acts, borders, government, faction. */
export function groupReasons(report: OpinionReport): ReasonSet[] {
  const order: ReasonGroup[] = ['Treaties', 'Shared enemies', 'Trade', 'Visits and exchange', 'Aid and gifts', 'Military cooperation', 'Faction', 'Government and temperament', 'Border tension', 'Bad acts', 'Other']
  const by = new Map<ReasonGroup, ReasonSet>()
  for (const p of report.parts) {
    const g = reasonGroup(p.label, p.value)
    const set = by.get(g) ?? { group: g, total: 0, parts: [] }
    set.total += p.value
    set.parts.push(p)
    by.set(g, set)
  }
  return order.filter((g) => by.has(g)).map((g) => by.get(g)!)
}

// ---- which way it is moving ---------------------------------------------------------------------------------------------

export interface Mover {
  label: string
  /** Change each month. */
  value: number
}

/** The things moving a rival's opinion of a nation, each as the change they make each month, and the sum. It is an estimate of next month. */
export function movement(s: GameState, holder: NationId, target: NationId): { total: number; movers: Mover[] } {
  const movers: Mover[] = []
  for (const m of storedOpinion(s, holder, target)) {
    const step = m.value > 0 ? -Math.min(m.decay, m.value) : Math.min(m.decay, -m.value)
    if (Math.abs(step) >= 0.05) movers.push({ label: m.label, value: step })
  }
  for (const l of relationLines(s, holder, target)) if (Math.abs(l.step) >= 0.05) movers.push({ label: l.label, value: l.step })
  movers.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  return { total: movers.reduce((sum, m) => sum + m.value, 0), movers }
}

export interface Health {
  /** 0 to 100. */
  score: number
  label: 'Thriving' | 'Healthy' | 'Cooling' | 'Neglected' | 'Hostile'
  /** How much their opinion falls each month if you do nothing (0 when it is steady or rising). */
  coolsBy: number
  /** Months until it would reach Cordial (5) from here if nothing is done, or null. */
  monthsLeft: number | null
  /** The sentence for the warning, or null when there is nothing to warn about. */
  warning: string | null
  lastContact: number | null
}

/** How well a relationship is looked after: its warmth, whether it is kept up, and what it is losing each month. */
export function relationHealth(s: GameState, me: NationId, id: NationId, opinion: number): Health {
  const mv = movement(s, id, me)
  const quiet = monthsQuiet(s, me, id)
  const arranged = quiet !== null || programsBetween(s, me, id).length > 0
  const stale = quiet ?? 0
  const contact = quiet === null ? null : s.turn - quiet
  const coolsBy = Math.max(0, -mv.total)
  const kept = (embassyOf(s, me, id) ? 12 : 0) + (embassyOf(s, me, id)?.attache ? 6 : 0) + Math.min(12, programsBetween(s, me, id).length * 6) + (contact === null ? 0 : Math.max(0, 20 - stale * 1.2))
  const score = Math.round(Math.min(100, Math.max(0, (opinion + 100) * 0.4 + kept + (coolsBy > 0 ? -coolsBy * 4 : 4))))
  const label: Health['label'] = opinion <= -25 ? 'Hostile' : arranged && stale > RELATIONS.neglectAfter ? 'Neglected' : coolsBy >= 0.8 && opinion > 5 ? 'Cooling' : score >= 70 ? 'Thriving' : 'Healthy'
  let monthsLeft: number | null = null
  if (coolsBy > 0.1 && opinion > 5) monthsLeft = Math.max(1, Math.ceil((opinion - 5) / coolsBy))
  let warning: string | null = null
  if (coolsBy >= 0.3 && opinion > -25) warning = `Relations cool by about ${coolsBy.toFixed(1)} a month unless maintained${monthsLeft ? `: they would be merely cordial in about ${monthsLeft} month${monthsLeft === 1 ? '' : 's'}` : ''}.`
  else if (arranged && stale > RELATIONS.neglectAfter - 3) warning = stale > RELATIONS.neglectAfter ? `You have not been in touch for ${stale} months. They feel neglected and are cooling.` : `No contact for ${stale} months: after ${RELATIONS.neglectAfter} they start to feel neglected.`
  return { score, label, coolsBy, monthsLeft, warning, lastContact: contact }
}

// ---- needs and wants -----------------------------------------------------------------------------------------------------

export interface Need {
  level: 'dire' | 'short' | 'want'
  text: string
  act?: RelateAct
  resource?: RelateAid
}

/** What a rival is short of right now: the things that would please it most. */
export function partnerNeeds(s: GameState, map: WorldMap, id: NationId, me?: NationId): Need[] {
  const n = s.nations[id]
  if (!n) return []
  const out: Need[] = []
  for (const r of ['food', 'oil', 'steel'] as const) {
    const lv = needLevel(s, id, r)
    if (lv === 'dire' || lv === 'short') out.push({ level: lv, text: `${lv === 'dire' ? 'Running out of' : 'Short of'} ${r}`, act: 'aid', resource: r })
  }
  if (n.resources.capital < 30) out.push({ level: 'short', text: 'Short of money: a loan, a trade deal or a joint venture would help', act: 'venture' })
  const foes = enemiesOf(s, id)
  if (foes.length) {
    out.push({ level: 'short', text: `At war with ${foes.slice(0, 2).map((f) => nm(s, f)).join(' and ')}: arms, a war plan or a mediator would be welcome`, act: me && foes.some((f) => enemiesOf(s, me).includes(f)) ? 'warPlan' : 'armsSale' })
  } else {
    const mine = militaryPower(s, id)
    const bigger = [...nationNeighbors(s, map, id)].some((x) => militaryPower(s, x) > mine * 1.4)
    if (bigger) out.push({ level: 'want', text: 'Feels exposed beside a stronger neighbor: a pact, a guarantee or an exercise would reassure it', act: 'exercise' })
  }
  if (n.stability < 40) out.push({ level: 'short', text: 'Unrest at home: food or a festival would calm it', act: 'festival' })
  return out
}

/** What a rival's temperament makes it like. */
export function partnerWants(s: GameState, id: NationId): Need[] {
  const p = s.nations[id]?.personality
  switch (p) {
    case 'trader':
      return [{ level: 'want', text: 'Merchants like trade: a trade mission, tariffs and ventures count for more', act: 'tradeMission' }]
    case 'expansionist':
      return [{ level: 'want', text: 'Respects strength: exercises, arms and a joint war plan; it takes goodwill gestures coolly', act: 'exercise' }]
    case 'turtle':
      return [{ level: 'want', text: 'Wants security: pacts, guarantees and shared intelligence; military shows leave it uneasy', act: 'intelShare' }]
    case 'opportunist':
      return [{ level: 'want', text: 'Follows its interest: favours, trade and a profitable venture', act: 'venture' }]
    default:
      return [{ level: 'want', text: 'Values honour: keep your word and apologise when you are wrong', act: 'apology' }]
  }
}

// ---- the partner list ----------------------------------------------------------------------------------------------------

export interface PartnerRow {
  id: NationId
  opinion: number
  label: string
  /** The estimated change next month. */
  trend: number
  ally: boolean
  pact: boolean
  trade: boolean
  embassy: boolean
  war: boolean
  neighbor: boolean
  faction: boolean
  favoursOwedToMe: number
  favoursIOwe: number
  human: boolean
  /** Warmth from rival to you cannot be read for another player. */
  report: OpinionReport | null
}

/** Every living nation but you, as a row with its opinion of you and what it is doing. `ctx` keeps the opinion maths cheap for a long list. */
export function partnerRows(s: GameState, map: WorldMap, me: NationId, ctx: OpinionContext = {}): PartnerRow[] {
  const neighbors = nationNeighbors(s, map, me)
  const rows: PartnerRow[] = []
  for (const n of Object.values(s.nations)) {
    if (!n.alive || n.id === me) continue
    const human = s.humans.includes(n.id) || n.isPlayer
    const report = human ? null : opinionReport(s, map, n.id, me, ctx)
    const opinion = report?.total ?? 0
    rows.push({
      id: n.id,
      opinion,
      label: human ? 'Player' : opinionLabel(opinion),
      trend: human ? 0 : movement(s, n.id, me).total,
      ally: isAllied(s, me, n.id),
      pact: hasPact(s, me, n.id),
      trade: s.deals.some((d) => d.kind === 'trade' && ((d.from === me && d.to === n.id) || (d.to === me && d.from === n.id))),
      embassy: !!embassyOf(s, me, n.id),
      war: s.wars.includes(pairKey(me, n.id)),
      neighbor: neighbors.has(n.id),
      faction: sameFaction(s, me, n.id),
      favoursOwedToMe: favoursOwed(s, n.id, me),
      favoursIOwe: favoursOwed(s, me, n.id),
      human: !!human,
      report,
    })
  }
  return rows
}

