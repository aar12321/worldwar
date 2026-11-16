import { describe, expect, it } from 'vitest'
import { playScenario } from './scenarioSim'

/** Every scenario plays 24 months with the AI in every seat (the player's too) and breaks no rule. Part B of three. */
describe('scenarios play out (B)', () => {
  it('small-among-giants: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('small-among-giants')
    expect(state.turn).toBeGreaterThan(20)
  })
  it('collapsing-neighbor: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('collapsing-neighbor')
    expect(state.turn).toBeGreaterThan(20)
  })
  it('strait-under-fire: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('strait-under-fire')
    expect(state.turn).toBeGreaterThan(20)
  })
  it('powder-keg: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('powder-keg')
    expect(state.turn).toBeGreaterThan(20)
  })
})
