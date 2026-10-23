import { describe, expect, it } from 'vitest'
import { createInitialState } from '../data/startingNations'
import { lineMap } from '../engine/__tests__/fixtures'
import { MAP_PALETTE, PLAYER_COLOR, mapColor } from '../data/mapColors'

describe('map colors', () => {
  it('spreads countries across a palette that is not neon cyan', () => {
    const seen = new Set(Array.from({ length: 28 }, (_, i) => mapColor(i)))
    expect(seen.size).toBeGreaterThan(16)
    for (const color of MAP_PALETTE) {
      expect(color.toLowerCase()).not.toBe('#22d3ee')
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)
      const neonSea = b > 200 && g > 180 && r < 80
      expect(neonSea).toBe(false)
    }
  })

  it('paints the player with the same kind of color as everyone else', () => {
    const map = lineMap(4)
    const state = createInitialState(map, { playerRegionId: 'r0', seed: 1, victoryShare: 0.4 })
    const colors = Object.values(state.nations).map((nation) => nation.color)
    expect(new Set(colors).size).toBe(4)
    expect(state.nations.r0.color).toBe(PLAYER_COLOR)
    expect(Object.values(state.nations).filter((nation) => !nation.isPlayer).every((nation) => MAP_PALETTE.includes(nation.color))).toBe(true)
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(PLAYER_COLOR.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(b + 40)
    expect(r).toBeGreaterThan(g)
  })
})
