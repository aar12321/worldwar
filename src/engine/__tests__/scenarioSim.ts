import { expect } from 'vitest'
import { scenarioOf } from '../../data/scenarios'
import { atWar } from '../helpers'
import type { GameState } from '../types'
import { playWorld } from './strategySim'

/**
 * Plays one scenario with the AI in every seat (the player's too) and checks what must stay true: the world stays in range,
 * every war is between living nations, nobody is allied with an enemy. `strategySim` also checks the game's invariants every year.
 * The scenario tests are split over three files so they run side by side.
 */
export function playScenario(id: string, months = 24): { state: GameState; peaceOffers: number } {
  const def = scenarioOf(id)!
  let peaceOffers = 0
  const { state } = playWorld({
    seed: 7,
    difficulty: def.recommended.difficulty,
    months,
    player: def.recommended.nation,
    scenario: id,
    check: true,
    probe: (_s, orders, month) => {
      if (month < 8) for (const o of orders) if (o.type === 'propose' && o.proposal.kind === 'peace' && o.nationId === def.recommended.nation) peaceOffers++
    },
  })
  for (const key of state.wars) {
    const [a, b] = key.split('|')
    expect(state.nations[a]?.alive && state.nations[b]?.alive, `${id}: war ${key}`).toBe(true)
  }
  for (const key of state.alliances) {
    const [a, b] = key.split('|')
    expect(atWar(state, a, b), `${id}: allied and at war ${key}`).toBe(false)
  }
  for (const n of Object.values(state.nations)) {
    expect(Number.isFinite(n.resources.capital) && Number.isFinite(n.stability), `${id}: ${n.id}`).toBe(true)
    expect(n.stability >= 0 && n.stability <= 100, `${id}: stability ${n.id}`).toBe(true)
  }
  return { state, peaceOffers }
}
