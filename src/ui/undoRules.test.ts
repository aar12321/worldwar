import { beforeEach, describe, expect, it } from 'vitest'
import { NUCLEAR } from '../data/nuclear'
import { isMonthEndOrder, undoable } from '../engine/orders'
import type { GameState, Order } from '../engine/types'
import { attackPool } from '../engine/deploy'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { choiceUnits, choiceOrder } from './attackChoices'

/**
 * Undo (the toast button, Ctrl+Z) only takes back what shows nothing and that the world has not seen. A warhead or salvo in the air, an
 * orbital strike, an attack fought at once and an offer a rival answered on the spot cannot be taken back, and they also cut off the
 * steps before them, so undoing an earlier step cannot carry them away either.
 */
function liveGame(mode: 'live' | 'turns' = 'live', player = 'germany', foe = 'poland') {
  useGame.getState().newGame({ playerRegionId: player, seed: 3, difficulty: 'normal', mode })
  const g: GameState = structuredClone(useGame.getState().game!)
  g.wars.push([player, foe].sort().join('|'))
  const me = g.nations[player]
  me.resources.capital = 5000
  me.resources.steel = 500
  me.resources.pp = 500
  me.tier = 4
  me.techs.push(NUCLEAR.tech, 'frontier_hypersonic')
  me.nuclear = { warheads: 2, building: [] }
  me.military.units.missile = 10
  for (const r of Object.values(g.regions)) if (r.owner === player) r.buildings.factory = Math.max(1, r.buildings.factory)
  useGame.setState({ game: g })
  return g
}

describe('which orders can be undone', () => {
  const live = { settings: { mode: 'live' } } as Pick<GameState, 'settings'>
  const turn = { settings: {} } as Pick<GameState, 'settings'>
  const o = (type: string, extra: object = {}) => ({ type, nationId: 'a', ...extra }) as unknown as Order

  it('the rule', () => {
    for (const mode of [live, turn]) {
      expect(undoable(mode, o('nuke', { target: 'b' }))).toBe(false)
      expect(undoable(mode, o('strike', { target: 'b', weapon: 'missile' }))).toBe(false)
      expect(undoable(mode, o('strike', { target: 'b', weapon: 'orbital' }))).toBe(false)
      expect(undoable(mode, o('build', { regionId: 'a', building: 'farm' }))).toBe(true)
    }
    // A live attack is an army that has not marched; a turn attack is a battle fought and reported at once.
    expect(undoable(live, o('attack', { target: 'b' }))).toBe(true)
    expect(undoable(turn, o('attack', { target: 'b' }))).toBe(false)
    // In a live game a rival answers an offer on the spot.
    expect(undoable(live, o('propose'))).toBe(false)
    expect(undoable(live, o('respond'))).toBe(false)
    expect(undoable(turn, o('propose'))).toBe(true)
  })

  it('every order that is done at once and cannot be taken back is a live-only or immediate order, never a month-end one that Cancel handles', () => {
    for (const mode of [live, turn]) for (const t of ['nuke', 'strike', 'propose', 'respond'] as const) if (!isMonthEndOrder(mode, t)) expect(undoable(mode, o(t))).toBe(false)
  })
})

describe('Undo in the store', () => {
  beforeEach(() => {
    useGame.setState({ online: null, fxQueue: [], summary: null, warRoom: null, helpOpen: false, running: false, undoStack: [] })
  })

  it('a warhead launched in a paused live game cannot be taken back, and it cuts the steps before it off', () => {
    const g = liveGame()
    const me = g.playerId
    const farm = g.regions[me].buildings.farm
    expect(useGame.getState().issueOrder({ type: 'build', nationId: me, regionId: me, building: 'farm' })).toBe(true)
    expect(useGame.getState().undoStack).toHaveLength(1)
    expect(useGame.getState().issueOrder({ type: 'nuke', nationId: me, target: 'poland' })).toBe(true)
    const after = useGame.getState().game!
    expect(after.nukes).toHaveLength(1)
    expect(after.nations[me].nuclear!.warheads).toBe(1)
    // Nothing to undo: not the warhead, and not the farm built before it (that would carry the warhead away with it).
    expect(useGame.getState().undoStack).toHaveLength(0)
    useGame.getState().undo()
    const still = useGame.getState().game!
    expect(still.nukes).toHaveLength(1)
    expect(still.regions[me].buildings.farm).toBe(farm + 1)
    expect(still.nations[me].nuclear!.warheads).toBe(1)
    // The player is told, so the toast does not promise an Undo.
    expect(useGame.getState().toasts.some((t) => /cannot be taken back/.test(t.text))).toBe(true)
    expect(useGame.getState().toasts.some((t) => t.action?.label === 'Undo' && /nuclear/i.test(t.text))).toBe(false)
  })

  it('a missile salvo in a live game cannot be taken back either', () => {
    const g = liveGame()
    const me = g.playerId
    expect(useGame.getState().issueOrder({ type: 'build', nationId: me, regionId: me, building: 'farm' })).toBe(true)
    const fired = useGame.getState().issueOrder({ type: 'strike', nationId: me, target: 'poland', weapon: 'missile', count: 1 })
    expect(fired).toBe(true)
    {
      expect(useGame.getState().game!.flights?.length).toBeGreaterThan(0)
      expect(useGame.getState().undoStack).toHaveLength(0)
      useGame.getState().undo()
      expect(useGame.getState().game!.flights?.length).toBeGreaterThan(0)
    }
  })

  it('an attack in a turn game is fought and reported at once, so it cannot be taken back', () => {
    const g = liveGame('turns', 'germany', 'poland')
    const me = g.playerId
    for (const r of Object.values(g.regions)) if (r.owner === me) r.buildings.barracks = 1
    useGame.getState().issueOrder({ type: 'build', nationId: me, regionId: me, building: 'farm' })
    expect(useGame.getState().undoStack).toHaveLength(1)
    const ok = useGame.getState().issueOrder({ type: 'attack', nationId: me, target: 'poland', commit: 'probe', stance: 'assault' })
    expect(ok).toBe(true)
    {
      expect(useGame.getState().undoStack).toHaveLength(0)
      useGame.getState().undo()
      // The battle stays fought.
      expect(useGame.getState().game!.battles.length).toBeGreaterThan(0)
    }
  })

  it('an ordinary order is still taken back as before', () => {
    const g = liveGame()
    const me = g.playerId
    const farm = g.regions[me].buildings.farm
    useGame.getState().issueOrder({ type: 'build', nationId: me, regionId: me, building: 'farm' })
    useGame.getState().undo()
    expect(useGame.getState().game!.regions[me].buildings.farm).toBe(farm)
  })

  it('a batch with one such order is cut off too', () => {
    const g = liveGame()
    const me = g.playerId
    useGame.getState().issueOrder({ type: 'build', nationId: me, regionId: me, building: 'farm' })
    useGame.getState().issueBatch([{ type: 'nuke', nationId: me, target: 'poland' }])
    expect(useGame.getState().undoStack).toHaveLength(0)
  })

  it('the War Room launches with the units of its choice and never a missile, in a live game and in a turn game', () => {
    for (const mode of ['live', 'turns'] as const) {
      const g = liveGame(mode, 'germany', 'poland')
      const me = g.playerId
      for (const r of Object.values(g.regions)) if (r.owner === me) r.buildings.barracks = 1
      useGame.setState({ game: g })
      const coastal = getWorld().map.regions.poland.coastal
      const units = choiceUnits(attackPool(g, me, [], mode === 'live'), 'main', coastal)
      // Exactly the call the War Room's Launch button makes.
      const order = choiceOrder(me, 'poland', 'assault', units)
      expect(useGame.getState().attack('poland', 'main', 'assault', undefined, undefined, order.units)).toBe(true)
      const after = useGame.getState().game!
      expect(after.nations[me].military.units.missile).toBe(10)
      if (mode === 'live') {
        const army = (after.armies ?? []).find((a) => a.nationId === me)!
        expect(army.units.missile).toBe(0)
        expect(army.units.infantry).toBeCloseTo(units.infantry, 6)
      } else {
        expect(after.battles.at(-1)!.attacker.units.missile).toBe(0)
      }
    }
  })
})
