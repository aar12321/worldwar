import { beforeEach, describe, expect, it } from 'vitest'
import { addOpinion } from '../ai/opinion'
import { factionOf } from '../engine/factions'
import { applyOrderNow } from '../engine/resolveTurn'
import type { GameState, Order } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'

const { map } = getWorld()

/**
 * The store turns what changed in your faction at a month's end into toasts (`factionNews` is tested on its own; this is the wiring).
 */
describe('faction news reaches the player as toasts when a month turns', () => {
  beforeEach(() => {
    useGame.setState({ online: null, fxQueue: [], summary: null, warRoom: null, helpOpen: false, running: false, toasts: [] })
  })

  function pact(): GameState {
    useGame.getState().newGame({ playerRegionId: 'germany', seed: 3, difficulty: 'normal' })
    const g = structuredClone(useGame.getState().game!)
    g.nextEventTurn = 99999
    const ok = (o: Order) => expect(applyOrderNow(g, map, o).error, JSON.stringify(o)).toBeNull()
    addOpinion(g, 'france', 'germany', 'Friends', 60, 0.01)
    ok({ type: 'factionFound', nationId: 'germany', name: 'Iron Pact' })
    ok({ type: 'factionInvite', nationId: 'germany', target: 'france' })
    const f = factionOf(g, 'germany')!
    if (!f.members.includes('france')) ok({ type: 'factionJoin', nationId: 'france', factionId: f.id })
    g.nations.germany.resources.capital = 3000
    g.nations.germany.resources.oil = 200
    g.nations.germany.resources.food = 200
    g.nations.germany.resources.pp = 500
    ok({ type: 'factionContribute', nationId: 'germany', gift: { units: { infantry: 4 }, stock: { money: 300, oil: 30, food: 30 } } })
    return g
  }

  it('a war the faction votes into is told in a toast', () => {
    const g = pact()
    const f = factionOf(g, 'germany')!
    const err = applyOrderNow(g, map, { type: 'factionPropose', nationId: 'germany', proposal: { kind: 'war', target: 'poland' } }).error
    expect(err).toBeNull()
    // France votes yes in the first month; the vote is settled at the end of the next.
    f.proposals[0].votes.france = 'yes'
    useGame.setState({ game: g, orders: [], undoStack: [], toasts: [] })
    useGame.getState().endTurn()
    useGame.getState().endTurn()
    const text = useGame.getState().toasts.map((t) => t.text)
    expect(text.some((t) => /Iron Pact is at war with/.test(t))).toBe(true)
  }, 120_000)
})
