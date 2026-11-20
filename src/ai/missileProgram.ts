import { AI_LINE, DEVS, DEV_IDS, FACILITIES, MPROG, PRODUCTION_RULES, type MissileDevId, type MissileProgramAction } from '../data/missileProgram'
import { MISSILE_TYPES } from '../data/missiles'
import type { EconomyReport } from '../engine/economy'
import { enemiesOf } from '../engine/helpers'
import { chiefCandidates, chiefHireCost, devStatus, programBill, programCost, programProblem, programTalentCap, roundsOnLine, testMoney } from '../engine/missileProgram'
import { fundMissilesCost, fundMissilesProblem, launchSite, missileStock, programLevel } from '../engine/missiles'
import { interceptorCap, interceptorsOf, missilesInStore, struckLately } from '../engine/missileWar'
import { programStaff } from '../engine/programEffects'
import { createRng } from '../engine/rng'
import type { GameState, NationId, Order, WorldMap } from '../engine/types'

/**
 * A rival's missile program. Easy rivals never run one. A Medium rival with a missile charter (or at war) builds an institute and a test
 * stand, hires a small team and works down a short list, testing what it finishes: one program order a month, on a third of the months.
 * A Hard rival does the same with two orders a month, more of the tree, a design bureau, a plant, analysts and a chief designer.
 * Every order is placed only while income stays in the black and the treasury covers it with a reserve, so no rival bankrupts itself
 * on rockets, and the bill stays inside a share of its income. Its random numbers come from their own stream.
 */

/** What a rival develops, best first: what a strike needs most, then defence. */
const MEDIUM_DEVS: MissileDevId[] = ['inertial', 'motors', 'decoys', 'gen2']
const HARD_DEVS: MissileDevId[] = ['inertial', 'motors', 'decoys', 'gen2', 'solid', 'satnav', 'warning', 'warheads', 'stage', 'seeker', 'gen3', 'mobile', 'lines']

function hashText(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export function manageMissileProgram(s: GameState, nationId: NationId, econ: EconomyReport, skill: 1 | 2, tryAdd: (o: Order) => boolean, budget: number): number {
  if (!MPROG.on) return 0
  const n = s.nations[nationId]
  const p = n.mprog
  const atWar = enemiesOf(s, nationId).length > 0
  const rng = createRng((s.seed ^ 0x3b0c) >>> 0, s.turn * 100003 + hashText(nationId))
  // Who starts one: a rival with a missile charter, a Hard rival at war, or now and then a rich and restless one.
  const founds =
    programLevel(n) >= 1 ||
    (skill === 2 && atWar) ||
    (econ.gross >= 40 && econ.netCapital >= 10 && n.resources.capital >= 150 && n.aggression >= 0.2 && rng.chance(skill === 2 ? 0.12 : MPROG.mediumFounds ? MPROG.mediumRich : 0.06)) ||
    // A Medium rival at war, with money to spare, founds one now and then (the draw only happens with the switch on, so off is exactly as before).
    (MPROG.mediumFounds && skill === 1 && !p && atWar && econ.gross >= 25 && econ.netCapital >= 8 && n.resources.capital >= 120 && rng.chance(MPROG.mediumWar))
  if (!p && !founds) return 0
  const bill = programBill(n).total
  // A program that has become a burden is put on a lean budget before anything else.
  if (p && (econ.netCapital < 0 || bill > 0.1 * econ.gross) && p.budget > 0.5) {
    tryAdd({ type: 'missileProgram', nationId, action: { kind: 'budget', level: 0.5 } })
    return 0
  }
  // Still too dear (the country shrank, the war bit): let staff go, the biggest team first.
  if (p && bill > 0.12 * econ.gross) {
    const role = (Object.keys(p.staff) as (keyof typeof p.staff)[]).sort((a, b) => (p.staff[b] ?? 0) - (p.staff[a] ?? 0) || (a < b ? -1 : 1))[0]
    if (role) tryAdd({ type: 'missileProgram', nationId, action: { kind: 'dismiss', role, count: Math.min(2, p.staff[role] ?? 0) } })
    return 0
  }
  // Shedding cost (above) is checked every month; growing the program only on some.
  // A Medium rival that has just decided to found one gets on with it (with the switch on); growing it is still only on some months.
  const founding = MPROG.mediumFounds && skill === 1 && !p
  if (!founding && !rng.chance(skill === 2 ? 0.75 : 0.4)) return 0
  if (econ.netCapital < 8 || bill > (skill === 2 ? 0.08 : 0.05) * econ.gross) return 0
  let orders = skill === 2 ? 2 : 1
  let spent = 0
  const workforce = econ.workforce
  const go = (action: MissileProgramAction, cost: number, upkeep = 0): boolean => {
    if (orders <= 0 || cost + 20 > Math.min(budget - spent, n.resources.capital - spent - 40) || econ.netCapital - upkeep < 6) return false
    if (programProblem(s, n, action, workforce)) return false
    if (!tryAdd({ type: 'missileProgram', nationId, action })) return false
    orders--
    spent += cost
    return true
  }
  const fac = (id: keyof typeof FACILITIES) => p?.fac[id] ?? 0
  const building = (id: keyof typeof FACILITIES) => !!p?.builds.some((b) => b.facility === id)
  const build = (id: keyof typeof FACILITIES) => {
    const lvl = fac(id)
    if (building(id) || lvl >= FACILITIES[id].money.length) return false
    return go({ kind: 'build', facility: id }, FACILITIES[id].money[lvl], FACILITIES[id].upkeep[lvl])
  }

  // 1. A finished development is tested at once: that is the point of it.
  for (const id of DEV_IDS) if (p?.devs[id]?.state === 'test' && go({ kind: 'test', dev: id }, testMoney(n, id))) break
  // 2. The core: an institute, two engineers, a test stand.
  if (fac('institute') < 1) build('institute')
  const cap = programTalentCap(n, workforce)
  if ((p?.staff.engineer ?? 0) < 2 && cap - programStaff(n) >= 2) go({ kind: 'hire', role: 'engineer', count: 2 }, 12, 1.6)
  if (fac('institute') >= 1 && fac('stand') < 1) build('stand')
  // The charter: level 1 once the institute stands, level 2 for a Hard rival a few projects in.
  const done = DEV_IDS.filter((id) => p?.devs[id]?.state === 'done').length
  const charter = programLevel(n)
  if (orders > 0 && fac('institute') >= 1 && (charter < 1 || (skill === 2 && charter < 2 && done >= 3)) && !fundMissilesProblem(n)) {
    const k = fundMissilesCost(n)
    if (n.resources.capital - spent > k.capital + 100 && n.resources.tp >= k.tp && tryAdd({ type: 'fundMissiles', nationId })) {
      orders--
      spent += k.capital
    }
  }
  // 3. Work down the list.
  if (fac('institute') >= 1 && (p?.staff.engineer ?? 0) >= 2) {
    const list = skill === 2 ? HARD_DEVS : MEDIUM_DEVS
    const next = list.find((id) => devStatus(n, id) === 'ready')
    if (next) go({ kind: 'develop', dev: next }, DEVS[next].money)
  }
  // 4. A Hard rival grows the program once the core stands: crews, a bureau, analysts, a bigger institute, a plant, a chief designer.
  if (skill === 2 && fac('institute') >= 1 && (p?.staff.engineer ?? 0) >= 2) {
    if ((p?.staff.crew ?? 0) < 2 && cap - programStaff(n) >= 1) go({ kind: 'hire', role: 'crew', count: 1 }, 5, 0.6)
    if (fac('bureau') < 1) build('bureau')
    if ((p?.staff.analyst ?? 0) < 1 && cap - programStaff(n) >= 1) go({ kind: 'hire', role: 'analyst', count: 1 }, 7, 0.9)
    if (fac('institute') < 2) build('institute')
    if (atWar && fac('plant') < 1) build('plant')
    if (atWar && fac('works') < 1) build('works')
    if (!p?.chief && n.resources.capital > 400) {
      const pick = chiefCandidates(s, n)
        .map((c, i) => ({ c, i }))
        .sort((a, b) => b.c.skill - a.c.skill || a.i - b.i)[0]
      if (pick) go({ kind: 'chief', pick: pick.i }, chiefHireCost(pick.c), 4)
    }
  }
  return spent
}

/**
 * Why a nation's interceptor store is under missile threat (MPROG.aiInterceptorLine), or null: struck by an enemy lately, a store already
 * run low (counting rounds on the line) while at war, or an enemy holding missiles with a launch site that reaches one of its most
 * populous countries. Pure.
 */
export function interceptorThreat(s: GameState, map: WorldMap, id: NationId): 'struck' | 'lowStore' | 'inRange' | null {
  const n = s.nations[id]
  const foes = enemiesOf(s, id).filter((e) => s.nations[e]?.alive)
  if (!n || !foes.length) return null
  if (struckLately(s, n, AI_LINE.struck).length) return 'struck'
  const cap = interceptorCap(n)
  if (cap > 0 && (interceptorsOf(n) + roundsOnLine(n)) / cap < AI_LINE.lowStore) return 'lowStore'
  const homes = Object.values(s.regions)
    .filter((r) => r.owner === id)
    .sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1))
    .slice(0, AI_LINE.homes)
  for (const foe of [...foes].sort()) {
    const f = s.nations[foe]
    if (missilesInStore(f) < AI_LINE.armed) continue
    const kinds = MISSILE_TYPES.filter((k) => missileStock(f, k) >= 1)
    if (homes.some((r) => kinds.some((k) => launchSite(s, map, foe, r.id, k) !== null))) return 'inRange'
  }
  return null
}

/**
 * A rival under missile threat puts interceptor rounds on its program's production line (MPROG.aiInterceptorLine): Medium and Hard, with a
 * plant and the interceptor works, never Easy. The batch fills the store's room (counting rounds already on the line), at least
 * `AI_LINE.minBatch` rounds, and only within the program's own money guards: not while the program is being cut back (income in the red or
 * its bill past a tenth of income), income of at least 6 a month,
 * the price plus a margin inside the budget and the treasury's reserve. No random draws: the same world gives the same batch.
 * Returns what it spent.
 */
export function queueInterceptorRounds(s: GameState, map: WorldMap, nationId: NationId, econ: EconomyReport, skill: 0 | 1 | 2, tryAdd: (o: Order) => boolean, budget: number): number {
  if (!MPROG.on || !MPROG.interceptorLine || !MPROG.aiInterceptorLine || skill < 1) return 0
  const n = s.nations[nationId]
  const p = n?.mprog
  if (!p || (p.fac.plant ?? 0) < 1 || (p.fac.works ?? 0) < 1) return 0
  const cap = interceptorCap(n)
  if (cap <= 0) return 0
  // The program's guards (manageMissileProgram): a program being cut back (income in the red, or its bill past a tenth of income) buys
  // nothing; a batch adds no upkeep, so otherwise the per-order guard holds: income at least 6 a month, the price inside budget and reserve.
  if (econ.netCapital < 6 || programBill(n).total > 0.1 * econ.gross) return 0
  const room = Math.min(PRODUCTION_RULES.batchMax, cap - interceptorsOf(n) - roundsOnLine(n))
  if (room < AI_LINE.minBatch) return 0
  if (!interceptorThreat(s, map, nationId)) return 0
  // As many rounds as the money allows, keeping the program's margin and reserve.
  const limit = Math.min(budget, n.resources.capital - 40) - 20
  const each = programCost(s, n, { kind: 'produce', missile: 'interceptor', count: 1 }).capital
  const count = Math.min(room, each > 0 ? Math.floor(limit / each) : room)
  if (count < AI_LINE.minBatch) return 0
  const action: MissileProgramAction = { kind: 'produce', missile: 'interceptor', count }
  if (programProblem(s, n, action, econ.workforce)) return 0
  const cost = programCost(s, n, action).capital
  if (cost + 20 > Math.min(budget, n.resources.capital - 40)) return 0
  return tryAdd({ type: 'missileProgram', nationId, action }) ? cost : 0
}
