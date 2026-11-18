import { CIVICS, MINISTRIES, PIPELINE, POLICY_SPECS, SERVICE, type MinistryId, type PolicyAreaId } from '../data/civics'
import { candidatesFor, civicsCost, passChance } from '../engine/civics'
import type { EconomyReport } from '../engine/economy'
import { enemiesOf } from '../engine/helpers'
import type { GameState, NationId, Order } from '../engine/types'

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** How much a bot likes a candidate: competence, less corruption and the risk of a disloyal minister. */
const score = (m: { competence: number; corruption: number; loyalty: number }) => m.competence - m.corruption * 0.6 - Math.max(0, 35 - m.loyalty)

/**
 * The government desk for a bot. Easy rivals leave it alone. Medium rivals look at it twice a year and fill finance, labour and the
 * interior when money allows. Hard rivals look every quarter: they fill the whole cabinet in order of need (defence first at war),
 * size the civil service to unemployment, draft a reform a year and lobby a close vote. Nothing random: when a bot looks is fixed by
 * its name, and every order goes through the normal checks, so the same game always plays out the same way.
 */
export function manageCivics(s: GameState, nationId: NationId, econ: EconomyReport, skill: 0 | 1 | 2, tryAdd: (o: Order) => boolean): void {
  if (!CIVICS.on || skill === 0) return
  const n = s.nations[nationId]
  if (!n?.alive) return
  const period = skill === 2 ? 3 : 6
  if ((s.turn + hashString(nationId)) % period !== 0) return
  const c = n.civics
  const order = (action: Extract<Order, { type: 'civics' }>['action']) => tryAdd({ type: 'civics', nationId, action })
  const atWar = enemiesOf(s, nationId).length > 0

  // One minister a visit, the most needed empty ministry first, when the signing fee is a small part of the treasury and the budget stays in the black.
  const wanted: MinistryId[] = skill === 2 ? (atWar ? ['defence', 'finance', 'industry', 'labour', 'interior', 'science', 'foreign', 'education', 'health'] : ['finance', 'industry', 'labour', 'interior', 'science', 'foreign', 'education', 'health', 'defence']) : ['finance', 'labour', 'interior']
  if (econ.netCapital > (skill === 2 ? 6 : 10) && n.resources.capital > 80) {
    for (const id of wanted) {
      if (c?.cabinet[id] || !MINISTRIES.includes(id)) continue
      const best = candidatesFor(s, n, id).sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1))[0]
      if (!best || score(best) < 25) continue
      const fee = civicsCost(s, n, { kind: 'appoint', ministry: id, candidate: best.id }).capital
      if (fee > n.resources.capital * 0.1) continue
      if (order({ kind: 'appoint', ministry: id, candidate: best.id })) break
    }
  }
  if (skill < 2) return

  // The civil service follows unemployment, within what the budget can carry.
  const service = c?.service ?? SERVICE.standard
  const jobless = n.people?.unemployment ?? 0.05
  if (jobless > 0.1 && service < 3 && econ.netCapital > 12) order({ kind: 'service', level: service + 1 })
  else if ((jobless < 0.05 || econ.netCapital < 0) && service > SERVICE.standard) order({ kind: 'service', level: service - 1 })

  // A reform a year at most, when influence is plentiful; and a push for a close vote.
  const bills = c?.bills ?? []
  for (const b of bills) {
    if (b.stage !== 'vote' || n.resources.pp < PIPELINE.lobbyCost + 25) continue
    if (passChance(s, n, b) < 0.6) order({ kind: 'lobby', bill: b.id })
  }
  if (bills.length || (s.turn + hashString(nationId)) % 12 !== 0) return
  const corrupt = MINISTRIES.some((id) => (c?.cabinet[id]?.corruption ?? 0) > 30)
  const ideas: [PolicyAreaId, string][] = []
  if (corrupt) ideas.push(['antiCorruption', 'agency'])
  if (atWar) ideas.push(['industrial', 'strategic'])
  if (jobless > 0.09) ideas.push(['labourLaw', n.government === 'democracy' ? 'standard' : 'flexible'])
  ideas.push(['industrial', 'strategic'], ['digitalGov', 'eServices'], ['centralBank', 'independent'], ['talentVisas', 'skilled'])
  for (const [area, option] of ideas) {
    if (!POLICY_SPECS[area].options[option] || (c?.policies[area]?.option ?? POLICY_SPECS[area].standard) === option) continue
    if (n.resources.pp < POLICY_SPECS[area].cost + 30) break
    if (order({ kind: 'draft', area, option })) break
  }
}
