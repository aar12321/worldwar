import { PUPPET, TRIBUTE } from '../data/puppets'
import { enemiesOf, puppetsOf, regionsOf } from '../engine/helpers'
import { liberablePuppets, tributeOf } from '../engine/puppets'
import { grossIncome } from '../engine/victory'
import { liberateValue, puppetValue, regionValue } from '../engine/warscore'
import type { Rng } from '../engine/rng'
import type { GameState, NationId, Order, PuppetPatch, TributeForm, WorldMap } from '../engine/types'

/**
 * How a bot rules the puppets it owns (a puppet's own bot no longer sets its taxes, draft or spending: see `lockedByMaster`).
 *
 * - Easy leaves them as they are (and so never calls this).
 * - Medium sets a moderate tax, draft and tribute once, then only tends loyalty: aid to a restive puppet when it is rich.
 * - Hard balances loyalty against extraction every few months: it relaxes a shaky puppet, takes more from a loyal one, asks for the
 *   oil, steel or soldiers it is short of, and never lets a puppet fall toward rebellion while it can pay to prevent it.
 *
 * Returns the money it spends, so the caller's budget stays honest.
 */
export function managePuppets(s: GameState, _map: WorldMap, nationId: NationId, skill: 1 | 2, rng: Rng, tryAdd: (o: Order) => boolean, budget: number): number {
  const me = s.nations[nationId]
  let spent = 0
  const atWar = enemiesOf(s, nationId).length > 0
  for (const id of puppetsOf(s, nationId)) {
    const p = s.nations[id]
    if (s.humans.includes(id)) continue
    if (p.ruledAt === s.turn) continue
    const L = p.loyalty
    const since = s.turn - (p.ruledAt ?? -99)
    const patch: PuppetPatch = {}
    const want = (k: keyof PuppetPatch, v: unknown) => ((patch as Record<string, unknown>)[k] = v)

    if (L === undefined || p.ruledAt === undefined) {
      // First time: the moderate rule. A puppet of the old kind gains a loyalty here.
      if (p.taxRate > PUPPET.tax.neutral + 0.02) want('taxRate', PUPPET.tax.neutral)
      if (p.draftRate > PUPPET.draft.neutral + 0.03) want('draftRate', 0.06)
      want('tribute', { form: 'money', share: skill === 2 ? 0.16 : 0.14 })
    } else if (skill === 1) {
      // Medium only tends a puppet that is going wrong.
      if (L < 35 && budget - spent > 120 && rng.chance(0.5)) want('aid', 60)
    } else if (since >= 3) {
      const tribute = tributeOf(p)
      if (L < 35) {
        // Relax: lower the tribute to the loyalty-free level, ease taxes and draft, and buy loyalty if the treasury allows.
        if (p.taxRate > PUPPET.tax.neutral - 0.03) want('taxRate', PUPPET.tax.neutral - 0.03)
        else if (p.draftRate > PUPPET.draft.neutral + 0.01) want('draftRate', PUPPET.draft.neutral)
        else if (tribute.share > TRIBUTE[tribute.form].easy) want('tribute', { form: tribute.form, share: TRIBUTE[tribute.form].easy })
        else if (budget - spent > 150) want('aid', Math.min(120, Math.floor((budget - spent) * 0.25)))
      } else if (L >= 70 && !atWar) {
        // A loyal puppet pays more, in the form its master is short of.
        const form = neededForm(s, nationId, id) ?? 'money'
        const spec = TRIBUTE[form]
        const share = Math.min(spec.max, spec.easy + 0.06)
        if (tribute.form !== form || Math.abs(tribute.share - share) > 0.02) want('tribute', { form, share })
      } else if (L >= 45 && L < 70 && tribute.form === 'money' && tribute.share > 0.2) {
        want('tribute', { form: 'money', share: 0.16 })
      } else if (atWar && me.militaryPool < 40 && L >= 45 && tribute.form !== 'levy') {
        want('tribute', { form: 'levy', share: 0.1 })
      }
    }
    if (Object.keys(patch).length === 0) continue
    if (tryAdd({ type: 'governPuppet', nationId, target: id, patch })) {
      if (typeof patch.aid === 'number') spent += patch.aid
    } else if (patch.aid === undefined && patch.tribute) {
      // Whatever part of the plan the rules refused, the tribute alone may still go through.
      tryAdd({ type: 'governPuppet', nationId, target: id, patch: { tribute: patch.tribute } })
    }
  }
  return spent
}

/** What the master is short of that this puppet can send, or null. */
function neededForm(s: GameState, master: NationId, puppet: NationId): TributeForm | null {
  const m = s.nations[master]
  if (m.resources.oil < 6 && (s.nations[puppet].resources.oil ?? 0) > 6) return 'oil'
  if (m.resources.steel < 6 && (s.nations[puppet].resources.steel ?? 0) > 6) return 'steel'
  return null
}

/**
 * When a rival asks for a puppet at the peace table instead of land (see `peaceTerms`). Never Easy. Medium wants a decisive win
 * (war score 30) and keeps one puppet; Hard settles for a clear win (25) and keeps up to three. Whoever it is, the loser must be a
 * country that is worth ruling (its land is worth at least `minLand` in war score), neither side may be a puppet already, and a
 * master never holds more puppets (the loser's own included) than 1 + half its own countries, and never rules a country that earns more than 1.25 times what it does itself, so a small nation cannot snowball on tribute.
 */
export const PUPPET_AI = { minNet: [99, 30, 25], maxPuppets: [0, 1, 3], minLand: 30, maxRichness: 1.25, countriesPerPuppet: 2 }

export function wantsPuppet(s: GameState, map: WorldMap, me: NationId, enemy: NationId, net: number, skill: 0 | 1 | 2): boolean {
  if (skill === 0 || net < PUPPET_AI.minNet[skill]) return false
  const m = s.nations[me]
  const e = s.nations[enemy]
  if (!m?.alive || !e?.alive || m.overlord || e.overlord || s.humans.includes(me)) return false
  // The loser's own puppets pass up to the winner with it, so they count against the cap too.
  if (puppetsOf(s, me).length + 1 + puppetsOf(s, enemy).length > Math.min(PUPPET_AI.maxPuppets[skill], 1 + Math.floor(regionsOf(s, me).length / PUPPET_AI.countriesPerPuppet))) return false
  // A puppet much richer than its master would out-earn it on tribute: that is a conquest to take apart, not a state to rule.
  if (grossIncome(s, map, enemy) > PUPPET_AI.maxRichness * Math.max(1, grossIncome(s, map, me))) return false
  let land = 0
  for (const r of regionsOf(s, enemy)) land += regionValue(s, map, r)
  if (land < PUPPET_AI.minLand) return false
  return puppetValue(s, map, enemy) <= net * 0.85
}

/**
 * The puppet of an enemy a Hard rival frees at the peace table, if it has cause (it went to war for it, or the puppet cries out) and
 * the war score covers it, with the war score it has left. Freeing a puppet takes the master's tribute and soldiers away and wins a
 * friend; the cheapest cause is taken first.
 */
export function liberationChoice(s: GameState, map: WorldMap, me: NationId, enemy: NationId, budget: number, skill: 0 | 1 | 2): { id: NationId; cost: number } | null {
  if (skill < 2) return null
  let best: { id: NationId; cost: number } | null = null
  for (const id of liberablePuppets(s, me, enemy)) {
    const cost = liberateValue(s, map, id)
    if (cost > budget) continue
    if (!best || cost < best.cost) best = { id, cost }
  }
  return best
}
