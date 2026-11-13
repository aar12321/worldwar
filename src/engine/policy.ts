import { BUDGET_LIMITS, GOVERNMENTS, NO_EFFECTS, budgetEffects, type PolicyEffects } from '../data/government'
import { TECH_BY_ID } from '../data/techTree'
import { LAW_SPECS } from '../data/unitTypes'
import type { Nation } from './types'

const FIELDS = Object.keys(NO_EFFECTS) as (keyof PolicyEffects)[]

/** All the ways a nation's government, laws and budget change its economy, added together. */
export function policyEffects(n: Pick<Nation, 'government' | 'laws' | 'budget' | 'techs'>): PolicyEffects {
  const out: PolicyEffects = { ...NO_EFFECTS }
  const add = (e: Partial<PolicyEffects> | undefined) => {
    if (!e) return
    for (const k of FIELDS) out[k] += e[k] ?? 0
  }
  add(GOVERNMENTS[n.government ?? 'monarchy']?.effects)
  for (const law of n.laws) add(LAW_SPECS[law]?.effects)
  for (const id of (n as Nation).techs ?? []) add(TECH_BY_ID[id]?.modifiers.policy)
  add(budgetEffects(n.budget ?? { military: BUDGET_LIMITS.even, education: BUDGET_LIMITS.even, health: BUDGET_LIMITS.even, infrastructure: BUDGET_LIMITS.even }))
  return out
}
