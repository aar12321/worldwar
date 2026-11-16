import { describe, expect, it } from 'vitest'
import { playScenario } from './scenarioSim'

/** Every scenario plays 24 months with the AI in every seat (the player's too) and breaks no rule. Part A of three. */
describe('scenarios play out (A)', () => {
  it('cold-war: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('cold-war')
    expect(state.turn).toBeGreaterThan(20)
  })
  it('arms-race: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('arms-race')
    expect(state.turn).toBeGreaterThan(20)
  })
  it('plague-year: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state } = playScenario('plague-year')
    expect(state.turn).toBeGreaterThan(20)
  })
  it('two-fronts: 24 months of bots, no broken rule', { timeout: 900_000 }, () => {
    const { state, peaceOffers } = playScenario('two-fronts')
    expect(state.turn).toBeGreaterThan(20)
    // A nation that starts the game losing on two borders looks for the peace table at once.
    expect(peaceOffers).toBeGreaterThan(0)
  })
})
