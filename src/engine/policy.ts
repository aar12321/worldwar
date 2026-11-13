import { BUDGET_LIMITS, GOVERNMENTS, NO_EFFECTS, budgetEffects, type PolicyEffects } from '../data/government'
import { LAW_SPECS } from '../data/unitTypes'
import type { Nation } from './types'

const FIELDS = Object.keys(NO_EFFECTS) as (keyof PolicyEffects)[]

/** All the ways a nation's government, laws and budget change its economy, added together. */
export function policyEffects(n: Pick<Nation, 'government' | 'laws' | 'budget'>): PolicyEffects {
  const out: PolicyEffects = { ...NO_EFFECTS }
  const add = (e: Partial<PolicyEffects> | undefined) => {
    if (!e) return
    for (const k of FIELDS) out[k] += e[k] ?? 0
  }
  add(GOVERNMENTS[n.government ?? 'monarchy']?.effects)
  for (const law of n.laws) add(LAW_SPECS[law]?.effects)
  add(budgetEffects(n.budget ?? { military: BUDGET_LIMITS.even, education: BUDGET_LIMITS.even, health: BUDGET_LIMITS.even, infrastructure: BUDGET_LIMITS.even }))
  return out
}
