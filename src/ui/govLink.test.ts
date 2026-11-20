import { beforeEach, describe, expect, it } from 'vitest'
import { useGame } from '../store'
import { openGovernment } from './economy/government/section'

describe('Government deep links', () => {
  beforeEach(() => {
    useGame.setState({ online: null, fxQueue: [], summary: null, warRoom: null, helpOpen: false, running: false, toasts: [] })
    useGame.getState().newGame({ playerRegionId: 'poland', seed: 3, difficulty: 'normal' })
  })

  it('an advice target with a section opens Government on that section, even with the tab already open', () => {
    useGame.getState().goTo({ desk: 'economy', tab: 'government' })
    expect(useGame.getState().govSection).toBe('command')
    useGame.getState().goTo({ desk: 'economy', tab: 'government', gov: 'constitution' })
    const st = useGame.getState()
    expect(st.panel).toBe('economy')
    expect(st.economyTab).toBe('government')
    expect(st.govSection).toBe('constitution')
  })

  it('openGovernment and the tab\'s own section switch share one place', () => {
    openGovernment('talent')
    expect(useGame.getState().govSection).toBe('talent')
    useGame.getState().setGovSection('jobs')
    expect(useGame.getState().govSection).toBe('jobs')
    // A plain link keeps the section the player left it on.
    useGame.getState().goTo({ desk: 'economy', tab: 'government' })
    expect(useGame.getState().govSection).toBe('jobs')
  })
})
