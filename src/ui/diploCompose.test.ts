import { describe, expect, it } from 'vitest'
import { partnerRows, relTier, TIER_ORDER } from '../engine/relationsView'
import { getWorld } from '../map/world'
import { useGame } from '../store'

const { map } = getWorld()

describe('Relations links to the exact Diplomacy composer', () => {
  it('each link names its composer; peace still opens from a war; opening the list clears it', () => {
    useGame.getState().newGame({ playerRegionId: 'poland', seed: 3, difficulty: 'normal' })
    for (const c of ['trade', 'invest', 'loan', 'treaty', 'peace'] as const) {
      useGame.getState().openDiplomacy('germany', { compose: c })
      expect(useGame.getState().panel).toBe('diplomacy')
      expect(useGame.getState().diploFocus).toBe('germany')
      expect(useGame.getState().diploCompose).toBe(c)
      expect(useGame.getState().diploPeace).toBe(c === 'peace')
    }
    // The Wars tab's old way in still asks for the peace composer.
    useGame.getState().openDiplomacy('germany', { peace: true })
    expect(useGame.getState().diploCompose).toBe('peace')
    useGame.getState().openDiplomacy('germany')
    expect(useGame.getState().diploCompose).toBeNull()
    useGame.getState().openDiplomacy(null, { compose: 'trade' })
    expect(useGame.getState().diploCompose).toBeNull()
  })
})

describe('another player in the Relations list', () => {
  it('is in its own tier, not counted as Neutral (they hold no opinion)', () => {
    expect(relTier(0, false, false, true)).toBe('player')
    expect(relTier(0, true, false, true)).toBe('war')
    expect(relTier(0, false, true, true)).toBe('ally')
    expect(TIER_ORDER).toContain('player')
    useGame.getState().newGame({ playerRegionId: 'poland', humans: ['germany'], seed: 3, difficulty: 'normal' } as never)
    const game = useGame.getState().game!
    const rows = partnerRows(game, map, game.playerId)
    expect(rows.find((r) => r.id === 'germany')?.tier).toBe('player')
    expect(rows.filter((r) => r.tier === 'neutral').every((r) => !r.human)).toBe(true)
  })
})
