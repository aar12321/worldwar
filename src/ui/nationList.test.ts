import { describe, expect, it } from 'vitest'
import { DIFFICULTY } from '../data/difficulty'
import type { Difficulty } from '../engine/types'
import { getWorld } from '../map/world'
import { difficultyHint, difficultyReason, nationTier, rankNations, suggestedDifficulty, type NationTier } from './nationList'

const TIERS: NationTier[] = ['Small start', 'Modest start', 'Strong start', 'Powerhouse']
const ORDER: Difficulty[] = ['easy', 'normal', 'hard']

describe('the suggested difficulty', () => {
  it('suggests an easier game for a smaller nation', () => {
    expect(suggestedDifficulty('Small start')).toBe('easy')
    expect(suggestedDifficulty('Powerhouse')).toBe('hard')
    const levels = TIERS.map((t) => ORDER.indexOf(suggestedDifficulty(t)))
    expect(levels).toEqual([...levels].sort((a, b) => a - b))
  })

  it('suggests a difficulty that exists, for every tier of nation in the world', () => {
    const ranked = rankNations(getWorld().map)
    const tiers = new Set(ranked.map(({ score }) => nationTier(score)))
    expect(tiers.size).toBeGreaterThan(1)
    for (const t of tiers) expect(DIFFICULTY[suggestedDifficulty(t)]).toBeDefined()
    // The strongest nation never gets a softer suggestion than the weakest.
    const first = ranked[0]
    const last = ranked[ranked.length - 1]
    expect(ORDER.indexOf(suggestedDifficulty(nationTier(first.score)))).toBeGreaterThanOrEqual(ORDER.indexOf(suggestedDifficulty(nationTier(last.score))))
  })

  it('writes one short line that names the size and the difficulty', () => {
    expect(difficultyHint('Small start', DIFFICULTY.easy.name)).toBe('Suggested for a small start: Easy')
    expect(difficultyHint('Powerhouse', DIFFICULTY.hard.name)).toBe('Suggested for a powerhouse: Hard')
    for (const t of TIERS) {
      const name = DIFFICULTY[suggestedDifficulty(t)].name
      const line = difficultyHint(t, name)
      expect(line.endsWith(`: ${name}`)).toBe(true)
      expect(line.length).toBeLessThan(45)
      expect(difficultyReason(t).length).toBeGreaterThan(10)
    }
  })
})
