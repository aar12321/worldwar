import { GOVERNMENTS, NO_EFFECTS, type PolicyEffects } from '../data/government'
import { EMPIRE_RULES } from '../data/empire'
import { TECH_BY_ID } from '../data/techTree'
import { LAW_SPECS } from '../data/unitTypes'
import { societyEffects } from './society'
import type { Nation } from './types'

const FIELDS = Object.keys(NO_EFFECTS) as (keyof PolicyEffects)[]

/** All the ways a nation's government, laws and technology change its economy, added together. Laws buy less calm than they once did. */
export function policyEffects(n: Pick<Nation, 'government' | 'laws' | 'techs'> & Partial<Pick<Nation, 'social' | 'campaigns'>>): PolicyEffects {
  const out: PolicyEffects = { ...NO_EFFECTS }
  const add = (e: Partial<PolicyEffects> | undefined) => {
    if (!e) return
    for (const k of FIELDS) out[k] += e[k] ?? 0
  }
  add(GOVERNMENTS[n.government ?? 'monarchy']?.effects)
  for (const law of n.laws) {
    const e = LAW_SPECS[law]?.effects
    if (!e) continue
    add({ ...e, stability: (e.stability ?? 0) > 0 ? (e.stability ?? 0) * EMPIRE_RULES.lawStabilityShare : e.stability })
  }
  for (const id of (n as Nation).techs ?? []) add(TECH_BY_ID[id]?.modifiers.policy)
  // Programs for the people: output, research, money and the rest. Their stability is counted on its own, under a ceiling.
  add(societyEffects(n).policy)
  return out
}
