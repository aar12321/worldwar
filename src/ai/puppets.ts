import { PUPPET, TRIBUTE } from '../data/puppets'
import { enemiesOf, puppetsOf } from '../engine/helpers'
import { tributeOf } from '../engine/puppets'
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
