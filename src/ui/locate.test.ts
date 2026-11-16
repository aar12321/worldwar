import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { globeBridge } from './globeBridge'
import { allDesks, targetForKey } from './registry'
import { regCtxOf } from './regCtx'

const { map } = getWorld()

describe('Locate: show a nation on the map', () => {
  beforeEach(() => {
    useGame.setState({ online: null, fxQueue: [], summary: null, warRoom: null, helpOpen: false, running: false, toasts: [] })
    useGame.getState().newGame({ playerRegionId: 'germany', seed: 3, difficulty: 'normal' })
  })

  it('closes the desk, selects the nation\'s capital, turns the globe to it and offers the way back', () => {
    const pointOfView = vi.fn()
    globeBridge.api = { pointOfView } as never
    useGame.getState().openRelations('france')
    expect(useGame.getState().panel).toBe('relations')
    useGame.getState().locateNation('france')
    const st = useGame.getState()
    const capital = st.game!.nations.france.capital
    expect(st.panel).toBe('none')
    expect(st.selectedRegion).toBe(capital)
    expect(pointOfView).toHaveBeenCalledWith({ lat: map.regions[capital].lat, lng: map.regions[capital].lng, altitude: 1.5 }, expect.any(Number))
    const toast = st.toasts[st.toasts.length - 1]
    expect(toast.action?.label).toBe('Back to desk')
    toast.action!.run()
    expect(useGame.getState().panel).toBe('relations')
    expect(useGame.getState().relFocus).toBe('france')
    globeBridge.api = null
  })

  it('does nothing for a nation that does not exist, and works without a globe', () => {
    globeBridge.api = null
    const before = useGame.getState().panel
    useGame.getState().locateNation('atlantis')
    expect(useGame.getState().panel).toBe(before)
    useGame.getState().locateNation('france')
    expect(useGame.getState().selectedRegion).toBe(useGame.getState().game!.nations.france.capital)
  })

  it('the Relations desk is in the registry with its own key', () => {
    expect(allDesks().some((d) => d.id === 'relations')).toBe(true)
    expect(targetForKey('o', regCtxOf(useGame.getState().game))).toEqual({ desk: 'relations' })
  })
})
