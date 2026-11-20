import { BASE_CEP, DEVS, DEV_IDS, FACILITIES, FACILITY_IDS, PRODUCTION_RULES, PROGRAM_RULES, STAFF, type FacilityId, type LineKind, type MissileDevId, type MissileProgramAction } from '../data/missileProgram'
import { MISSILES, MISSILE_PROGRAM, PROGRAM_MISSILES } from '../data/missiles'
import { clockOf, isLive } from '../engine/calendar'
import { buildDue, buildRate, devDue, devRate, devStatus, lineRate, monthEnd, monthsBetween, programProblem, testOdds } from '../engine/missileProgram'
import { fundMissilesProblem, programLevel, reachKm } from '../engine/missiles'
import { programFx } from '../engine/programEffects'
import type { GameState, MissileType, Nation, Order } from '../engine/types'

/** Plain words for the Missile Program tab: when things finish, what to do next, what the program gives a strike. Pure, so it is tested. */

const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

/** When an absolute day comes, in the game's own terms: days in a live game, months in a turn game. */
export function whenText(game: GameState, due: number): string {
  if (!Number.isFinite(due)) return 'on hold'
  const now = clockOf(game)
  if (isLive(game)) {
    const days = Math.max(0, Math.round(due - now))
    return days === 0 ? 'today' : `in ${plural(days, 'day')}`
  }
  if (due <= monthEnd(game)) return 'this month'
  return `in ${plural(Math.ceil(monthsBetween(now, due) - 1e-6), 'month')}`
}

export interface TimelineItem {
  id: string
  kind: 'facility' | 'dev' | 'test' | 'line'
  title: string
  due: number
  /** Share done, 0 to 1, as of the clock. */
  share: number
  color: string
}

/** Everything in hand, soonest first: facilities, developments, tests on the pad or in the air, the production line. */
export function timeline(game: GameState, n: Nation): TimelineItem[] {
  const p = n.mprog
  if (!p) return []
  const now = clockOf(game)
  const out: TimelineItem[] = []
  const share = (left: number, total: number, rate: number) => {
    const extra = now > p.asOf ? monthsBetween(p.asOf, now) * rate : 0
    return Math.max(0, Math.min(1, 1 - (left - extra) / Math.max(1e-9, total)))
  }
  for (const b of p.builds) out.push({ id: `f-${b.facility}`, kind: 'facility', title: `${FACILITIES[b.facility].name}, level ${b.level}`, due: buildDue(n, b.facility), share: share(b.left, b.total, buildRate(n)), color: '#64d2ff' })
  for (const id of DEV_IDS) {
    const d = p.devs[id]
    if (d?.state !== 'dev') continue
    out.push({ id: `d-${id}`, kind: 'dev', title: DEVS[id].name, due: devDue(n, id), share: share(d.left, d.total, devRate(n, id)), color: '#ff9f0a' })
  }
  for (const t of game.missileTests ?? []) {
    if (t.nationId !== n.id) continue
    const flying = now >= t.launched
    out.push({ id: `t-${t.id}`, kind: 'test', title: `${flying ? 'Test in flight' : 'Countdown'}: ${DEVS[t.dev].name}`, due: t.lands, share: flying ? Math.min(1, (now - t.launched) / Math.max(1, t.lands - t.launched)) : 0, color: '#ff453a' })
  }
  const b = p.line[0]
  if (b) {
    const r = lineRate(n) * (b.kind === 'interceptor' ? PRODUCTION_RULES.roundsPerMissile : 1)
    const made = Math.min(b.count, b.made + (now > p.asOf ? monthsBetween(p.asOf, now) * r : 0))
    out.push({ id: `l-${b.id}`, kind: 'line', title: `Production line: ${Math.floor(made)} of ${b.count} ${lineKindName(b.kind)}`, due: r > 0 ? now + Math.ceil(((b.count - made) / r) * 30) : Infinity, share: made / b.count, color: b.kind === 'interceptor' ? '#64d2ff' : '#30d158' })
  }
  return out.sort((x, y) => x.due - y.due || (x.id < y.id ? -1 : 1))
}

/** What a batch on the line makes, in the plural: "cruise missiles", "interceptor rounds". */
export function lineKindName(k: LineKind): string {
  return k === 'interceptor' ? 'interceptor rounds' : `${MISSILES[k].name.toLowerCase()}s`
}

export interface ProgramStep {
  id: string
  title: string
  detail: string
  order?: Order
}

const order = (n: Nation, action: MissileProgramAction): Order => ({ type: 'missileProgram', nationId: n.id, action })

/** What to do next, best first: the steps that unblock the program, then the ones that grow it. At most `limit`. */
export function programSteps(game: GameState, n: Nation, workforce: number, limit = 3): ProgramStep[] {
  const p = n.mprog
  const out: ProgramStep[] = []
  const ok = (a: MissileProgramAction) => programProblem(game, n, a, workforce) === null
  const add = (id: string, title: string, detail: string, a?: MissileProgramAction) => out.push({ id, title, detail, ...(a ? { order: order(n, a) } : {}) })
  for (const id of DEV_IDS) if (p?.devs[id]?.state === 'test' && ok({ kind: 'test', dev: id })) add(`test-${id}`, `Test launch: ${DEVS[id].name}`, `The work is done. A test has a ${Math.round(testOdds(n, id) * 100)}% chance; success puts it in service.`, { kind: 'test', dev: id })
  if (p?.stalled) add('stalled', 'The treasury is empty', 'In-house work stands still until the month ends with money in the bank. Cut the budget or raise income.')
  if ((p?.fac.institute ?? 0) < 1 && !p?.builds.some((b) => b.facility === 'institute') && ok({ kind: 'build', facility: 'institute' })) add('institute', 'Found the research institute', 'In-house development needs one. It opens in a month.', { kind: 'build', facility: 'institute' })
  if ((p?.staff.engineer ?? 0) < PROGRAM_RULES.houseEngineers && ok({ kind: 'hire', role: 'engineer', count: 2 })) add('engineers', 'Hire two rocket engineers', `In-house work needs ${PROGRAM_RULES.houseEngineers}. ${STAFF.engineer.hire} money each, ${STAFF.engineer.salary} a month.`, { kind: 'hire', role: 'engineer', count: 2 })
  if (programLevel(n) < 1 && !fundMissilesProblem(n)) out.push({ id: 'charter', title: 'Raise the program to level 1', detail: `Opens cruise missiles and decoys and most of the development tree. ${MISSILE_PROGRAM.money[0]} money, ${MISSILE_PROGRAM.research[0]} research.`, order: { type: 'fundMissiles', nationId: n.id } })
  if ((p?.fac.stand ?? 0) < 1 && !p?.builds.some((b) => b.facility === 'stand') && ok({ kind: 'build', facility: 'stand' })) add('stand', 'Build the engine test stand', 'Every test launch needs one.', { kind: 'build', facility: 'stand' })
  const ready = DEV_IDS.find((id) => devStatus(n, id) === 'ready' && ok({ kind: 'develop', dev: id }))
  if (ready) add(`dev-${ready}`, `Develop ${DEVS[ready].name.toLowerCase()}`, `${DEVS[ready].blurb} ${DEVS[ready].money} money, ${DEVS[ready].tp} research, about ${plural(DEVS[ready].months, 'month')}.`, { kind: 'develop', dev: ready })
  if (p && !p.chief && programLevel(n) >= 1) add('chief', 'Hire a chief designer', 'A star who speeds one branch or steadies every test. See Talent.')
  const facility = FACILITY_IDS.find((f) => (p?.fac[f] ?? 0) < 1 && ok({ kind: 'build', facility: f }))
  if (facility && out.length < limit) add(`fac-${facility}`, `Build the ${FACILITIES[facility].name.toLowerCase()}`, FACILITIES[facility].blurb, { kind: 'build', facility })
  return out.slice(0, limit)
}

export interface CapabilityRow {
  kind: MissileType
  name: string
  km: number
  baseKm: number
  cep: number
}

/** What the program does for each kind: its range and its CEP (the circle half the missiles land in). */
export function capabilities(n: Nation): CapabilityRow[] {
  const harm = programFx(n)?.harm ?? 0
  return PROGRAM_MISSILES.map((k) => ({ kind: k, name: MISSILES[k].name, km: reachKm(n, k), baseKm: MISSILES[k].km, cep: Math.round((BASE_CEP[k] ?? 100) / (1 + harm)) }))
}

/** The next level of a facility: its price, months and upkeep, or null at the top. */
export function nextLevel(n: Nation, f: FacilityId): { level: number; money: number; months: number; upkeep: number } | null {
  const lvl = n.mprog?.fac[f] ?? 0
  const spec = FACILITIES[f]
  if (lvl >= spec.money.length) return null
  return { level: lvl + 1, money: spec.money[lvl], months: spec.months[lvl], upkeep: spec.upkeep[lvl] }
}

/** One plain line for each effect a development gives. */
export function devEffectLines(id: MissileDevId): string[] {
  const e = DEVS[id].effects
  const out: string[] = []
  const pct = (v: number) => `${Math.round(v * 100)}%`
  if (e.range) out.push(`+${pct(e.range)} range`)
  if (e.harm) out.push(`+${pct(e.harm)} harm per missile (smaller CEP)`)
  if (e.evade) out.push(`${pct(e.evade)} of enemy interception evaded`)
  if (e.intercept) out.push(`+${pct(e.intercept)} interception`)
  if (e.rounds) out.push(`+${pct(e.rounds)} interceptor rounds`)
  if (e.radar) out.push(`+${e.radar} early-warning level`)
  if (e.mobile) out.push(`+${e.mobile} mobile launcher level`)
  if (e.harden) out.push(`${pct(e.harden)} of the store safe from counterforce`)
  if (e.cost) out.push(`-${pct(e.cost)} missile price`)
  if (e.capacity) out.push(`+${e.capacity} missiles a month`)
  if (e.storage) out.push(`+${e.storage} stored`)
  if (e.reliability) out.push(`+${pct(e.reliability)} test success`)
  return out
}
