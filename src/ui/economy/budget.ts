import { BUDGET_KEYS, BUDGET_LIMITS } from '../../data/government'
import type { Budget, BudgetKey } from '../../engine/types'

/** Moves one budget share and spreads the change over the others, keeping every share in range and the total at 100%. */
export function rebalanceBudget(budget: Budget, key: BudgetKey, value: number): Budget {
  const v = Math.min(BUDGET_LIMITS.max, Math.max(BUDGET_LIMITS.min, value))
  const others = BUDGET_KEYS.filter((k) => k !== key)
  const rest = 1 - v
  const sum = others.reduce((a, k) => a + budget[k], 0)
  const out = { ...budget, [key]: v } as Budget
  for (const k of others) out[k] = sum > 0 ? (budget[k] / sum) * rest : rest / others.length
  // Clamp, then give any leftover to the largest share that can take it.
  for (const k of others) out[k] = Math.min(BUDGET_LIMITS.max, Math.max(BUDGET_LIMITS.min, out[k]))
  const total = BUDGET_KEYS.reduce((a, k) => a + out[k], 0)
  const slack = 1 - total
  if (Math.abs(slack) > 1e-9) {
    const pick = [...others].sort((a, b) => (slack > 0 ? out[a] - out[b] : out[b] - out[a]))[0]
    out[pick] = Math.min(BUDGET_LIMITS.max, Math.max(BUDGET_LIMITS.min, out[pick] + slack))
  }
  return out
}

export const pct1 = (v: number) => `${(v * 100).toFixed(0)}%`
