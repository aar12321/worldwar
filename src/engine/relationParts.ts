import { PROGRAMS, RELATIONS, TIES } from '../data/relations'
import { pairKey } from './helpers'
import type { GameState, NationId, ProgramKind } from './types'

/**
 * The warmth that is kept up rather than given once: an embassy, a running program, a joint war plan, a long friendship, and the chill of neglect.
 * It is worked out from the state every time it is asked for, not stored, so there is nothing to forget to remove and nothing that can add up past its ceiling.
 * Pure and free of the opinion code, so `opinionReport` can read it.
 */
export interface RelationLine {
  label: string
  /** What it is worth to `holder` now. */
  value: number
  /** What it adds (or takes) next month: zero once it has reached its ceiling. */
  step: number
}

export const PROGRAM_LABEL: Record<ProgramKind, string> = {
  students: 'Exchange students',
  science: 'Joint research',
  route: 'Trade routes',
  tariff: 'Preferential tariffs',
  basing: 'Basing rights',
  venture: 'Joint venture',
}

/** Months since a player last did anything warm for this nation, for a nation they have an arrangement with. Null when there is no arrangement. */
export function monthsQuiet(s: GameState, a: NationId, b: NationId): number | null {
  const r = s.relations
  if (!r) return null
  const k = pairKey(a, b)
  const arranged = r.since[k] !== undefined || r.embassies.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)) || s.deals.some((d) => d.kind === 'trade' && ((d.from === a && d.to === b) || (d.from === b && d.to === a)))
  if (!arranged) return null
  // With ties on, goods changing hands every month is contact: a running trade deal never leaves a partner feeling neglected.
  if (TIES.on && s.deals.some((d) => d.kind === 'trade' && ((d.from === a && d.to === b) || (d.from === b && d.to === a)) && (d.contract?.start ?? 0) <= s.turn)) return 0
  return Math.max(0, s.turn - (r.contact[k] ?? r.since[k] ?? s.turn))
}

const ramp = (base: number, per: number, months: number, cap: number) => {
  const raw = base + per * months
  return { value: Math.min(cap, raw), step: raw < cap ? Math.min(per, cap - raw) : 0 }
}

/** Every kept-up line of `holder`'s opinion of `target`. Empty for a game that has not used the Relations desk. */
export function relationLines(s: GameState, holder: NationId, target: NationId): RelationLine[] {
  const r = s.relations
  if (!RELATIONS.on || !r) return []
  const out: RelationLine[] = []
  const e = r.embassies.find((x) => x.from === target && x.to === holder)
  if (e) {
    const m = s.turn - e.since
    const base = ramp(RELATIONS.embassyBase, RELATIONS.embassyStep, m, RELATIONS.embassyCap)
    out.push({ label: 'Embassy', value: base.value, step: base.step })
    if (e.attache) {
      const a = ramp(RELATIONS.attacheBase, RELATIONS.attacheStep, s.turn - (e.attacheSince ?? e.since), RELATIONS.attacheCap)
      out.push({ label: 'Military attaché', value: a.value, step: a.step })
    }
  }
  for (const p of r.programs) {
    if (!((p.a === holder && p.b === target) || (p.a === target && p.b === holder))) continue
    const st = PROGRAMS.steady[p.kind]
    if (!st) continue
    // With ties on, a bigger joint venture is worth more: its ceiling grows with the stake.
    const cap = TIES.on && p.kind === 'venture' ? Math.min(TIES.venture.max, TIES.venture.base + (p.stake ?? 0) / TIES.venture.perStake) : st[1]
    const v = ramp(0, st[0], s.turn - p.start, cap)
    if (v.value >= 0.5 || v.step > 0) out.push({ label: PROGRAM_LABEL[p.kind], value: v.value, step: v.step })
  }
  for (const p of r.plans) {
    if (!((p.a === holder && p.b === target) || (p.a === target && p.b === holder))) continue
    const v = ramp(RELATIONS.plan.base, RELATIONS.plan.step, s.turn - p.start, RELATIONS.plan.cap)
    out.push({ label: 'Joint war plan', value: v.value, step: v.step })
  }
  const k = pairKey(holder, target)
  const since = r.since[k]
  if (since !== undefined && s.alliances.includes(k) && s.turn - since >= RELATIONS.steadfastAfter) {
    const v = ramp(0, RELATIONS.steadfastStep, s.turn - since - RELATIONS.steadfastAfter + 1, RELATIONS.steadfastCap)
    out.push({ label: 'Steadfast ally', value: v.value, step: v.step })
  }
  if (s.humans.includes(target) && !s.humans.includes(holder)) {
    const quiet = monthsQuiet(s, holder, target)
    if (quiet !== null && quiet > RELATIONS.neglectAfter) {
      const raw = RELATIONS.neglectStep * (quiet - RELATIONS.neglectAfter)
      out.push({ label: 'Neglected', value: -Math.min(RELATIONS.neglectCap, raw), step: raw < RELATIONS.neglectCap ? -RELATIONS.neglectStep : 0 })
    }
  }
  return out
}
