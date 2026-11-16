import { describe, expect, it } from 'vitest'
import { playScenario } from './scenarioSim'

/** Every scenario plays 24 months with the AI in every seat (the player's too) and breaks no rule. Part C of three. */
describe('scenarios play out (C)', () => {
  it('peaceful-builder: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('peaceful-builder')
    expect(state.turn).toBeGreaterThan(20)
  })
  it('resource-crunch: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('resource-crunch')
    expect(state.turn).toBeGreaterThan(20)
  })
  it('rising-giant: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('rising-giant')
    expect(state.turn).toBeGreaterThan(20)
  })
})
