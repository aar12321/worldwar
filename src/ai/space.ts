import { BODIES, BODY_IDS, LABS, MINES, MISSION_IDS, MISSIONS, NODES, OUTPOST, PAD, ROCKETS, ROCKET_IDS, type MissionId, type NodeId, type SpaceAction } from '../data/space'
import { enemiesOf } from '../engine/helpers'
import type { EconomyReport } from '../engine/economy'
import { companiesFor, freeAstronauts, launchProblem, pickRocket, quote, spaceLocked, spaceProblem, staffOf, talentCap } from '../engine/space'
import type { GameState, NationId, Order } from '../engine/types'

/**
 * A rival's space program. A Medium rival is modest: a launch site, a few engineers, satellites. A Hard rival runs a serious program
 * up the ladder to the Moon, Mars and the claims that follow. Both pay for it out of what the country can spare: an order is placed
 * only while income stays in the black, the program stays inside a share of gross, and savings cover the whole cost with a reserve.
 */

const MEDIUM_LADDER: MissionId[] = ['sounding_test', 'sat_comms', 'sat_weather', 'sat_recon']
const HARD_LADDER: MissionId[] = MISSION_IDS

/** Discoveries a rival goes for, most useful first. */
const NODE_PRIORITY: NodeId[] = ['reusable', 'avionics', 'isru', 'composites', 'life_support', 'methalox', 'deep_comms', 'propellant', 'asteroid_metallurgy', 'regolith_build', 'microgravity', 'closed_loop', 'ion_drive']

export function manageSpace(s: GameState, nationId: NationId, econ: EconomyReport, skill: 1 | 2, tryAdd: (o: Order) => boolean, budget: number): number {
  const n = s.nations[nationId]
  if (spaceLocked(n)) return 0
  const sp = n.space
  if (enemiesOf(s, nationId).length > 0 && skill < 2) return 0
  // Never start with a thin treasury or a shrinking income.
  if (econ.netCapital < 10 || n.resources.capital < (sp ? 150 : 300) || budget < 120) return 0
  const workforce = econ.workforce
  const cap = talentCap(n, workforce)
  const share = skill === 2 ? 0.6 : 0.3
  const billNow = sp ? econ.space.bill.total : 0
  /** `monthly` is paid for `months` months; `upfront` is paid at once. */
  const go = (action: SpaceAction, monthly = 0, upfront = 0, months = 1): boolean => {
    const total = upfront + monthly * months
    if (econ.netCapital - monthly < 6 || billNow + monthly > share * econ.gross || n.resources.capital < total * 1.25 + 150 || upfront + monthly * 2 > budget) return false
    if (spaceProblem(s, n, action, workforce)) return false
    return tryAdd({ type: 'space', nationId, action })
  }
  const ladder = skill === 2 ? HARD_LADDER : MEDIUM_LADDER

  // Starting out.
  if (!sp || sp.engineers < 4) {
    const want = Math.min(cap, skill === 2 ? 8 : 5) - staffOf(sp)
    if (want > 0 && go({ kind: 'hire', role: 'engineer', count: Math.min(want, 4) }, 0, 16)) return 16
    if (!sp) return 0
  }
  const me = sp!

  // Claims first: a rival that has landed files at once.
  for (const body of BODY_IDS) if (me.bodies[body]?.landed && !s.space?.claims[body] && n.resources.pp >= 30 && go({ kind: 'claim', body })) return 0

  // Labs and discoveries: free benches work on something useful.
  if (me.labs === 0 && !me.labBuild && (me.done.sounding_test ?? 0) > 0 && n.resources.tp >= LABS.tp[1] && go({ kind: 'lab' }, LABS.cost[1] / LABS.months[1], 0, LABS.months[1])) return LABS.cost[1] / LABS.months[1]
  if (me.labs > me.research.length) {
    for (const id of NODE_PRIORITY) {
      const spec = NODES[id]
      if (skill < 2 && spec.lab > 1) continue
      if (n.resources.tp < spec.tp + 20) continue
      if (go({ kind: 'research', node: id }, spec.money / spec.months, 0, spec.months)) return spec.money / spec.months
    }
  }
  if (skill === 2 && me.labs > 0 && me.labs < 3 && !me.labBuild && me.exp >= 120 * me.labs && n.resources.tp >= LABS.tp[me.labs + 1] + 20 && go({ kind: 'lab' }, LABS.cost[me.labs + 1] / LABS.months[me.labs + 1], 0, LABS.months[me.labs + 1])) return 0

  // Outposts and mines, for a rich Hard rival with the tools for it.
  if (skill === 2 && n.resources.capital > 600) {
    for (const body of BODY_IDS) {
      const op = me.bodies[body]?.outpost
      if (!op) continue
      const up = op.level + 1
      if (up <= OUTPOST.max && go({ kind: 'outpost', body }, (OUTPOST.cost[up] * BODIES[body].distance) / OUTPOST.months[up], 0, OUTPOST.months[up])) return 0
      for (const mine of BODIES[body].mines) if (go({ kind: 'mine', body, mine }, (MINES[mine].cost * BODIES[body].distance) / MINES[mine].months, 0, MINES[mine].months)) return 0
    }
  }

  // The next mission up the ladder.
  const next = ladder.find((id) => {
    const spec = MISSIONS[id]
    if (spec.requires.some((r) => !(me.done[r] ?? 0))) return false
    if (me.missions.some((m) => m.kind === id)) return false
    if (spec.stage === 'outpost') return !!spec.body && s.space?.claims[spec.body]?.owner === nationId && !me.bodies[spec.body]?.outpost
    if (spec.sat) return !me.sats.some((x) => x.kind === spec.sat)
    return (me.done[id] ?? 0) < 1
  })
  if (!next) return 0
  const spec = MISSIONS[next]
  const rocket = ROCKETS[spec.rocket]
  // Staff for it.
  if (me.engineers < Math.max(spec.engineers, rocket.engineers) && staffOf(me) < cap && go({ kind: 'hire', role: 'engineer', count: Math.min(4, cap - staffOf(me)) }, 0, 16)) return 16
  if (spec.crew > 0 && freeAstronauts(me) < spec.crew && staffOf(me) < cap && go({ kind: 'hire', role: 'astronaut', count: Math.min(spec.crew - freeAstronauts(me), cap - staffOf(me)) }, 0, spec.crew * 14)) return spec.crew * 14
  // The rocket it needs: every class up to it developed, a launch site big enough, one in the hangar.
  for (const id of ROCKET_IDS) {
    if (ROCKETS[id].rank > rocket.rank) break
    if (!(me.rockets[id] ?? 0) && !me.dev && go({ kind: 'develop', rocket: id }, ROCKETS[id].dev / ROCKETS[id].devMonths, 0, ROCKETS[id].devMonths)) return ROCKETS[id].dev / ROCKETS[id].devMonths
  }
  if (me.pads < rocket.pad && !me.padBuild && go({ kind: 'pad' }, PAD.cost[me.pads + 1] / PAD.months[me.pads + 1], 0, PAD.months[me.pads + 1])) return 0
  const block = launchProblem(s, n, next, 'house', undefined, workforce)
  if (!block && go({ kind: 'launch', mission: next, mode: 'house' }, spec.payload / spec.months[0], 0, spec.months[0])) return 0
  if (!pickRocket(me, next) && !me.builds.some((b) => ROCKETS[b.rocket].rank >= rocket.rank) && me.pads >= rocket.pad && (me.rockets[spec.rocket] ?? 0) > 0 && go({ kind: 'build', rocket: spec.rocket }, rocket.cost / rocket.months, 0, rocket.months)) return 0
  // A rich Hard rival that cannot yet fly a mission itself, for want of experience, buys the flight from a company.
  if (block && skill === 2 && spec.exp > me.exp && n.resources.capital > 900 && spec.crew === 0 && rocket.rank <= 3) {
    const co = companiesFor(s, n).filter((c) => c.open).sort((a, b) => b.reliability / b.price - a.reliability / a.price || (a.id < b.id ? -1 : 1))[0]
    if (co) {
      const q = quote(s, n, next, 'outsource', co.id)
      if (!q.problem && q.price * 2.5 < n.resources.capital && go({ kind: 'launch', mission: next, mode: 'outsource', company: co.id }, 0, q.price)) return q.price
    }
  }
  return 0
}
