import { DEVS, DEV_IDS, FACILITIES, MPROG, type MissileDevId, type MissileProgramAction } from '../data/missileProgram'
import type { EconomyReport } from '../engine/economy'
import { enemiesOf } from '../engine/helpers'
import { chiefCandidates, chiefHireCost, devStatus, programBill, programProblem, programTalentCap, testMoney } from '../engine/missileProgram'
import { fundMissilesCost, fundMissilesProblem, programLevel } from '../engine/missiles'
import { programStaff } from '../engine/programEffects'
import { createRng } from '../engine/rng'
import type { GameState, NationId, Order } from '../engine/types'

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
  const founds = programLevel(n) >= 1 || (skill === 2 && atWar) || (econ.gross >= 40 && econ.netCapital >= 10 && n.resources.capital >= 150 && n.aggression >= 0.2 && rng.chance(skill === 2 ? 0.12 : 0.06))
  if (!p && !founds) return 0
  if (!rng.chance(skill === 2 ? 0.75 : 0.4)) return 0
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
    if (n.resources.capital - spent > k.capital + 200 && n.resources.tp >= k.tp && tryAdd({ type: 'fundMissiles', nationId })) {
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
  // 4. A Hard rival grows the program: crews, a bureau, analysts, a bigger institute, a plant, a chief designer.
  if (skill === 2) {
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
