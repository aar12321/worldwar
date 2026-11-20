import { describe, expect, it } from 'vitest'
import { POLICY_AREAS, POLICY_SPECS, SERVICE } from '../../data/civics'
import { SOCIAL_IDS, SOCIAL_RULES } from '../../data/society'
import { civicsEffects, newCivics } from '../civics'
import { computeEconomy } from '../economy'
import { deskStability, softCap } from '../society'
import type { GameState, Nation } from '../types'
import { lineMap, startState } from './fixtures'

/**
 * The government desk's stability shares the one soft ceiling on care (`SOCIAL_RULES.deskShares`): programs, projects and the desk
 * together approach `stabilityCap` and never pass it; what the desk takes away counts in full.
 */
const map = lineMap(6)

function withShare<T>(on: boolean, fn: () => T): T {
  const was = SOCIAL_RULES.deskShares
  SOCIAL_RULES.deskShares = on
  try {
    return fn()
  } finally {
    SOCIAL_RULES.deskShares = was
  }
}

/** A nation with a Vast civil service and every reform that adds calm, fully phased in. */
function calmDesk(n: Nation) {
  const c = newCivics()
  c.service = SERVICE.levels.length - 1
  for (const area of POLICY_AREAS) {
    const best = Object.entries(POLICY_SPECS[area].options).sort((a, b) => (b[1].effects.stability ?? 0) - (a[1].effects.stability ?? 0))[0]
    if ((best[1].effects.stability ?? 0) > 0) c.policies[area] = { option: best[0], phase: 1 } as never
  }
  n.civics = c
}

const part = (s: GameState, label: string) => computeEconomy(s, map, 'r0').stabilityParts.find((p) => p.label === label)?.value ?? 0

describe('one ceiling for care and the government desk', () => {
  it('the arithmetic: adds on top of the care, never passes the ceiling, and takes away in full', () => {
    const cap = SOCIAL_RULES.stabilityCap
    expect(deskStability(5, 0)).toBeCloseTo(softCap(5), 12)
    expect(softCap(30) + deskStability(12, 30)).toBeLessThan(cap)
    expect(deskStability(12, 30)).toBeLessThan(2)
    expect(deskStability(-3, 30)).toBe(-3)
    expect(deskStability(0, 30)).toBe(0)
    withShare(false, () => expect(deskStability(12, 30)).toBe(12))
  })

  it('with every program at the top, an ideal desk adds little, and the three lines stay under the ceiling', () => {
    const s = startState(map, 'r0', 4)
    const n = s.nations.r0
    calmDesk(n)
    const desk = civicsEffects(n).stability
    expect(desk).toBeGreaterThan(1)
    // With no care at all, the desk counts nearly in full.
    expect(part(s, 'Cabinet and reforms')).toBeCloseTo(softCap(desk), 9)
    for (const id of SOCIAL_IDS) (n.social ??= {})[id] = { level: 3, strength: 3, changed: -1 }
    const care = part(s, 'Programs for the people') + part(s, 'Projects in your countries')
    const counted = part(s, 'Cabinet and reforms')
    expect(counted).toBeGreaterThan(0)
    expect(counted).toBeLessThan(desk)
    expect(care + counted).toBeLessThan(SOCIAL_RULES.stabilityCap)
    // Switched off, the desk is its own line in full, as it was.
    withShare(false, () => expect(part(s, 'Cabinet and reforms')).toBeCloseTo(desk, 12))
  })

  it('a desk that costs calm (Lean service) counts in full either way', () => {
    const s = startState(map, 'r0', 4)
    const n = s.nations.r0
    n.civics = newCivics()
    n.civics.service = 0
    for (const id of SOCIAL_IDS) (n.social ??= {})[id] = { level: 3, strength: 3, changed: -1 }
    const desk = civicsEffects(n).stability
    expect(desk).toBeLessThan(0)
    expect(part(s, 'Cabinet and reforms')).toBe(desk)
    withShare(false, () => expect(part(s, 'Cabinet and reforms')).toBe(desk))
  })
})
