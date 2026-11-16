import type { Difficulty, MapRegion, WorldMap } from '../engine/types'

/** How strong a country starts, for ordering lists and naming its tier. */
export const nationScore = (r: MapRegion) => Math.pow(r.basePopulation, 0.6) * (0.3 + 0.7 * r.development)

export function rankNations(map: WorldMap): { r: MapRegion; score: number }[] {
  return Object.values(map.regions)
    .map((r) => ({ r, score: nationScore(r) }))
    .sort((a, b) => b.score - a.score)
}

/** How strong a nation starts. These are not the empire tiers, which you earn by holding countries. */
export const nationTier = (score: number) => (score > 25 ? 'Powerhouse' : score > 10 ? 'Strong start' : score > 4 ? 'Modest start' : 'Small start')

export type NationTier = ReturnType<typeof nationTier>

/** How a tier reads in a sentence. */
const TIER_PHRASE: Record<NationTier, string> = { Powerhouse: 'a powerhouse', 'Strong start': 'a strong start', 'Modest start': 'a modest start', 'Small start': 'a small start' }

/** The rival skill that suits a nation's size, and why. A suggestion only: nothing picks it for you. */
const SUGGESTED: Record<NationTier, { difficulty: Difficulty; why: string }> = {
  'Small start': { difficulty: 'easy', why: 'Rivals wait longer to attack, so you have time to grow.' },
  'Modest start': { difficulty: 'normal', why: 'A fair fight for a country that has to build up.' },
  'Strong start': { difficulty: 'normal', why: 'A fair fight for a country that can hold its own.' },
  Powerhouse: { difficulty: 'hard', why: 'You can stand up to rivals with a richer economy.' },
}

export const suggestedDifficulty = (tier: NationTier): Difficulty => SUGGESTED[tier].difficulty

/** The one line under the rival choices. `name` is the suggested difficulty's display name. */
export const difficultyHint = (tier: NationTier, name: string) => `Suggested for ${TIER_PHRASE[tier]}: ${name}`

/** Why that difficulty suits the size, for a tooltip. */
export const difficultyReason = (tier: NationTier) => SUGGESTED[tier].why
